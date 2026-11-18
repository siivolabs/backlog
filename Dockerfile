FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV PORT=3094 \
    BACKLOG_DB=/data/backlog.sqlite \
    OLLAMA_URL=http://host.docker.internal:11434 \
    EMBEDDING_MODEL=embeddinggemma \
    EXPERIMENT_SIZE=50
EXPOSE 3094
CMD ["node", "server.js"]
