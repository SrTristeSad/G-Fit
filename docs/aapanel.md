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
proxy_set_header X-Forwarded-Proto $scheme;
```

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

O instalador detecta se existe `package-lock.json` em cada projeto. Com lockfile, usa `npm ci`; sem lockfile, usa `npm install`. Isso evita o erro anterior de tentar usar `npm ci` em um projeto sem `package-lock.json`. O backend instala dependências de produção, e a interface React instala dependências de build para rodar `npm run build`. O build estático gerado é servido pelo Node.

## 4. Após a configuração inicial

- O launcher grava a conexão PostgreSQL **fora da pasta do site**, em `~/.config/gfit/<identificador-da-instalação>/instance.env`, com pasta privada (0700) e arquivo privado (0600), sob o usuário que executa o projeto. Não grava senha administrativa em texto. Nunca copie esse arquivo para o diretório público nem comite suas credenciais no GitHub.
- A aplicação passa a servir o React e a API na mesma origem do domínio (porta 3333 atrás do proxy); a API fica na porta interna 3001.
- O instalador deixa de ficar acessível após a configuração inicial; **não existe rota pública para criar outro administrador**.
- Para reiniciar o sistema, use **Node.js Project → Restart** no aaPanel, não execute outra instalação.
- O aaPanel gerencia o processo principal. O launcher inicia a API como processo filho, e a parada do serviço encaminha os sinais à API.
- **Não execute o Docker Compose ao mesmo tempo** usando os mesmos domínios/portas. O modo Docker do README continua sendo válido para testes e instalações independentes.

Para configurar o Pix Sandbox, mantenha as chaves **fora do Git**. O instalador deixa o Asaas desabilitado por padrão. Consulte a documentação do módulo financeiro e faça a homologação antes de qualquer uso real.

### Atualização pelo painel — arquivo ZIP, sem GitHub

Depois que **esta versão com o atualizador** estiver instalada, as próximas atualizações do G-Fit podem ser feitas **sem executar git pull, sem GitHub e sem terminal na VPS**:

1. Na máquina onde você mantém o código-fonte do G-Fit, prepare uma versão nova e gere um ZIP completo com `npm run release:zip -- --version 0.1.1`. Para cada atualização seguinte, incremente a versão (`0.1.2`, `0.1.3` etc.). O comando salva `releases/gfit-0.1.1.zip`; não inclui `.env`, dados pessoais nem bancos.
2. Abra o G-Fit no domínio HTTPS e entre com a conta administrativa.
3. Entre em **Administração → Atualizações** e selecione o ZIP.
4. Confirme a **senha atual de administrador**, envie o pacote e acompanhe a validação. O servidor verifica caminhos, tamanho, integridade CRC/SHA-256, arquivos obrigatórios, versão superior, extrai em pasta privada, instala dependências em staging e compila o React. A versão em uso continua ativa durante esta preparação.
5. Confira versão e SHA-256 exibidos na tela. Digite `APLICAR` e confirme a ativação. Antes de trocar o código, o atualizador exige um **backup criptografado do PostgreSQL** via `pg_dump` e uma cópia privada dos arquivos atuais; para isso, o usuário do Node.js deve ter acesso ao cliente PostgreSQL e espaço suficiente no disco.
6. O supervisor interrompe a API por alguns instantes, ativa os arquivos preparados, inicia a nova API e verifica o endpoint de saúde. Se a ativação falhar, **tenta restaurar automaticamente o código anterior**. Não há restauração automática de dados PostgreSQL: uma migração já executada pode exigir restauração **manual**.
7. Se a tela indicar ativação concluída, **reinicie o Node.js Project pelo aaPanel** para também carregar qualquer alteração no próprio supervisor. A versão nova permanece registrada em armazenamento privado.

O painel registra histórico de versão, data, SHA-256 e resultado. O pacote preparado permanece na pasta privada da instalação até a ativação ou descarte. A chave e os backups de atualização também ficam fora da pasta pública do site; o operador deve protegê-los e acompanhar o armazenamento.

**Segurança:** o ZIP usa manifesto, CRC e SHA-256 para verificar integridade, mas **não possui assinatura digital de um distribuidor**. Isso significa que um atacante que controle o pacote pode substituí-lo e recalcular os hashes. Instale somente ZIPs que você próprio gerou ou verificou. Atualizações executam código de servidor e não são equivalentes a simplesmente importar dados.

**Pré-requisito:** tenha o executável `pg_dump` acessível no PATH do processo Node do aaPanel, preferencialmente na mesma versão principal do PostgreSQL ou em versão mais recente e compatível. A ativação é bloqueada se o backup do banco não for concluído. Não apague o diretório privado `~/.config/gfit/` ou o banco PostgreSQL ao atualizar.

**Limitações:** os arquivos e dependências do servidor são atualizados; a recuperação de banco e de migrações destrutivas não é automática. Faça um backup operacional independente e teste sua recuperação antes de implantar versões com alterações de banco. Não use este mecanismo ainda para dados sensíveis reais ou instalações comerciais não homologadas. Não existe suporte a pacotes parciais, downgrades, assinatura Ed25519 ou instalação por GitHub remoto.

### Backups importantes

Os comandos em `scripts/backup.mjs` e `scripts/restore-check.mjs` foram escritos para **PostgreSQL sob Docker Compose**, e **não atendem diretamente à instalação PostgreSQL standalone do aaPanel**. Configure e teste o backup/restauração do PostgreSQL específico do seu servidor antes de uso real. A política de retenção, criptografia em repouso e recuperação de desastre continuam pendentes.

## Diagnóstico

- **502 no domínio:** confira se a aplicação está em execução no aaPanel e se o Mapping aponta para **127.0.0.1:3333**. Verifique os logs do projeto.
- **`node: command not found` ou versão errada:** escolha Node.js 22 em **Node version manager → Command line ver**, ou no runtime do Node.js Project.
- **Falha ao instalar dependências:** confirme acesso à internet, permissões da pasta e saída do processo. Um `npm ci` só é usado quando há lockfile.
- **Falha PostgreSQL:** verifique host, porta, senha, acesso e permissões do usuário **gfit** no banco. Se o administrador foi criado em uma tentativa anterior, repita com as **mesmas credenciais**; o instalador não substitui o administrador existente.
- **Instalação bloqueada por HTTP:** abra com certificado HTTPS e Mapping correto, ou instale via túnel SSH local.
- **"Porta 3001 em uso":** não execute outra API G-Fit em paralelo na mesma VPS. Escolha a implantação aaPanel ou Docker, não ambas.
- **Senha de banco esquecida após instalar:** exige procedimento operacional de rotação de credenciais no PostgreSQL e no arquivo privado `instance.env`; o instalador não oferece um endpoint público de recuperação.
- **Dados clínicos reais e Pix:** não habilite. O produto ainda é um protótipo sem adequação completa à LGPD e sem homologação de pagamentos de produção.

Documentação aaPanel: [Node.js Project](https://www.aapanel.com/docs/Function/Node.html), [Proxy Project](https://www.aapanel.com/docs/Function/proxy.html).
