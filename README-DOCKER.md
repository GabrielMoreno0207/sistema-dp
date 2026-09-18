# Comunicação DP — backend em Docker (servidor Linux)

O backend roda em um container. O programa vai dentro dele; o banco e os anexos ficam em um
**volume do Docker** (`comunicacao-dp-dados`), separado do container — derrubar, recriar ou
atualizar o container não perde nada.

> **Por que um volume e não uma pasta do servidor:** o SQLite grava em três arquivos e precisa de
> travas e memória compartilhada de verdade. Em pasta compartilhada com o container (bind mount) —
> em especial no Docker Desktop do Windows, mas também em NFS e SMB — essas travas não funcionam
> direito: dá para o banco corromper, e até para o arquivo sumir, **sem nenhuma mensagem de erro**.
> No volume, o banco fica no sistema de arquivos do próprio Docker, onde tudo funciona.
> Os backups, esses sim, saem para `./backups`, visível no servidor.

Serve qualquer Linux com Docker (Ubuntu Server, Debian, Rocky…). Os computadores da fábrica
continuam com o aplicativo Windows de sempre, só apontando para o endereço do servidor Linux.

---

## Instalação

Na máquina Linux, com Docker e o plugin `docker compose` instalados:

```bash
# 1. copie a pasta do projeto para o servidor, por exemplo em /opt/comunicacao-dp
cd /opt/comunicacao-dp

# 2. garanta que os scripts são executáveis (o bit some ao copiar do Windows)
chmod +x instalar.sh dp.sh backup.sh importar-banco.sh

# 3. rode o instalador
./instalar.sh
```

O `instalar.sh` cria o `.env` (com uma senha aleatória para o primeiro login), prepara a pasta
`data/`, constrói a imagem, sobe o container, espera ficar saudável e mostra **o endereço e a
senha — anote**.

Não tem Docker ainda?

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # saia e entre de novo para valer
```

Depois é só abrir `http://<ip-do-servidor>:3000/central` e entrar com o login e a senha que
o instalador mostrou. A Central pede para trocar a senha no primeiro acesso.

---

## Trazer um banco que já existe

Se você já tem um banco rodando em outro lugar (outro servidor, um backup, a instalação do
Windows), **não copie a pasta `data/` inteira**. Use o importador:

```bash
docker compose build                                              # precisa da imagem
./importar-banco.sh /caminho/do/sistema-dp.db /caminho/do/uploads # banco + anexos
./instalar.sh
```

O segundo argumento é a pasta `uploads` do servidor antigo — os anexos **não** estão dentro do
banco. Sem ela, os comunicados aparecem sem os arquivos.

**Por que não dá para copiar direto:** o SQLite grava em três arquivos — `sistema-dp.db` e mais
`sistema-dp.db-wal` e `sistema-dp.db-shm` ao lado dele. Os dois auxiliares **valem apenas na
máquina onde foram criados**. Levados para outra, acontecem duas coisas ruins, nenhuma delas com
mensagem de erro: o servidor passa a ler dados antigos e as gravações novas se perdem em silêncio
(o sintoma clássico é *"troquei a senha e o login continua não funcionando"*); e, se alguém abrir
esse banco para escrita, o `-wal` que não combina é aplicado por cima e **corrompe o arquivo**.

O `importar-banco.sh` usa **somente o arquivo `.db`**, confere a integridade antes e depois, e
nunca toca no original. Se encontrar um `-wal` ao lado da origem, ele avisa e pede confirmação —
o certo, nesse caso, é gerar um arquivo já consolidado na máquina de origem (`backup.sh` no Linux,
`backup-banco.cmd` no Windows) e trazer esse. O `instalar.sh` também barra a instalação se
encontrar `-wal`/`-shm` em `data/`.

Melhor ainda: para levar um banco de um lugar para outro, use sempre o arquivo que o `backup.sh`
produz. Ele sai de um `VACUUM INTO`, é um arquivo único e pode ser copiado à vontade.

### Desconfiou que o banco está estranho?

Setores, funcionários ou comunicados sumindo, ou erros de validação em telas que sempre
funcionaram, são sinal de banco danificado. Para conferir:

```bash
docker compose exec backend node -e "const {DatabaseSync}=require('node:sqlite');   console.log(new DatabaseSync(process.env.DATABASE_PATH,{readOnly:true}).prepare('PRAGMA integrity_check').get())"
```

Qualquer coisa diferente de `ok` significa banco corrompido: pare o container e volte o backup
mais recente com o `importar-banco.sh`.

## O dia a dia

Tudo pelo `dp.sh`:

| Comando | O que faz |
|---|---|
| `./dp.sh status` | Diz se o container está de pé e se o backend responde |
| `./dp.sh logs` | Acompanha os logs (`Ctrl+C` sai) |
| `./dp.sh criar-login livia "Livia Santos" --gerar` | Cria o login da Central de uma pessoa do DP |
| `./dp.sh trocar-senha ti` | Troca a senha de um login |
| `./dp.sh liberar-pc PC-1A2B3C4D5E6F` | Libera um PC para se registrar de novo (Windows reinstalado) |
| `./dp.sh reiniciar` / `parar` / `subir` | Controla o container |
| `./dp.sh atualizar` | Backup + reconstrói a imagem + sobe a versão nova |
| `./backup.sh` | Backup do banco **e dos anexos** |
| `./importar-banco.sh <arquivo.db>` | Traz um banco de outra máquina do jeito certo |

Com `--gerar`, a senha inicial fica em `credenciais-iniciais.txt` dentro do volume — para lê-la:
`docker compose exec backend cat /app/data/credenciais-iniciais.txt`. Passe para a pessoa e
apague o arquivo. Use `--sem-chat` para logins que não devem aparecer na lista de contatos do
aplicativo (o do TI, por exemplo).

### Apontar os computadores para o servidor

No aplicativo de cada PC, em **Configurações**, ou no `.env` ao lado do `ComunicacaoDP.exe`:

```
SERVER_URL=http://<ip-ou-nome-do-servidor-linux>:3000
```

Use o nome do servidor em vez do IP sempre que der: se o IP mudar, nada precisa ser refeito.

---

## Backup

```bash
./backup.sh                 # grava em ./backups
./backup.sh /mnt/backup     # grava onde você quiser
```

Gera dois arquivos com a data no nome: o banco (`sistema-dp-*.db`, copiado com `VACUUM INTO`,
funciona com o container no ar) e os anexos (`anexos-*.tar.gz`). Cópias com mais de 30 dias são
apagadas sozinhas. O backup também avisa se encontrar o banco fora de ordem (`integrity_check`).

No cron, diariamente às 2h:

```
0 2 * * * cd /opt/comunicacao-dp && ./backup.sh >> backups/backup.log 2>&1
```

> Os anexos dos comunicados **não ficam dentro do banco**: eles estão em `data/uploads`. Um backup
> só do `.db` deixaria os comunicados sem os arquivos.

Para restaurar:

```bash
./dp.sh parar
mkdir -p /tmp/restaurar && tar -xzf backups/anexos-DATA.tar.gz -C /tmp/restaurar
./importar-banco.sh backups/sistema-dp-DATA.db /tmp/restaurar/uploads
./dp.sh subir
```

---

## HTTPS

Sem HTTPS, a senha do DP e os tokens trafegam sem cifra pela rede interna. Duas saídas:

**A) Proxy reverso na frente (mais simples em Linux).** Coloque nginx, Caddy ou Traefik ouvindo
em 443 e repassando para o container. Duas coisas são obrigatórias:

- repassar **WebSocket** (cabeçalhos `Upgrade` e `Connection`), senão as mensagens não chegam na hora;
- preencher `TRUST_PROXY` no `.env` com o IP do proxy, para o bloqueio de tentativas de login
  enxergar o IP real de cada pessoa em vez do IP do proxy.

Exemplo de nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 12m;   # anexos de até 10 MB
}
```

**B) Certificado direto no backend.** Coloque o certificado e a chave em uma pasta `certs/` aqui e
acrescente ao `docker-compose.yml`, em `volumes:` e em `environment:`:

```yaml
    volumes:
      - ./certs:/app/certs:ro
    environment:
      TLS_CERT_FILE: /app/certs/servidor.crt
      TLS_KEY_FILE: /app/certs/servidor.key
```

e nos computadores use `SERVER_URL=https://servidor:3000`. O certificado precisa ser confiável no
Windows — com a CA interna da empresa distribuída pelo AD, já é.

Depois de mexer no `.env` ou no `docker-compose.yml`: `./dp.sh reiniciar`.

---

## Atualizar para uma versão nova

```bash
cd /opt/comunicacao-dp
# substitua os arquivos do projeto pela versão nova (mantenha .env e data/)
./dp.sh atualizar
```

O `atualizar` tira um backup, reconstrói a imagem e sobe. As migrações do banco são aplicadas
sozinhas na primeira subida da versão nova.

---

## Servidor sem internet

O `instalar.sh` precisa baixar a imagem base do Node e as dependências. Se o servidor não tem
internet, construa a imagem em uma máquina que tenha e leve pronta:

```bash
# na máquina com internet, na pasta do projeto
docker compose build
docker save comunicacao-dp-backend:1.1.0 | gzip > comunicacao-dp-backend.tar.gz

# leve o .tar.gz, o docker-compose.yml, o .env.exemplo e os .sh para o servidor
docker load < comunicacao-dp-backend.tar.gz
cp .env.exemplo .env && nano .env      # defina ADMIN_PASSWORD
docker compose up -d --no-build
```

---

## Detalhes de quem cuida

- **Imagem**: `node:22-alpine` em três estágios (compila o TypeScript, resolve só as dependências
  de produção, monta a imagem final). Roda como o usuário `node` (uid 1000), nunca como root.
- **Node 22**: o banco usa o módulo nativo `node:sqlite`, que exige Node 22.13 ou superior.
- **Volume**: `comunicacao-dp-dados` → `/app/data` (banco, anexos e credenciais iniciais).
  Para olhar: `docker compose exec backend ls -la /app/data`. Para tirar um arquivo de lá:
  `docker compose cp backend:/app/data/credenciais-iniciais.txt .`
  O `docker compose down` **não** apaga o volume; só `docker compose down -v` apaga (e aí perde tudo).
- **Healthcheck**: o Docker chama `/api/health` a cada 30s; `docker compose ps` mostra
  `healthy`/`unhealthy`.
- **Encerramento**: o backend trata `SIGTERM`, então `docker compose down` fecha o banco direito.
- **Logs**: ficam no Docker (`./dp.sh logs`), limitados a 5 arquivos de 10 MB.
- **Porta**: muda em `PORTA` no `.env` (dentro do container é sempre 3000).

O código-fonte, a documentação da API e os testes ficam em `backend/`. A pasta
`publicar/comunicacao-dp-backend/` é o pacote para Windows — em Linux, ignore.
