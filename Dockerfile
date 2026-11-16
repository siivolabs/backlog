FROM node:22-alpine

LABEL org.opencontainers.image.title="Backlog" \
      org.opencontainers.image.description="Bibliothèque Steam auto-hébergée" \
      org.opencontainers.image.version="0.4.0" \
      org.opencontainers.image.source="https://github.com/siivolabs/backlog"

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

COPY --chown=node:node server.js ./server.js
COPY --chown=node:node public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
