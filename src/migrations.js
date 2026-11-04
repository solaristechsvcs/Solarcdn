export async function migrateRoles(db) {
 const [[column]]=await db.execute("SELECT COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='role'");
 if(!column)throw new Error('Import schema.sql before running migrations');
 const type=column.COLUMN_TYPE;
 // Preserve every existing ENUM ordinal; append staff rather than reorder values.
 if(!/^enum\('(admin|user|staff)'(?:,'(admin|user|staff)')*\)$/.test(type))throw new Error('Unexpected users.role type; review schema manually');
 const values=[...type.matchAll(/'([^']+)'/g)].map(m=>m[1]);
 if(!values.includes('admin')||!values.includes('user'))throw new Error('Expected admin and user roles');
 const [[invalid]]=await db.execute("SELECT COUNT(*) AS count FROM users WHERE role IS NULL OR role='' OR role NOT IN ('admin','user','staff')");
 if(Number(invalid.count))throw new Error('Invalid existing roles; repair before migrating');
 if(!values.includes('staff'))values.push('staff');
 if(!type.includes("'staff'")||column.IS_NULLABLE!=='NO'||column.COLUMN_DEFAULT!=='user'){
  await db.query(`ALTER TABLE users MODIFY COLUMN role ENUM(${values.map(v=>"'"+v+"'").join(',')}) NOT NULL DEFAULT 'user'`);
 }
}
