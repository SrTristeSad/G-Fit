#!/usr/bin/env node
// Instala uma chave PÚBLICA como única autoridade de releases na VPS aaPanel.
// Não há API HTTP de troca da chave; rotação exige intervenção do operador.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateDirectoryFor,trustedKeyPath,fingerprint} from '../aapanel/release-trust.mjs';
const [source]=process.argv.slice(2);
if(!source){
  console.error('Uso: node scripts/trust-release-key.mjs <chave-publica.pem>');
  process.exitCode=2;
}else{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const dir=privateDirectoryFor(root);
  if(dir===root||dir.startsWith(root+path.sep)){
    throw new Error('O diretório privado deve ficar fora do site.');
  }
  try{
    const pem=await fs.readFile(path.resolve(source),'utf8');
    const fp=fingerprint(pem);
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    await fs.chmod(dir,0o700);
    const dest=trustedKeyPath(dir);
    await fs.writeFile(dest,pem,{flag:'wx',mode:0o600});
    console.log('Chave pública instalada fora do site: '+dest);
    console.log('Fingerprint: '+fp);
    console.log('Reinicie o projeto no aaPanel. A chave não será trocada via ZIP.');
  }catch(error){
    console.error(error.code==='EEXIST'?'Já existe chave confiável. Troca requer revisão manual e backup.':error.message);
    process.exitCode=1;
  }
}
