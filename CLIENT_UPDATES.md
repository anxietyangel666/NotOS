# Как выпускать обновления клиента NotOS

NotOS проверяет обновления через сервер:

```text
GET https://server-production-23e35.up.railway.app/api/client/update
```

Сервер отдает текущую опубликованную версию клиента и ссылку на скачивание. Если версия на сервере новее, чем версия установленного Electron-клиента, пользователь увидит окно обновления и сможет скачать новый клиент.

## 1. Подготовить новую версию

1. Открой `apps/client/package.json`.
2. Увеличь поле `version`, например:

```json
"version": "0.1.2"
```

3. Сохрани файл.

Важно: версия в `package.json` должна совпадать с версией, которую потом укажешь в `CLIENT_UPDATE_VERSION`.

## 2. Собрать клиент

В корне проекта выполни:

```powershell
npm.cmd --workspace @notoc/client run dist:win
```

После сборки файл появится примерно здесь:

```text
apps/client/release/NotOS-0.1.2-x64.exe
```

Если версия другая, имя файла тоже будет другим.

## 3. Загрузить файл через GitHub Releases

1. Открой репозиторий проекта на GitHub.
2. Перейди в `Releases`.
3. Нажми `Draft a new release`.
4. В поле `Tag version` укажи версию, например:

```text
v0.1.2
```

5. В `Release title` напиши, например:

```text
NotOS 0.1.2
```

6. В описание добавь короткий список изменений.
7. В блок `Attach binaries by dropping them here or selecting them` загрузи файл:

```text
apps/client/release/NotOS-0.1.2-x64.exe
```

8. Нажми `Publish release`.
9. После публикации открой загруженный `.exe` в релизе и скопируй ссылку на скачивание.

Обычно ссылка будет выглядеть так:

```text
https://github.com/<owner>/<repo>/releases/download/v0.1.2/NotOS-0.1.2-x64.exe
```

## 4. Указать обновление на Railway

Открой серверный сервис NotOS на Railway и добавь или измени env-переменные:

```text
CLIENT_UPDATE_VERSION=0.2.0
CLIENT_UPDATE_URL=https://github.com/Notqqqqq/NotOS_0.2.0_Version/releases/download/NotOS/NotOS-0.2.0-x64.exe
CLIENT_UPDATE_NOTES=None.
CLIENT_UPDATE_REQUIRED=false
CLIENT_UPDATE_PUBLISHED_AT=2026-07-05
```

После изменения переменных сделай redeploy/restart сервера.

## 5. Проверить, что сервер отдает обновление

Открой в браузере:

```text
https://server-production-23e35.up.railway.app/api/client/update
```

Должен быть ответ примерно такого вида:

```json
{
  "version": "0.1.2",
  "url": "https://github.com/<owner>/<repo>/releases/download/v0.1.2/NotOS-0.1.2-x64.exe",
  "notes": "Короткое описание обновления, которое увидит пользователь.",
  "required": false,
  "publishedAt": "2026-07-04"
}
```

## 6. Как это увидит пользователь

1. При запуске NotOS проверит соединение с сервером.
2. Затем NotOS проверит наличие обновления.
3. Если версия на сервере новее установленной, в окне `Update` будет написано, что обновление доступно.
4. При нажатии `Обновить клиент` откроется ссылка на скачивание `.exe`.
5. Пользователь скачивает новый клиент и запускает installer/portable-файл.

## Важные правила

- Каждый релиз должен иметь новую версию в `apps/client/package.json`.
- `CLIENT_UPDATE_VERSION` на Railway должен совпадать с версией собранного клиента.
- Не удаляй старый GitHub Release сразу, пока пользователи еще могут обновляться со старых версий.
- Сейчас обновление не устанавливается тихо внутри приложения: NotOS открывает ссылку на новый `.exe`, а пользователь запускает его сам.
