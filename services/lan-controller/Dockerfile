FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

RUN apk add --no-cache iproute2 wireguard-tools iptables procps

COPY server.mjs /app/server.mjs

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
