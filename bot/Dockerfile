FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY bot ./bot
CMD ["uv", "run", "--no-dev", "python", "-m", "bot.main"]
