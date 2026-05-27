# AGENTS.md

Notes for future maintainers/agents working on this repo.

## Project Shape

Pronocave is a family tournament prediction site migrated from the old PHP app to Node.js, Express, EJS, and SQLite.

Runtime entrypoint:

- `server.js` wires Express routes, session auth, tournament context, and view rendering.
- `src/db.js` owns SQLite schema creation, seed sync, persistence, admin mutations, and point recalculation.
- `src/knockout.js` owns user-specific finals/bracket inference. This is the most fragile part.
- `src/scoring.js` owns scoring rules.
- `src/matchStats.js` prepares the `/matches` display data.
- `public/autosave.js` powers score select autosave.
- `views/*.ejs` are server-rendered pages.
- `data/worldcup-2026.json` is the current tournament seed.
- The old PHP files remain in the root as behavioral reference only. The Node app does not include them, except for a couple of legacy redirects.

Use Node with `node:sqlite` support. This project is known to run on Node `v24.15.0`.

## Commands

```bash
npm install
npm start
npm test
```

`npm test` currently runs syntax checks plus `node --test`. Add new pure logic tests under `test/` when touching bracket inference or scoring.

The dev server defaults to `http://localhost:3000`. If `server.js` changes, restart the process. EJS/CSS changes are usually picked up without a server restart in development, but restarting is harmless.

## GCP Deployment Runbook

Known VM:

```bash
gcloud compute ssh --zone "europe-west9-b" "pronocave" --project "pronocave-497513"
```

Production domain:

- `pronocave.site`
- `www.pronocave.site` redirects permanently to `https://pronocave.site`

The app should run as a systemd service on localhost port `3000`, behind Caddy on ports `80` and `443`. Caddy handles Let's Encrypt certificates and HTTP-to-HTTPS redirects automatically.

Prerequisites:

- The deploying gcloud account must have permission to SSH into the VM. At minimum it must be able to read the instance (`compute.instances.get`) and use SSH/OS Login according to the project's IAM setup.
- The VM must allow inbound TCP `80` and `443` from the internet.
- The DNS A/AAAA record for the production domain must point to the VM external IP before Caddy can issue a certificate.
- Keep a stable production `SESSION_SECRET`.
- Keep a stable `ADMIN_PASSWORD`; when present, `seedAdmin()` resets Eric's password hash on app startup. A fresh DB cannot create Eric without it.

Suggested VM layout:

```text
/opt/pronocave/current -> /opt/pronocave/releases/<release-id>
/opt/pronocave/releases/<release-id>
/var/lib/pronocave/pronocave.sqlite
/var/lib/pronocave/uploads
/etc/pronocave/pronocave.env
```

Use `DATABASE_URL=/var/lib/pronocave/pronocave.sqlite` in production so the SQLite DB survives release directory changes. Also symlink `public/uploads` to `/var/lib/pronocave/uploads` so uploaded message images survive redeploys.

One-time VM setup, assuming Debian/Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg tar

curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo install -d -m 0755 /usr/share/keyrings
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
echo 'deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy

sudo useradd --system --home /opt/pronocave --shell /usr/sbin/nologin pronocave || true
sudo mkdir -p /opt/pronocave/releases /var/lib/pronocave/uploads /etc/pronocave
sudo chown -R pronocave:pronocave /opt/pronocave /var/lib/pronocave
```

GCP firewall setup:

```bash
gcloud compute instances add-tags pronocave \
  --zone "europe-west9-b" \
  --project "pronocave-497513" \
  "--tags=http-server,https-server"

gcloud compute firewall-rules create allow-http \
  --project "pronocave-497513" \
  --network default \
  --allow tcp:80 \
  --source-ranges 0.0.0.0/0 \
  --target-tags http-server

gcloud compute firewall-rules create allow-https \
  --project "pronocave-497513" \
  --network default \
  --allow tcp:443 \
  --source-ranges 0.0.0.0/0 \
  --target-tags https-server
```

In PowerShell, quote the `--tags=...` argument as shown. Without quotes, the comma can be mangled before gcloud receives it.

Production environment file:

```bash
sudo tee /etc/pronocave/pronocave.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=3000
DATABASE_URL=/var/lib/pronocave/pronocave.sqlite
SESSION_SECRET=<long-random-secret>
ADMIN_PASSWORD=<stable-admin-password>
EOF
sudo chmod 600 /etc/pronocave/pronocave.env
```

To change Eric's production admin password, edit only the VM env file and restart the service:

```bash
gcloud compute ssh --zone "europe-west9-b" "pronocave" --project "pronocave-497513"
sudoedit /etc/pronocave/pronocave.env
sudo systemctl restart pronocave
```

Set `ADMIN_PASSWORD` to the new password. Do not paste the real password into chat, commit it to Git, or put it in `AGENTS.md`. Because `seedAdmin()` currently reapplies `ADMIN_PASSWORD` on every app startup, the restart updates Eric's password hash in SQLite. Existing sessions are memory-backed and will be cleared by the restart.

For non-interactive rotation from a local shell, prompt for the value and send it over SSH without storing it locally:

```bash
read -s -p "New Eric admin password: " ADMIN_PASSWORD; echo
gcloud compute ssh --zone "europe-west9-b" "pronocave" --project "pronocave-497513" \
  --command "sudo sed -i \"s/^ADMIN_PASSWORD=.*/ADMIN_PASSWORD=${ADMIN_PASSWORD//\//\\/}/\" /etc/pronocave/pronocave.env && sudo systemctl restart pronocave"
unset ADMIN_PASSWORD
```

Prefer `sudoedit` if the password contains shell-special characters; the one-liner above is convenient but easier to trip with quoting.

Systemd unit:

```bash
sudo tee /etc/systemd/system/pronocave.service >/dev/null <<'EOF'
[Unit]
Description=Pronocave
After=network.target

[Service]
Type=simple
User=pronocave
Group=pronocave
WorkingDirectory=/opt/pronocave/current
EnvironmentFile=/etc/pronocave/pronocave.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable pronocave
```

Caddyfile:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
www.pronocave.site {
  redir https://pronocave.site{uri} permanent
}

pronocave.site {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Local release packaging from the project root:

```bash
tar \
  --exclude=node_modules \
  --exclude=data/pronocave.sqlite \
  --exclude=data/pronocave.sqlite-shm \
  --exclude=data/pronocave.sqlite-wal \
  -czf pronocave-release.tgz \
  server.js package.json package-lock.json src views public test scripts data/worldcup-2026.json AGENTS.md README.md
```

Copy the archive to the VM:

```bash
gcloud compute scp --zone "europe-west9-b" --project "pronocave-497513" \
  pronocave-release.tgz pronocave:/tmp/pronocave-release.tgz
```

Install the release on the VM:

```bash
gcloud compute scp --zone "europe-west9-b" --project "pronocave-497513" \
  scripts/deploy-gcp-remote.sh pronocave:/tmp/deploy-gcp-remote.sh

gcloud compute ssh --zone "europe-west9-b" "pronocave" --project "pronocave-497513" \
  --command "bash /tmp/deploy-gcp-remote.sh /tmp/pronocave-release.tgz"
```

Verify after deployment:

```bash
curl -I http://127.0.0.1:3000/login
curl -I http://pronocave.site/login
curl -I https://pronocave.site/login
curl -I https://www.pronocave.site/login
sudo journalctl -u pronocave -n 100 --no-pager
sudo journalctl -u caddy -n 100 --no-pager
```

Rollback:

```bash
ls -1 /opt/pronocave/releases
sudo ln -sfn /opt/pronocave/releases/<previous-release-id> /opt/pronocave/current
sudo systemctl restart pronocave
```

Never overwrite `/var/lib/pronocave/pronocave.sqlite` during a redeploy unless intentionally restoring from backup.

## Encoding And Text

The UI is French. Preserve UTF-8 accents in source files. PowerShell may display accents as mojibake with `Get-Content`, so verify actual corruption with `rg -n "Ã|Â" views public src server.js` before "fixing" text.

Team names shown to users should be French. The seed scripts and seed JSON carry translated labels.

## Auth And Sessions

Auth is session-based through `express-session`.

- `req.session.userId` is the login marker.
- `requireAuth` protects normal pages.
- `requireAdmin` checks `currentUser.role === "admin"`.
- Signup auto-signs the user in by setting `req.session.userId` after `store.createUser`.
- Passwords are PBKDF2 hashes in `src/passwords.js`.

Admin seeding is in `seedAdmin()` in `src/db.js`.

- The admin login is `Eric`.
- `ADMIN_PASSWORD` is required when creating Eric on a fresh database.
- If Eric already exists and `ADMIN_PASSWORD` is set, `seedAdmin()` updates Eric's password hash on startup. If `ADMIN_PASSWORD` is missing, it preserves the existing hash and only ensures Eric has the admin role.

Session storage is the default in-memory store. That is fine for local/dev, but not for durable production hosting.

## Tournament Context And URLs

Tournament slug is part of most URLs, e.g. `/world-cup-2026/matches`.

`attachContext()` in `server.js` resolves the tournament from:

1. the first URL segment if it matches a tournament slug;
2. `req.session.tournamentSlug`;
3. the active tournament;
4. the latest tournament fallback.

Useful locals set there:

- `tournament`
- `base`, e.g. `/world-cup-2026`
- `sectionPath`, the path with the slug stripped
- `pronosPath`, which points to group or finals bets depending on tournament phase
- `phaseLabel()`

The header tournament selector changes URL by combining the selected slug with `sectionPath`.

## Phases And Visibility

Tournament phase is a small integer:

- `0`: group pronos open; finals pronos are also editable where teams can be inferred/known.
- `1`: finals pronos open; group pronos are locked.
- `2`: everything locked.

Current rules in `server.js`:

- Own group bets are editable only when `phase === 0`.
- Own finals bets are editable when `phase <= 1`.
- Other players' group bets are visible when `phase > 0`.
- Other players' finals bets are visible when `phase > 1`.
- Leaderboard player links point to groups in phase 1, finals in phase 2, and no page in phase 0.

Do not use the phrase "lecture seule" in the UI; use "Verrouillé" with proper accents in source.

## Database

SQLite path:

- default: `data/pronocave.sqlite`
- override: `DATABASE_URL` (despite the name, it is used as a file path)

`src/db.js` creates tables on startup and uses a minimal `addColumnIfMissing()` helper for ad hoc schema evolution. There is no migration framework.

Main tables:

- `users`: auth and role.
- `tournaments`: slug, active flag, phase, deadlines.
- `teams`: tournament-scoped teams.
- `matches`: both group and finals matches, including bracket source dependencies.
- `bets`: one bet per user/match, stores scores plus the teams the user predicted for that match.
- `messages` and `message_likes`: dashboard feed and unique likes.

Important constraints/invariants:

- `bets` has `UNIQUE(match_id, user_id)`.
- `message_likes` has `PRIMARY KEY (message_id, user_id)` so a user cannot like a post twice.
- For finals bets, `bets.team_a_id` and `bets.team_b_id` are the teams the user predicted for that slot, not necessarily the real/admin teams.
- Do not delete user bets just because the admin later sets/changes finals teams. Existing bets must remain visible so wrong predicted teams can be shown in red and scored partially.
- `assignMatchTeam()` recalculates affected points but intentionally preserves bets.
- Match status is one of `scheduled`, `live`, or `final`.
- `live` scores are provisional: they recompute points and leaderboard totals, but they must not advance real/admin teams through the bracket.
- `final` scores are authoritative: they recompute points and may resolve downstream bracket teams.
- `clearResult()` must clear downstream match teams/results and recalculate downstream points to avoid stale leaderboard scores.
- `saveResult()` also has to clear downstream teams/results when a previously final knockout result changes winner, loser, or is downgraded back to `live`/`scheduled`.

## Seed Data And Future Tournaments

The current seed is `data/worldcup-2026.json`, built by `scripts/build-worldcup-seed.mjs` and translated by `scripts/translate-worldcup-seed.mjs`.

On startup:

- `seedWorldCup2026()` inserts the seed if missing.
- If the tournament already exists, `syncSeededTournament()` updates tournament metadata, team names/groups, and match labels/source text. It does not rewrite all match dependencies or scores.

For a future tournament (Euro, next World Cup, etc.):

1. Add a new seed JSON with a new slug.
2. Add or generalize seed loading in `src/db.js`; it currently knows specifically about `worldcup-2026.json`.
3. Encode bracket dependencies in `matches.source_a_match_no`, `source_b_match_no`, `source_a_outcome`, and `source_b_outcome`.
4. Revisit `ROUND_LABELS`, round keys, and scoring rules if the tournament format differs.
5. Add tests for the new bracket shape before trusting the UI.

The source code is expected to evolve per tournament because bracket rules can differ. Keep tournament-specific format code isolated when possible.

## Bracket / Finals Logic

`src/knockout.js` is the key module.

Core idea:

- The first finals round (`round32` for 2026) uses admin/seeded `match.team_a_id` and `match.team_b_id`.
- Later rounds infer teams from the current user's saved bets in source matches.
- If a source bet is tied (`winner_side === "even"`), `winner_team_id` is required to know who advances.
- If a tied source has no winner selection, downstream cards show `needsChoice`.
- `teamAMismatch` and `teamBMismatch` compare inferred user teams against actual/admin teams when known. The UI uses these flags to show wrong predicted teams in red.

The subtle bit: downstream saved bets can contain stale teams after an earlier source bet changes. `syncKnockoutBetsToCurrentTeams()` in `server.js` calls `betSyncPatches()` after finals saves and winner-pick saves to rewrite downstream bet teams to the current inferred teams while preserving the user's scores.

Regression tests in `test/knockout.test.js` cover:

- downstream inference after changing earlier winners;
- tied source bets blocking downstream until a winner is selected;
- tie winner selection moving with its original side when teams change.

Be very careful before changing any of this. Add tests first.

## Scoring Rules

Scoring lives in `src/scoring.js`.

Groups:

- exact score: 3 points;
- correct outcome only: 2 points;
- otherwise 0.

Finals:

- `round32`: 3 for correct winner, +2 for exact score when teams match.
- later rounds except final: 3 for correct winner, +2 if both teams match, +2 if score also matches.
- final: 7 for champion, +5 for exact finalists, +5 for exact score.
- tie scores in finals use `winner_team_id` to determine the qualified team.
- There is a compatibility case for real tied finals bets: if both actual and bet are ties with same teams but wrong qualified team, score is 2 plus 2 for exact tied score.

`updatePointsForMatch()` recalculates stored bet points for one match. Admin result/team changes must call it for affected matches.

Only `live` and `final` matches produce points. `scheduled` matches leave `bets.points` as `NULL`. This lets admins update live scores in real time and see the leaderboard move without making the bracket consume provisional winners.

## Automatic Score Sync

`src/scoreSync.js` runs a background sync from TheSportsDB when `server.js` starts.

Environment:

- `SCORE_SYNC_ENABLED=0` disables the job.
- `SCORE_SYNC_INTERVAL_MS` overrides the default 60 second interval.
- `THESPORTSDB_API_KEY` overrides the public free v1 key (`123`).

The job only checks candidate matches from `store.scoreSyncCandidates()`:

- scheduled matches starting soon or recently started;
- currently live matches;
- recently final matches, so provider corrections can still flow through.

It queries one candidate match at a time with TheSportsDB v1 `searchevents.php` or `lookupevent.php` once an external ID is known. Keep this conservative because the free API is rate-limited.

All provider updates must go through `store.saveResult()`. This is deliberate: points, live leaderboard totals, final bracket propagation, and downstream cleanup stay in one code path.

Do not guess tied knockout winners. If TheSportsDB reports a final tied score and the result text does not clearly identify the qualified team, the sync skips that final update and leaves the admin to set it manually.

## Autosave Betting UI

Group and finals betting pages use autosave, not submit buttons.

Markup contract:

- editable card wrapper has `.autosave-row`;
- it has `data-save-url`;
- score controls are named `score_a` and `score_b`;
- required blank selects prevent saving until both scores are selected;
- finals tie winner controls live inside `.tie-winner` with `name="winner_team_id"`.

`public/autosave.js`:

- debounces changes by 250 ms;
- refuses to POST until all required fields have values;
- shows spinner/saved/error in `.save-state`;
- fades "Enregistré" after saving;
- for finals, refreshes `#pronos-board` when the server returns `{ refresh: true }`.

For finals tied scores, the winner select is hidden/disabled until both scores are selected and equal.

## Routes

Auth:

- `GET/POST /login`
- `GET /logout`
- `GET/POST /signup`

Dashboard/messages:

- `GET /:slug`
- `POST /messages`
- `POST /messages/:id/like`
- `POST /messages/:id/delete`

Pronos:

- `GET /pronos` and `GET /:slug/pronos` redirect to the current phase page.
- `GET /:slug/bets/groups`
- `POST /:slug/bets/groups/:matchId`
- `GET /:slug/bets/knockout`
- `POST /:slug/bets/knockout/:matchId`
- `POST /:slug/bets/winners/:matchNo`
- `GET /:slug/players/:userId/pronos`
- `GET /:slug/players/:userId/bets/groups`
- `GET /:slug/players/:userId/bets/knockout`

Other:

- `GET /:slug/matches`
- `GET /:slug/rules`
- `GET/POST /:slug/admin...`

Legacy redirects:

- `/index.php`
- `/main_page.php`

If adding new routes, keep slugged and unslugged redirect variants consistent.

## Matches Page

`GET /:slug/matches` uses `withMatchStats()` from `src/matchStats.js`.

Current UI deliberately does not show "cote". Do not re-add it casually; it made the card layout confusing.

For user bets:

- display only the score;
- if predicted teams differ from actual teams, show the score in red and put predicted teams in a tooltip;
- if no bet is visible, show a red reason badge such as "Pas de prono" rather than a bare red X.

## Admin

Admin page sections:

- phase switcher;
- active tournament switcher;
- individual finals team assignment;
- match result entry/clearing.

Finals teams are set side-by-side (`/admin/teams/:matchId/a` and `/b`) because the two teams are often known at different times.

When entering a tied finals result, admin must set `winner_team_id` so scoring and downstream team resolution know who qualified.

`resolveKnockoutTeams()` fills downstream real match teams from final results. It writes only missing downstream team slots via `COALESCE`, so explicit admin assignments are preserved.

## UI Notes

Global CSS is in `public/app.css`.

Design conventions from recent work:

- Keep operational pages dense and clear, not marketing-like.
- Use lucide icons through `<i data-lucide="...">`; `footer.ejs` calls `lucide.createIcons()`.
- Mobile nav hides text labels via spans and hides the Rules link to keep one row.
- Do not leave raw nav text outside a span; it breaks mobile icon centering.
- Betting cards use `.bracket-grid` and should stay stable across group/finals pages.
- Avoid nested cards.
- Status labels should be user-facing French: "Ouvert" / "Verrouillé" with proper accents in source.

## Messages And Uploads

Dashboard messages can include text and one uploaded image. Multer writes uploads to `public/uploads`.

Likes are protected from duplicates by `message_likes`; the denormalized `messages.likes` counter increments only when `INSERT OR IGNORE` inserts a new like.

There is minimal upload validation. If this app goes beyond family/private use, add server-side file type/size checks.

## Tests To Keep Green

Existing tests are intentionally focused on rules that are easy to break:

- `test/scoring.test.js`: point rules including partial finals correctness and tied finals.
- `test/knockout.test.js`: user-specific finals inference and stale downstream teams.
- `test/matchStats.test.js`: matches page wrong-team display data.

When changing finals behavior, add/adjust tests before editing the EJS. The view is downstream of `src/knockout.js`; most bugs should be caught in pure tests.

## Known Sharp Edges

- When `ADMIN_PASSWORD` is present, `seedAdmin()` overwrites Eric's password on every startup.
- There is no production session store.
- There is no formal migration framework.
- `DATABASE_URL` is treated as a SQLite file path.
- The old PHP files are not authoritative for implementation details, but they are useful to understand historical behavior such as read-only reveal phases and red wrong-team display.
- Finals bets must survive admin team changes. Preserving wrong bets is a feature, not stale data.
- Tournament phase is manual; deadlines are displayed but not currently enforced by time.
