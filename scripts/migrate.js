import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import config from '../config.js';
import {migrateRoles} from '../src/migrations.js';
const db=await mysql.createConnection(config.database);
try{
 const [[lock]]=await db.execute("SELECT GET_LOCK('solarcdn_migrate',30) AS acquired");
 if(Number(lock.acquired)!==1)throw new Error('Another migration is running');
 await migrateRoles(db);
 const sql=await fs.readFile(new URL('../discord-schema.sql',import.meta.url),'utf8');
 for(const statement of sql.split(';').filter(s=>s.trim()))await db.query(statement);
 console.log('User roles and Discord tables are ready. Existing accounts and files are preserved.');
}finally{await db.execute("SELECT RELEASE_LOCK('solarcdn_migrate')");await db.end();}
