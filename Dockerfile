FROM node:22-bookworm-slim

RUN npm install -g pnpm@10.14.0

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY shared ./shared
COPY server ./server

ENV NODE_ENV=production \
    PORT=2567

EXPOSE 2567

CMD ["pnpm", "run", "server"]
