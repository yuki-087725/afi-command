// 表示の小道具（文字の逃がし・時刻・ラベル）。画面ごとの組み立ては views.js

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const STATUS = {
  ready: { label: "Ready", ja: "公開できる" },
  pending: { label: "Pending", ja: "蓄積中" },
  published: { label: "Published", ja: "公開済み" },
  expired: { label: "Expired", ja: "期限切れ" },
};
export const STATUS_ORDER = ["ready", "pending", "published", "expired"];

export const FACT_KIND = {
  charging: "組み合わせ表",
  layout: "通路幅",
  compare: "比較表",
  price: "価格の動き",
  reviews: "口コミ傾向",
};

export const EVENT_KIND = {
  daily: "daily",
  actions: "Actions",
  gate: "Publish Gate",
  queue: "キュー",
  rewrite: "リライト",
  master_ops: "てこ入れ",
  error: "エラー",
};

export const REWRITE_STATUS = {
  pr_created: { ja: "PR 済み", tone: "ready" },
  pending: { ja: "未処理", tone: "pending" },
  rewriting: { ja: "処理中", tone: "info" },
  failed: { ja: "失敗", tone: "error" },
};

// 詰まりごとに、PC で打つコマンドの雛形（{site} {title} {kind} を差し込む）
export const FIX_COMMANDS = {
  no_spec: 'python -m admin.queue add --site {site} --title "{title}" --url "<メーカーの仕様ページ>"',
  spec_review: "python -m admin.queue refresh --site {site}",
  charging_preset: 'python -m admin.specs_generator --site {site} --url "<比べる機器のページ>" --kind device --preset',
  layout_dims: 'python -m admin.specs_generator --site {site} --url "<ケージのページ>" --kind cage',
  compare_peers: 'python -m admin.specs_generator --site {site} --url "<同じ種類の製品ページ>" --kind {kind}',
  price_history: "python -m admin.pipeline facts --site {site}",
  stale: "python -m admin.queue list --site {site} --all",
  other: "python -m admin.queue list --site {site} --all",
};
export const fixCommand = (code, item, site) =>
  (FIX_COMMANDS[code] || FIX_COMMANDS.other)
    .replace("{site}", site)
    .replace("{title}", (item?.title || "").replace(/"/g, "'").slice(0, 60))
    .replace("{kind}", item?.kind || "<kind>");

const TZ = "Asia/Tokyo";
const fmtShort = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtTime = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "long", day: "numeric", weekday: "short" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

const parse = (iso) => (iso ? Date.parse(iso) : NaN);
export const absTime = (iso) => (Number.isNaN(parse(iso)) ? "—" : fmtShort.format(parse(iso)));
export const clock = (iso) => (Number.isNaN(parse(iso)) ? "—" : fmtTime.format(parse(iso)));
export const dayKey = (iso) => (Number.isNaN(parse(iso)) ? "" : dayKeyFmt.format(parse(iso)));
export const dayLabel = (iso) => {
  const k = dayKey(iso);
  const today = dayKeyFmt.format(Date.now());
  const yest = dayKeyFmt.format(Date.now() - 864e5);
  return k === today ? "今日" : k === yest ? "昨日" : fmtDay.format(parse(iso));
};
export function ago(iso) {
  const t = parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "たった今";
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}
export const hoursSince = (iso) => (Date.now() - parse(iso)) / 36e5;

export const statusChip = (st, sm = true) =>
  `<span class="chip ${sm ? "sm" : ""} c-${esc(st)}">${esc(STATUS[st]?.label || st)}</span>`;

export const siteTag = (id) => `<span class="site-id ${esc(id)}">${esc(id)}</span>`;

export const icon = (id, cls = "ico") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
