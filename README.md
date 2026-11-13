# Chat Manager (GoyGram)

Telegram-бот для рабочих чатов и веб-панель управления. Спека — issue #1.

| Каталог | Что это |
|---|---|
| `bot/` | Бот на [GoyGram](https://github.com/GoyGram/GoyGram) (Python 3.13, uv). Пишет в общую Postgres через SQL. |
| `web/` | Панель на [shadboard starter-kit](https://github.com/Qualiora/shadboard) (Next.js 15, MIT, см. `web/LICENSE-shadboard`). Владеет схемой БД (Prisma). |

## Запуск

```sh
cp .env.example .env   # заполнить секреты
docker compose up -d --build
```

`web` при старте применяет Prisma-миграции и создаёт/обновляет суперадмина из `SUPERADMIN_LOGIN`/`SUPERADMIN_PASSWORD` (в БД хранится только bcrypt-хэш). `bot` стартует после того, как `web` здоров (таблицы уже есть). Панель слушает `WEB_PORT`; HTTPS и reverse-proxy — на стороне владельца.

## Бот

- `/start` — список команд, `/myid` — свой ID, пересланное в личку сообщение — ID отправителя (лички).
- `/chatid` — ID группы.
- Бота добавили в группу → чат появляется в панели («Чаты»); удалили → помечается неактивным. Переименование в панели не перетирается при повторном добавлении.
- Ответы на опросы и снимки участников чата хранятся год: бот удаляет записи старше 365 дней при старте и затем раз в 30 дней.

## Разработка и тесты

Нужен Postgres (например `docker run -p 5432:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine`).

```sh
# бот: схема накатывается из web/prisma/migrations в чистую public-схему
cd bot && uv sync && TEST_DATABASE_URL=postgresql://postgres:test@localhost:5432/test uv run pytest
uv run ruff check . && uv run mypy bot

# панель: prisma migrate deploy в тестовую БД
cd web && pnpm install && TEST_DATABASE_URL=postgresql://postgres:test@localhost:5432/web_test pnpm test
pnpm lint && pnpm typecheck
# smoke-тест в браузере (вход → шаблон → расписание → привязка чата); пишет в указанную БД
pnpm build && pnpm exec playwright install chromium && DATABASE_URL=postgresql://postgres:test@localhost:5432/web_test pnpm e2e
```

Изменение схемы: `cd web && pnpm exec prisma migrate dev --name <что>` — бот подхватит таблицы через SQL.

## GoyGram: что нужно знать (проверено по исходникам goygram 0.8.29)

Проверено чтением кода пакета, не живым запуском с реальным токеном.

**Апдейты Bot API.** `GoyGram(bot_token=...)` без `api_id` работает только через Bot API (long polling, `allowed_updates: []` = набор Telegram по умолчанию: есть `my_chat_member` и `poll_answer`, нет `chat_member`). Если передать и `bot_token`, и `api_id`, бот логинится ещё и в MTProto и апдейты идут только оттуда — для нашего бота так не делаем.

- **`my_chat_member`** → `@app.on_member`; `evt.update_type == "my_chat_member"`, `evt.old`/`evt.new` — статусы, полный апдейт в `evt.raw["raw"]`.
- **`poll_answer`** — у GoyGram нет отдельного разбора: приходит как `kind="update"`, ловится `@app.on_update` с проверкой `evt.update_type == "poll_answer"` (или `filt=goygram.filters.poll_answer`). Данные: `evt.raw["raw"]["poll_answer"]` → `poll_id`, `user`, `option_ids` (пустой список = голос отозван). `on_update` вызывается для **всех** апдейтов, фильтр обязателен. Приходит только для неанонимных опросов.
- `@app.on_poll` — это апдейты состояния опроса (счётчики, закрытие), не ответы.
- Отправка опроса: `await app.send_poll(chat_id, question, options, anonymous=False, allows_multiple_answers=True)` → Bot API `sendPoll`; в ответе `message_id` и `poll.id` (сохранять в журнал отправок для связи с `poll_answer`).

**Список участников чата (для `/all`, mention_all).** Bot API участников не отдаёт (`iter_members` через бота возвращает только количество). Нужен MTProto **пользовательского** аккаунта — отдельный экземпляр без токена:

```python
user = GoyGram(api_id=API_ID, api_hash=API_HASH, session_name="members")
async for p in user.iter_participants(chat_id):  # channels.getParticipants, пачки по 200
    ...
```

- Работает только для супергрупп (`inputPeerChannel`); для обычной группы `iter_participants` кидает `ValueError` — нужен `messages.getFullChat` через `user.mt_req(...)`. Аккаунт должен состоять в чате.
- Встроенный вход `run()` интерактивный (stdin) и хранит сессию только в vault-файле. Поэтому бот входит по шагам сам (`bot/bot/account.py`: `auth.sendCode` → `auth.signIn` → `auth.checkPassword` через приватные хелперы `goygram.security`), хранит payload vault в БД и перед запуском клиента пишет его во временный `members.vault`.
- Упоминания — скрытые ссылки `<a href="tg://user?id=UID">&#8205;</a>` как в старом боте.

## Сессия для `/all` и mention_all

Список участников Bot API не отдаёт, поэтому нужен отдельный **пользовательский** аккаунт (MTProto), состоящий в нужных чатах. Работает только для супергрупп.

1. Получите API ID и API HASH на https://my.telegram.org и сохраните их в панели (Настройки).
2. Там же, в «Аккаунт Telegram», введите телефон, затем код из Telegram и пароль 2FA, если он включён. Бот выполняет шаги и запускает клиент без перезапуска. Сессия хранится в БД зашифрованной (`AUTH_SECRET`), код и пароль стираются сразу после использования.
3. «Выйти» стирает сессию и останавливает клиент. Сессия остаётся в списке устройств Telegram, пока её не завершат в приложении.

Без входа `/all` отвечает в чате, что аккаунт не настроен.
