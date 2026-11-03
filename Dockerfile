# Stage 1: build the React client to static files
FROM oven/bun:1.3 AS client
WORKDIR /client
COPY client/package.json client/bun.lock ./
RUN bun install --frozen-lockfile
COPY client/ .
RUN bun run build

# Stage 2: FastAPI serves the API, the redirects, and the built client
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY server/main.py .
COPY --from=client /client/dist ./static

ENV PATH="/app/.venv/bin:$PATH" STATIC_DIR=/app/static DB_PATH=/data/links.db
RUN useradd --system app && mkdir /data && chown app /data
USER app
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
