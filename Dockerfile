FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev && .venv/bin/playwright install --with-deps chromium && chmod -R a+rX /ms-playwright
RUN groupadd --gid 10001 agent && useradd --uid 10001 --gid 10001 --create-home agent
COPY jobhunt ./jobhunt
COPY config ./config
RUN mkdir -p /app/data && chown -R agent:agent /app/data /app/config
USER agent
EXPOSE 8000
CMD [".venv/bin/uvicorn", "jobhunt.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
