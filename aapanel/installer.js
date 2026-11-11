const form=document.getElementById('setup-form');
const installPanel=document.getElementById('install-panel');
const progressPanel=document.getElementById('progress-panel');
const submit=document.getElementById('submit');
const message=document.getElementById('message');
const phase=document.getElementById('phase');
const retry=document.getElementById('retry');
const openApp=document.getElementById('open-app');
const field=name=>document.getElementById(name).value;
const generateKeyButton=document.getElementById('generate-key');
const downloadKeyButton=document.getElementById('download-key');
const keyStatus=document.getElementById('key-status');
const keyFingerprint=document.getElementById('key-fingerprint');
const keyBackedUp=document.getElementById('key-backed-up');
let publicSigningKey=null;
let privateSigningKey=null;

// CryptoKey generation runs inside HTTPS WebCrypto; the private key is never
// sent to the backend, stored in localStorage or saved on the aaPanel server.
function pemFor(bytes,label){
  const data=String.fromCharCode(...new Uint8Array(bytes));
  const encoded=btoa(data);
  return '-----BEGIN '+label+'-----\\n'+
    (encoded.match(/.{1,64}/g)||[]).join('\\n')+
    '\\n-----END '+label+'-----\\n';
}
function downloadPrivateKey(){
  if(!privateSigningKey)return;
  const blob=new Blob([privateSigningKey],{type:'application/x-pem-file'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download='gfit-chave-privada-atualizacoes.pem';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),30000);
}
generateKeyButton.addEventListener('click',async()=>{
  generateKeyButton.disabled=true;
  keyBackedUp.checked=false;
  keyBackedUp.disabled=true;
  publicSigningKey=null;
  privateSigningKey=null;
  downloadKeyButton.classList.add('hidden');
  keyFingerprint.classList.add('hidden');
  keyStatus.classList.remove('hidden');
  keyStatus.textContent='Gerando par de chaves no navegador…';
  try{
    if(!window.isSecureContext || !crypto?.subtle){
      throw new Error('Use HTTPS ou localhost para gerar as chaves com segurança.');
    }
    const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
    const [pub,priv]=await Promise.all([
      crypto.subtle.exportKey('spki',keys.publicKey),
      crypto.subtle.exportKey('pkcs8',keys.privateKey),
    ]);
    // Confirm that the pair really works before presenting it.
    const proof=new TextEncoder().encode('G-Fit signing key verification');
    const signature=await crypto.subtle.sign('Ed25519',keys.privateKey,proof);
    if(!await crypto.subtle.verify('Ed25519',keys.publicKey,signature,proof)){
      throw new Error('O par de chaves falhou na verificação local.');
    }
    const digest=await crypto.subtle.digest('SHA-256',pub);
    const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    publicSigningKey=pemFor(pub,'PUBLIC KEY');
    privateSigningKey=pemFor(priv,'PRIVATE KEY');
    keyStatus.textContent='Chave criada neste navegador. Salve o arquivo baixado e confirme o backup antes de instalar.';
    keyFingerprint.textContent='Fingerprint SHA-256: '+fingerprint;
    keyFingerprint.classList.remove('hidden');
    downloadKeyButton.classList.remove('hidden');
    keyBackedUp.disabled=false;
    downloadPrivateKey();
  }catch(error){
    keyStatus.textContent='Não foi possível gerar chaves Ed25519: '+error.message+
      ' Atualize seu navegador e tente novamente.';
  }finally{
    generateKeyButton.disabled=false;
  }
});
downloadKeyButton.addEventListener('click',downloadPrivateKey);

async function post(path,payload){
  const response=await fetch(path,{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload),
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Erro ao comunicar com o instalador.');
  return body;
}
function showError(text){
  message.classList.remove('hidden');
  message.classList.add('error');
  message.textContent=text;
}
function showProgress(){
  installPanel.classList.add('hidden');
  progressPanel.classList.remove('hidden');
  retry.classList.add('hidden');
  openApp.classList.add('hidden');
}
function succeeded(){
  phase.classList.remove('error');
  phase.textContent='Instalação concluída! API, banco e painel estão disponíveis.';
  retry.classList.add('hidden');
  openApp.classList.remove('hidden');
  openApp.focus();
}
function failed(error){
  phase.textContent=error;
  phase.classList.add('error');
  retry.classList.remove('hidden');
}
retry.addEventListener('click',()=>{
  progressPanel.classList.add('hidden');
  installPanel.classList.remove('hidden');
  submit.disabled=false;
  phase.classList.remove('error');
});
async function ready(){
  try{
    const res=await fetch('/api/health',{cache:'no-store'});
    const data=await res.json();
    return res.ok&&data.status==='ok';
  }catch{return false;}
}
async function polling(code){
  for(let i=0;i<1800;i++){
    await new Promise(resolve=>setTimeout(resolve,2000));
    try{
      const state=await post('/setup/status',{code});
      phase.textContent=state.phase||'Instalando…';
      if(state.installed){succeeded();return;}
      if(!state.running&&state.error){failed(state.error);return;}
    }catch(err){
      // Após a instalação, as rotas /setup deixam de existir.
      if(await ready()){succeeded();return;}
      failed('Não foi possível consultar o instalador. Confira o log do aaPanel: '+err.message);
      return;
    }
  }
  failed('O tempo de acompanhamento na página foi excedido. Consulte o log do aaPanel.');
}
form.addEventListener('submit',async e=>{
  e.preventDefault();
  message.classList.add('hidden');
  message.classList.remove('error');
  const fields=['dbHost','dbName','dbUser','dbPassword','adminEmail','adminPassword','adminConfirm'];
  const input=Object.fromEntries(fields.map(name=>[name,field(name)]));
  input.dbPort=Number(field('dbPort'));
  input.code=field('code').trim();
  if(!publicSigningKey || !keyBackedUp.checked){
    showError('Gere a chave de atualizações, salve a chave privada e confirme o backup antes de instalar.');
    return;
  }
  input.releasePublicKey=publicSigningKey;
  if(input.adminPassword!==input.adminConfirm){
    showError('As senhas do administrador não coincidem.');return;
  }
  submit.disabled=true;
  try{
    await post('/setup/install',input);
    // The private key has already been downloaded and confirmed; no longer
    // needed in the page memory. Only the public key crossed the network.
    privateSigningKey=null;
    downloadKeyButton.classList.add('hidden');
    // Limpar senhas do HTML: mantidas somente em memória pelo processo instalador.
    for(const name of ['dbPassword','adminPassword','adminConfirm']){
      document.getElementById(name).value='';
    }
    showProgress();
    phase.textContent='Iniciando instalação de dependências…';
    await polling(input.code);
  }catch(err){
    showError(err.message);
    submit.disabled=false;
  }
});
