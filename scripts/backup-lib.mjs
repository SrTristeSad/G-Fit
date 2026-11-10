// Rotinas de backup locais: somente APIs nativas do Node.js, sem dependências.
// Formato: magic (8 bytes) + IV GCM (12) + ciphertext + tag GCM (16).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const MAGIC=Buffer.from('GFITBK01','ascii');
const IV_BYTES=12;
const TAG_BYTES=16;
const HEADER_BYTES=MAGIC.length+IV_BYTES;

export async function readKey(filename) {
  if (!filename)throw new Error('Informe o caminho da chave, separado do repositório.');
  const file=await fs.stat(filename);
  if(!file.isFile())throw new Error('A chave precisa ser um arquivo regular.');
  if(process.platform!=='win32' && (file.mode & 0o077)!==0) {
    throw new Error('Permissões inseguras da chave. Use chmod 600 no arquivo.');
  }
  const contents=await fs.readFile(filename,'utf8');
  if(!/^[a-f0-9]{64}\r?\n?$/i.test(contents)) {
    throw new Error('Chave inválida: são necessários 32 bytes aleatórios em hexadecimal.');
  }
  return Buffer.from(contents.trim(),'hex');
}
export function newIv() {return randomBytes(IV_BYTES);}
export function encryptStream(key,iv) {
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(MAGIC);
  return new Transform({
    transform(chunk,_enc,callback){
      try{callback(null,cipher.update(chunk));}
      catch(error){callback(error);}
    },
    flush(callback){
      try{
        this.push(cipher.final());
        this.push(cipher.getAuthTag());
        callback();
      }catch(error){callback(error);}
    },
  });
}
export async function decryptMetadata(filename) {
  const fd=await fs.open(filename,'r');
  try{
    const {size}=await fd.stat();
    if(size<HEADER_BYTES+TAG_BYTES+1)throw new Error('Backup incompleto.');
    const header=Buffer.alloc(HEADER_BYTES);
    const tag=Buffer.alloc(TAG_BYTES);
    await fd.read(header,0,HEADER_BYTES,0);
    await fd.read(tag,0,TAG_BYTES,size-TAG_BYTES);
    if(!header.subarray(0,MAGIC.length).equals(MAGIC)) {
      throw new Error('Cabeçalho não reconhecido. Não é um backup G-Fit válido.');
    }
    return {iv:header.subarray(MAGIC.length),tag,offset:HEADER_BYTES,end:size-TAG_BYTES-1};
  }finally{await fd.close();}
}
export async function decryptBackup(filename,key,sink){
  const {iv,tag,offset,end}=await decryptMetadata(filename);
  const decipher=createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(filename,{start:offset,end}),decipher,sink);
}
export async function verifyBackup(filename,key){
  let bytes=0;
  const sink=new Writable({
    write(chunk,_enc,callback){bytes+=chunk.length;callback();},
  });
  await decryptBackup(filename,key,sink);
  if(bytes<64)throw new Error('Conteúdo descriptografado inesperadamente curto.');
  return bytes;
}
export function dockerDb(args,{stdin='ignore'}={}){
  const child=spawn('docker',['compose','exec','-T','db',...args],{
    stdio:[stdin,'pipe','pipe'],windowsHide:true,
  });
  let errors='';
  child.stderr.on('data',c=>{errors=(errors+c.toString('utf8')).slice(-1500);});
  const done=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>{
      if(code===0)resolve();
      else reject(new Error('Comando do PostgreSQL falhou ('+code+'): '+errors.trim()));
    });
  });
  // Marca o erro como observado mesmo quando outra operação de stream falhar antes.
  done.catch(()=>{});
  return {child,done};
}
export async function dockerCapture(args){
  const {child,done}=dockerDb(args);
  let result='';
  for await(const part of child.stdout){
    result+=part.toString('utf8');
    if(result.length>100000) {
      child.kill();
      throw new Error('Saída do PostgreSQL excedeu o tamanho esperado.');
    }
  }
  await done;
  return result.trim();
}
export async function saveEncryptedBackup(target,key){
  const temp=target+'.'+randomBytes(6).toString('hex')+'.partial';
  const iv=newIv();
  let created=false;
  try{
    const output=createWriteStream(temp,{flags:'wx',mode:0o600});
    created=true;
    output.write(Buffer.concat([MAGIC,iv]));
    const {child,done}=dockerDb([
      'pg_dump','--format=custom','--no-owner','--no-privileges',
      '--username=gfit','--dbname=gfit',
    ]);
    try{
      await Promise.all([pipeline(child.stdout,encryptStream(key,iv),output),done]);
    }catch(error){
      child.kill();
      throw error;
    }
    // Confirme autenticação antes de publicar o arquivo definitivo.
    await verifyBackup(temp,key);
    // Link exclusivo garante que um backup existente nunca seja sobrescrito.
    await fs.link(temp,target);
    await fs.unlink(temp);
  }catch(error){
    if(created)await fs.rm(temp,{force:true}).catch(()=>{});
    throw error;
  }
}
export async function restoreToIsolatedDatabase(filename,key,database){
  // Não iniciar restore sem autenticar TODOS os bytes primeiro.
  await verifyBackup(filename,key);
  const {child,done}=dockerDb([
    'pg_restore','--exit-on-error','--no-owner','--no-acl',
    '--username=gfit','--dbname='+database,
  ],{stdin:'pipe'});
  try{
    await Promise.all([decryptBackup(filename,key,child.stdin),done]);
  }catch(error){
    child.kill();
    throw error;
  }
}
