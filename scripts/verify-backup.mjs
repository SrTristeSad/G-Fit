#!/usr/bin/env node
// Verifica tag GCM de TODO o backup sem restaurar ou gravar conteúdo em disco.
import path from 'node:path';
import { readKey, verifyBackup } from './backup-lib.mjs';

const [name,keyName]=process.argv.slice(2);
if(!name||!keyName){
  console.error('Uso: node scripts/verify-backup.mjs <arquivo.gfitbak> <chave>');
  process.exitCode=2;
}else{
  try{
    const key=await readKey(path.resolve(keyName));
    const size=await verifyBackup(path.resolve(name),key);
    console.log('Backup íntegro e autenticado. Dados descriptografados verificados: '+size+' bytes.');
    console.log('Esta verificação não substitui o teste de restauração.');
  }catch(error){
    console.error('Backup não verificado: '+error.message);
    process.exitCode=1;
  }
}
