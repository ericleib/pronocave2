const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.DATABASE_URL = path.join(os.tmpdir(), `pronocave-results-${process.pid}-${Date.now()}.sqlite`);

const store = require("../src/db");

store.initialize();

let suffix = 0;

function createTournament() {
  suffix += 1;
  const inserted = store.run(
    "INSERT INTO tournaments (slug, name, short_name, year, phase) VALUES (?, ?, ?, ?, 0)",
    [`test-${suffix}`, `Test ${suffix}`, `T${suffix}`, 2026],
  );
  return Number(inserted.lastInsertRowid);
}

function createTeam(tournamentId, name) {
  const inserted = store.run("INSERT INTO teams (tournament_id, name, group_code) VALUES (?, ?, 'A')", [
    tournamentId,
    name,
  ]);
  return Number(inserted.lastInsertRowid);
}

function createMatch(tournamentId, values) {
  const inserted = store.run(
    `INSERT INTO matches
     (tournament_id, match_no, round, round_label, team_a_id, team_b_id,
      source_a_match_no, source_b_match_no, source_a_outcome, source_b_outcome, source_a_text, source_b_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      tournamentId,
      values.matchNo,
      values.round,
      values.roundLabel || values.round,
      values.teamAId || null,
      values.teamBId || null,
      values.sourceAMatchNo || null,
      values.sourceBMatchNo || null,
      values.sourceAOutcome || null,
      values.sourceBOutcome || null,
      values.sourceAText || "A",
      values.sourceBText || "B",
    ],
  );
  return Number(inserted.lastInsertRowid);
}

function createUser(login) {
  const inserted = store.createUser({ login, password: "secret12", email: `${login}@example.com` });
  return Number(inserted.lastInsertRowid);
}

test("saveResult stores live results and recomputes provisional leaderboard points", () => {
  const tournamentId = createTournament();
  const teamA = createTeam(tournamentId, "France");
  const teamB = createTeam(tournamentId, "Mexique");
  const matchId = createMatch(tournamentId, {
    matchNo: 1,
    round: "group",
    teamAId: teamA,
    teamBId: teamB,
  });
  const userId = createUser("live-user");
  const match = store.get("SELECT * FROM matches WHERE id = ?", [matchId]);

  store.saveBet({ tournamentId, match, userId, scoreA: 2, scoreB: 1, teamAId: teamA, teamBId: teamB });
  assert.equal(store.betFor(matchId, userId).points, null);

  store.saveResult({ matchId, status: "live", scoreA: 1, scoreB: 0 });
  assert.equal(store.betFor(matchId, userId).points, 3);
  assert.equal(store.leaderboard(tournamentId).find((row) => row.id === userId).score, 3);

  store.saveResult({ matchId, status: "live", scoreA: 2, scoreB: 1 });
  assert.equal(store.betFor(matchId, userId).points, 4);
  assert.equal(store.leaderboard(tournamentId).find((row) => row.id === userId).score, 4);
});

test("leaderboard exposes bet counts so inactive users can be hidden after phase zero", () => {
  const tournamentId = createTournament();
  const teamA = createTeam(tournamentId, "France");
  const teamB = createTeam(tournamentId, "Mexique");
  const matchId = createMatch(tournamentId, {
    matchNo: 5,
    round: "group",
    teamAId: teamA,
    teamBId: teamB,
  });
  const activeUserId = createUser("active-better");
  const inactiveUserId = createUser("inactive-better");
  const match = store.get("SELECT * FROM matches WHERE id = ?", [matchId]);

  store.saveBet({ tournamentId, match, userId: activeUserId, scoreA: 1, scoreB: 0, teamAId: teamA, teamBId: teamB });
  const rows = store.leaderboard(tournamentId);

  assert.equal(rows.find((row) => row.id === activeUserId).bet_count, 1);
  assert.equal(rows.find((row) => row.id === inactiveUserId).bet_count, 0);
});

test("renameUser changes display names and rejects duplicates", () => {
  const firstUserId = createUser("rename-source");
  createUser("rename-target");

  store.renameUser(firstUserId, "Renamed Player");
  assert.equal(store.userById(firstUserId).login, "Renamed Player");
  assert.throws(() => store.renameUser(firstUserId, "rename-target"), /déjà utilisé/);
});

test("banned users are preserved but hidden from leaderboard and active user count", () => {
  const tournamentId = createTournament();
  const teamA = createTeam(tournamentId, "France");
  const teamB = createTeam(tournamentId, "Suisse");
  const matchId = createMatch(tournamentId, {
    matchNo: 7,
    round: "group",
    teamAId: teamA,
    teamBId: teamB,
  });
  const userId = createUser("banned-better");
  const match = store.get("SELECT * FROM matches WHERE id = ?", [matchId]);

  store.saveBet({ tournamentId, match, userId, scoreA: 1, scoreB: 0, teamAId: teamA, teamBId: teamB });
  assert.ok(store.leaderboard(tournamentId).some((row) => row.id === userId));

  const usersBeforeBan = store.stats(tournamentId).users;
  store.setUserBanned(userId, true);
  assert.equal(store.userById(userId).banned, 1);
  assert.equal(store.betFor(matchId, userId).score_a, 1);
  assert.equal(store.leaderboard(tournamentId).some((row) => row.id === userId), false);
  assert.equal(store.stats(tournamentId).users, usersBeforeBan - 1);

  store.setUserBanned(userId, false);
  assert.ok(store.leaderboard(tournamentId).some((row) => row.id === userId));
});

test("clearTournamentBets deletes only bets from the selected tournament", () => {
  const tournamentId = createTournament();
  const otherTournamentId = createTournament();
  const userId = createUser("clear-bets-user");
  const teamA = createTeam(tournamentId, "France");
  const teamB = createTeam(tournamentId, "Italie");
  const otherTeamA = createTeam(otherTournamentId, "Espagne");
  const otherTeamB = createTeam(otherTournamentId, "Portugal");
  const matchId = createMatch(tournamentId, { matchNo: 8, round: "group", teamAId: teamA, teamBId: teamB });
  const otherMatchId = createMatch(otherTournamentId, { matchNo: 9, round: "group", teamAId: otherTeamA, teamBId: otherTeamB });

  store.saveBet({
    tournamentId,
    match: store.get("SELECT * FROM matches WHERE id = ?", [matchId]),
    userId,
    scoreA: 1,
    scoreB: 0,
    teamAId: teamA,
    teamBId: teamB,
  });
  store.saveBet({
    tournamentId: otherTournamentId,
    match: store.get("SELECT * FROM matches WHERE id = ?", [otherMatchId]),
    userId,
    scoreA: 2,
    scoreB: 0,
    teamAId: otherTeamA,
    teamBId: otherTeamB,
  });

  store.clearTournamentBets(tournamentId);
  assert.equal(store.betFor(matchId, userId), undefined);
  assert.equal(store.betFor(otherMatchId, userId).score_a, 2);
});

test("resetTournamentMatches clears results and derived teams while preserving seeded teams", () => {
  const tournamentId = createTournament();
  const teamA = createTeam(tournamentId, "Argentine");
  const teamB = createTeam(tournamentId, "Mexique");
  const teamC = createTeam(tournamentId, "Allemagne");
  const firstMatchId = createMatch(tournamentId, {
    matchNo: 50,
    round: "round32",
    teamAId: teamA,
    teamBId: teamB,
  });
  const childMatchId = createMatch(tournamentId, {
    matchNo: 60,
    round: "round16",
    teamBId: teamC,
    sourceAMatchNo: 50,
    sourceAOutcome: "winner",
  });
  const userId = createUser("reset-user");

  store.saveResult({ matchId: firstMatchId, status: "final", scoreA: 2, scoreB: 0 });
  store.saveBet({
    tournamentId,
    match: store.get("SELECT * FROM matches WHERE id = ?", [firstMatchId]),
    userId,
    scoreA: 2,
    scoreB: 0,
    teamAId: teamA,
    teamBId: teamB,
  });
  assert.equal(store.betFor(firstMatchId, userId).points, 6);
  assert.equal(store.get("SELECT team_a_id FROM matches WHERE id = ?", [childMatchId]).team_a_id, teamA);

  store.resetTournamentMatches(tournamentId);
  const firstMatch = store.get("SELECT * FROM matches WHERE id = ?", [firstMatchId]);
  const childMatch = store.get("SELECT * FROM matches WHERE id = ?", [childMatchId]);

  assert.equal(firstMatch.team_a_id, teamA);
  assert.equal(firstMatch.team_b_id, teamB);
  assert.equal(firstMatch.status, "scheduled");
  assert.equal(firstMatch.score_a, null);
  assert.equal(childMatch.team_a_id, null);
  assert.equal(childMatch.team_b_id, teamC);
  assert.equal(childMatch.status, "scheduled");
  assert.equal(store.betFor(firstMatchId, userId).points, null);
});

test("changing a final knockout winner clears dependent results and propagates the new team", () => {
  const tournamentId = createTournament();
  const teamA = createTeam(tournamentId, "France");
  const teamB = createTeam(tournamentId, "Espagne");
  const teamC = createTeam(tournamentId, "Brésil");
  const firstMatchId = createMatch(tournamentId, {
    matchNo: 10,
    round: "round32",
    teamAId: teamA,
    teamBId: teamB,
  });
  const childMatchId = createMatch(tournamentId, {
    matchNo: 20,
    round: "round16",
    teamBId: teamC,
    sourceAMatchNo: 10,
    sourceAOutcome: "winner",
    sourceAText: "Vainqueur 10",
    sourceBText: "Brésil",
  });
  const userId = createUser("bracket-user");

  store.saveResult({ matchId: firstMatchId, status: "final", scoreA: 1, scoreB: 0 });
  assert.equal(store.get("SELECT team_a_id FROM matches WHERE id = ?", [childMatchId]).team_a_id, teamA);

  let childMatch = store.get("SELECT * FROM matches WHERE id = ?", [childMatchId]);
  store.saveBet({ tournamentId, match: childMatch, userId, scoreA: 2, scoreB: 0, teamAId: teamA, teamBId: teamC });
  store.saveResult({ matchId: childMatchId, status: "final", scoreA: 2, scoreB: 0 });
  assert.equal(store.betFor(childMatchId, userId).points, 8);

  store.saveResult({ matchId: firstMatchId, status: "final", scoreA: 0, scoreB: 1 });
  childMatch = store.get("SELECT * FROM matches WHERE id = ?", [childMatchId]);
  assert.equal(childMatch.team_a_id, teamB);
  assert.equal(childMatch.status, "scheduled");
  assert.equal(childMatch.score_a, null);
  assert.equal(childMatch.score_b, null);
  assert.equal(store.betFor(childMatchId, userId).points, null);
});

test("downgrading a final knockout result to live removes downstream teams until final again", () => {
  const tournamentId = createTournament();
  const teamA = createTeam(tournamentId, "Argentine");
  const teamB = createTeam(tournamentId, "Italie");
  const teamC = createTeam(tournamentId, "Allemagne");
  const firstMatchId = createMatch(tournamentId, {
    matchNo: 30,
    round: "quarter",
    teamAId: teamA,
    teamBId: teamB,
  });
  const childMatchId = createMatch(tournamentId, {
    matchNo: 40,
    round: "semi",
    teamBId: teamC,
    sourceAMatchNo: 30,
    sourceAOutcome: "winner",
  });

  store.saveResult({ matchId: firstMatchId, status: "final", scoreA: 3, scoreB: 2 });
  assert.equal(store.get("SELECT team_a_id FROM matches WHERE id = ?", [childMatchId]).team_a_id, teamA);

  store.saveResult({ matchId: firstMatchId, status: "live", scoreA: 3, scoreB: 3 });
  const childMatch = store.get("SELECT * FROM matches WHERE id = ?", [childMatchId]);
  assert.equal(childMatch.team_a_id, null);
  assert.equal(childMatch.status, "scheduled");
});
