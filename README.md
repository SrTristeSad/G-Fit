# G Fit

Plataforma para profissionais de educação física organizarem alunos, turmas e atividades físicas adaptadas, com foco inicial no público idoso.

> **Fase 3 — protótipo:** cadastro e login, fichas, prescrições, administração, planos, vigências e **Pix integrado somente ao ambiente Asaas Sandbox (testes)**. NÃO usar para pagamentos reais. Não usar com dados reais sensíveis até revisão de segurança, privacidade, backups e adequação à LGPD.

## Tecnologia

- **Web:** React + Vite
- **API:** Node.js + Express
- **Banco:** PostgreSQL
- **Desenvolvimento local:** Docker Compose

## Começar

1. Copie `.env.example` para `.env` e altere a senha do banco.
2. Execute `docker compose up --build`.
3. Abra **http://localhost:8080**.
4. Crie uma conta de professor; depois, cadastre alunos e abra uma ficha individual.
5. Crie a **primeira conta de administrador** (uma única vez) com o comando abaixo:

```bash
docker compose exec api node src/bootstrap-admin.js seu-email@exemplo.com
```

O comando mostra uma **senha aleatória de uso inicial**. Guarde-a com segurança, entre no aplicativo com esse e-mail e a senha exibida. Depois, vá até **Minha conta** para alterar a senha. A criação do primeiro administrador fica bloqueada quando já existe um administrador.

> O script deve ser executado **somente no próprio servidor**, por quem controla o Docker. Não existe endpoint HTTP público para conceder permissões administrativas.

Para encerrar, execute `docker compose down`. Os dados permanecem no volume `gfit-postgres`; **`docker compose down -v` apaga o volume**.

### Testes automatizados

```bash
cd api
npm install
npm test
```

## Estado do produto

- [x] API Node.js e interface React inicial
- [x] Cadastro, login e logout de professores
- [x] Cadastro e listagem de alunos associados ao professor autenticado
- [x] Ficha do aluno: nome preferido, nascimento, contato, contato de emergência, objetivos e observações gerais
- [x] Exercícios atribuídos individualmente e registros **manuais** de realização
- [x] Biblioteca privada e editável de exercícios por professor, com pesquisa e arquivamento
- [x] Planejamento semanal por aluno (segunda a domingo), duração opcional e edição de prescrições
- [x] Turmas privadas com dias da semana, horário, duração e limite independente de vagas
- [x] Matrículas por professor com proteção contra exceder capacidade e arquivamento sem perda de histórico
- [x] Indicadores administrativos agregados de turmas, aulas e presenças, sem exposição de alunos individuais
- [x] Aulas cadastradas por data e presença manual (presente, ausente, justificado), com correção de registros
- [x] Relatórios por período, turma e aluno: presenças/ausências, justificativas e realizações manuais de exercícios
- [x] Avaliações funcionais descritivas na ficha do aluno, com registros datados e medições opcionais
- [x] Correções auditáveis, retirada lógica de registros incorretos e comparação numérica de testes equivalentes
- [x] Exportação JSON por aluno, exclusiva do professor responsável, com fichas, atividades, presenças e avaliações (inclusive correções)
- [x] Inventário da ficha, histórico de exportações e respostas sensíveis sem cache no navegador
- [ ] Política de retenção e exclusão definitiva após revisão de necessidade legal e de backups
- [x] Gráficos de evolução dos registros por mês e versão para impressão, sem interpretação clínica
- [x] Compatibilidade com exercícios antigos em texto livre, sem apagar os registros de realização
- [x] Administração: ver professores, ativar/desativar contas e definir máximo de alunos ativos
- [x] Dashboard administrativo com totais de professores, alunos e atividades
- [x] Histórico auditável das alterações de limites e situação das contas
- [x] Busca e filtros de professores na administração
- [x] Catálogo de planos comerciais: valores em centavos, frequência mensal/anual e cotas
- [x] Atribuição e remoção manual de planos por professor, com atualização atômica da cota
- [x] Ativação e desativação de planos; bloqueio de novos vínculos com plano desativado
- [x] Histórico auditável de criação, ativação e atribuição de planos
- [x] Prazos de acesso opcionais por professor com datas de início e término, renovação e revogação manuais
- [x] Bloqueio de novos alunos, reativações e novas prescrições quando o prazo não está ativo (sem apagar fichas)
- [x] Painel de Vigências com status ativo, agendado, vencido ou revogado e métricas agregadas
- [x] Limite inicial de **20 alunos ativos** por professor, editável pelo administrador (0 a 10.000)
- [ ] Protocolos de avaliação validados, referências clínicas aprovadas por profissional, recorrência automática de sessões e integração com calendários
- [ ] Integração com o catálogo do [openGym](https://github.com/DuarteSantos8/openGym)
- [x] Pix Asaas Sandbox: cobrança, QR dinâmico, Pix Copia e Cola, webhook autenticado e conciliação idempotente
- [x] Renovação de vigência após pagamento verificado em sandbox, sem sobrescrever revogação administrativa
- [x] Recuperação de cobranças inconclusivas por referência externa, sem gerar nova cobrança
- [x] Cancelamento de cobranças Pix não pagas em sandbox, confirmado no provedor
- [x] Recepção de PAYMENT_DELETED com conciliação idempotente
- [x] Consulta de estornos parciais/totais e eventos de reembolso, somando apenas devoluções DONE
- [x] Indicadores administrativos de cobranças pendentes, vencidas, canceladas e estornos em sandbox
- [x] Monitoramento local de webhooks autenticados, reentregas, falhas HTTP e fila de cobranças para conferência
- [x] Central de alertas internos com detecção periódica, reconhecimento e resolução automática de incidentes locais
- [ ] Pix em produção: homologação real, controles de estorno, monitoramento, reconciliação operacional e contabilidade
- [x] Troca de senha no painel Minha conta, com revogação das sessões
- [ ] Recuperação de senha, exclusão/retificação definitiva de dados, backups e auditoria mais ampla
- [ ] Revisão de segurança, LGPD, testes de integração e implantação HTTPS

**Importante:** esta etapa começa com código próprio e ainda **não é uma importação do openGym**. A integração deverá preservar a licença AGPL-3.0 e os avisos de autoria do projeto original. Por enquanto, nenhuma funcionalidade de exercícios do openGym foi transplantada.

## Licença

AGPL-3.0-or-later, conforme o arquivo `LICENSE`. Ao disponibilizar uma versão modificada pela rede, observe as obrigações de disponibilização de código-fonte da AGPL.

## Privacidade e portabilidade: exportação por aluno (protótipo)

Na ficha do aluno, a seção **Privacidade e exportação** permite que o professor responsável consulte um **inventário de registros** (atividades atribuídas, realizações, turmas, presenças, avaliações e correções) e baixe os dados em um arquivo **JSON UTF-8**.

**O arquivo contém dados pessoais**, incluindo contatos, objetivos e observações da ficha, prescrições, atividades realizadas, vínculos de turma, presenças e avaliações funcionais. Ele **inclui as avaliações retiradas da lista visível e os valores anteriores registrados em correções**, identificados como tal. A exportação não contém senhas, tokens, outros alunos da turma ou observações compartilhadas da aula que possam descrever terceiros. Os dados são lidos em uma única transação consistente do PostgreSQL e o download é iniciado pelo navegador; o backend não cria um arquivo persistente para a exportação.

**Controles implementados:** autenticação do professor responsável; inexistência de exportação entre contas; requisição POST com confirmação explícita; limite de 6 tentativas a cada 15 minutos (por cliente/rede no protótipo); limite de 10 MiB por arquivo; cabeçalhos `Cache-Control: private, no-store` nas respostas da API; e uma trilha de auditoria que registra data, professor, aluno, tamanho e versão da exportação, **sem guardar cópia do conteúdo**. A seção lista as últimas dez exportações daquele aluno. O dashboard administrativo mostra apenas os **totais agregados de exportações**, sem liberar o conteúdo das fichas individuais.

**Endpoint de inventário:** `GET /api/students/:id/privacy`. **Endpoint de download:** `POST /api/students/:id/export` com `{"confirmation":"EXPORT_SENSITIVE_DATA"}` em JSON. A resposta do segundo endpoint é um arquivo JSON com `Content-Disposition: attachment`. Os testes verificam a proteção de contas, a exclusão de dados de outros alunos da turma, os cabeçalhos de privacidade, o conteúdo e o registro das exportações.

**O que esta etapa não resolve:** solicitação verificada do titular, acesso direto do aluno, anonimização, eliminação definitiva, descarte automático, política completa de retenção, expurgo de backups, criptografia de arquivos exportados, autenticação reforçada antes do download, controle de transferências externas e revisão jurídica. **Arquivar um aluno ou retirar uma avaliação não exclui os dados do banco.** Um arquivo já baixado passa a depender da proteção do dispositivo e de quem o recebe. Não utilize com dados de saúde reais nem como comprovação de adequação à LGPD neste estágio.

## Avaliações funcionais descritivas

Na ficha individual do aluno, em **Avaliações funcionais**, o professor pode registrar observações nas categorias **mobilidade, equilíbrio, força, resistência** ou **outro**, com data, nome escolhido para o teste, procedimento ou protocolo utilizado, anotações e resultado numérico opcional. Os resultados podem usar segundos, repetições, metros, centímetros, quilogramas ou pontos. Quando não há medição numérica, a observação em texto é obrigatória.

O sistema **não escolhe testes**, **não aplica valores de referência**, **não define risco de queda** e **não declara melhora ou piora**. As comparações mostram somente a diferença matemática entre resultados do mesmo nome de teste, categoria, protocolo e unidade, feitos em **datas diferentes**. Um valor maior ou menor não necessariamente representa melhor desempenho: a interpretação e a adequação dos testes são responsabilidade do profissional habilitado.

O histórico visível mostra até os **200 registros mais recentes** e informa quando há mais entradas no banco. As avaliações de alunos arquivados continuam disponíveis para consulta; novas avaliações e correções exigem aluno e vigência ativos. Registros incorretos podem ser **corrigidos** (com preservação dos valores anteriores em auditoria) ou **retirados do histórico visível** (cancelamento lógico sem exclusão física). O professor pode consultar as correções anteriores, mas a interface não exibe os registros cancelados como avaliações válidas.

**API exclusiva do professor responsável:** `GET/POST /api/students/:id/assessments`, `PUT/DELETE /api/students/:id/assessments/:assessmentId` e `GET /api/students/:id/assessments/:assessmentId/changes`. O backend valida datas, unidades, comprimento dos campos, precisão do valor e vínculo aluno–professor. As correções ficam na tabela `functional_assessment_changes`; avaliações na `functional_assessments`.

**Atenção à privacidade:** avaliações funcionais podem conter dados pessoais sensíveis de saúde. Este módulo é destinado a **dados sintéticos e testes** enquanto não forem implantados e verificados mecanismos de segurança, políticas de acesso, retenção, recuperação, exportação, consentimento/base legal e demais obrigações da LGPD. Cancelamento lógico **não equivale à exclusão definitiva dos dados**: o histórico de auditoria ainda os conserva. Não utilizar com dados reais neste estágio.

## Relatórios de frequência e atividades

Na área do professor, abra **Relatórios** para consultar registros em um período de até **366 dias inclusivos** (padrão: 90 dias). Os filtros permitem visualizar todas as turmas e alunos ou selecionar um aluno específico. Os dados também abrangem alunos e turmas arquivados, desde que seus registros anteriores continuem no banco.

A visão geral exibe quantidade de aulas cadastradas, presenças, ausências, justificativas, realizações de atividades e número de alunos com registros no período. Há tabelas separadas por turma e por aluno e um gráfico mensal de **presenças efetivamente registradas** e **realizações de exercícios**. Na visão individual, o professor pode consultar frequência por turma, atividades existentes na ficha e as últimas 100 marcações de presença. A opção **Imprimir relatório** utiliza a impressão do navegador; guarde as cópias com segurança.

A **taxa de frequência registrada** é calculada como `presenças / (presenças + ausências) × 100`. Ausências justificadas e aulas sem qualquer registro ficam **fora do denominador**; quando não há marcações de presença ou ausência, o sistema exibe **Sem base de cálculo**, não 0%. Nenhuma falta é presumida para o aluno que não tem registro naquela aula. Uma realização de exercício representa uma marcação manual do professor, não uma medição automática de desempenho nem prova de recuperação física.

Datas de aulas usam o calendário indicado no cadastro, enquanto atividades são agrupadas pelo dia de registro em **UTC**. A seleção de período restringe o resultado do relatório sem modificar o histórico. Caso um exercício tenha sido excluído em versões anteriores, seu histórico de realizações pode ter sido removido pela regra antiga de exclusão; o relatório não consegue recuperar registros apagados.

**Endpoints (exclusivos do professor autenticado):** `GET /api/reports/overview?from=AAAA-MM-DD&to=AAAA-MM-DD` e `GET /api/reports/students/:id?from=AAAA-MM-DD&to=AAAA-MM-DD`. Ambos rejeitam datas inválidas ou intervalos superiores a 366 dias. O segundo endpoint exige que o aluno pertença ao professor autenticado; o administrador não recebe acesso a relatórios individuais de outros professores. Os testes de integração cobrem filtragem, contagens, ausência de dados e isolamento entre contas.

**Importante:** estes são **relatórios administrativos**, não avaliações clínicas, indicadores de melhora funcional ou recomendações de exercício. Antes do uso com pessoas reais, ainda são necessárias as revisões de LGPD, segurança, retenção, exportação e impressão de dados pessoais.

## Turmas, horários e presença

A área do professor **Turmas e presença** permite cadastrar turmas com nome, dias recorrentes da semana, horário de início, duração entre 15 e 240 minutos e **1 a 200 vagas por turma**, além de observações gerais. A lotação de uma turma é distinta da quantidade global de alunos ativos autorizada ao professor: matricular um aluno já cadastrado em várias turmas não cria novas fichas nem consome mais vagas do limite global.

Cada professor vê apenas suas turmas, alunos e presenças. Matrículas ativas exigem que o aluno pertença ao próprio professor, esteja ativo e a turma tenha vagas. Inscrições simultâneas são serializadas por bloqueio transacional da turma no PostgreSQL, evitando ultrapassar a capacidade. Ao **arquivar um aluno**, todas as suas matrículas ativas ficam inativas automaticamente, liberando vagas; reativar a ficha não o rematricula. Ao retirar apenas uma matrícula, a ficha do aluno e as presenças registradas anteriormente são preservadas.

As sessões são cadastradas por **data**, podendo incluir observações. A data é livre para permitir reposições fora dos dias usuais da turma; não existe criação automática de aulas recorrentes. Só pode existir uma sessão por data na mesma turma. Para cada aula, o professor pode marcar **Presente**, **Ausente**, **Justificado** ou limpar um registro incorreto. Nenhuma dessas marcações é automática, nem equivale a prova biométrica de presença. O painel exibe até 60 sessões recentes por turma, com histórico dos alunos que deixaram a turma. Não são coletados dados de dispositivos.

**Alteração e arquivamento de turmas:** informações e lotação podem ser editadas, desde que o novo limite não fique abaixo das matrículas ativas. Desativar uma turma impede novas matrículas e novas sessões, mas conserva as matrículas e registros de aulas existentes. Sessões existentes continuam consultáveis e podem ter a presença corrigida. A exclusão definitiva de turmas não faz parte desta etapa.

**API:** `GET/POST /api/classes`, `GET/PUT /api/classes/:id`, `POST /api/classes/:id/enrollments`, `DELETE /api/classes/:id/enrollments/:studentId`, `POST /api/classes/:id/sessions`, `PUT /api/classes/:id/sessions/:sessionId/attendance`. As rotas de criação de turmas, matrícula e sessões respeitam o controle de vigências do professor; alteração de turma também requer vigência ativa. A correção de presenças existentes e a consulta do histórico permanecem disponíveis. Testes Docker verificam limite de vagas, proteção entre contas, datas inválidas, presença manual e manutenção do histórico após remover uma matrícula ou arquivar um aluno.

**Atenção:** este protótipo não oferece diagnóstico, avaliação clínica nem prescrição física automática. Não utilize dados reais sensíveis antes da revisão de privacidade e segurança e de adequação à LGPD.

## Biblioteca de exercícios e planejamento semanal

Na área do professor, acesse **Biblioteca de exercícios** para cadastrar exercícios com nome, categoria, orientações gerais, séries e repetições padrão, e duração opcional em minutos. Também é possível editar ou arquivar exercícios. Cada professor tem uma biblioteca **privada**: uma conta não pode ver nem utilizar itens de outra conta.

Abra **Meus alunos → ficha individual → Prescrever atividade**. Você pode escolher um exercício do catálogo ou criar uma atividade livre apenas para aquele aluno, ajustar séries/repetições/duração, selecionar os dias da semana e adicionar instruções personalizadas. O quadro **Planejamento semanal** mostra as atividades de segunda a domingo. Você também pode editar uma prescrição existente. Alterações na biblioteca **não reescrevem** prescrições já atribuídas, para preservar a decisão anterior do professor. O arquivamento de um exercício impede novas atribuições, mas não apaga planos nem históricos existentes.

As prescrições antigas que usavam o campo de frequência em texto permanecem intactas, com dias estruturados vazios até que o professor os defina. Os registros de realização continuam manuais. Duração é uma informação adicional, não um cronômetro ou monitoramento automático; séries e repetições seguem obrigatórios nesta versão.

**Este módulo não importa o acervo original do openGym.** A biblioteca criada aqui é autoral e preenchida pelo professor. A eventual adaptação dos exercícios e mídias do openGym exigirá revisão específica da estrutura de dados, créditos e licença AGPL.

**API:** `GET/POST /api/exercises/library`, `PUT /api/exercises/library/:id`, `POST /api/students/:id/exercises`, `PATCH /api/students/:id/exercises/:exerciseId`. Os demais endpoints de ficha, conclusão e exclusão continuam disponíveis. Todas as consultas e modificações validam a propriedade do professor no servidor. Novas prescrições e edição de planos seguem as restrições de vigência de acesso. Os dias são armazenados como máscara binária (1=segunda, 7=domingo) com validação de valores e duplicatas.

**Atenção:** o software não prescreve atividades automaticamente e não substitui avaliação por profissional habilitado. Não utilizar dados clínicos reais antes da revisão de segurança, acessibilidade e conformidade à LGPD.

## Administração e proteção dos alunos

O administrador vê professores, suas situações e quantidades de **alunos ativos**, mas **não acessa fichas privadas** pela API administrativa. O professor só consegue consultar e alterar alunos e atividades da própria conta. Alunos arquivados deixam de ocupar vagas, mas não são excluídos; reativar requer disponibilidade na cota. Reduzir a cota não remove alunos existentes.

A informação de realização de atividade é **declarada manualmente pelo professor**, não coletada de smartwatch ou sensores. Os campos de ficha não são um prontuário médico. Não armazene laudos, diagnósticos, dados clínicos ou informações reais sensíveis nesta fase de protótipo. Antes do uso com pessoas reais, implemente controles de privacidade, retenção, consentimento/base legal adequada, HTTPS, recuperação de conta, testes de segurança e recursos LGPD.

## Administração — escopo implementado

A área **Administração → Visão geral** apresenta estatísticas agregadas de professores, alunos e atividades. **Administração → Professores** permite busca, filtragem, ajustes de limites e ativação/desativação de contas. **Administração → Histórico** mostra as 50 alterações mais recentes feitas em limites e situação de contas, identificando quem realizou a operação. As alterações são registradas na mesma transação no banco de dados.

**Ainda não implementado:** pagamentos reais e conciliação financeira de produção; criação de professores por convite; regras de planos baseadas em pagamento; exportação e retenção do histórico de auditoria; monitoramento do servidor. Os números do painel refletem somente os registros da base de dados, não dados financeiros inventados.

## Planos comerciais — protótipo sem pagamentos

Em **Administração → Planos**, o administrador pode criar planos com nome, descrição, preço em centavos de real (interface em R$), periodicidade mensal ou anual e limite padrão de alunos ativos. O preço é **configurável** e pode ser usado para gerar Pix **somente no Asaas Sandbox**. Não há cobrança ou transferência real nesta versão.

Em **Administração → Professores**, selecione um plano disponível para um professor. Essa ação é uma **atribuição manual**, não comprovação de pagamento. A cota `teachers.max_students` passa a ser o limite do plano, preservando a regra existente de controle de vagas inclusive contra cadastros simultâneos. Ajustes individuais posteriores ainda são possíveis; atribuir outro plano redefine a cota conforme o novo plano. Desvincular um plano **não altera a cota atual** e não apaga alunos. Desativar um plano bloqueia novas atribuições, mas não suspende contas nem modifica professores já vinculados.

Planos publicados não podem ter preço, periodicidade ou cotas editados nesta etapa. Para mudanças comerciais, crie outra versão do plano e atribua-a aos professores desejados. Isso evita atualizar silenciosamente valores exibidos nas contas existentes.

**Rotas de planos (API Node.js):**

- `GET/POST /api/admin/plans` — catálogo e criação; apenas administrador.
- `PATCH /api/admin/plans/:id` — disponibilidade do plano; apenas administrador.
- `PUT/DELETE /api/admin/teachers/:id/plan` — vínculo manual; apenas administrador.
- `GET /api/account/plan` — consulta do próprio professor, sem dados de outros usuários.

Criações e alterações ficam registradas em `admin_audit_logs`. O módulo Pix Sandbox pode vincular uma vigência a um pagamento de teste verificado no Asaas. Não habilite cobrança real sem homologação.

## Vigência de acesso (manual, sem pagamentos)

A tela **Administração → Vigências** permite conceder a professores que já têm um plano atribuído um período com data inicial e final, inclusive. Também é possível **renovar manualmente por 1, 3, 6 ou 12 meses** e revogar o prazo. O período máximo configurável na operação inicial é de 733 dias corridos. O status é calculado na leitura do banco PostgreSQL, usando a data corrente do servidor de banco (UTC no ambiente Docker padrão), sem depender de um processo de agendamento.

**Esta ferramenta não confirma pagamento de assinatura.** Uma concessão ou renovação feita na aba Vigências é decisão administrativa. Separadamente, o módulo Pix Sandbox pode estender o prazo após consulta do pagamento ao provedor, em um fluxo de testes sem dinheiro real. O estado `active` significa apenas **prazo manual vigente**, nunca `pago`.

Contas anteriores sem prazo configurado mantêm as regras anteriores (status `legacy`) para evitar suspender professores existentes em uma atualização. Quando um prazo é configurado, o vencimento ou a revogação impedem **novos alunos, reativações e novas prescrições**, mas permitem consultar fichas, corrigir informações e registrar atividades já existentes. Não há exclusão automática de alunos nem bloqueio de login.

Para testar no painel: atribua um plano, abra a aba Vigências, conceda um intervalo de datas e confira o resultado no painel do professor. O histórico mostra quem concedeu, renovou ou revogou um prazo.

**Rotas adicionadas:** `GET /api/account/access`, `GET /api/admin/access`, `PUT /api/admin/teachers/:id/access`, `POST /api/admin/teachers/:id/access/renew` e `POST /api/admin/teachers/:id/access/revoke`. As quatro rotas administrativas exigem autenticação com papel administrador.


## Pix via Asaas Sandbox — testes apenas

**O G Fit não está pronto para processar dinheiro real.** O backend usa exclusivamente `https://api-sandbox.asaas.com/v3`. A chave e o token nunca devem ser colocados no código-fonte, no frontend ou em commits.

1. Crie uma conta **Asaas Sandbox** e configure uma chave Pix no ambiente de testes. Copie a API Key do sandbox (prefixo `$aact_hmlg_`).
2. No arquivo local `.env` (não versionado), defina `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN`. O segundo valor deve ser um segredo aleatório de 32 a 255 caracteres, diferente da API Key, que será usado como `authToken` no webhook.
3. Reinicie a API: `docker compose up -d --build`.
4. No Asaas Sandbox, crie o webhook apontando para **`https://SEU-DOMINIO/api/webhooks/asaas`** (domínio público com HTTPS) e configure o mesmo `authToken`. Selecione os eventos `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`. Não exponha o ambiente local publicamente sem HTTPS e revisão de segurança.
5. No Asaas Sandbox, cadastre um cliente (pagador) de teste e copie seu ID (`cus_...`). No G Fit, vincule esse ID ao professor em **Administração → Financeiro (teste)**. O professor também precisa ter um plano com preço maior que zero atribuído.
6. O professor pode acessar **Pix (teste)** e gerar sua cobrança; ou o administrador pode criá-la para ele. Ambos podem visualizar as cobranças permitidas; o professor vê somente as próprias.
7. A confirmação de pagamento é recebida via webhook. O G Fit consulta a API do Asaas para verificar ID, valor, tipo PIX, cliente, referência externa e status. Se os dados coincidirem, a cobrança é marcada como recebida **no sandbox** e a vigência é estendida **somente se o plano continuar atribuído e o prazo não estiver revogado**.
8. Em **Administração → Financeiro (teste)**, a opção **Conferir no Asaas** consulta cobranças conhecidas, e **Recuperar no Asaas** procura cobranças com resposta de criação inconclusiva pelo identificador `externalReference`, sem emitir duplicatas.

O PostgreSQL registra os IDs dos eventos do Asaas como chave única, impedindo dupla liquidação e dupla extensão de acesso por reentrega. O histórico administrativo registra decisões financeiras verificadas, mas não contém credenciais.

**Limitações que impedem uso comercial:** ainda faltam a solicitação e aprovação operacional de estornos, alertas de webhook parado, tratamento completo dos possíveis estados do provedor, gestão segura de contas financeiras, políticas comerciais, conciliação de divergências e testes com a conta oficial em produção. As contas sem prazo configurado continuam com o comportamento legado para preservar compatibilidade com versões anteriores. Cobrança de teste não deve ser tratada como receita real.

### Cancelamentos, vencimentos e estornos (Sandbox)

- **Cobrança pendente:** em **Administração → Financeiro (teste)**, use **Cancelar cobrança de teste**. O servidor consulta os dados no Asaas, envia a exclusão apenas se ela ainda não estiver paga, consulta novamente a confirmação e registra a ação no histórico. Somente o administrador tem acesso a essa operação.
- **Cobrança vencida:** o indicador "vencida" significa que a data local de vencimento passou e o registro ainda está pendente. Isso **não** prova que o Asaas anulou a cobrança. Ela continua bloqueando a criação de outra cobrança até ser cancelada ou conciliada.
- **Cobrança paga:** a operação de exclusão **não** é permitida, porque devolução de dinheiro exige fluxo de estorno separado.
- **Estorno:** o botão **Consultar estornos** verifica o pagamento no Asaas e registra o total efetivamente devolvido. O servidor também processa os webhooks `PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`, `PAYMENT_REFUND_DENIED` e `PAYMENT_DELETED`, sempre consultando os dados atuais no provedor. Estornos com status `PENDING` não são contabilizados como devolvidos; somente os com status `DONE` são somados.
- **Acesso do professor:** estorno não reduz automaticamente sua vigência, pois pode envolver devolução parcial, mais de uma cobrança ou regras contratuais ainda não implementadas. O administrador precisa avaliar a situação. O histórico de recebimento é preservado mesmo quando o valor foi totalmente estornado.

Os indicadores de receita e estorno apresentados no painel são **exclusivamente do sandbox**, sem equivalência com receita contábil real, e não constituem rotina automática de cancelamento ou reembolso. Para usar a conciliação por webhook, inclua os eventos correspondentes na configuração do Asaas Sandbox.

Referências oficiais: [exclusão de cobrança](https://docs.asaas.com/reference/excluir-cobranca), [eventos de cobrança](https://docs.asaas.com/docs/webhook-para-cobrancas) e [regras de estorno](https://docs.asaas.com/docs/estornos).

### Monitoramento operacional local

A aba **Administração → Monitoramento** agora consulta `GET /api/admin/billing/operations`, disponível **somente para administradores**. Ela apresenta:

- número de eventos Asaas únicos autenticados e quantidade total de tentativas;
- número de respostas com erro registradas (inclusive erros que depois foram resolvidos);
- eventos recebidos mais de uma vez e eventos cuja última entrega falhou;
- última entrega registrada no G-Fit e eventos recebidos nas últimas 24 horas;
- cobranças em criação inconclusiva há mais de 15 minutos, vencidas ainda pendentes ou pendentes por mais de 48 horas;
- divergências de conciliação que exigem conferência humana.

Esses dados são persistidos no PostgreSQL na tabela `asaas_webhook_attempts`, **sem salvar credenciais ou conteúdo integral dos webhooks**. A autenticação e a validação do evento são verificadas antes de registrar a tentativa. Um erro durante a conciliação resulta em HTTP 503, permitindo nova entrega. As operações de liquidação continuam idempotentes pela tabela `asaas_webhook_events`.

**Limitação importante:** os indicadores são observações **locais**, não representam o estado oficial da fila do Asaas. Nenhuma entrega registrada pode significar falta de atividade; não prova interrupção de webhook. Verifique também os **Logs de Webhooks** do Asaas e a configuração da fila. A documentação informa que a fila pode ser pausada após 15 falhas consecutivas; a recuperação precisa ser realizada no provedor após corrigir o problema. Não existe envio automático de e-mails/alertas, verificação remota periódica nem rotina de monitoramento fora do painel nesta etapa.

### Central de alertas (administração)

**Administração → Alertas** apresenta notificações internas do G-Fit, sem envio de e-mail, SMS ou notificações push. O servidor verifica os dados locais ao iniciar e a cada **15 minutos**. Administradores também podem executar **Verificar agora**, sujeitos a um limite de solicitações. A verificação é protegida contra execução simultânea por instâncias diferentes do servidor.

Os alertas são criados a partir de sinais observáveis no PostgreSQL: cobranças em criação há mais de 15 minutos, cobranças vencidas ou pendentes há mais de 48 horas, falhas na última entrega de um webhook autenticado, divergências de eventos e estornos pendentes ou que exigem revisão. O scanner **não entra em contato com o Asaas e não emite cobranças**. Um problema persistente mantém o mesmo alerta, evitando duplicações.

Os avisos têm os seguintes estados:

- **Novo:** condição detectada e ainda não reconhecida.
- **Em análise:** um administrador marcou o problema para investigação; a condição continua ativa.
- **Resolvido:** o scanner verificou que a condição local desapareceu. Se voltar a ocorrer, o alerta é reaberto automaticamente.

Reconhecimentos são registrados na auditoria administrativa. O histórico e os estados ficam nas tabelas `admin_alerts` e `admin_alert_scanner`. Endpoints: `GET /api/admin/alerts`, `POST /api/admin/alerts/scan` e `PATCH /api/admin/alerts/:id/acknowledge`, exclusivos do administrador.

**Limites:** a detecção não equivale a acompanhamento do estado da fila do Asaas, nem à confirmação de pagamento. O painel deve ser aberto para consultar os alertas; não existe envio externo de aviso ou rotina de recuperação automática da fila remota. Em caso de falha, verificar os logs oficiais do provedor e corrigir a causa antes de reativar a fila.

### Testes automáticos do Pix

O GitHub Actions utiliza `docker-compose.ci.yml` e `api/test/mock-asaas.mjs` para simular respostas e pagamentos do Asaas sem chaves reais. **Nunca execute a configuração de CI com dados reais.** O teste cobre autenticação, geração da cobrança e QR Code, webhook idempotente, vigências, conferência de valor, recuperação de resposta perdida, cancelamento de pendências, estornos e ciclo de alertas internos (deduplicação, reconhecimento, resolução e permissões), sem movimentar dinheiro.

Referências oficiais: https://docs.asaas.com/docs/cobrancas-via-pix ; https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks ; https://docs.asaas.com/reference/listar-cobrancas
