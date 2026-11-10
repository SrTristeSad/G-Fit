import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedReleasePath,compareVersions,crc32,
  makeReleaseZip,readZip,validateRelease,collectReleaseFiles,
} from '../zip-release.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const minimal=()=>new Map([
  ...['package.json','api/package.json','web/package.json','api/src/server.js',
    'api/src/db.js','aapanel/launcher.mjs','aapanel/update-routes.mjs',
    'aapanel/update-core.mjs','aapanel/zip-release.mjs','web/index.html',
    'web/vite.config.js','web/src/main.jsx','scripts/make-release.mjs'].map(
    name=>[name,Buffer.from(name==='package.json'?
      JSON.stringify({name:'gfit-aapanel',version:'0.1.0',
        scripts:{start:'node aapanel/launcher.mjs'}}):'// fixture')],
  ),
]);
test('ZIP v1 with CRC32 and SHA-256 manifest roundtrips',()=>{
  const {buffer,manifest,sha256}=makeReleaseZip(minimal(),'0.1.1');
  assert.equal(buffer.readUInt32LE(0),0x04034b50);
  assert.ok(buffer.length>200);
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  const all=readZip(buffer);
  assert.equal(all.size,manifest.files.length+1);
  const release=validateRelease(buffer,'0.1.0');
  assert.equal(release.manifest.version,'0.1.1');
  assert.equal(release.sha256,sha256);
  assert.throws(()=>validateRelease(buffer,'0.1.1'),/versão não superior/i);
  assert.throws(()=>validateRelease(buffer,'0.2.0'),/versão não superior/i);
});
test('reject ZIP modified data, invalid paths and symlinks',()=>{
  const bytes=makeReleaseZip(minimal(),'0.1.1').buffer;
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
  const zip=makeReleaseZip(files,'0.1.1');
  assert.equal(validateRelease(zip.buffer,'0.1.0').manifest.files.length,files.size);
});
