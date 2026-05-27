const { isScoredStatus, winnerSide } = require("./scoring");

function sameKnockoutTeams(match, bet) {
  return Number(match.team_a_id) === Number(bet.team_a_id) && Number(match.team_b_id) === Number(bet.team_b_id);
}

function actualWinnerSide(match) {
  if (!isScoredStatus(match.status)) return null;
  if (match.winner_team_id && Number(match.winner_team_id) === Number(match.team_a_id)) return "A";
  if (match.winner_team_id && Number(match.winner_team_id) === Number(match.team_b_id)) return "B";
  return winnerSide(match.score_a, match.score_b);
}

function withMatchStats(matches, bets, userId) {
  const betsByMatch = new Map();
  for (const bet of bets) {
    if (!betsByMatch.has(bet.match_id)) betsByMatch.set(bet.match_id, []);
    betsByMatch.get(bet.match_id).push(bet);
  }

  return matches.map((match) => {
    const matchBets = betsByMatch.get(match.id) || [];
    const userBet = matchBets.find((bet) => Number(bet.user_id) === Number(userId)) || null;
    return {
      ...match,
      totalPoints: isScoredStatus(match.status) ? matchBets.reduce((total, bet) => total + (bet.points || 0), 0) : null,
      userBet,
      userTeamAMismatch: Boolean(
        userBet && match.round !== "group" && match.team_a_id && Number(userBet.team_a_id) !== Number(match.team_a_id),
      ),
      userTeamBMismatch: Boolean(
        userBet && match.round !== "group" && match.team_b_id && Number(userBet.team_b_id) !== Number(match.team_b_id),
      ),
      actualWinnerSide: actualWinnerSide(match),
    };
  });
}

module.exports = {
  actualWinnerSide,
  withMatchStats,
};
