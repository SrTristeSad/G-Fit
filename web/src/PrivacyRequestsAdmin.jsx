import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const stateLabels={
  submitted:'Registrado',
  reviewing:'Em análise',
  awaiting_policy:'Aguardando política de retenção',
};
const sourceLabels={
  student:'Relatado pelo aluno',
  guardian:'Relatado por responsável',
  teacher:'Iniciativa do professor',
};

export default function PrivacyRequestsAdmin() {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [busyId,setBusyId]=useState(null);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState('');

  const refresh=useCallback(async()=>{
    setError('');
    try {
      const result=await api('/api/admin/privacy/requests');
      setData(result);
    }catch(err){setError(err.message);}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{refresh();},[refresh]);

  async function setStatus(requestId,status){
    setBusyId(requestId);setError('');setSaved('');
    try {
      await api('/api/admin/privacy/requests/'+requestId,{
        method:'PATCH',body:JSON.stringify({status}),
      });
      await refresh();
      setSaved('Situação atualizada. Nenhum dado pessoal foi apagado.');
    }catch(err){setError(err.message);}
    finally{setBusyId(null);}
  }

  return <section className="stack">
    <div className="card">
      <div className="section-heading">
        <div>
          <h2>Solicitações de eliminação — triagem</h2>
          <p className="muted">Metadados de pedidos informados pelos professores, sem acesso às fichas.</p>
        </div>
        <button type="button" className="secondary-light" onClick={refresh}
          disabled={loading}>Atualizar</button>
      </div>
      <p className="notice">
        A origem dos pedidos é declaratória; identidade e legitimidade não foram verificadas.
        Estes controles só registram triagem. O aplicativo NÃO apaga dados, NÃO define prazo
        legal de retenção e NÃO conclui solicitações automaticamente.
      </p>
      {error&&<p className="error" role="alert">{error}</p>}
      {saved&&<p className="saved-message" role="status">{saved}</p>}
      {data&&<div className="admin-stats">
        <div className="admin-stat"><span>Registrados</span>
          <strong>{data.summary.submitted}</strong></div>
        <div className="admin-stat"><span>Em análise</span>
          <strong>{data.summary.reviewing}</strong></div>
        <div className="admin-stat"><span>Aguardando política</span>
          <strong>{data.summary.awaitingPolicy}</strong></div>
      </div>}
    </div>
    <div className="card">
      <h2>Pedidos cadastrados</h2>
      {loading?<p>Carregando pedidos…</p>:
        !data?.requests?.length?<p className="muted">Nenhuma solicitação cadastrada.</p>:
          <ul className="privacy-review-list">
            {data.requests.map(item=><li key={item.id}>
              <div>
                <strong>{item.teacherName}</strong>
                <small>{item.teacherEmail}</small>
                <small>Aluno identificado internamente pelo código: <code>{item.studentId}</code></small>
                <small>{sourceLabels[item.reportedBy]}</small>
                <small>Registrado em: {new Date(item.requestedAt).toLocaleString('pt-BR')}</small>
                <span className="tag">{stateLabels[item.status]}</span>
              </div>
              <div className="actions">
                <button type="button" className="secondary-light"
                  disabled={busyId===item.id||item.status==='reviewing'}
                  onClick={()=>setStatus(item.id,'reviewing')}>
                  Marcar em análise
                </button>
                <button type="button" className="secondary-light"
                  disabled={busyId===item.id||item.status==='awaiting_policy'}
                  onClick={()=>setStatus(item.id,'awaiting_policy')}>
                  Aguardar política de retenção
                </button>
              </div>
            </li>)}
          </ul>}
      <p className="muted">
        Não há botão de exclusão definitiva. A revisão precisa considerar identidade,
        base legal, obrigações de retenção, dados em backups e documentação do atendimento.
      </p>
    </div>
  </section>;
}
