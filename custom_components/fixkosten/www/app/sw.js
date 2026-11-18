// 📱 Fixkosten – Offline-Speicher für die App. Hier liegt NUR Programm, keine Zahlen.
// (Die Zahlen merkt sich die Seite selbst im Handy – und löscht sie beim Abmelden.)
const CACHE = "fixkosten-app-__FK_VERSION__";
const FILES = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icons.json", "/fixkosten/files/fixkosten-card.js?v=__FK_VERSION__", "/fixkosten/files/fixkosten-en.json?v=__FK_VERSION__", "/fixkosten/files/mister-m.webp?v=__FK_VERSION__"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(FILES.map((f) => c.add(f)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("fixkosten-app-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Erst das Netz fragen (dann ist alles aktuell). Ohne Netz – oder nach 4 Sekunden Funkloch – das Gespeicherte nehmen.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const ours = url.pathname.startsWith("/fixkosten/app/") || url.pathname.startsWith("/fixkosten/files/");
  if (e.request.method !== "GET" || url.origin !== location.origin || !ours || url.pathname.endsWith("sw.js")) return;
  const lookup = () => caches.match(e.request).then((r) => r || caches.match(e.request, { ignoreSearch: true }))
    .then((r) => r || (url.pathname.startsWith("/fixkosten/app/") ? caches.match("./") : undefined));
  const net = fetch(e.request).then((resp) => {
    if (/\.(js|svg|json)$/.test(url.pathname) && /text\/html/.test(resp.headers.get("content-type") || "")) throw new Error("html"); // WLAN-Anmeldeseite
    if (resp.ok && resp.type === "basic" && !resp.redirected) {
      const copy = resp.clone();
      const key = url.pathname === "/fixkosten/app/" || url.pathname === "/fixkosten/app/index.html" ? "./" : e.request;
      caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
    }
    return resp;
  });
  const guarded = net.catch(() => lookup().then((r) => r || new Response("offline", { status: 503 })));
  const slow = new Promise((res) => setTimeout(() => lookup().then((r) => res(r || null), () => res(null)), 4000));
  e.waitUntil(net.catch(() => {}));
  e.respondWith(Promise.race([guarded, slow]).then((r) => r || guarded));
});

// ---------------------------------------------------------------- 🔄 Im Hintergrund nachschicken (Android/Chrome) – wie bei der Einkaufsliste
// Ist die App zu und kommt das Netz zurück, weckt Chrome diesen Helfer kurz auf („sync“).
// Er schickt den Postausgang an Home Assistant – genau so, wie es die Karte selbst tun würde.
// Doppelt geht nichts: Home Assistant merkt sich jede Änderungs-Nummer (op_id) und zählt sie nur einmal.
// iPhones kennen das leider nicht; dort wird beim nächsten Öffnen nachgeschickt.
let dbp = null;
function db() {
  return dbp || (dbp = new Promise((ok, fail) => {
    const r = indexedDB.open("fixkosten-app", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { dbp = null; fail(r.error); };
  }));
}
async function kv(mode, fn) {
  const d = await db();
  return new Promise((ok, fail) => {
    const tx = d.transaction("kv", mode);
    let out;
    fn(tx.objectStore("kv"), (v) => { out = v; });
    tx.oncomplete = () => ok(out);
    tx.onerror = () => fail(tx.error);
  });
}
const kvGet = (k) => kv("readonly", (st, set) => { const r = st.get(k); r.onsuccess = () => set(r.result); });
const kvSet = (k, v) => kv("readwrite", (st) => { st.put(v, k); });
// Angekommene Änderungen aus dem Postausgang nehmen + für die Seite merken („… im Hintergrund nachgeschickt“) – in einem Schritt
const kvDone = (key, ids, okN) => kv("readwrite", (st) => {
  const done = new Set(ids);
  const r = st.get("queues");
  r.onsuccess = () => {
    const all = r.result || {};
    if (all[key]) { all[key].ops = (all[key].ops || []).filter((o) => !done.has(o.op_id)); if (!all[key].ops.length) delete all[key]; }
    st.put(all, "queues");
  };
  const f = st.get("flushed");
  f.onsuccess = () => { const old = f.result || { n: 0, ids: [] }; st.put({ n: (old.n || 0) + okN, ids: [...(old.ids || []), ...ids].slice(-2000), at: Date.now() }, "flushed"); };
});

async function accessToken(auth) {
  if (auth.access && auth.expires > Date.now()) return auth.access;
  const r = await fetch("/auth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: auth.refresh, client_id: auth.client_id }),
  });
  if (!r.ok) throw new Error("token " + r.status);
  const j = await r.json();
  const next = { ...auth, access: j.access_token, expires: Date.now() + (j.expires_in || 1800) * 1000 - 60000 };
  await kvSet("auth", next);
  return next.access;
}

function openSocket(token) {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(self.location.origin.replace(/^http/, "ws") + "/api/websocket");
    const pending = new Map();
    let id = 1;
    const timer = setTimeout(() => { try { ws.close(); } catch (_) { /* egal */ } fail(new Error("timeout")); }, 15000);
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (m.type === "auth_invalid") { clearTimeout(timer); fail(new Error("auth")); }
      else if (m.type === "auth_ok") {
        clearTimeout(timer);
        ok({
          call: (msg) => new Promise((res, rej) => { const n = id++; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, ...msg })); }),
          close: () => { try { ws.close(); } catch (_) { /* egal */ } },
        });
      } else if (m.type === "result") {
        const p = pending.get(m.id);
        if (p) { pending.delete(m.id); m.success ? p.res(m.result) : p.rej(Object.assign(new Error("ha"), { ha: m.error })); }
      }
    };
    ws.onclose = () => { clearTimeout(timer); for (const p of pending.values()) p.rej(Object.assign(new Error("lost"), { lost: true })); pending.clear(); fail(new Error("closed")); };
    ws.onerror = () => { try { ws.close(); } catch (_) { /* egal */ } };
  });
}

async function flushQueue(force) {
  if (!force) { // ist die App gerade offen und sichtbar? Dann schickt die Karte selbst
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.some((c) => c.visibilityState === "visible")) return;
  }
  const all = await kvGet("queues");
  const keys = Object.keys(all || {}).filter((k) => all[k]?.ops?.length);
  if (!keys.length) return;
  const auth = await kvGet("auth");
  if (!auth?.refresh) return;
  let sock = null;
  try {
    sock = await openSocket(await accessToken(auth));
    for (const key of keys) {
      const { book, ops } = all[key];
      for (let i = 0; i < ops.length; i += 100) { // wie die Karte: höchstens 100 auf einmal
        const batch = ops.slice(i, i + 100);
        let res = null;
        try {
          res = await sock.call({ type: "fixkosten/apply", ops: batch, ...(book ? { book } : {}) });
        } catch (err) {
          if (err.lost) throw err; // Netz wieder weg – der Rest bleibt im Postausgang, Chrome versucht es später nochmal
          if (err.ha?.code === "not_ready") break; // HA startet gerade (oder Buch fehlt): dieses Buch später nochmal
          throw err;
        }
        await kvDone(key, batch.map((o) => o.op_id), (res?.results || batch).filter((r) => r.ok !== false).length); // abgelehnte (z. B. Posten inzwischen gelöscht) nicht mitzählen
      }
    }
  } finally {
    sock?.close();
  }
}

self.addEventListener("sync", (e) => {
  if (e.tag === "fk-queue") e.waitUntil(flushQueue(false));
});
// Zum Testen: die Seite kann den Helfer auch direkt bitten
self.addEventListener("message", (e) => {
  if (e.data?.type === "fk-flush") e.waitUntil(flushQueue(!!e.data.force).catch(() => {}));
});
