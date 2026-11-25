# ClearPDF

ClearPDF is a Next.js application for working with PDF and office documents. The project uses Next.js standalone output and includes a Docker Compose setup for self-hosted deployment.

## Run with Docker Compose

1. Copy `.env.example` to `.env` and add Adobe PDF Services credentials if you use Adobe OCR.
2. Build and start the app and its private Gotenberg conversion service:

   ```sh
   docker compose up --build -d
   ```

3. Open `http://localhost:3000`. Follow logs with `docker compose logs -f clearpdf`.

The Docker image uses Next.js standalone output. Local build caches, dependencies, and the Windows-only `aspose-env` are excluded from the Docker build context. OCR worker hosting and Python-based conversion tools need their own production runtime configuration.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm dev
```

To create a production build locally, run `pnpm build`.
