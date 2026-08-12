FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install -e .

COPY . .

# --- dev: dipendenze di sviluppo e test ---
FROM base AS dev
RUN pip install -e ".[dev]"

# --- prod ---
FROM base AS prod
RUN python -c "import compileall; compileall.compile_dir('/app', quiet=1)" || true
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]
