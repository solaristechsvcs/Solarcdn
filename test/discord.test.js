import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
const owner='111111111111111111',admin='222222222222222222',stranger='333333333333333333';
test('Discord OAuth and owner-only grants',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'solarcdn-discord-'));
 const users=new Map([[1,{id:1,email:'local@example.test',role:'admin'}]]),accounts=new Map(),grants=new Map();let nextId=2,profileId=owner,fetches=0,providerFail=false;
 const execute=async(sql,p=[])=>{
  if(sql.startsWith('SELECT user_id'))return [[...(accounts.has(p[0])?[{user_id:accounts.get(p[0])}]:[])]];
  if(sql.startsWith('SELECT discord_id FROM'))return [[...(grants.has(p[0])?[{discord_id:p[0]}]:[])]];
  if(sql.startsWith('SELECT id,email,role'))return [[...(users.has(Number(p[0]))?[{...users.get(Number(p[0]))}]:[])]];
  if(sql.startsWith('INSERT INTO users')){const id=nextId++;users.set(id,{id,email:p[0],role:'user'});return [{insertId:id}];}
  if(sql.startsWith('INSERT INTO discord_accounts')){accounts.set(p[0],p[1]);return [{}];}
  if(sql.startsWith('INSERT INTO discord_admins')){grants.set(p[0],p[1]);return [{}];}
  if(sql.startsWith('DELETE FROM discord_admins')){grants.delete(p[0]);return [{}];}
  if(sql.startsWith('SELECT discord_id,created_at'))return [[...grants.keys()].map(discord_id=>({discord_id}))];
  throw new Error('Unexpected SQL: '+sql);
 };
 const db={execute,async getConnection(){return {execute,async beginTransaction(){},async commit(){},async rollback(){},release(){}};}};
 const fetchDiscord=async(url,opts)=>{
  fetches++;
  if(providerFail)throw new Error('provider unavailable');
  if(url.endsWith('/token')){assert.equal(opts.body.get('grant_type'),'authorization_code');assert.equal(opts.body.get('redirect_uri'),'http://localhost/api/auth/discord/callback');return {ok:true,json:async()=>({access_token:'test-token'})};}
  assert.equal(opts.headers.Authorization,'Bearer test-token');return {ok:true,json:async()=>({id:profileId})};
 };
 const config={jwtSecret:'s'.repeat(48),publicBaseUrl:'http://localhost',storageDir:root,maxUploadBytes:1000,discord:{clientId:'123456789012345678',clientSecret:'test-only-secret',ownerIds:[owner]}};
 const app=await createApp(config,db,{fetchDiscord});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=(url,opts={})=>fetch('http://127.0.0.1:'+server.address().port+url,{redirect:'manual',...opts});
 const start=async()=>{const r=await request('/api/auth/discord');assert.equal(r.status,302);const url=new URL(r.headers.get('location'));assert.equal(url.origin,'https://discord.com');assert.equal(url.searchParams.get('scope'),'identify');return {state:url.searchParams.get('state'),cookie:r.headers.get('set-cookie').split(';')[0]};};
 const callback=async flow=>request('/api/auth/discord/callback?code=code&state='+flow.state,{headers:{Cookie:flow.cookie}});
 const session=r=>{const cookies=r.headers.getSetCookie();return cookies.find(c=>c.startsWith('solarcdn_session=')).split(';')[0];};
 try{
  assert.deepEqual(await (await request('/api/auth/providers')).json(),{discord:true});
  const flow=await start();
  let r=await request('/api/auth/discord/callback?code=bad&state='+flow.state);assert.equal(r.headers.get('location'),'/?auth_error=state');assert.equal(fetches,0);
  r=await callback(flow);assert.equal(r.headers.get('location'),'/');const ownerCookie=session(r);
  assert.equal((await callback(flow)).headers.get('location'),'/?auth_error=state');assert.equal(fetches,2);
  const ownerHeaders={Cookie:ownerCookie,'X-SolarCDN-Request':'1'};
  r=await request('/api/auth/me',{headers:ownerHeaders});assert.equal((await r.json()).user.isOwner,true);
  assert.equal((await request('/api/admins',{headers:ownerHeaders})).status,200);
  assert.equal((await request('/api/admins/'+admin,{method:'PUT',headers:{Cookie:ownerCookie}})).status,403);
  assert.equal((await request('/api/admins/not-id',{method:'PUT',headers:ownerHeaders})).status,400);
  assert.equal((await request('/api/admins/'+owner,{method:'DELETE',headers:ownerHeaders})).status,409);
  assert.equal((await request('/api/admins/'+admin,{method:'PUT',headers:ownerHeaders})).status,204);
  profileId=admin;r=await callback(await start());assert.equal(r.headers.get('location'),'/');const adminHeaders={Cookie:session(r),'X-SolarCDN-Request':'1'};
  r=await request('/api/auth/me',{headers:adminHeaders});const adminData=await r.json();assert.equal(adminData.user.role,'admin');assert.equal(adminData.user.isOwner,false);
  assert.equal((await request('/api/admins',{headers:adminHeaders})).status,403);
  assert.equal((await request('/api/admins/'+stranger,{method:'PUT',headers:adminHeaders})).status,403);
  const passwordHeaders={Authorization:'Bearer '+jwt.sign({sub:'1'},config.jwtSecret)};
  assert.equal((await request('/api/admins',{headers:passwordHeaders})).status,403);
  // A token cannot claim another user's Discord identity.
  const forged={Authorization:'Bearer '+jwt.sign({sub:'1',discordId:owner},config.jwtSecret)};
  assert.equal((await request('/api/admins',{headers:forged})).status,403);
  assert.equal((await request('/api/admins/'+admin,{method:'DELETE',headers:ownerHeaders})).status,204);
  assert.equal((await request('/api/auth/me',{headers:adminHeaders})).status,403);
  profileId=stranger;r=await callback(await start());assert.equal(r.headers.get('location'),'/?auth_error=access');assert.equal(accounts.has(stranger),false);
  providerFail=true;r=await callback(await start());assert.equal(r.headers.get('location'),'/?auth_error=provider');
 }finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
