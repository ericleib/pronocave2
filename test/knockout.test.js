const assert = require("node:assert/strict");
const test = require("node:test");

const { betSyncPatches, buildKnockoutView, flattenedCards, selectedTieWinnerId } = require("../src/knockout");

const tournament = { id: 1, phase: 1 };
const teams = [
  { id: 1, name: "Team X" },
  { id: 2, name: "Opponent A" },
  { id: 3, name: "Team Y" },
  { id: 4, name: "Opponent B" },
];

const matches = [
  match({ id: 11, match_no: 1, round: "round32", team_a_id: 1, team_b_id: 2 }),
  match({ id: 12, match_no: 2, round: "round32", team_a_id: 3, team_b_id: 4 }),
  match({ id: 13, match_no: 3, round: "round16", source_a_match_no: 1, source_b_match_no: 2 }),
  match({
    id: 14,
    match_no: 4,
    round: "quarter",
    source_a_match_no: 3,
    source_b_match_no: 2,
    source_b_outcome: "loser",
    team_a_id: 1,
    team_b_id: 4,
  }),
];

function match(overrides) {
  return {
    tournament_id: 1,
    source_a_outcome: "winner",
    source_b_outcome: "winner",
    source_a_text: "Source A",
    source_b_text: "Source B",
    ...overrides,
  };
}

function bet(overrides) {
  return {
    tournament_id: 1,
    user_id: 1,
    score_a: 1,
    score_b: 0,
    winner_side: "A",
    winner_team_id: null,
    ...overrides,
  };
}

function viewFor(bets) {
  return buildKnockoutView({ tournament, teams, matches, bets });
}

function card(view, matchNo) {
  return flattenedCards(view).find((item) => item.match_no === matchNo);
}

test("later rounds infer from current source teams instead of stale saved bet teams", () => {
  const bets = [
    bet({ match_id: 11, team_a_id: 1, team_b_id: 2 }),
    bet({ match_id: 12, team_a_id: 3, team_b_id: 4 }),
    bet({ match_id: 13, team_a_id: 1, team_b_id: 3, score_a: 0, score_b: 1, winner_side: "B" }),
    bet({ match_id: 14, team_a_id: 1, team_b_id: 4 }),
  ];

  const view = viewFor(bets);
  assert.equal(card(view, 3).teamAId, 1);
  assert.equal(card(view, 3).teamBId, 3);
  assert.equal(card(view, 4).teamAId, 3);
  assert.equal(card(view, 4).teamAMismatch, true);
  assert.equal(card(view, 4).teamBMismatch, false);

  const patch = betSyncPatches(view).find((item) => item.match.match_no === 4);
  assert.equal(patch.teamAId, 3);
});

test("tied source bets block downstream matches until a winner is selected", () => {
  const view = viewFor([
    bet({ match_id: 11, team_a_id: 1, team_b_id: 2, score_a: 1, score_b: 1, winner_side: "even" }),
    bet({ match_id: 12, team_a_id: 3, team_b_id: 4 }),
  ]);

  assert.equal(card(view, 3).needsChoice, true);
  assert.deepEqual(
    card(view, 3).choiceTeams.map((team) => team.name),
    ["Team X", "Opponent A"],
  );
});

test("tie winner selections move with their original side when source teams change", () => {
  assert.equal(
    selectedTieWinnerId(
      { team_a_id: 1, team_b_id: 2, winner_team_id: 1 },
      3,
      2,
    ),
    3,
  );
});
