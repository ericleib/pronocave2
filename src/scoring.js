function winnerSide(scoreA, scoreB) {
  if (scoreA > scoreB) return "A";
  if (scoreB > scoreA) return "B";
  return "even";
}

const KNOCKOUT_POINTS = {
  round32: { winner: 3, teams: 0, exactScore: 2 },
  final: { winner: 7, teams: 5, exactScore: 5 },
  default: { winner: 3, teams: 2, exactScore: 2 },
};

function knockoutPoints(round) {
  return KNOCKOUT_POINTS[round] || KNOCKOUT_POINTS.default;
}

function winnerTeam(match, side) {
  if (side === "even") return match.winner_team_id;
  return side === "A" ? match.team_a_id : match.team_b_id;
}

function betWinnerTeam(bet) {
  if (bet.winner_side === "even") return bet.winner_team_id;
  return bet.winner_side === "A" ? bet.team_a_id : bet.team_b_id;
}

function sameTeams(match, bet) {
  return Number(bet.team_a_id) === Number(match.team_a_id) && Number(bet.team_b_id) === Number(match.team_b_id);
}

function exactScore(match, bet) {
  return Number(match.score_a) === Number(bet.score_a) && Number(match.score_b) === Number(bet.score_b);
}

function isScoredStatus(status) {
  return status === "live" || status === "final";
}

function scoreBet(match, bet) {
  if (!match || !bet || !isScoredStatus(match.status)) return null;
  const actualWinner = winnerSide(match.score_a, match.score_b);

  if (match.round === "group") {
    if (exactScore(match, bet)) return 3;
    return actualWinner === bet.winner_side ? 2 : 0;
  }

  const actualWinnerTeam = winnerTeam(match, actualWinner);
  const predictedWinnerTeam = betWinnerTeam(bet);
  const hasSameTeams = sameTeams(match, bet);
  const hasExactScore = exactScore(match, bet);

  if (predictedWinnerTeam && actualWinnerTeam && Number(predictedWinnerTeam) === Number(actualWinnerTeam)) {
    const points = knockoutPoints(match.round);
    return points.winner + (hasSameTeams ? points.teams : 0) + (hasSameTeams && hasExactScore ? points.exactScore : 0);
  }

  if (actualWinner === "even" && bet.winner_side === "even" && hasSameTeams) {
    return 2 + (hasExactScore ? 2 : 0);
  }

  return 0;
}

module.exports = { KNOCKOUT_POINTS, isScoredStatus, scoreBet, winnerSide };
