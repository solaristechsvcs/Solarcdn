import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import config from '../config.js';
const db=await mysql.createConnection(config.database);
try{
 const sql=await fs.readFile(new URL('../discord-schema.sql',import.meta.url),'utf8');
 for(const statement of sql.split(';').filter(s=>s.trim()))await db.query(statement);
 console.log('Discord tables are ready. Existing accounts and files are unchanged.');
}finally{await db.end();}
