# Railway deploy

## Server

1. Create a Railway project from this GitHub repo.
2. Add a PostgreSQL service in the same Railway project.
3. Deploy the app service. Railway will use `railway.json` and `apps/server/Dockerfile.railway`.
4. In the `server` service variables set these values. Do not put them only on the PostgreSQL service:

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<long-random-string>
AUTH_FILE_SECRET=<long-random-string>
BCRYPT_ROUNDS=10
CLIENT_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,file://,null
```

Use the exact name of your Railway PostgreSQL service in the variable reference. If it is named `PostgreSQL`, use `DATABASE_URL=${{PostgreSQL.DATABASE_URL}}`.

If you use the public proxy values manually, set these variables on the `server` service:

```env
PGHOST=hayabusa.proxy.rlwy.net
PGPORT=44929
PGUSER=<value from PostgreSQL variables>
PGPASSWORD=<value from PostgreSQL variables>
PGDATABASE=railway
```

The server health check is:

```text
https://your-app.up.railway.app/health
```

It should return:

```json
{"status":"ok"}
```

## Client

The desktop client can be built before you know the Railway URL.

After Railway gives you the server domain, open the client login screen and paste the Railway URL into `Server URL`, for example:

```text
https://your-app.up.railway.app
```

Press `Test`. If it says `Connected`, login/register normally. The URL is saved locally and is used by API requests, Socket.IO, GIF proxy, and emoji.gg proxy.

You can also hardcode a default server URL at build time:

```powershell
$env:VITE_API_URL="https://your-app.up.railway.app"
npm.cmd --workspace @notoc/client run build
```

For the Electron portable build:

```powershell
$env:VITE_API_URL="https://your-app.up.railway.app"
npm.cmd --workspace @notoc/client run dist:win
```
