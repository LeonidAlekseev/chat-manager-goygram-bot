FROM node:22.23-alpine
RUN npm i -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN chown -R node:node /app/.next
ENV NODE_ENV=production
USER node
EXPOSE 3000
# Panel owns the schema: apply migrations before serving.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start"]
