import mysql from 'mysql2/promise';
import config from '../config.js';
import {createApp} from './app.js';
const db=mysql.createPool({...config.database,waitForConnections:true,connectionLimit:10});
const app=await createApp(config,db);
app.listen(config.port,config.host,()=>console.log(`SolarCDN listening on ${config.host}:${config.port}`));
