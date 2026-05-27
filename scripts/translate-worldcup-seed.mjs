import fs from "node:fs";

const path = "data/worldcup-2026.json";
const seed = JSON.parse(fs.readFileSync(path, "utf8"));
const map = new Map(
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

function fr(label) {
  if (map.has(label)) return map.get(label);
  return label
    .replace(/^Winner Match (\d+)$/, "Vainqueur match $1")
    .replace(/^Loser Match (\d+)$/, "Perdant match $1")
    .replace(/^Group ([A-L]) winners$/, "Vainqueur groupe $1")
    .replace(/^Group ([A-L]) runners-up$/, "Deuxième groupe $1")
    .replace(/^Group ([A-L](?:\/[A-L])*) third place$/, "3e groupe $1");
}

seed.tournament.shortName = "Coupe du monde 2026";
seed.teams = seed.teams.map((team) => {
  const sourceName = team.sourceName || team.name;
  return { sourceName, name: fr(sourceName), group: team.group };
});

for (const match of seed.matches) {
  for (const side of [match.sideA, match.sideB]) {
    const sourceText = side.sourceText || side.text;
    side.sourceText = sourceText;
    side.text = fr(sourceText);
  }
}

fs.writeFileSync(path, JSON.stringify(seed, null, 2) + "\n", "utf8");
console.log(`Translated ${seed.teams.length} teams and ${seed.matches.length} matches.`);
