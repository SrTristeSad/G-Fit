// G-Fit aaPanel: instalador de navegador de uso único + frontend/API no mesmo projeto Node.
// Requer Node 22. Configure Node.js Project Mapping + SSL no aaPanel antes do formulário.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomInt,timingSafeEqual,createHash,randomBytes} from 'node:crypto';
import {promises as fs,createReadStream} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {
  stageRelease,activateRelease,discardRelease,updateLocations,
  writeUpdateState,readJson,recoverInterruptedUpdate,
} from './update-core.mjs';
import {
  validateSetup,formatEnv,parseEnv,isSecureInstallerRequest,
  installCodeMatches,resolvePublicPort,isAllowedInstallerOrigin,
} from './setup-utils.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const apiDir=path.join(root,'api');
const webDir=path.join(root,'web');
const distDir=path.join(webDir,'dist');
const privateDir=path.resolve(
  process.env.GFIT_PRIVATE_DIR ||
  path.join(homedir(),'.config','gfit',
    createHash('sha256').update(root).digest('hex').slice(0,16)),
);
if(privateDir===root||privateDir.startsWith(root+path.sep)) {
  throw new Error('O diretório de segredos deve ficar fora da pasta do site.');
}
const envFile=path.join(privateDir,'instance.env');
const controlSocket=path.join(privateDir,'update-control.sock');
const controlToken=randomBytes(32).toString('hex');
// Opt-in only after configuring Nginx to overwrite X-Real-IP with $remote_addr.
const trustRealIp=process.env.GFIT_TRUST_REAL_IP==='true';
let controlServer=null;
let updateBusy=false;
let updateInProgress=false;
const port=resolvePublicPort({argv:process.argv.slice(2),env:process.env});
const host=process.env.GFIT_HOST||'127.0.0.1';
if(host!=='127.0.0.1' && host!=='::1'){
  throw new Error('Por segurança, o instalador deve usar GFIT_HOST=127.0.0.1 ou ::1.');
}
const state={installed:false,running:false,phase:'aguardando',error:null,attempts:0,lockedUntil:0};
const installCode=String(randomInt(0,100000000)).padStart(8,'0');
let apiChild=null;
let apiPort=null;
let closing=false;
async function stopApi(){
  const child=apiChild;
  if(!child||child.exitCode!==null)return;
  await new Promise(resolve=>{
    const killTimer=setTimeout(()=>child.kill('SIGKILL'),4500);
    child.once('exit',()=>{clearTimeout(killTimer);resolve();});
    child.kill('SIGTERM');
  });
  if(apiChild===child){apiChild=null;apiPort=null;}
}
async function startControl(){
  await fs.mkdir(privateDir,{recursive:true,mode:0o700});
  await fs.chmod(privateDir,0o700);
  const prev=await fs.lstat(controlSocket).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(prev){
    if(!prev.isSocket())throw new Error('Caminho do controle de atualizações está ocupado.');
    await fs.unlink(controlSocket);
  }
  controlServer=http.createServer((req,res)=>{
    void (async()=>{
      const provided=req.headers['x-gfit-control-token'];
      if(typeof provided!=='string'||provided.length!==controlToken.length||
         !timingSafeEqual(Buffer.from(provided),Buffer.from(controlToken))){
        return respond(res,403,{error:'Controle privado não autorizado.'});
      }
      if(req.method!=='POST'||!['/update/prepare','/update/activate','/update/discard'].includes(req.url)){
        return respond(res,404,{error:'Operação desconhecida.'});
      }
      if(updateBusy)return respond(res,409,{error:'Há uma atualização em andamento.'});
      const input=await readInput(req);
      const state=await readJson(updateLocations(privateDir).state,null);
      if(!state||input?.id!==state.id)return respond(res,409,{error:'Pacote pendente não corresponde.'});
      const action=req.url.slice('/update/'.length);
      if(action==='prepare'&&!['uploaded','failed_prepare'].includes(state.status)){
        return respond(res,409,{error:'ZIP não está aguardando preparação.'});
      }
      if(action==='activate'&&state.status!=='prepared'){
        return respond(res,409,{error:'ZIP ainda não foi preparado.'});
      }
      updateBusy=true;
      respond(res,202,{started:true,action});
      void (async()=>{
        try{
          if(action==='prepare'){
            await stageRelease(privateDir,root);
          }else if(action==='activate'){
            updateInProgress=true;
            const env=parseEnv(await fs.readFile(envFile,'utf8'));
            try{
              await activateRelease(privateDir,root,env,{stopApi,startApi});
            }finally{updateInProgress=false;}
          }else{
            await discardRelease(privateDir);
          }
        }catch(error){
          console.error('Atualizador ZIP: '+error.message);
          if(action==='prepare'){
            await writeUpdateState(privateDir,{status:'failed_prepare',error:error.message,
              phase:'Não foi possível preparar o ZIP. Descarte-o ou tente novamente.',progress:0});
          }else if(action==='activate'){
            const current=await readJson(updateLocations(privateDir).state,null);
            if(current?.status==='applying'){
              await writeUpdateState(privateDir,{status:'prepared',error:error.message,
                phase:'Ativação interrompida antes da troca ou falhou no backup.',progress:100});
            }
          }
        }finally{updateBusy=false;}
      })();
    })().catch(e=>{
      console.error('Controle ZIP:',e.message);
      if(!res.headersSent)respond(res,500,{error:'Falha no controle de atualizações.'});
    });
  });
  await new Promise((resolve,reject)=>{
    controlServer.once('error',reject);
    controlServer.listen(controlSocket,()=>{
      controlServer.removeListener('error',reject);
      resolve();
    });
  });
  await fs.chmod(controlSocket,0o600);
}

function respond(res,status,data,extra={}){
  const body=JSON.stringify(data);
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store, max-age=0',
    'X-Content-Type-Options':'nosniff',
    'Content-Length':Buffer.byteLength(body),
    ...extra,
  });
  res.end(body);
}
async function readInput(req){
  let bytes=0;
  const parts=[];
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>16384)throw new Error('Requisição muito grande.');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function exists(filename){
  try{await fs.access(filename);return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function exec(command,args,cwd,env=process.env){
  const child=spawn(command,args,{cwd,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let errorOutput='';
  child.stderr.on('data',part=>{errorOutput=(errorOutput+String(part)).slice(-1000);});
  // Draining stdout prevents hung npm/Node subprocesses; never copy secrets to UI.
  child.stdout.resume();
  const exit=await new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>resolve(code));
  });
  if(exit!==0){
    const hint=command==='npm'?
      'Verifique a versão Node, npm, permissões e conexão de rede no log do aaPanel.':
      'Verifique as credenciais do PostgreSQL e o log do processo no aaPanel.';
    console.error('Erro em '+command+' ('+exit+'): '+errorOutput.slice(-600));
    throw new Error('Falha ao executar '+command+' (código '+exit+'). '+hint);
  }
}
async function installDependencies(folder,includeDev){
  if(!await exists(path.join(folder,'package-lock.json'))){
    throw new Error('package-lock.json ausente em '+path.basename(folder)+'. Instale somente pacotes completos e versionados.');
  }
  await exec('npm',['ci','--ignore-scripts',includeDev?'--include=dev':'--omit=dev',
    '--no-audit','--no-fund'],folder);
}
async function waitApiReady(child){
  // A API pede uma porta livre ao sistema operacional (PORT=0). O número
  // realmente reservado é comunicado por IPC, sem sondar nem disputar 3001.
  const assignedPort=await new Promise((resolve,reject)=>{
    let finished=false;
    const timeout=setTimeout(()=>finish(new Error('API não iniciou em até 30 segundos.')),30000);
    const onMessage=message=>{
      if(message?.type!=='gfit-api-ready')return;
      if(!Number.isInteger(message.port)||message.port<1||message.port>65535){
        return finish(new Error('A API comunicou uma porta inválida.'));
      }
      finish(null,message.port);
    };
    const onExit=code=>finish(new Error('A API terminou durante a inicialização ('+code+').'));
    const onError=error=>finish(error);
    function finish(error,value){
      if(finished)return;
      finished=true;
      clearTimeout(timeout);
      child.removeListener('message',onMessage);
      child.removeListener('exit',onExit);
      child.removeListener('error',onError);
      if(error)reject(error);else resolve(value);
    }
    child.on('message',onMessage);
    child.once('exit',onExit);
    child.once('error',onError);
  });
  // Não aceitar somente uma mensagem: confira também o endpoint real.
  for(let i=0;i<20;i++){
    try{
      const response=await fetch('http://127.0.0.1:'+assignedPort+'/api/health',{
        signal:AbortSignal.timeout(700),
      });
      if(response.ok)return assignedPort;
    }catch{}
    if(child.exitCode!==null||child.signalCode!==null)break;
    await pause(200);
  }
  throw new Error('A API não respondeu na porta interna '+assignedPort+'.');
}
async function startApi(env){
  if(apiChild && apiChild.exitCode===null)return;
  apiPort=null;
  const child=spawn(process.execPath,['src/server.js'],{
    cwd:apiDir,env:{...process.env,...env,
      PORT:'0',BIND_HOST:'127.0.0.1',
      GFIT_PRIVATE_DIR:privateDir,GFIT_UPDATE_SOCKET:controlSocket,
      GFIT_UPDATE_TOKEN:controlToken,
    },stdio:['ignore','inherit','inherit','ipc'],
  });
  apiChild=child;
  try{apiPort=await waitApiReady(child);}
  catch(error){
    child.kill();
    if(apiChild===child){apiChild=null;apiPort=null;}
    throw error;
  }
  console.log('G-Fit API interna disponível em 127.0.0.1:'+apiPort);
  child.on('exit',(code)=>{
    if(apiChild===child){apiChild=null;apiPort=null;}
    if(!closing&&!updateInProgress){
      console.error('A API parou ('+code+'). Reiniciando o projeto via aaPanel.');
      process.exit(1);
    }
  });
}
async function install(input){
  state.phase='Instalando dependências da API';
  await installDependencies(apiDir,false);
  state.phase='Instalando dependências do React';
  await installDependencies(webDir,true);
  state.phase='Compilando interface React';
  await exec('npm',['run','build'],webDir);
  const env={};
  for(const key of ['DB_HOST','DB_PORT','DB_USER','DB_NAME','DB_PASSWORD']){
    env[key]=input[key];
  }
  Object.assign(env,{
    NODE_ENV:'production',COOKIE_SECURE:'true',
    PORT:'3001',BIND_HOST:'127.0.0.1',
    GFIT_SETUP_ADMIN_EMAIL:input.adminEmail,
    GFIT_SETUP_ADMIN_PASSWORD:input.adminPassword,
  });
  state.phase='Validando PostgreSQL e criando administrador';
  await exec(process.execPath,[path.join(here,'provision.mjs')],root,{
    ...process.env,...env,
  });
  delete env.GFIT_SETUP_ADMIN_EMAIL;
  delete env.GFIT_SETUP_ADMIN_PASSWORD;
  state.phase='Iniciando API';
  await startApi(env);
  state.phase='Salvando configuração privada';
  await fs.mkdir(privateDir,{recursive:true,mode:0o700});
  await fs.chmod(privateDir,0o700);
  // Gravado somente após validação de credenciais, banco, frontend e API.
  const temp=envFile+'.partial';
  await fs.writeFile(temp,formatEnv(env),{flag:'wx',mode:0o600});
  try{
    if(await exists(envFile))throw new Error('Instalação já concluída.');
    await fs.rename(temp,envFile);
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
  state.installed=true;
  state.phase='Concluído';
  state.error=null;
}
async function setupHandler(req,res,url){
  if(req.method==='GET' && (url.pathname==='/'||url.pathname==='/setup')){
    res.writeHead(200,{
      'Content-Type':'text/html; charset=utf-8',
      'Cache-Control':'no-store, max-age=0',
      'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'",
      'X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'DENY',
    });
    createReadStream(path.join(here,'installer.html')).pipe(res);
    return;
  }
  if(req.method==='GET' && url.pathname==='/installer.js'){
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
    createReadStream(path.join(here,'installer.js')).pipe(res);
    return;
  }
  if(req.method!=='POST'||!['/setup/status','/setup/install'].includes(url.pathname)){
    return respond(res,404,{error:'Página não encontrada.'});
  }
  if(!isSecureInstallerRequest(req)){
    return respond(res,403,{error:'Abra o instalador por HTTPS via domínio aaPanel, ou pelo túnel localhost.'});
  }
  if(!isAllowedInstallerOrigin(req)){
    return respond(res,403,{error:'Origem não autorizada.'});
  }
  if(Date.now()<state.lockedUntil){
    return respond(res,429,{error:'Código bloqueado temporariamente. Consulte o log do aaPanel.'});
  }
  let input;
  try{input=await readInput(req);}
  catch{return respond(res,400,{error:'Dados do formulário inválidos.'});}
  if(!installCodeMatches(input.code,installCode,timingSafeEqual)){
    state.attempts++;
    if(state.attempts>=5) {
      state.lockedUntil=Date.now()+15*60*1000;state.attempts=0;
    }
    return respond(res,403,{error:'Código de instalação incorreto.'});
  }
  state.attempts=0;
  if(url.pathname==='/setup/status'){
    return respond(res,200,{
      installed:state.installed,running:state.running,
      phase:state.phase,error:state.error,
    });
  }
  if(state.running)return respond(res,409,{error:'Instalação já em andamento.'});
  if(state.installed||await exists(envFile))return respond(res,409,{error:'Já instalado.'});
  const valid=validateSetup(input);
  if(!valid)return respond(res,400,{
    error:'Confira host, porta, nome/usuário do banco, senha e credenciais do administrador.',
  });
  state.running=true;
  state.error=null;
  state.phase='Preparando instalação';
  respond(res,202,{started:true});
  // A aplicação aaPanel permanece viva enquanto instala; status é consultável.
  void install(valid).catch(err=>{
    state.error=err.message;
    state.phase='Falha — confira os dados e tente novamente';
    console.error('Instalador G-Fit: '+err.message);
  }).finally(()=>{state.running=false;});
}
const mime={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml',
  '.json':'application/json; charset=utf-8','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp',
  '.ico':'image/x-icon','.woff2':'font/woff2',
};
function proxyApi(req,res){
  if(updateInProgress)return respond(res,503,{error:'Atualização ZIP em andamento. Aguarde a reinicialização.'});
  if(!apiPort)return respond(res,503,{error:'API inicializando ou temporariamente indisponível.'});
  const headers={...req.headers,host:'127.0.0.1:'+apiPort};
  // Remove untrusted forwarding headers before handing the request to Express.
  for(const key of ['x-forwarded-for','x-forwarded-host','x-forwarded-proto']){
    delete headers[key];
  }
  // aaPanel should set this header; do not trust arbitrary chains of proxies.
  // aaPanel Nginx MUST set X-Real-IP using $remote_addr (overwriting
  // arbitrary client headers). Accept only a single valid IP; fallback to
  // loopback for SSH tunnels or panels without this trusted proxy setting.
  const realIp=req.headers['x-real-ip'];
  headers['x-forwarded-for']=trustRealIp&&typeof realIp==='string'&&isIP(realIp)?realIp:'127.0.0.1';
  delete headers['x-real-ip'];
  headers['x-forwarded-proto']=req.headers['x-forwarded-proto']==='https'?'https':'http';
  // Same-origin validation for admin ZIP uploads, always derived from the public request.
  headers['x-gfit-public-host']=req.headers.host||'';
  headers['x-gfit-public-scheme']=headers['x-forwarded-proto'];
  const up=http.request({
    hostname:'127.0.0.1',port:apiPort,
    path:req.url,method:req.method,headers,
  },upRes=>{
    res.writeHead(upRes.statusCode||502,upRes.headers);
    upRes.pipe(res);
  });
  up.on('error',()=>{
    if(!res.headersSent)respond(res,502,{error:'API indisponível.'});
    else res.destroy();
  });
  req.pipe(up);
}
async function serveApp(req,res,url){
  if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
    proxyApi(req,res);return;
  }
  if(url.pathname.startsWith('/setup')||url.pathname.startsWith('/installer')||
    url.pathname.startsWith('/.')){
    return respond(res,404,{error:'Página não encontrada.'});
  }
  if(req.method!=='GET'&&req.method!=='HEAD'){
    return respond(res,405,{error:'Método não permitido.'});
  }
  const basename=decodeURIComponent(url.pathname);
  const resolved=path.resolve(distDir,'.'+basename);
  if(resolved!==distDir&&!resolved.startsWith(distDir+path.sep)){
    return respond(res,404,{error:'Página não encontrada.'});
  }
  let target=resolved;
  let stat=await fs.stat(target).catch(()=>null);
  if(!stat||!stat.isFile()){
    if(path.extname(basename))return respond(res,404,{error:'Arquivo não encontrado.'});
    target=path.join(distDir,'index.html');
    stat=await fs.stat(target).catch(()=>null);
  }
  if(!stat||!stat.isFile())return respond(res,503,{error:'Interface indisponível.'});
  const isAsset=target.includes(path.sep+'assets'+path.sep);
  res.writeHead(200,{
    'Content-Type':mime[path.extname(target)]||'application/octet-stream',
    'Cache-Control':isAsset?'public, max-age=31536000, immutable':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Content-Length':stat.size,
  });
  if(req.method==='HEAD')return res.end();
  createReadStream(target).pipe(res);
}
const server=http.createServer((req,res)=>{
  void (async()=>{
    const url=new URL(req.url,'http://localhost');
    if(!state.installed)return setupHandler(req,res,url);
    return serveApp(req,res,url);
  })().catch(error=>{
    console.error('Falha na requisição: '+error.message);
    if(!res.headersSent)respond(res,500,{error:'Erro interno do servidor.'});
    else res.destroy();
  });
});
// A porta pública é escolhida pelo aaPanel. Nunca trocar silenciosamente
// para outra porta, pois o Mapping do domínio continuaria na porta anterior.
server.on('error',error=>{
  if(error.code==='EADDRINUSE'){
    console.error('G-Fit: porta '+port+' ocupada por outro projeto. '+
      'Escolha uma porta livre em Project Port e use npm start -- --port=NUMERO, '+
      'com o mesmo número, sem alterar o código.');
  }else{
    console.error('G-Fit: não foi possível abrir a porta '+port+': '+error.message);
  }
  closing=true;
  if(apiChild)apiChild.kill('SIGTERM');
  controlServer?.close();
  void fs.rm(controlSocket,{force:true}).catch(()=>{});
  process.exitCode=1;
});
async function main(){
  await recoverInterruptedUpdate(privateDir,root);
  await startControl();
  if(await exists(envFile)){
    // Never auto-start a half-configured project.
    const stats=await fs.stat(envFile);
    if(process.platform!=='win32' && (stats.mode & 0o077)!==0){
      throw new Error('Permissões inseguras em .aapanel.env: use chmod 600.');
    }
    const env=parseEnv(await fs.readFile(envFile,'utf8'));
    await startApi(env);
    state.installed=true;
    state.phase='Aplicação pronta';
    console.log('G-Fit aaPanel iniciado; frontend e API no endereço da porta '+port);
  }else{
    console.log('G-Fit ainda não está configurado.');
    console.log('CÓDIGO DE INSTALAÇÃO: '+installCode);
    console.log('Abra o domínio HTTPS mapeado no aaPanel ou use túnel SSH local.');
  }
  server.listen(port,host,()=>console.log('G-Fit aaPanel ouvindo em '+host+':'+port));
}
for(const signal of ['SIGINT','SIGTERM']){
  process.on(signal,()=>{
    if(closing)return;
    closing=true;
    const active=apiChild;
    if(active&&active.exitCode===null){
      const watchdog=setTimeout(()=>active.kill('SIGKILL'),3500);
      watchdog.unref();
      active.once('exit',()=>{
        clearTimeout(watchdog);
        server.close(()=>{
      controlServer?.close();
      void fs.rm(controlSocket,{force:true}).catch(()=>{});
      process.exit(0);
    });
      });
      active.kill(signal);
    }else{
      server.close(()=>process.exit(0));
    }
  });
}
await main();
