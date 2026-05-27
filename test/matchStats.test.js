const assert = require("node:assert/strict");
const test = require("node:test");

const { withMatchStats } = require("../src/matchStats");

const finalMatch = {
  id: 2,
  round: "quarter",
  status: "final",
  team_a_id: 20,
  team_b_id: 21,
  score_a: 1,
  score_b: 1,
  winner_team_id: 21,
};

function bet(overrides = {}) {
  return {
    match_id: 2,
    user_id: 7,
    team_a_id: 20,
    team_b_id: 21,
    winner_side: "A",
    winner_team_id: null,
    points: null,
    ...overrides,
  };
}

test("match stats keep a wrong-team user bet visible and mark the wrong side", () => {
  const [match] = withMatchStats(
    [finalMatch],
    [bet({ team_b_id: 30, bet_team_a_name: "France", bet_team_b_name: "Italie", points: 3 })],
    7,
  );

  assert.equal(match.userBet.bet_team_b_name, "Italie");
  assert.equal(match.userTeamAMismatch, false);
  assert.equal(match.userTeamBMismatch, true);
  assert.equal(match.totalPoints, 3);
  assert.equal(match.actualWinnerSide, "B");
});
