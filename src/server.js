import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';

if (!config.jwtSecret || config.jwtSecret.length < 32 || config.jwtSecret.includes('CHANGE_ME')) throw new Error('Set a strong jwtSecret in config.js');
const db = mysql.createPool({...config.database,waitForConnections:true,connectionLimit:10});
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({limit:'32kb'}));
const root = path.resolve(config.storageDir);
await fs.mkdir(root,{recursive:true});
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:config.maxUploadBytes,files:1}});
const allowed = new Set(['image/png','image/jpeg','image/gif','image/webp','application/pdf']);
function auth(req,res,next){
 const token = (req.headers.authorization || '').match(/^Bearer (.+)$/)?.[1];
 if(!token) return res.status(401).json({error:'Authentication required'});
 try {req.user=jwt.verify(token,config.jwtSecret,{algorithms:['HS256']});next();}
 catch {res.status(401).json({error:'Invalid token'});}
}
app.get('/health',(_req,res)=>res.json({ok:true,service:'solarcdn'}));
app.post('/api/auth/login',async(req,res,next)=>{
 try {
  const {email,password}=req.body;
  if(typeof email!=='string'||typeof password!=='string') return res.status(400).json({error:'Invalid credentials'});
  const [[user]]=await db.execute('SELECT id,email,password_hash,role FROM users WHERE email=?',[email]);
  if(!user || !await bcrypt.compare(password,user.password_hash)) return res.status(401).json({error:'Invalid credentials'});
  const token=jwt.sign({sub:String(user.id),role:user.role},config.jwtSecret,{algorithm:'HS256',expiresIn:'12h'});
  res.json({token,user:{id:user.id,email:user.email,role:user.role}});
 }catch(e){next(e);}
});
app.post('/api/assets',auth,upload.single('file'),async(req,res,next)=>{
 let id;
 try {
  if(!req.file)return res.status(400).json({error:'File required'});
  if(!allowed.has(req.file.mimetype))return res.status(415).json({error:'Unsupported type'});
  id=crypto.randomUUID();
  const sha=crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  await fs.writeFile(path.join(root,id),req.file.buffer,{flag:'wx'});
  await db.execute('INSERT INTO assets(id,owner_id,original_name,mime_type,byte_size,sha256) VALUES(?,?,?,?,?,?)',[id,req.user.sub,req.file.originalname.slice(0,255),req.file.mimetype,req.file.size,sha]);
  res.status(201).json({id,url:config.publicBaseUrl.replace(/\/$/,'')+'/assets/'+id,sha256:sha});
 }catch(e){if(id)await fs.rm(path.join(root,id),{force:true}).catch(()=>{});next(e);}
});
app.get('/api/assets',auth,async(req,res,next)=>{
 try{const [assets]=await db.execute('SELECT id,original_name,mime_type,byte_size,created_at FROM assets WHERE owner_id=? ORDER BY created_at DESC LIMIT 100',[req.user.sub]);res.json({assets});}
 catch(e){next(e);}
});
app.get('/assets/:id',async(req,res,next)=>{
 try{
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(req.params.id))return res.sendStatus(404);
  const [[asset]]=await db.execute('SELECT mime_type FROM assets WHERE id=?',[req.params.id]);
  if(!asset)return res.sendStatus(404);
  res.set('Content-Type',asset.mime_type);
  res.set('X-Content-Type-Options','nosniff');
  res.set('Cache-Control','public,max-age=3600');
  res.sendFile(req.params.id,{root,dotfiles:'deny'},e=>{if(e&&!res.headersSent)next(e);});
 }catch(e){next(e);}
});
app.delete('/api/assets/:id',auth,async(req,res,next)=>{
 try{
  const [result]=await db.execute('DELETE FROM assets WHERE id=? AND owner_id=?',[req.params.id,req.user.sub]);
  if(!result.affectedRows)return res.sendStatus(404);
  await fs.rm(path.join(root,req.params.id),{force:true});
  res.sendStatus(204);
 }catch(e){next(e);}
});
app.use((err,req,res,_next)=>{console.error(err);res.status(err instanceof multer.MulterError?400:500).json({error:err instanceof multer.MulterError?err.message:'Internal server error'});});
app.listen(config.port,config.host,()=>console.log('SolarCDN listening on '+config.host+':'+config.port));
