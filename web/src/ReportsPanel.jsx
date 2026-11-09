import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const DAY = 86400000;
function dateDaysAgo(days) {
  const today = new Date().toISOString().slice(0,10);
  return new Date(Date.parse(today+'T00:00:00Z')-days*DAY).toISOString().slice(0,10);
}
function percent(value) {
  return value == null ? 'Sem base de cálculo' :
    new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1}).format(value)+'%';
}
function displayDate(date) {
  return date ? date.slice(0,10).split('-').reverse().join('/') : '—';
}
const statuses = { present:'Presente',absent:'Ausente',excused:'Justificado' };

function Stat({label,value,note}) {
  return (
    <div className="report-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
function Trend({rows,student=false}) {
  const max=Math.max(1,...rows.flatMap(row=>[row.present,row.completions]));
  return (
    <div className="report-trend">
      <h3>Evolução dos registros por mês</h3>
      <p className="muted">
        {student ? 'Presenças e realizações do aluno' : 'Presenças registradas e realizações dos alunos'}.
        As barras utilizam a mesma escala de contagem.
      </p>
      {!rows.length ? <p className="muted">Não há meses neste intervalo.</p> : (
        <div className="report-trend-grid">
          {rows.map(row=>(
            <div key={row.month} className="report-trend-row">
              <strong>{row.month.slice(5)}/{row.month.slice(0,4)}</strong>
              <div className="report-trend-bars">
                <div className="report-track">
                  <div className="report-bar report-bar-present"
                    style={{width:(row.present/max*100)+'%'}} />
                </div>
                <div className="report-track">
                  <div className="report-bar report-bar-activity"
                    style={{width:(row.completions/max*100)+'%'}} />
                </div>
              </div>
              <small>{row.present} presenças · {row.completions} realizações</small>
            </div>
          ))}
        </div>
      )}
      <div className="report-legend" aria-hidden="true">
        <span><i className="report-swatch report-swatch-present"/> Presenças</span>
        <span><i className="report-swatch report-swatch-activity"/> Atividades realizadas</span>
      </div>
    </div>
  );
}
function Summary({summary,individual=false}) {
  return (
    <div className="report-stats">
      {!individual && <Stat label="Aulas cadastradas" value={summary.sessions}
        note="Total de sessões nas turmas" />}
      <Stat label="Presenças" value={summary.present}
        note="Marcações manuais de presença" />
      <Stat label="Ausências" value={summary.absent}
        note="Somente faltas marcadas" />
      <Stat label="Justificadas" value={summary.excused}
        note="Fora do cálculo de frequência" />
      <Stat label="Frequência registrada" value={percent(summary.attendanceRate)}
        note="Presenças ÷ (presenças + ausências)" />
      <Stat label="Atividades realizadas" value={summary.completions}
        note="Registros manuais, não avaliação física" />
      {!individual && <Stat label="Alunos com registros" value={summary.studentsWithRecords}
        note="Presença ou atividade no período" />}
    </div>
  );
}
function StudentDetails({report}) {
  return (
    <div className="stack">
      <div className="report-section-heading">
        <div>
          <h2>{report.student.preferredName||report.student.name}</h2>
          <p className="muted">
            {report.student.active?'Aluno ativo':'Aluno arquivado'}.
            Registros administrativos do período selecionado.
          </p>
        </div>
      </div>
      <Summary summary={report.summary} individual />
      <Trend rows={report.trend} student />
      <div className="columns">
        <section className="card">
          <h3>Frequência por turma</h3>
          {report.classes.length===0 ? (
            <p className="muted">Sem presenças ou ausências marcadas no período.</p>
          ) : (
            <div className="report-table-wrap">
              <table className="report-table">
                <thead><tr>
                  <th>Turma</th><th>Presenças</th><th>Ausências</th><th>Justif.</th><th>Frequência</th>
                </tr></thead>
                <tbody>{report.classes.map(row=>(
                  <tr key={row.id}>
                    <td>{row.name}</td><td>{row.present}</td>
                    <td>{row.absent}</td><td>{row.excused}</td>
                    <td>{percent(row.attendanceRate)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card">
          <h3>Atividades individuais</h3>
          {report.exercises.length===0 ? (
            <p className="muted">Nenhum exercício atribuído atualmente.</p>
          ) : (
            <ul className="report-activity-list">
              {report.exercises.map(item=>(
                <li key={item.id}><span>{item.title}</span>
                  <strong>{item.completions} registro(s)</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">Este levantamento usa os exercícios que ainda existem na ficha.
            Exercícios excluídos anteriormente não são recuperados.</p>
        </section>
      </div>
      <section className="card">
        <h3>Presenças recentes</h3>
        <p className="muted">Até 100 marcações do período. Os totais acima abrangem todo o intervalo.</p>
        {report.attendance.length===0 ? (
          <p className="muted">Nenhuma presença, ausência ou justificativa registrada.</p>
        ) : (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>Data da aula</th><th>Turma</th><th>Registro</th></tr></thead>
              <tbody>{report.attendance.map((item,i)=>(
                <tr key={item.date+'-'+item.className+'-'+i}>
                  <td>{displayDate(item.date)}</td><td>{item.className}</td>
                  <td>{statuses[item.status]||item.status}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
export default function ReportsPanel() {
  const [draft,setDraft]=useState({from:dateDaysAgo(89),to:dateDaysAgo(0)});
  const [applied,setApplied]=useState(draft);
  const [selectedId,setSelectedId]=useState('');
  const [overview,setOverview]=useState(null);
  const [student,setStudent]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const refresh=useCallback(async()=>{
    setLoading(true);setError('');
    const params=new URLSearchParams(applied);
    try {
      const [summary,person]=await Promise.all([
        api('/api/reports/overview?'+params.toString()),
        selectedId ? api('/api/reports/students/'+selectedId+'?'+params.toString()) :
          Promise.resolve(null),
      ]);
      setOverview(summary);
      setStudent(person);
    } catch(err) {
      setError(err.message);
    } finally {setLoading(false);}
  },[applied,selectedId]);
  useEffect(()=>{refresh();},[refresh]);
  const list=useMemo(()=>overview?.students||[],[overview]);
  const filtered=selectedId && student;
  function apply(event) {
    event.preventDefault();
    if(draft.from>draft.to){
      setError('A data inicial deve ser anterior ou igual à data final.');
      return;
    }
    const length=(Date.parse(draft.to+'T00:00:00Z')-Date.parse(draft.from+'T00:00:00Z'))/DAY+1;
    if(!Number.isInteger(length)||length<1||length>366){
      setError('Escolha um intervalo com no máximo 366 dias.');
      return;
    }
    setApplied({...draft});
  }
  function shortcut(days) {
    setDraft({from:dateDaysAgo(days-1),to:dateDaysAgo(0)});
    setApplied({from:dateDaysAgo(days-1),to:dateDaysAgo(0)});
  }
  return (
    <section className="stack report-page">
      <div className="intro">
        <div>
          <div className="eyebrow">Painel do professor</div>
          <h1>Relatórios de acompanhamento</h1>
          <p className="muted">
            Consulte frequência registrada e atividades realizadas por período,
            turma ou aluno. Nenhum dado clínico é calculado.
          </p>
        </div>
      </div>
      <section className="card">
        <form className="report-filters" onSubmit={apply}>
          <label>Data inicial
            <input type="date" min="2020-01-01" max="2100-12-31"
              required value={draft.from}
              onChange={e=>setDraft(current=>({...current,from:e.target.value}))} />
          </label>
          <label>Data final
            <input type="date" min="2020-01-01" max="2100-12-31"
              required value={draft.to}
              onChange={e=>setDraft(current=>({...current,to:e.target.value}))} />
          </label>
          <label>Visualização
            <select value={selectedId} onChange={e=>setSelectedId(e.target.value)}>
              <option value="">Todas as turmas e alunos</option>
              {list.map(item=>(
                <option key={item.id} value={item.id}>
                  {item.preferredName||item.name}{!item.active?' (arquivado)':''}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={loading} type="submit">
            Aplicar período
          </button>
        </form>
        <div className="actions">
          <button className="secondary-light" onClick={()=>shortcut(30)} type="button">Últimos 30 dias</button>
          <button className="secondary-light" onClick={()=>shortcut(90)} type="button">Últimos 90 dias</button>
          <button className="secondary-light" onClick={()=>shortcut(365)} type="button">Últimos 365 dias</button>
          <button className="secondary-light" onClick={()=>window.print()} type="button"
            disabled={loading||!overview}>Imprimir relatório</button>
          <button className="secondary-light" onClick={refresh} type="button" disabled={loading}>
            Atualizar dados
          </button>
        </div>
        <p className="notice">
          Período aplicado: {displayDate(applied.from)} a {displayDate(applied.to)} (datas de calendário UTC).
          Faltas não registradas não são presumidas; justificativas não reduzem a frequência calculada.
        </p>
      </section>
      {error && <p role="alert" className="error">{error}</p>}
      {loading && <p className="muted" role="status">Carregando registros…</p>}
      {!loading && overview && (
        filtered ? <StudentDetails report={student} /> : (
          <div className="stack">
            <Summary summary={overview.summary} />
            <Trend rows={overview.trend} />
            <div className="columns">
              <section className="card">
                <h2>Frequência por turma</h2>
                {overview.classes.length===0 ? (
                  <p className="muted">Nenhuma turma cadastrada.</p>
                ) : (
                  <div className="report-table-wrap">
                    <table className="report-table">
                      <thead><tr>
                        <th>Turma</th><th>Aulas</th><th>Presenças</th><th>Ausências</th>
                        <th>Justif.</th><th>Frequência</th>
                      </tr></thead>
                      <tbody>{overview.classes.map(item=>(
                        <tr key={item.id}>
                          <td>{item.name}{!item.active?' (arquivada)':''}</td>
                          <td>{item.sessions}</td><td>{item.present}</td>
                          <td>{item.absent}</td><td>{item.excused}</td>
                          <td>{percent(item.attendanceRate)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="card">
                <h2>Alunos e registros</h2>
                {list.length===0 ? (
                  <p className="muted">Nenhum aluno cadastrado.</p>
                ) : (
                  <div className="report-table-wrap">
                    <table className="report-table">
                      <thead><tr>
                        <th>Aluno</th><th>Frequência</th><th>Atividades</th>
                      </tr></thead>
                      <tbody>{list.map(row=>(
                        <tr key={row.id}>
                          <td><button type="button" className="report-student-link"
                            onClick={()=>setSelectedId(row.id)}>
                            {row.preferredName||row.name}
                            {!row.active?' (arquivado)':''}
                          </button></td>
                          <td>{percent(row.attendanceRate)}</td>
                          <td>{row.completions}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        )
      )}
      <p className="notice">
        Estes relatórios são administrativos e baseados em dados inseridos manualmente.
        Não representam diagnóstico, avaliação física nem medição automática de desempenho.
        Imprima somente quando necessário e proteja os dados dos alunos.
      </p>
    </section>
  );
}
