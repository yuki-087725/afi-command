// データの取り方。どの取り方でも、親（python -m admin.dashboard）が作る afi-command/1 のスナップショットを返す。
//   demo   … demo/dashboard.json（時刻を「今」にずらして見せる）
//   url    … 任意の URL（serve.py が出す data/dashboard.json など）
//   github … GitHub API で afi-admin-data ブランチの data/reports/dashboard.json と、daily ワークフローの実行履歴
//   auto   … url（既定 data/dashboard.json）→ だめなら demo
// 新しい取り方を足すときは SOURCES に { label, load(settings) } を足す。load は { snapshot, runs?, label } を返す。

const SETTINGS_KEY = "afic.settings.v1";
const CACHE_KEY = "afic.snapshot.v1";
export const SCHEMA_PREFIX = "afi-command/";

export const DEFAULTS = {
  source: "auto",
  url: "data/dashboard.json",
  repo: "yuki-087725/afi_admin",
  branch: "afi-admin-data",
  path: "data/reports/dashboard.json",
  workflow: "daily.yml",
  token: "",
  autoRefreshMin: 10,
  staleHours: 26,
};

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
  try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* 保存できなくても動く */ }
}

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(storageGet(SETTINGS_KEY) || "{}") }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) { storageSet(SETTINGS_KEY, JSON.stringify(s)); }

export function loadCache() {
  try { return JSON.parse(storageGet(CACHE_KEY) || "null"); } catch { return null; }
}
function saveCache(result) { storageSet(CACHE_KEY, JSON.stringify({ ...result, cachedAt: new Date().toISOString() })); }
export function clearCache() { storageSet(CACHE_KEY, null); }

function validate(snap) {
  if (!snap || typeof snap !== "object" || !String(snap.schema || "").startsWith(SCHEMA_PREFIX)) {
    throw new Error("afi-command のスナップショットではありません（schema が違います）");
  }
  snap.sites ||= [];
  snap.timeline ||= [];
  snap.daily ||= [];
  snap.bottlenecks ||= [];
  return snap;
}

async function getJSON(url, init = {}) {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText || ""}`.trim() + ` — ${url.replace(/\?.*/, "")}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// デモのデータは日付が固定なので、generated_at が「今」になるように全部の時刻をずらす
const TIME_KEYS = new Set(["at", "generated_at", "updated", "added", "seen", "checked", "ready_since", "published", "finished"]);
function shiftTimes(obj, deltaMs) {
  if (Array.isArray(obj)) return obj.map((x) => shiftTimes(x, deltaMs));
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (TIME_KEYS.has(k) && typeof v === "string" && v) {
      const t = Date.parse(v);
      out[k] = Number.isNaN(t) ? v : new Date(t + deltaMs).toISOString();
    } else out[k] = shiftTimes(v, deltaMs);
  }
  return out;
}

const gh = (s) => ({
  headers: {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}),
  },
});

export const SOURCES = {
  demo: {
    label: "デモデータ",
    async load() {
      const snap = validate(await getJSON("demo/dashboard.json"));
      return { snapshot: shiftTimes(snap, Date.now() - Date.parse(snap.generated_at)), label: "デモデータ", demo: true };
    },
  },
  url: {
    label: "URL",
    async load(s) {
      return { snapshot: validate(await getJSON(s.url)), label: s.url.replace(/^https?:\/\//, "") };
    },
  },
  github: {
    label: "GitHub",
    async load(s) {
      if (!s.repo) throw new Error("リポジトリ（owner/name）を設定してください");
      const api = `https://api.github.com/repos/${s.repo}`;
      const file = `${api}/contents/${s.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(s.branch)}`;
      const raw = gh(s);
      raw.headers.Accept = "application/vnd.github.raw+json";
      const [snap, runs] = await Promise.all([
        getJSON(file, raw).catch((e) => {
          // GitHub は「ファイルが無い」も「トークンで読めない」も 404 で返すので、両方を書く
          if (e.status === 404) {
            throw new Error(`${s.branch} ブランチに ${s.path} がありません（daily がまだ一度も作っていない）か、`
              + `トークンで ${s.repo} を読めません。daily を一度実行し、トークンの対象リポジトリと Contents: Read を確認してください`);
          }
          if (e.status === 401) throw new Error("トークンが正しくないか、期限が切れています");
          throw e;
        }),
        getJSON(`${api}/actions/workflows/${encodeURIComponent(s.workflow)}/runs?per_page=12`, gh(s)).catch(() => null),
      ]);
      return { snapshot: validate(snap), runs: runs ? mapRuns(runs.workflow_runs || []) : null, label: `${s.repo}@${s.branch}` };
    },
  },
  auto: {
    label: "自動",
    async load(s) {
      try {
        return await SOURCES.url.load(s);
      } catch {
        return SOURCES.demo.load(s);
      }
    },
  },
};

function mapRuns(runs) {
  return runs.map((r) => ({
    id: r.id,
    at: r.run_started_at || r.created_at,
    status: r.status, // queued / in_progress / completed
    conclusion: r.conclusion, // success / failure / cancelled / null
    event: r.event,
    url: r.html_url,
    seconds: r.updated_at && r.run_started_at ? Math.max(0, (Date.parse(r.updated_at) - Date.parse(r.run_started_at)) / 1000) : null,
  }));
}

export async function load(settings) {
  const src = SOURCES[settings.source] || SOURCES.auto;
  try {
    const result = await src.load(settings);
    result.fetchedAt = new Date().toISOString();
    result.source = settings.source;
    saveCache(result);
    return result;
  } catch (e) {
    const cached = loadCache();   // 取得元を変えたあとは、前の取得元の値で代わりにしない
    if (cached?.snapshot && cached.source === settings.source) return { ...cached, offline: true, error: e.message };
    throw e;
  }
}

// daily を今すぐ動かす（workflow_dispatch）。トークンに Actions: Read and write が要る
export async function dispatchDaily(s, { limit = "", noPr = false, site = "" } = {}) {
  if (!s.token) throw new Error("GitHub のトークンを設定してください");
  const init = gh(s);
  const res = await fetch(`https://api.github.com/repos/${s.repo}/actions/workflows/${encodeURIComponent(s.workflow)}/dispatches`, {
    method: "POST",
    headers: { ...init.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs: { limit: String(limit), no_pr: String(Boolean(noPr)), site } }),
  });
  if (res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`${res.status} ${body.message || res.statusText}`);
  }
}
