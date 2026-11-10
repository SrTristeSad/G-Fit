#!/usr/bin/env node
// Execute no computador de desenvolvimento, FORA do diretório do repositório.
// A chave privada NUNCA deve ser copiada para o servidor aaPanel.
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createKeyPair,fingerprint} from '../aapanel/release-trust.mjs';
const [privateName,publicName]=process.argv.slice(2);
if(!privateName||!publicName||path.resolve(privateName)===path.resolve(publicName)){
  console.error('Uso: node scripts/generate-release-keys.mjs <chave-privada.pem> <chave-publica.pem>');
  process.exitCode=2;
}else{
  const privatePath=path.resolve(privateName),publicPath=path.resolve(publicName);
  try{
    // Não abrir arquivos existentes nem gerar segredos dentro do projeto.
    const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
    if([privatePath,publicPath].some(p=>p===root||p.startsWith(root+path.sep))){
      throw new Error('Salve ambas as chaves fora da pasta G-Fit.');
    }
    const pair=createKeyPair();
    await fs.mkdir(path.dirname(privatePath),{recursive:true,mode:0o700});
    await fs.mkdir(path.dirname(publicPath),{recursive:true,mode:0o700});
    await fs.writeFile(privatePath,pair.privatePem,{flag:'wx',mode:0o600});
    try{await fs.writeFile(publicPath,pair.publicPem,{flag:'wx',mode:0o644});}
    catch(error){await fs.rm(privatePath,{force:true});throw error;}
    console.log('Par Ed25519 criado; nenhum arquivo existente foi substituído.');
    console.log('Fingerprint SHA-256 da chave pública: '+fingerprint(pair.publicPem));
    console.log('Chave privada: mantenha somente no computador de geração de ZIP, com backup seguro.');
    console.log('Chave pública: instale uma vez na VPS para validar as releases.');
  }catch(error){console.error('Erro: '+error.message);process.exitCode=1;}
}
