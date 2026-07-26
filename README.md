# NotOS

Desktop-приложение на React + Electron с API на Node.js, realtime-слоем Socket.IO и PostgreSQL.

## Запуск

1. Поднять API и PostgreSQL:

```bash
docker compose up --build
```

2. В другом терминале запустить desktop-клиент:

```bash
npm run desktop
```

Сервисы:

- Electron/React renderer: `http://127.0.0.1:5173` в dev-режиме
- API: `http://localhost:4000`
- PostgreSQL: `localhost:5432`

## Авторизация

- При регистрации пользователь выбирает никнейм и аватар.
- Сервер генерирует recovery-ключ на 32 символа и секрет auth-файла.
- Auth-файл шифруется через AES-256-GCM и сохраняется через Electron dialog, по умолчанию в `Downloads`.
- В PostgreSQL сохраняются профиль, настройки, hash секрета auth-файла и hash recovery-ключа.
- При входе Electron открывает native file picker, сервер расшифровывает auth-файл и проверяет секрет.
- При восстановлении вводятся никнейм и recovery-ключ, после чего выпускается новый auth-файл, а старый отзывается.

## Что уже есть

- Регистрация, вход по encrypted auth-файлу и восстановление доступа.
- Кастомное frameless Electron-окно без стандартной рамки.
- Минималистичный desktop-интерфейс.
- Рабочий стол с taskbar, аватаром/никнеймом, часами и датой.
- Правый клик по рабочему столу открывает настройки обоев.
- Базовый Socket.IO слой для будущего мессенджера.
