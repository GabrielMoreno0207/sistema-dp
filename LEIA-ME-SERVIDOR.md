# Comunica Trinys — instalar no servidor Linux

Este pacote tem **só o que o servidor precisa**: o backend (que os aplicativos usam),
o banco PostgreSQL e os scripts de instalação, backup e manutenção. O aplicativo dos
computadores (Windows) é instalado separadamente e só aponta para o endereço deste servidor.

Requisitos: um Linux com **Docker** e o plugin **docker compose**. Nada mais precisa ser
instalado (Node, banco, nginx — tudo já vem nos containers).

---

## 1. Instalar

```bash
# copie a pasta para o servidor, por exemplo em /opt/comunicacao-dp
cd /opt/comunicacao-dp

# o bit de "executável" some ao copiar do Windows: devolva
chmod +x instalar.sh dp.sh backup.sh

./instalar.sh
```

O instalador faz tudo sozinho e pode ser rodado de novo sem medo (o que já existe é mantido):

1. confere o Docker;
2. cria o `.env.postgres` com uma senha aleatória e sobe o **PostgreSQL**;
3. cria o `.env` do backend, já apontando para esse banco, com uma senha aleatória para o
   primeiro login;
4. cria o volume de dados (anexos, mídias e instaladores);
5. constrói a imagem, sobe o container e espera ficar saudável;
6. mostra **o endereço e a senha do primeiro login — anote, ela só aparece aqui**.

Não tem Docker ainda?

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER    # saia e entre de novo para valer
```

### Depois de instalar

- **Aplicativos** (computador e celular): endereço `http://<ip-do-servidor>:3000`
- **Endereço para os computadores**: `http://<ip-do-servidor>:3000` — é isso que vai na tela de
  configurações do aplicativo Windows.
- Libere a porta no firewall, se houver:
  `sudo ufw allow 3000/tcp` (Ubuntu/Debian) ou
  `sudo firewall-cmd --add-port=3000/tcp --permanent && sudo firewall-cmd --reload` (Rocky/RHEL).

Para usar outra porta, mude `PORTA=` no `.env` e rode `docker compose up -d`.

---

## 2. Comandos do dia a dia

```bash
docker compose ps           # situação dos containers
docker compose logs -f      # acompanhar o log do backend
./dp.sh status              # resumo (containers + endereço)
./dp.sh logs                # o mesmo que o logs -f
./dp.sh criar-login livia "Livia Santos" --gerar    # novo login do DP (senha sai na tela)
docker compose exec backend cat /app/data/credenciais-iniciais.txt   # senhas geradas, se perder a tela
./dp.sh trocar-senha ti                             # redefine a senha de um login
./dp.sh liberar-pc PC-1A2B3C4D5E6F                  # libera um computador bloqueado
./dp.sh shell               # um shell dentro do container
```

---

## 3. Backup

O backup tira o banco **e** os arquivos (anexos dos comunicados, mídias do mural, fotos de perfil
e arquivos do chat) — eles não ficam dentro do banco.

```bash
./backup.sh                 # grava em ./backups
./backup.sh /mnt/backup     # grava na pasta indicada
```

Agende no cron (diário, 2h da manhã):

```bash
crontab -e
0 2 * * * cd /opt/comunicacao-dp && ./backup.sh >> backups/backup.log 2>&1
```

Cópias com mais de 30 dias são apagadas sozinhas. **Leve os backups para fora do servidor**
(outro disco, NAS ou nuvem) — backup na mesma máquina não protege de perder a máquina.

Restaurar:

```bash
# banco
docker exec -i sistema-dp-postgres pg_restore -U sistema_dp -d sistema_dp \
  --clean --if-exists --no-owner < backups/sistema-dp-AAAA-MM-DD_HHMM.dump

# arquivos
mkdir -p /tmp/restaurar && tar -xzf backups/anexos-AAAA-MM-DD_HHMM.tar.gz -C /tmp/restaurar
docker run --rm -v comunicacao-dp-dados:/app/data -v /tmp/restaurar:/entrada alpine \
  sh -c "cp -a /entrada/uploads /app/data/ && cp -a /entrada/midias /app/data/"
```

---

## 4. Atualizar o sistema depois

Há dois caminhos, e o normal é o primeiro:

- **Pelo versionador (sem entrar no servidor).** Quem cuida do sistema publica a versão nova pelo
  aplicativo versionador; o servidor recebe o pacote, troca a versão sozinho e, se a nova não
  subir, volta para a anterior automaticamente. Os computadores também se atualizam sozinhos.
- **Com o código novo na mão** (quando chegar uma pasta atualizada como esta):

  ```bash
  ./dp.sh atualizar     # tira backup, reconstrói a imagem e sobe a versão nova
  ```

  As mudanças de banco são aplicadas sozinhas na subida.

---

## 5. Onde ficam os dados

| O quê | Onde |
|---|---|
| Banco (funcionários, comunicados, conversas) | volume `sistema-dp-pgdados` |
| Anexos, mídias e instaladores | volume `comunicacao-dp-dados` |
| Código do servidor em execução | volume `comunicacao-dp-aplicativo` |
| Backups | pasta `./backups` deste diretório |

`docker compose down` **não** apaga volume nenhum. Só `docker compose down -v` apaga — e aí perde
tudo o que estiver ali.

Para olhar os arquivos: `docker compose exec backend ls -la /app/data`

---

## 6. Segurança

- Os arquivos `.env` e `.env.postgres` **guardam senhas**: eles nascem com permissão `600` e não
  devem ser copiados para lugar nenhum.
- O sistema roda em **HTTP** na rede interna da empresa. Se um dia for exposto para fora, coloque
  um proxy reverso com HTTPS na frente (nginx, Caddy ou Traefik) — o `README-DOCKER.md` tem o
  exemplo pronto, inclusive com `client_max_body_size 0`, porque imagens e vídeos vão sem limite
  de tamanho.
- O **Adminer** (interface web do banco) só escuta em `127.0.0.1`. Para usá-lo de fora, faça um
  túnel: `ssh -L 8081:127.0.0.1:8081 usuario@servidor` e abra `http://localhost:8081`.
- O container roda como usuário sem privilégio (`node`, uid 1000), nunca como root.

---

## 7. Se algo der errado

```bash
docker compose logs --tail 100        # últimas linhas do backend
docker compose ps                     # algum container reiniciando?
curl -s http://localhost:3000/api/health     # deve responder {"status":"ok",...}
```

- **"external volume not found"**: rode o `./instalar.sh`, que cria o volume.
- **Backend sobe e cai**: quase sempre é o banco fora do ar ou o `DATABASE_URL` errado no `.env`.
  Confira com `docker compose -f docker-compose.postgres.yml --env-file .env.postgres ps`.
- **Os PCs não conectam**: teste do próprio servidor (`curl`), depois de outra máquina
  (`curl http://<ip>:3000/api/health`). Respondendo no servidor e não de fora, é firewall.

O `README-DOCKER.md` tem o detalhamento completo (HTTPS, restauração, manutenção do banco).
