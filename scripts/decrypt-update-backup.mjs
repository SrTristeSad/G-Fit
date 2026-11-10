#!/usr/bin/env node
// Recovery utility for an aaPanel ZIP-update backup. DOES NOT restore the database.
// Decrypts an authenticated PostgreSQL custom-format dump to a private location for
// manual pg_restore. Decrypted dumps contain sensitive data; protect and erase promptly.
import path from 'node:path';
import {promises as fs,createWriteStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readKey,decryptBackup} from './backup-lib.mjs';

const args=process.argv.slice(2);
const backup=args[0],keyFile=args[1],output=args[2];
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(args.length!==3){
  console.error('Uso: node scripts/decrypt-update-backup.mjs <database.gfitbak> <db-backup-key.hex> <destino.dump>');
  process.exitCode=2;
}else{
  const target=path.resolve(output);
  if(target===root||target.startsWith(root+path.sep)){
    console.error('O destino do dump descriptografado não pode ficar dentro do diretório do site.');
    process.exitCode=1;
  }else{
    try{
      const key=await readKey(path.resolve(keyFile));
      const sink=createWriteStream(target,{flags:'wx',mode:0o600});
      try{await decryptBackup(path.resolve(backup),key,sink);}
      catch(error){
        sink.destroy();
        await fs.rm(target,{force:true}).catch(()=>{});
        throw error;
      }
      const result=await fs.stat(target);
      if(result.size<64)throw new Error('Dump inesperadamente pequeno.');
      console.log('Dump PostgreSQL descriptografado em '+target);
      console.log('O arquivo contém dados sensíveis. Restrinja acesso e exclua após recuperação.');
      console.log('Use pg_restore manualmente, em banco isolado primeiro. O G-Fit não altera o banco existente.');
    }catch(error){
      console.error('Não foi possível recuperar o dump: '+error.message);
      process.exitCode=1;
    }
  }
}
