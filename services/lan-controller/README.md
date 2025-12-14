## LAN Controller (ZeroTier auto-authorize)

Pequeno serviço HTTP (sem dependências) para **autorizar automaticamente** o dispositivo do usuário dentro de uma rede ZeroTier, evitando que o usuário tenha que abrir o ZeroTier Central manualmente.

### Por que existe?

No ZeroTier, quando o usuário dá `join` em uma rede privada, normalmente é preciso **autorizar** o node no Central. Esse serviço faz isso via API.

### Requisitos

- Um token da API do ZeroTier Central (crie em `https://my.zerotier.com/account`)
- Um `networkId` (16 hex) da sua rede (será usado como **rede padrão**)

### Rodar no VPS (recomendado)

```bash
cd services/lan-controller
PORT=8787 \
ZT_API_TOKEN="SEU_TOKEN" \
ZT_DEFAULT_NETWORK_ID="SEU_NETWORK_ID" \
LAN_CONTROLLER_API_KEY="(opcional)" \
node server.mjs
```

### Rodar com Docker (recomendado / plug&play)

Pré-requisito: o DNS `vpn.mroz.dev.br` deve apontar para o IP do VPS e as portas `80/443` devem estar liberadas.

1) Crie um `.env` baseado no exemplo:

```bash
cd services/lan-controller
cp .env.example .env
```

2) Edite o `.env` com seu token e network id.

3) Suba o stack:

```bash
docker compose -f compose.yml up -d --build
```

Isso vai:
- subir `lan-controller` internamente na rede do docker
- subir `caddy` como reverse proxy com **HTTPS automático** para `vpn.mroz.dev.br`

### Se as portas 80/443 já estão em uso no VPS

Use o `compose.direct.yml` (expondo a porta `8787`) e configure o reverse proxy existente (Nginx/Traefik/Caddy) para apontar `vpn.mroz.dev.br` para `http://127.0.0.1:8787`.

```bash
docker compose -f compose.direct.yml up -d --build
```

Exemplo de Nginx: `services/lan-controller/nginx.vpn.mroz.dev.br.conf.example`

### Rodar sem Caddy (se você já tem proxy)

Se você já tem Nginx/Traefik/etc, você pode subir apenas o serviço e apontar seu proxy para `http://lan-controller:8787` (ou mapeando uma porta no host).

Exemplo (modo rápido, expõe porta no host):

```bash
docker build -t lan-controller .
docker run -d --restart unless-stopped \
  -p 8787:8787 \
  -e ZT_API_TOKEN="..." \
  -e ZT_DEFAULT_NETWORK_ID="..." \
  -e LAN_CONTROLLER_API_KEY="(opcional)" \
  --name lan-controller \
  lan-controller
```

### Endpoints

- `GET /healthz`
- `GET /api/config`
- `POST /api/zerotier/authorize`
  - Headers: `x-api-key: <LAN_CONTROLLER_API_KEY>` (se configurado)
  - Body JSON:
    - `memberId` (obrigatório): node id do ZeroTier (ex.: `a1b2c3d4e5`)
    - `networkId` (opcional): usa `ZT_DEFAULT_NETWORK_ID` se omitido

Exemplo:

```bash
curl -sS http://localhost:8787/api/zerotier/authorize \
  -H 'content-type: application/json' \
  -H 'x-api-key: UM_SEGREDO' \
  -d '{"memberId":"a1b2c3d4e5"}'
```

### Salas (Rooms)

Para simplificar o uso no launcher, o servidor pode criar/gerenciar “salas”.

- `POST /api/rooms/create`
  - cria uma sala **dentro da rede padrão** (`ZT_DEFAULT_NETWORK_ID`) e retorna um `code` + `networkId`
  - body opcional: `{ "name": "Minha sala", "memberId": "a1b2c3d4e5" }` (se `memberId` for informado, tenta autorizar automaticamente)
- `POST /api/rooms/join`
  - body: `{ "code": "ABCD1234EF", "memberId": "a1b2c3d4e5" }` (memberId opcional)
  - retorna `networkId` e tenta autorizar o member automaticamente se `memberId` for informado
