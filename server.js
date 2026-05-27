const path = require("node:path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");

const store = require("./src/db");
const { SCORE_RANGE, betSyncPatches, buildKnockoutView, flattenedCards, groupBy } = require("./src/knockout");
const { withMatchStats } = require("./src/matchStats");
const { verifyPassword } = require("./src/passwords");
const { startScoreSyncJob } = require("./src/scoreSync");

store.initialize();

const app = express();
const upload = multer({ dest: path.join(__dirname, "public", "uploads") });
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "pronocave-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { sameSite: "lax" },
  }),
);

function slugFromPath(req) {
  const first = req.path.split("/").filter(Boolean)[0];
  return store.tournaments().some((item) => item.slug === first) ? first : req.session.tournamentSlug;
}

function attachContext(req, res, next) {
  const tournament = store.activeTournament(slugFromPath(req));
  const user = req.session.userId ? store.userById(req.session.userId) : null;
  if (tournament) req.session.tournamentSlug = tournament.slug;
  res.locals.currentUser = user;
  res.locals.tournament = tournament;
  res.locals.tournaments = store.tournaments();
  res.locals.base = tournament ? `/${tournament.slug}` : "";
  res.locals.sectionPath = sectionPath(req.path, tournament?.slug);
  res.locals.pronosPath = tournament ? `/${tournament.slug}${tournament.phase === 0 ? "/bets/groups" : "/bets/knockout"}` : "/bets/groups";
  res.locals.flash = req.session.flash;
  res.locals.path = req.path;
  res.locals.phaseLabel = (phase) => ["Pronos groupes", "Pronos finales", "Verrouillé"][phase] || "Inconnue";
  res.locals.escapeHtml = escapeHtml;
  res.locals.formatDate = formatDate;
  delete req.session.flash;
  next();
}

function requireAuth(req, res, next) {
  if (!res.locals.currentUser) return res.redirect("/login");
  next();
}

function requireAdmin(req, res, next) {
  if (!res.locals.currentUser || res.locals.currentUser.role !== "admin") {
    req.session.flash = { type: "error", text: "Compte administrateur requis." };
    return res.redirect(res.locals.base || "/");
  }
  next();
}

function flash(req, type, text) {
  req.session.flash = { type, text };
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(value));
}

function sectionPath(pathname, slug) {
  if (!slug) return pathname;
  const prefix = `/${slug}`;
  if (pathname === prefix) return "/";
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}

function targetUrl(req, pagePath = "/") {
  const tournament = req.res?.locals?.tournament || store.activeTournament(req.session.tournamentSlug);
  const cleanPath = pagePath === "/" ? "" : pagePath;
  return `/${tournament.slug}${cleanPath}`;
}

function parseScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 && score <= 10 ? score : null;
}

function betMap(tournamentId, userId) {
  return new Map(store.betsByUser(tournamentId, userId).map((bet) => [bet.match_id, bet]));
}

function makeKnockoutView(tournament, userId) {
  store.resolveKnockoutTeams(tournament.id);
  return buildKnockoutView({
    tournament,
    teams: store.teamsForTournament(tournament.id),
    matches: store.matchesForTournament(tournament.id),
    bets: betMap(tournament.id, userId),
  });
}

function otherPlayerBetsVisible(tournament, stage) {
  if (stage === "groups") return tournament.phase > 0;
  if (stage === "knockout") return tournament.phase > 1;
  return false;
}

function playerPronosPath(tournament, userId) {
  if (tournament.phase > 1) return `/${tournament.slug}/players/${userId}/bets/knockout`;
  if (tournament.phase > 0) return `/${tournament.slug}/players/${userId}/bets/groups`;
  return null;
}

function syncKnockoutBetsToCurrentTeams(tournament, userId) {
  const view = makeKnockoutView(tournament, userId);
  for (const patch of betSyncPatches(view)) {
    store.saveBet({
      tournamentId: tournament.id,
      match: patch.match,
      userId,
      scoreA: patch.scoreA,
      scoreB: patch.scoreB,
      teamAId: patch.teamAId,
      teamBId: patch.teamBId,
      winnerTeamId: patch.winnerTeamId,
    });
  }
}

app.use(attachContext);

app.get(["/index.php", "/main_page.php"], (req, res) => res.redirect(targetUrl(req)));

app.get("/login", (req, res) => res.render("login"));
app.post("/login", (req, res) => {
  const user = store.userByLogin(req.body.login || "");
  if (!user || !verifyPassword(req.body.password || req.body.pass || "", user.password_hash)) {
    flash(req, "error", "Login ou mot de passe incorrect.");
    return res.redirect("/login");
  }
  req.session.userId = user.id;
  res.redirect(targetUrl(req));
});

app.get("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

app.get("/signup", (req, res) => res.render("signup"));
app.post("/signup", (req, res) => {
  const login = (req.body.login || "").trim();
  const password = req.body.password || req.body.pass || "";
  const email = (req.body.email || "").trim();
  if (!login || password.length < 6) {
    flash(req, "error", "Nom d'utilisateur manquant ou mot de passe trop court.");
    return res.redirect("/signup");
  }
  try {
    const result = store.createUser({ login, password, email });
    req.session.userId = Number(result.lastInsertRowid);
    flash(req, "success", "Compte créé.");
    res.redirect(targetUrl(req));
  } catch {
    flash(req, "error", "Ce nom d'utilisateur existe déjà.");
    res.redirect("/signup");
  }
});

app.get("/", requireAuth, (req, res) => res.redirect(targetUrl(req)));

app.get("/:slug", requireAuth, (req, res) => {
  const tournament = res.locals.tournament;
  const matches = withMatchStats(
    store.matchesForTournament(tournament.id),
    store.betsForTournament(tournament.id),
    req.session.userId,
  );
  res.render("dashboard", {
    leaderboard: store.leaderboard(tournament.id).map((row) => ({ ...row, pronosPath: playerPronosPath(tournament, row.id) })),
    stats: store.stats(tournament.id),
    messages: store.messages(tournament.id),
    liveMatches: matches
      .filter((match) => match.status === "live")
      .sort((a, b) => new Date(a.kickoff_utc || 0) - new Date(b.kickoff_utc || 0)),
  });
});

app.post("/messages", requireAuth, upload.single("photo"), (req, res) => {
  const tournament = res.locals.tournament;
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  const body = (req.body.message || "").trim();
  if (body || imagePath) {
    store.run("INSERT INTO messages (tournament_id, user_id, body, image_path) VALUES (?, ?, ?, ?)", [
      tournament.id,
      req.session.userId,
      body,
      imagePath,
    ]);
  }
  res.redirect(`${targetUrl(req)}#messages`);
});

app.post("/messages/:id/like", requireAuth, (req, res) => {
  const inserted = store.run("INSERT OR IGNORE INTO message_likes (message_id, user_id) VALUES (?, ?)", [
    req.params.id,
    req.session.userId,
  ]);
  if (inserted.changes > 0) {
    store.run("UPDATE messages SET likes = likes + 1 WHERE id = ? AND tournament_id = ?", [
      req.params.id,
      res.locals.tournament.id,
    ]);
  }
  res.redirect(`${targetUrl(req)}#messages`);
});

app.post("/messages/:id/delete", requireAuth, (req, res) => {
  const message = store.get("SELECT * FROM messages WHERE id = ? AND tournament_id = ?", [
    req.params.id,
    res.locals.tournament.id,
  ]);
  if (message && (message.user_id === req.session.userId || res.locals.currentUser.role === "admin")) {
    store.run("DELETE FROM messages WHERE id = ?", [message.id]);
  }
  res.redirect(`${targetUrl(req)}#messages`);
});

app.get("/pronos", requireAuth, (req, res) => res.redirect(res.locals.pronosPath));
app.get("/:slug/pronos", requireAuth, (req, res) => res.redirect(res.locals.pronosPath));

app.get("/bets/groups", requireAuth, (req, res) => res.redirect(targetUrl(req, "/bets/groups")));
app.get("/:slug/bets/groups", requireAuth, (req, res) => {
  const tournament = res.locals.tournament;
  const matches = store.matchesForTournament(tournament.id).filter((match) => match.round === "group");
  res.render("group-bets", {
    groups: groupBy(matches, "group_code"),
    bets: betMap(tournament.id, req.session.userId),
    scores: SCORE_RANGE,
    locked: tournament.phase !== 0,
    readonly: tournament.phase !== 0,
    viewedUser: null,
    otherStagePath: `${res.locals.base}/bets/knockout`,
  });
});

app.post("/:slug/bets/groups/:matchId", requireAuth, (req, res) => {
  const tournament = res.locals.tournament;
  if (tournament.phase !== 0) {
    return res.status(403).json({ ok: false, error: "Les pronos de groupes sont verrouillés." });
  }
  const scoreA = parseScore(req.body.score_a);
  const scoreB = parseScore(req.body.score_b);
  if (scoreA === null || scoreB === null) {
    return res.status(400).json({ ok: false, error: "Sélectionne les deux scores." });
  }
  const match = store.get("SELECT * FROM matches WHERE id = ? AND tournament_id = ? AND round = 'group'", [
    req.params.matchId,
    tournament.id,
  ]);
  if (!match) return res.status(404).json({ ok: false, error: "Match introuvable." });
  store.saveBet({
    tournamentId: tournament.id,
    match,
    userId: req.session.userId,
    scoreA,
    scoreB,
    teamAId: match.team_a_id,
    teamBId: match.team_b_id,
  });
  res.json({ ok: true });
});

app.get("/bets/knockout", requireAuth, (req, res) => res.redirect(targetUrl(req, "/bets/knockout")));
app.get("/:slug/bets/knockout", requireAuth, (req, res) => {
  res.render("knockout-bets", {
    ...makeKnockoutView(res.locals.tournament, req.session.userId),
    readonly: res.locals.tournament.phase > 1,
    viewedUser: null,
    otherStagePath: `${res.locals.base}/bets/groups`,
  });
});

app.get("/:slug/players/:userId/pronos", requireAuth, (req, res) => {
  const target = playerPronosPath(res.locals.tournament, Number(req.params.userId));
  if (!target) {
    flash(req, "error", "Les pronos des autres joueurs seront visibles après la phase de groupes.");
    return res.redirect(targetUrl(req));
  }
  res.redirect(target);
});

app.get("/:slug/players/:userId/bets/groups", requireAuth, (req, res) => {
  const tournament = res.locals.tournament;
  if (!otherPlayerBetsVisible(tournament, "groups")) return res.redirect(targetUrl(req));
  const viewedUser = store.userById(Number(req.params.userId));
  if (!viewedUser) return res.status(404).send("Joueur introuvable.");
  const matches = store.matchesForTournament(tournament.id).filter((match) => match.round === "group");
  res.render("group-bets", {
    groups: groupBy(matches, "group_code"),
    bets: betMap(tournament.id, viewedUser.id),
    scores: SCORE_RANGE,
    locked: true,
    readonly: true,
    viewedUser,
    otherStagePath: tournament.phase > 1 ? `${res.locals.base}/players/${viewedUser.id}/bets/knockout` : null,
  });
});

app.get("/:slug/players/:userId/bets/knockout", requireAuth, (req, res) => {
  const tournament = res.locals.tournament;
  if (!otherPlayerBetsVisible(tournament, "knockout")) return res.redirect(targetUrl(req));
  const viewedUser = store.userById(Number(req.params.userId));
  if (!viewedUser) return res.status(404).send("Joueur introuvable.");
  res.render("knockout-bets", {
    ...makeKnockoutView(tournament, viewedUser.id),
    readonly: true,
    viewedUser,
    otherStagePath: `${res.locals.base}/players/${viewedUser.id}/bets/groups`,
  });
});

app.post("/:slug/bets/knockout/:matchId", requireAuth, (req, res) => {
  const tournament = res.locals.tournament;
  if (tournament.phase > 1) {
    return res.status(403).json({ ok: false, error: "Les pronos de finales sont verrouillés." });
  }
  const match = store.get("SELECT * FROM matches WHERE id = ? AND tournament_id = ?", [req.params.matchId, tournament.id]);
  if (!match) return res.status(404).json({ ok: false, error: "Match introuvable." });
  const view = flattenedCards(makeKnockoutView(tournament, req.session.userId)).find((item) => Number(item.id) === Number(match.id));
  if (!view || !view.teamAId || !view.teamBId || view.needsChoice) {
    return res.status(400).json({ ok: false, error: "Les équipes de ce prono ne sont pas encore déterminées." });
  }
  const scoreA = parseScore(req.body.score_a);
  const scoreB = parseScore(req.body.score_b);
  if (scoreA === null || scoreB === null) {
    return res.status(400).json({ ok: false, error: "Sélectionne les deux scores." });
  }
  let winnerTeamId = null;
  if (scoreA === scoreB) {
    winnerTeamId = Number(req.body.winner_team_id) || null;
    if (![Number(view.teamAId), Number(view.teamBId)].includes(winnerTeamId)) {
      return res.status(400).json({ ok: false, error: "Choisis le vainqueur qualifié." });
    }
  }
  try {
    store.saveBet({
      tournamentId: tournament.id,
      match,
      userId: req.session.userId,
      scoreA,
      scoreB,
      teamAId: view.teamAId,
      teamBId: view.teamBId,
      winnerTeamId,
    });
    syncKnockoutBetsToCurrentTeams(tournament, req.session.userId);
    res.json({ ok: true, refresh: true });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post("/:slug/bets/winners/:matchNo", requireAuth, (req, res) => {
  const tournament = res.locals.tournament;
  store.saveBetWinner({
    tournamentId: tournament.id,
    userId: req.session.userId,
    matchNo: Number(req.params.matchNo),
    winnerTeamId: Number(req.body.winner_team_id) || null,
  });
  syncKnockoutBetsToCurrentTeams(tournament, req.session.userId);
  res.json({ ok: true, refresh: true });
});

app.get("/matches", requireAuth, (req, res) => res.redirect(targetUrl(req, "/matches")));
app.get("/:slug/matches", requireAuth, (req, res) => {
  const tournament = res.locals.tournament;
  const matches = withMatchStats(
    store.matchesForTournament(tournament.id),
    store.betsForTournament(tournament.id),
    req.session.userId,
  );
  res.render("matches", {
    finishedMatches: matches
      .filter((match) => match.status === "final")
      .sort((a, b) => new Date(b.kickoff_utc || 0) - new Date(a.kickoff_utc || 0)),
    liveMatches: matches
      .filter((match) => match.status === "live")
      .sort((a, b) => new Date(a.kickoff_utc || 0) - new Date(b.kickoff_utc || 0)),
    upcomingMatches: matches
      .filter((match) => match.status === "scheduled")
      .sort((a, b) => new Date(a.kickoff_utc || 0) - new Date(b.kickoff_utc || 0)),
  });
});

app.get("/rules", requireAuth, (req, res) => res.redirect(targetUrl(req, "/rules")));
app.get("/:slug/rules", requireAuth, (req, res) => res.render("rules"));

app.get("/admin", requireAdmin, (req, res) => res.redirect(targetUrl(req, "/admin")));
app.get("/:slug/admin", requireAdmin, (req, res) => {
  const tournament = res.locals.tournament;
  store.resolveKnockoutTeams(tournament.id);
  res.render("admin", {
    matches: store.matchesForTournament(tournament.id),
    teams: store.teamsForTournament(tournament.id),
  });
});

app.post("/:slug/admin/phase", requireAdmin, (req, res) => {
  store.run("UPDATE tournaments SET phase = ? WHERE id = ?", [Number(req.body.phase), res.locals.tournament.id]);
  flash(req, "success", "Phase mise à jour.");
  res.redirect(targetUrl(req, "/admin"));
});

app.post("/:slug/admin/active", requireAdmin, (req, res) => {
  store.run("UPDATE tournaments SET active = 0");
  store.run("UPDATE tournaments SET active = 1 WHERE id = ?", [req.body.tournament_id]);
  req.session.tournamentSlug = store.get("SELECT slug FROM tournaments WHERE id = ?", [req.body.tournament_id])?.slug;
  flash(req, "success", "Tournoi actif mis à jour.");
  res.redirect(targetUrl(req, "/admin"));
});

app.post("/:slug/admin/teams/:matchId/:side", requireAdmin, (req, res) => {
  store.assignMatchTeam({
    matchId: Number(req.params.matchId),
    side: req.params.side,
    teamId: Number(req.body.team_id) || null,
  });
  flash(req, "success", "Équipe mise à jour.");
  res.redirect(`${targetUrl(req, "/admin")}#teams`);
});

app.post("/:slug/admin/results/:matchId", requireAdmin, (req, res) => {
  try {
    store.saveResult({
      matchId: Number(req.params.matchId),
      status: req.body.status,
      scoreA: parseScore(req.body.score_a),
      scoreB: parseScore(req.body.score_b),
      winnerTeamId: Number(req.body.winner_team_id) || null,
    });
    flash(req, "success", "Résultat enregistré.");
  } catch (error) {
    flash(req, "error", error.message);
  }
  res.redirect(`${targetUrl(req, "/admin")}#results`);
});

app.post("/:slug/admin/results/:matchId/clear", requireAdmin, (req, res) => {
  store.clearResult(Number(req.params.matchId));
  flash(req, "success", "Résultat annulé.");
  res.redirect(`${targetUrl(req, "/admin")}#results`);
});

app.listen(PORT, () => {
  console.log(`Pronocave is running at http://localhost:${PORT}`);
});
startScoreSyncJob({ store });
