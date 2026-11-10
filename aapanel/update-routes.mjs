// Rotas administrativas do ZIP updater no G-Fit aaPanel.
// Requer login administrador + senha atual + Origin da mesma origem.
// Sem GFIT_UPDATE_SOCKET (Docker), a API informa indisponibilidade.
import http from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {db} from '../api/src/db.js';
import {verifyPassword} from '../api/src/security.js';
import {
  readUpdateStatus,writeUpdateState,updateLocations,
  currentVersion,readJson,discardRelease,
} from './update-core.mjs';
import {validateRelease,ZIP_MAX_BYTES} from './zip-release.mjs';
import {readTrustedKey,fingerprint} from './release-trust.mjs';

const location=process.env.GFIT_PRIVATE_DIR;
const available=!!(location&&process.env.GFIT_UPDATE_SOCKET&&process.env.GFIT_UPDATE_TOKEN);
const privateDirectory=available?path.resolve(location):null;
const socket=process.env.GFIT_UPDATE_SOCKET;
const token=process.env.GFIT_UPDATE_TOKEN;
const maxHeader=1600; // UTF-8 credentials percent-encoded into ASCII HTTP header.

function validOrigin(req) {
  const value=req.get('origin');
  const host=req.get('x-gfit-public-host');
  const scheme=req.get('x-gfit-public-scheme');
  if(!value||!host||!['http','https'].includes(scheme))return false;
  try{
    const origin=new URL(value);
    if(origin.host!==host||origin.protocol!==scheme+':'||origin.username||origin.password)return false;
  }catch{return false;}
  if(scheme!=='https'&&!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))return false;
  return true;
}
function sendControl(action,id) {
  return new Promise((resolve,reject)=>{
    const request=http.request({
      socketPath:socket,path:'/update/'+action,method:'POST',
      headers:{'Content-Type':'application/json',
        'X-GFit-Control-Token':token},
      timeout:12000,
    },response=>{
      const chunks=[];
      response.on('data',b=>chunks.push(b));
      response.on('end',()=>{
        const body=Buffer.concat(chunks).toString('utf8');
        let result={};
        try{result=JSON.parse(body);}catch{}
        if(response.statusCode>=400)reject(new Error(result.error||'Supervisor não aceitou a operação.'));
        else resolve(result);
      });
    });
    request.once('timeout',()=>request.destroy(new Error('Supervisor não respondeu.')));
    request.once('error',reject);
    request.end(JSON.stringify({id}));
  });
}
async function passwordGuard(req,res,next) {
  if(!available)return res.status(503).json({error:'Atualizador ZIP disponível apenas na instalação aaPanel.'});
  if(!validOrigin(req))return res.status(403).json({error:'Origem HTTPS inválida para atualizar o sistema.'});
  const encoded=req.get('x-gfit-admin-password');
  let pass;
  try{
    if(typeof encoded!=='string'||encoded.length>maxHeader)throw new Error('invalid header');
    pass=decodeURIComponent(encoded);
  }catch{
    return res.status(400).json({error:'Senha administrativa enviada em formato inválido.'});
  }
  if(pass.length<10||pass.length>128){
    return res.status(400).json({error:'Informe sua senha administrativa atual.'});
  }
  const query=await db.query('SELECT password_hash FROM teachers WHERE id=$1 AND is_admin',[req.teacher.id]);
  if(!query.rows.length||!await verifyPassword(pass,query.rows[0].password_hash)){
    return res.status(403).json({error:'Senha administrativa incorreta.'});
  }
  next();
}
export function registerZipUpdateRoutes(app,requireTeacher,requireAdmin,rateLimit,express) {
  const limited=rateLimit({
    windowMs:15*60*1000,limit:8,
    standardHeaders:'draft-8',legacyHeaders:false,
    message:{error:'Muitas tentativas de atualização. Tente mais tarde.'},
  });
  const base='/api/admin/system/update';
  app.get(base,requireTeacher,requireAdmin,async(_req,res)=>{
    if(!available)return res.json({supported:false,mode:'docker',message:'ZIP updater só funciona no aaPanel.'});
    const result=await readUpdateStatus(privateDirectory,path.resolve('..'));
    try{
      result.signingConfigured=true;
      result.signingFingerprint=fingerprint(await readTrustedKey(privateDirectory));
    }catch{
      result.signingConfigured=false;
      result.signingFingerprint=null;
      result.signingMessage='Instale a chave pública de assinatura fora do site antes de enviar ZIPs.';
    }
    res.json(result);
  });
  app.post(base+'/upload',requireTeacher,requireAdmin,limited,passwordGuard,
    express.raw({type:'application/zip',limit:ZIP_MAX_BYTES}),async(req,res)=>{
      if(!Buffer.isBuffer(req.body)||!req.body.length) {
        return res.status(400).json({error:'Envie um ZIP de release do G-Fit.'});
      }
      const root=path.resolve('..');
      const loc=updateLocations(privateDirectory);
      const status=await readJson(loc.state,null);
      if(status && !['applied','failed'].includes(status.status)){
        return res.status(409).json({error:'Já existe um ZIP pendente. Ative ou descarte antes de enviar outro.'});
      }
      const version=await currentVersion(privateDirectory,root);
      let release;
      let key;
      try{key=await readTrustedKey(privateDirectory);}
      catch{return res.status(503).json({error:'Assinatura não configurada. Instale a chave pública confiável na VPS.'});}
      try{release=validateRelease(req.body,version,key);}
      catch(error){return res.status(400).json({error:error.message});}
      await fs.mkdir(loc.directory,{recursive:true,mode:0o700});
      if(status?.status==='applied'||status?.status==='failed'){
        await discardRelease(privateDirectory);
      }
      const id=randomUUID();
      await fs.writeFile(loc.pending,req.body,{flag:'wx',mode:0o600});
      await writeUpdateState(privateDirectory,{
        id,status:'uploaded',phase:'ZIP recebido; aguardando preparação',
        version:release.manifest.version,sha256:release.sha256,
        progress:0,uploadedBy:req.teacher.id,createdAt:new Date().toISOString(),
        error:null,restartRequired:false,backupLocation:null,
      });
      try{await sendControl('prepare',id);}
      catch(error){
        await writeUpdateState(privateDirectory,{status:'failed_prepare',phase:'Não foi possível iniciar a preparação',error:error.message});
        return res.status(503).json({error:'ZIP recebido, mas o supervisor está indisponível. Consulte o log do aaPanel.'});
      }
      res.status(202).json({
        id,version:release.manifest.version,sha256:release.sha256,status:'preparing',
        warning:'ZIPs de origem não confiável podem executar código no servidor. Valide o fornecedor do pacote.',
      });
    });
  app.post(base+'/prepare',requireTeacher,requireAdmin,limited,passwordGuard,async(_req,res)=>{
    const state=await readJson(updateLocations(privateDirectory).state,null);
    if(!['uploaded','failed_prepare'].includes(state?.status)){
      return res.status(409).json({error:'Nenhum ZIP aguardando preparação.'});
    }
    await sendControl('prepare',state.id);
    res.status(202).json({started:true});
  });
  app.post(base+'/apply',requireTeacher,requireAdmin,limited,passwordGuard,async(req,res)=>{
    const state=await readJson(updateLocations(privateDirectory).state,null);
    if(req.body?.confirmation!=='APLICAR'||req.body?.id!==state?.id||
       state?.status!=='prepared'){
      return res.status(409).json({error:'Prepare o ZIP e digite APLICAR para ativá-lo.'});
    }
    await sendControl('activate',state.id);
    res.status(202).json({started:true,restartRequired:true,
      notice:'A API pode ficar temporariamente indisponível. Aguarde a validação e reinicie o Node.js Project no aaPanel.'});
  });
  app.post(base+'/discard',requireTeacher,requireAdmin,limited,passwordGuard,async(req,res)=>{
    if(req.body?.confirmation!=='DESCARTAR')return res.status(400).json({error:'Confirme DESCARTAR.'});
    const state=await readJson(updateLocations(privateDirectory).state,null);
    if(!state)return res.status(404).json({error:'Sem pacote pendente.'});
    await sendControl('discard',state.id);
    res.json({ok:true});
  });
}
