// 画面の部品だけをキャッシュする（データは毎回取りに行き、取れないときは app が前回の値を使う）
const CACHE = "afic-shell-v1";
const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/sources.js", "js/views.js", "js/ui.js",
  "manifest.webmanifest", "icons/icon.svg", "demo/dashboard.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith("/data/dashboard.json")) return;
  // 新しい版を先に取り、取れなければキャッシュ（オフラインでも画面は開く）
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});
