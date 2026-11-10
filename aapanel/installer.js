const form=document.getElementById('setup-form');
const installPanel=document.getElementById('install-panel');
const progressPanel=document.getElementById('progress-panel');
const submit=document.getElementById('submit');
const message=document.getElementById('message');
const phase=document.getElementById('phase');
const retry=document.getElementById('retry');
const openApp=document.getElementById('open-app');
const field=name=>document.getElementById(name).value;

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
  if(input.adminPassword!==input.adminConfirm){
    showError('As senhas do administrador não coincidem.');return;
  }
  submit.disabled=true;
  try{
    await post('/setup/install',input);
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
