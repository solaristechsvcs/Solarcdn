import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import {createInterface} from 'node:readline/promises';
import config from '../config.js';
const email=process.argv[2];
if(!email||!email.includes('@'))throw new Error('Usage: npm run create-admin -- admin@example.com (pipe a password on stdin)');
// Read from stdin, never from command arguments or a committed file.
const reader=createInterface({input:process.stdin,terminal:false});
const {value:password}=await reader[Symbol.asyncIterator]().next();reader.close();
if(!password||password.length<12||Buffer.byteLength(password)>72)throw new Error('Password must be 12+ characters and at most 72 UTF-8 bytes');
const db=await mysql.createConnection(config.database);
try{await db.execute("INSERT INTO users(email,password_hash,role) VALUES(?,?,'admin')",[email,await bcrypt.hash(password,12)]);console.log('Administrator created.');}finally{await db.end();}
