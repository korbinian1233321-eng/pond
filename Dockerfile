# Pond · 生产镜像
# node:22-alpine 已包含 node:sqlite（22.5+），无需额外依赖
FROM node:22-alpine

LABEL org.opencontainers.image.title="Pond" \
      org.opencontainers.image.description="零依赖的自托管社区引擎（塘 + 楼层）" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

ENV NODE_ENV=production \
    POND_HOST=0.0.0.0 \
    POND_PORT=3000 \
    POND_DATA_DIR=/data

COPY package.json ./
COPY pond.config.js ./
COPY server.js ./
COPY lib ./lib
COPY public ./public

RUN mkdir -p /data && chown -R node:node /data /app

USER node

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.POND_PORT||3000)+'/api/bootstrap').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
