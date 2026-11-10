// Aplicação de releases ZIP no aaPanel. NÃO executa no modo Docker.
// Etapas: validação -> staging e build -> backup DB + código -> parar API ->
// troca de código -> subir API -> healthcheck. Rollback automático do CÓDIGO
// se a ativação falhar; banco pode exigir recuperação operacional manual.
import {promises as fs,createWriteStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {randomBytes,createHash} from 'node:crypto';
import {MAGIC,encryptStream,verifyBackup} from '../scripts/backup-lib.mjs';
import {validateRelease,compareVersions,readZip} from './zip-release.mjs';

export const UPDATE_MAX_FILE=32*1024*1024;
const tracked=[
  'package.json','api/package.json','api/package-lock.json',
  'api/src','api/node_modules',
  'web/package.json','web/package-lock.json','web/index.html','web/vite.config.js',
  'web/src','web/dist','aapanel','scripts',
];
const digest=b=>createHash('sha256').update(b).digest('hex');
const has=async p=>fs.stat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
export function updateLocations(privateDir) {
  const directory=path.join(privateDir,'updates');
  return {
    directory,
    state:path.join(directory,'state.json'),
    pending:path.join(directory,'pending.zip'),
    stage:path.join(directory,'staging'),
    snapshots:path.join(directory,'snapshots'),
    current:path.join(directory,'current.json'),
    history:path.join(directory,'history.json'),
  };
}
export async function readJson(file,fallback){
  try{return JSON.parse(await fs.readFile(file,'utf8'));}
  catch(error){if(error.code==='ENOENT')return fallback;throw error;}
}
export async function saveJson(file,data) {
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.'+randomBytes(6).toString('hex')+'.tmp';
  await fs.writeFile(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600,flag:'wx'});
  try{await fs.rename(tmp,file);}
  finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
}
export async function currentVersion(privateDir,root) {
  const loc=updateLocations(privateDir);
  const file=await readJson(loc.current,null);
  if(file?.version)return file.version;
  return JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
}
export async function readUpdateStatus(privateDir,root){
  const loc=updateLocations(privateDir);
  const [state,history,version]=await Promise.all([
    readJson(loc.state,null),readJson(loc.history,[]),currentVersion(privateDir,root),
  ]);
  const {id,version:nextVersion,sha256,phase,status,progress,error,createdAt,updatedAt,
    restartRequired,backupLocation}=state||{};
  return {
    supported:true,currentVersion:version,
    pending:state?{id,version:nextVersion,sha256,phase,status,progress,error,
      createdAt,updatedAt,restartRequired,
      backupRetained:!!backupLocation}:null,
    history:history.slice(0,15),
    mode:'zip_offline',databaseRollbackAutomatic:false,
  };
}
export async function writeUpdateState(privateDir,change){
  const loc=updateLocations(privateDir);
  const old=await readJson(loc.state,{});
  const next={...old,...change,updatedAt:new Date().toISOString()};
  await saveJson(loc.state,next);
  return next;
}
export async function appendHistory(privateDir,event){
  const loc=updateLocations(privateDir);
  const previous=await readJson(loc.history,[]);
  await saveJson(loc.history,[event,...previous].slice(0,30));
}
export async function verifyPending(privateDir,root){
  const loc=updateLocations(privateDir);
  const state=await readJson(loc.state,null);
  if(!state?.id||!state.version||!state.sha256)throw new Error('Nenhum pacote pendente.');
  const blob=await fs.readFile(loc.pending);
  if(digest(blob)!==state.sha256)throw new Error('O ZIP preparado foi alterado. Descarte-o.');
  const current=await currentVersion(privateDir,root);
  const release=validateRelease(blob,current);
  if(release.manifest.version!==state.version)throw new Error('Versão do pacote alterada.');
  return {state,release,loc};
}
function npmCommand(root){
  return {name:'npm',env:{...process.env,
    npm_config_cache:path.join(root,'npm-cache'),
    npm_config_audit:'false',npm_config_fund:'false'}};
}
export async function execChecked(command,args,{cwd,env=process.env}){
  const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe']});
  let output='';
  child.stderr.on('data',v=>{output=(output+String(v)).slice(-900);});
  child.stdout.resume();
  const code=await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',resolve);
  });
  if(code!==0){
    // npm and pg_dump errors can include connection details: never send stderr to UI.
    console.error('G-Fit ZIP updater subprocess failed',command,'exit',code);
    throw new Error('A etapa '+command+' falhou (código '+code+'). Consulte logs privados do aaPanel.');
  }
}
export async function stageRelease(privateDir,root){
  const {state,release,loc}=await verifyPending(privateDir,root);
  if(!['uploaded','failed_prepare','preparing'].includes(state.status)){
    throw new Error('O pacote não está aguardando preparação.');
  }
  await writeUpdateState(privateDir,{status:'preparing',phase:'Verificando integridade e extraindo ZIP',error:null,progress:12});
  await fs.rm(loc.stage,{recursive:true,force:true});
  await fs.mkdir(loc.stage,{recursive:true,mode:0o700});
  // Paths were validated against a strict allowlist before extraction.
  for(const [name,content] of release.files){
    if(name==='gfit-release.json')continue;
    const dest=path.join(loc.stage,...name.split('/'));
    await fs.mkdir(path.dirname(dest),{recursive:true});
    await fs.writeFile(dest,content,{flag:'wx',mode:0o644});
  }
  const npm=npmCommand(loc.directory);
  for(const folder of ['api','web']){
    const current=path.join(loc.stage,folder);
    const hasLock=await has(path.join(current,'package-lock.json'));
    await writeUpdateState(privateDir,{phase:'Instalando dependências no ambiente temporário: '+folder,progress:folder==='api'?26:49});
    await execChecked(npm.name,[hasLock?'ci':'install',
      folder==='api'?'--omit=dev':'--include=dev','--no-audit','--no-fund'],
      {cwd:current,env:npm.env});
  }
  await writeUpdateState(privateDir,{phase:'Compilando React sem alterar a instalação atual',progress:71});
  await execChecked('npm',['run','build'],{cwd:path.join(loc.stage,'web'),env:npm.env});
  if(!await has(path.join(loc.stage,'web/dist/index.html')))throw new Error('O build React não gerou index.html.');
  for(const [name] of release.files){
    if(name.startsWith('api/src/')&&/\.(?:js|mjs)$/.test(name)){
      await execChecked(process.execPath,['--check',path.join(loc.stage,name)],
        {cwd:loc.stage});
    }
  }
  await verifyPending(privateDir,root);
  await writeUpdateState(privateDir,{status:'prepared',phase:'ZIP verificado, dependências instaladas e React compilado. Pronto para ativação.',progress:100});
}
async function copyPath(source,dest){
  if(!await has(source))return false;
  await fs.mkdir(path.dirname(dest),{recursive:true});
  await fs.cp(source,dest,{recursive:true,force:false,errorOnExist:true});
  return true;
}
async function saveCodeSnapshot(root,destination){
  await fs.mkdir(destination,{recursive:true,mode:0o700});
  const available=[];
  for(const name of tracked){
    if(await copyPath(path.join(root,name),path.join(destination,name)))available.push(name);
  }
  await saveJson(path.join(destination,'contents.json'),{available});
}
async function installStage(root,staging){
  for(const name of tracked){
    const target=path.join(root,name);
    const source=path.join(staging,name);
    if(!await has(source)&&['api/package-lock.json','web/package-lock.json'].includes(name)){
      await fs.rm(target,{force:true});continue;
    }
    if(!await has(source))throw new Error('Arquivo preparado ausente: '+name);
    await fs.rm(target,{recursive:true,force:true});
    await copyPath(source,target);
  }
}
async function restoreCodeSnapshot(root,destination){
  const {available}=await readJson(path.join(destination,'contents.json'),{available:[]});
  for(const name of tracked){
    await fs.rm(path.join(root,name),{recursive:true,force:true});
    if(available.includes(name))await copyPath(path.join(destination,name),path.join(root,name));
  }
}
async function backupDatabase(privateDir,env,destination){
  // Mandatory pg_dump before touching live code. The operator can recover the
  // database manually with PostgreSQL tools, but automatic DB rollback is unsafe.
  const dir=updateLocations(privateDir).directory;
  const keyPath=path.join(dir,'db-backup-key.hex');
  let key;
  if(await has(keyPath)){
    key=Buffer.from((await fs.readFile(keyPath,'utf8')).trim(),'hex');
    if(key.length!==32)throw new Error('Chave de backup da atualização inválida.');
  }else{
    key=randomBytes(32);
    await fs.writeFile(keyPath,key.toString('hex')+'\n',{flag:'wx',mode:0o600});
  }
  const iv=randomBytes(12);
  const archive=path.join(destination,'database.gfitbak');
  const writer=createWriteStream(archive,{flags:'wx',mode:0o600});
  writer.write(Buffer.concat([MAGIC,iv]));
  const child=spawn('pg_dump',[
    '--format=custom','--no-owner','--no-acl',
    '--host',env.DB_HOST,'--port',env.DB_PORT,
    '--username',env.DB_USER,'--dbname',env.DB_NAME,
  ],{
    env:{...process.env,PGPASSWORD:env.DB_PASSWORD},
    stdio:['ignore','pipe','pipe'],
  });
  let error='';
  child.stderr.on('data',chunk=>{error=(error+String(chunk)).slice(-300);});
  const done=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>code===0?resolve():reject(new Error('pg_dump não concluiu o backup. Verifique o cliente PostgreSQL instalado.')));
  });
  done.catch(()=>{});
  try{
    await Promise.all([pipeline(child.stdout,encryptStream(key,iv),writer),done]);
    await verifyBackup(archive,key);
  }catch(e){child.kill();await fs.rm(archive,{force:true});throw e;}
  return archive;
}
export async function activateRelease(privateDir,root,env,{stopApi,startApi}){
  const {state,loc}=await verifyPending(privateDir,root);
  if(state.status!=='prepared')throw new Error('Prepare e valide o ZIP antes de aplicar.');
  if(!await has(path.join(loc.stage,'web/dist/index.html')))throw new Error('O staging do React desapareceu.');
  const previousCurrent=await readJson(loc.current,null);
  const snapshot=path.join(loc.snapshots,state.id);
  await fs.mkdir(snapshot,{recursive:true,mode:0o700});
  await writeUpdateState(privateDir,{status:'applying',phase:'Criando backup criptografado do PostgreSQL',progress:5,error:null});
  await backupDatabase(privateDir,env,snapshot);
  await writeUpdateState(privateDir,{phase:'Salvando versão anterior do código',progress:20});
  await saveCodeSnapshot(root,path.join(snapshot,'code'));
  let stopped=false;
  try{
    await writeUpdateState(privateDir,{phase:'Interrompendo API para ativação',progress:43});
    await stopApi();stopped=true;
    await writeUpdateState(privateDir,{phase:'Ativando arquivos preparados',progress:60});
    await installStage(root,loc.stage);
    await writeUpdateState(privateDir,{phase:'Inicializando e verificando a nova API',progress:81});
    await startApi(env);
    await saveJson(loc.current,{version:state.version,activatedAt:new Date().toISOString(),sha256:state.sha256});
    const event={version:state.version,sha256:state.sha256,status:'applied',date:new Date().toISOString(),id:state.id};
    await appendHistory(privateDir,event);
    await writeUpdateState(privateDir,{
      status:'applied',phase:'Versão ativada. Reinicie o Node.js Project no aaPanel para carregar também o novo supervisor.',
      progress:100,backupLocation:snapshot,restartRequired:true,
    });
    // Cleanup is best-effort after activation has been committed. A failure to
    // remove a staging folder must never roll back a healthy running version.
    await fs.rm(loc.pending,{force:true}).catch(e=>console.error('ZIP cleanup:',e.message));
    await fs.rm(loc.stage,{recursive:true,force:true}).catch(e=>console.error('Staging cleanup:',e.message));
  }catch(error){
    if(stopped){
      try{
        await stopApi();
        await restoreCodeSnapshot(root,path.join(snapshot,'code'));
        if(previousCurrent)await saveJson(loc.current,previousCurrent);
        else await fs.rm(loc.current,{force:true});
        await startApi(env);
      }catch(rollbackError){
        console.error('CRÍTICO: falha ao reverter código:',rollbackError.message);
        await writeUpdateState(privateDir,{status:'failed',phase:'Intervenção manual necessária: rollback de código falhou',error:'Consulte logs privados do aaPanel e snapshot local.',backupLocation:snapshot});
        throw rollbackError;
      }
    }
    await appendHistory(privateDir,{version:state.version,sha256:state.sha256,status:'failed',date:new Date().toISOString(),id:state.id});
    await writeUpdateState(privateDir,{status:'failed',phase:'Ativação falhou; código anterior recuperado',error:error.message,
      backupLocation:snapshot,restartRequired:false});
    throw error;
  }
}
// Executado antes de abrir o app em um novo processo aaPanel.
// Se um processo anterior morreu preparando, libera o estado para nova tentativa.
// Se morreu aplicando e o snapshot de código está íntegro, recupera a versão
// anterior; NUNCA restaura o banco automaticamente.
export async function recoverInterruptedUpdate(privateDir,root){
  const loc=updateLocations(privateDir);
  const state=await readJson(loc.state,null);
  if(!state||!['preparing','applying'].includes(state.status))return false;
  if(state.status==='preparing'){
    await writeUpdateState(privateDir,{
      status:'failed_prepare',phase:'Preparação interrompida por reinício do processo',
      error:'O processo parou durante a preparação. Tente novamente ou descarte o pacote.',
      progress:0,
    });
    return true;
  }
  const activated=await readJson(loc.current,null);
  if(activated?.version===state.version && activated?.sha256===state.sha256){
    await writeUpdateState(privateDir,{
      status:'applied',progress:100,restartRequired:false,
      phase:'Atualização aplicada antes do reinício do processo.',
      error:null,
    });
    return true;
  }
  const snapshot=path.join(loc.snapshots,state.id,'code');
  if(await has(path.join(snapshot,'contents.json'))){
    try{
      await restoreCodeSnapshot(root,snapshot);
      await writeUpdateState(privateDir,{
        status:'failed',phase:'Processo interrompido; código anterior restaurado na inicialização',
        error:'A base de dados não foi revertida. Verifique as migrações e o backup antes de continuar.',
        backupLocation:path.join(loc.snapshots,state.id),
        restartRequired:false,
      });
      await appendHistory(privateDir,{
        id:state.id,version:state.version,sha256:state.sha256,
        status:'failed',date:new Date().toISOString(),
      });
      return true;
    }catch(error){
      console.error('CRÍTICO: não foi possível recuperar código interrompido:',error.message);
    }
  }
  await writeUpdateState(privateDir,{
    status:'failed',phase:'Intervenção manual necessária: atualização interrompida',
    error:'Não foi possível confirmar ou restaurar automaticamente a versão anterior. Consulte os backups.',
    restartRequired:false,
  });
  return true;
}

export async function discardRelease(privateDir){
  const loc=updateLocations(privateDir);
  const state=await readJson(loc.state,null);
  if(state?.status==='applying'||state?.status==='preparing')throw new Error('Operação em andamento.');
  await fs.rm(loc.pending,{force:true});
  await fs.rm(loc.stage,{recursive:true,force:true});
  await fs.rm(loc.state,{force:true});
}
