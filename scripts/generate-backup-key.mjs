#!/usr/bin/env node
// Cria chave exclusiva de 32 bytes fora do Git e nunca a substitui.
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const filename=process.argv[2];
if(!filename) {
  console.error('Uso: node scripts/generate-backup-key.mjs <caminho-da-chave-fora-do-repo>');
  process.exitCode=2;
}else{
  try{
    const dest=path.resolve(filename);
    await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
    await fs.writeFile(dest,randomBytes(32).toString('hex')+'\n',{
      flag:'wx',mode:0o600,
    });
    console.log('Chave gerada em '+dest+'. Guarde uma cópia segura, SEPARADA dos backups.');
    console.log('Sem esta chave, os backups criptografados são irrecuperáveis.');
  }catch(error){
    console.error(error.code==='EEXIST'?
      'O arquivo de chave já existe. Nada foi substituído.':
      'Não foi possível criar a chave: '+error.message);
    process.exitCode=1;
  }
}
