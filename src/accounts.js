import bcrypt from 'bcryptjs';

export function credentials(body) {
 const {email,password}=body||{};
 if(typeof email!=='string'||typeof password!=='string')return null;
 const normalized=email.trim().toLowerCase();
 if(normalized.length>255||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)||normalized.endsWith('.invalid')||password.length<12||Buffer.byteLength(password)>72)return null;
 return {email:normalized,password};
}

export function configureAccounts(app,{db,auth,wrap,owners}) {
 const attempts=new Map();
 const sweep=setInterval(()=>{for(const [k,v] of attempts)if(v.until<Date.now())attempts.delete(k);},60000);sweep.unref();
 app.post('/api/auth/register',wrap(async(req,res)=>{
  const now=Date.now();let limit=attempts.get(req.ip);
  if(!limit||limit.until<=now){
   if(attempts.size>=10000)return res.status(429).json({error:'Try again later'});
   attempts.set(req.ip,limit={count:0,until:now+900000});
  }
  if(++limit.count>5)return res.status(429).json({error:'Too many signup attempts. Try again in 15 minutes.'});
  const input=credentials(req.body);
  if(!input||Object.keys(req.body).some(k=>!['email','password'].includes(k)))return res.status(400).json({error:'Use a valid email and a password of at least 12 characters and at most 72 UTF-8 bytes. Only email and password are accepted.'});
  const hash=await bcrypt.hash(input.password,12);
  try{await db.execute("INSERT INTO users(email,password_hash,role) VALUES(?,?,'user')",[input.email,hash]);}
  catch(error){if(error.code!=='ER_DUP_ENTRY')throw error;}
  // Identical response for an existing address; do not disclose membership.
  res.status(202).json({message:'If this address is available, your account is ready. Sign in with your credentials.'});
 }));
 const admin=(req,res,next)=>['admin','owner'].includes(req.user.role)?next():res.status(403).json({error:'Administrator access required'});
 app.get('/api/users',auth,admin,wrap(async(req,res)=>{
  const page=Math.max(1,Math.min(1000000,Number.parseInt(req.query.page,10)||1));
  const [users]=await db.execute(`SELECT u.id,u.email,u.role,EXISTS(SELECT 1 FROM discord_accounts d WHERE d.user_id=u.id) AS discord_managed FROM users u ORDER BY u.id LIMIT 50 OFFSET ${(page-1)*50}`);
  res.json({users,page,pageSize:50});
 }));
 app.patch('/api/users/:id/role',auth,admin,wrap(async(req,res)=>{
  const role=req.body?.role,id=req.params.id;
  if(!/^[1-9][0-9]{0,19}$/.test(id)||!['user','staff','admin'].includes(role)||Object.keys(req.body).some(k=>k!=='role'))return res.status(400).json({error:'Invalid user or role'});
  const connection=await db.getConnection();
  try{
   await connection.beginTransaction();
   // A common ordered lock serializes role changes, including actor revocation
   // and concurrent attempts to remove the final administrator.
   const [users]=await connection.execute('SELECT id,role FROM users ORDER BY id FOR UPDATE');
   const actor=users.find(u=>String(u.id)===String(req.user.id));
   let authorized=actor?.role==='admin';
   if(req.user.discordId){
    const [[grant]]=await connection.execute('SELECT discord_id FROM discord_admins WHERE discord_id=? FOR UPDATE',[req.user.discordId]);
    authorized=Boolean(actor&&(owners.has(req.user.discordId)||grant));
   }
   if(!authorized){await connection.rollback();return res.status(403).json({error:'Administrator access required'});}
   const target=users.find(u=>String(u.id)===id);
   if(!target){await connection.rollback();return res.status(404).json({error:'User not found'});}
   const [[discord]]=await connection.execute('SELECT discord_id FROM discord_accounts WHERE user_id=?',[id]);
   if(discord){await connection.rollback();return res.status(409).json({error:'Manage Discord access through owner controls'});}
   if(target.role==='admin'&&role!=='admin'){
    if(users.filter(u=>u.role==='admin').length<=1){await connection.rollback();return res.status(409).json({error:'Cannot remove the last database administrator'});}
    if(String(req.user.id)===id){await connection.rollback();return res.status(409).json({error:'You cannot demote yourself'});}
   }
   await connection.execute('UPDATE users SET role=? WHERE id=?',[role,id]);
   await connection.commit();res.sendStatus(204);
  }catch(error){await connection.rollback();throw error;}finally{connection.release();}
 }));
}
