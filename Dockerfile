# Runtime image — expect pre-built ./dist (low-RAM servers: build on CI/local)
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY package.json package-lock.json ./
COPY vendor/nextword-local-dictionary ./vendor/nextword-local-dictionary
RUN npm ci --omit=dev && npm cache clean --force

COPY dist ./dist
RUN mkdir -p /app/data/magazines

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.mjs"]
