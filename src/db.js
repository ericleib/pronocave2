const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require("./passwords");
const { scoreBet, winnerSide } = require("./scoring");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const dbPath = process.env.DATABASE_URL || path.join(dataDir, "pronocave.sqlite");
const MATCH_STATUSES = new Set(["scheduled", "live", "final"]);

fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");

function run(sql, params = {}) {
  const statement = db.prepare(sql);
  return Array.isArray(params) ? statement.run(...params) : statement.run(params);
}

function get(sql, params = {}) {
  const statement = db.prepare(sql);
  return Array.isArray(params) ? statement.get(...params) : statement.get(params);
}

function all(sql, params = {}) {
  const statement = db.prepare(sql);
  return Array.isArray(params) ? statement.all(...params) : statement.all(params);
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      year INTEGER,
      phase INTEGER NOT NULL DEFAULT 0,
      group_bet_deadline TEXT,
      knockout_bet_deadline TEXT,
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      group_code TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(tournament_id, name)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      match_no INTEGER NOT NULL,
      round TEXT NOT NULL,
      round_label TEXT NOT NULL,
      group_code TEXT,
      kickoff_utc TEXT,
      kickoff_label TEXT,
      venue TEXT,
      team_a_id INTEGER REFERENCES teams(id),
      team_b_id INTEGER REFERENCES teams(id),
      source_a_text TEXT,
      source_b_text TEXT,
      source_a_match_no INTEGER,
      source_b_match_no INTEGER,
      source_a_outcome TEXT,
      source_b_outcome TEXT,
      score_a INTEGER,
      score_b INTEGER,
      winner_team_id INTEGER REFERENCES teams(id),
      penalties INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'scheduled',
      UNIQUE(tournament_id, match_no)
    );

    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score_a INTEGER NOT NULL,
      score_b INTEGER NOT NULL,
      team_a_id INTEGER REFERENCES teams(id),
      team_b_id INTEGER REFERENCES teams(id),
      winner_side TEXT NOT NULL,
      winner_team_id INTEGER REFERENCES teams(id),
      penalties INTEGER NOT NULL DEFAULT 0,
      points INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(match_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT,
      image_path TEXT,
      likes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_likes (
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_matches_tournament_round ON matches(tournament_id, round, match_no);
    CREATE INDEX IF NOT EXISTS idx_bets_user_tournament ON bets(user_id, tournament_id);
  `);
  addColumnIfMissing("teams", "source_name", "TEXT");
  addColumnIfMissing("matches", "external_provider", "TEXT");
  addColumnIfMissing("matches", "external_event_id", "TEXT");
  addColumnIfMissing("matches", "external_last_sync", "TEXT");
  addColumnIfMissing("matches", "winner_team_id", "INTEGER REFERENCES teams(id)");
  addColumnIfMissing("bets", "winner_team_id", "INTEGER REFERENCES teams(id)");
  addColumnIfMissing("users", "banned", "INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(table, column, definition) {
  const columns = all(`PRAGMA table_info(${table})`).map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedAdmin() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const eric = get("SELECT id FROM users WHERE lower(login) = lower('Eric')");
  if (eric) {
    if (adminPassword) {
      run("UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?", [hashPassword(adminPassword), eric.id]);
    } else {
      run("UPDATE users SET role = 'admin' WHERE id = ?", [eric.id]);
    }
    return;
  }

  if (!adminPassword) {
    throw new Error("ADMIN_PASSWORD is required to create the initial Eric admin account.");
  }

  const passwordHash = hashPassword(adminPassword);
  const legacyAdmin = get("SELECT id FROM users WHERE lower(login) = lower('admin')");
  if (legacyAdmin) {
    run("UPDATE users SET login = 'Eric', password_hash = ?, email = ?, role = 'admin' WHERE id = ?", [
      passwordHash,
      "eric@example.com",
      legacyAdmin.id,
    ]);
    return;
  }
  run("INSERT INTO users (login, password_hash, email, role) VALUES (?, ?, ?, 'admin')", [
    "Eric",
    passwordHash,
    "eric@example.com",
  ]);
}

function seedWorldCup2026() {
  const seedPath = path.join(dataDir, "worldcup-2026.json");
  if (!fs.existsSync(seedPath)) return;
  const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const exists = get("SELECT id FROM tournaments WHERE slug = ?", [seed.tournament.slug]);
  if (exists) {
    syncSeededTournament(exists.id, seed);
    return;
  }

  db.exec("BEGIN");
  try {
    const result = run(
      `INSERT INTO tournaments
       (slug, name, short_name, year, phase, group_bet_deadline, knockout_bet_deadline, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        seed.tournament.slug,
        seed.tournament.name,
        seed.tournament.shortName,
        seed.tournament.year,
        seed.tournament.phase,
        seed.tournament.groupBetDeadline,
        seed.tournament.knockoutBetDeadline,
      ],
    );
    const tournamentId = Number(result.lastInsertRowid);

    const teamIds = new Map();
    for (const team of seed.teams) {
      const inserted = run("INSERT INTO teams (tournament_id, name, group_code, source_name) VALUES (?, ?, ?, ?)", [
        tournamentId,
        team.name,
        team.group,
        team.sourceName || team.name,
      ]);
      teamIds.set(team.name, Number(inserted.lastInsertRowid));
      if (team.sourceName) teamIds.set(team.sourceName, Number(inserted.lastInsertRowid));
    }

    for (const match of seed.matches) {
      const teamA = match.round === "group" ? teamIds.get(match.sideA.text) : null;
      const teamB = match.round === "group" ? teamIds.get(match.sideB.text) : null;
      run(
        `INSERT INTO matches
         (tournament_id, match_no, round, round_label, group_code, kickoff_utc, kickoff_label, venue,
          team_a_id, team_b_id, source_a_text, source_b_text, source_a_match_no, source_b_match_no,
          source_a_outcome, source_b_outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tournamentId,
          match.matchNo,
          match.round,
          match.roundLabel,
          match.group,
          match.kickoffUtc,
          match.kickoffLabel,
          match.venue,
          teamA,
          teamB,
          match.sideA.text,
          match.sideB.text,
          match.sideA.matchNo,
          match.sideB.matchNo,
          match.sideA.outcome,
          match.sideB.outcome,
        ],
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function syncSeededTournament(tournamentId, seed) {
  run(
    `UPDATE tournaments
     SET name = ?, short_name = ?, year = ?, group_bet_deadline = ?, knockout_bet_deadline = ?
     WHERE id = ?`,
    [
      seed.tournament.name,
      seed.tournament.shortName,
      seed.tournament.year,
      seed.tournament.groupBetDeadline,
      seed.tournament.knockoutBetDeadline,
      tournamentId,
    ],
  );

  for (const team of seed.teams) {
    const existing =
      get("SELECT id FROM teams WHERE tournament_id = ? AND name IN (?, ?)", [
        tournamentId,
        team.name,
        team.sourceName || team.name,
      ]) ||
      get("SELECT id FROM teams WHERE tournament_id = ? AND group_code = ? AND name = ?", [
        tournamentId,
        team.group,
        team.sourceName || team.name,
    ]);
    if (existing) {
      run("UPDATE teams SET name = ?, group_code = ?, source_name = ? WHERE id = ?", [
        team.name,
        team.group,
        team.sourceName || team.name,
        existing.id,
      ]);
    }
  }

  for (const match of seed.matches) {
    run(
      `UPDATE matches
       SET round_label = ?, source_a_text = ?, source_b_text = ?
       WHERE tournament_id = ? AND match_no = ?`,
      [match.roundLabel, match.sideA.text, match.sideB.text, tournamentId, match.matchNo],
    );
  }
}

function initialize() {
  migrate();
  seedAdmin();
  seedWorldCup2026();
}

function tournaments() {
  return all("SELECT * FROM tournaments ORDER BY active DESC, year DESC, name ASC");
}

function activeTournament(requestedSlug) {
  if (requestedSlug) {
    const selected = get("SELECT * FROM tournaments WHERE slug = ?", [requestedSlug]);
    if (selected) return selected;
  }
  return get("SELECT * FROM tournaments WHERE active = 1 ORDER BY id DESC LIMIT 1") || get("SELECT * FROM tournaments ORDER BY id DESC LIMIT 1");
}

function userByLogin(login) {
  return get("SELECT * FROM users WHERE lower(login) = lower(?)", [login]);
}

function userById(id) {
  return get("SELECT id, login, email, role, banned FROM users WHERE id = ?", [id]);
}

function createUser({ login, password, email }) {
  return run("INSERT INTO users (login, password_hash, email) VALUES (?, ?, ?)", [login, hashPassword(password), email]);
}

function users() {
  return all("SELECT id, login, role, banned FROM users ORDER BY login COLLATE NOCASE");
}

function renameUser(userId, login) {
  const nextLogin = String(login || "").trim();
  if (!nextLogin) throw new Error("Nom manquant.");
  const duplicate = get("SELECT id FROM users WHERE lower(login) = lower(?) AND id != ?", [nextLogin, userId]);
  if (duplicate) throw new Error("Ce nom est déjà utilisé.");
  return run("UPDATE users SET login = ? WHERE id = ?", [nextLogin, userId]);
}

function setUserBanned(userId, banned) {
  return run("UPDATE users SET banned = ? WHERE id = ?", [banned ? 1 : 0, userId]);
}

function teamsForTournament(tournamentId) {
  return all("SELECT * FROM teams WHERE tournament_id = ? ORDER BY group_code, name", [tournamentId]);
}

function matchesForTournament(tournamentId) {
  return all(
    `SELECT m.*,
            ta.name AS team_a_name, tb.name AS team_b_name,
            ta.source_name AS team_a_source_name, tb.source_name AS team_b_source_name
     FROM matches m
     LEFT JOIN teams ta ON ta.id = m.team_a_id
     LEFT JOIN teams tb ON tb.id = m.team_b_id
     WHERE m.tournament_id = ?
     ORDER BY m.match_no`,
    [tournamentId],
  );
}

function betFor(matchId, userId) {
  return get("SELECT * FROM bets WHERE match_id = ? AND user_id = ?", [matchId, userId]);
}

function betsByUser(tournamentId, userId) {
  return all("SELECT * FROM bets WHERE tournament_id = ? AND user_id = ?", [tournamentId, userId]);
}

function betsForTournament(tournamentId) {
  return all(
    `SELECT b.*, ta.name AS bet_team_a_name, tb.name AS bet_team_b_name
     FROM bets b
     LEFT JOIN teams ta ON ta.id = b.team_a_id
     LEFT JOIN teams tb ON tb.id = b.team_b_id
     WHERE b.tournament_id = ?`,
    [tournamentId],
  );
}

function betByMatchNo(tournamentId, userId, matchNo) {
  return get(
    `SELECT b.*, m.match_no
     FROM bets b
     JOIN matches m ON m.id = b.match_id
     WHERE b.tournament_id = ? AND b.user_id = ? AND m.match_no = ?`,
    [tournamentId, userId, matchNo],
  );
}

function leaderboard(tournamentId) {
  return all(
    `SELECT u.id, u.login,
            COUNT(b.id) AS bet_count,
            COALESCE(SUM(CASE WHEN b.points IS NOT NULL THEN b.points ELSE 0 END), 0) AS score,
            COALESCE(SUM(CASE
              WHEN m.round = 'group' AND b.points = 4 THEN 1
              WHEN m.round = 'round32' AND b.points = 6 THEN 1
              WHEN m.round != 'group' AND m.round != 'round32' AND m.round != 'final' AND b.points = 8 THEN 1
              WHEN m.round = 'final' AND b.points = 20 THEN 1
              ELSE 0
            END), 0) AS bonus
     FROM users u
     LEFT JOIN bets b ON b.user_id = u.id AND b.tournament_id = ?
     LEFT JOIN matches m ON m.id = b.match_id
     WHERE u.banned = 0
     GROUP BY u.id
     ORDER BY score DESC, bonus DESC, u.login ASC`,
    [tournamentId],
  );
}

function stats(tournamentId) {
  return {
    users: get("SELECT COUNT(*) AS n FROM users WHERE banned = 0").n,
    bets: get("SELECT COUNT(*) AS n FROM bets WHERE tournament_id = ?", [tournamentId]).n,
    done: get("SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ? AND status = 'final'", [tournamentId]).n,
    live: get("SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ? AND status = 'live'", [tournamentId]).n,
    upcoming: get("SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ? AND status = 'scheduled'", [tournamentId]).n,
    messages: get("SELECT COUNT(*) AS n FROM messages WHERE tournament_id = ?", [tournamentId]).n,
  };
}

function scoreSyncCandidates(tournamentId, now = new Date()) {
  const nowMs = now.getTime();
  const lookAheadMs = 20 * 60 * 1000;
  const liveLookBackMs = 6 * 60 * 60 * 1000;
  const finalCorrectionMs = 24 * 60 * 60 * 1000;
  return matchesForTournament(tournamentId).filter((match) => {
    if (!match.team_a_id || !match.team_b_id) return false;
    if (!match.kickoff_utc) return match.status === "live";
    const kickoffMs = new Date(match.kickoff_utc).getTime();
    if (Number.isNaN(kickoffMs)) return match.status === "live";
    if (match.status === "live") return true;
    if (match.status === "final") return nowMs - kickoffMs >= 0 && nowMs - kickoffMs <= finalCorrectionMs;
    return kickoffMs <= nowMs + lookAheadMs && kickoffMs >= nowMs - liveLookBackMs;
  });
}

function recordMatchExternalSync(matchId, { provider, eventId, syncedAt = new Date() }) {
  run(
    `UPDATE matches
     SET external_provider = ?, external_event_id = COALESCE(?, external_event_id), external_last_sync = ?
     WHERE id = ?`,
    [provider, eventId || null, syncedAt.toISOString(), matchId],
  );
}

function clearTournamentBets(tournamentId) {
  return run("DELETE FROM bets WHERE tournament_id = ?", [tournamentId]);
}

function resetTournamentMatches(tournamentId) {
  run(
    `UPDATE matches
     SET team_a_id = CASE WHEN round = 'group' OR source_a_match_no IS NULL THEN team_a_id ELSE NULL END,
         team_b_id = CASE WHEN round = 'group' OR source_b_match_no IS NULL THEN team_b_id ELSE NULL END,
         score_a = NULL,
         score_b = NULL,
         winner_team_id = NULL,
         penalties = 0,
         status = 'scheduled',
         external_provider = NULL,
         external_event_id = NULL,
         external_last_sync = NULL
     WHERE tournament_id = ?`,
    [tournamentId],
  );
  for (const match of all("SELECT id FROM matches WHERE tournament_id = ?", [tournamentId])) {
    updatePointsForMatch(match.id);
  }
}

function saveBet({ tournamentId, match, userId, scoreA, scoreB, teamAId, teamBId, winnerTeamId = null }) {
  const winner = winnerSide(scoreA, scoreB);
  const tmpBet = {
    score_a: Number(scoreA),
    score_b: Number(scoreB),
    team_a_id: teamAId || match.team_a_id,
    team_b_id: teamBId || match.team_b_id,
    winner_side: winner,
    winner_team_id: winner === "even" ? winnerTeamId : null,
    penalties: 0,
  };
  const points = scoreBet(match, tmpBet);
  run(
    `INSERT INTO bets
     (tournament_id, match_id, user_id, score_a, score_b, team_a_id, team_b_id, winner_side, winner_team_id, penalties, points, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(match_id, user_id) DO UPDATE SET
       score_a = excluded.score_a,
       score_b = excluded.score_b,
       team_a_id = excluded.team_a_id,
       team_b_id = excluded.team_b_id,
       winner_side = excluded.winner_side,
       winner_team_id = excluded.winner_team_id,
       penalties = excluded.penalties,
       points = excluded.points,
       updated_at = CURRENT_TIMESTAMP`,
    [
      tournamentId,
      match.id,
      userId,
      tmpBet.score_a,
      tmpBet.score_b,
      tmpBet.team_a_id,
      tmpBet.team_b_id,
      tmpBet.winner_side,
      tmpBet.winner_team_id,
      tmpBet.penalties,
      points,
    ],
  );
}

function saveBetWinner({ tournamentId, userId, matchNo, winnerTeamId }) {
  const source = betByMatchNo(tournamentId, userId, matchNo);
  if (!source || source.winner_side !== "even") return;
  run("UPDATE bets SET winner_team_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [winnerTeamId || null, source.id]);
  updatePointsForMatch(source.match_id);
}

function descendantMatchNos(tournamentId, matchNo) {
  const direct = all(
    `SELECT match_no FROM matches
     WHERE tournament_id = ? AND (source_a_match_no = ? OR source_b_match_no = ?)`,
    [tournamentId, matchNo, matchNo],
  ).map((row) => row.match_no);
  const seen = new Set(direct);
  for (const next of direct) {
    for (const child of descendantMatchNos(tournamentId, next)) seen.add(child);
  }
  return [...seen];
}

function winnerTeamId(match) {
  if (match.status !== "final") return null;
  if (match.winner_team_id) return match.winner_team_id;
  if (match.score_a > match.score_b) return match.team_a_id;
  if (match.score_b > match.score_a) return match.team_b_id;
  return null;
}

function loserTeamId(match) {
  if (match.status !== "final") return null;
  if (match.winner_team_id && match.winner_team_id === match.team_a_id) return match.team_b_id;
  if (match.winner_team_id && match.winner_team_id === match.team_b_id) return match.team_a_id;
  if (match.score_a > match.score_b) return match.team_b_id;
  if (match.score_b > match.score_a) return match.team_a_id;
  return null;
}

function normalizeMatchStatus(status) {
  const normalized = status || "final";
  if (!MATCH_STATUSES.has(normalized)) throw new Error("Statut de match invalide.");
  return normalized;
}

function normalizeScore(value) {
  if (value === undefined || value === null || value === "") throw new Error("Score invalide.");
  const score = Number(value);
  if (!Number.isInteger(score) || score < 0 || score > 99) throw new Error("Score invalide.");
  return score;
}

function finalOutcome(match) {
  return {
    winnerId: winnerTeamId(match) || null,
    loserId: loserTeamId(match) || null,
  };
}

function outcomeChanged(before, after) {
  return Number(before.winnerId || 0) !== Number(after.winnerId || 0) || Number(before.loserId || 0) !== Number(after.loserId || 0);
}

function clearDescendantMatches(tournamentId, matchNo) {
  for (const child of descendantMatchNos(tournamentId, matchNo)) {
    const childMatch = get("SELECT id FROM matches WHERE tournament_id = ? AND match_no = ?", [tournamentId, child]);
    run(
      `UPDATE matches
       SET team_a_id = CASE WHEN source_a_match_no IS NULL THEN team_a_id ELSE NULL END,
           team_b_id = CASE WHEN source_b_match_no IS NULL THEN team_b_id ELSE NULL END,
           score_a = NULL, score_b = NULL, penalties = 0, winner_team_id = NULL, status = 'scheduled'
       WHERE tournament_id = ? AND match_no = ?`,
      [tournamentId, child],
    );
    if (childMatch) updatePointsForMatch(childMatch.id);
  }
}

function resolveKnockoutTeams(tournamentId) {
  const matches = matchesForTournament(tournamentId);
  const byNo = new Map(matches.map((match) => [match.match_no, match]));
  for (const match of matches.filter((m) => m.round !== "group")) {
    let teamA = match.team_a_id;
    let teamB = match.team_b_id;
    if (!teamA && match.source_a_match_no) {
      const source = byNo.get(match.source_a_match_no);
      teamA = match.source_a_outcome === "loser" ? loserTeamId(source) : winnerTeamId(source);
    }
    if (!teamB && match.source_b_match_no) {
      const source = byNo.get(match.source_b_match_no);
      teamB = match.source_b_outcome === "loser" ? loserTeamId(source) : winnerTeamId(source);
    }
    if (teamA || teamB) {
      run("UPDATE matches SET team_a_id = COALESCE(team_a_id, ?), team_b_id = COALESCE(team_b_id, ?) WHERE id = ?", [
        teamA,
        teamB,
        match.id,
      ]);
    }
  }
}

function assignMatchTeam({ matchId, side, teamId }) {
  const match = get("SELECT * FROM matches WHERE id = ?", [matchId]);
  if (!match || !["a", "b"].includes(side)) return;
  const column = side === "a" ? "team_a_id" : "team_b_id";
  const changed = Number(match[column] || 0) !== Number(teamId || 0);
  run(`UPDATE matches SET ${column} = ? WHERE id = ?`, [teamId || null, matchId]);
  if (changed) {
    updatePointsForMatch(matchId);
    for (const childMatchNo of descendantMatchNos(match.tournament_id, match.match_no)) {
      const child = get("SELECT id FROM matches WHERE tournament_id = ? AND match_no = ?", [
        match.tournament_id,
        childMatchNo,
      ]);
      if (child) updatePointsForMatch(child.id);
    }
  }
}

function saveResult({ matchId, scoreA, scoreB, teamAId, teamBId, winnerTeamId = null, status = "final" }) {
  const match = get("SELECT * FROM matches WHERE id = ?", [matchId]);
  if (!match) throw new Error("Match introuvable.");
  const nextStatus = normalizeMatchStatus(status);

  if (nextStatus === "scheduled") {
    clearResult(matchId);
    return;
  }

  const nextTeamA = teamAId || match.team_a_id;
  const nextTeamB = teamBId || match.team_b_id;
  const nextScoreA = normalizeScore(scoreA);
  const nextScoreB = normalizeScore(scoreB);
  const winner = winnerSide(nextScoreA, nextScoreB);
  const nextWinnerTeamId = winner === "even" && winnerTeamId ? Number(winnerTeamId) : null;
  const nextMatch = {
    ...match,
    status: nextStatus,
    team_a_id: nextTeamA,
    team_b_id: nextTeamB,
    score_a: nextScoreA,
    score_b: nextScoreB,
    winner_team_id: nextWinnerTeamId,
  };

  if (nextStatus === "final" && match.round !== "group" && winner === "even" && !nextWinnerTeamId) {
    throw new Error("Choisis le vainqueur qualifié.");
  }
  if (
    nextWinnerTeamId &&
    ![Number(nextTeamA || 0), Number(nextTeamB || 0)].includes(Number(nextWinnerTeamId))
  ) {
    throw new Error("Le vainqueur qualifié doit être une des deux équipes du match.");
  }

  const oldOutcome = finalOutcome(match);
  const nextOutcome = finalOutcome(nextMatch);
  const shouldClearDescendants =
    match.round !== "group" && match.status === "final" && (nextStatus !== "final" || outcomeChanged(oldOutcome, nextOutcome));

  run(
    `UPDATE matches
     SET score_a = ?, score_b = ?, penalties = 0, winner_team_id = ?, status = ?,
         team_a_id = COALESCE(?, team_a_id), team_b_id = COALESCE(?, team_b_id)
     WHERE id = ?`,
    [nextScoreA, nextScoreB, nextWinnerTeamId, nextStatus, nextTeamA, nextTeamB, matchId],
  );
  updatePointsForMatch(matchId);
  if (shouldClearDescendants) clearDescendantMatches(match.tournament_id, match.match_no);
  if (nextStatus === "final") resolveKnockoutTeams(match.tournament_id);
}

function clearResult(matchId) {
  const match = get("SELECT * FROM matches WHERE id = ?", [matchId]);
  if (!match) return;
  run("UPDATE matches SET score_a = NULL, score_b = NULL, penalties = 0, winner_team_id = NULL, status = 'scheduled' WHERE id = ?", [matchId]);
  updatePointsForMatch(matchId);
  clearDescendantMatches(match.tournament_id, match.match_no);
}

function updatePointsForMatch(matchId) {
  const match = get("SELECT * FROM matches WHERE id = ?", [matchId]);
  const bets = all("SELECT * FROM bets WHERE match_id = ?", [matchId]);
  for (const bet of bets) {
    run("UPDATE bets SET points = ? WHERE id = ?", [scoreBet(match, bet), bet.id]);
  }
}

function messages(tournamentId) {
  return all(
    `SELECT messages.*, users.login
     FROM messages
     JOIN users ON users.id = messages.user_id
     WHERE tournament_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [tournamentId],
  );
}

module.exports = {
  db,
  initialize,
  tournaments,
  activeTournament,
  userByLogin,
  userById,
  createUser,
  users,
  renameUser,
  setUserBanned,
  teamsForTournament,
  matchesForTournament,
  betFor,
  betsByUser,
  betsForTournament,
  betByMatchNo,
  leaderboard,
  stats,
  scoreSyncCandidates,
  recordMatchExternalSync,
  clearTournamentBets,
  resetTournamentMatches,
  saveBet,
  saveBetWinner,
  assignMatchTeam,
  saveResult,
  clearResult,
  resolveKnockoutTeams,
  messages,
  run,
  get,
  all,
};
