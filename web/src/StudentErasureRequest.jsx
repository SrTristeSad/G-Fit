import React, { useEffect, useState } from 'react';
import { api } from './api.js';

const labels={
  submitted:'Registrado',
  reviewing:'Em análise',
  awaiting_policy:'Aguardando política de retenção',
};
const sources={
  student:'Aluno (informado pelo professor)',
  guardian:'Responsável (informado pelo professor)',
  teacher:'Iniciativa do professor',
};
const formatDate=v=>v?new Date(v).toLocaleString('pt-BR'):'—';

export default function StudentErasureRequest({ id }) {
  const [record,setRecord]=useState(null);
  const [reportedBy,setReportedBy]=useState('student');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [feedback,setFeedback]=useState('');
  useEffect(()=>{
    let alive=true;
    setLoading(true);
    api('/api/students/'+id+'/erasure-request').then(value=>{
      if(alive)setRecord(value);
    }).catch(err=>{
      if(alive)setError(err.message);
    }).finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;};
  },[id]);

  async function submit(event) {
    event.preventDefault();
    if(!window.confirm(
      'Registrar o pedido para análise administrativa? Esta ação NÃO exclui os dados, '+
      'NÃO verifica a identidade de quem fez o pedido e NÃO substitui o atendimento legal.',
    ))return;
    setBusy(true);setError('');setFeedback('');
    try {
      await api('/api/students/'+id+'/erasure-request',{
        method:'POST',body:JSON.stringify({
          reportedBy,confirmation:'REGISTER_REVIEW_ONLY',
        }),
      });
      const updated=await api('/api/students/'+id+'/erasure-request');
      setRecord(updated);
      setFeedback('Pedido registrado para análise. Nenhum dado foi apagado.');
    }catch(err){setError(err.message);}
    finally{setBusy(false);}
  }

  return <div className="privacy-request">
    <h3>Solicitação de eliminação de dados</h3>
    <p className="muted">
      Registro interno para triagem, não é um canal verificado do titular.
      Nenhuma exclusão é feita automaticamente.
    </p>
    {error&&<p className="error" role="alert">{error}</p>}
    {feedback&&<p className="saved-message" role="status">{feedback}</p>}
    {loading?<p className="muted">Consultando solicitações…</p>:
      record?.request?<>
        <p><strong>Situação:</strong> {labels[record.request.status]||record.request.status}</p>
        <p className="muted">Origem declarada: {sources[record.request.reportedBy]}.
          Registrado em {formatDate(record.request.requestedAt)}.</p>
        <ul className="privacy-request-history">
          {record.history.map(item=><li key={item.id}>
            {formatDate(item.changedAt)} — {labels[item.nextStatus]||item.nextStatus}
            {' '}({item.byAdmin?'Administração':'Professor'})
          </li>)}
        </ul>
        <p className="notice">
          Pedido ainda pendente de análise jurídica e operacional. O registro
          não significa que dados foram eliminados nem que a identidade do titular foi verificada.
        </p>
      </>:<form onSubmit={submit}>
        <label>Quem informou o pedido ao professor?
          <select value={reportedBy} onChange={e=>setReportedBy(e.target.value)}>
            {Object.entries(sources).map(([value,label])=>
              <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <button type="submit" className="secondary-light" disabled={busy}>
          {busy?'Registrando…':'Registrar pedido para análise'}
        </button>
        <p className="muted">
          Não inclua documentos, diagnósticos ou justificativas sensíveis neste registro.
          Um mesmo aluno pode ter apenas um pedido ativo nesta versão.
        </p>
      </form>}
  </div>;
}
