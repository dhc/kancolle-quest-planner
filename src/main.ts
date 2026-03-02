import "./style.css";
import maps from "./map_master.json";
import quests from "./quests.json";

type MapEntry = {
  map_id: string;
  area_name: string;
  op_name: string;
  keywords: string[];
  aliases: string[];
};

type Cycle = "normal" | "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "unknown";

type Quest = {
  id: string;
  title: string;
  raw?: string;
  text_plain?: string;
  maps?: string[];
  cycle?: Cycle;
  text?: string; // fallback
};

const mapMaster = maps as MapEntry[];
const questList = quests as Quest[];

function normalize(s: string): string {
  return (s ?? "").trim();
}

function mapLabel(m: MapEntry) {
  return `${m.map_id}｜${m.area_name}｜${m.op_name}`;
}

function questText(q: Quest): string {
  return q.text_plain ?? q.text ?? q.raw ?? "";
}

function questMaps(q: Quest): string[] {
  return Array.isArray(q.maps) ? q.maps : [];
}

function cycleLabel(c: Cycle): string {
  switch (c) {
    case "daily": return "日次";
    case "weekly": return "週次";
    case "monthly": return "月次";
    case "quarterly": return "三月次"
    case "yearly": return "年次";
    case "normal": return "単発";
    default: return "不明";
  }
}

function escapeHtml(s: string) {
  return (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Reverse index: map_id -> quests[]
function buildMapToQuests() {
  const mapTo: Record<string, Quest[]> = {};
  for (const q of questList) {
    for (const id of questMaps(q)) {
      (mapTo[id] ??= []).push(q);
    }
  }
  return mapTo;
}
const mapToQuests = buildMapToQuests();

// ---- UI ----
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="wrap">
    <h1>海域 → 任務 逆引き くん</h1>

    <div class="controls">
      <input id="mapFilter" type="text" placeholder="海域検索（例: 1-1 / 鎮守府正面海域 / 近海警備）" />
      <select id="map"></select>
    </div>

    <div class="controls">
      <input id="questFilter" type="text" placeholder="任務検索（任務名/本文）" />
      <select id="sort">
        <option value="id_desc">並び: ID 降順</option>
        <option value="id_asc">並び: ID 昇順</option>
        <option value="stack">並び: 同時進行しやすい順</option>
      </select>
    </div>

    <div class="controls cycles" id="cycles"></div>

    <div id="meta" class="meta"></div>
    <button id="expandAll">全て展開</button>
    <button id="collapseAll">全て折りたたむ</button>
    <ul id="list" class="list"></ul>
  </div>
`;

const mapFilter = document.querySelector<HTMLInputElement>("#mapFilter")!;
const select = document.querySelector<HTMLSelectElement>("#map")!;
const questFilter = document.querySelector<HTMLInputElement>("#questFilter")!;
const sortSelect = document.querySelector<HTMLSelectElement>("#sort")!;
const cyclesWrap = document.querySelector<HTMLDivElement>("#cycles")!;
const meta = document.querySelector<HTMLDivElement>("#meta")!;
const list = document.querySelector<HTMLUListElement>("#list")!;
const expandBtn = document.getElementById("expandAll")!;
const collapseBtn = document.getElementById("collapseAll")!;

expandBtn.addEventListener("click", () => {
  document.querySelectorAll(".text").forEach(el => {
    el.classList.remove("hidden");
  });
});

collapseBtn.addEventListener("click", () => {
  document.querySelectorAll(".text").forEach(el => {
    el.classList.add("hidden");
  });
});

// ---- Map select (All option) ----
let filteredMaps: MapEntry[] = [...mapMaster];

function applyMapFilter() {
  const q = normalize(mapFilter.value).toLowerCase();
  if (!q) {
    filteredMaps = [...mapMaster];
  } else {
    filteredMaps = mapMaster.filter((m) => {
      const hay = `${m.map_id} ${m.area_name} ${m.op_name} ${(m.aliases ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }
  renderSelect();
}

function renderSelect() {
  const options =
    [`<option value="">(全海域)</option>`] +
    filteredMaps.map((m) => `<option value="${m.map_id}">${mapLabel(m)}</option>`).join("");

  select.innerHTML = options;

  // Keep selection if possible; otherwise reset to All
  const cur = select.value;
  if (cur && !filteredMaps.some((m) => m.map_id === cur)) {
    select.value = "";
  }

  renderResult();
}

// ---- Cycles (checkbox OR) ----
const cycleItems: { key: Cycle; label: string }[] = [
  { key: "normal", label: "単発" },
  { key: "daily", label: "日次" },
  { key: "weekly", label: "週次" },
  { key: "monthly", label: "月次" },
  { key: "quarterly", label: "三月次" },
  { key: "yearly", label: "年次" },
  { key: "unknown", label: "不明" },
];

function renderCycleChecks() {
  cyclesWrap.innerHTML = `
    <div class="cycle-row">
      <label class="cycle-all">
        <input type="checkbox" id="cycleAll" checked />
        <span>周期: 全て</span>
      </label>
      <div class="cycle-list">
        ${cycleItems
          .map(
            (c) => `
            <label class="cycle-item">
              <input type="checkbox" class="cycle" value="${c.key}" checked />
              <span>${c.label}</span>
            </label>
          `
          )
          .join("")}
      </div>
    </div>
  `;

  const all = document.querySelector<HTMLInputElement>("#cycleAll")!;
  const checks = Array.from(document.querySelectorAll<HTMLInputElement>("input.cycle"));

  function syncAllFromChecks() {
    const allChecked = checks.every((x) => x.checked);
    all.checked = allChecked;
  }

  all.addEventListener("change", () => {
    checks.forEach((x) => (x.checked = all.checked));
    renderResult();
  });

  checks.forEach((c) =>
    c.addEventListener("change", () => {
      syncAllFromChecks();
      renderResult();
    })
  );
}

function selectedCycles(): Set<Cycle> | null {
  const checks = Array.from(document.querySelectorAll<HTMLInputElement>("input.cycle"));
  const selected = checks.filter((x) => x.checked).map((x) => x.value as Cycle);

  // 全部チェックならフィルタなし（null）
  if (selected.length === checks.length) return null;

  // 0件チェックは「0件表示」にする（空Set）
  return new Set(selected);
}

// ---- Sorting helpers ----
function compareIdAsc(a: Quest, b: Quest): number {
  return a.id.localeCompare(b.id, "ja", { numeric: true });
}
function compareIdDesc(a: Quest, b: Quest): number {
  return b.id.localeCompare(a.id, "ja", { numeric: true });
}

// ---- Render results ----
function renderResult() {
  const mapId = select.value; // "" means all maps
  const qf = normalize(questFilter.value).toLowerCase();
  const cycSet = selectedCycles();

  let qs: Quest[] = [];

  if (!mapId) {
    qs = questList.slice();
  } else {
    qs = (mapToQuests[mapId] ?? []).slice();
  }

  // Cycle OR filter
  if (cycSet !== null) {
    qs = qs.filter((q) => cycSet.has((q.cycle ?? "unknown") as Cycle));
  }

  // Quest text filter
  if (qf) {
    qs = qs.filter((q) => {
      const hay = `${q.id} ${q.title} ${questText(q)}`.toLowerCase();
      return hay.includes(qf);
    });
  }

  // Sort
  const sortMode = sortSelect.value;
  if (sortMode === "id_asc") {
    qs.sort(compareIdAsc);
  } else if (sortMode === "id_desc") {
    qs.sort(compareIdDesc);
  } else {
    // 同時進行しやすい順：必要海域数が少ないものを上へ
    qs.sort((a, b) => questMaps(a).length - questMaps(b).length);
  }

  // Meta
  if (!mapId) {
    meta.textContent = `(全海域) / ヒット任務: ${qs.length}`;
  } else {
    const m = mapMaster.find((x) => x.map_id === mapId);
    meta.textContent = m
      ? `${mapLabel(m)} / ヒット任務: ${qs.length}`
      : `map_id=${mapId} / ヒット任務: ${qs.length}`;
  }

  // List
  list.innerHTML = qs.map((q, index) => {
    const cycleTag = `<span class="tag cycle">${cycleLabel((q.cycle ?? "unknown") as Cycle)}</span>`;
    const mapTags = questMaps(q).map(id => `<span class="tag map">${id}</span>`).join("");

    return `
      <li class="item">
        <div class="title toggle" data-index="${index}">
          <span class="head">${escapeHtml(q.id)}｜${escapeHtml(q.title)}</span>
          ${cycleTag}
          ${mapTags}
        </div>
        <div class="text hidden" id="detail-${index}">
          ${escapeHtml(questText(q))}
        </div>
      </li>
    `;
  }).join("");

  document.querySelectorAll<HTMLDivElement>(".title.toggle").forEach((el) => {
    el.addEventListener("click", () => {
      const index = el.getAttribute("data-index");
      const detail = document.getElementById(`detail-${index}`);
      if (!detail) return;

      detail.classList.toggle("hidden");
    });
  });
}

// Events
mapFilter.addEventListener("input", applyMapFilter);
select.addEventListener("change", renderResult);
questFilter.addEventListener("input", renderResult);
sortSelect.addEventListener("change", renderResult);

// Initial render
renderCycleChecks();
renderSelect();
renderResult();