# Backups criptografados, restauração e retenção — G-Fit

Este documento descreve a ferramenta operacional introduzida para **dados de teste**. Ela não equivale a uma política de recuperação em produção e não autoriza a utilização de dados pessoais sensíveis reais.

## Escopo e limites

O banco principal roda em PostgreSQL 16, dentro do serviço `db` do Docker Compose. As rotinas funcionam no computador de quem administra o Compose, usando **Node.js 22** e o comando `docker`. Nenhuma rota HTTP pública permite baixar o banco. O professor continua limitado aos próprios alunos pela API.

Os backups são arquivos PostgreSQL em formato customizado, **criptografados com AES-256-GCM**, com IV aleatório por execução e uma tag de autenticação. A chave aleatória de 256 bits é criada em arquivo separado; o código não contém segredos embutidos. A verificação detecta adulteração ou uso da chave errada. Sem a chave correta, o backup não pode ser restaurado.

O arquivo **não contém uma cópia legível em texto puro**, mas o banco principal e o ambiente onde a restauração de teste ocorre ainda requerem controles de acesso. Não existe upload automático para nuvem, agendamento, rotação de chaves, controle de acesso no armazenamento remoto, descarte automático de backups nem recuperação ponto a ponto (PITR) nesta versão.

## Uso local

No **PowerShell**, a partir da raiz do G-Fit, com Docker Compose e Node.js 22 instalados:

```powershell
# Iniciar o banco do G-Fit, se necessário
docker compose up -d

# Gerar uma chave fora da pasta do repositório (apenas uma vez)
node scripts/generate-backup-key.mjs ..\gfit-backup.key

# Criar um arquivo de backup criptografado
node scripts/backup.mjs backups\gfit-2026-11-09.gfitbak ..\gfit-backup.key

# Verificar a integridade criptográfica sem restaurar
node scripts/verify-backup.mjs backups\gfit-2026-11-09.gfitbak ..\gfit-backup.key

# Restaurar para um banco TEMPORÁRIO e conferir que a estrutura pode ser lida
node scripts/restore-check.mjs backups\gfit-2026-11-09.gfitbak ..\gfit-backup.key
```

Substitua o nome do arquivo pela data de execução. O script de backup **recusa sobrescrever** um destino existente. O gerador de chave também **recusa sobrescrever** uma chave existente; não gere outra chave para backups antigos.

No Linux/macOS, use caminhos com barras normais (`../gfit-backup.key`) e mantenha o arquivo de chave com permissões `0600`. Se um comando falhar, encerra com código de erro diferente de zero para permitir monitoramento por um sistema externo.

**Proteção da chave:** guarde a chave em local seguro e separado dos backups. Mantenha uma cópia protegida da chave para recuperação em caso de perda do computador. Não compartilhe nem envie para GitHub, logs ou serviços de mensagem. Os arquivos `.gfitbak` são ignorados pelo Git apenas como proteção adicional; isso não substitui controle de acesso ao disco.

## Teste de restauração

O comando `restore-check.mjs`:

1. Autentica **todo** o arquivo AES-GCM antes de criar o banco de teste.
2. Cria um banco com nome aleatório que começa com `gfit_restore_check_` no **mesmo cluster PostgreSQL**.
3. Restaura as tabelas, índices e dados para este banco temporário usando `pg_restore --exit-on-error`.
4. Executa consultas de sanidade sobre as tabelas principais e exibe apenas contagens agregadas.
5. Elimina o banco temporário, inclusive quando o teste retorna erro. Se a limpeza falhar, mostra um alerta e o nome do banco pendente para intervenção manual.

O comando **não faz restauração no banco `gfit`** e não possui opção para modificar o banco original. Ainda assim, o teste consome espaço de armazenamento e recursos do servidor enquanto restaura a cópia. Execute-o em horário apropriado; preferencialmente, utilize um ambiente operacional separado e isolado em implantações futuras.

O GitHub Actions testa o processo de ponta a ponta com dados fictícios: chave não sobrescrita, backup autenticado, recusa de chave incorreta, recusa de arquivo adulterado, restauração temporária e preservação do banco original. **O teste automatizado não comprova a qualidade de uma infraestrutura de backup externa ou recuperação após desastre.**

## Política de retenção e exclusão — pendente de decisão

Antes de implantar com dados reais, o responsável pelo G-Fit deverá definir e documentar pelo menos:

- as finalidades e bases legais aplicáveis a cada tipo de dado (cadastro, frequência, avaliações, cobrança, auditoria, backups);
- os prazos de retenção, suas justificativas e as exceções legítimas, com revisão jurídica;
- quem pode solicitar, validar, aprovar e executar correção, exportação ou eliminação;
- como os pedidos de titulares são verificados, respondidos e auditados;
- qual será a periodicidade de backups, o tempo máximo aceitável de perda de dados (RPO) e o tempo máximo de recuperação (RTO);
- como os arquivos de backup são protegidos, replicados, rotacionados, expurgados e recuperados com a chave;
- como impedir que uma restauração futura reintroduza registros legitimamente eliminados, incluindo cópias exportadas, testes e backups antigos;
- políticas de retenção para logs, dados financeiros e trilhas de auditoria.

**Nenhuma data de retenção foi definida pelo código.** As solicitações de eliminação existentes são **somente para triagem**: não há exclusão ou descarte automático. Não configure cron, tarefas agendadas ou expurgo sem aprovação de política e testes de recuperação completos.

Uma restauração real do banco principal é uma atividade de alto impacto e **não foi automatizada**. Precisa de procedimento de mudança, suspensão de gravações, controle de acesso, validação de integridade e revisão do histórico de pedidos de eliminação antes de reabrir a API. Nunca execute `docker compose down -v` para "restaurar" o banco: isso destrói o volume persistente.

## Responsabilidades

O operador deve monitorar execuções de backup, copiar os arquivos **criptografados** para armazenamento protegido separado e testar a recuperação periodicamente. Os scripts apresentados são ferramentas locais para o administrador da instalação, não um sistema de backup gerenciado. Ainda faltam implementação e testes de armazenamento externo, controle de privilégios, retenção aprovada, recuperação real e requisitos da LGPD.
