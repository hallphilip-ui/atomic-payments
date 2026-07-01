FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY public ./public
COPY admin-compliance.html checkout.html defi-swap.html project-plan.html ./

RUN npx prisma generate \
  && npm run build

ENV NODE_ENV=production
ENV PORT=3005
ENV DATABASE_URL=file:/data/atomic.db
ENV ATOMIC_SWAP_PROVIDER_MODE=simulation

EXPOSE 3005

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/index.js"]
