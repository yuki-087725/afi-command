// 入り口: 画面の切り替え（#/画面?条件）・読み込み・タップの処理
import * as sources from "./sources.js";
import * as views from "./views.js";
import { ago, hoursSince } from "./ui.js";

const $ = (s) => document.querySelector(s);
const state = {
  settings: sources.loadSettings(),
  result: null, // { snapshot, runs, label, fetchedAt, offline, error, demo, cachedAt }
  error: "",
  loading: false,
};
const ROUTES = { overview: views.overview, queue: views.queue, bottlenecks: views.bottlenecks, log: views.log, settings: views.settings };

function route() {
  const [path, qs] = location.hash.replace(/^#\/?/, "").split("?");
  const name = ROUTES[path] ? path : "overview";
  return { name, params: Object.fromEntries(new URLSearchParams(qs || "")) };
}
function setParams(patch) {
  const { name, params } = route();
  const next = new URLSearchParams(Object.entries({ ...params, ...patch }).filter(([, v]) => v !== "" && v != null));
  history.replaceState(null, "", `#/${name}${next.toString() ? `?${next}` : ""}`);
  render({ keepScroll: true });
}

function ctx(params) {
  const r = state.result || {};
  return { snapshot: r.snapshot, runs: r.runs, settings: state.settings, params, meta: r };
}

function render({ keepScroll = false } = {}) {
  const { name, params } = route();
  document.querySelectorAll(".tabbar a").forEach((a) =>
    a.dataset.tab === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  const view = $("#view");
  const y = window.scrollY;
  const focusQ = document.activeElement?.id === "q" ? document.activeElement.selectionStart : null;
  if (!state.result?.snapshot && name !== "settings") {
    view.innerHTML = state.loading ? views.skeleton() : views.fatal(state.error || "まだ読み込んでいません");
  } else {
    view.innerHTML = ROUTES[name](ctx(params));
  }
  if (keepScroll) window.scrollTo(0, y);
  else { view.style.animation = "none"; void view.offsetWidth; view.style.animation = ""; window.scrollTo(0, 0); }
  if (focusQ != null) { const q = $("#q"); q?.focus(); q?.setSelectionRange(focusQ, focusQ); }
  header();
  if (!keepScroll) countUp(view);
}

function header() {
  const r = state.result;
  const el = $("#fresh");
  el.classList.toggle("loading", state.loading);
  let st = "idle", text = state.loading ? "読み込み中" : "—";
  if (r?.snapshot && !state.loading) {
    const h = hoursSince(r.snapshot.generated_at);
    st = r.offline ? "error" : h > state.settings.staleHours && !r.demo ? "stale" : "live";
    text = r.offline ? "オフライン" : `更新 ${ago(r.snapshot.generated_at)}`;
  } else if (state.error && !state.loading) { st = "error"; text = "読めません"; }
  el.dataset.state = st;
  $("#fresh-text").textContent = text;
  $("#source-label").textContent = r?.label || sources.SOURCES[state.settings.source]?.label || "";
  if (r?.snapshot) {
    const m = views.model(r.snapshot);
    const bn = m.totals.pending;
    $("#badge-bn").hidden = !bn;
    $("#badge-bn").textContent = bn > 99 ? "99+" : bn;
    $("#badge-err").hidden = !m.errors24;
    $("#badge-err").textContent = m.errors24;
  }
}

function countUp(root) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll("[data-count]").forEach((el) => {
    const to = +el.dataset.count;
    if (!to) return;
    const t0 = performance.now(), dur = 700;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(to * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  header();
  if (!state.result) render();
  try {
    state.result = await sources.load(state.settings);
    state.error = "";
  } catch (e) {
    state.error = e.message || String(e);
    // 取得元を変えたあとに読めなければ、前の取得元（デモなど）の値は出さない
    if (state.result && state.result.source !== state.settings.source) state.result = null;
    if (state.result) toast(`読めませんでした: ${state.error}`);
  } finally {
    state.loading = false;
    render({ keepScroll: true });
  }
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

function openSheet(html) {
  $("#sheet-body").innerHTML = html;
  $("#sheet").hidden = $("#sheet-backdrop").hidden = false;
  $("#sheet").scrollTop = 0;
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("#sheet").hidden = $("#sheet-backdrop").hidden = true;
  document.body.style.overflow = "";
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました");
  } catch {
    toast("コピーできませんでした");
  }
}

// --- タップ・入力 ------------------------------------------------------------------------------------------
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "refresh") refresh();
  else if (a === "param") setParams({ [el.dataset.key]: el.dataset.val });
  else if (a === "close-sheet") closeSheet();
  else if (a === "copy") copy(el.dataset.text);
  else if (a === "item") {
    const m = views.model(state.result.snapshot);
    const x = m.items.find((i) => i.site === el.dataset.site && i.key === el.dataset.key);
    if (x) openSheet(views.itemSheet(x, m));
  } else if (a === "clear-cache") {
    sources.clearCache();
    toast("キャッシュを消しました");
  } else if (a === "use-demo") {
    state.settings = { ...state.settings, source: "demo" };
    sources.saveSettings(state.settings);
    refresh();
  }
});

let qTimer;
document.addEventListener("input", (ev) => {
  if (ev.target.id === "q") {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => setParams({ q: ev.target.value }), 160);
  }
});

document.addEventListener("change", (ev) => {
  if (ev.target.id === "f-source") {   // 取得元を変えたら、入力欄だけ切り替える（まだ保存しない）
    state.settings = { ...state.settings, ...formValues($("#settings-form")) };
    render({ keepScroll: true });
  }
});

function formValues(form) {
  const f = new FormData(form);
  const out = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()]));
  if ("autoRefreshMin" in out) out.autoRefreshMin = +out.autoRefreshMin;
  return out;
}

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (ev.target.id === "settings-form") {
    state.settings = { ...state.settings, ...formValues(ev.target) };
    sources.saveSettings(state.settings);
    schedule();
    toast("保存しました");
    await refresh();
  } else if (ev.target.id === "dispatch-form") {
    const v = formValues(ev.target);
    const noPr = ev.target.noPr.checked;
    const what = `${v.site || "全サイト"}・${v.limit || "既定の本数"}・${noPr ? "PR なし（試運転）" : "下書き PR を作る"}`;
    if (!confirm(`daily を実行します。\n${what}\nよろしいですか？`)) return;
    try {
      await sources.dispatchDaily(state.settings, { limit: v.limit, noPr, site: v.site });
      toast("実行を依頼しました。数十秒でログに出ます");
      setTimeout(refresh, 15000);
    } catch (e) {
      toast(`実行できませんでした: ${e.message}`);
    }
  }
});

document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeSheet(); });
window.addEventListener("hashchange", () => { closeSheet(); render(); });

// --- 引っ張って更新 ----------------------------------------------------------------------------------------
(() => {
  const ptr = $("#ptr");
  let y0 = null, dy = 0;
  addEventListener("touchstart", (e) => { y0 = window.scrollY <= 0 && $("#sheet").hidden ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    const p = Math.min(1, dy / 90);
    ptr.style.opacity = p;
    ptr.style.transform = `translateY(${-30 + p * 40}px) rotate(${p * 270}deg)`;
  }, { passive: true });
  addEventListener("touchend", () => {
    if (y0 == null) return;
    if (dy > 90) { ptr.classList.add("go"); refresh().finally(() => { ptr.classList.remove("go"); ptr.style.opacity = 0; }); }
    else ptr.style.opacity = 0;
    y0 = null;
  });
})();

// --- 自動の読み直し・オフライン ----------------------------------------------------------------------------
let timer;
function schedule() {
  clearInterval(timer);
  const min = +state.settings.autoRefreshMin;
  if (min > 0) timer = setInterval(() => document.visibilityState === "visible" && refresh(), min * 60000);
}
document.addEventListener("visibilitychange", () => {
  const r = state.result;
  if (document.visibilityState === "visible" && r?.fetchedAt && (Date.now() - Date.parse(r.fetchedAt)) > 5 * 60000) refresh();
});

if ("serviceWorker" in navigator && isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* 無くても動く */ });
}

const cached = sources.loadCache();
if (cached?.snapshot && cached.source === state.settings.source) state.result = { ...cached, offline: false };
schedule();
render();
refresh();
