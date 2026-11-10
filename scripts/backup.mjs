#!/usr/bin/env node
// Backup autenticado e criptografado do banco G-Fit, sem expor dados no terminal.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readKey, saveEncryptedBackup } from './backup-lib.mjs';

const [name,keyName]=process.argv.slice(2);
if(!name||!keyName){
  console.error('Uso: node scripts/backup.mjs <destino.gfitbak> <chave>');
  process.exitCode=2;
}else{
  try{
    const target=path.resolve(name);
    const key=await readKey(path.resolve(keyName));
    await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
    // Não salvar backup em um caminho com mesma extensão e nome de chave.
    if(target===path.resolve(keyName))throw new Error('Backup não pode sobrescrever a chave.');
    await saveEncryptedBackup(target,key);
    const bytes=(await fs.stat(target)).size;
    console.log('Backup criptografado e autenticado criado: '+target);
    console.log('Arquivo: '+bytes+' bytes. Chave e banco não foram modificados.');
  }catch(error){
    console.error('Falha no backup: '+error.message);
    process.exitCode=1;
  }
}
