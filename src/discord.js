import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const discordIdPattern=/^[0-9]{17,20}$/;
export function configureDiscord(app,{config,db,base,secure,wrap,cookie,auth,fetchDiscord=fetch}) {
 const settings=config.discord||{};
 const owners=new Set(settings.ownerIds||[]);
 for(const id of owners) if(typeof id!=='string'||!discordIdPattern.test(id)) throw new Error('Discord owner IDs must be quoted 17-20 digit strings');
 const enabled=Boolean(settings.clientId&&settings.clientSecret);
 const redirectUri=base+'/api/auth/discord/callback';
 const pending=new Map();
 const sweep=setInterval(()=>{for(const [key,value] of pending)if(value.expires<Date.now())pending.delete(key);},60000);sweep.unref();
 const stateCookie=(value,age)=>`solarcdn_oauth=${value}; HttpOnly; SameSite=Lax; Path=/api/auth/discord; Max-Age=${age}${secure?'; Secure':''}`;
 const fail=(res,reason)=>res.redirect('/?auth_error='+reason);
 app.get('/api/auth/providers',(_req,res)=>res.json({discord:enabled}));
 app.get('/api/auth/discord',(_req,res)=>{
  if(!enabled)return res.status(404).json({error:'Discord sign-in is not configured'});
  if(pending.size>=10000)return res.status(429).json({error:'Try again later'});
  const state=crypto.randomBytes(32).toString('hex');const browser=crypto.randomBytes(32).toString('hex');
  pending.set(state,{browser,expires:Date.now()+300000});
  res.set('Set-Cookie',stateCookie(browser,300));
  const query=new URLSearchParams({client_id:settings.clientId,redirect_uri:redirectUri,response_type:'code',scope:'identify',state});
  res.redirect('https://discord.com/oauth2/authorize?'+query);
 });
 app.get('/api/auth/discord/callback',wrap(async(req,res)=>{
  res.set('Set-Cookie',stateCookie('',0));
  if(!enabled)return fail(res,'disabled');
  const state=typeof req.query.state==='string'?req.query.state:'';
  const attempt=pending.get(state);
  const browser=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('solarcdn_oauth='))?.slice(15);
  if(!attempt||attempt.expires<Date.now()||!browser||browser!==attempt.browser)return fail(res,'state');
  pending.delete(state);
  if(req.query.error)return fail(res,'cancelled');
  if(typeof req.query.code!=='string'||req.query.code.length>2048||(req.query.iss&&req.query.iss!=='https://discord.com'))return fail(res,'state');
  let profile;
  try{
   const tokenResponse=await fetchDiscord('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:settings.clientId,client_secret:settings.clientSecret,grant_type:'authorization_code',code:req.query.code,redirect_uri:redirectUri}),signal:AbortSignal.timeout(10000)});
   if(!tokenResponse.ok)throw new Error('exchange');
   const token=await tokenResponse.json();if(typeof token.access_token!=='string')throw new Error('token');
   const response=await fetchDiscord('https://discord.com/api/v10/users/@me',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('profile');profile=await response.json();
   if(typeof profile.id!=='string'||!discordIdPattern.test(profile.id))throw new Error('identity');
  }catch{return fail(res,'provider');}
  const owner=owners.has(profile.id);
  const [[grant]]=await db.execute('SELECT discord_id FROM discord_admins WHERE discord_id=?',[profile.id]);
  if(!owner&&!grant)return fail(res,'access');
  // Discord identities are separate from password accounts: never link by email.
  let [[account]]=await db.execute('SELECT user_id FROM discord_accounts WHERE discord_id=?',[profile.id]);
  if(!account){
   const connection=await db.getConnection();
   try{
    await connection.beginTransaction();
    const [result]=await connection.execute("INSERT INTO users(email,password_hash,role) VALUES(?,?,'user')",['discord-'+profile.id+'@users.invalid',await bcrypt.hash(crypto.randomBytes(48).toString('hex'),12)]);
    await connection.execute('INSERT INTO discord_accounts(discord_id,user_id) VALUES(?,?)',[profile.id,result.insertId]);
    await connection.commit();account={user_id:result.insertId};
   }catch(error){
    await connection.rollback();
    if(error.code!=='ER_DUP_ENTRY')throw error;
    [[account]]=await db.execute('SELECT user_id FROM discord_accounts WHERE discord_id=?',[profile.id]);
    if(!account)throw error;
   }finally{connection.release();}
  }
  const token=jwt.sign({sub:String(account.user_id),discordId:profile.id},config.jwtSecret,{algorithm:'HS256',expiresIn:'2h'});
  res.append('Set-Cookie',cookie(token,7200));res.redirect('/');
 }));
 const ownerOnly=(req,res,next)=>req.user.isOwner?next():res.status(403).json({error:'Only configured Discord owners can manage administrators'});
 app.get('/api/admins',auth,ownerOnly,wrap(async(_req,res)=>{
  const [admins]=await db.execute('SELECT discord_id,created_at FROM discord_admins ORDER BY created_at DESC');
  res.json({owners:[...owners],admins});
 }));
 app.put('/api/admins/:discordId',auth,ownerOnly,wrap(async(req,res)=>{
  const id=req.params.discordId;
  if(!discordIdPattern.test(id))return res.status(400).json({error:'Enter a valid Discord user ID'});
  if(owners.has(id))return res.status(409).json({error:'Owners are managed in config.js'});
  await db.execute('INSERT INTO discord_admins(discord_id,granted_by) VALUES(?,?) ON DUPLICATE KEY UPDATE discord_id=VALUES(discord_id)',[id,req.user.discordId]);
  res.sendStatus(204);
 }));
 app.delete('/api/admins/:discordId',auth,ownerOnly,wrap(async(req,res)=>{
  const id=req.params.discordId;
  if(!discordIdPattern.test(id))return res.status(400).json({error:'Enter a valid Discord user ID'});
  if(owners.has(id))return res.status(409).json({error:'Owners are managed in config.js'});
  await db.execute('DELETE FROM discord_admins WHERE discord_id=?',[id]);res.sendStatus(204);
 }));
 return owners;
}
