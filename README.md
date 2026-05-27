# Pronocave

Family prediction site for World Cups and Euros, migrated to Node.js and SQLite.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

On a fresh database the app seeds:

- the `FIFA World Cup 2026` tournament
- 48 teams
- all 104 matches
- the full knockout bracket dependencies
- an initial admin account named `Eric`

Set `ADMIN_PASSWORD` before the first startup so the initial admin can be created. In production, keep it in `/etc/pronocave/pronocave.env`, not in Git.

Live score sync runs inside the Node process every minute. It uses TheSportsDB v1 by default with the public free key, or `THESPORTSDB_API_KEY` when set. Set `SCORE_SYNC_ENABLED=0` to disable it, or `SCORE_SYNC_INTERVAL_MS` to change the interval.

## Data

The generated seed lives in `data/worldcup-2026.json`. It was built from the 2026 schedule page with `npm run seed:worldcup`; the seed records the source URL and official FIFA reference URL.

Runtime SQLite files are created in `data/pronocave.sqlite`.
