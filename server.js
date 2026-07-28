import http from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncZerozeroResults } from "./src/zerozero/zerozeroSync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, "outputs");
const SOURCE_DIR =
  process.env.CASA_PIA_SOURCE_DIR ||
  "C:/Users/catas/OneDrive - Universidade do Algarve/Ambiente de Trabalho/CASA PIA AC";
const SOURCE_XLSX =
  process.env.CASA_PIA_XLSX || path.join(SOURCE_DIR, "Casa pia.xlsx");
const DEFAULT_SOURCE_XLSX_URL =
  "https://docs.google.com/spreadsheets/d/1nQnhwHzXcjsOqRvEyl19ipSWQfxIaJ5O/export?format=xlsx";
const SOURCE_XLSX_URL = process.env.CASA_PIA_XLSX_URL || DEFAULT_SOURCE_XLSX_URL;
const AUTO_SYNC_MINUTES = Number(process.env.CASA_PIA_AUTO_SYNC_MINUTES || 0);
const ZEROZERO_AUTO_SYNC_MINUTES = Number(process.env.ZEROZERO_AUTO_SYNC_MINUTES || 0);
const ZEROZERO_AUTO_SYNC_SEASON = process.env.ZEROZERO_AUTO_SYNC_SEASON || "2024/2025";
const ZEROZERO_AUTO_SYNC_UNTIL_CURRENT = String(process.env.ZEROZERO_AUTO_SYNC_UNTIL_CURRENT || "1") === "1";
let lastSync = null;
let lastZerozeroSync = null;

async function spreadsheetTool() {
  try {
    return await import("@oai/artifact-tool");
  } catch {
    return null;
  }
}

async function xlsxTool() {
  try {
    return await import("xlsx");
  } catch {
    return null;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function cleanLevel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text.includes("13")) return "Sub13";
  if (text.includes("15")) return "Sub15";
  if (text.includes("17")) return "Sub17";
  if (text.includes("19")) return "Sub19";
  if (text.includes("senior")) return "Seniores";
  return String(value || "").trim();
}

function pick(record, keys) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return null;
}

function playerId(level, name) {
  return `${level}_${String(name)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")}`;
}

function playerKey(name) {
  return String(name || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugKey(value) {
  return playerKey(value).replace(/\s+/g, "_");
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function buildPlayerHistory(values) {
  const headers = (values[0] || []).map((header) => String(header || "").trim());
  const byPlayer = new Map();
  for (const row of values.slice(1)) {
    const record = Object.fromEntries(headers.map((header, index) => [header || `col${index}`, row[index] ?? ""]));
    const name = String(pick(record, ["Jogadoras", "Jogadora", "Nome"]) || "").trim();
    const opponent = String(pick(record, ["Equipa Adversária", "Equipa Adversaria", "Adversário", "Adversario"]) || "").trim();
    if (!name || !opponent) continue;
    const item = {
      opponent,
      season: String(pick(record, ["Época", "Epoca", "Temporada", "Season"]) || "").trim(),
      role: String(pick(record, ["Papel", "Função", "Funcao"]) || "").trim() || "-",
      minutes: pick(record, ["Tempo de Jogo (min)", "Minutos", "Tempo de Jogo"]) ?? "",
      yellows: numberValue(pick(record, ["Cartões Amarelos", "Cartoes Amarelos", "Amarelos"])),
      reds: numberValue(pick(record, ["Cartões Vermelhos", "Cartoes Vermelhos", "Vermelhos"])),
      goals: numberValue(pick(record, ["Golos", "Golos Marcados"])),
      assists: numberValue(pick(record, ["Assistências", "Assistencias", "Assist."])),
    };
    const key = playerKey(name);
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key).push(item);
  }
  return byPlayer;
}

async function sheetValues(workbook, sheetName) {
  const sheet = workbook.worksheets.getItem(sheetName);
  return sheet.getUsedRange(true).values;
}

async function importWorkbook() {
  const buffer = await readFile(SOURCE_XLSX);
  return importWorkbookBuffer(buffer, SOURCE_XLSX);
}

async function importWorkbookLegacy() {
  const tool = await spreadsheetTool();
  if (!tool) {
    throw new Error("Importação XLSX indisponível neste ambiente. Usa um data/db.json já criado ou instala a ferramenta de spreadsheet.");
  }
  const { FileBlob, SpreadsheetFile } = tool;
  const input = await FileBlob.load(SOURCE_XLSX);
  const workbook = await SpreadsheetFile.importXlsx(input);
  const rows = await sheetValues(workbook, "TUDO");
  const headers = rows[0].map((h) => String(h || ""));

  const matches = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== null && cell !== ""))
    .map((row, index) => {
      const record = Object.fromEntries(headers.map((h, i) => [h || `col${i}`, row[i] ?? null]));
      const goalsFor = record["Golos Marcados"];
      const goalsAgainst = record["Golos Sofridos"];
      return {
        id: record.ID_Jogo || `jogo_${index + 1}`,
        opponent: record["Equipa Adv"] || "",
        round: record.Jornada || "",
        venue: record.Local || "",
        level: cleanLevel(pick(record, ["Escalão", "Escalão"])),
        competition: pick(record, ["Competição", "Competicao"]) || "",
        goalsFor: goalsFor ?? null,
        goalsAgainst: goalsAgainst ?? null,
        status: goalsFor === null || goalsAgainst === null ? "scheduled" : "finished",
      };
    });

  const rosterSheets = {
    Sub19: "Jogardoras SUB19",
    Sub17: "Jogadoras SUB17",
    Sub15: "Jogadoras SUB15",
    Sub13: "Jogadoras SUB13",
  };
  const players = [];

  for (const [level, sheetName] of Object.entries(rosterSheets)) {
    const values = await sheetValues(workbook, sheetName);
    const historyByPlayer = buildPlayerHistory(values);
    const seen = new Set();
    for (const row of values.slice(1)) {
      const name = String(row[1] || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const key = playerKey(name);
      players.push({ id: playerId(level, name), level, name, number: "", position: "", history: historyByPlayer.get(key) || [] });
    }
  }

  const liveMatch = matches.find((m) => m.status === "scheduled") || matches[0];
  return {
    meta: {
      club: "Casa Pia AC",
      createdAt: new Date().toISOString(),
      sourceDir: SOURCE_DIR,
      sourceWorkbook: SOURCE_XLSX,
    },
    teams: [
      { level: "Sub13", format: 7, label: "Sub13 Futebol 7" },
      { level: "Sub15", format: 9, label: "Sub15 Futebol 9" },
      { level: "Sub17", format: 11, label: "Sub17 Futebol 11" },
      { level: "Sub19", format: 11, label: "Sub19 Futebol 11" },
    ],
    players,
    matches,
    matchReports: {},
    live: liveMatch
      ? {
          matchId: liveMatch.id,
          period: "Pre-jogo",
          homeScore: liveMatch.goalsFor ?? 0,
          awayScore: liveMatch.goalsAgainst ?? 0,
          status: liveMatch.status === "finished" ? "Terminado" : "Por iniciar",
          liveEnded: liveMatch.status === "finished",
          cornersFor: 0,
          cornersAgainst: 0,
          updatedAt: new Date().toISOString(),
        }
      : null,
    events: [],
  };
}

async function importWorkbookBuffer(buffer, filename = "upload.xlsx") {
  const XLSX = await xlsxTool();
  if (!XLSX) {
    throw new Error("Importacao XLSX indisponivel. Executa npm install para instalar a dependencia xlsx.");
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetRows = (sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    return sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) : [];
  };
  const photoRows = sheetRows("Plantel");
  const photoMap = new Map();
  for (const row of photoRows.slice(1)) {
    const name = String(row[0] || "").trim();
    const photoUrl = String(row[2] || "").trim().replaceAll("&amp;", "&");
    if (name && photoUrl) photoMap.set(playerKey(name), photoUrl);
  }

  const rows = sheetRows("TUDO");
  if (!rows.length) throw new Error("O Excel importado nao tem a folha TUDO.");
  const headers = rows[0].map((h) => String(h || ""));

  const matches = rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== null && cell !== ""))
    .map((row, index) => {
      const record = Object.fromEntries(headers.map((h, i) => [h || `col${i}`, row[i] ?? null]));
      const goalsFor = record["Golos Marcados"];
      const goalsAgainst = record["Golos Sofridos"];
      return {
        id: record.ID_Jogo || `jogo_${index + 1}`,
        opponent: record["Equipa Adv"] || "",
        round: record.Jornada || "",
        venue: record.Local || "",
        level: cleanLevel(pick(record, ["Escalão", "Escalao"])),
        competition: pick(record, ["Competição", "Competicao"]) || "",
        goalsFor: goalsFor ?? null,
        goalsAgainst: goalsAgainst ?? null,
        status: goalsFor === null || goalsAgainst === null ? "scheduled" : "finished",
      };
    });

  const rosterSheets = {
    Sub19: "Jogardoras SUB19",
    Sub17: "Jogadoras SUB17",
    Sub15: "Jogadoras SUB15",
    Sub13: "Jogadoras SUB13",
  };
  const players = [];

  for (const [level, sheetName] of Object.entries(rosterSheets)) {
    const values = sheetRows(sheetName);
    const historyByPlayer = buildPlayerHistory(values);
    const seen = new Set();
    for (const row of values.slice(1)) {
      const name = String(row[1] || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const key = playerKey(name);
      players.push({
        id: playerId(level, name),
        level,
        name,
        number: "",
        position: "",
        photoUrl: photoMap.get(key) || "",
        history: historyByPlayer.get(key) || [],
      });
    }
  }

  const liveMatch = matches.find((m) => m.status === "scheduled") || matches[0];
  return {
    meta: {
      club: "Casa Pia AC",
      createdAt: new Date().toISOString(),
      sourceDir: SOURCE_DIR,
      sourceWorkbook: filename,
    },
    teams: [
      { level: "Sub13", format: 7, label: "Sub13 Futebol 7" },
      { level: "Sub15", format: 9, label: "Sub15 Futebol 9" },
      { level: "Sub17", format: 11, label: "Sub17 Futebol 11" },
      { level: "Sub19", format: 11, label: "Sub19 Futebol 11" },
    ],
    players,
    matches,
    matchReports: {},
    live: liveMatch
      ? {
          matchId: liveMatch.id,
          period: "Pre-jogo",
          homeScore: liveMatch.goalsFor ?? 0,
          awayScore: liveMatch.goalsAgainst ?? 0,
          status: liveMatch.status === "finished" ? "Terminado" : "Por iniciar",
          liveEnded: liveMatch.status === "finished",
          cornersFor: 0,
          cornersAgainst: 0,
          updatedAt: new Date().toISOString(),
        }
      : null,
    events: [],
  };
}

function preserveAppData(imported, current) {
  return {
    ...imported,
    events: current.events || [],
    matchReports: current.matchReports || {},
    liveGames: current.liveGames || {},
    hiddenLiveGames: current.hiddenLiveGames || [],
    zerozero: current.zerozero || imported.zerozero || {},
    live: current.live || imported.live,
  };
}

async function importWorkbookUrl(url = SOURCE_XLSX_URL) {
  if (!url) throw new Error("CASA_PIA_XLSX_URL nao esta configurado.");
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Nao foi possivel descarregar o Excel (${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return importWorkbookBuffer(buffer, url);
}

async function syncFromConfiguredUrl(currentDb) {
  const imported = await importWorkbookUrl();
  const db = preserveAppData(imported, currentDb);
  db.meta.importedAt = new Date().toISOString();
  db.meta.syncMode = "url";
  db.meta.sourceWorkbookUrl = SOURCE_XLSX_URL;
  await saveDb(db);
  lastSync = { ok: true, at: db.meta.importedAt, source: "url" };
  return db;
}

async function seedPersistentDb() {
  if (await exists(DB_PATH)) return;
  const bundledDb = path.join(__dirname, "data", "db.json");
  if (bundledDb !== DB_PATH && (await exists(bundledDb))) {
    const seed = await readFile(bundledDb, "utf8");
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(DB_PATH, seed, "utf8");
  }
}

async function loadDb() {
  await mkdir(DATA_DIR, { recursive: true });
  await seedPersistentDb();
  if (!(await exists(DB_PATH))) {
    if (SOURCE_XLSX_URL) {
      const imported = await importWorkbookUrl();
      await writeFile(DB_PATH, JSON.stringify(imported, null, 2), "utf8");
      return imported;
    }
    if (!(await exists(SOURCE_XLSX))) {
      throw new Error(`Base de dados não encontrada em ${DB_PATH}. Publica o ficheiro data/db.json ou configura CASA_PIA_XLSX.`);
    }
    const imported = await importWorkbook();
    await writeFile(DB_PATH, JSON.stringify(imported, null, 2), "utf8");
    return imported;
  }
  const text = await readFile(DB_PATH, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function saveDb(db) {
  db.meta.updatedAt = new Date().toISOString();
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function send(res, status, payload, type = "application/json; charset=utf-8") {
  const body = typeof payload === "string" || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function notFound(res) {
  send(res, 404, { error: "Não encontrado" });
}

function currentMatch(db) {
  return db.matches.find((match) => match.id === db.live?.matchId) || null;
}

function ensureLiveGames(db) {
  db.liveGames ||= {};
  if (db.live?.matchId) {
    db.liveGames[db.live.matchId] ||= db.live;
  }
  return db.liveGames;
}

function applyEventToLive(db, event) {
  ensureLiveGames(db);
  const live = db.liveGames[event.matchId] || db.live;
  if (!live) return;
  if (event.team === "Casa Pia" && event.type === "Golo") live.homeScore += 1;
  if (event.team === "Adversário" && event.type === "Golo") live.awayScore += 1;
  if (event.team === "Casa Pia" && event.type === "Canto") live.cornersFor += 1;
  if (event.team === "Adversário" && event.type === "Canto") live.cornersAgainst += 1;
  if (!live.liveEnded) live.status = live.status || "Em direto";
  live.period = event.period || live.period || "Jogo";
  live.updatedAt = new Date().toISOString();
  db.liveGames[event.matchId] = live;
  if (db.live?.matchId === event.matchId) db.live = live;
}

function recomputeLiveFromEvents(db, matchId) {
  const live = (db.liveGames || {})[matchId] || (db.live?.matchId === matchId ? db.live : null);
  if (!live) return;
  live.homeScore = 0;
  live.awayScore = 0;
  live.cornersFor = 0;
  live.cornersAgainst = 0;
  db.events
    .filter((event) => event.matchId === matchId)
    .slice()
    .reverse()
    .forEach((event) => {
      if (event.team === "Casa Pia" && event.type === "Golo") live.homeScore += 1;
      if (event.team === "Adversário" && event.type === "Golo") live.awayScore += 1;
      if (event.team === "Casa Pia" && event.type === "Canto") live.cornersFor += 1;
      if (event.team === "Adversário" && event.type === "Canto") live.cornersAgainst += 1;
    });
  live.updatedAt = new Date().toISOString();
  db.liveGames ||= {};
  db.liveGames[matchId] = live;
  if (db.live?.matchId === matchId) db.live = live;
}

async function exportXlsx(db) {
  const tool = await spreadsheetTool();
  if (!tool) {
    const filename = `casa-pia-registos-${new Date().toISOString().slice(0, 10)}.json`;
    const target = path.join(OUTPUT_DIR, filename);
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(target, JSON.stringify(db, null, 2), "utf8");
    return { filename, href: `/outputs/${filename}`, path: target };
  }
  const { SpreadsheetFile, Workbook } = tool;
  await mkdir(OUTPUT_DIR, { recursive: true });
  const workbook = Workbook.create();

  const jogos = workbook.worksheets.add("Jogos");
  jogos.getRange("A1:H1").values = [["ID_Jogo", "Escalão", "Competição", "Adversário", "Local", "Jornada", "Golos CP", "Golos Adv"]];
  jogos.getRangeByIndexes(1, 0, db.matches.length, 8).values = db.matches.map((m) => [
    m.id,
    m.level,
    m.competition,
    m.opponent,
    m.venue,
    m.round,
    m.goalsFor,
    m.goalsAgainst,
  ]);

  const atletas = workbook.worksheets.add("Jogadoras");
  atletas.getRange("A1:E1").values = [["ID", "Escalão", "Nome", "Número", "Posição"]];
  atletas.getRangeByIndexes(1, 0, db.players.length, 5).values = db.players.map((p) => [p.id, p.level, p.name, p.number, p.position]);

  const eventos = workbook.worksheets.add("Eventos");
  eventos.getRange("A1:L1").values = [["Data", "ID_Jogo", "Período", "Tipo", "Equipa", "Jogadora", "Assistência", "Sai", "Entra", "Cantos CP", "Cantos Adv", "Notas"]];
  if (db.events.length) {
    eventos.getRangeByIndexes(1, 0, db.events.length, 12).values = db.events.map((e) => [
      e.createdAt,
      e.matchId,
      e.period,
      e.type,
      e.team,
      e.playerName,
      e.assistName,
      e.outPlayerName,
      e.inPlayerName,
      e.cornersFor,
      e.cornersAgainst,
      e.notes,
    ]);
  }

  const relatorios = workbook.worksheets.add("Relatorios");
  relatorios.getRange("A1:H1").values = [["ID_Jogo", "Tática", "Titulares", "Suplentes", "Notas", "Criado", "Atualizado", "Delegado"]];
  const reports = Object.entries(db.matchReports);
  if (reports.length) {
    relatorios.getRangeByIndexes(1, 0, reports.length, 8).values = reports.map(([matchId, report]) => [
      matchId,
      report.tactic || "",
      (report.starters || []).join(", "),
      (report.bench || []).join(", "),
      report.notes || "",
      report.createdAt || "",
      report.updatedAt || "",
      report.delegate || "",
    ]);
  }

  for (const sheet of [jogos, atletas, eventos, relatorios]) {
    sheet.getRange("A1:Z1").format = { fill: "#111111", font: { color: "#FFFFFF", bold: true } };
    sheet.freezePanes.freezeRows(1);
    sheet.getUsedRange().format.autofitColumns();
  }

  const filename = `casa-pia-registos-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const target = path.join(OUTPUT_DIR, filename);
  const file = await SpreadsheetFile.exportXlsx(workbook);
  await file.save(target);
  return { filename, href: `/outputs/${filename}`, path: target };
}

async function api(req, res, url) {
  let db = await loadDb();

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    ensureLiveGames(db);
    db.hiddenLiveGames ||= [];
    send(res, 200, { ...db, currentMatch: currentMatch(db) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reload-source") {
    db = preserveAppData(await importWorkbook(), db);
    await saveDb(db);
    send(res, 200, { ...db, currentMatch: currentMatch(db) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import-xlsx") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const filename = req.headers["x-filename"] || "upload.xlsx";
    db = preserveAppData(await importWorkbookBuffer(Buffer.concat(chunks), filename), db);
    db.meta.importedAt = new Date().toISOString();
    await saveDb(db);
    send(res, 200, { ...db, currentMatch: currentMatch(db) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync-excel-url") {
    db = await syncFromConfiguredUrl(db);
    send(res, 200, { ...db, currentMatch: currentMatch(db), sync: lastSync });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/sync-status") {
    send(res, 200, {
      configured: Boolean(SOURCE_XLSX_URL),
      autoSyncMinutes: AUTO_SYNC_MINUTES,
      lastSync,
      zerozero: {
        configured: true,
        autoSyncMinutes: ZEROZERO_AUTO_SYNC_MINUTES,
        autoSyncSeason: ZEROZERO_AUTO_SYNC_SEASON,
        untilCurrent: ZEROZERO_AUTO_SYNC_UNTIL_CURRENT,
        lastSync: lastZerozeroSync || db.zerozero?.lastSync || null,
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/results") {
    send(res, 200, {
      current: db.matches || [],
      zerozero: db.zerozero?.matches || [],
      zerozeroStatus: lastZerozeroSync || db.zerozero?.lastSync || null,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync-zerozero") {
    const body = await readBody(req);
    try {
      const result = await syncZerozeroResults(db, {
        dryRun: Boolean(body.dryRun),
        updateResults: body.updateResults !== false,
        season: body.season || body.seasonId || "2025/2026",
        untilCurrent: Boolean(body.untilCurrent),
        levels: Array.isArray(body.levels) ? body.levels : [],
      });
      db = result.db;
      lastZerozeroSync = result.status;
      if (!body.dryRun) await saveDb(db);
      send(res, 200, { ...db, currentMatch: currentMatch(db), status: result.status, zerozero: db.zerozero || {} });
    } catch (error) {
      lastZerozeroSync = {
        ok: false,
        at: new Date().toISOString(),
        source: "ZEROZERO",
        blocked: /403|429|401|bloque/i.test(error.message || ""),
        error: error.message || "Erro na sincronização ZeroZero",
      };
      send(res, 200, { status: lastZerozeroSync, zerozero: db.zerozero || {} });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/live") {
    const body = await readBody(req);
    db.live = { ...(db.live || {}), ...body, updatedAt: new Date().toISOString() };
    if (!db.live.status) db.live.status = "Em direto";
    ensureLiveGames(db);
    db.hiddenLiveGames = (db.hiddenLiveGames || []).filter((id) => id !== db.live.matchId);
    if (db.live.matchId) {
      db.liveGames[db.live.matchId] = db.live;
    }
    await saveDb(db);
    send(res, 200, { live: db.live, currentMatch: currentMatch(db) });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/live/")) {
    const matchId = decodeURIComponent(url.pathname.replace("/api/live/", ""));
    ensureLiveGames(db);
    delete db.liveGames[matchId];
    db.hiddenLiveGames ||= [];
    if (!db.hiddenLiveGames.includes(matchId)) db.hiddenLiveGames.push(matchId);
    if (db.live?.matchId === matchId) {
      db.live = { ...db.live, status: "Por iniciar", period: "Pre-jogo", liveEnded: false, updatedAt: new Date().toISOString() };
    }
    await saveDb(db);
    send(res, 200, { liveGames: db.liveGames });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/report") {
    const body = await readBody(req);
    if (body.clear) {
      delete db.matchReports[body.matchId];
    } else {
      const existing = db.matchReports[body.matchId] || {};
      db.matchReports[body.matchId] = {
        ...existing,
        ...body,
        updatedAt: new Date().toISOString(),
        createdAt: existing.createdAt || new Date().toISOString(),
      };
    }
    await saveDb(db);
    send(res, 200, { report: db.matchReports[body.matchId] || null });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/events") {
    const body = await readBody(req);
    const event = {
      id: `evt_${Date.now()}`,
      matchId: body.matchId || db.live?.matchId,
      period: body.period || db.live?.period || "Jogo",
      type: body.type,
      team: body.team || "Casa Pia",
      playerId: body.playerId || "",
      playerName: body.playerName || "",
      assistId: body.assistId || "",
      assistName: body.assistName || "",
      outPlayerId: body.outPlayerId || "",
      outPlayerName: body.outPlayerName || "",
      inPlayerId: body.inPlayerId || "",
      inPlayerName: body.inPlayerName || "",
      cornersFor: db.live?.cornersFor || 0,
      cornersAgainst: db.live?.cornersAgainst || 0,
      notes: body.notes || "",
      createdAt: new Date().toISOString(),
    };
    db.events.unshift(event);
    applyEventToLive(db, event);
    event.cornersFor = db.live?.cornersFor || 0;
    event.cornersAgainst = db.live?.cornersAgainst || 0;
    await saveDb(db);
    send(res, 201, { event, live: db.live });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/events/")) {
    const eventId = decodeURIComponent(url.pathname.replace("/api/events/", ""));
    const removed = db.events.find((event) => event.id === eventId);
    const before = db.events.length;
    db.events = db.events.filter((event) => event.id !== eventId);
    if (removed?.matchId) recomputeLiveFromEvents(db, removed.matchId);
    await saveDb(db);
    send(res, 200, { deleted: before - db.events.length, events: db.events });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/manual-match") {
    const body = await readBody(req);
    const level = cleanLevel(body.level || "Sub13");
    const season = String(body.season || "").trim();
    const competition = String(body.competition || "").trim();
    const opponent = String(body.opponent || "").trim();
    if (!competition || !opponent) {
      send(res, 400, { error: "Indica pelo menos competição e adversário." });
      return;
    }
    const goalsFor = body.goalsFor === "" || body.goalsFor === null || body.goalsFor === undefined ? null : Number(body.goalsFor);
    const goalsAgainst = body.goalsAgainst === "" || body.goalsAgainst === null || body.goalsAgainst === undefined ? null : Number(body.goalsAgainst);
    const id = body.id || `manual_${level}_${slugKey(`${season}_${competition}_${opponent}_${body.round || ""}_${body.venue || ""}`)}`;
    const match = {
      id,
      opponent,
      round: String(body.round || "").trim(),
      venue: String(body.venue || "").trim() || "Casa",
      level,
      season,
      competition,
      date: String(body.date || "").trim(),
      time: String(body.time || "").trim(),
      goalsFor,
      goalsAgainst,
      status: goalsFor === null || goalsAgainst === null ? "scheduled" : "finished",
      source: "MANUAL",
      updatedAt: new Date().toISOString(),
    };
    const index = db.matches.findIndex((item) => item.id === id);
    if (index >= 0) db.matches[index] = { ...db.matches[index], ...match };
    else db.matches.push(match);
    db.matches.sort((a, b) => `${a.season || ""}${a.level}${a.date || ""}${a.time || ""}`.localeCompare(`${b.season || ""}${b.level}${b.date || ""}${b.time || ""}`));
    await saveDb(db);
    send(res, 200, { ...db, currentMatch: currentMatch(db), manualMatch: match });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export") {
    const exported = await exportXlsx(db);
    send(res, 200, exported);
    return;
  }

  notFound(res);
}

async function staticFile(req, res, url) {
  let relative = decodeURIComponent(url.pathname);
  if (relative === "/") relative = "/index.html";
  const root = relative.startsWith("/outputs/") ? OUTPUT_DIR : path.join(__dirname, "public");
  const file = relative.startsWith("/outputs/")
    ? path.join(root, relative.replace("/outputs/", ""))
    : path.join(root, relative);

  if (!file.startsWith(root)) {
    notFound(res);
    return;
  }

  try {
    const body = await readFile(file);
    send(res, 200, body, MIME[path.extname(file)] || "application/octet-stream");
  } catch {
    notFound(res);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else await staticFile(req, res, url);
  } catch (error) {
    console.error(error);
    send(res, 500, { error: error.message || "Erro no servidor" });
  }
});

function startAutoSync() {
  if (!SOURCE_XLSX_URL || !AUTO_SYNC_MINUTES) return;
  const run = async () => {
    try {
      const db = await loadDb();
      await syncFromConfiguredUrl(db);
      console.log(`Excel sincronizado em ${lastSync.at}`);
    } catch (error) {
      lastSync = { ok: false, at: new Date().toISOString(), error: error.message || "Erro na sincronização" };
      console.error("Falha na sincronização Excel:", error);
    }
  };
  setTimeout(run, 5000);
  setInterval(run, AUTO_SYNC_MINUTES * 60 * 1000);
}

function startZerozeroAutoSync() {
  if (!ZEROZERO_AUTO_SYNC_MINUTES) return;
  const run = async () => {
    try {
      const db = await loadDb();
      const result = await syncZerozeroResults(db, {
        season: ZEROZERO_AUTO_SYNC_SEASON,
        untilCurrent: ZEROZERO_AUTO_SYNC_UNTIL_CURRENT,
        updateResults: true,
      });
      lastZerozeroSync = result.status;
      await saveDb(result.db);
      console.log(`ZeroZero sincronizado em ${lastZerozeroSync.at}`);
    } catch (error) {
      lastZerozeroSync = { ok: false, at: new Date().toISOString(), error: error.message || "Erro na sincronização ZeroZero" };
      console.error("Falha na sincronização ZeroZero:", error);
    }
  };
  setTimeout(run, 12000);
  setInterval(run, ZEROZERO_AUTO_SYNC_MINUTES * 60 * 1000);
}

server.listen(PORT, () => {
  console.log(`Casa Pia Live disponível em http://localhost:${PORT}`);
  console.log(`Fonte de dados: ${SOURCE_DIR}`);
  if (SOURCE_XLSX_URL) console.log(`Sincronização Excel URL ativa: ${AUTO_SYNC_MINUTES || "manual"} min`);
  if (ZEROZERO_AUTO_SYNC_MINUTES) console.log(`Sincronização ZeroZero ativa: ${ZEROZERO_AUTO_SYNC_MINUTES} min`);
  startAutoSync();
  startZerozeroAutoSync();
});
