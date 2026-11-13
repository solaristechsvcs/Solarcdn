import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {createApp} from '../src/app.js';
test('dashboard and authenticated file lifecycle',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'solarcdn-'));
 const hash=await bcrypt.hash('test-password',10);const assets=new Map();let admin=true;
 const db={async execute(sql,p){
  if(sql.includes('WHERE email='))return [[{id:1,email:p[0],password_hash:hash,role:admin?'admin':'user'}]];
  if(sql.includes('FROM users'))return [[{id:1,email:'admin@example.test',role:admin?'admin':'user'}]];
  if(sql.startsWith('INSERT')){assets.set(p[0],{id:p[0],owner_id:p[1],original_name:p[2],mime_type:p[3],byte_size:p[4],created_at:new Date()});return [{}];}
  if(sql.includes('COUNT(*)'))return [[{count:assets.size,bytes:[...assets.values()].reduce((n,a)=>n+a.byte_size,0)}]];
  if(sql.startsWith('DELETE')){const a=assets.get(p[0]);const ok=a&&a.owner_id===p[1];if(ok)assets.delete(p[0]);return [{affectedRows:ok?1:0}];}
  if(sql.includes('SELECT mime_type'))return [[...(assets.has(p[0])?[assets.get(p[0])]:[])]];
  return [[...assets.values()]];
 }};
 const app=await createApp({jwtSecret:'x'.repeat(48),publicBaseUrl:'http://localhost',storageDir:root,maxUploadBytes:1000},db);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(url,options)=>fetch(base+url,options);
 try{
  let r=await request('/');assert.equal(r.status,200);assert.match(await r.text(),/File manager/);
  for(const url of ['/login','/register','/dashboard','/staff','/admin']){const page=await request(url);assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');const html=await page.text();assert.ok(html.includes('href="/login"'));assert.match(html,/id="register-form"/);}
  for(const url of ['/dashboard.js','/style.css','/health'])assert.equal((await request(url)).status,200);
  assert.equal((await request('/api/assets')).status,401);
  const credentials={method:'POST',headers:{'Content-Type':'application/json','X-SolarCDN-Request':'1'},body:JSON.stringify({email:'admin@example.test',password:'test-password'})};
  assert.equal((await request('/api/auth/login',{...credentials,headers:{'Content-Type':'application/json'}})).status,403);
  assert.equal((await request('/api/auth/login',{...credentials,headers:{...credentials.headers,Origin:'https://evil.test'}})).status,403);
  assert.equal((await request('/api/auth/login',{...credentials,body:JSON.stringify({email:'a',password:'wrong'})})).status,401);
  r=await request('/api/auth/login',credentials);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);const cookie=r.headers.get('set-cookie').split(';')[0];const headers={Cookie:cookie,'X-SolarCDN-Request':'1'};
  assert.equal((await request('/api/auth/me',{headers})).status,200);
  admin=false;assert.equal((await request('/api/assets',{headers})).status,200);assert.equal((await request('/api/users',{headers})).status,403);admin=true;
  const bad=new FormData();bad.append('file',new Blob(['<script>bad</script>'],{type:'image/png'}),'bad.png');assert.equal((await request('/api/assets',{method:'POST',headers,body:bad})).status,415);
  const large=new FormData();large.append('file',new Blob([Buffer.alloc(1001)],{type:'image/png'}),'large.png');assert.equal((await request('/api/assets',{method:'POST',headers,body:large})).status,400);
  const bytes=Buffer.from([137,80,78,71,13,10,26,10]);const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'example.png');
  r=await request('/api/assets',{method:'POST',headers,body:form});assert.equal(r.status,201);const asset=await r.json();
  r=await request('/api/assets',{headers});const list=await r.json();assert.equal(list.usage.bytes,8);assert.equal(list.assets[0].url,asset.url);
  r=await request('/assets/'+asset.id);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
  assert.equal((await request('/api/assets/not-a-uuid',{method:'DELETE',headers})).status,404);
  assert.equal((await request('/api/assets/'+asset.id,{method:'DELETE',headers})).status,204);assert.equal((await request('/assets/'+asset.id)).status,404);assert.deepEqual(await fs.readdir(root),[]);
  r=await request('/api/auth/logout',{method:'POST',headers});assert.equal(r.status,204);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
 }finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});

test('HTTPS login cookies, generic errors, expiry, CSRF and throttling',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'solarcdn-login-'));
 const secret='s'.repeat(48),password='staff-test-password';
 const user={id:2,email:'staff@example.test',role:'staff',password_hash:await bcrypt.hash(password,10)};
 const db={async execute(sql,p){return [[...(sql.includes('WHERE email=')?p[0]===user.email?[user]:[]:[user])]];}};
 const app=await createApp({jwtSecret:secret,publicBaseUrl:'https://cdn.example.test',storageDir:root,maxUploadBytes:1000},db);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const login=(body,extra={})=>fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-SolarCDN-Request':'1',...extra},body:JSON.stringify(body)});
 try{
  for(const email of ['unknown@example.test',user.email]){
   const r=await login({email,password:'wrong'});assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'Invalid credentials'});
  }
  assert.equal((await login({email:user.email,password:123})).status,400);
  assert.equal((await login({email:user.email,password:'😀'.repeat(20)})).status,400);
  const r=await login({email:' STAFF@example.test ',password});assert.equal(r.status,200);
  const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Strict; Path=\/api; Max-Age=7200; Secure/);
  const data=await r.json();assert.equal(data.user.role,'staff');assert.equal(data.token,undefined);assert.equal(data.user.password_hash,undefined);
  const token=cookie.split(';')[0].slice('solarcdn_session='.length);const claims=jwt.verify(token,secret);assert.equal(claims.exp-claims.iat,7200);
  const headers={Cookie:cookie.split(';')[0]};
  assert.equal((await fetch(base+'/api/auth/logout',{method:'POST',headers})).status,403);
  const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{...headers,'X-SolarCDN-Request':'1'}});
  assert.equal(logout.status,204);assert.match(logout.headers.get('set-cookie'),/Max-Age=0; Secure/);
  for(let i=0;i<5;i++)await login({email:user.email,password:'wrong'});
  assert.equal((await login({email:user.email,password})).status,429);
 }finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
