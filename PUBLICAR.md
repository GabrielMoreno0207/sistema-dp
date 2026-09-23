# Publicar uma versão nova

Tudo pelo **versionador**, de qualquer máquina que enxergue o servidor. Não é
preciso entrar no servidor nem visitar os computadores.

O versionador pede o endereço do servidor e o login do TI.

---

## Aplicativo dos PCs (desktop)

```powershell
cd desktop
# 1. suba a versão em package.json  (ex.: 1.17.1 -> 1.18.0)
npm run dist:win
# sai em desktop\dist-nova\ComunicacaoDP-Setup-<versao>.exe
```

No versionador: aba **[ desktop ]** → escolher o `.exe` → informar a mesma
versão → notas (aparecem no aviso) → marcar **obrigatória** se ninguém puder
adiar → **publicar**.

O que acontece depois: o servidor avisa os PCs conectados, cada um baixa,
confere o SHA-256 e instala em silêncio. Quem estiver desligado pega ao abrir o
aplicativo (3 minutos depois) ou na checagem das 03:00.

---

## Servidor (backend)

```powershell
cd backend
# 1. suba a versão em package.json  (ex.: 1.2.0 -> 1.3.0)
npm test            # precisa do PostgreSQL: TEST_DATABASE_URL=postgresql://...
npm run empacotar
# sai em backend\publicar\servidor-<versao>.tar.gz
```

No versionador: aba **[ backend ]** → escolher o `.tar.gz` → informar a **mesma
versão do package.json** (o servidor recusa se não bater) → **publicar**.

O que acontece depois: o servidor confere o pacote, troca os arquivos e
reinicia (5 a 10 segundos). As migrações do banco rodam nessa subida. A tela do
versionador espera ele voltar e confirma a versão. **Se a versão nova não
subir, a anterior volta sozinha.**

---

## Os dois na mesma leva

Publique o **backend primeiro**, espere o versionador confirmar que ele voltou,
e só então o desktop. Assim nenhum PC roda uma versão que depende de uma rota
que ainda não existe.

---

## Quando ainda é preciso entrar no servidor

Só quando a mudança está **fora do pacote**:

- Dockerfile, `docker-compose.yml`, variáveis de ambiente, versão do Node
- voltar o servidor a um estado conhecido

```bash
# no servidor
cd /caminho/do/sistema-dp
git pull
./dp.sh atualizar     # backup, reconstrói a imagem e sobe
```

Reconstruir a imagem passa por cima do que o versionador tinha instalado: a
imagem é a versão que vale a partir daí.

---

## Conferir depois de publicar

```bash
./dp.sh status                      # container e backend respondendo
./dp.sh logs                        # acompanha (Ctrl+C sai)
```

No log de subida, duas linhas dizem se está tudo no lugar:

```
Banco de dados -> PostgreSQL: ... (schema dp)
Pastas -> anexos: /app/data/uploads | mídias: /app/data/midias | atualizações: /app/data/atualizacoes
```

---

## Detalhes que evitam dor de cabeça

- **A versão precisa subir a cada publicação.** O servidor guarda as versões
  pelo número; republicar o mesmo número é recusado.
- **O pacote do servidor leva as dependências junto.** Ele é montado com
  `npm ci --omit=dev`, então precisa de internet na hora de gerar — não na hora
  de publicar.
- **Dependência nativa.** Todas as dependências de hoje são JavaScript puro, e
  o pacote gerado no Windows roda no Linux. Se um dia entrar uma dependência
  com código compilado, o pacote passa a ter de ser gerado no Linux.
- **O endereço do servidor** fica em `%APPDATA%\Comunicação DP\config.json` de
  cada PC. Use um nome DNS (e não um IP) desde a instalação: trocar o servidor
  de máquina vira uma mudança no DNS, sem tocar em nenhum computador.
- **Backup antes de mexer:** `./dp.sh atualizar` já faz; publicar pelo
  versionador não faz. Para gerar na mão: `./backup.sh`.
