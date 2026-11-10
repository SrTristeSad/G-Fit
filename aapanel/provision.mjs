// Executado somente pelo instalador local do aaPanel, nunca por uma rota pública.
import {randomUUID} from 'node:crypto';
import {db,initDatabase} from '../api/src/db.js';
import {hashPassword,verifyPassword} from '../api/src/security.js';

const email=process.env.GFIT_SETUP_ADMIN_EMAIL;
const password=process.env.GFIT_SETUP_ADMIN_PASSWORD;
let client;
try{
  await db.query('SELECT 1');
  await initDatabase();
  client=await db.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(20261109)');
  const admins=await client.query('SELECT email,password_hash FROM teachers WHERE is_admin LIMIT 1');
  if(admins.rows.length){
    const row=admins.rows[0];
    if(row.email!==email||!await verifyPassword(password,row.password_hash)){
      throw new Error('Já existe administrador. Utilize o e-mail e senha existentes para retomar a instalação.');
    }
  }else{
    await client.query(
      'INSERT INTO teachers (id,full_name,email,password_hash,is_admin,max_students) ' +
      'VALUES ($1,$2,$3,$4,TRUE,0)',
      [randomUUID(),'Administrador G Fit',email,await hashPassword(password)],
    );
  }
  await client.query('COMMIT');
  process.stdout.write('Banco e administrador verificados.\n');
}catch(error){
  if(client)await client.query('ROLLBACK').catch(()=>{});
  console.error('Provisionamento não concluído: '+error.message);
  process.exitCode=1;
}finally{
  if(client)client.release();
  await db.end();
}
