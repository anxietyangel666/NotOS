# Railway deploy

## Server

1. Create a Railway project.
2. Add a PostgreSQL service in the same Railway project.
3. Run deploy commands from this folder:

```powershell
cd "C:\My Projects\NotOC\apps\server"
railway link
railway up --service server
```

Railway will use `apps/server/railway.json` and `apps/server/Dockerfile`.
4. In the `server` service variables set these values. Do not put them only on the PostgreSQL service:

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=<long-random-string>
AUTH_FILE_SECRET=<long-random-string>
BCRYPT_ROUNDS=10
CLIENT_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,file://,null
PUBLIC_API_URL=https://server-production-23e35.up.railway.app
SPOTIFY_CLIENT_ID=<spotify-client-id>
SPOTIFY_CLIENT_SECRET=<spotify-client-secret>
SPOTIFY_REDIRECT_URI=https://server-production-23e35.up.railway.app/api/connections/spotify/callback
RIOT_API_KEY=<riot-api-key>
```

Use the exact Postgres service name shown in Railway. If your database service is named `PostgreSQL`, use:

```env
DATABASE_URL=${{PostgreSQL.DATABASE_URL}}
```

Without `DATABASE_URL`, the server cannot start on Railway because there is no local Postgres on `localhost:5432`.

For Spotify, the value of `SPOTIFY_REDIRECT_URI` must also be added to the Spotify Developer Dashboard for the app.
For Riot/League of Legends activity, `RIOT_API_KEY` must be a valid Riot developer or production key.

If Railway shows you only proxy fields, you can set these on the `server` service instead:

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
