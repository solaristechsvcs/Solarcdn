import {configureDiscord} from './discord.js';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function detectedType(b) {
 if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
 if(b[0]===255&&b[1]===216&&b[2]===255) return 'image/jpeg';
 if(['GIF87a','GIF89a'].includes(b.subarray(0,6).toString())) return 'image/gif';
 if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP') return 'image/webp';
 if(b.subarray(0,5).toString()==='%PDF-') return 'application/pdf';
 return null;
}
export async function createApp(config, db, options={}) {
 if(!config.jwtSecret||config.jwtSecret.length<32||config.jwtSecret.includes('CHANGE_ME')) throw new Error('Set JWT_SECRET to a random secret of at least 32 characters');
 const base=new URL(config.publicBaseUrl).origin;
 const secure=new URL(base).protocol==='https:';
 const root=path.resolve(config.storageDir);
 await fs.mkdir(root,{recursive:true});
 const app=express();
 app.disable('x-powered-by');
 if(config.trustProxy) app.set('trust proxy',config.trustProxy);
 app.use(helmet());
 app.use(express.json({limit:'32kb'}));
 app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const cookie=(token,age)=>`solarcdn_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${age}${secure?'; Secure':''}`;
 const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
 const attempts=new Map();
 const sweep=setInterval(()=>{for(const [k,v] of attempts) if(v.until<Date.now()) attempts.delete(k);},60000); sweep.unref();
 const dummy=await bcrypt.hash(crypto.randomBytes(32).toString('hex'),10);
 app.use('/api',(req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!req.headers.authorization) {
   if(req.get('X-SolarCDN-Request')!=='1'||(req.get('origin')&&req.get('origin')!==base)) return res.status(403).json({error:'Request origin rejected'});
  }
  next();
 });
 const auth=wrap(async(req,res,next)=>{
  const bearer=req.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const token=bearer||req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('solarcdn_session='))?.slice(17);
  let claims;
  try {claims=jwt.verify(token,config.jwtSecret,{algorithms:['HS256']});} catch {return res.status(401).json({error:'Please sign in'});}
  const [[user]]=await db.execute('SELECT id,email,role FROM users WHERE id=?',[claims.sub]);
  if(!user)return res.status(403).json({error:'Administrator access required'});
  user.isOwner=false;
  if(claims.discordId){
   const [[account]]=await db.execute('SELECT user_id FROM discord_accounts WHERE discord_id=?',[claims.discordId]);
   if(!account||String(account.user_id)!==String(user.id))return res.status(403).json({error:'Administrator access required'});
   const [[grant]]=await db.execute('SELECT discord_id FROM discord_admins WHERE discord_id=?',[claims.discordId]);
   user.isOwner=owners.has(claims.discordId);
   if(!user.isOwner&&!grant)return res.status(403).json({error:'Administrator access required'});
   user.discordId=claims.discordId;user.role=user.isOwner?'owner':'admin';
  }else if(user.role!=='admin')return res.status(403).json({error:'Administrator access required'});
  req.user=user; next();
 });
 const owners=configureDiscord(app,{config,db,base,secure,wrap,cookie,auth,fetchDiscord:options.fetchDiscord});
 app.get('/health',(_req,res)=>res.json({ok:true,service:'solarcdn'}));
 app.post('/api/auth/login',wrap(async(req,res)=>{
  const key=req.ip; const now=Date.now(); let limit=attempts.get(key);
  if(!limit||limit.until<now){limit={count:0,until:now+900000};if(attempts.size>10000) return res.status(429).json({error:'Try again later'});attempts.set(key,limit);}
  if(++limit.count>10) return res.status(429).json({error:'Too many login attempts. Try again in 15 minutes.'});
  const {email,password}=req.body||{};
  if(typeof email!=='string'||email.length>255||typeof password!=='string'||Buffer.byteLength(password)>72) return res.status(400).json({error:'Invalid credentials'});
  const [[user]]=await db.execute('SELECT id,email,password_hash,role FROM users WHERE email=?',[email]);
  const valid=await bcrypt.compare(password,user?.password_hash||dummy);
  if(!valid||user?.role!=='admin') return res.status(401).json({error:'Invalid credentials'});
  const token=jwt.sign({sub:String(user.id)},config.jwtSecret,{algorithm:'HS256',expiresIn:'2h'});
  res.set('Set-Cookie',cookie(token,7200));res.json({user:{id:user.id,email:user.email,role:user.role}});
 }));
 app.post('/api/auth/logout',(_req,res)=>{res.set('Set-Cookie',cookie('',0));res.sendStatus(204);});
 app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user,maxUploadBytes:config.maxUploadBytes}));
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:config.maxUploadBytes,files:1,fields:0}});
 app.post('/api/assets',auth,upload.single('file'),wrap(async(req,res)=>{
  if(!req.file) return res.status(400).json({error:'Choose a file'});
  const mime=detectedType(req.file.buffer);
  if(!mime||mime!==req.file.mimetype) return res.status(415).json({error:'Supported files: PNG, JPEG, GIF, WebP and PDF. File contents must match the type.'});
  const id=crypto.randomUUID();const sha=crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  await fs.writeFile(path.join(root,id),req.file.buffer,{flag:'wx'});
  try {await db.execute('INSERT INTO assets(id,owner_id,original_name,mime_type,byte_size,sha256) VALUES(?,?,?,?,?,?)',[id,req.user.id,req.file.originalname.slice(0,255),mime,req.file.size,sha]);}
  catch(e){await fs.rm(path.join(root,id),{force:true});throw e;}
  res.status(201).json({id,url:base+'/assets/'+id});
 }));
 app.get('/api/assets',auth,wrap(async(req,res)=>{
  const page=Math.max(1,Math.min(1000000,Number.parseInt(req.query.page,10)||1));
  const [assets]=await db.execute(`SELECT id,original_name,mime_type,byte_size,created_at FROM assets WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ${(page-1)*50}`,[req.user.id]);
  const [[usage]]=await db.execute('SELECT COUNT(*) AS count,COALESCE(SUM(byte_size),0) AS bytes FROM assets WHERE owner_id=?',[req.user.id]);
  res.json({assets:assets.map(a=>({...a,url:base+'/assets/'+a.id})),usage,page,pageSize:50});
 }));
 app.get('/assets/:id',wrap(async(req,res,next)=>{
  if(!uuid.test(req.params.id)) return res.sendStatus(404);
  const [[asset]]=await db.execute('SELECT mime_type FROM assets WHERE id=?',[req.params.id]);
  if(!asset) return res.sendStatus(404);
  res.set({'Content-Type':asset.mime_type,'Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'public,max-age=3600'});
  res.sendFile(req.params.id,{root,dotfiles:'deny'},err=>{if(err) next(err);});
 }));
 app.delete('/api/assets/:id',auth,wrap(async(req,res)=>{
  if(!uuid.test(req.params.id)) return res.status(404).json({error:'File not found'});
  const [result]=await db.execute('DELETE FROM assets WHERE id=? AND owner_id=?',[req.params.id,req.user.id]);
  if(!result.affectedRows) return res.status(404).json({error:'File not found'});
  await fs.rm(path.join(root,req.params.id),{force:true});res.sendStatus(204);
 }));
 app.use(express.static(fileURLToPath(new URL('../public/',import.meta.url)),{index:'index.html'}));
 app.use((err,req,res,next)=>{
  if(res.headersSent) return next(err);
  const status=err instanceof multer.MulterError?400:err.status===400?400:err.status===404?404:500;
  console.error(err.code||err.name);
  res.status(status).json({error:status===400?'Invalid request or upload exceeds the allowed size':status===404?'File not found':'Internal server error'});
 });
 return app;
}
