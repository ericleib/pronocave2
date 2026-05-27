function winnerSide(scoreA, scoreB) {
  if (scoreA > scoreB) return "A";
  if (scoreB > scoreA) return "B";
  return "even";
}

const KNOCKOUT_POINTS = {
  round32: { winner: 3, goalDifference: 5, exactScore: 6, draw: 3, drawExactScore: 5 },
  final: { winner: 8, teams: 12, goalDifference: 16, exactScore: 20, draw: 12, drawExactScore: 16 },
  default: { winner: 3, teams: 5, goalDifference: 7, exactScore: 8, draw: 5, drawExactScore: 7 },
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

function sameTeamSet(match, bet) {
  const actual = [match.team_a_id, match.team_b_id].map(Number).sort((a, b) => a - b);
  const predicted = [bet.team_a_id, bet.team_b_id].map(Number).sort((a, b) => a - b);
  return actual[0] === predicted[0] && actual[1] === predicted[1];
}

function exactScore(match, bet) {
  return Number(match.score_a) === Number(bet.score_a) && Number(match.score_b) === Number(bet.score_b);
}

function goalDifference(match, bet) {
  return Number(match.score_a) - Number(match.score_b) === Number(bet.score_a) - Number(bet.score_b);
}

function scoreForTeam(item, teamId) {
  if (Number(item.team_a_id) === Number(teamId)) return Number(item.score_a);
  if (Number(item.team_b_id) === Number(teamId)) return Number(item.score_b);
  return null;
}

function loserTeam(item, winnerTeamId) {
  if (Number(item.team_a_id) === Number(winnerTeamId)) return item.team_b_id;
  if (Number(item.team_b_id) === Number(winnerTeamId)) return item.team_a_id;
  return null;
}

function goalDifferenceByWinner(match, bet, actualWinnerTeam, actualLoserTeam) {
  const actualWinnerScore = scoreForTeam(match, actualWinnerTeam);
  const actualLoserScore = scoreForTeam(match, actualLoserTeam);
  const betWinnerScore = scoreForTeam(bet, actualWinnerTeam);
  const betLoserScore = scoreForTeam(bet, actualLoserTeam);
  if ([actualWinnerScore, actualLoserScore, betWinnerScore, betLoserScore].some((score) => score === null)) return false;
  return actualWinnerScore - actualLoserScore === betWinnerScore - betLoserScore;
}

function exactScoreByTeams(match, bet, actualWinnerTeam, actualLoserTeam) {
  const actualWinnerScore = scoreForTeam(match, actualWinnerTeam);
  const actualLoserScore = scoreForTeam(match, actualLoserTeam);
  const betWinnerScore = scoreForTeam(bet, actualWinnerTeam);
  const betLoserScore = scoreForTeam(bet, actualLoserTeam);
  if ([actualWinnerScore, actualLoserScore, betWinnerScore, betLoserScore].some((score) => score === null)) return false;
  return actualWinnerScore === betWinnerScore && actualLoserScore === betLoserScore;
}

function isScoredStatus(status) {
  return status === "live" || status === "final";
}

function scoreBet(match, bet) {
  if (!match || !bet || !isScoredStatus(match.status)) return null;
  const actualWinner = winnerSide(match.score_a, match.score_b);

  if (match.round === "group") {
    if (exactScore(match, bet)) return 4;
    if (actualWinner === bet.winner_side && actualWinner !== "even" && goalDifference(match, bet)) return 3;
    return actualWinner === bet.winner_side ? 2 : 0;
  }

  const actualWinnerTeam = winnerTeam(match, actualWinner);
  const predictedWinnerTeam = betWinnerTeam(bet);
  const hasSameTeamSet = sameTeamSet(match, bet);
  const points = knockoutPoints(match.round);

  if (predictedWinnerTeam && actualWinnerTeam && Number(predictedWinnerTeam) === Number(actualWinnerTeam)) {
    const actualLoserTeam = loserTeam(match, actualWinnerTeam);
    if (match.round === "round32") {
      if (exactScoreByTeams(match, bet, actualWinnerTeam, actualLoserTeam)) return points.exactScore;
      if (goalDifferenceByWinner(match, bet, actualWinnerTeam, actualLoserTeam)) return points.goalDifference;
      return points.winner;
    }

    if (hasSameTeamSet) {
      if (exactScoreByTeams(match, bet, actualWinnerTeam, actualLoserTeam)) return points.exactScore;
      if (goalDifferenceByWinner(match, bet, actualWinnerTeam, actualLoserTeam)) return points.goalDifference;
      return points.teams;
    }
    return points.winner;
  }

  if (actualWinner === "even" && bet.winner_side === "even") {
    if (match.round === "round32") return exactScore(match, bet) ? points.drawExactScore : points.draw;
    if (hasSameTeamSet) return exactScore(match, bet) ? points.drawExactScore : points.draw;
  }

  return 0;
}

module.exports = { KNOCKOUT_POINTS, isScoredStatus, scoreBet, winnerSide };
