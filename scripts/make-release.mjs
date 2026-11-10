#!/usr/bin/env node
// ZIP completo de atualização produzido localmente: não consulta GitHub nem inclui senhas.
import {promises as fs} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collectReleaseFiles,makeReleaseZip,compareVersions} from '../aapanel/zip-release.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const idx=args.indexOf('--version');
const version=idx>=0?args[idx+1]:null;
const keyIndex=args.indexOf('--key');
const keyFile=keyIndex>=0?args[keyIndex+1]:process.env.GFIT_RELEASE_PRIVATE_KEY;
try{
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  if(!version||compareVersions(version,pkg.version)<=0){
    throw new Error('Informe --version MAJOR.MINOR.PATCH superior a '+pkg.version+'.');
  }
  if(!keyFile)throw new Error('Informe --key /caminho/da/chave-privada.pem. ZIP sem assinatura é proibido.');
  const privateKeyPath=path.resolve(keyFile);
  if(privateKeyPath===root||privateKeyPath.startsWith(root+path.sep))throw new Error('A chave privada deve ficar fora do repositório.');
  const keyStat=await fs.stat(privateKeyPath);
  if(process.platform!=='win32'&&(keyStat.mode&0o077)!==0)throw new Error('Permissões inseguras da chave privada: chmod 600.');
  const privateKey=await fs.readFile(privateKeyPath,'utf8');
  const files=await collectReleaseFiles(root);
  const release=makeReleaseZip(files,version,privateKey);
  const directory=path.join(root,'releases');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const target=path.join(directory,'gfit-'+version+'.zip');
  await fs.writeFile(target,release.buffer,{flag:'wx',mode:0o600});
  console.log('Atualização ZIP criada: '+target);
  console.log('Versão: '+version+' · '+release.manifest.files.length+' arquivos');
  console.log('SHA-256: '+release.sha256);
  console.log('Assinatura: Ed25519 · chave '+release.manifest.signature.keyFingerprint);
  console.log('Envie este arquivo em Administração → Atualizações. Nenhuma conexão GitHub é necessária no servidor.');
}catch(error){
  console.error('Não foi possível gerar a release: '+error.message);
  process.exitCode=1;
}
