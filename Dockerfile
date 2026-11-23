FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/backlog-core.sqlite ENRICHMENT_ENABLED=false
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
