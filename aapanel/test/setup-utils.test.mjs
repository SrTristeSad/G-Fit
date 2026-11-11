import test from 'node:test';
import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {
  validateSetup,formatEnv,parseEnv,
  isSecureInstallerRequest,isAllowedInstallerOrigin,installCodeMatches,resolvePublicPort,
} from '../setup-utils.mjs';

const sample={
  dbHost:'127.0.0.1',dbPort:5432,dbName:'gfit',dbUser:'gfit',
  dbPassword:'db-secret-for-testing',adminEmail:'ADMIN@EXAMPLE.COM',
  adminPassword:'administrador-teste-123',adminConfirm:'administrador-teste-123',
};
test('database and first admin validation rejects unsafe values',()=>{
  const normalized=validateSetup(sample);
  assert.equal(normalized.DB_HOST,'127.0.0.1');
  assert.equal(normalized.DB_PORT,'5432');
  assert.equal(normalized.adminEmail,'admin@example.com');
  for(const changes of [
    {dbHost:'localhost; echo hi'},{dbHost:'https://localhost'},
    {dbHost:'evil\nDB_PASSWORD=bad'},{dbPort:0},{dbPort:65536},
    {dbName:'bad-name'},{dbName:'gfit;DROP TABLE'},
    {dbUser:'postgres\nNODE_ENV=x'},
    {dbPassword:'bad\ncookie=1'},
    {adminEmail:'not-an-email'},
    {adminPassword:'short',adminConfirm:'short'},
    {adminConfirm:'mismatched'},
  ]){
    assert.equal(validateSetup({...sample,...changes}),null);
  }
  assert.equal(validateSetup(null),null);
});
test('private env is unambiguous and cannot carry unescaped credentials',()=>{
  const normalized=validateSetup({...sample,dbPassword:'with="quotes"\\slash'});
  const string=formatEnv(normalized);
  assert.ok(!string.includes('ADMIN@EXAMPLE.COM'));
  assert.equal(parseEnv(string).DB_PASSWORD,'with="quotes"\\slash');
  assert.equal(parseEnv(string).BIND_HOST,'127.0.0.1');
  assert.equal(parseEnv(string).COOKIE_SECURE,'true');
  assert.throws(()=>parseEnv(string.replace('BIND_HOST="127.0.0.1"','BIND_HOST="0.0.0.0"')));
  assert.throws(()=>parseEnv('DB_HOST="localhost"\nDB_HOST="localhost"'));
});
test('installer code is constant-time compared after validation',()=>{
  assert.equal(installCodeMatches('12345678','12345678',timingSafeEqual),true);
  assert.equal(installCodeMatches('12345679','12345678',timingSafeEqual),false);
  assert.equal(installCodeMatches('bad','12345678',timingSafeEqual),false);
});
test('setup rejects plain HTTP mapped domains; allows local SSH tunnel and TLS mapping',()=>{
  const req=(host,proto,addr='127.0.0.1')=>({
    headers:{host,...(proto===undefined?{}:{'x-forwarded-proto':proto})},
    socket:{remoteAddress:addr},
  });
  assert.equal(isSecureInstallerRequest(req('127.0.0.1:3333')),true);
  assert.equal(isSecureInstallerRequest(req('localhost:3333')),true);
  assert.equal(isSecureInstallerRequest(req('example.com','http')),false);
  assert.equal(isSecureInstallerRequest(req('example.com')),false);
  assert.equal(isSecureInstallerRequest(req('example.com','https')),true);
  assert.equal(isSecureInstallerRequest(req('example.com','https','1.2.3.4')),false);
});

test('installer same-origin is preserved when aaPanel rewrites upstream Host',()=>{
  const req=(origin,host='127.0.0.1:3344',site='same-origin',proto='https')=>({
    headers:{origin,host,'x-forwarded-proto':proto,'sec-fetch-site':site},
  });
  const browserOrigin='https://livro.snulog.shop';
  assert.equal(isAllowedInstallerOrigin(req(browserOrigin)),true);
  assert.equal(isAllowedInstallerOrigin(req(browserOrigin,'livro.snulog.shop',undefined)),true);
  assert.equal(isAllowedInstallerOrigin(req(browserOrigin,'127.0.0.1:3344','cross-site')),false);
  assert.equal(isAllowedInstallerOrigin(req(browserOrigin,'127.0.0.1:3344','same-site')),false);
  assert.equal(isAllowedInstallerOrigin(req(browserOrigin,'127.0.0.1:3344',undefined)),false);
  assert.equal(isAllowedInstallerOrigin(req('https://evil.example','livro.snulog.shop','cross-site')),false);
  assert.equal(isAllowedInstallerOrigin(req('http://livro.snulog.shop','127.0.0.1:3344','same-origin')),false);
  assert.equal(isAllowedInstallerOrigin(req('null')),false);
  assert.equal(isAllowedInstallerOrigin(req('https://livro.snulog.shop/malicious')),false);
  assert.equal(isAllowedInstallerOrigin(req(undefined)),true);
});

test('aaPanel public port honors CLI, GFIT_PORT and standard PORT without source edits',()=>{
  assert.equal(resolvePublicPort(),3344);
  // A antiga porta permanece disponível quando escolhida explicitamente.
  assert.equal(resolvePublicPort({argv:['--port=3333']}),3333);
  assert.equal(resolvePublicPort({env:{PORT:'3344'}}),3344);
  assert.equal(resolvePublicPort({env:{GFIT_PORT:'3355',PORT:'3344'}}),3355);
  assert.equal(resolvePublicPort({argv:['--port','3366'],env:{GFIT_PORT:'3355'}}),3366);
  assert.equal(resolvePublicPort({argv:['--port=3377'],env:{PORT:'3344'}}),3377);
  for(const wrong of ['0','443','65536','abc','3333; echo danger','-1','3.5','']){
    assert.throws(()=>resolvePublicPort({env:{PORT:wrong}}),/Porta inválida/);
  }
  assert.throws(()=>resolvePublicPort({argv:['--port']}),/Informe um número/);
  assert.throws(()=>resolvePublicPort({argv:['--port=3377','--port=3378']}),/apenas uma/);
});
