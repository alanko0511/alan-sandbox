# Build context is the repo root, not app/, because the image needs templates/
# and scripts/ alongside the server: the template dropdown reads template.yaml
# files, and every VM's startup-script is read from scripts/bootstrap.sh.
FROM node:24-slim AS builder
WORKDIR /build

RUN npm install -g pnpm@11

COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY app/ ./
RUN pnpm build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /build/.output ./.output
COPY templates/ ./templates/
COPY scripts/ ./scripts/

ENV SANDBOX_TEMPLATES_DIR=/app/templates
ENV SANDBOX_SCRIPTS_DIR=/app/scripts

# Cloud Run supplies PORT; nitro's node server honours it.
EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
