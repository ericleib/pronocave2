const assert = require("node:assert/strict");
const test = require("node:test");

const { queryName, syncScoresOnce, updateFromEvent } = require("../src/scoreSync");

function match(overrides = {}) {
  return {
    id: 10,
    tournament_id: 1,
    match_no: 1,
    round: "group",
    status: "scheduled",
    score_a: null,
    score_b: null,
    winner_team_id: null,
    team_a_id: 100,
    team_b_id: 200,
    team_a_name: "Mexique",
    team_b_name: "Afrique du Sud",
    team_a_source_name: "Mexico",
    team_b_source_name: "South Africa",
    kickoff_utc: "2026-06-11T19:00:00Z",
    ...overrides,
  };
}

function response(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
  };
}

test("query names use TheSportsDB aliases where needed", () => {
  assert.equal(queryName("Canada", "Bosnia and Herzegovina"), "Canada_vs_Bosnia-Herzegovina");
});

test("provider live events map home and away scores onto local match sides", () => {
  const update = updateFromEvent(
    {
      idEvent: "abc",
      strStatus: "1H",
      strHomeTeam: "South Africa",
      strAwayTeam: "Mexico",
      intHomeScore: "1",
      intAwayScore: "2",
    },
    match(),
  );

  assert.deepEqual(update, {
    externalEventId: "abc",
    status: "live",
    scoreA: 2,
    scoreB: 1,
    winnerTeamId: null,
  });
});

test("provider final tied knockout events are skipped without a qualified winner", () => {
  const update = updateFromEvent(
    {
      idEvent: "ko",
      strStatus: "FT",
      strHomeTeam: "Mexico",
      strAwayTeam: "South Africa",
      intHomeScore: "1",
      intAwayScore: "1",
      strResult: "",
    },
    match({ round: "round32" }),
  );

  assert.equal(update.skipped, true);
  assert.equal(update.externalEventId, "ko");
});

test("score sync records provider IDs and saves changed live scores", async () => {
  const candidate = match();
  const saves = [];
  const recorded = [];
  const fakeStore = {
    activeTournament: () => ({ id: 1, year: 2026 }),
    scoreSyncCandidates: () => [candidate],
    recordMatchExternalSync: (matchId, payload) => recorded.push({ matchId, ...payload }),
    saveResult: (payload) => saves.push(payload),
  };
  const fakeFetch = async () =>
    response({
      event: [
        {
          idEvent: "2391728",
          strStatus: "2H",
          strHomeTeam: "Mexico",
          strAwayTeam: "South Africa",
          intHomeScore: "3",
          intAwayScore: "1",
        },
      ],
    });

  const result = await syncScoresOnce({ store: fakeStore, fetchImpl: fakeFetch, now: new Date("2026-06-11T20:10:00Z") });

  assert.equal(result.checked, 1);
  assert.equal(result.updated, 1);
  assert.equal(recorded[0].eventId, "2391728");
  assert.deepEqual(saves[0], {
    matchId: 10,
    status: "live",
    scoreA: 3,
    scoreB: 1,
    winnerTeamId: null,
  });
});
