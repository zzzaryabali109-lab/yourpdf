FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV HOME=/home/nextjs
ENV NEXT_TELEMETRY_DISABLED=1
ENV PYTHON_BIN=/opt/clearpdf-python/bin/python
ENV PATH="/opt/clearpdf-python/bin:${PATH}"
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer-nogui \
    libreoffice-calc-nogui \
    libreoffice-impress-nogui \
    libreoffice-draw-nogui \
    fonts-liberation \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    python3-venv \
    python3-openpyxl \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv --system-site-packages /opt/clearpdf-python \
  && /opt/clearpdf-python/bin/python -m pip install --no-cache-dir "pypdf[crypto]==7.1.1" "pypdfium2==5.15.2" "pikepdf==10.18.2" \
  && /opt/clearpdf-python/bin/python -c "import pypdfium2; import pypdfium2.raw; from pypdfium2._helpers.misc import PdfiumError" \
  && /opt/clearpdf-python/bin/python -c "import pikepdf; from pikepdf import PdfImage; from PIL import Image; print('PDF image compressor ready')" \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/nextjs nextjs \
  && soffice --headless --version
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/scripts/pdf_compress_engine.py ./scripts/pdf_compress_engine.py
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
