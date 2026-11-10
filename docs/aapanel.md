# Instalação do G-Fit no aaPanel — Node.js + PostgreSQL

Este guia é para hospedar o **G-Fit** como um **Node.js Project no aaPanel**, sem Docker. O modo Docker Compose continua disponível, mas é uma alternativa independente: não execute os dois servidores para o mesmo domínio.

O instalador é pelo **navegador**, como nos demais projetos Node.js: exibe um código de instalação no log da aplicação, recebe as credenciais num formulário, instala dependências, prepara o PostgreSQL, compila o React e cria a primeira conta administrativa. **Só funciona antes da configuração inicial**. Após a instalação, o mesmo projeto passa a servir o G-Fit.

> **Protótipo:** o Pix permanece restrito ao Asaas Sandbox. Não use pagamentos reais nem dados sensíveis reais até concluir as revisões de segurança, LGPD e homologação.

## 1. Preparar o aaPanel

No seu servidor Linux:

1. Instale/atualize o aaPanel e habilite o **Nginx** e o gerenciamento de **Node.js**.
2. Em **Website → Node.js Project → Node version manager**, instale **Node.js 22** e selecione-o para a linha de comando. O projeto requer Node 22 ou superior, mas a versão testada é 22.
3. Instale um servidor **PostgreSQL compatível**; a versão testada é PostgreSQL 16. O aaPanel pode usar outro módulo/banco externo, desde que a API tenha acesso de rede a ele.
4. Crie um **banco vazio `gfit`** e um **usuário `gfit` com senha forte**, garantindo permissão para criar e alterar tabelas e índices no banco. Use o gerenciador de banco do servidor ou um console `psql` administrativo. **Não digite a senha superusuário do PostgreSQL no instalador**.
5. Configure o DNS do domínio para o IP do servidor e prepare um **certificado SSL válido** no aaPanel.

O instalador **não instala PostgreSQL**, não cria usuários superusuários nem executa comandos como root. Ele faz as migrações de tabelas dentro do banco já preparado.

## 2. Colocar o G-Fit no servidor

No aaPanel, use **Website → Node.js Project → Add Project → Default Project**.

| Campo | Valor recomendado |
|---|---|
| Nome | `G-Fit` |
| Diretório / Path | `/www/wwwroot/G-Fit` (ou outra pasta com o repositório) |
| Node.js runtime | **22** |
| Run User | **www** (recomendado pelo aaPanel) |
| Start command | **`node aapanel/launcher.mjs`** |
| Project Port | **3333** |
| Install dependencies | **Desativado**: o instalador gerencia esse passo |
| Mapping | **Ativado**, apontando o domínio para o projeto |
| SSL | **Ativado antes de preencher o formulário de instalação** |

Você pode importar o repositório no aaPanel por **Pull Git project** ou clonar com:

```bash
cd /www/wwwroot
git clone https://github.com/SrTristeSad/G-Fit.git
```

O usuário escolhido no aaPanel deve ter **permissão de leitura e gravação no diretório do projeto** (para `node_modules` e `web/dist`) e em sua pasta privada de configuração no diretório inicial. O instalador cria a pasta privada automaticamente, fora do diretório público. O launcher serve somente arquivos de `web/dist`.

**Importante:** a aplicação escuta apenas em **127.0.0.1:3333**, não em `0.0.0.0:3333`. O aaPanel faz o Mapping e publica o domínio na porta 443. Não é necessário liberar a porta 3333 nem a 3001 no firewall. A API interna usa 127.0.0.1:3001.

### HTTPS e cabeçalhos

Antes de enviar qualquer senha, abra o projeto no endereço **https://seu-dominio**.

O servidor de instalação aceita credenciais somente com o domínio através do proxy HTTPS **com `X-Forwarded-Proto: https`**, ou com acesso diretamente via localhost/túnel SSH. Se receber o aviso de transporte inseguro, confira no aaPanel se o **Mapping** e o SSL estão habilitados e se o proxy Nginx sobrescreve esse cabeçalho usando o esquema real:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Real-IP $remote_addr;
```

**Controle de tentativas por cliente:** antes de habilitar o uso do endereço IP encaminhado, confirme que o Nginx **sobrescreve**, e não apenas repassa, `X-Real-IP` usando `$remote_addr`. Em seguida, configure a variável de ambiente **`GFIT_TRUST_REAL_IP=true` no processo Node.js Project do aaPanel** e reinicie o projeto. Sem essa opção, o G-Fit usa o endereço local por segurança e o limite de tentativas pode ser compartilhado entre usuários; habilitar a opção com um proxy que aceite cabeçalhos enviados pelo cliente permitiria falsificar IPs. Se houver outro proxy/CDN antes do aaPanel, configure a cadeia de IP real com cuidado antes de ativar.

Edite **somente** a configuração correta do projeto no aaPanel e **faça backup antes de mexer em Nginx**. Não inclua esse cabeçalho em outro bloco sem verificar se já foi configurado; duplicatas podem causar falha em `nginx -t`. O aaPanel gerencia os demais cabeçalhos e o certificado.

Se necessário, faça a instalação via túnel SSH para `127.0.0.1:3333` e configure o HTTPS antes de usar contas reais.

## 3. Instalar pelo navegador

1. Inicie o **Node.js Project** no aaPanel.
2. Abra **Project log** e copie o número exibido em **`CÓDIGO DE INSTALAÇÃO: XXXXXXXX`**.
3. Abra o domínio HTTPS mapeado. A tela **G-Fit — Instalação aaPanel** aparecerá.
4. Insira o código, host/porta/banco/usuário/senha do PostgreSQL e o e-mail/senha da **primeira conta de administrador**.
5. Clique **Instalar G-Fit**. A página acompanha as etapas de dependências, build React, migrações, administrador e inicialização.
6. Ao concluir, clique **Abrir G-Fit**. Faça login com a senha administrativa que acabou de escolher.

O código tem **8 dígitos** e é conferido pelo servidor. Após cinco erros, a entrada fica bloqueada por 15 minutos. Não inclua código, credenciais ou tokens em URLs, capturas de tela ou mensagens públicas.

### Dependências

O G-Fit exige `api/package-lock.json` e `web/package-lock.json`, versionados com hashes de integridade. A instalação utiliza exclusivamente `npm ci --ignore-scripts`, sem fallback para `npm install`. Se um ZIP não contiver ambos os lockfiles completos, será recusado. O frontend ainda executa o build Vite após instalar as dependências.

## 4. Após a configuração inicial

- O launcher grava a conexão PostgreSQL **fora da pasta do site**, em `~/.config/gfit/<identificador-da-instalação>/instance.env`, com pasta privada (0700) e arquivo privado (0600), sob o usuário que executa o projeto. Não grava senha administrativa em texto. Nunca copie esse arquivo para o diretório público nem comite suas credenciais no GitHub.
- A aplicação passa a servir o React e a API na mesma origem do domínio (porta 3333 atrás do proxy); a API fica na porta interna 3001.
- O instalador deixa de ficar acessível após a configuração inicial; **não existe rota pública para criar outro administrador**.
- Para reiniciar o sistema, use **Node.js Project → Restart** no aaPanel, não execute outra instalação.
- O aaPanel gerencia o processo principal. O launcher inicia a API como processo filho, e a parada do serviço encaminha os sinais à API.
- **Não execute o Docker Compose ao mesmo tempo** usando os mesmos domínios/portas. O modo Docker do README continua sendo válido para testes e instalações independentes.

Para configurar o Pix Sandbox, mantenha as chaves **fora do Git**. O instalador deixa o Asaas desabilitado por padrão. Consulte a documentação do módulo financeiro e faça a homologação antes de qualquer uso real.

### Atualização pelo painel — ZIP assinado, sem GitHub na VPS

**Passo único antes da primeira atualização:** configure uma chave pública confiável no aaPanel. A chave **privada nunca deve sair do computador que cria a release**. Um ZIP traz a assinatura Ed25519 do seu manifesto; o supervisor verifica essa assinatura com a chave pública instalada **fora do diretório do site**, antes de instalar dependências.

No **computador de desenvolvimento**, com o código G-Fit:

```bash
# Execute apenas uma vez, usando caminhos FORA da pasta do repositório.
node scripts/generate-release-keys.mjs ../gfit-releases-private.pem ../gfit-releases-public.pem
```

Guarde a chave **privada** com permissão restrita e uma cópia de segurança; não a envie ao aaPanel ou GitHub. Transfira **apenas o arquivo público** ao servidor, por um canal confiável, e confira o fingerprint mostrado pelo gerador. Na **VPS**, como o mesmo usuário que executa o projeto Node.js do aaPanel (normalmente `www`), dentro da pasta G-Fit:

```bash
node scripts/trust-release-key.mjs /caminho/seguro/gfit-releases-public.pem
```

A chave pública fica em `~/.config/gfit/<identificador>/trusted-release-key.pem` ou no diretório de `GFIT_PRIVATE_DIR`, com gravação exclusiva do operador. Não há rota HTTP para substituir a chave. O comando não sobrescreve uma chave existente; eventual rotação é um procedimento manual de segurança. Após essa configuração, **as atualizações seguintes são enviadas inteiramente pelo navegador**, sem `git pull` ou GitHub na VPS.

Para cada nova versão, gere um ZIP **assinado** na máquina onde fica a chave privada:

```bash
npm run release:zip -- --version 0.1.1 --key ../gfit-releases-private.pem
```

Isso produz `releases/gfit-0.1.1.zip`. Para atualizar, use uma versão maior que a instalada (por exemplo, `0.1.2`). O ZIP não deve conter chaves, `.env` ou dados pessoais.

Na aplicação HTTPS, entre com o administrador e abra **Administração → Atualizações**. O painel mostra a impressão digital da chave pública instalada. Digite a senha administrativa atual, selecione o ZIP e envie. O backend rejeita ZIPs sem assinatura, assinados por outra chave, com CRC/hashes incorretos, com caminhos perigosos, com versões antigas, **sem os módulos essenciais** ou sem os dois lockfiles de dependências.

O supervisor prepara a atualização fora da pasta do aplicativo: **`npm ci --ignore-scripts`**, compilação do React, verificação da assinatura novamente e do conteúdo do estágio. **O ZIP não inclui `node_modules`: a VPS ainda precisa acessar o registro npm (ou ter o cache npm previamente abastecido).** A atualização dispensa o GitHub, mas não é inteiramente independente de rede. Somente após clicar em **Ativar** e confirmar `APLICAR` ele cria uma cópia do código e um **backup criptografado obrigatório do PostgreSQL via `pg_dump`**, interrompe a API, troca os arquivos e verifica a nova versão. O `pg_dump` precisa estar instalado e acessível ao usuário do aaPanel. Após a ativação, **reinicie o Node.js Project pelo aaPanel** para carregar também eventuais mudanças do supervisor.

**Proteção de migrações:** enquanto não existir um processo independente e testado de rollback do banco, o atualizador ZIP **bloqueia pacotes que modificam `api/src/db.js`**. Uma versão que necessite de alteração no esquema PostgreSQL exige manutenção manual planejada, backup externo validado e teste de restauração. Essa proteção cobre o módulo central de migrações, mas **não garante** que outro código jamais modifique o banco. Se a ativação falhar, o sistema tenta reverter **somente o código**; o banco não é revertido automaticamente.

**Rotação de snapshots:** após atualizações bem-sucedidas, por padrão são mantidas até **três** cópias criptografadas recentes, com proteção ao pacote em uso; a retenção técnica pode ser ajustada com `GFIT_UPDATE_KEEP_SNAPSHOTS` (entre 2 e 20) na configuração do processo. Snapshots de falhas e atualizações recentes devem ser inspecionados pelo operador. Essa rotação **não substitui** backup externo nem constitui política definitiva de retenção ou eliminação segundo a LGPD.

O backup pré-atualização está em `~/.config/gfit/<identificador>/updates/snapshots/<id>/database.gfitbak` (ou `GFIT_PRIVATE_DIR`), e a chave simétrica de recuperação em `updates/db-backup-key.hex`. A rotação pode apagar esses backups locais: **mantenha cópias criptografadas externas e a chave protegida separadamente**, conforme procedimento operacional. A chave privada de assinatura **não** é a chave de descriptografia do banco. Para descriptografar um snapshot em uma pasta privada, execute:

```bash
node scripts/decrypt-update-backup.mjs /caminho/database.gfitbak /caminho/updates/db-backup-key.hex /pasta-privada/recuperacao.dump
```

Inspecione o dump com `pg_restore --list /pasta-privada/recuperacao.dump` e restaure **primeiro em banco isolado**, seguindo um procedimento administrativo. Esse comando não apaga nem restaura o banco principal. Não exponha dumps ou chaves em sites, chats ou logs.

A aplicação continuará sendo um **protótipo**: ainda falta uma política completa de retenção, recuperação de desastre, autenticação reforçada para administração e homologação de dados sensíveis/produção.

### Backups importantes

Os comandos em `scripts/backup.mjs` e `scripts/restore-check.mjs` foram escritos para **PostgreSQL sob Docker Compose**, e **não atendem diretamente à instalação PostgreSQL standalone do aaPanel**. Configure e teste o backup/restauração do PostgreSQL específico do seu servidor antes de uso real. A política de retenção, criptografia em repouso e recuperação de desastre continuam pendentes.

## Diagnóstico

- **502 no domínio:** confira se a aplicação está em execução no aaPanel e se o Mapping aponta para **127.0.0.1:3333**. Verifique os logs do projeto.
- **`node: command not found` ou versão errada:** escolha Node.js 22 em **Node version manager → Command line ver**, ou no runtime do Node.js Project.
- **Falha ao instalar dependências:** confirme acesso à internet, permissões da pasta e saída do processo. O instalador exige lockfile válido e usa somente `npm ci --ignore-scripts`.
- **Assinatura não configurada:** gere o par Ed25519 fora do repositório, copie somente a chave pública e execute `node scripts/trust-release-key.mjs` na VPS, com o usuário do projeto.
- **ZIP rejeitado por migração:** alterações no arquivo central `api/src/db.js` exigem atualização manual supervisionada, não ativação por ZIP.
- **Rate limiting compartilhado:** confirme que o Nginx sobrescreve `X-Real-IP` com `$remote_addr`, habilite `GFIT_TRUST_REAL_IP=true` no processo Node.js do aaPanel e reinicie. Sem a opção, o proxy usa loopback por segurança.
- **Erro 413 ao enviar ZIP:** confira o limite de upload do Nginx em `client_max_body_size` e permita pelo menos 33 MiB no projeto. Verifique a configuração com `nginx -t` antes de recarregá-la. O limite interno do ZIP permanece em 32 MiB.
- **Backup obrigatório falhou ao ativar:** instale o cliente `pg_dump` compatível com seu PostgreSQL e torne-o acessível no PATH do usuário do Node.js no aaPanel. O código não será substituído enquanto esse backup não for concluído.
- **Falha PostgreSQL:** verifique host, porta, senha, acesso e permissões do usuário **gfit** no banco. Se o administrador foi criado em uma tentativa anterior, repita com as **mesmas credenciais**; o instalador não substitui o administrador existente.
- **Instalação bloqueada por HTTP:** abra com certificado HTTPS e Mapping correto, ou instale via túnel SSH local.
- **"Porta 3001 em uso":** não execute outra API G-Fit em paralelo na mesma VPS. Escolha a implantação aaPanel ou Docker, não ambas.
- **Senha de banco esquecida após instalar:** exige procedimento operacional de rotação de credenciais no PostgreSQL e no arquivo privado `instance.env`; o instalador não oferece um endpoint público de recuperação.
- **Dados clínicos reais e Pix:** não habilite. O produto ainda é um protótipo sem adequação completa à LGPD e sem homologação de pagamentos de produção.

Documentação aaPanel: [Node.js Project](https://www.aapanel.com/docs/Function/Node.html), [Proxy Project](https://www.aapanel.com/docs/Function/proxy.html).
