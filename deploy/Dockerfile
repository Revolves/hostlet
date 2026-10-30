FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY admin ./admin
COPY shared ./shared
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/var/lib/hostlet
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
RUN mkdir -p /var/lib/hostlet && chown node:node /var/lib/hostlet
USER node
EXPOSE 3000 8080
CMD ["node", "server/index.js"]
