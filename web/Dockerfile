FROM node:22-alpine
RUN npm i -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
ENV NODE_ENV=production
EXPOSE 3000
# Panel owns the schema: apply migrations before serving.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start"]
