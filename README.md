# G Fit

Plataforma para profissionais de educação física organizarem alunos, turmas e atividades físicas adaptadas, com foco inicial no público idoso.

> **Fase 2 — protótipo:** cadastro e login de professores, fichas individuais, prescrição simples de atividades e gestão de vagas por professor. **Pix não está integrado.** Não usar com dados reais sensíveis até revisão de segurança, privacidade, backups e adequação à LGPD.

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
- [ ] Pagamentos Pix (cobrança, webhook idempotente e assinatura)
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

**Ainda não implementado:** cobrança Pix, receita, confirmação de pagamento e renovação automática de assinaturas pagas; criação de professores por convite; regras de planos baseadas em pagamento; exportação e retenção do histórico de auditoria; monitoramento do servidor. Os números do painel refletem somente os registros da base de dados, não dados financeiros inventados.

## Planos comerciais — protótipo sem pagamentos

Em **Administração → Planos**, o administrador pode criar planos com nome, descrição, preço em centavos de real (interface em R$), periodicidade mensal ou anual e limite padrão de alunos ativos. O preço é **configurável, mas não é cobrado**: não há checkout, faturas, recibos, Pix ou assinatura paga nesta versão.

Em **Administração → Professores**, selecione um plano disponível para um professor. Essa ação é uma **atribuição manual**, não comprovação de pagamento. A cota `teachers.max_students` passa a ser o limite do plano, preservando a regra existente de controle de vagas inclusive contra cadastros simultâneos. Ajustes individuais posteriores ainda são possíveis; atribuir outro plano redefine a cota conforme o novo plano. Desvincular um plano **não altera a cota atual** e não apaga alunos. Desativar um plano bloqueia novas atribuições, mas não suspende contas nem modifica professores já vinculados.

Planos publicados não podem ter preço, periodicidade ou cotas editados nesta etapa. Para mudanças comerciais, crie outra versão do plano e atribua-a aos professores desejados. Isso evita atualizar silenciosamente valores exibidos nas contas existentes.

**Rotas de planos (API Node.js):**

- `GET/POST /api/admin/plans` — catálogo e criação; apenas administrador.
- `PATCH /api/admin/plans/:id` — disponibilidade do plano; apenas administrador.
- `PUT/DELETE /api/admin/teachers/:id/plan` — vínculo manual; apenas administrador.
- `GET /api/account/plan` — consulta do próprio professor, sem dados de outros usuários.

Criações e alterações ficam registradas em `admin_audit_logs`. É necessário implementar o modelo de cobrança e a verificação de eventos Pix antes de vincular acesso a pagamentos.

## Vigência de acesso (manual, sem pagamentos)

A tela **Administração → Vigências** permite conceder a professores que já têm um plano atribuído um período com data inicial e final, inclusive. Também é possível **renovar manualmente por 1, 3, 6 ou 12 meses** e revogar o prazo. O período máximo configurável na operação inicial é de 733 dias corridos. O status é calculado na leitura do banco PostgreSQL, usando a data corrente do servidor de banco (UTC no ambiente Docker padrão), sem depender de um processo de agendamento.

**Esta ferramenta não confirma pagamento de assinatura.** Uma concessão ou renovação é uma decisão administrativa que fica registrada no histórico; ainda não existe cobrança Pix, emissão de fatura, conciliação financeira ou renovação automática. O estado `active` significa apenas **prazo manual vigente**, nunca `pago`.

Contas anteriores sem prazo configurado mantêm as regras anteriores (status `legacy`) para evitar suspender professores existentes em uma atualização. Quando um prazo é configurado, o vencimento ou a revogação impedem **novos alunos, reativações e novas prescrições**, mas permitem consultar fichas, corrigir informações e registrar atividades já existentes. Não há exclusão automática de alunos nem bloqueio de login.

Para testar no painel: atribua um plano, abra a aba Vigências, conceda um intervalo de datas e confira o resultado no painel do professor. O histórico mostra quem concedeu, renovou ou revogou um prazo.

**Rotas adicionadas:** `GET /api/account/access`, `GET /api/admin/access`, `PUT /api/admin/teachers/:id/access`, `POST /api/admin/teachers/:id/access/renew` e `POST /api/admin/teachers/:id/access/revoke`. As quatro rotas administrativas exigem autenticação com papel administrador.
