// Ed25519 release signatures. The trusted public key lives OUTSIDE website and ZIP.
// Never accept a public key included in the release itself as trust.
import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync,sign,verify} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';

export const TRUSTED_KEY_NAME='trusted-release-key.pem';
export function privateDirectoryFor(root){
  return path.resolve(process.env.GFIT_PRIVATE_DIR ||
    path.join(homedir(),'.config','gfit',createHash('sha256').update(root).digest('hex').slice(0,16)));
}
export function trustedKeyPath(privateDir){return path.join(privateDir,TRUSTED_KEY_NAME);}
export function fingerprint(key){
  const publicKey=key?.type==='public'?key:createPublicKey(key);
  if(publicKey.asymmetricKeyType!=='ed25519')throw new Error('A chave deve usar Ed25519.');
  return createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
}
export function unsignedManifest(manifest){
  return {
    format:manifest.format,version:manifest.version,
    createdAt:manifest.createdAt,files:manifest.files,
  };
}
export function signManifest(manifest,privatePem){
  const key=createPrivateKey(privatePem);
  if(key.asymmetricKeyType!=='ed25519')throw new Error('Chave privada Ed25519 inválida.');
  const unsigned=unsignedManifest(manifest);
  const payload=Buffer.from(JSON.stringify(unsigned),'utf8');
  return {
    ...unsigned,signature:{
      algorithm:'Ed25519',
      keyFingerprint:fingerprint(key),
      value:sign(null,payload,key).toString('base64'),
    },
  };
}
export function verifyManifest(manifest,publicPem){
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest)||
    !['format','version','createdAt','files','signature'].every(x=>Object.hasOwn(manifest,x))||
    Object.keys(manifest).length!==5||
    typeof manifest.createdAt!=='string'||!Number.isFinite(Date.parse(manifest.createdAt))||
    !manifest.signature||typeof manifest.signature!=='object'||
    manifest.signature.algorithm!=='Ed25519'||
    Object.keys(manifest.signature).length!==3||
    typeof manifest.signature.value!=='string'||
    !/^[A-Za-z0-9+/]{86}==$/.test(manifest.signature.value)||
    !/^[a-f0-9]{64}$/.test(manifest.signature.keyFingerprint)){
    throw new Error('Manifesto não possui assinatura Ed25519 válida.');
  }
  const key=createPublicKey(publicPem);
  if(key.asymmetricKeyType!=='ed25519')throw new Error('Chave pública não é Ed25519.');
  if(fingerprint(key)!==manifest.signature.keyFingerprint)throw new Error('Assinatura usa uma chave diferente da chave confiável.');
  const signature=Buffer.from(manifest.signature.value,'base64');
  if(signature.length!==64 ||
     !verify(null,Buffer.from(JSON.stringify(unsignedManifest(manifest)),'utf8'),key,signature)){
    throw new Error('Assinatura do ZIP inválida. Pacote não autenticado.');
  }
  return true;
}
export async function readTrustedKey(privateDir){
  const file=trustedKeyPath(privateDir);
  let stat;
  try{stat=await fs.lstat(file);}
  catch(error){if(error.code==='ENOENT')throw new Error('Chave pública de assinatura não configurada. Consulte o guia aaPanel.');throw error;}
  if(!stat.isFile()||(process.platform!=='win32'&&(stat.mode&0o022)!==0)){
    throw new Error('Arquivo da chave pública não confiável ou gravável por terceiros.');
  }
  const pem=await fs.readFile(file,'utf8');
  fingerprint(pem);
  return pem;
}
export function createKeyPair(){
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  return {
    privatePem:privateKey.export({type:'pkcs8',format:'pem'}),
    publicPem:publicKey.export({type:'spki',format:'pem'}),
  };
}
