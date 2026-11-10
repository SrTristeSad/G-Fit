#!/usr/bin/env node
// Restauração somente em banco TEMPORÁRIO, nunca em gfit.
// O banco temporário é destruído no final, inclusive se a validação falhar.
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readKey, verifyBackup, dockerCapture, restoreToIsolatedDatabase } from './backup-lib.mjs';

const [name,keyName]=process.argv.slice(2);
if(!name||!keyName){
  console.error('Uso: node scripts/restore-check.mjs <arquivo.gfitbak> <chave>');
  process.exitCode=2;
}else{
  const dbName='gfit_restore_check_'+randomBytes(6).toString('hex');
  let created=false;
  try{
    const key=await readKey(path.resolve(keyName));
    const filename=path.resolve(name);
    const bytes=await verifyBackup(filename,key);
    console.log('Integridade autenticada: '+bytes+' bytes. Criando banco temporário isolado.');
    await dockerCapture(['createdb','--username=gfit',dbName]);
    created=true;
    await restoreToIsolatedDatabase(filename,key,dbName);
    const query=[
      'SELECT json_build_object(',
      "'teachers',(SELECT count(*) FROM teachers),",
      "'students',(SELECT count(*) FROM students),",
      "'assessments',(SELECT count(*) FROM functional_assessments),",
      "'privacyRequests',(SELECT count(*) FROM student_erasure_requests),",
      "'studentExports',(SELECT count(*) FROM student_data_exports)",
      ')',
    ].join(' ');
    const raw=await dockerCapture([
      'psql','--username=gfit','--dbname='+dbName,
      '--no-psqlrc','--tuples-only','--no-align','--set=ON_ERROR_STOP=1',
      '--command='+query,
    ]);
    const counts=JSON.parse(raw);
    for(const [name,value] of Object.entries(counts)){
      if(!Number.isSafeInteger(value)||value<0)throw new Error(
        'Tabela restaurada com contagem inválida: '+name,
      );
    }
    console.log('Restauração testada com sucesso. Totais não sensíveis: '+JSON.stringify(counts));
    console.log('Banco original gfit não foi modificado.');
  }catch(error){
    console.error('Falha no teste de restauração: '+error.message);
    process.exitCode=1;
  }finally{
    if(created){
      try{
        await dockerCapture(['dropdb','--username=gfit','--if-exists',dbName]);
        console.log('Banco temporário de teste excluído.');
      }catch(error){
        console.error('ALERTA: falhou limpeza do banco temporário '+dbName+': '+error.message);
        process.exitCode=1;
      }
    }
  }
}
