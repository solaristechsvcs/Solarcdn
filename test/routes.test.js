import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
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
  for(const url of ['/dashboard.js','/style.css','/health'])assert.equal((await request(url)).status,200);
  assert.equal((await request('/api/assets')).status,401);
  const credentials={method:'POST',headers:{'Content-Type':'application/json','X-SolarCDN-Request':'1'},body:JSON.stringify({email:'admin@example.test',password:'test-password'})};
  assert.equal((await request('/api/auth/login',{...credentials,headers:{'Content-Type':'application/json'}})).status,403);
  assert.equal((await request('/api/auth/login',{...credentials,headers:{...credentials.headers,Origin:'https://evil.test'}})).status,403);
  assert.equal((await request('/api/auth/login',{...credentials,body:JSON.stringify({email:'a',password:'wrong'})})).status,401);
  r=await request('/api/auth/login',credentials);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);const cookie=r.headers.get('set-cookie').split(';')[0];const headers={Cookie:cookie,'X-SolarCDN-Request':'1'};
  assert.equal((await request('/api/auth/me',{headers})).status,200);
  admin=false;assert.equal((await request('/api/assets',{headers})).status,403);admin=true;
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
