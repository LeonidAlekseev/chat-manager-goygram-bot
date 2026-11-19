FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY bot ./bot
# nobody has no home and /app is root-owned: goygram writes ~/.goygram and ./default.vault, so both go to the tmpfs
ENV HOME=/tmp PYTHONPATH=/app
# long-polling offset, on the bot-offsets volume: an empty named volume takes this dir's owner (nobody)
RUN mkdir /offsets && chown nobody /offsets
ENV OFFSET_DIR=/offsets
WORKDIR /tmp
USER nobody
CMD ["/app/.venv/bin/python", "-m", "bot.main"]
