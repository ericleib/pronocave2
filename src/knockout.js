const SCORE_RANGE = Array.from({ length: 11 }, (_, index) => index);

const ROUND_LABELS = {
  round32: "Seizièmes de finale",
  round16: "Huitièmes de finale",
  quarter: "Quarts de finale",
  semi: "Demi-finales",
  third_place: "Petite finale",
  final: "Finale",
};

function groupBy(rows, key) {
  return rows.reduce((groups, row) => {
    const value = row[key] || "Autre";
    groups[value] ||= [];
    groups[value].push(row);
    return groups;
  }, {});
}

function betMap(bets) {
  return bets instanceof Map ? bets : new Map(bets.map((bet) => [bet.match_id, bet]));
}

function selectedTieWinnerId(bet, currentTeamAId, currentTeamBId) {
  if (!bet?.winner_team_id || !currentTeamAId || !currentTeamBId) return null;
  const picked = Number(bet.winner_team_id);
  if (picked === Number(currentTeamAId) || picked === Number(currentTeamBId)) return picked;
  if (picked === Number(bet.team_a_id)) return currentTeamAId;
  if (picked === Number(bet.team_b_id)) return currentTeamBId;
  return null;
}

function buildKnockoutView({ tournament, teams, matches, bets }) {
  const teamById = new Map(teams.map((team) => [Number(team.id), team]));
  const betsByMatchId = betMap(bets);
  const knockoutMatches = matches.filter((match) => match.round !== "group");
  const matchByNo = new Map(knockoutMatches.map((match) => [Number(match.match_no), match]));
  const cardByNo = new Map();

  function sourceTeam(match, side) {
    const sourceMatchNo = match[`source_${side}_match_no`];
    if (!sourceMatchNo) return null;

    const source = matchByNo.get(Number(sourceMatchNo));
    if (!source) return null;

    const sourceCard = cardFor(source);
    const sourceBet = sourceCard.bet;
    if (!sourceBet || !sourceCard.teamAId || !sourceCard.teamBId) return null;

    let winner = null;
    if (sourceBet.winner_side === "even") {
      winner = selectedTieWinnerId(sourceBet, sourceCard.teamAId, sourceCard.teamBId);
      if (!winner) return { needsChoice: true, sourceBet, sourceCard };
    } else {
      winner = sourceBet.winner_side === "A" ? sourceCard.teamAId : sourceCard.teamBId;
    }

    const loser = Number(winner) === Number(sourceCard.teamAId) ? sourceCard.teamBId : sourceCard.teamAId;
    return {
      id: match[`source_${side}_outcome`] === "loser" ? loser : winner,
      sourceBet,
      sourceCard,
    };
  }

  function cardFor(match) {
    if (cardByNo.has(Number(match.match_no))) return cardByNo.get(Number(match.match_no));

    const bet = betsByMatchId.get(match.id);
    const inferredA = sourceTeam(match, "a");
    const inferredB = sourceTeam(match, "b");
    const teamAId = match.round === "round32" ? match.team_a_id : inferredA?.id;
    const teamBId = match.round === "round32" ? match.team_b_id : inferredB?.id;
    const teamA = teamById.get(Number(teamAId));
    const teamB = teamById.get(Number(teamBId));
    const choice = inferredA?.needsChoice ? inferredA : inferredB?.needsChoice ? inferredB : null;

    const card = {
      ...match,
      bet,
      betWinnerTeamId: selectedTieWinnerId(bet, teamAId, teamBId),
      teamAId,
      teamBId,
      teamAName: teamA?.name,
      teamBName: teamB?.name,
      teamAMismatch: Boolean(match.team_a_id && teamAId && Number(match.team_a_id) !== Number(teamAId)),
      teamBMismatch: Boolean(match.team_b_id && teamBId && Number(match.team_b_id) !== Number(teamBId)),
      needsChoice: Boolean(choice),
      choiceSource: choice?.sourceBet || null,
      choiceTeams: choice ? [teamById.get(Number(choice.sourceCard.teamAId)), teamById.get(Number(choice.sourceCard.teamBId))] : [],
      blocked: tournament.phase <= 1 && (!teamAId || !teamBId || Boolean(choice)),
    };
    cardByNo.set(Number(match.match_no), card);
    return card;
  }

  const cards = knockoutMatches.map(cardFor);
  return {
    rounds: groupBy(cards, "round"),
    labels: ROUND_LABELS,
    scores: SCORE_RANGE,
  };
}

function flattenedCards(view) {
  return Object.values(view.rounds).flat();
}

function betSyncPatches(view) {
  return flattenedCards(view)
    .filter((card) => card.bet && card.teamAId && card.teamBId && !card.needsChoice)
    .filter((card) => card.bet.winner_side !== "even" || card.betWinnerTeamId)
    .map((card) => ({
      match: card,
      scoreA: card.bet.score_a,
      scoreB: card.bet.score_b,
      teamAId: card.teamAId,
      teamBId: card.teamBId,
      winnerTeamId: card.bet.winner_side === "even" ? card.betWinnerTeamId : null,
    }));
}

module.exports = {
  SCORE_RANGE,
  ROUND_LABELS,
  buildKnockoutView,
  betSyncPatches,
  flattenedCards,
  groupBy,
  selectedTieWinnerId,
};
