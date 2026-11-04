import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {createApp} from '../src/app.js';
import {migrateRoles} from '../src/migrations.js';

test('registration, current-role authorization and serialized administrator protection',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'solarcdn-accounts-'));
 const users=new Map([[1,{id:1,email:'admin@test.example',role:'admin'}],[2,{id:2,email:'user@test.example',role:'user'}],[3,{id:3,email:'other@test.example',role:'admin'}],[4,{id:4,email:'discord@users.invalid',role:'user'}]]);
 let pending=Promise.resolve(),rollbackCount=0;
 const execute=async(sql,p=[])=>{
  if(sql.startsWith('INSERT INTO users')){
   assert.match(sql,/'user'/);assert.equal(p.length,2);
   if([...users.values()].some(u=>u.email===p[0]))throw Object.assign(new Error(),{code:'ER_DUP_ENTRY'});
   const id=users.size+1;users.set(id,{id,email:p[0],password_hash:p[1],role:'user'});return [{insertId:id}];
  }
  if(sql.includes('WHERE email='))return [[...users.values()].filter(u=>u.email===p[0]).map(u=>({...u}))];
  if(sql.includes('FROM users WHERE id='))return [[...users.values()].filter(u=>String(u.id)===String(p[0])).map(u=>({...u}))];
  if(sql==='SELECT id,role FROM users ORDER BY id FOR UPDATE')return [[...users.values()].map(u=>({...u}))];
  if(sql.includes('FROM discord_accounts WHERE user_id='))return [p[0]==='4'?[{discord_id:'111111111111111111'}]:[]];
  if(sql.startsWith('UPDATE users')){users.get(Number(p[1])).role=p[0];return [{affectedRows:1}];}
  if(sql.includes('FROM users u'))return [[...users.values()]];
  throw new Error('Unexpected SQL: '+sql);
 };
 const db={execute,async getConnection(){let unlock;return {execute,async beginTransaction(){const previous=pending;pending=new Promise(r=>unlock=r);await previous;},async commit(){unlock();},async rollback(){rollbackCount++;unlock();},release(){}};}};
 const secret='t'.repeat(48);const app=await createApp({jwtSecret:secret,publicBaseUrl:'http://localhost',storageDir:root,maxUploadBytes:1000},db);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=(url,{id,body,method='GET',...options}={})=>fetch('http://127.0.0.1:'+server.address().port+url,{method,headers:{'Content-Type':'application/json','X-SolarCDN-Request':'1',...(id?{Authorization:'Bearer '+jwt.sign({sub:String(id),role:'admin'},secret)}:{})},...(body?{body:JSON.stringify(body)}:{}),...options});
 const change=(actor,target,role)=>request('/api/users/'+target+'/role',{id:actor,method:'PATCH',body:{role}});
 try{
  assert.equal((await request('/api/users')).status,401);
  for(const role of ['user','staff']){users.get(2).role=role;assert.equal((await request('/api/users',{id:2})).status,403);assert.equal((await change(2,2,'admin')).status,403);assert.equal((await request('/api/auth/me',{id:2})).status,200);}
  assert.equal((await change(1,2,'owner')).status,400);
  assert.equal((await change(1,'1 OR 1=1','staff')).status,400);
  assert.equal((await change(1,99,'staff')).status,404);
  assert.equal((await change(1,4,'admin')).status,409);
  assert.equal((await change(1,1,'user')).status,409);
  assert.equal((await change(1,2,'staff')).status,204);assert.equal(users.get(2).role,'staff');
  assert.equal((await change(1,2,'admin')).status,204);assert.equal(users.get(2).role,'admin');
  assert.equal((await change(1,2,'user')).status,204);
  const results=await Promise.all([change(1,3,'user'),change(3,1,'user')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[204,403]);assert.equal([...users.values()].filter(u=>u.role==='admin').length,1);
  assert.equal((await change(1,1,'staff')).status,409);
  // Registration rejects role injection and malformed/overlong credentials.
  const signup=body=>request('/api/auth/register',{method:'POST',body});
  assert.equal((await signup({email:'ok@test.example',password:'long-enough-password',role:'admin'})).status,400);
  assert.equal((await signup({email:'bad',password:'short'})).status,400);
  assert.equal((await signup({email:'ok@test.example',password:'😀'.repeat(20)})).status,400);
  const input={email:'  New@Test.Example  ',password:'secure-test-password'};
  let r=await signup(input);assert.equal(r.status,202);const response=await r.json();
  const user=[...users.values()].find(u=>u.email==='new@test.example');assert.equal(user.role,'user');assert.notEqual(user.password_hash,input.password);assert.equal(await bcrypt.compare(input.password,user.password_hash),true);
  r=await signup(input);assert.equal(r.status,202);assert.deepEqual(await r.json(),response);
  assert.equal((await signup(input)).status,429);
  r=await request('/api/auth/login',{method:'POST',body:{email:'NEW@Test.Example',password:input.password}});assert.equal(r.status,200);assert.equal((await r.json()).user.role,'user');
  assert.ok(rollbackCount>=4);
 }finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});

test('role migration preserves ENUM ordinals and is rerunnable',async()=>{
 let column={COLUMN_TYPE:"enum('admin','user')",IS_NULLABLE:'NO',COLUMN_DEFAULT:'user'},invalid=0;const alters=[];
 const db={async execute(sql){return [[sql.includes('information_schema')?column:{count:invalid}]];},async query(sql){alters.push(sql);column={...column,COLUMN_TYPE:"enum('admin','user','staff')"};}};
 await migrateRoles(db);assert.match(alters[0],/ENUM\('admin','user','staff'\) NOT NULL DEFAULT 'user'/);
 await migrateRoles(db);assert.equal(alters.length,1);
 column={...column,COLUMN_TYPE:"enum('user','admin')"};await migrateRoles(db);assert.match(alters[1],/ENUM\('user','admin','staff'\)/);
 column={...column,COLUMN_TYPE:"enum('admin','user','unknown')"};await assert.rejects(migrateRoles(db),/Unexpected/);
 column={...column,COLUMN_TYPE:"enum('admin','user')"};invalid=1;await assert.rejects(migrateRoles(db),/Invalid existing roles/);
});
