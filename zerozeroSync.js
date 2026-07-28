const TEAMS = [
  { level: "Sub13", zerozeroId: "333814", label: "Casa Pia AC Fut.9 Feminino Jun.D S13" },
  { level: "Sub15", zerozeroId: "332517", label: "Casa Pia AC Feminino Jun.C S15" },
  { level: "Sub17", zerozeroId: "359808", label: "Casa Pia AC Feminino Jun.B S17" },
  { level: "Sub19", zerozeroId: "359807", label: "Casa Pia AC Feminino Jun.A S19" },
];

const EPOCA_IDS = {
  "2024/2025": "154",
  "2025/2026": "155",
  "2026/2027": "156",
  "2027/2028": "157",
};

function currentSeasonLabel() {
  const now = new Date();
  const year = now.getFullYear();
  const startYear = now.getMonth() >= 6 ? year : year - 1;
  return `${startYear}/${startYear + 1}`;
}

function seasonRange(fromSeason, toSeason = currentSeasonLabel()) {
  const from = Number(String(fromSeason).slice(0, 4));
  const to = Number(String(toSeason).slice(0, 4));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return [fromSeason];
  return Array.from({ length: to - from + 1 }, (_, index) => {
    const start = from + index;
    return `${start}/${start + 1}`;
  });
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, number) => String.fromCharCode(Number(number)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function cells(row) {
  const out = [];
  const re = /<td\b[^>]*>([\s\S]*?)<\/td>/g;
  let match;
  while ((match = re.exec(row))) out.push(match[1]);
  return out;
}

function parseMatches(html, team, epocaId) {
  const matches = [];
  const rowRe = /<tr data-lj="[^"]*" id="([^"]+)" class="parent">([\s\S]*?)<\/tr>/g;
  let row;
  while ((row = rowRe.exec(html))) {
    const columns = cells(row[2]);
    if (columns.length < 9) continue;
    const date = stripTags(columns[1]);
    const time = stripTags(columns[2]);
    const venueMark = stripTags(columns[3]);
    const opponent = stripTags(columns[5]);
    const resultText = stripTags(columns[6]).replace(/\(.*?\)/g, "").trim();
    const competition = stripTags(columns[7]);
    const round = stripTags(columns[8]);
    const score = resultText.match(/(\d+)\s*-\s*(\d+)/);
    const home = venueMark.includes("C");
    const away = venueMark.includes("F");
    const goalsA = score ? Number(score[1]) : null;
    const goalsB = score ? Number(score[2]) : null;
    matches.push({
      id: `zz_${team.level}_${row[1]}`,
      zerozeroMatchId: row[1],
      opponent,
      round,
      venue: home ? "Casa" : away ? "Fora" : "Neutro",
      level: team.level,
      season: Object.entries(EPOCA_IDS).find(([, id]) => id === String(epocaId))?.[0] || String(epocaId),
      competition,
      date,
      time,
      goalsFor: score ? (home ? goalsA : goalsB) : null,
      goalsAgainst: score ? (home ? goalsB : goalsA) : null,
      status: score ? "finished" : "scheduled",
      source: "ZEROZERO",
      sourceUrl: `https://www.zerozero.pt/equipa/casa-pia-ac/${team.zerozeroId}/jogos?epoca_id=${epocaId}`,
    });
  }
  return matches;
}

async function fetchTeam(team, epocaId) {
  const url = `https://www.zerozero.pt/equipa/casa-pia-ac/${team.zerozeroId}/jogos?epoca_id=${epocaId}`;
  const response = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": "CasaPiaACLive/1.0 resultados-clube",
    },
  });
  if (!response.ok) throw new Error(`ZeroZero ${team.level} respondeu ${response.status}`);
  const charset = response.headers.get("content-type")?.match(/charset=([^;]+)/i)?.[1] || "utf-8";
  const html = new TextDecoder(charset).decode(await response.arrayBuffer());
  return parseMatches(html, team, epocaId);
}

export async function fetchZerozeroMatches({ season = "2025/2026", levels = [] } = {}) {
  const epocaId = EPOCA_IDS[season] || season;
  const wanted = new Set(levels.filter(Boolean));
  const teams = wanted.size ? TEAMS.filter((team) => wanted.has(team.level)) : TEAMS;
  const matches = [];
  for (const team of teams) {
    matches.push(...(await fetchTeam(team, epocaId)));
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return {
    season,
    epocaId,
    matches: matches.sort((a, b) => `${a.level}${a.date}${a.time}`.localeCompare(`${b.level}${b.date}${b.time}`)),
  };
}

export async function syncZerozeroResults(db, options = {}) {
  const { dryRun = false, updateResults = true, season = "2025/2026", levels = [], untilCurrent = false } = options;
  const seasons = untilCurrent ? seasonRange(season) : [season];
  const results = [];
  for (const item of seasons) {
    results.push(await fetchZerozeroMatches({ season: item, levels }));
  }
  const matches = results.flatMap((result) => result.matches);
  const seasonsByLabel = Object.fromEntries(results.map((result) => [result.season, result.matches]));
  const nextDb = {
    ...db,
    zerozero: {
      matches,
      seasons: seasonsByLabel,
      lastSync: {
        ok: true,
        at: new Date().toISOString(),
        source: "ZEROZERO",
        season,
        seasons,
        epocaIds: results.map((result) => result.epocaId),
        fetched: matches.length,
        updatedResults: !dryRun && updateResults,
      },
    },
  };
  if (!dryRun && updateResults) {
    nextDb.matches = matches;
  }
  return {
    db: dryRun ? db : nextDb,
    matches,
    status: nextDb.zerozero.lastSync,
  };
}
