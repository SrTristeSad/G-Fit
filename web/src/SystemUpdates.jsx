import React,{useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api.js';

const statuses={
  uploaded:'Recebido',preparing:'Preparando',prepared:'Pronto para ativar',
  applying:'Ativando',applied:'Ativado',failed:'Falhou na ativação',
  failed_prepare:'Falhou na preparação',
};
const date=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
export default function SystemUpdates(){
  const [data,setData]=useState(null);
  const [file,setFile]=useState(null);
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [transient,setTransient]=useState(false);
  const uploader=useRef(null);

  const refresh=useCallback(async()=>{
    try{
      const result=await api('/api/admin/system/update');
      setData(result);
      setTransient(false);
    }catch(err){
      setTransient(true);
      // The API restarts briefly when a ZIP update is being activated.
    }
  },[]);
  useEffect(()=>{
    void refresh();
    const interval=setInterval(()=>{void refresh();},3500);
    return()=>clearInterval(interval);
  },[refresh]);
  const pending=data?.pending;
  const enabled=data?.supported;
  const working=['preparing','applying','uploaded'].includes(pending?.status);
  const requirePassword=()=>{
    if(password.length<10){setError('Informe sua senha administrativa atual.');return false;}
    return true;
  };
  async function sendAction(endpoint,body,message){
    if(!requirePassword())return;
    setBusy(true);setError('');setSuccess('');
    try{
      await api('/api/admin/system/update/'+endpoint,{
        method:'POST',
        headers:{'X-GFit-Admin-Password':encodeURIComponent(password)},
        body:JSON.stringify(body),
      });
      setPassword('');
      setConfirmation('');
      setSuccess(message);
      await refresh();
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  async function upload(event){
    event.preventDefault();
    if(!file||!requirePassword())return;
    if(file.size>32*1024*1024){
      setError('O ZIP excede 32 MiB.');return;
    }
    if(!window.confirm(
      'O ZIP executará código com os privilégios do aplicativo. Verifique a origem do pacote antes de continuar.',
    ))return;
    setBusy(true);setError('');setSuccess('');
    try{
      const response=await fetch('/api/admin/system/update/upload',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/zip','X-GFit-Admin-Password':encodeURIComponent(password)},
        body:file,
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(payload.error||'Falha ao enviar ZIP.');
      setSuccess('Pacote recebido para preparação. A instalação atual continua funcionando.');
      setFile(null);
      if(uploader.current)uploader.current.value='';
      setPassword('');
      await refresh();
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  async function apply(){
    if(confirmation!=='APLICAR'){setError('Digite exatamente APLICAR.');return;}
    if(!window.confirm(
      'Ativar a atualização? A API ficará indisponível temporariamente. '+
      'Uma cópia do banco e do código será criada antes da alteração. '+
      'Um rollback automático do código NÃO restaura alterações no banco.',
    ))return;
    await sendAction('apply',{id:pending.id,confirmation:'APLICAR'},
      'Ativação solicitada. Aguarde a verificação; depois reinicie o Node.js Project no aaPanel.');
  }
  async function discard(){
    if(!window.confirm('Descartar o ZIP pendente? A versão instalada não será alterada.'))return;
    await sendAction('discard',{confirmation:'DESCARTAR'},'Pacote pendente descartado.');
  }
  return <section className="stack">
    <div className="card">
      <div className="eyebrow">Administração · Sistema</div>
      <h2>Atualizações por arquivo ZIP</h2>
      <p className="muted">
        Atualize o G-Fit sem GitHub, sem Git e sem terminal na VPS.
        Selecione um ZIP de release, valide e prepare o pacote, depois confirme a ativação.
      </p>
      <p className="notice">
        <strong>Atenção:</strong> o arquivo não possui assinatura digital de um distribuidor.
        CRC e SHA-256 detectam alterações acidentais, mas não provam que a origem é confiável.
        Instale apenas pacotes gerados e revisados por você. Não envie dados de alunos, chaves ou
        arquivos de banco dentro do ZIP.
      </p>
      {transient&&<p className="notice" role="status">
        A API está temporariamente indisponível. Se a atualização estiver em andamento,
        aguarde o serviço retornar. Acompanhe os logs do aaPanel em caso de falha.
      </p>}
      {error&&<p className="error" role="alert">{error}</p>}
      {success&&<p className="saved-message" role="status">{success}</p>}
      {!data?<p>Consultando o instalador…</p>:
        !enabled?<p className="notice">{data.message||
          'Atualizações ZIP exigem hospedagem pelo instalador aaPanel, não Docker.'}</p>:
        <>
          <div className="update-version">
            <div><small>Versão instalada</small><strong>{data.currentVersion}</strong></div>
            <div><small>Método de atualização</small><strong>ZIP local</strong></div>
          </div>
          <label>Senha atual do administrador (exigida para cada operação)
            <input type="password" autoComplete="off" value={password}
              onChange={e=>setPassword(e.target.value)} minLength={10} maxLength={128}
              placeholder="Confirme sua senha antes de enviar ou aplicar"/>
          </label>
          {!pending||['failed','applied'].includes(pending.status)?(
            <form onSubmit={upload} className="stack update-upload-form">
              <label>Arquivo ZIP de atualização
                <input ref={uploader} type="file" accept=".zip,application/zip" required
                  onChange={e=>setFile(e.target.files?.[0]||null)}/>
              </label>
              <small className="muted">Tamanho máximo: 32 MiB. Envie o ZIP completo criado por
                <code> npm run release:zip -- --version X.Y.Z</code>.
              </small>
              <button type="submit" className="primary" disabled={busy||!file}>
                {busy?'Enviando…':'Enviar ZIP e preparar versão'}
              </button>
            </form>
          ):null}
          {pending&&<div className="update-pending">
            <h3>Pacote {statuses[pending.status]||pending.status}</h3>
            <div className="update-version">
              <div><small>Versão recebida</small><strong>{pending.version}</strong></div>
              <div><small>Enviado em</small><strong>{date(pending.createdAt)}</strong></div>
            </div>
            <p><strong>Etapa:</strong> {pending.phase}</p>
            <p className="muted">SHA-256: <code className="update-sha">{pending.sha256}</code></p>
            <progress max="100" value={pending.progress||0}
              aria-label="Progresso da atualização"/>
            {pending.error&&<p className="error" role="alert">{pending.error}</p>}
            {pending.status==='prepared'&&<>
              <p className="notice">
                O ZIP foi extraído em área privada, as dependências foram instaladas e o React
                compilado, sem alterar a instalação atual. Ao ativar, o servidor criará um
                backup do PostgreSQL e do código, interromperá a API brevemente e verificará
                a nova versão. Se falhar, tentará restaurar automaticamente o código anterior;
                a restauração do banco continua sendo um procedimento manual.
              </p>
              <label>Para autorizar a ativação, digite APLICAR
                <input autoComplete="off" value={confirmation}
                  onChange={e=>setConfirmation(e.target.value)}
                  placeholder="APLICAR"/>
              </label>
              <button type="button" className="primary" disabled={busy||confirmation!=='APLICAR'}
                onClick={apply}>Ativar versão preparada</button>
            </>}
            {pending.status==='failed_prepare'&&
              <button type="button" className="secondary-light" disabled={busy}
                onClick={()=>sendAction('prepare',{},'Preparação solicitada novamente.')}>
                Tentar preparação novamente
              </button>}
            {pending.status==='applied'&&<p className="saved-message">
              Atualização aplicada. <strong>Reinicie o Node.js Project no aaPanel</strong>
              para carregar também eventuais alterações do supervisor.
            </p>}
            {!working&&<button type="button" className="danger-light"
              disabled={busy} onClick={discard}>Descartar pacote desta tela</button>}
          </div>}
          <div className="update-history">
            <h3>Histórico de atualizações</h3>
            {!data.history.length?<p className="muted">Nenhuma atualização ZIP aplicada ainda.</p>:
              <ul>{data.history.map((item,i)=><li key={item.id+'-'+i}>
                <strong>v{item.version}</strong> · {item.status==='applied'?'Aplicada':'Falha'} ·
                {' '}{date(item.date)}
                <small>{item.sha256}</small>
              </li>)}</ul>}
          </div>
        </>
      }
    </div>
  </section>;
}
