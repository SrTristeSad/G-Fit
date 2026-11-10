// Runs in GitHub Actions with a disposable PostgreSQL container on 127.0.0.1:15432.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {setTimeout as pause} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {collectReleaseFiles,makeReleaseZip} from '../zip-release.mjs';

const base='http://127.0.0.1:3339';
const privateDir=await fs.mkdtemp(path.join(os.tmpdir(),'gfit-aapanel-e2e-'));
const launcher=spawn(process.execPath,['aapanel/launcher.mjs'],{
  cwd:process.cwd(),
  env:{...process.env,GFIT_PORT:'3339',GFIT_PRIVATE_DIR:privateDir},
  stdio:['ignore','pipe','pipe'],
});
let output='';
launcher.stdout.on('data',chunk=>{output+=String(chunk);});
launcher.stderr.on('data',chunk=>{output+=String(chunk);});
let restarted=null;
let finalRun=null;
const stop=()=>{
  launcher.kill('SIGTERM');
  restarted?.kill('SIGTERM');
  finalRun?.kill('SIGTERM');
};
try{
  let code=null;
  for(let i=0;i<100;i++){
    code=output.match(/CÓDIGO DE INSTALAÇÃO: (\d{8})/)?.[1]||null;
    if(code)break;
    if(launcher.exitCode!==null)throw new Error('Launcher exited unexpectedly');
    await pause(100);
  }
  assert.ok(code,'installation code should be logged only in aaPanel process log');
  async function request(route,body,headers={}) {
    const r=await fetch(base+route,{
      method:'POST',
      headers:{'Content-Type':'application/json',...headers},
      body:JSON.stringify(body),
    });
    return {status:r.status,data:await r.json()};
  }
  const homepage=await fetch(base+'/');
  assert.equal(homepage.status,200);
  assert.ok((await homepage.text()).includes('G-Fit | Instalação aaPanel'));
  assert.equal((await request('/setup/status',{code:'0000000X'})).status,403);
  // Cross-origin setup requests are rejected even with the correct code.
  assert.equal((await request('/setup/status',{code},{Origin:'http://example.test'})).status,403);
  assert.equal((await request('/setup/status',{code})).data.installed,false);
  const start=await request('/setup/install',{
    code,dbHost:'127.0.0.1',dbPort:15432,dbName:'gfit_install',
    dbUser:'gfit_install',dbPassword:'ci_aapanel_database_password',
    adminEmail:'admin-install@example.com',
    adminPassword:'ci-admin-initial-password',
    adminConfirm:'ci-admin-initial-password',
  });
  assert.equal(start.status,202,JSON.stringify(start.data));
  let installed=false;
  let finalPhase='';
  for(let i=0;i<180;i++){
    await pause(1500);
    const status=await request('/setup/status',{code});
    if(status.status===200){
      if(status.data.error)throw new Error('Installer failed: '+status.data.error);
      finalPhase=status.data.phase;
      if(status.data.installed) {installed=true;break;}
    }else{
      const health=await fetch(base+'/api/health').catch(()=>null);
      if(health?.ok) {installed=true;break;}
    }
    if(launcher.exitCode!==null)throw new Error('Installer exited: '+output.slice(-3000));
  }
  assert.equal(installed,true,'Installer did not complete. Phase: '+finalPhase+' / '+output.slice(-2500));
  const response=await fetch(base+'/api/health');
  assert.equal(response.status,200);
  assert.equal((await response.json()).status,'ok');
  const app=await fetch(base+'/');
  assert.equal(app.status,200);
  const html=await app.text();
  assert.ok(html.includes('id="root"'),'must serve built React app');
  assert.ok(!html.includes('CÓDIGO DE INSTALAÇÃO'));
  assert.equal((await fetch(base+'/setup')).status,404);
  assert.equal((await request('/setup/install',{code})).status,404);
  const login=await fetch(base+'/api/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:'admin-install@example.com',password:'ci-admin-initial-password'}),
  });
  assert.equal(login.status,200);
  const me=await login.json();
  assert.equal(me.teacher.isAdmin,true);
  assert.ok(login.headers.get('set-cookie')?.includes('Secure'));

  const config=await fs.readFile(path.join(privateDir,'instance.env'),'utf8');
  assert.ok(config.includes('BIND_HOST="127.0.0.1"'));
  assert.ok(config.includes('COOKIE_SECURE="true"'));
  assert.ok(!config.includes('ci-admin-initial-password'));
  assert.equal((await fs.stat(path.join(privateDir,'instance.env'))).mode&0o077,0);
  assert.equal((await fs.stat(privateDir)).mode&0o077,0);
  assert.equal(await fs.stat('.aapanel.env').then(()=>true,()=>false),false);
  console.log('aaPanel: instalação inicial, PostgreSQL, React, API e login OK');
  // aaPanel restarts the launcher after updates; credentials must load from the
  // private config without revealing the setup wizard or creating new accounts.
  launcher.kill('SIGTERM');
  for(let i=0;i<60&&launcher.exitCode===null;i++)await pause(100);
  assert.notEqual(launcher.exitCode,null,'launcher did not terminate gracefully');
  restarted=spawn(process.execPath,['aapanel/launcher.mjs'],{
    cwd:process.cwd(),
    env:{...process.env,GFIT_PORT:'3339',GFIT_PRIVATE_DIR:privateDir},
    stdio:['ignore','pipe','pipe'],
  });
  let restartLog='';
  restarted.stdout.on('data',chunk=>{restartLog+=String(chunk);});
  restarted.stderr.on('data',chunk=>{restartLog+=String(chunk);});
  let reopened=false;
  for(let i=0;i<100;i++){
    await pause(200);
    const res=await fetch(base+'/api/health').catch(()=>null);
    if(res?.ok){reopened=true;break;}
    if(restarted.exitCode!==null)break;
  }
  assert.equal(reopened,true,'failed to relaunch installed aaPanel app: '+restartLog.slice(-1200));
  assert.equal((await fetch(base+'/setup')).status,404);
  assert.equal(restartLog.includes('CÓDIGO DE INSTALAÇÃO:'),false);
  console.log('aaPanel: instalação única, segredos externos, reinício e recuperação de serviço OK');

  // Regression: release over ZIP, no calls to GitHub in the production updater.
  const loginAfterRestart=await fetch(base+'/api/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:'admin-install@example.com',password:'ci-admin-initial-password'}),
  });
  assert.equal(loginAfterRestart.status,200);
  const cookie=loginAfterRestart.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const adminHeaders={
    Cookie:cookie,Origin:base,'X-GFit-Admin-Password':'ci-admin-initial-password',
  };
  const statusUrl=base+'/api/admin/system/update';
  async function updateStatus(){
    const response=await fetch(statusUrl,{headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    return response.json();
  }
  let status=await updateStatus();
  assert.equal(status.supported,true);
  assert.equal(status.currentVersion,'0.1.0');
  const zip=makeReleaseZip(await collectReleaseFiles(process.cwd()),'0.1.1');
  async function upload(content,pwd='ci-admin-initial-password'){
    const response=await fetch(statusUrl+'/upload',{
      method:'POST',
      headers:{...adminHeaders,'X-GFit-Admin-Password':pwd,'Content-Type':'application/zip'},
      body:content,
    });
    const json=await response.json();
    return {status:response.status,data:json};
  }
  assert.equal((await upload(zip.buffer,'wrong-administrator-password')).status,403);
  const corrupt=Buffer.from(zip.buffer);
  corrupt[40]^=0x80;
  assert.equal((await upload(corrupt)).status,400);
  const accept=await upload(zip.buffer);
  assert.equal(accept.status,202,JSON.stringify(accept.data));
  assert.equal(accept.data.sha256,zip.sha256);
  assert.equal((await upload(zip.buffer)).status,409);
  let prepared=false;
  for(let i=0;i<150;i++){
    await pause(1800);
    status=await updateStatus();
    if(status.pending?.status==='failed_prepare'){
      throw new Error('ZIP preparation failed: '+status.pending.error);
    }
    if(status.pending?.status==='prepared'){prepared=true;break;}
    if(restarted.exitCode!==null)throw new Error('Launcher exited during ZIP staging: '+restartLog.slice(-2000));
  }
  assert.ok(prepared,'ZIP preparation did not finish: '+JSON.stringify(status.pending));
  assert.equal(status.currentVersion,'0.1.0','preparation may not activate files');
  const badApply=await fetch(statusUrl+'/apply',{
    method:'POST',headers:{...adminHeaders,'Content-Type':'application/json'},
    body:JSON.stringify({id:status.pending.id,confirmation:'INDEVIDO'}),
  });
  assert.equal(badApply.status,409);
  const applyResponse=await fetch(statusUrl+'/apply',{
    method:'POST',headers:{...adminHeaders,'Content-Type':'application/json'},
    body:JSON.stringify({id:status.pending.id,confirmation:'APLICAR'}),
  });
  assert.equal(applyResponse.status,202,await applyResponse.text());
  let applied=false;
  for(let i=0;i<150;i++){
    await pause(1600);
    try{
      status=await updateStatus();
      if(status.pending?.status==='failed'||status.pending?.status==='prepared'&&status.pending.error){
        throw new Error('Activation failed: '+status.pending.error);
      }
      if(status.pending?.status==='applied'){applied=true;break;}
    }catch(error){
      if(error.message.startsWith('Activation failed:'))throw error;
      // The API is intentionally unavailable during the controlled restart.
    }
    if(restarted.exitCode!==null)throw new Error('aaPanel supervisor unexpectedly stopped.');
  }
  assert.ok(applied,'ZIP activation did not complete: '+JSON.stringify(status.pending));
  assert.equal(status.currentVersion,'0.1.1');
  assert.equal(status.history[0].version,'0.1.1');
  assert.equal(status.pending.restartRequired,true);
  const afterUpdateLogin=await fetch(base+'/api/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:'admin-install@example.com',password:'ci-admin-initial-password'}),
  });
  assert.equal(afterUpdateLogin.status,200,'admin must survive ZIP update and migration');
  // Restart the Node.js Project: version and database must persist.
  restarted.kill('SIGTERM');
  for(let i=0;i<80&&restarted.exitCode===null;i++)await pause(100);
  assert.notEqual(restarted.exitCode,null);
  finalRun=spawn(process.execPath,['aapanel/launcher.mjs'],{
    cwd:process.cwd(),env:{...process.env,GFIT_PORT:'3339',GFIT_PRIVATE_DIR:privateDir},
    stdio:['ignore','pipe','pipe'],
  });
  let finalOutput='';
  finalRun.stdout.on('data',chunk=>{finalOutput+=String(chunk);});
  finalRun.stderr.on('data',chunk=>{finalOutput+=String(chunk);});
  let finalReady=false;
  for(let i=0;i<100;i++){
    await pause(200);
    if((await fetch(base+'/api/health').catch(()=>null))?.ok){finalReady=true;break;}
    if(finalRun.exitCode!==null)break;
  }
  assert.ok(finalReady,'ZIP-restarted service not ready: '+finalOutput.slice(-1200));
  assert.equal((await updateStatus()).currentVersion,'0.1.1');
  assert.equal(finalOutput.includes('CÓDIGO DE INSTALAÇÃO:'),false);
  console.log('aaPanel ZIP: upload, staging, db backup, apply, code restart, version and admin persistence OK');

}finally{
  stop();
  await fs.rm(privateDir,{recursive:true,force:true});
}
