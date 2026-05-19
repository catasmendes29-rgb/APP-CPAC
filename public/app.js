const state = {
  db: null,
  level: "Sub13",
  dataLevel: "Sub13",
  selectedMatch: null,
  starters: new Set(),
  bench: new Set(),
  lineupSlots: [],
  selectedSlot: null,
  pickerMode: "starter",
  user: JSON.parse(localStorage.getItem("cpacUser") || "null"),
  liveDetailMatchId: null,
  competitionFilter: "all",
  teamsLevel: "Sub13",
  selectedPlayerId: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const viewTitles = { data: "Resultados", teams: "Equipas", delegate: "Delegado", live: "Live" };

async function request(route, options = {}) {
  const response = await fetch(route, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function option(label, value = label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function activeTeam() {
  return state.db.teams.find((team) => team.level === state.level) || state.db.teams[0];
}

function levelPlayers(level = state.level) {
  return state.db.players
    .filter((player) => player.level === level)
    .sort((a, b) => a.name.localeCompare(b.name, "pt", { sensitivity: "base" }));
}

function levelMatches(level = state.level) {
  return state.db.matches.filter((match) => match.level === level);
}

function openMatches(level = state.level) {
  return levelMatches(level).filter((match) => match.goalsFor === null || match.goalsAgainst === null || match.status === "scheduled");
}

function matchById(id) {
  return state.db.matches.find((match) => match.id === id);
}

function currentMatch() {
  return matchById(state.liveDetailMatchId || state.db.live?.matchId) || state.selectedMatch || state.db.matches[0];
}

function selectedReport() {
  return state.db.matchReports[state.selectedMatch?.id] || {};
}

function canDelegate() {
  return state.user?.role === "delegate" || state.user?.role === "admin";
}

function isAdmin() {
  return state.user?.role === "admin";
}

function reportRosterNames() {
  const report = selectedReport();
  return [...(report.starters || []), ...(report.bench || [])].filter(Boolean);
}

function eventPlayers() {
  const names = new Set(reportRosterNames());
  return levelPlayers().filter((player) => names.has(player.name));
}

function setView(view) {
  if (view === "delegate" && !canDelegate()) {
    $(".delegate-tab").hidden = false;
  }
  $("#brandTitle").textContent = "Casa Pia AC";
  $("#pageTitle").textContent = viewTitles[view] || "Casa Pia AC";
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  $$(".view").forEach((section) => section.classList.toggle("active", section.id === view));
  if (view === "data") renderDataPage();
  if (view === "teams") renderTeamsPage();
  if (view === "live") renderLiveHub();
  renderAuth();
}

function renderAuth() {
  const logged = Boolean(state.user);
  $("#sessionLabel").textContent = logged ? `${state.user.name}${isAdmin() ? " · gestão" : ""}` : "Visitante";
  $("#loginOpen").hidden = logged;
  $("#logoutBtn").hidden = !logged;
  $(".delegate-tab").hidden = !canDelegate();
  $("#loginGate").hidden = canDelegate();
  $("#delegateContent").hidden = !canDelegate();
  const syncPanel = $("#excelSyncPanel");
  if (syncPanel) syncPanel.hidden = !isAdmin();
}

function login(id, pass) {
  const normalized = id.trim().toLowerCase();
  if (normalized === "delegado" && pass === "0000") return { id: "Delegado", name: "Delegado", role: "delegate" };
  if (normalized === "catarina" && pass === "kikomiau") return { id: "Catarina", name: "Catarina", role: "admin" };
  return null;
}

function renderSelectors() {
  const levelSelect = $("#levelSelect");
  const dataLevelSelect = $("#dataLevelSelect");
  levelSelect.innerHTML = "";
  dataLevelSelect.innerHTML = "";

  state.db.teams.forEach((team) => {
    levelSelect.append(option(team.label, team.level));
    dataLevelSelect.append(option(team.label, team.level));
  });

  levelSelect.value = state.level;
  dataLevelSelect.value = state.dataLevel;

  const matches = openMatches();
  const matchSelect = $("#matchSelect");
  matchSelect.innerHTML = "";
  matches.forEach((match) => {
    matchSelect.append(option(`${match.competition} | ${match.opponent} (por jogar)`, match.id));
  });
  state.selectedMatch = matches.find((match) => match.id === state.selectedMatch?.id) || matches[0] || null;
  if (state.selectedMatch) matchSelect.value = state.selectedMatch.id;
}

function renderMatchCard() {
  const match = state.selectedMatch;
  $("#matchCard").innerHTML = match
    ? `<strong>${match.level} vs ${match.opponent}</strong><br>${match.competition}<br>${match.venue || "Local por definir"} · Jornada ${match.round || "-"}`
    : "Sem jogos por realizar neste escalão.";
}

function parseTactic() {
  const team = activeTeam();
  const raw = $("#tacticInput").value.trim();
  const fallback = team.format === 7 ? "1-3-2-1" : team.format === 9 ? "1-3-3-2" : "1-4-3-3";
  const parts = (raw || fallback)
    .split("-")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0);
  const total = parts.reduce((sum, value) => sum + value, 0);
  return total === team.format ? parts : fallback.split("-").map(Number);
}

function fieldSlots() {
  const rows = parseTactic();
  const slots = [];
  rows.forEach((count, rowIndex) => {
    const y = 88 - rowIndex * (76 / Math.max(rows.length - 1, 1));
    for (let i = 0; i < count; i += 1) {
      const x = count === 1 ? 50 : 18 + i * (64 / (count - 1));
      slots.push({ x, y });
    }
  });
  return slots;
}

function slotsForTactic(tactic, total) {
  const fallback = total === 7 ? "1-3-2-1" : total === 9 ? "1-3-3-2" : "1-4-3-3";
  const parts = (tactic || fallback)
    .split("-")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0);
  const rows = parts.reduce((sum, value) => sum + value, 0) === total ? parts : fallback.split("-").map(Number);
  const slots = [];
  rows.forEach((count, rowIndex) => {
    const y = 88 - rowIndex * (76 / Math.max(rows.length - 1, 1));
    for (let i = 0; i < count; i += 1) {
      const x = count === 1 ? 50 : 18 + i * (64 / (count - 1));
      slots.push({ x, y });
    }
  });
  return slots;
}

function slugName(name) {
  return String(name || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function initials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

function playerPhoto(name) {
  return `/assets/jogadoras/${slugName(name)}.jpg`;
}

function playerForName(name, level) {
  return state.db.players.find((player) => player.level === level && player.name === name) || null;
}

function playerPhotoSrc(name, level) {
  return playerForName(name, level)?.photoUrl || playerPhoto(name);
}

function pitchMarkup(names, tactic, total, options = {}) {
  const slots = slotsForTactic(tactic, total);
  const level = options.level || matchById(state.liveDetailMatchId || state.db.live?.matchId)?.level;
  const withPhotos = Boolean(options.withPhotos);
  return `
    <div class="pitch mini-pitch">
      <div class="pitch-line halfway"></div>
      <div class="pitch-box top-box"></div>
      <div class="pitch-box bottom-box"></div>
      <div class="center-circle"></div>
      ${slots
        .map((slot, index) => {
          const name = names[index] || "";
          if (!name) return `<span class="player-dot empty" style="left:${slot.x}%;top:${slot.y}%">+</span>`;
          if (withPhotos) {
            return `<span class="player-dot photo-dot" style="left:${slot.x}%;top:${slot.y}%"><img src="${playerPhotoSrc(name, level)}" alt="${name}" onerror="this.remove(); this.parentElement.dataset.initials='${initials(name)}';" /><small>${name}</small></span>`;
          }
          return `<span class="player-dot" style="left:${slot.x}%;top:${slot.y}%">${name}</span>`;
        })
        .join("")}
    </div>
  `;
}

function livePlayerCard(name, index, level) {
  return `
    <article class="live-player-card">
      <div class="player-photo">
        <img src="${playerPhotoSrc(name, level)}" alt="${name}" onerror="this.remove(); this.parentElement.dataset.initials='${initials(name)}';" />
      </div>
      <strong>${index + 1}. ${name}</strong>
    </article>
  `;
}

function syncLineupFromSlots() {
  state.starters = new Set(state.lineupSlots.filter(Boolean));
}

function syncSlotsFromStarters() {
  const total = activeTeam().format;
  const names = [...state.starters].slice(0, total);
  state.lineupSlots = Array.from({ length: total }, (_, index) => names[index] || "");
  syncLineupFromSlots();
}

function resetLineup() {
  state.starters.clear();
  state.bench.clear();
  state.lineupSlots = Array(activeTeam().format).fill("");
  state.selectedSlot = null;
}

function setPickerMode(mode) {
  state.pickerMode = mode;
  $$(".filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === mode));
}

function renderPitch() {
  const pitch = $("#pitch");
  const slots = fieldSlots();
  if (state.lineupSlots.length !== slots.length) {
    const current = state.lineupSlots.filter(Boolean);
    state.lineupSlots = Array.from({ length: slots.length }, (_, index) => current[index] || "");
    syncLineupFromSlots();
  }

  pitch.innerHTML = `
    <div class="pitch-line halfway"></div>
    <div class="pitch-box top-box"></div>
    <div class="pitch-box bottom-box"></div>
    <div class="center-circle"></div>
  `;

  slots.forEach((slot, index) => {
    const name = state.lineupSlots[index] || "";
    const chip = document.createElement("button");
    chip.className = `player-dot ${name ? "" : "empty"} ${state.selectedSlot === index ? "selected" : ""}`;
    chip.style.left = `${slot.x}%`;
    chip.style.top = `${slot.y}%`;
    chip.textContent = name || "+";
    chip.title = name || "Clica para escolher uma jogadora";
    chip.addEventListener("click", () => {
      state.selectedSlot = index;
      setPickerMode("starter");
      renderPlayers();
    });
    pitch.append(chip);
  });

  const bench = document.createElement("div");
  bench.className = "bench-strip";
  bench.innerHTML = `<strong>Banco</strong>${[...state.bench].map((name) => `<span>${name}</span>`).join("") || "<span>Sem suplentes</span>"}`;
  pitch.append(bench);
}

function renderPlayers() {
  const team = activeTeam();
  const report = selectedReport();
  if (!state.lineupSlots.some(Boolean) && report.starters) {
    state.lineupSlots = Array.from({ length: team.format }, (_, index) => report.starters[index] || "");
    syncLineupFromSlots();
  }
  if (!state.bench.size && report.bench) report.bench.forEach((name) => state.bench.add(name));

  $("#lineupHint").textContent = `${team.label}: escolhe ${team.format} titulares; a tática define a disposição no campo.`;
  $("#starterCounter").textContent = `${state.starters.size}/${team.format} titulares`;
  $("#starterCounter").style.color = state.starters.size === team.format ? "#198754" : "#df1f2d";
  $("#pickerTitle").textContent =
    state.pickerMode === "starter"
      ? state.selectedSlot === null
        ? "Escolher titulares"
        : `Escolher para a posição ${state.selectedSlot + 1}`
      : state.pickerMode === "bench"
        ? "Escolher suplentes"
        : "Todas as jogadoras";

  const grid = $("#playerGrid");
  grid.innerHTML = "";
  levelPlayers().forEach((player) => {
    const selectedStarter = state.starters.has(player.name);
    const selectedBench = state.bench.has(player.name);
    if (state.pickerMode === "starter" && selectedBench) return;
    if (state.pickerMode === "bench" && selectedStarter) return;

    const button = document.createElement("button");
    button.className = `player-card ${selectedStarter ? "is-starter" : ""} ${selectedBench ? "is-bench" : ""}`;
    button.innerHTML = `<strong>${player.name}</strong><span>${selectedStarter ? "Titular" : selectedBench ? "Suplente" : "Disponível"}</span>`;
    button.addEventListener("click", () => togglePlayer(player.name));
    grid.append(button);
  });

  renderPitch();
  renderEventPlayers();
}

function togglePlayer(name) {
  const team = activeTeam();
  if (state.pickerMode === "bench") {
    if (state.bench.has(name)) state.bench.delete(name);
    else {
      const index = state.lineupSlots.findIndex((playerName) => playerName === name);
      if (index !== -1) state.lineupSlots[index] = "";
      syncLineupFromSlots();
      state.bench.add(name);
    }
  } else if (state.selectedSlot !== null) {
    const previousSlot = state.lineupSlots.findIndex((playerName) => playerName === name);
    if (previousSlot !== -1) state.lineupSlots[previousSlot] = "";
    state.lineupSlots[state.selectedSlot] = name;
    state.bench.delete(name);
    syncLineupFromSlots();
    state.selectedSlot = null;
  } else if (state.starters.has(name)) {
    const index = state.lineupSlots.findIndex((playerName) => playerName === name);
    if (index !== -1) state.lineupSlots[index] = "";
    syncLineupFromSlots();
  } else {
    if (state.starters.size >= team.format) {
      alert(`Este escalão só pode ter ${team.format} titulares.`);
      return;
    }
    state.bench.delete(name);
    const emptySlot = state.lineupSlots.findIndex((playerName) => !playerName);
    if (emptySlot !== -1) state.lineupSlots[emptySlot] = name;
    syncLineupFromSlots();
  }
  renderPlayers();
}

function renderEventPlayers() {
  const lists = [$("#eventPlayer"), $("#assistPlayer"), $("#subOutPlayer"), $("#subInPlayer")];
  lists.forEach((select) => {
    select.innerHTML = "";
    select.append(option("Selecionar", ""));
  });
  eventPlayers().forEach((player) => {
    lists.forEach((select) => select.append(option(player.name, player.id)));
  });
  updateEventFormMode();
}

function updateEventFormMode() {
  const type = $("#eventType").value;
  const team = $("#eventTeam").value;
  const isOpponent = team === "Adversário";
  const isSub = type === "Substituição" && !isOpponent;
  const needsPlayer = !isOpponent && ["Golo", "Cartão amarelo", "Cartão vermelho", "Falta"].includes(type);
  const needsAssist = !isOpponent && type === "Golo";
  $$(".sub-only").forEach((field) => field.classList.toggle("visible", isSub));
  $$(".assist-only").forEach((field) => field.classList.toggle("visible", needsAssist));
  $(".event-player-main").classList.toggle("hidden", !needsPlayer);
}

function renderLive() {
  const match = currentMatch() || {};
  const live = state.liveDetailMatchId ? (state.db.liveGames || {})[state.liveDetailMatchId] || state.db.live || {} : state.db.live || {};
  $("#scoreMini").textContent = `${live.homeScore ?? 0} - ${live.awayScore ?? 0}`;
  $("#liveCompetition").textContent = `${match.level || ""} · ${match.competition || ""}`;
  $("#liveTitle").textContent = `Casa Pia AC ${live.homeScore ?? 0} - ${live.awayScore ?? 0} ${match.opponent || "Adversário"}`;
  $("#livePhase").textContent = live.period || "Por iniciar";
  $("#liveStatus").textContent = live.status || "Por iniciar";
  $("#heroStatus").textContent = "#VOAMOSJUNTOS";
}

function eventDescription(event) {
  if (event.type === "Substituição") return `${event.team} · entra ${event.inPlayerName || "-"} · sai ${event.outPlayerName || "-"}`;
  if (event.type === "Golo") return `${event.team}${event.playerName ? ` · ${event.playerName}` : ""}${event.assistName ? ` · ass. ${event.assistName}` : ""}`;
  return `${event.team}${event.playerName ? ` · ${event.playerName}` : ""}`;
}

function eventClass(event) {
  if (event.team === "Sistema") return "system-event";
  if (event.team === "Adversário") return "away-event";
  return "home-event";
}

function eventMarkup(event) {
  if (event.team === "Sistema") return `<span class="event-start">${event.type}</span>`;
  if (event.type === "Golo") {
    const player = event.playerName ? ` · ${event.playerName}` : "";
    const assist = event.assistName ? ` · ass. ${event.assistName}` : "";
    return `<span><strong class="goal-label">Golo · ${event.team}</strong>${player}${assist}</span>`;
  }
  return `<span><strong>${event.type}</strong> · ${eventDescription(event)}</span>`;
}

function renderTimeline() {
  const timeline = $("#timeline");
  const eventLog = $("#eventChronology");
  const matchId = state.liveDetailMatchId || state.db.live?.matchId;
  const eventsNewest = state.db.events.filter((event) => event.matchId === matchId).slice(0, 50);
  const eventsChronological = [...eventsNewest].reverse();
  if (timeline) timeline.innerHTML = eventsChronological.length ? "" : "<p>Sem eventos registados neste jogo.</p>";
  if (eventLog) eventLog.innerHTML = eventsChronological.length ? "" : "<p>Sem eventos registados neste jogo.</p>";

  if (timeline) eventsChronological.forEach((event, index) => {
    const item = document.createElement("div");
    item.className = `timeline-item ${eventClass(event)}`;
    item.innerHTML = `<strong>#${index + 1}</strong>${eventMarkup(event)}`;
    timeline.append(item);
  });

  if (eventLog) {
    eventsChronological.forEach((event, index) => {
      const item = document.createElement("div");
      item.className = `timeline-item ${eventClass(event)}`;
      item.innerHTML = `<strong>#${index + 1}</strong>${eventMarkup(event)}${canDelegate() ? `<button class="delete-event" data-event-id="${event.id}">Apagar</button>` : ""}`;
      eventLog.append(item);
    });
  }
  renderLiveDetailSheets();
}

function levelSummary(level) {
  const matches = levelMatches(level);
  const finished = matches.filter((m) => m.goalsFor !== null && m.goalsAgainst !== null);
  const scheduled = matches.length - finished.length;
  const wins = finished.filter((m) => m.goalsFor > m.goalsAgainst).length;
  const draws = finished.filter((m) => m.goalsFor === m.goalsAgainst).length;
  const losses = finished.filter((m) => m.goalsFor < m.goalsAgainst).length;
  const goalsFor = finished.reduce((sum, m) => sum + Number(m.goalsFor || 0), 0);
  const goalsAgainst = finished.reduce((sum, m) => sum + Number(m.goalsAgainst || 0), 0);
  return { matches: matches.length, finished: finished.length, scheduled, wins, draws, losses, goalsFor, goalsAgainst };
}

function resultKind(match) {
  if (match.goalsFor === null || match.goalsAgainst === null) return "pending";
  if (match.goalsFor > match.goalsAgainst) return "win";
  if (match.goalsFor < match.goalsAgainst) return "loss";
  return "draw";
}

function resultLetter(kind) {
  return { win: "V", draw: "E", loss: "D", pending: "-" }[kind];
}

function renderDataPage() {
  const level = state.dataLevel;
  const summary = levelSummary(level);
  $("#dataCards").innerHTML = [
    ["Jogos", summary.matches, ""],
    ["Realizados", summary.finished, ""],
    ["Por jogar", summary.scheduled, ""],
    ["Vitórias", summary.wins, "result-win"],
    ["Empates", summary.draws, "result-draw"],
    ["Derrotas", summary.losses, "result-loss"],
    ["Golos marcados", summary.goalsFor, "goals-for"],
    ["Golos sofridos", summary.goalsAgainst, "goals-against"],
  ]
    .map(([label, value, tone]) => `<article class="stat-card ${tone}"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  const groups = levelMatches(level).reduce((map, match) => {
    const competition = match.competition || "Sem competição";
    if (!map.has(competition)) map.set(competition, []);
    map.get(competition).push(match);
    return map;
  }, new Map());
  const competitions = [...groups.keys()];
  if (!competitions.includes(state.competitionFilter)) state.competitionFilter = "all";
  const competitionFilter = $("#competitionFilter");
  if (competitionFilter) {
    competitionFilter.innerHTML = "";
    competitionFilter.append(option("Todas", "all"));
    competitions.forEach((competition) => competitionFilter.append(option(competition, competition)));
    competitionFilter.value = state.competitionFilter;
  }
  const visibleGroups = state.competitionFilter === "all" ? [...groups.entries()] : [...groups.entries()].filter(([competition]) => competition === state.competitionFilter);
  $("#historyTable").innerHTML = visibleGroups
    .map(([competition, matches]) => {
      const rows = matches.map((match) => {
        const kind = resultKind(match);
        const result = kind === "pending" ? "Por jogar" : `<span class="score"><span class="goals-for">${match.goalsFor}</span>-<span class="goals-against">${match.goalsAgainst}</span></span>`;
        return [
          match.round || "-",
          match.opponent,
          match.venue || "-",
          result,
          `<span class="badge ${kind}">${resultLetter(kind)}</span>`,
        ];
      });
      return `<h3 class="competition-title">${competition}</h3>${table(["Jornada", "Adversário", "Local", "Resultado", "Estado"], rows)}`;
    })
    .join("") || "<p>Sem jogos para esta competição.</p>";
}

function playerAppearances(player) {
  return player.history || [];
}

function playerStats(player) {
  const appearances = playerAppearances(player);
  const goals = appearances.reduce((sum, item) => sum + Number(item.goals || 0), 0);
  const assists = appearances.reduce((sum, item) => sum + Number(item.assists || 0), 0);
  const yellows = appearances.reduce((sum, item) => sum + Number(item.yellows || 0), 0);
  const reds = appearances.reduce((sum, item) => sum + Number(item.reds || 0), 0);
  return { appearances, goals, assists, yellows, reds };
}

function renderTeamsPage() {
  const teamsSelect = $("#teamsLevelSelect");
  if (!teamsSelect) return;
  teamsSelect.innerHTML = "";
  state.db.teams.forEach((team) => teamsSelect.append(option(team.label, team.level)));
  if (!state.db.teams.some((team) => team.level === state.teamsLevel)) state.teamsLevel = state.db.teams[0]?.level || "Sub13";
  teamsSelect.value = state.teamsLevel;

  const players = levelPlayers(state.teamsLevel);
  if (!players.some((player) => player.id === state.selectedPlayerId)) state.selectedPlayerId = players[0]?.id || null;
  $("#teamsGrid").innerHTML = players
    .map((player) => {
      const stats = playerStats(player);
      const photo = player.photoUrl
        ? `<img src="${player.photoUrl}" alt="${player.name}" loading="lazy" />`
        : `<span class="player-photo-fallback">${player.name.slice(0, 1)}</span>`;
      return `
        <button class="team-player-card ${state.selectedPlayerId === player.id ? "active" : ""}" data-player-id="${player.id}">
          ${photo}
          <span>
            <strong>${player.name}</strong>
            <small>${stats.appearances.length} jogos</small>
          </span>
        </button>
      `;
    })
    .join("") || "<p>Sem jogadoras neste escalão.</p>";
  renderPlayerDetail();
}

function renderPlayerDetail() {
  const detail = $("#playerDetail");
  const content = $("#playerDetailContent");
  if (!detail || !content) return;
  const player = state.db.players.find((item) => item.id === state.selectedPlayerId);
  if (!player) {
    detail.hidden = true;
    return;
  }
  const stats = playerStats(player);
  const rows = stats.appearances.map((item) => [
    item.opponent || "-",
    item.role || "-",
    item.minutes === "" || item.minutes === null || item.minutes === undefined ? "-" : `${item.minutes} min`,
    `${Number(item.goals || 0)} G`,
    `${Number(item.assists || 0)} A`,
    `${Number(item.yellows || 0)} CA`,
    `${Number(item.reds || 0)} CV`,
  ]);
  const photo = player.photoUrl
    ? `<img src="${player.photoUrl}" alt="${player.name}" />`
    : `<span class="player-photo-fallback large">${player.name.slice(0, 1)}</span>`;
  detail.hidden = false;
  content.innerHTML = `
    <div class="player-profile">
      ${photo}
      <div>
        <p class="eyebrow">Histórico da jogadora</p>
        <h2>${player.name}</h2>
        <span>${player.level}</span>
      </div>
    </div>
    <div class="player-stat-row">
      <article><strong>${stats.appearances.length}</strong><span>Jogos</span></article>
      <article><strong>${stats.goals}</strong><span>Golos</span></article>
      <article><strong>${stats.assists}</strong><span>Assist.</span></article>
      <article><strong>${stats.yellows}</strong><span>Amarelos</span></article>
      <article><strong>${stats.reds}</strong><span>Vermelhos</span></article>
    </div>
    <h3 class="competition-title">Histórico</h3>
    ${table(["Adversário", "Papel", "Tempo", "Golos", "Assist.", "Amarelos", "Vermelhos"], rows)}
  `;
}

function liveGames() {
  const liveMap = state.db.liveGames || {};
  const hidden = new Set(state.db.hiddenLiveGames || []);
  const ids = new Set([...Object.keys(state.db.matchReports || {}), ...Object.keys(liveMap)]);
  return [...ids]
    .filter((matchId) => !hidden.has(matchId))
    .map((matchId) => {
      const match = matchById(matchId);
      const report = state.db.matchReports?.[matchId];
      const fallback = {
        matchId,
        period: report ? "Ficha criada" : "Pre-jogo",
        status: report ? "Ficha criada" : "Por iniciar",
        homeScore: 0,
        awayScore: 0,
        cornersFor: 0,
        cornersAgainst: 0,
      };
      return { match, live: liveMap[matchId] || fallback, hasReport: Boolean(report) };
    })
    .filter((item) => item.match && (item.hasReport || item.live));
}

function renderLiveHub() {
  const list = $("#liveGamesList");
  if (!list) return;
  const games = liveGames();
  list.innerHTML = games.length ? "" : "<p>Não há jogos em direto neste momento.</p>";
  games.forEach(({ match, live }) => {
    const card = document.createElement("article");
    card.className = "live-card";
  card.innerHTML = `
      <span>${match.level} · ${match.competition}</span>
      <strong>Casa Pia ${live.homeScore ?? 0}-${live.awayScore ?? 0} ${match.opponent}</strong>
      <small>${live.period || "Jogo"} · ${live.status || "Em direto"}</small>
      ${state.db.matchReports?.[match.id] ? "<em>Ficha criada</em>" : ""}
      ${isAdmin() ? `<button class="danger clear-live" data-match-id="${match.id}">Apagar do direto</button>` : ""}
    `;
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openLiveDetail(match.id);
    });
    list.append(card);
  });
}

function openLiveDetail(matchId) {
  state.liveDetailMatchId = matchId;
  const live = (state.db.liveGames || {})[matchId] || state.db.live;
  state.db.live = { ...live, matchId };
  $("#liveListPanel").hidden = true;
  $("#liveDetailPanel").hidden = false;
  renderLive();
  renderTimeline();
}

function renderLiveDetailSheets() {
  const matchId = state.liveDetailMatchId || state.db.live?.matchId;
  const lineup = $("#liveLineupSheet");
  if (!lineup || !matchId) return;
  const report = state.db.matchReports[matchId] || {};
  const match = matchById(matchId);
  const total = state.db.teams.find((team) => team.level === match?.level)?.format || (report.starters || []).length || 11;
  const starters = report.starters || [];
  lineup.innerHTML = `
    <h3>Tática ${report.tactic || "-"}</h3>
    ${pitchMarkup(starters, report.tactic, total, { withPhotos: true, level: match?.level })}
    <p><strong>Suplentes</strong></p>
    <div class="chip-list">${(report.bench || []).map((name) => `<span>${name}</span>`).join("") || "<span>Sem banco guardado</span>"}</div>
  `;
}

function table(headers, rows) {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}">Sem dados registados.</td></tr>`;
  return `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

function hydrateReportFields() {
  const report = selectedReport();
  $("#delegateName").value = report.delegate || "";
  $("#tacticInput").value = report.tactic || "";
  $("#notesInput").value = report.notes || "";
}

function renderAll() {
  renderSelectors();
  renderMatchCard();
  hydrateReportFields();
  renderPlayers();
  renderLive();
  renderTimeline();
  renderDataPage();
  renderTeamsPage();
}

async function activateSelectedMatch() {
  if (!state.selectedMatch) return;
  await request("/api/live", {
    method: "POST",
    body: JSON.stringify({
      matchId: state.selectedMatch.id,
      period: "Pre-jogo",
      homeScore: 0,
      awayScore: 0,
      status: "Por iniciar",
      liveEnded: false,
      cornersFor: 0,
      cornersAgainst: 0,
    }),
  });
  const fresh = await request("/api/bootstrap");
  state.db.live = fresh.live;
  state.db.liveGames = fresh.liveGames;
  state.db.hiddenLiveGames = fresh.hiddenLiveGames;
  state.db.events = fresh.events;
  state.db.matches = fresh.matches;
  state.db.matchReports = fresh.matchReports;
}

async function bootstrap() {
  state.db = await request("/api/bootstrap");
  state.level = state.db.teams[0]?.level || "Sub13";
  state.dataLevel = state.level;
  state.teamsLevel = state.level;
  state.selectedMatch = openMatches()[0] || null;
  resetLineup();
  await activateSelectedMatch();
  renderAll();
  renderAuth();
  setView("data");
}

async function refreshLive() {
  const fresh = await request("/api/bootstrap");
  state.db.live = fresh.live;
  state.db.liveGames = fresh.liveGames;
  state.db.hiddenLiveGames = fresh.hiddenLiveGames;
  state.db.events = fresh.events;
  state.db.matches = fresh.matches;
  state.db.matchReports = fresh.matchReports;
  renderLive();
  renderTimeline();
  renderDataPage();
  renderTeamsPage();
  renderLiveHub();
}

function applyFreshDb(fresh) {
  state.db = fresh;
  state.level = state.db.teams.find((team) => team.level === state.level)?.level || state.db.teams[0]?.level || "Sub13";
  state.dataLevel = state.db.teams.find((team) => team.level === state.dataLevel)?.level || state.level;
  state.teamsLevel = state.db.teams.find((team) => team.level === state.teamsLevel)?.level || state.level;
  state.selectedMatch = openMatches()[0] || null;
  resetLineup();
  renderAll();
  renderAuth();
  renderLiveHub();
}

async function addSystemEvent(type, period) {
  await request("/api/events", {
    method: "POST",
    body: JSON.stringify({
      matchId: state.selectedMatch.id,
      type,
      team: "Sistema",
      period,
    }),
  });
}

async function setMatchControl(control) {
  const config = {
    "start-first": { period: "1ª Parte", status: "Em direto", liveEnded: false, event: "Início do jogo" },
    "half-time": { period: "Intervalo", status: "Intervalo", liveEnded: false, event: "Fim da 1ª parte" },
    "start-second": { period: "2ª Parte", status: "Em direto", liveEnded: false, event: "Início da 2ª parte" },
    "full-time": { period: "Fim de jogo", status: "Terminado", liveEnded: true, event: "Fim de jogo" },
  }[control];
  await request("/api/live", {
    method: "POST",
    body: JSON.stringify({ ...config, matchId: state.selectedMatch.id }),
  });
  await addSystemEvent(config.event, config.period);
  await refreshLive();
}

$$(".tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));

$("#loginOpen").addEventListener("click", () => {
  $(".delegate-tab").hidden = false;
  setView("delegate");
});

$("#loginSubmit").addEventListener("click", () => {
  const user = login($("#loginId").value, $("#loginPass").value);
  if (!user) {
    $("#loginError").textContent = "Credenciais inválidas.";
    return;
  }
  state.user = user;
  localStorage.setItem("cpacUser", JSON.stringify(user));
  $("#loginError").textContent = "";
  renderAuth();
  setView("delegate");
});

$("#logoutBtn").addEventListener("click", () => {
  state.user = null;
  localStorage.removeItem("cpacUser");
  renderAuth();
  setView("data");
});

document.addEventListener("click", async (event) => {
  const teamPlayer = event.target.closest(".team-player-card");
  if (teamPlayer) {
    state.selectedPlayerId = teamPlayer.dataset.playerId;
    renderTeamsPage();
    return;
  }

  const deleteEvent = event.target.closest(".delete-event");
  if (deleteEvent && canDelegate()) {
    await request(`/api/events/${encodeURIComponent(deleteEvent.dataset.eventId)}`, { method: "DELETE" });
    await refreshLive();
    return;
  }
  const clearLive = event.target.closest(".clear-live");
  if (clearLive && isAdmin()) {
    await request(`/api/live/${encodeURIComponent(clearLive.dataset.matchId)}`, { method: "DELETE" });
    if (state.liveDetailMatchId === clearLive.dataset.matchId) {
      state.liveDetailMatchId = null;
      $("#liveListPanel").hidden = false;
      $("#liveDetailPanel").hidden = true;
    }
    await refreshLive();
  }
});

$("#backToLiveList").addEventListener("click", () => {
  state.liveDetailMatchId = null;
  $("#liveListPanel").hidden = false;
  $("#liveDetailPanel").hidden = true;
  renderLiveHub();
});

$$(".filter").forEach((button) => {
  button.addEventListener("click", () => {
    state.pickerMode = button.dataset.filter;
    state.selectedSlot = null;
    $$(".filter").forEach((item) => item.classList.toggle("active", item === button));
    renderPlayers();
  });
});

$$("[data-control]").forEach((button) => {
  button.addEventListener("click", () => setMatchControl(button.dataset.control));
});

$("#levelSelect").addEventListener("change", async () => {
  state.level = $("#levelSelect").value;
  state.dataLevel = state.level;
  state.selectedMatch = openMatches()[0] || null;
  resetLineup();
  await activateSelectedMatch();
  renderAll();
});

$("#dataLevelSelect").addEventListener("change", () => {
  state.dataLevel = $("#dataLevelSelect").value;
  state.competitionFilter = "all";
  renderDataPage();
});

$("#competitionFilter")?.addEventListener("change", () => {
  state.competitionFilter = $("#competitionFilter").value;
  renderDataPage();
});

$("#teamsLevelSelect")?.addEventListener("change", () => {
  state.teamsLevel = $("#teamsLevelSelect").value;
  state.selectedPlayerId = null;
  renderTeamsPage();
});

$("#matchSelect").addEventListener("change", async () => {
  state.selectedMatch = matchById($("#matchSelect").value);
  resetLineup();
  await activateSelectedMatch();
  renderAll();
});

$("#tacticInput").addEventListener("input", () => {
  syncSlotsFromStarters();
  renderPlayers();
});
$("#eventType").addEventListener("change", updateEventFormMode);
$("#eventTeam").addEventListener("change", updateEventFormMode);

$("#saveReport").addEventListener("click", async () => {
  const team = activeTeam();
  if (state.starters.size !== team.format) {
    alert(`Este escalão precisa de ${team.format} titulares.`);
    return;
  }
  await request("/api/report", {
    method: "POST",
    body: JSON.stringify({
      matchId: state.selectedMatch.id,
      delegate: $("#delegateName").value,
      tactic: $("#tacticInput").value,
      notes: $("#notesInput").value,
      starters: state.lineupSlots.filter(Boolean),
      lineupSlots: state.lineupSlots,
      bench: [...state.bench],
    }),
  });
  await refreshLive();
  renderEventPlayers();
  alert("Ficha guardada.");
});

$("#clearReport").addEventListener("click", async () => {
  if (!state.selectedMatch) return;
  if (!confirm("Limpar a ficha de jogo deste jogo? Os eventos registados ficam guardados.")) return;
  resetLineup();
  $("#delegateName").value = "";
  $("#tacticInput").value = "";
  $("#notesInput").value = "";
  await request("/api/report", {
    method: "POST",
    body: JSON.stringify({
      matchId: state.selectedMatch.id,
      clear: true,
    }),
  });
  await refreshLive();
  renderAll();
});

$("#addEvent").addEventListener("click", async () => {
  const type = $("#eventType").value;
  const team = $("#eventTeam").value;
  const player = eventPlayers().find((item) => item.id === $("#eventPlayer").value);
  const assist = eventPlayers().find((item) => item.id === $("#assistPlayer").value);
  const outPlayer = eventPlayers().find((item) => item.id === $("#subOutPlayer").value);
  const inPlayer = eventPlayers().find((item) => item.id === $("#subInPlayer").value);

  if (team === "Casa Pia" && ["Golo", "Cartão amarelo", "Cartão vermelho", "Falta"].includes(type) && !player) {
    alert("Escolhe uma jogadora da ficha de jogo guardada.");
    return;
  }
  if (team === "Casa Pia" && type === "Substituição" && (!outPlayer || !inPlayer)) {
    alert("Escolhe a jogadora que sai e a jogadora que entra.");
    return;
  }

  await request("/api/events", {
    method: "POST",
    body: JSON.stringify({
      matchId: state.selectedMatch.id,
      type,
      team,
      period: state.db.live?.period || "Jogo",
      playerId: team === "Adversário" ? "" : player?.id || "",
      playerName: team === "Adversário" ? "" : player?.name || "",
      assistId: team === "Adversário" ? "" : assist?.id || "",
      assistName: team === "Adversário" ? "" : assist?.name || "",
      outPlayerId: team === "Adversário" ? "" : outPlayer?.id || "",
      outPlayerName: team === "Adversário" ? "" : outPlayer?.name || "",
      inPlayerId: team === "Adversário" ? "" : inPlayer?.id || "",
      inPlayerName: team === "Adversário" ? "" : inPlayer?.name || "",
    }),
  });
  await refreshLive();
});

$("#uploadExcel")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  const file = $("#excelFileInput").files[0];
  if (!file) {
    $("#syncStatus").textContent = "Escolhe primeiro o ficheiro Casa pia.xlsx.";
    return;
  }
  $("#syncStatus").textContent = "A importar Excel...";
  const response = await fetch("/api/import-xlsx", {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Filename": file.name,
    },
    body: await file.arrayBuffer(),
  });
  if (!response.ok) {
    $("#syncStatus").textContent = "Nao foi possivel importar o Excel.";
    throw new Error(await response.text());
  }
  applyFreshDb(await response.json());
  $("#syncStatus").textContent = "Resultados, jogos e jogadoras atualizados pelo Excel.";
});

$("#syncExcelUrl")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  $("#syncStatus").textContent = "A sincronizar pelo link online...";
  try {
    const fresh = await request("/api/sync-excel-url", { method: "POST" });
    applyFreshDb(fresh);
    $("#syncStatus").textContent = "Excel online sincronizado automaticamente.";
  } catch (error) {
    $("#syncStatus").textContent = "Configura primeiro CASA_PIA_XLSX_URL no servidor.";
    throw error;
  }
});

$("#reloadSource")?.addEventListener("click", async () => {
  if (!isAdmin()) return;
  $("#syncStatus").textContent = "A recarregar o Excel local...";
  try {
    applyFreshDb(await request("/api/reload-source", { method: "POST" }));
    $("#syncStatus").textContent = "Excel local recarregado.";
  } catch (error) {
    $("#syncStatus").textContent = "Este botao so funciona no computador/servidor que tem acesso ao Excel local.";
    throw error;
  }
});

await bootstrap();
setInterval(refreshLive, 3000);
