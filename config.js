export default {
 host:'0.0.0.0',port:Number(process.env.PORT||3000),
 publicBaseUrl:process.env.PUBLIC_BASE_URL||'http://localhost:3000',
 database:{host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'solarcdn',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'solarcdn'},
 jwtSecret:process.env.JWT_SECRET||'',storageDir:process.env.STORAGE_DIR||'./storage',
 // Keep Discord IDs quoted strings. Alternatively set comma-separated DISCORD_OWNER_IDS.
 discord:{
  clientId:process.env.DISCORD_CLIENT_ID||'',
  clientSecret:process.env.DISCORD_CLIENT_SECRET||'',
  ownerIds:(process.env.DISCORD_OWNER_IDS||'').split(',').map(id=>id.trim()).filter(Boolean)
 },
 maxUploadBytes:26214400,trustProxy:process.env.TRUST_PROXY==='1'?1:false
};
