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
  const forwarded=req.headers['x-forwarded-proto'];
  if(typeof forwarded==='string' && forwarded.toLowerCase()==='https')return true;
  return isLoopback(req.socket.remoteAddress) && !forwarded;
}
export function installCodeMatches(input,code,timingSafeEqualFn) {
  if(typeof input!=='string' || !/^\d{8}$/.test(input))return false;
  return timingSafeEqualFn(Buffer.from(input),Buffer.from(code));
}
