// Helpers without dependencies; shared by aaPanel installer and its tests.
export const DB_KEYS = ['DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'];
export function validateSetup(value) {
  if(!value || typeof value !== 'object' || Array.isArray(value))return null;
  const {dbHost, dbPort, dbName, dbUser, dbPassword,adminEmail,adminPassword,adminConfirm}=value;
  if(typeof dbHost!=='string'||dbHost.length>255||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(dbHost) ||
    dbHost.includes('..') ||
    !Number.isInteger(Number(dbPort))||Number(dbPort)<1||Number(dbPort)>65535 ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(dbName||'') ||
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(dbUser||'') ||
    typeof dbPassword!=='string'||dbPassword.length<1||dbPassword.length>256||
    /[\r\n\0]/.test(dbPassword) ||
    typeof adminEmail!=='string'||adminEmail.length>254||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail) ||
    typeof adminPassword!=='string'||adminPassword.length<10||adminPassword.length>128||
    adminPassword!==adminConfirm) return null;
  return {
    DB_HOST:dbHost,DB_PORT:String(Number(dbPort)),DB_NAME:dbName,
    DB_USER:dbUser,DB_PASSWORD:dbPassword,
    adminEmail:adminEmail.toLowerCase().trim(),adminPassword,
  };
}
export function formatEnv(settings) {
  const result={};
  for(const name of DB_KEYS)result[name]=settings[name];
  result.NODE_ENV='production';
  result.PORT='3001';
  result.BIND_HOST='127.0.0.1';
  result.COOKIE_SECURE='true';
  // Keep values as JSON strings, compatible with this launcher's own parser.
  return Object.entries(result).map(([key,v])=>key+'='+JSON.stringify(v)).join('\n')+'\n';
}
export function parseEnv(text) {
  const env={};
  for(const line of text.split(/\r?\n/)){
    if(!line.trim()||line.trimStart().startsWith('#'))continue;
    const i=line.indexOf('=');
    if(i===-1)throw new Error('Arquivo de configuração inválido.');
    const key=line.slice(0,i);
    if(!/^[A-Z_]+$/.test(key) || Object.hasOwn(env,key))throw new Error('Chave de configuração inválida.');
    const raw=line.slice(i+1);
    const value=JSON.parse(raw);
    if(typeof value!=='string')throw new Error('Valor de configuração inválido.');
    env[key]=value;
  }
  for(const key of DB_KEYS)if(!env[key])throw new Error('Configuração de banco incompleta.');
  if(env.PORT!=='3001'||env.BIND_HOST!=='127.0.0.1'||env.COOKIE_SECURE!=='true'){
    throw new Error('Configuração de rede insegura.');
  }
  return env;
}
export function isLoopback(addr) {
  return addr==='127.0.0.1'||addr==='::1'||addr==='::ffff:127.0.0.1';
}
export function isSecureInstallerRequest(req) {
  // The service listens on loopback, so only aaPanel Nginx or a local SSH tunnel
  // can reach it. aaPanel must replace X-Forwarded-Proto with the real scheme.
  if(!isLoopback(req.socket.remoteAddress))return false;
  const forwarded=req.headers['x-forwarded-proto'];
  if(forwarded==='https')return true;
  const host=(req.headers.host||'').toLowerCase();
  // A browser on an HTTP aaPanel domain must NEVER submit setup credentials.
  return (!forwarded || forwarded==='http') &&
    /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host);
}
// Resolves the aaPanel project listener without requiring source edits.
// Explicit launcher flag > GFIT_PORT > platform PORT > legacy default.
// The aaPanel Mapping target must use this same public port.
export function resolvePublicPort({argv=[],env={}}={}){
  const flags=argv.filter(x=>x==='--port'||x.startsWith('--port='));
  let cli=null;
  if(flags.length>1)throw new Error('Informe apenas uma opção --port.');
  if(flags[0]==='--port'){
    const index=argv.indexOf('--port');
    cli=argv[index+1];
    if(cli==null||cli.startsWith('-'))throw new Error('Informe um número após --port.');
  }else if(flags.length){
    cli=flags[0].slice('--port='.length);
  }
  const raw=cli ?? env.GFIT_PORT ?? env.PORT ?? '3333';
  if(typeof raw!=='string'&&typeof raw!=='number')throw new Error('Porta inválida.');
  const value=String(raw);
  if(!/^\\d{1,5}$/.test(value))throw new Error('Porta inválida: use um número entre 1024 e 65535.');
  const port=Number(value);
  if(!Number.isSafeInteger(port)||port<1024||port>65535){
    throw new Error('Porta inválida: use um número entre 1024 e 65535.');
  }
  return port;
}

export function installCodeMatches(input,code,timingSafeEqualFn) {
  if(typeof input!=='string' || !/^\d{8}$/.test(input))return false;
  return timingSafeEqualFn(Buffer.from(input),Buffer.from(code));
}
