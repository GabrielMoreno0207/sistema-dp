# Comunicação DP — backend em Docker (servidor Linux)

O backend roda em um container. O programa vai dentro dele; o banco e os anexos ficam em um
**volume do Docker** (`comunicacao-dp-dados`), separado do container — derrubar, recriar ou
atualizar o container não perde nada.

> **Por que um volume e não uma pasta do servidor:** arquivos grandes e permissões
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
chmod +x instalar.sh dp.sh backup.sh

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

O banco é o PostgreSQL, e o backup do `backup.sh` sai em formato `custom` (`pg_dump -Fc`).
Para levantar esse banco em outra máquina:

```bash
docker compose -f docker-compose.postgres.yml --env-file .env.postgres up -d   # sobe o PostgreSQL
docker compose exec -T sistema-dp-postgres pg_restore -U sistema_dp -d sistema_dp --clean --if-exists \
  < backups/sistema-dp-DATA.dump
./instalar.sh
```

Os anexos e as mídias **não estão dentro do banco**: eles vêm no `anexos-DATA.tar.gz` do mesmo
backup e voltam para o volume:

```bash
mkdir -p /tmp/restaurar && tar -xzf backups/anexos-DATA.tar.gz -C /tmp/restaurar
docker run --rm -v comunicacao-dp-dados:/app/data -v /tmp/restaurar:/entrada alpine \
  sh -c "cp -a /entrada/uploads /app/data/ && cp -a /entrada/midias /app/data/"
```

### Desconfiou que o banco está estranho?

Setores, funcionários ou comunicados sumindo, ou erros de validação em telas que sempre
funcionaram. Para olhar o banco por dentro:

```bash
docker compose exec -T sistema-dp-postgres psql -U sistema_dp -d sistema_dp -c '\dt dp.*'
```

O Adminer (`http://localhost:8081`) mostra as mesmas tabelas pelo navegador. Havendo dano,
pare o container e volte o backup mais recente com o `pg_restore` acima.

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
> só do dump deixaria os comunicados sem os arquivos.

Para restaurar:

```bash
./dp.sh parar
docker compose exec -T sistema-dp-postgres pg_restore -U sistema_dp -d sistema_dp --clean --if-exists \
  < backups/sistema-dp-DATA.dump
mkdir -p /tmp/restaurar && tar -xzf backups/anexos-DATA.tar.gz -C /tmp/restaurar
docker run --rm -v comunicacao-dp-dados:/app/data -v /tmp/restaurar:/entrada alpine \
  sh -c "cp -a /entrada/uploads /app/data/"
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
- **Node 22**: é a versão em que o backend é compilado e testado.
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
