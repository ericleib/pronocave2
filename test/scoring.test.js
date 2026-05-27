const assert = require("node:assert/strict");
const test = require("node:test");

const { scoreBet } = require("../src/scoring");

function finalMatch(overrides = {}) {
  return {
    round: "final",
    status: "final",
    team_a_id: 1,
    team_b_id: 2,
    score_a: 2,
    score_b: 1,
    winner_team_id: null,
    ...overrides,
  };
}

function bet(overrides = {}) {
  return {
    team_a_id: 1,
    team_b_id: 2,
    score_a: 2,
    score_b: 1,
    winner_side: "A",
    winner_team_id: null,
    ...overrides,
  };
}

test("group scoring rewards exact score, then only correct outcome", () => {
  const match = finalMatch({ round: "group", score_a: 1, score_b: 1 });
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 1, winner_side: "even" })), 3);
  assert.equal(scoreBet(match, bet({ score_a: 2, score_b: 2, winner_side: "even" })), 2);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 2, winner_side: "B" })), 0);
});

test("live matches produce provisional points while scheduled matches do not", () => {
  const match = finalMatch({ round: "group", status: "live", score_a: 1, score_b: 0 });
  assert.equal(scoreBet(match, bet({ score_a: 2, score_b: 1, winner_side: "A" })), 2);
  assert.equal(scoreBet({ ...match, status: "scheduled" }, bet({ score_a: 2, score_b: 1, winner_side: "A" })), null);
});

test("round of 32 scoring rewards winner and exact score only when teams match", () => {
  const match = finalMatch({ round: "round32" });
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 0 })), 3);
  assert.equal(scoreBet(match, bet()), 5);
  assert.equal(scoreBet(match, bet({ team_a_id: 3, team_b_id: 2, score_a: 2, score_b: 1 })), 0);
});

test("later knockout scoring handles partially correct brackets", () => {
  const match = finalMatch({ round: "quarter" });
  assert.equal(scoreBet(match, bet({ team_a_id: 1, team_b_id: 3 })), 3);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 0 })), 5);
  assert.equal(scoreBet(match, bet()), 7);
});

test("final scoring has its larger winner, teams, and exact-score bonuses", () => {
  assert.equal(scoreBet(finalMatch(), bet({ team_a_id: 1, team_b_id: 3 })), 7);
  assert.equal(scoreBet(finalMatch(), bet({ score_a: 1, score_b: 0 })), 12);
  assert.equal(scoreBet(finalMatch(), bet()), 17);
});

test("knockout ties score by qualified team, not just tied score", () => {
  const match = finalMatch({ round: "semi", score_a: 1, score_b: 1, winner_team_id: 2 });
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 1, winner_side: "even", winner_team_id: 2 })), 7);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 1, winner_side: "even", winner_team_id: 1 })), 4);
});
