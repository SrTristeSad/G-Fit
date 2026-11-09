# G Fit

Plataforma para profissionais de educação física organizarem alunos, turmas e atividades físicas adaptadas, com foco inicial no público idoso.

> **Fase 1 — protótipo:** cadastro e login de professores, sessões e gerenciamento básico de alunos. **Pix não está integrado.** Não usar com dados reais sensíveis até revisão de segurança, privacidade, backups e adequação à LGPD.

## Tecnologia

- **Web:** React + Vite
- **API:** Node.js + Express
- **Banco:** PostgreSQL
- **Desenvolvimento local:** Docker Compose

## Começar

1. Copie `.env.example` para `.env` e altere a senha do banco.
2. Execute `docker compose up --build`.
3. Abra **http://localhost:8080**.
4. Crie a primeira conta de professor; depois, cadastre alunos.

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
- [ ] Perfis de administrador e permissões avançadas
- [ ] Turmas, avaliações e planos de treino adaptados
- [ ] Integração com o catálogo do [openGym](https://github.com/DuarteSantos8/openGym)
- [ ] Pagamentos Pix (cobrança, webhook idempotente e assinatura)
- [ ] Recuperação de senha, exclusão/exportação de dados, backups e auditoria
- [ ] Revisão de segurança, LGPD, testes de integração e implantação HTTPS

**Importante:** esta etapa começa com código próprio e ainda **não é uma importação do openGym**. A integração deverá preservar a licença AGPL-3.0 e os avisos de autoria do projeto original. Por enquanto, nenhuma funcionalidade de exercícios do openGym foi transplantada.

## Licença

AGPL-3.0-or-later, conforme o arquivo `LICENSE`. Ao disponibilizar uma versão modificada pela rede, observe as obrigações de disponibilização de código-fonte da AGPL.
