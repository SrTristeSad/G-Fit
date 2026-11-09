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
- [ ] Turmas, avaliações funcionais, prescrição por tempo e relatórios mais completos
- [ ] Integração com o catálogo do [openGym](https://github.com/DuarteSantos8/openGym)
- [x] Pix Asaas Sandbox: cobrança, QR dinâmico, Pix Copia e Cola, webhook autenticado e conciliação idempotente
- [x] Renovação de vigência após pagamento verificado em sandbox, sem sobrescrever revogação administrativa
- [x] Recuperação de cobranças inconclusivas por referência externa, sem gerar nova cobrança
- [x] Cancelamento de cobranças Pix não pagas em sandbox, confirmado no provedor
- [x] Recepção de PAYMENT_DELETED com conciliação idempotente
- [x] Consulta de estornos parciais/totais e eventos de reembolso, somando apenas devoluções DONE
- [x] Indicadores administrativos de cobranças pendentes, vencidas, canceladas e estornos em sandbox
- [ ] Pix em produção: homologação real, controles de estorno, monitoramento, reconciliação operacional e contabilidade
- [x] Troca de senha no painel Minha conta, com revogação das sessões
- [ ] Recuperação de senha, exclusão/exportação de dados, backups e auditoria mais ampla
- [ ] Revisão de segurança, LGPD, testes de integração e implantação HTTPS

**Importante:** esta etapa começa com código próprio e ainda **não é uma importação do openGym**. A integração deverá preservar a licença AGPL-3.0 e os avisos de autoria do projeto original. Por enquanto, nenhuma funcionalidade de exercícios do openGym foi transplantada.

## Licença

AGPL-3.0-or-later, conforme o arquivo `LICENSE`. Ao disponibilizar uma versão modificada pela rede, observe as obrigações de disponibilização de código-fonte da AGPL.

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

### Testes automáticos do Pix

O GitHub Actions utiliza `docker-compose.ci.yml` e `api/test/mock-asaas.mjs` para simular respostas e pagamentos do Asaas sem chaves reais. **Nunca execute a configuração de CI com dados reais.** O teste cobre autenticação, geração da cobrança e QR Code, webhook idempotente, vigências, conferência de valor, recuperação de resposta perdida, cancelamento de pendências e estornos parciais ou totais, sem movimentar dinheiro.

Referências oficiais: https://docs.asaas.com/docs/cobrancas-via-pix ; https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks ; https://docs.asaas.com/reference/listar-cobrancas
