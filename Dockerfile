# JARVIS-X — production image (no npm dependencies to install)
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN rm -rf data .env && mkdir -p /app/data && chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
