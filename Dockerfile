FROM node:24-bookworm-slim
LABEL org.opencontainers.image.title="Backlog Core" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.description="Bibliothèque Steam, enrichissement homogène et découverte expérientielle"
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV NODE_ENV=production PORT=3000 CORE_DB_PATH=/data/backlog-core.sqlite LEGACY_DB_PATH=/data/backlog.sqlite
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","server.js"]
