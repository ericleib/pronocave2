import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const htmlPath = path.join(root, "worldcuply_schedule.html");
const outPath = path.join(root, "data", "worldcup-2026.json");

if (!fs.existsSync(htmlPath)) {
  throw new Error("worldcuply_schedule.html is missing. Fetch https://worldcuply.com/schedule.html first.");
}

const html = fs.readFileSync(htmlPath, "utf8");

function text(value) {
  return value
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function roundKey(label) {
  if (label.startsWith("Group ")) return "group";
  if (label === "Round of 32") return "round32";
  if (label === "Round of 16") return "round16";
  if (label === "Quarter-final") return "quarter";
  if (label === "Semi-final") return "semi";
  if (label === "Third place") return "third_place";
  if (label === "Final") return "final";
  return label.toLowerCase().replace(/\W+/g, "_");
}

const frenchTeams = new Map(
  Object.entries({
    Algeria: "Algérie",
    Argentina: "Argentine",
    Australia: "Australie",
    Austria: "Autriche",
    Belgium: "Belgique",
    "Bosnia and Herzegovina": "Bosnie-Herzégovine",
    Brazil: "Brésil",
    Canada: "Canada",
    "Cape Verde": "Cap-Vert",
    Colombia: "Colombie",
    Croatia: "Croatie",
    Curaçao: "Curaçao",
    "Czech Republic": "Tchéquie",
    "DR Congo": "RD Congo",
    Ecuador: "Équateur",
    Egypt: "Égypte",
    England: "Angleterre",
    France: "France",
    Germany: "Allemagne",
    Ghana: "Ghana",
    Haiti: "Haïti",
    Iran: "Iran",
    Iraq: "Irak",
    "Ivory Coast": "Côte d'Ivoire",
    Japan: "Japon",
    Jordan: "Jordanie",
    Mexico: "Mexique",
    Morocco: "Maroc",
    Netherlands: "Pays-Bas",
    "New Zealand": "Nouvelle-Zélande",
    Norway: "Norvège",
    Panama: "Panama",
    Paraguay: "Paraguay",
    Portugal: "Portugal",
    Qatar: "Qatar",
    "Saudi Arabia": "Arabie saoudite",
    Scotland: "Écosse",
    Senegal: "Sénégal",
    "South Africa": "Afrique du Sud",
    "South Korea": "Corée du Sud",
    Spain: "Espagne",
    Sweden: "Suède",
    Switzerland: "Suisse",
    Tunisia: "Tunisie",
    Turkey: "Turquie",
    "United States": "États-Unis",
    Uruguay: "Uruguay",
    Uzbekistan: "Ouzbékistan",
  }),
);

function frenchLabel(label) {
  if (frenchTeams.has(label)) return frenchTeams.get(label);
  return label
    .replace(/^Winner Match (\d+)$/, "Vainqueur match $1")
    .replace(/^Loser Match (\d+)$/, "Perdant match $1")
    .replace(/^Group ([A-L]) winners$/, "Vainqueur groupe $1")
    .replace(/^Group ([A-L]) runners-up$/, "Deuxième groupe $1")
    .replace(/^Group ([A-L](?:\/[A-L])*) third place$/, "3e groupe $1")
    .replaceAll(" vs ", " - ");
}

function sourceFor(label) {
  const winner = label.match(/^Winner Match (\d+)$/);
  if (winner) return { text: frenchLabel(label), sourceText: label, matchNo: Number(winner[1]), outcome: "winner" };
  const loser = label.match(/^Loser Match (\d+)$/);
  if (loser) return { text: frenchLabel(label), sourceText: label, matchNo: Number(loser[1]), outcome: "loser" };
  return { text: frenchLabel(label), sourceText: label, matchNo: null, outcome: null };
}

const starts = [...html.matchAll(/<div class="match" id="match-(\d+)">/g)].map((match) => ({
  index: match.index,
  matchNo: Number(match[1]),
}));

const matches = starts.map((start, i) => {
  const next = starts[i + 1]?.index ?? html.indexOf("<section class=\"section\"", start.index);
  const block = html.slice(start.index, next);
  const badge = text(block.match(/<span class="round-badge[^"]*">([\s\S]*?)<\/span>/)?.[1] ?? "");
  const teams = [...block.matchAll(/<span class="tn">([\s\S]*?)<\/span>/g)].map((m) => text(m[1]));
  const timeMatch = block.match(/<time datetime="([^"]+)">([\s\S]*?)<\/time>/);
  const venue = text(block.match(/<span class="venue">([\s\S]*?)<\/span>/)?.[1] ?? "");
  const group = badge.startsWith("Group ") ? badge.replace("Group ", "") : null;
  const sideA = sourceFor(teams[0]);
  const sideB = sourceFor(teams[1]);

  return {
    matchNo: start.matchNo,
    round: roundKey(badge),
    roundLabel: badge,
    group,
    sideA,
    sideB,
    kickoffUtc: timeMatch?.[1] ?? null,
    kickoffLabel: text(timeMatch?.[2] ?? ""),
    venue,
  };
});

if (matches.length !== 104) {
  throw new Error(`Expected 104 matches, got ${matches.length}`);
}

const groupMatches = matches.filter((match) => match.round === "group");
const teamMap = new Map();
for (const match of groupMatches) {
  for (const side of [match.sideA.text, match.sideB.text]) {
    const key = `${match.group}:${side}`;
    if (!teamMap.has(key)) {
      teamMap.set(key, {
        sourceName: side,
        name: frenchLabel(side),
        group: match.group,
      });
    }
  }
}

const teams = [...teamMap.values()].sort((a, b) => {
  if (a.group === b.group) return a.name.localeCompare(b.name);
  return a.group.localeCompare(b.group);
});

const seed = {
  source: {
    fetchedFrom: "https://worldcuply.com/schedule.html",
    officialReference: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums",
    fetchedAt: new Date().toISOString(),
  },
  tournament: {
    slug: "world-cup-2026",
    name: "FIFA World Cup 2026",
    shortName: "Coupe du monde 2026",
    year: 2026,
    phase: 0,
    groupBetDeadline: "2026-06-11T19:00:00+00:00",
    knockoutBetDeadline: "2026-06-28T19:00:00+00:00",
  },
  teams,
  matches,
};

fs.writeFileSync(outPath, JSON.stringify(seed, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath} with ${teams.length} teams and ${matches.length} matches.`);
