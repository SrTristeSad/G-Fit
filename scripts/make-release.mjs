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
try{
  const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  if(!version||compareVersions(version,pkg.version)<=0){
    throw new Error('Informe --version MAJOR.MINOR.PATCH superior a '+pkg.version+'.');
  }
  const files=await collectReleaseFiles(root);
  const release=makeReleaseZip(files,version);
  const directory=path.join(root,'releases');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const target=path.join(directory,'gfit-'+version+'.zip');
  await fs.writeFile(target,release.buffer,{flag:'wx',mode:0o600});
  console.log('Atualização ZIP criada: '+target);
  console.log('Versão: '+version+' · '+release.manifest.files.length+' arquivos');
  console.log('SHA-256: '+release.sha256);
  console.log('Envie este arquivo em Administração → Atualizações. Nenhuma conexão GitHub é necessária no servidor.');
}catch(error){
  console.error('Não foi possível gerar a release: '+error.message);
  process.exitCode=1;
}
