import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedReleasePath,compareVersions,crc32,
  makeReleaseZip,readZip,validateRelease,collectReleaseFiles,MIN_RELEASE_FILES,
} from '../zip-release.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createKeyPair} from '../release-trust.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const {privatePem,publicPem}=createKeyPair();
const minimal=()=>new Map(MIN_RELEASE_FILES.map(name=>[
  name,Buffer.from(name==='package.json'?
    JSON.stringify({name:'gfit-aapanel',version:'0.1.0',
      scripts:{start:'node aapanel/launcher.mjs'}}):
    name.endsWith('package-lock.json')?
      JSON.stringify({name:'fixture',lockfileVersion:3,packages:{}}):'// fixture'),
]));
test('signed ZIP v2 with CRC32 and SHA-256 manifest roundtrips',()=>{
  const {buffer,manifest,sha256}=makeReleaseZip(minimal(),'0.1.1',privatePem);
  assert.equal(buffer.readUInt32LE(0),0x04034b50);
  assert.ok(buffer.length>200);
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  const all=readZip(buffer);
  assert.equal(all.size,manifest.files.length+1);
  const release=validateRelease(buffer,'0.1.0',publicPem);
  assert.equal(release.manifest.version,'0.1.1');
  assert.equal(release.sha256,sha256);
  assert.throws(()=>validateRelease(buffer,'0.1.1',publicPem),/versão não superior/i);
  assert.throws(()=>validateRelease(buffer,'0.2.0',publicPem),/versão não superior/i);
});
test('reject ZIP modified data, invalid paths and symlinks',()=>{
  const bytes=makeReleaseZip(minimal(),'0.1.1',privatePem).buffer;
  const modified=Buffer.from(bytes);
  modified[40]^=0xff;
  assert.throws(()=>readZip(modified));
  for(const name of ['../secrets','.env','var/updates/pending.zip','api/src/../../.env',
    '/etc/passwd','web/src\\evil','api/node_modules/x.js','aapanel/test/a.mjs',
    'scripts/secrets.key','web/dist/index.html','C:/bad.js']){
    assert.equal(allowedReleasePath(name),false,name);
  }
  assert.equal(allowedReleasePath('web/src/ReportsPanel.jsx'),true);
  const malicious=Buffer.from(bytes);
  const dir=malicious.readUInt32LE(malicious.length-6);
  malicious.writeUInt32LE((0o120777<<16)>>>0,dir+38);
  assert.throws(()=>readZip(malicious),/inseguros/);
});
test('unsigned, modified, wrong-key and incomplete packages are rejected before npm scripts',()=>{
  const {privatePem:otherPrivate,publicPem:otherPublic}=createKeyPair();
  const original=minimal();
  const good=makeReleaseZip(original,'0.1.1',privatePem);
  assert.throws(()=>makeReleaseZip(original,'0.1.1'),/Assinatura/);
  assert.throws(()=>validateRelease(good.buffer,'0.1.0'),/Chave confiável/);
  assert.throws(()=>validateRelease(good.buffer,'0.1.0',otherPublic),/chave diferente/);
  const signedByAttacker=makeReleaseZip(original,'0.1.1',otherPrivate);
  assert.throws(()=>validateRelease(signedByAttacker.buffer,'0.1.0',publicPem),/chave diferente/);
  const altered=new Map(original);
  altered.set('api/src/server.js',Buffer.from('malicious code'));
  const forged=makeReleaseZip(altered,'0.1.1',otherPrivate);
  assert.throws(()=>validateRelease(forged.buffer,'0.1.0',publicPem),/chave diferente/);
  const missing=new Map(original);
  missing.delete('api/src/security.js');
  assert.throws(()=>makeReleaseZip(missing,'0.1.1',privatePem),/incompleta/);
  missing.set('api/src/security.js',Buffer.from('// original'));
  missing.delete('web/package-lock.json');
  assert.throws(()=>makeReleaseZip(missing,'0.1.1',privatePem),/incompleta/);
});
test('version parser handles numeric ordering, not lexical ordering',()=>{
  assert.equal(compareVersions('0.1.10','0.1.9'),1);
  assert.equal(compareVersions('1.0.0','2.0.0'),-1);
  assert.equal(compareVersions('0.1.0','0.1.0'),0);
  assert.throws(()=>compareVersions('v1','0.1.0'));
});
test('real project release is complete and excludes secrets',async()=>{
  const files=await collectReleaseFiles(project);
  assert.ok(files.size>30);
  assert.equal(files.has('aapanel/launcher.mjs'),true);
  assert.equal(files.has('aapanel/update-routes.mjs'),true);
  assert.equal(files.has('aapanel/test/setup-utils.test.mjs'),false);
  assert.equal(files.has('.aapanel.env'),false);
  const zip=makeReleaseZip(files,'0.1.1',privatePem);
  assert.equal(validateRelease(zip.buffer,'0.1.0',publicPem).manifest.files.length,files.size);
});
