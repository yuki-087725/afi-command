// 画面ごとの HTML。どれも ctx（スナップショットと画面の状態）だけから作る純粋な関数
import {
  esc, STATUS, STATUS_ORDER, FACT_KIND, EVENT_KIND, REWRITE_STATUS, fixCommand,
  absTime, clock, ago, dayKey, dayLabel, hoursSince, statusChip, siteTag, icon,
} from "./ui.js";

// --- スナップショットから作る値 -------------------------------------------------------------------------------
export function model(snapshot) {
  const sites = snapshot.sites || [];
  const items = sites.flatMap((s) => (s.items || []).map((x) => ({ ...x, site: s.id })));
  const totals = Object.fromEntries(STATUS_ORDER.map((k) => [k, sites.reduce((n, s) => n + (s.queue?.counts?.[k] || 0), 0)]));
  const bnDefs = Object.fromEntries((snapshot.bottlenecks || []).map((b) => [b.code, b]));
  const groups = {};
  for (const x of items) {
    if (x.status !== "pending" || !x.bottleneck) continue;
    (groups[x.bottleneck] ||= []).push(x);
  }
  const bottlenecks = Object.entries(groups)
    .map(([code, list]) => ({ code, list, ...(bnDefs[code] || { label: code, hint: "" }) }))
    .sort((a, b) => b.list.length - a.list.length);
  const errors24 = (snapshot.timeline || []).filter((e) => e.level === "error" && hoursSince(e.at) < 24).length;
  return { sites, items, totals, bottlenecks, bnDefs, errors24 };
}

const counter = (k, v) => `
  <div class="stat"><div class="v num c-${k}" data-count="${v}">${v}</div>
  <div class="k"><span class="dot bg-${k}"></span>${esc(STATUS[k].label)}</div><div class="ja">${esc(STATUS[k].ja)}</div></div>`;

function ring(totals) {
  const all = STATUS_ORDER.reduce((n, k) => n + totals[k], 0);
  const r = 62, c = 2 * Math.PI * r;
  let off = 0;
  const segs = all
    ? STATUS_ORDER.filter((k) => totals[k]).map((k) => {
        const len = (totals[k] / all) * c;
        const gap = len > 4 ? 2 : 0;
        const s = `<circle r="${r}" cx="74" cy="74" stroke="var(--${k})" stroke-dasharray="${len - gap} ${c}" stroke-dashoffset="${-off}"/>`;
        off += len;
        return s;
      }).join("")
    : "";
  return `<div class="ring"><svg viewBox="0 0 148 148"><circle class="track" r="${r}" cx="74" cy="74"/>${segs}</svg>
    <div class="ring-center"><div class="big num">${totals.ready}</div><div class="lbl">READY</div></div></div>`;
}

function stackBar(counts) {
  const all = STATUS_ORDER.reduce((n, k) => n + (counts?.[k] || 0), 0);
  if (!all) return `<div class="bar"></div>`;
  return `<div class="bar">${STATUS_ORDER.map((k) => counts[k] ? `<i class="bg-${k}" style="width:${(counts[k] / all) * 100}%"></i>` : "").join("")}</div>`;
}

const progress = (c) => {
  const done = (c?.ready || 0) + (c?.published || 0);
  const all = done + (c?.pending || 0);
  return all ? Math.round((done / all) * 100) : null;
};

function banner(ctx) {
  const out = [];
  if (ctx.meta.demo) out.push(`<div class="banner demo">${icon("overview", "ico ico-sm")}<div><b>デモデータを表示中。</b>設定でデータの取り方（URL / GitHub）を選ぶと実データになります。</div></div>`);
  if (ctx.meta.offline) out.push(`<div class="banner err">${icon("refresh", "ico ico-sm")}<div><b>前回取得したデータを表示中</b>（${esc(ago(ctx.meta.cachedAt))}）。${esc(ctx.meta.error || "")}</div></div>`);
  const h = hoursSince(ctx.snapshot.generated_at);
  if (!ctx.meta.demo && h > ctx.settings.staleHours) out.push(`<div class="banner warn">${icon("log", "ico ico-sm")}<div><b>スナップショットが ${Math.floor(h)} 時間更新されていません。</b>daily が止まっていないか確認してください。</div></div>`);
  return out.join("");
}

// --- 概要 ---------------------------------------------------------------------------------------------------
export function overview(ctx) {
  const m = model(ctx.snapshot);
  const lastDaily = ctx.snapshot.daily?.[0];
  const lastRun = ctx.runs?.[0];
  const picks = m.sites.flatMap((s) => (s.priority?.top || []).filter((x) => x.eligible).map((x) => ({ ...x, site: s.id })))
    .sort((a, b) => b.score - a.score).slice(0, 5);
  return `${banner(ctx)}
  <section class="card hero">
    ${ring(m.totals)}
    <div class="hero-stats">${STATUS_ORDER.map((k) => counter(k, m.totals[k])).join("")}</div>
  </section>

  <div class="section-h"><h2>サイト</h2><span class="meta">${m.sites.length} サイト</span></div>
  <div class="site-grid">${m.sites.map(siteCard).join("") || `<div class="empty"><b>サイトがありません</b>sites.toml を確認してください</div>`}</div>

  <div class="section-h"><h2>詰まり TOP</h2><a href="#/bottlenecks">すべて見る</a></div>
  ${m.bottlenecks.length ? `<div class="card"><div class="rows">${m.bottlenecks.slice(0, 3).map((b) => `
    <a class="row" href="#/bottlenecks" style="color:inherit">
      <span class="bn-count" style="font-size:20px;min-width:34px">${b.list.length}</span>
      <div class="grow"><div class="t">${esc(b.label)}</div><div class="s">${esc(b.hint)}</div></div>
      ${icon("chev", "ico ico-sm")}</a>`).join("")}</div></div>`
    : `<div class="empty"><b>詰まりはありません</b>Pending の候補はすべて理由が解消されています</div>`}

  <div class="section-h"><h2>最新の実行</h2><a href="#/log">ログ</a></div>
  <div class="card"><div class="rows">
    ${lastRun ? runRow(lastRun) : ""}
    ${lastDaily ? `<div class="row">${icon("play", "ico ico-sm c-ok")}<div class="grow">
      <div class="t">daily（${lastDaily.picked.length} / ${lastDaily.limit ?? "?"} 本を選択）</div>
      <div class="s">${esc(lastDaily.picked.map((p) => `${p.site} #${p.post_id} ${p.keyword}`).join("、") || "選べる記事なし")}</div></div>
      <span class="card-sub">${esc(ago(lastDaily.at))}</span></div>` : ""}
    ${m.sites.filter((s) => s.gate).map((s) => `<div class="row">${siteTag(s.id)}<div class="grow">
      <div class="t">Publish Gate: <span class="${s.gate.status === "ready" ? "c-ready" : "c-pending"}">${esc(s.gate.status)}</span></div>
      <div class="s">候補 ${s.gate.ready + s.gate.pending + s.gate.unmatched} 件中、台帳に当たらない ${s.gate.unmatched} 件</div></div>
      <span class="card-sub">${esc(ago(s.gate.at))}</span></div>`).join("")}
    ${!lastRun && !lastDaily && !m.sites.some((s) => s.gate) ? `<div class="card-sub">実行の記録はまだありません</div>` : ""}
  </div></div>

  <div class="section-h"><h2>次のリライト候補</h2><span class="meta">daily の採点</span></div>
  ${picks.length ? `<div class="card"><div class="rows">${picks.map((p, i) => `<div class="row">
      <span class="rank">${i + 1}</span>${siteTag(p.site)}
      <div class="grow"><div class="t">${p.killer ? "★ " : ""}${esc(p.keyword || p.title)}</div><div class="s">#${esc(p.post_id)} ${esc(p.why)}</div></div>
      <span class="score">${esc(p.score)}</span></div>`).join("")}</div></div>`
    : `<div class="empty"><b>今リライトできる記事はありません</b>クールダウン中・公開から日が浅い記事は選ばれません</div>`}
  `;
}

function siteCard(s) {
  const c = s.queue?.counts || {};
  const pct = progress(c);
  const rw = s.rewrites?.counts || {};
  return `<a class="card tap" href="#/queue?site=${esc(s.id)}" style="color:inherit;display:block">
    <div class="card-h"><div style="min-width:0">
      <div style="display:flex;align-items:center;gap:8px">${siteTag(s.id)}<span class="card-title">${esc(s.name || s.id)}</span></div>
      <div class="card-sub" style="margin-top:4px">${esc(s.domain || "")}${s.niche ? ` ・ ${esc(s.niche)}` : ""}</div></div>
      <div class="pct" title="公開までの進み具合（Ready + Published の割合）">${pct == null ? "—" : `${pct}<small>%</small>`}</div></div>
    ${stackBar(c)}
    <div class="legend">${STATUS_ORDER.map((k) => `<span><i class="dot bg-${k}"></i>${STATUS[k].label} <b>${c[k] || 0}</b></span>`).join("")}</div>
    <div class="kv">
      <div><div class="k">台帳</div><div class="v num">${s.ledger?.specs ?? 0}${s.ledger?.review ? `<small class="c-pending"> +${s.ledger.review}</small>` : ""}</div></div>
      <div><div class="k">PR 済み</div><div class="v num c-ready">${rw.pr_created || 0}</div></div>
      <div><div class="k">失敗</div><div class="v num ${rw.failed ? "c-error" : ""}">${rw.failed || 0}</div></div>
    </div>
    <div class="card-sub" style="margin-top:10px">キュー更新 ${esc(ago(s.queue?.updated))}</div>
  </a>`;
}

function runRow(r) {
  const tone = r.status !== "completed" ? "info" : r.conclusion === "success" ? "ready" : r.conclusion === "failure" ? "error" : "expired";
  const label = r.status !== "completed" ? (r.status === "queued" ? "待機中" : "実行中") : { success: "成功", failure: "失敗", cancelled: "中止" }[r.conclusion] || r.conclusion;
  return `<a class="row" href="${esc(r.url)}" target="_blank" rel="noopener" style="color:inherit">
    <span class="dot bg-${tone}" style="width:10px;height:10px"></span>
    <div class="grow"><div class="t">GitHub Actions daily：<span class="c-${tone}">${esc(label)}</span></div>
    <div class="s">${esc(absTime(r.at))}・${esc(r.event)}${r.seconds ? `・${Math.round(r.seconds / 60)}分` : ""}</div></div>
    ${icon("ext", "ico ico-sm")}</a>`;
}

// --- キュー（製品ごと） ---------------------------------------------------------------------------------------
export function queue(ctx) {
  const m = model(ctx.snapshot);
  const { site = "all", status = "active", q = "" } = ctx.params;
  const bySite = m.items.filter((x) => site === "all" || x.site === site);
  const cnt = (st) => bySite.filter((x) => (st === "active" ? x.status === "ready" || x.status === "pending" : st === "all" || x.status === st)).length;
  const needle = q.trim().toLowerCase();
  const order = { ready: 0, pending: 1, published: 2, expired: 3 };
  const list = bySite
    .filter((x) => (status === "active" ? x.status === "ready" || x.status === "pending" : status === "all" || x.status === status))
    .filter((x) => !needle || `${x.title} ${x.key} ${(x.specs || []).join(" ")}`.toLowerCase().includes(needle))
    .sort((a, b) => order[a.status] - order[b.status] || (b.checked || "").localeCompare(a.checked || ""));
  const segBtn = (key, val, label, n) =>
    `<button data-action="param" data-key="${key}" data-val="${val}" aria-pressed="${ctx.params[key] === val || (!ctx.params[key] && val === (key === "site" ? "all" : "active"))}">${label}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;
  return `${banner(ctx)}
  <div class="filters">
    <div class="seg">${segBtn("site", "all", "すべて")}${m.sites.map((s) => segBtn("site", s.id, s.id)).join("")}</div>
    <div class="seg">${segBtn("status", "active", "進行中", cnt("active"))}${STATUS_ORDER.map((k) => segBtn("status", k, STATUS[k].label, cnt(k))).join("")}${segBtn("status", "all", "全部", cnt("all"))}</div>
    <label class="search">${icon("search")}<input type="search" id="q" value="${esc(q)}" placeholder="商品名・ASIN・台帳名で絞り込み" autocomplete="off" enterkeyhint="search"></label>
  </div>
  <div class="list">${list.map((x) => itemCard(x, m)).join("") || `<div class="empty"><b>該当する候補はありません</b>子の gate_candidates.json か python -m admin.queue add で候補が入ります</div>`}</div>`;
}

function itemCard(x, m) {
  const bn = x.bottleneck ? m.bnDefs[x.bottleneck] : null;
  return `<article class="item" data-action="item" data-site="${esc(x.site)}" data-key="${esc(x.key)}">
    <div class="rail bg-${esc(x.status)}"></div>
    <div class="item-main">
      <div class="item-title">${esc(x.title || x.key)}</div>
      <div class="item-meta">${siteTag(x.site)}<span class="num">${esc(x.key.slice(0, 22))}</span>
        ${(x.kinds || []).map((k) => `<span class="chip sm ghost">${esc(FACT_KIND[k] || k)}</span>`).join("")}</div>
      ${x.status === "pending" && (x.reasons || []).length ? `<div class="item-why">${icon("block")}<span><b class="c-pending">${esc(bn?.label || "蓄積中")}</b>：${esc(x.reasons[0])}</span></div>` : ""}
      ${x.status === "ready" ? `<div class="item-why" style="color:var(--ready)">${icon("play")}<span>${esc(ago(x.ready_since))}から Ready・子の次の投稿で使われます</span></div>` : ""}
    </div>
    <div class="item-side">${statusChip(x.status)}${icon("chev")}</div>
  </article>`;
}

export function itemSheet(x, m) {
  const bn = x.bottleneck ? m.bnDefs[x.bottleneck] : null;
  const cmd = x.status === "pending" ? fixCommand(x.bottleneck, x, x.site) : "";
  const dl = [["キー", x.key], ["出どころ", x.source === "manual" ? "手で追加" : x.source === "child" ? "子が知らせた" : x.source],
    ["種類", x.kind], ["カテゴリ", x.category], ["追加", absTime(x.added)], ["子が最後に知らせた", absTime(x.seen)],
    ["最後に判定", absTime(x.checked)], ["Ready から", x.ready_since && absTime(x.ready_since)],
    ["公開", x.published && `${absTime(x.published)}${x.post_id ? `（#${x.post_id}）` : ""}`]]
    .filter(([, v]) => v && v !== "—");
  return `<div style="display:flex;gap:8px;align-items:center">${siteTag(x.site)}${statusChip(x.status, false)}</div>
    <h3>${esc(x.title || x.key)}</h3>
    ${x.status === "pending" ? `<div class="grp"><div class="grp-h">詰まっている理由${bn ? `・${esc(bn.label)}` : ""}</div>
      ${(x.reasons || []).map((r) => `<div class="reason">${esc(r)}</div>`).join("") || `<div class="card-sub">理由の記録がありません</div>`}
      ${bn?.hint ? `<div class="note">対処：${esc(bn.hint)}</div>` : ""}
      ${cmd ? `<div class="cmd"><code>${esc(cmd)}</code><button class="icon-btn" data-action="copy" data-text="${esc(cmd)}" aria-label="コピー">${icon("copy", "ico ico-sm")}</button></div>` : ""}</div>` : ""}
    ${x.heading ? `<div class="grp"><div class="grp-h">記事に入る章</div><div>${esc(x.heading)}</div></div>` : ""}
    <div class="grp"><div class="grp-h">一次データ</div><div class="chips">
      ${(x.kinds || []).map((k) => `<span class="chip c-ready">${esc(FACT_KIND[k] || k)}</span>`).join("") || `<span class="card-sub">まだ作れる章はありません</span>`}</div></div>
    ${(x.specs || []).length ? `<div class="grp"><div class="grp-h">当たった台帳</div><div class="chips">${x.specs.map((s) => `<span class="chip ghost">${esc(s)}</span>`).join("")}</div></div>` : ""}
    ${x.spec_result ? `<div class="grp"><div class="grp-h">仕様の自動作成</div><div class="card-sub" style="word-break:break-all">${esc(x.spec_result)}</div></div>` : ""}
    <div class="grp"><div class="grp-h">記録</div><dl class="dl">${dl.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
    ${x.url ? `<div class="btns"><a class="btn" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${icon("ext", "ico ico-sm")}仕様ページ</a></div>` : ""}`;
}

// --- 詰まり ---------------------------------------------------------------------------------------------------
export function bottlenecks(ctx) {
  const m = model(ctx.snapshot);
  const max = Math.max(1, ...m.bottlenecks.map((b) => b.list.length));
  const pending = m.totals.pending;
  const waiting = m.sites.flatMap((s) => (s.gate?.waiting || []).map((w) => ({ site: s.id, name: w })));
  return `${banner(ctx)}
  <section class="card" style="display:flex;align-items:center;gap:16px">
    <div class="ring" style="width:84px;height:84px"><svg viewBox="0 0 148 148"><circle class="track" r="62" cx="74" cy="74"/>
      <circle r="62" cx="74" cy="74" stroke="var(--pending)" stroke-dasharray="${pending && (pending / Math.max(1, pending + m.totals.ready)) * 389.6} 400"/></svg>
      <div class="ring-center"><div class="num" style="font-size:22px;font-weight:700;color:var(--pending)">${pending}</div></div></div>
    <div><div class="card-title">蓄積中の候補</div>
      <div class="card-sub">一次データ（組み合わせ表・通路幅・比較表）が作れるまで記事にしない候補。理由ごとに並べています。</div></div>
  </section>
  <div class="section-h"><h2>理由ごと</h2><span class="meta">${m.bottlenecks.length} 種類</span></div>
  ${m.bottlenecks.map((b) => {
    const sites = [...new Set(b.list.map((x) => x.site))];
    return `<section class="card bn">
      <div class="bn-head"><span class="bn-count">${b.list.length}</span>
        <div style="flex:1;min-width:0"><div class="bn-label">${esc(b.label)}</div><div class="card-sub">${sites.map(esc).join(" / ")}</div></div></div>
      <div class="bn-meter"><i style="width:${(b.list.length / max) * 100}%"></i></div>
      <div class="bn-hint">${esc(b.hint)}</div>
      ${sites.map((s) => { const cmd = fixCommand(b.code, b.list.find((x) => x.site === s), s);
        return `<div class="cmd"><code>${esc(cmd)}</code><button class="icon-btn" data-action="copy" data-text="${esc(cmd)}" aria-label="コピー">${icon("copy", "ico ico-sm")}</button></div>`; }).join("")}
      <details><summary>対象の候補 ${b.list.length} 件 ▾</summary><ul>
        ${b.list.map((x) => `<li data-action="item" data-site="${esc(x.site)}" data-key="${esc(x.key)}">${siteTag(x.site)} ${esc(x.title)}</li>`).join("")}</ul></details>
    </section>`;
  }).join("") || `<div class="empty"><b>詰まりはありません</b>Pending の候補が無いか、すべて理由が解消されています</div>`}
  ${waiting.length ? `<div class="section-h"><h2>候補に出てこない台帳</h2><span class="meta">Publish Gate</span></div>
    <div class="card"><div class="card-sub" style="margin-bottom:8px">仕様は台帳にあるのに、子の売れ筋・検索結果に出てこない商品。記事にできる状態で待っています。</div>
    <div class="rows">${waiting.map((w) => `<div class="row">${siteTag(w.site)}<div class="grow"><div class="t">${esc(w.name)}</div></div></div>`).join("")}</div></div>` : ""}
  ${m.sites.filter((s) => s.gate?.unmatched).map((s) => `<div class="card" style="margin-top:12px">
    <div class="card-h"><div>${siteTag(s.id)} <b>台帳に当たらない候補</b></div><span class="num c-pending" style="font-size:20px;font-weight:700">${s.gate.unmatched}</span></div>
    <div class="card-sub" style="margin-top:6px">子が Publish Gate に渡した候補のうち、仕様の台帳に無い商品の数（${esc(ago(s.gate.at))}）。台帳を増やすほど Ready が増えます。</div></div>`).join("")}`;
}

// --- ログ（タイムライン） ---------------------------------------------------------------------------------------
export function log(ctx) {
  const kind = ctx.params.kind || "all";
  const runs = (ctx.runs || []).map((r) => ({
    at: r.at, site: "", kind: "actions", link: r.url,
    level: r.status !== "completed" ? "info" : r.conclusion === "success" ? "ok" : r.conclusion === "failure" ? "error" : "warn",
    title: `GitHub Actions daily：${r.status !== "completed" ? "実行中" : r.conclusion}`,
    detail: `${r.event}${r.seconds ? `・${Math.round(r.seconds / 60)}分` : ""}`,
  }));
  const all = [...(ctx.snapshot.timeline || []), ...runs].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const kinds = ["all", ...Object.keys(EVENT_KIND).filter((k) => all.some((e) => e.kind === k))];
  const list = all.filter((e) => kind === "all" || e.kind === kind || (kind === "error" && e.level === "error"));
  let lastDay = "";
  const body = list.map((e) => {
    const d = dayKey(e.at);
    const head = d !== lastDay ? `${lastDay ? "</div>" : ""}<div class="day">${esc(dayLabel(e.at))}</div><div class="tl">` : "";
    lastDay = d;
    return `${head}<div class="ev" data-lv="${esc(e.level)}">
      <div class="ev-top"><span class="time">${esc(clock(e.at))}</span>${e.site ? siteTag(e.site) : ""}<span class="chip sm ghost">${esc(EVENT_KIND[e.kind] || e.kind)}</span></div>
      <div class="ev-title">${esc(e.title)}</div>${e.detail ? `<div class="ev-detail">${esc(e.detail)}</div>` : ""}
      ${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">${icon("ext", "ico ico-sm")}開く</a>` : ""}</div>`;
  }).join("") + (lastDay ? "</div>" : "");
  return `${banner(ctx)}
  <div class="filters"><div class="seg">${kinds.map((k) => `<button data-action="param" data-key="kind" data-val="${k}" aria-pressed="${kind === k}">${k === "all" ? "すべて" : esc(EVENT_KIND[k])}</button>`).join("")}</div></div>
  ${body || `<div class="empty"><b>記録はまだありません</b>daily・Publish Gate・master_ops を動かすと並びます</div>`}`;
}

// --- 設定 ---------------------------------------------------------------------------------------------------
export function settings(ctx) {
  const s = ctx.settings;
  const opt = (v, l) => `<option value="${v}" ${s.source === v ? "selected" : ""}>${l}</option>`;
  const gh = s.source === "github";
  const sites = (ctx.snapshot?.sites || []).map((x) => x.id);
  return `
  <form class="card" id="settings-form" autocomplete="off">
    <div class="card-title">データの取り方</div>
    <div class="field"><label for="f-source">取得元</label>
      <select id="f-source" name="source">${opt("auto", "自動（URL → だめならデモ）")}${opt("url", "URL（PC の serve.py など）")}${opt("github", "GitHub（afi-admin-data ブランチ）")}${opt("demo", "デモデータ")}</select></div>
    <div class="field" ${gh || s.source === "demo" ? "hidden" : ""}><label for="f-url">スナップショットの URL</label>
      <input id="f-url" name="url" value="${esc(s.url)}" inputmode="url">
      <div class="help">既定の data/dashboard.json は mobile/serve.py が親の data/reports/dashboard.json を出す場所です</div></div>
    <div ${gh ? "" : "hidden"}>
      <div class="field"><label for="f-repo">リポジトリ</label><input id="f-repo" name="repo" value="${esc(s.repo)}" placeholder="owner/name"></div>
      <div class="field"><label for="f-branch">ブランチ</label><input id="f-branch" name="branch" value="${esc(s.branch)}"></div>
      <div class="field"><label for="f-path">ファイル</label><input id="f-path" name="path" value="${esc(s.path)}"></div>
      <div class="field"><label for="f-token">GitHub トークン（Fine-grained）</label>
        <input id="f-token" name="token" type="password" value="${esc(s.token)}" placeholder="github_pat_…" autocomplete="off">
        <div class="help">afi_admin だけに絞り、Contents: Read と Actions: Read（今すぐ実行するなら Read and write）。この端末のブラウザにだけ保存し、api.github.com 以外には送りません</div></div>
    </div>
    <div class="field"><label for="f-auto">自動で読み直す間隔</label>
      <select id="f-auto" name="autoRefreshMin">${[0, 5, 10, 30, 60].map((n) => `<option value="${n}" ${+s.autoRefreshMin === n ? "selected" : ""}>${n ? `${n} 分` : "しない"}</option>`).join("")}</select></div>
    <div class="btns"><button class="btn primary" type="submit">保存して読み込む</button><button class="btn" type="button" data-action="clear-cache">キャッシュを消す</button></div>
  </form>

  ${gh ? `<form class="card" id="dispatch-form" style="margin-top:12px">
    <div class="card-title">daily を今すぐ実行</div>
    <div class="card-sub">GitHub Actions の afi-admin daily を動かします（workflow_dispatch）。下書き PR が作られます。</div>
    <div class="field"><label for="d-site">サイト</label><select id="d-site" name="site"><option value="">全サイト</option>${sites.map((x) => `<option>${esc(x)}</option>`).join("")}</select></div>
    <div class="field"><label for="d-limit">本数（空なら DAILY_LIMIT）</label><input id="d-limit" name="limit" inputmode="numeric" pattern="[0-9]*" placeholder="2"></div>
    <label class="switch"><span>PR を作らず案まで（試運転）</span><input type="checkbox" name="noPr" checked></label>
    <div class="btns"><button class="btn primary" type="submit">${icon("play", "ico ico-sm")}実行する</button></div>
  </form>` : ""}

  <div class="card" style="margin-top:12px">
    <div class="card-title">このデータについて</div>
    <dl class="dl" style="margin-top:10px">
      <dt>形式</dt><dd>${esc(ctx.snapshot?.schema || "—")}</dd>
      <dt>親が作った時刻</dt><dd>${esc(absTime(ctx.snapshot?.generated_at))}</dd>
      <dt>取得した時刻</dt><dd>${esc(absTime(ctx.meta.fetchedAt))}</dd>
      <dt>取得元</dt><dd>${esc(ctx.meta.label || "—")}</dd>
    </dl>
    <div class="note">スナップショットは <code>python -m admin.dashboard</code> が作ります（daily の最後に自動で実行）。ホーム画面に追加するとアプリとして開けます。</div>
  </div>`;
}

export function skeleton() {
  return `<div class="skeleton" style="height:180px"></div><div class="skeleton"></div><div class="skeleton"></div>`;
}

export function fatal(msg) {
  return `<div class="banner err">${icon("refresh", "ico ico-sm")}<div><b>データを読めませんでした。</b>${esc(msg)}</div></div>
    <div class="btns"><a class="btn primary" href="#/settings">設定を開く</a><button class="btn" data-action="use-demo">デモで見る</button></div>`;
}
