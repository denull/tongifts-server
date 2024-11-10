### TonGiftAppBot

Конкурсная работа для https://t.me/CryptoBotRU/365. Серверная часть.

Собранное клиентское приложение должно находиться в папке `public`.

В корне репозитория должен находиться файл `.env` со следующим содержанием:

```
TELEGRAM_USERNAME="юзернейм бота (без @ в начале)"
TELEGRAM_TOKEN="токен бота"
CRYPTOPAY_TOKEN="токен Crypto Pay"
CRYPTOPAY_URL="https://pay.crypt.bot" # или "https://testnet-pay.crypt.bot" для тестового эндпоинта
MONGO_HOST="адрес MongoDB"
MONGO_DB="название базы MongoDB"
SERVER_PORT=номер порта, на котором будет запущен сервер
SERVER_URL="внешний URL, по которому будет доступно мини-приложение"
SERVER_SECRET="секретный ключ Crypto Pay"
WEBSOCKET_PORT=номер порта, на котором будет запущен WebSocket-сервер
```

При настройке reverse-proxy запросы, приходящие на `SERVER_URL`, должны направляться на порт `SERVER_PORT`, а запросы к `SERVER_URL/ws` — на `WEBSOCKET_PORT`.

В настройках Crypto Pay следует установить webhook, указывающий на `SERVER_URL/cryptopay`. Для получения апдейтов Telegram API webhook будет автоматически установлен в `SERVER_URL/webhook`. Адрес мини-приложения это напосредственно `SERVER_URL`; запросы приложения делаются на `SERVER_URL/api`, статические файлы находятся в `SERVER_URL/assets`, эндпоинт для WebSocket — `SERVER_URL/ws`. Фотографии пользователей хранятся в БД и возвращаются по запросу `SERVER_URL/user/:id/photo.jpg`.

Команды:
- `npm install`: установка зависимостей
- `npm run createdb`: создание коллекций/индексов MongoDB (без наполнения данными)
- `npm run populatedb`: создание коллекций/индексов MongoDB и заполнение их случайными данными
- `npm run serve`: запуск сервера

