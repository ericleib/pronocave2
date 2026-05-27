const DEFAULT_INTERVAL_MS = 60 * 1000;
const PROVIDER = "thesportsdb";
const API_BASE = "https://www.thesportsdb.com/api/v1/json";

const TEAM_ALIASES = new Map([
  ["Bosnia and Herzegovina", "Bosnia-Herzegovina"],
  ["Cote d'Ivoire", "Ivory Coast"],
  ["Côte d'Ivoire", "Ivory Coast"],
  ["Ivory Coast", "Ivory Coast"],
  ["Czechia", "Czech Republic"],
  ["Türkiye", "Turkey"],
  ["United States", "USA"],
]);

const FINAL_STATUSES = new Set(["FT", "AET", "AP", "PEN", "FINAL", "FINISHED", "MATCH FINISHED"]);
const SCHEDULED_STATUSES = new Set(["", "NS", "TBD", "POST", "POSTPONED", "CANC", "CANCELLED"]);

function apiKey() {
  return process.env.THESPORTSDB_API_KEY || "123";
}

function providerTeamName(name) {
  return TEAM_ALIASES.get(name) || name;
}

function normalizeTeamName(name = "") {
  return providerTeamName(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/\band\b/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function queryName(teamA, teamB) {
  return `${providerTeamName(teamA)}_vs_${providerTeamName(teamB)}`.replace(/\s+/g, "_");
}

function matchTeamNames(match) {
  return {
    teamA: match.team_a_source_name || match.source_a_text || match.team_a_name,
    teamB: match.team_b_source_name || match.source_b_text || match.team_b_name,
  };
}

function matchDate(match) {
  if (!match.kickoff_utc) return null;
  return new Date(match.kickoff_utc).toISOString().slice(0, 10);
}

function eventUrl(match, reverse = false) {
  if (match.external_event_id) {
    return `${API_BASE}/${apiKey()}/lookupevent.php?id=${encodeURIComponent(match.external_event_id)}`;
  }
  const { teamA, teamB } = matchTeamNames(match);
  const date = matchDate(match);
  const eventName = reverse ? queryName(teamB, teamA) : queryName(teamA, teamB);
  const params = new URLSearchParams({ e: eventName, s: String(match.year || 2026) });
  if (date) params.set("d", date);
  return `${API_BASE}/${apiKey()}/searchevents.php?${params.toString()}`;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`TheSportsDB returned HTTP ${response.status}`);
  return response.json();
}

function eventFromPayload(payload) {
  return payload?.event?.[0] || payload?.events?.[0] || null;
}

async function fetchEventForMatch(match, fetchImpl) {
  const firstPayload = await fetchJson(fetchImpl, eventUrl(match, false));
  const firstEvent = eventFromPayload(firstPayload);
  if (firstEvent && eventBelongsToMatch(firstEvent, match)) return firstEvent;
  if (match.external_event_id) return firstEvent;

  const secondPayload = await fetchJson(fetchImpl, eventUrl(match, true));
  const secondEvent = eventFromPayload(secondPayload);
  return secondEvent && eventBelongsToMatch(secondEvent, match) ? secondEvent : firstEvent;
}

function eventBelongsToMatch(event, match) {
  const { teamA, teamB } = matchTeamNames(match);
  const home = normalizeTeamName(event.strHomeTeam);
  const away = normalizeTeamName(event.strAwayTeam);
  const a = normalizeTeamName(teamA);
  const b = normalizeTeamName(teamB);
  return (home === a && away === b) || (home === b && away === a);
}

function numericScore(value) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  return Number.isInteger(score) ? score : null;
}

function providerStatus(event) {
  const status = String(event.strStatus || "").trim().toUpperCase();
  if (FINAL_STATUSES.has(status)) return "final";
  if (SCHEDULED_STATUSES.has(status)) return "scheduled";
  return "live";
}

function mappedScores(event, match) {
  const homeScore = numericScore(event.intHomeScore);
  const awayScore = numericScore(event.intAwayScore);
  if (homeScore === null || awayScore === null) return null;

  const { teamA } = matchTeamNames(match);
  const homeIsA = normalizeTeamName(event.strHomeTeam) === normalizeTeamName(teamA);
  return homeIsA ? { scoreA: homeScore, scoreB: awayScore } : { scoreA: awayScore, scoreB: homeScore };
}

function tiedWinnerTeamId(event, match, scoreA, scoreB) {
  if (match.round === "group" || scoreA !== scoreB) return null;
  const text = normalizeTeamName(event.strResult || "");
  if (!text) return null;
  const { teamA, teamB } = matchTeamNames(match);
  if (text.includes(normalizeTeamName(teamA))) return match.team_a_id;
  if (text.includes(normalizeTeamName(teamB))) return match.team_b_id;
  return null;
}

function updateFromEvent(event, match) {
  if (!event) return null;
  const status = providerStatus(event);
  const scores = mappedScores(event, match);
  if (status === "scheduled") {
    return { externalEventId: event.idEvent, status: "scheduled" };
  }
  if (!scores) return null;
  const winnerTeamId = tiedWinnerTeamId(event, match, scores.scoreA, scores.scoreB);
  if (status === "final" && match.round !== "group" && scores.scoreA === scores.scoreB && !winnerTeamId) {
    return {
      externalEventId: event.idEvent,
      skipped: true,
      reason: "Tied knockout final without a qualified winner from provider.",
    };
  }
  return {
    externalEventId: event.idEvent,
    status,
    scoreA: scores.scoreA,
    scoreB: scores.scoreB,
    winnerTeamId,
  };
}

function updateChangesMatch(match, update) {
  if (!update || update.skipped || update.status === "scheduled") return false;
  return (
    match.status !== update.status ||
    Number(match.score_a) !== update.scoreA ||
    Number(match.score_b) !== update.scoreB ||
    Number(match.winner_team_id || 0) !== Number(update.winnerTeamId || 0)
  );
}

async function syncScoresOnce({ store, fetchImpl = globalThis.fetch, now = new Date(), logger = console } = {}) {
  if (!fetchImpl) throw new Error("fetch is not available in this Node.js runtime.");
  const tournament = store.activeTournament();
  if (!tournament) return { checked: 0, updated: 0, skipped: 0, errors: 0 };

  const candidates = store.scoreSyncCandidates(tournament.id, now);
  const result = { checked: candidates.length, updated: 0, skipped: 0, errors: 0 };

  for (const match of candidates) {
    try {
      const event = await fetchEventForMatch({ ...match, year: tournament.year }, fetchImpl);
      const update = updateFromEvent(event, match);
      if (update?.externalEventId) {
        store.recordMatchExternalSync(match.id, {
          provider: PROVIDER,
          eventId: update.externalEventId,
          syncedAt: now,
        });
      }
      if (!update || update.skipped || !updateChangesMatch(match, update)) {
        if (update?.skipped) result.skipped += 1;
        continue;
      }
      store.saveResult({
        matchId: match.id,
        status: update.status,
        scoreA: update.scoreA,
        scoreB: update.scoreB,
        winnerTeamId: update.winnerTeamId,
      });
      result.updated += 1;
    } catch (error) {
      result.errors += 1;
      logger.warn?.(`Score sync failed for match ${match.match_no}: ${error.message}`);
    }
  }

  return result;
}

function startScoreSyncJob({ store, intervalMs = Number(process.env.SCORE_SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS, logger = console } = {}) {
  if (process.env.SCORE_SYNC_ENABLED === "0") return null;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await syncScoresOnce({ store, logger });
      if (result.updated || result.errors || result.skipped) {
        logger.info?.(
          `Score sync checked=${result.checked} updated=${result.updated} skipped=${result.skipped} errors=${result.errors}`,
        );
      }
    } catch (error) {
      logger.warn?.(`Score sync failed: ${error.message}`);
    } finally {
      running = false;
    }
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 1000).unref?.();
  return { stop: () => clearInterval(timer), tick };
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  eventBelongsToMatch,
  providerStatus,
  queryName,
  syncScoresOnce,
  startScoreSyncJob,
  updateFromEvent,
};
