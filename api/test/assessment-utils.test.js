import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validAssessmentDate, normalizeAssessment, buildAssessmentComparisons,
} from '../src/assessment-utils.js';

const today='2026-11-09';
const entry=()=>({
  date:today,category:'balance',testName:' Teste manual ',
  protocol:' Procedimento A ',value:12.5,unit:'s',
  notes:' Observado pelo profissional ',
});

test('validates descriptive functional assessments without normal ranges',()=>{
  assert.equal(validAssessmentDate('2026-02-30',today),false);
  assert.equal(validAssessmentDate('2024-02-29',today),true);
  assert.equal(validAssessmentDate('2026-11-10',today),false);
  assert.equal(validAssessmentDate('1999-12-31',today),false);
  assert.equal(validAssessmentDate('2026/11/09',today),false);
  assert.deepEqual(normalizeAssessment(entry(),today),{
    date:today,category:'balance',testName:'Teste manual',
    protocol:'Procedimento A',notes:'Observado pelo profissional',
    value:12.5,unit:'s',
  });
  assert.equal(normalizeAssessment({...entry(),value:0},today).value,0);
  assert.equal(normalizeAssessment({...entry(),unit:'kg',value:100000},today).value,100000);
  assert.equal(normalizeAssessment({...entry(),value:12.345},today),null);
  assert.equal(normalizeAssessment({...entry(),value:-1},today),null);
  assert.equal(normalizeAssessment({...entry(),value:'12.5'},today),null);
  assert.equal(normalizeAssessment({...entry(),unit:'unknown'},today),null);
  assert.equal(normalizeAssessment({...entry(),value:null},today),null);
  assert.equal(normalizeAssessment({...entry(),unit:null},today),null);
  assert.equal(normalizeAssessment({...entry(),category:'medical'},today),null);
  assert.equal(normalizeAssessment({...entry(),testName:'A'},today),null);
  assert.equal(normalizeAssessment({...entry(),notes:'a'.repeat(2001)},today),null);
  assert.equal(normalizeAssessment({...entry(),date:'2026-11-10'},today),null);
  const described=normalizeAssessment({
    ...entry(),value:null,unit:null,notes:'Observações qualitativas',
  },today);
  assert.equal(described.value,null);
  assert.equal(described.unit,null);
});

test('comparison uses same test, category, unit, protocol and distinct dates',()=>{
  const records=[
    {id:'a',date:'2026-11-01',createdAt:'2026-11-01T10:00:00Z',
      category:'balance',testName:'Teste A',protocol:'Protocolo 1',value:12.5,unit:'s'},
    {id:'b',date:'2026-11-09',createdAt:'2026-11-09T10:00:00Z',
      category:'balance',testName:'teste a',protocol:'protocolo 1',value:10.2,unit:'s'},
    {id:'c',date:'2026-11-09',createdAt:'2026-11-09T11:00:00Z',
      category:'balance',testName:'TESTE A',protocol:'Protocolo 1',value:9.8,unit:'s'},
    {id:'d',date:'2026-11-02',createdAt:'2026-11-02T10:00:00Z',
      category:'balance',testName:'Teste A',protocol:'Protocolo 2',value:1,unit:'s'},
    {id:'e',date:'2026-11-03',createdAt:'2026-11-03T10:00:00Z',
      category:'balance',testName:'Teste A',protocol:'Protocolo 1',value:8,unit:'reps'},
    {id:'f',date:'2026-11-04',createdAt:'2026-11-04T10:00:00Z',
      category:'mobility',testName:'Teste A',protocol:'Protocolo 1',value:8,unit:'s'},
    {id:'g',date:'2026-11-05',createdAt:'2026-11-05T10:00:00Z',
      category:'balance',testName:'Teste A',protocol:'Protocolo 1',value:null,unit:null},
  ];
  const result=buildAssessmentComparisons(records);
  assert.equal(result.length,1);
  assert.equal(result[0].previous.date,'2026-11-01');
  assert.equal(result[0].latest.date,'2026-11-09');
  assert.equal(result[0].latest.value,9.8);
  assert.equal(result[0].difference,-2.7);
  assert.equal(result[0].unit,'s');
  assert.deepEqual(buildAssessmentComparisons([]),[]);
});
