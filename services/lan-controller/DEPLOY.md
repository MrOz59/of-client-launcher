# Deploy no VPS (`root@chaos.mroz.dev.br`)

Pré-requisitos no VPS:
- `docker` e `docker compose` funcionando
- DNS `vpn.mroz.dev.br` apontando pro IP do VPS
- Portas `80` e `443` liberadas (Caddy vai emitir certificado automaticamente)

## Deploy automático (recomendado)

No seu PC (onde você tem acesso SSH ao VPS):

```bash
export ZT_API_TOKEN="SEU_TOKEN_DA_ZEROTIER"
export ZT_DEFAULT_NETWORK_ID="SEU_NETWORK_ID"
export LAN_CONTROLLER_API_KEY="(opcional)"

bash services/lan-controller/deploy.sh root@chaos.mroz.dev.br
```

Se as portas 80/443 já estiverem em uso no VPS, rode com:

```bash
COMPOSE_FILE=compose.direct.yml bash services/lan-controller/deploy.sh root@chaos.mroz.dev.br
```

Checar:

```bash
ssh root@chaos.mroz.dev.br "cd /opt/lan-controller && docker compose ps"
ssh root@chaos.mroz.dev.br "cd /opt/lan-controller && docker compose logs -n 200 --no-color"
```

Teste rápido:

```bash
curl -sS https://vpn.mroz.dev.br/healthz
```

## Se você já tem reverse proxy

Suba só o container `lan-controller` e faça o proxy no seu stack atual.
Você pode editar `compose.yml` e remover o serviço `caddy`, ou expor a porta:

```yaml
ports:
  - "8787:8787"
```
