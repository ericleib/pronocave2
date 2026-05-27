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

test("group scoring rewards exact score, goal difference for non-draws, then outcome", () => {
  const homeWin = finalMatch({ round: "group", score_a: 4, score_b: 3 });
  assert.equal(scoreBet(homeWin, bet({ score_a: 4, score_b: 3, winner_side: "A" })), 4);
  assert.equal(scoreBet(homeWin, bet({ score_a: 2, score_b: 1, winner_side: "A" })), 3);
  assert.equal(scoreBet(homeWin, bet({ score_a: 3, score_b: 1, winner_side: "A" })), 2);
  assert.equal(scoreBet(homeWin, bet({ score_a: 1, score_b: 2, winner_side: "B" })), 0);
});

test("group draw scoring does not award the goal-difference tier", () => {
  const draw = finalMatch({ round: "group", score_a: 1, score_b: 1 });
  assert.equal(scoreBet(draw, bet({ score_a: 1, score_b: 1, winner_side: "even" })), 4);
  assert.equal(scoreBet(draw, bet({ score_a: 2, score_b: 2, winner_side: "even" })), 2);
  assert.equal(scoreBet(draw, bet({ score_a: 1, score_b: 2, winner_side: "B" })), 0);
});

test("live matches produce provisional points while scheduled matches do not", () => {
  const match = finalMatch({ round: "group", status: "live", score_a: 1, score_b: 0 });
  assert.equal(scoreBet(match, bet({ score_a: 2, score_b: 1, winner_side: "A" })), 3);
  assert.equal(scoreBet({ ...match, status: "scheduled" }, bet({ score_a: 2, score_b: 1, winner_side: "A" })), null);
});

test("round of 32 scoring uses winner, goal-difference, and exact-score tiers", () => {
  const match = finalMatch({ round: "round32", score_a: 4, score_b: 2 });
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 0 })), 3);
  assert.equal(scoreBet(match, bet({ score_a: 3, score_b: 1 })), 5);
  assert.equal(scoreBet(match, bet({ score_a: 4, score_b: 2 })), 6);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 2, winner_side: "B", winner_team_id: null })), 0);
});

test("round of 32 tied games can score the qualified team or the draw fallback", () => {
  const match = finalMatch({ round: "round32", score_a: 1, score_b: 1, winner_team_id: 1 });
  assert.equal(scoreBet(match, bet({ score_a: 2, score_b: 2, winner_side: "even", winner_team_id: 1 })), 5);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 1, winner_side: "even", winner_team_id: 1 })), 6);
  assert.equal(scoreBet(match, bet({ score_a: 2, score_b: 2, winner_side: "even", winner_team_id: 2 })), 3);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 1, winner_side: "even", winner_team_id: 2 })), 5);
});

test("later knockout scoring handles winner-only and correct-participant tiers", () => {
  const match = finalMatch({ round: "quarter", score_a: 4, score_b: 2 });
  assert.equal(scoreBet(match, bet({ team_a_id: 1, team_b_id: 3, score_a: 1, score_b: 0 })), 3);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 0 })), 5);
  assert.equal(scoreBet(match, bet({ score_a: 3, score_b: 1 })), 7);
  assert.equal(scoreBet(match, bet({ score_a: 4, score_b: 2 })), 8);
  assert.equal(scoreBet(match, bet({ score_a: 0, score_b: 1, winner_side: "B" })), 0);
});

test("later knockout participant tiers work even if team slots are reversed", () => {
  const match = finalMatch({ round: "semi", score_a: 3, score_b: 1 });
  assert.equal(
    scoreBet(match, bet({ team_a_id: 2, team_b_id: 1, score_a: 1, score_b: 3, winner_side: "B" })),
    8,
  );
});

test("later knockout tied games score draw fallbacks only with correct teams", () => {
  const match = finalMatch({ round: "semi", score_a: 1, score_b: 1, winner_team_id: 2 });
  assert.equal(scoreBet(match, bet({ score_a: 2, score_b: 2, winner_side: "even", winner_team_id: 1 })), 5);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 1, winner_side: "even", winner_team_id: 1 })), 7);
  assert.equal(scoreBet(match, bet({ team_a_id: 1, team_b_id: 3, score_a: 1, score_b: 1, winner_side: "even", winner_team_id: 1 })), 0);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 1, winner_side: "even", winner_team_id: 2 })), 8);
});

test("final scoring uses its larger winner, participant, goal-difference, and exact tiers", () => {
  const match = finalMatch({ score_a: 3, score_b: 1 });
  assert.equal(scoreBet(match, bet({ team_a_id: 1, team_b_id: 3, score_a: 1, score_b: 0 })), 8);
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 0 })), 12);
  assert.equal(scoreBet(match, bet({ score_a: 5, score_b: 3 })), 16);
  assert.equal(scoreBet(match, bet({ score_a: 3, score_b: 1 })), 20);
});

test("final tied games score draw fallbacks and champion predictions distinctly", () => {
  const match = finalMatch({ score_a: 2, score_b: 2, winner_team_id: 1 });
  assert.equal(scoreBet(match, bet({ score_a: 1, score_b: 1, winner_side: "even", winner_team_id: 2 })), 12);
  assert.equal(scoreBet(match, bet({ score_a: 2, score_b: 2, winner_side: "even", winner_team_id: 2 })), 16);
  assert.equal(scoreBet(match, bet({ score_a: 2, score_b: 2, winner_side: "even", winner_team_id: 1 })), 20);
});
