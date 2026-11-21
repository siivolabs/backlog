FROM node:24-alpine AS test
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm test && npm run check

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/backlog-core.sqlite
WORKDIR /app
COPY --from=test --chown=node:node /app/package*.json ./
COPY --from=test --chown=node:node /app/src ./src
COPY --from=test --chown=node:node /app/public ./public
COPY --from=test --chown=node:node /app/scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "src/server.js"]
