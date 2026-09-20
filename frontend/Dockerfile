# syntax=docker/dockerfile:1
# ---- BullSight web (Next.js) ----
# Multi-stage: install deps, build, then a lean runtime that runs `next start`.
# We use `next start` (not output:standalone) because the /receipt route reads font + image
# assets from disk via process.cwd() (src/receipt-assets, public/); next start keeps cwd=/app
# so those paths resolve without fragile manual copying.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# BACKEND_URL is only needed at runtime (server-side proxy + /receipt); the build doesn't call it.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Only what `next start` needs at runtime.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
# Font + background assets read at runtime by the receipt route (fs.readFileSync).
COPY --from=build /app/src/receipt-assets ./src/receipt-assets

# Drop privileges (node image ships a `node` user).
USER node

EXPOSE 3000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "3000"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
