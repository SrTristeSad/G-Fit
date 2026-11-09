import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

const sections = {
  exercises:'Atividades atribuídas',
  exerciseCompletions:'Realizações registradas',
  classEnrollments:'Vínculos com turmas (inclusive inativos)',
  attendance:'Marcações de presença',
  functionalAssessments:'Avaliações funcionais (inclusive retiradas)',
  assessmentCorrections:'Versões anteriores de avaliações',
};
const formatDate = value => value ?
  new Date(value).toLocaleString('pt-BR') : '—';

export default function StudentPrivacy({ id }) {
  const [data,setData] = useState(null);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [loading,setLoading] = useState(true);
  const [exporting,setExporting] = useState(false);

  const refresh=useCallback(async()=>{
    const result=await api('/api/students/'+id+'/privacy');
    setData(result);
  },[id]);
  useEffect(()=>{
    let mounted=true;
    setLoading(true);
    api('/api/students/'+id+'/privacy')
      .then(value=>{if(mounted)setData(value);})
      .catch(err=>{if(mounted)setError(err.message);})
      .finally(()=>{if(mounted)setLoading(false);});
    return ()=>{mounted=false;};
  },[id]);

  async function download() {
    if (!window.confirm(
      'O arquivo contém dados pessoais e pode incluir avaliações retiradas do histórico visível. ' +
      'Exporte somente quando houver finalidade e autorização apropriadas. Continuar?',
    ))return;
    setExporting(true);
    setError('');
    setMessage('');
    try {
      const response=await fetch('/api/students/'+id+'/export',{
        method:'POST',
        cache:'no-store',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({confirmation:'EXPORT_SENSITIVE_DATA'}),
      });
      if(!response.ok) {
        const result=await response.json().catch(()=>({}));
        throw new Error(result.error||'Não foi possível exportar os dados.');
      }
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      try {
        const link=document.createElement('a');
        link.href=url;
        link.download='gfit-aluno-'+id+'.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        window.setTimeout(()=>URL.revokeObjectURL(url),30000);
      }
      await refresh();
      setMessage('Arquivo JSON gerado. Proteja o arquivo baixado e exclua cópias desnecessárias.');
    } catch(err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="card stack student-privacy">
      <div className="section-heading">
        <div>
          <h2>Privacidade e exportação</h2>
          <p className="muted">Inventário de registros da ficha e exportações realizadas.</p>
        </div>
      </div>
      <p className="notice">
        Somente para testes com dados fictícios. O arquivo inclui dados de contato,
        atividades, frequência e avaliações — inclusive medições retiradas da lista
        visível e o histórico de suas correções. Não encaminhe esse arquivo sem
        autorização e finalidade adequadas.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="saved-message" role="status">{message}</p>}
      {loading ? <p className="muted">Consultando registros…</p> : data && (
        <>
          <div className="privacy-stats">
            {Object.entries(sections).map(([key,label])=>(
              <div key={key} className="privacy-count">
                <strong>{data.counts?.[key] ?? 0}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="actions">
            <button type="button" className="secondary-light"
              disabled={exporting} onClick={download}>
              {exporting?'Gerando arquivo…':'Exportar dados deste aluno (JSON)'}
            </button>
          </div>
          <p className="muted">
            Exportação limitada a 10 MiB por operação. O servidor não guarda o arquivo
            gerado, apenas data, tamanho e identificação da exportação. O navegador
            salvará uma cópia no dispositivo.
          </p>
          <div>
            <h3>Histórico de exportações</h3>
            {data.recentExports?.length ? (
              <ul className="privacy-export-history">
                {data.recentExports.map(item=>(
                  <li key={item.id}>
                    <span>{formatDate(item.exportedAt)}</span>
                    <small>{new Intl.NumberFormat('pt-BR').format(item.bytes)} bytes ·
                      Formato v{item.schemaVersion}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Nenhuma exportação registrada.</p>}
          </div>
          <p className="muted">
            Retenção automática e exclusão definitiva ainda não estão disponíveis.
            Arquivar a ficha ou retirar uma avaliação da lista não apaga os dados do banco.
          </p>
        </>
      )}
    </section>
  );
}
