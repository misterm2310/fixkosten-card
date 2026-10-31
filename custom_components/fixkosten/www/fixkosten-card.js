// 💶 Fixkosten-Karte – zeigt, wie viel Geld diesen Monat wirklich noch verfügbar ist.
// Läuft im Dashboard UND in der Offline-App (/fixkosten/app/). Kein Build-Schritt, reines JavaScript.
//
// So funktioniert's (für Doofe 😄):
// - Home Assistant schickt alle Daten („subscribe“).
// - Jede Änderung (Haken, Kartenzahlung, Kontostand …) wird als kleine „Änderung“ verschickt.
// - Klappt das Verschicken nicht (kein Netz), landet die Änderung im Postausgang und wird später nachgeschickt.
//   Bis dahin rechnet die Karte selbst so, als wäre sie schon angekommen.
const FK_VERSION = "0.1.0-beta.2";

const PAY = {
  ueberweisung: ["Überweisung", "ü"], dauerauftrag: ["Dauerauftrag", "d"], lastschrift: ["Lastschrift", "l"],
  paypal: ["PayPal", "p"], amex: ["Amex", "a"], google: ["Google", "g"], bar: ["Bar", "b"], keine: ["–", "-"],
};
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const QKEY = "fixkosten_queue";
const PAYPAL = "https://paypal.me/MarcoStrickmann";
const REPO = "https://github.com/misterm2310/fixkosten-card";

// 📖 Anleitung – einfach erklärt, Kapitel zum Aufklappen
const FK_GUIDE = [
  { icon: "cash-check", color: "#43a047", title: "Was heißt „Verfügbar“?", text: `Die große Zahl oben ist das Geld, das du diesen Monat <b>wirklich</b> noch ausgeben kannst:<br><b>Kontostand</b> − <b>Fixkosten, die noch nicht abgehakt sind</b> − <b>Kartenzahlungen, die noch nicht abgebucht sind</b>.<br>Grün = alles gut · Gelb = wird knapp · Rot = unter deiner Warngrenze (⚙️).` },
  { icon: "bank-outline", color: "#0288d1", title: "Kontostand eintragen", text: `Tippe auf die Kachel <b>„Konto“</b> und gib den Stand aus deiner Bank-App ein. Das Datum daneben zeigt, wann du ihn zuletzt eingetragen hast. Vorgemerkte Umsätze trägst du in ⚙️ → „Rechnen & Warnung“ ein.` },
  { icon: "calendar-month-outline", color: "#3949ab", title: "Fixkosten abhaken", text: `Deine Fixkosten stehen in Gruppen wie <b>„ab dem 1.“</b> und <b>„ab dem 15.“</b>. Die Gruppen sind <b>zugeklappt</b>: Tipp auf die Überschrift klappt sie auf (die Karte merkt sich das). Rechts steht „2 / 4“ und was noch offen ist.<br>Ist ein Posten vom Konto abgebucht: <b>Kreis antippen</b> ✅. Am Monatsanfang gehen die Haken von selbst wieder auf (Schalter in ⚙️ → „Rechnen & Warnung“).<br>Hat ein Posten einen <b>festen Tag</b> (z. B. am 5.), steht oben ein Hinweis auf die nächste Abbuchung. <b>Pausierte</b> Posten (⏸️) stehen grau und abgehakt mit drin und zählen nicht mit.` },
  { icon: "credit-card-outline", color: "#ff9800", title: "Kartenzahlungen", text: `Mit Karte bezahlt? Schnellknopf antippen (z. B. „Bäckerei“) oder selbst etwas eintippen, Betrag rein, <b>＋</b>. Der Betrag ist <b>sofort</b> von „Verfügbar“ abgezogen.<br>Taucht er auf dem Konto auf: <b>„✓ abgebucht“</b>. Dann steckt er im Kontostand und fliegt aus der Rechnung. Die Schnellknöpfe stellst du in ⚙️ → „Schnellknöpfe“ ein (einer pro Zeile).` },
  { icon: "calculator-variant-outline", color: "#7b1fa2", title: "Taschenrechner", text: `Oben auf 🧮 tippen. Rechnet mit + − × ÷ und %. <b>V</b> setzt „Verfügbar“ ein.<br>Das Ergebnis übernimmst du mit einem Tipp als <b>Kartenzahlung</b>, als <b>Kontostand</b> oder kopierst es.` },
  { icon: "piggy-bank-outline", color: "#e91e63", title: "Töpfe, offene Stände, Konten", text: `<b>🐷 Töpfe:</b> Was wo liegt (Sparkonto, Bargeld zu Hause, PayPal …). Antippen = Stand ändern. „Komplett“ = Konto + alle Töpfe.<br><b>🧾 Offene Stände:</b> Was du noch begleichen musst. Erledigt? „✓ beglichen“. Auf Wunsch zieht ⚙️ sie von „Verfügbar“ ab.<br><b>🏦 Meine Konten:</b> Deine IBANs. 📋 kopiert sie für Überweisungen.<br><b>💵 Einnahmen</b> sind nur Info und ändern „Verfügbar“ nicht.` },
  { icon: "pencil-outline", color: "#00897b", title: "Bearbeiten", text: `Unter <b>„Bearbeiten“</b> legst du alles an (＋ Neu) oder tippst einen Eintrag zum Ändern an. Posten können auf <b>bestimmte Monate</b> beschränkt werden (z. B. Kfz-Steuer nur im März) oder <b>pausiert</b> werden. Neue Gruppen bekommen einen Starttag (1–28).<br><b>Reihenfolge ändern:</b> am Griff ⠿ ziehen oder ▲▼ tippen. Fixkosten kannst du so auch in eine andere Gruppe schieben. Das klappt auch bei Töpfen, Einnahmen, offenen Ständen und Konten.` },
  { icon: "chart-bar", color: "#5e35b1", title: "Rückblick", text: `Am Monatsende merkt sich die Karte den Monat von selbst: Fixkosten, Kartenzahlungen, Einnahmen und was am Ende übrig war (bis zu 3 Jahre).` },
  { icon: "eye-off-outline", color: "#607d8b", title: "Beträge verstecken", text: `Das 👁️ oben verschwimmt alle Beträge und IBANs, z. B. wenn jemand mitschaut. Nochmal tippen = wieder zeigen. Mit <code>privat: true</code> im Karten-YAML startet die Karte versteckt.` },
  { icon: "cellphone-lock", color: "#1e88e5", title: "Offline-App mit Fingerabdruck", text: `Deine Adresse für die App steht in ⚙️ → <b>„Offline-App“</b> (mit Kopieren-Knopf). Im Handy-Browser öffnen → anmelden → im Browser-Menü „Zum Startbildschirm“.<br>Ohne Netz siehst du den letzten Stand. Was du einträgst, wartet im <b>Postausgang</b> (oben „⏳ wartet“) und wird von selbst nachgeschickt. Nichts zählt doppelt.<br>Unten in der App: <b>„👆 Fingerabdruck-Sperre“</b>. Abmelden löscht alle Zahlen aus dem Handy.` },
  { icon: "shield-key-outline", color: "#455a64", title: "PIN-Sperre und Seitenleiste", text: `In ⚙️ unter <b>„Schutz (PIN)“</b> legst du eine PIN (4–8 Ziffern) fest. Dann fragen ⚙️ und „Bearbeiten“ danach. Übersicht, Abhaken und Kartenzahlungen gehen weiter ohne PIN. Das 🔓 oben sperrt sofort wieder (sonst nach 10 Minuten Ruhe).<br><b>PIN vergessen?</b> Kein Drama: Ein Admin geht auf <b>Einstellungen → Geräte & Dienste → Fixkosten → Konfigurieren</b> und hakt <b>„PIN zurücksetzen“</b> an.<br>Im selben Fenster schaltest du auch <b>„In der Seitenleiste anzeigen“</b> an oder aus.` },
  { icon: "upload", color: "#546e7a", title: "CSV einlesen und sichern", text: `In ⚙️ → <b>„Daten (CSV)“</b> (nur Admins): Datei wählen oder Text einfügen → „Einlesen“. Spalten: <b>Typ;Name;Betrag;Gruppe/Datum;Zahlart;Notiz</b>. „Als CSV sichern“ lädt alles als Datei herunter.` },
  { icon: "lock-outline", color: "#455a64", title: "Datenschutz", text: `Alles bleibt in <b>deinem</b> Home Assistant. Keine Cloud, kein Tracking, nichts geht ins Internet. IBANs stehen bewusst in keinem Sensor.` },
];
const DKEY = "fixkosten_data";
const HKEY = "fixkosten_hidden";
const OKEY = "fixkosten_offen"; // 📂 welche Abschnitte aufgeklappt sind (Standard: alle zu)

const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const money = (v) => eur.format(Number(v) || 0);
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2) + Date.now().toString(36));
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
function parseMoney(v) {
  if (typeof v === "number") return Math.round(v * 100) / 100;
  let s = String(v ?? "").replace(/€|EUR|\s| /g, "").replace("−", "-");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* voll/privat */ } },
};

// 🔒 Entsperrt gilt für alle Fixkosten-Karten dieser Seite, bis 🔒 angetippt wird oder 10 Minuten nichts passiert
const PIN_LOCK = { until: 0 };
const pinOpen = () => PIN_LOCK.until > Date.now();
const pinTouch = () => { if (pinOpen()) PIN_LOCK.until = Date.now() + 10 * 60 * 1000; };
const ic = (name) => `<ha-icon icon="mdi:${name}"></ha-icon>`;

// 🧮 Taschenrechner: rechnet „12,50 + 3 × 2“ selbst aus (Punkt vor Strich, % = geteilt durch 100). Kein eval – sicher.
function calcEval(expr) {
  const src = String(expr || "").replace(/\s/g, "");
  if (!src) return null;
  const toks = src.match(/\d+(?:[.,]\d*)?|[-+×÷%−]/g);
  if (!toks || toks.join("") !== src) return null;
  const out = [], ops = [];
  const prec = { "+": 1, "−": 1, "-": 1, "×": 2, "÷": 2 };
  const apply = () => {
    const o = ops.pop(), b = out.pop(), a = out.pop();
    if (a === undefined || b === undefined) throw new Error("x");
    out.push(o === "+" ? a + b : o === "×" ? a * b : o === "÷" ? (b === 0 ? NaN : a / b) : a - b);
  };
  let expectNum = true, sign = 1;
  try {
    for (const t of toks) {
      if (/\d/.test(t)) { out.push(sign * Number(t.replace(",", "."))); sign = 1; expectNum = false; }
      else if (t === "%") { if (expectNum) return null; out.push(out.pop() / 100); }
      else if (expectNum && (t === "−" || t === "-")) sign = -sign;
      else if (expectNum) return null;
      else { while (ops.length && prec[ops[ops.length - 1]] >= prec[t]) apply(); ops.push(t); expectNum = true; }
    }
    if (expectNum) return null;
    while (ops.length) apply();
  } catch (_) { return null; }
  const r = out[0];
  return out.length === 1 && Number.isFinite(r) ? Math.round(r * 100) / 100 : null;
}
const numDe = (v) => String(v).replace(".", ",");

// ---------------------------------------------------------------- 🧮 Rechnen (genau wie in manager.py)
function countsThisMonth(d, it) {
  if (it.active === false) return false;
  const m = it.months || [];
  return !m.length || m.includes(Number(String(d.month || monthKey()).slice(5, 7)));
}
function summary(d) {
  const today = new Date().getDate();
  const groups = [...(d.groups || [])].sort((a, b) => (a.start_day || 1) - (b.start_day || 1));
  const paid = d.paid || {};
  let fixTotal = 0, fixOpen = 0, next = null;
  const gi = groups.map((g) => {
    const items = d.posten.filter((p) => p.group === g.id && countsThisMonth(d, p));
    const open = items.filter((p) => !paid[p.id]?.paid);
    const total = items.reduce((s, p) => s + p.amount, 0), openSum = open.reduce((s, p) => s + p.amount, 0);
    const due = today >= (g.start_day || 1);
    fixTotal += total; fixOpen += openSum;
    if (open.length && !next) next = { name: open[0].name, amount: open[0].amount, group: g.name, start_day: g.start_day, due };
    return { ...g, due, total, open: openSum, count: items.length, done: items.length - open.length };
  });
  const known = new Set(groups.map((g) => g.id));
  for (const p of d.posten) if (!known.has(p.group) && countsThisMonth(d, p)) { fixTotal += p.amount; if (!paid[p.id]?.paid) fixOpen += p.amount; }
  const incomeTotal = d.einnahmen.filter((e) => countsThisMonth(d, e)).reduce((s, e) => s + e.amount, 0);
  const k = d.konto || {};
  const bookingsOpen = d.bookings.filter((b) => !b.cleared).reduce((s, b) => s + b.amount, 0);
  const bookingsMonth = d.bookings.filter((b) => b.month === d.month).reduce((s, b) => s + b.amount, 0);
  const pots = d.toepfe.reduce((s, t) => s + t.amount, 0);
  const debts = d.staende.reduce((s, x) => s + x.amount, 0);
  const available = (k.balance || 0) + (k.pending || 0) - fixOpen - bookingsOpen - (d.settings?.debts_subtract ? debts : 0);
  return {
    month: d.month, today, available, balance: k.balance || 0, pending: k.pending || 0, balance_updated: k.updated || 0,
    fix_total: fixTotal, fix_open: fixOpen, fix_paid: fixTotal - fixOpen, income_total: incomeTotal, surplus: incomeTotal - fixTotal,
    bookings_open: bookingsOpen, bookings_month: bookingsMonth, pots_total: pots, debts, total: pots + (k.balance || 0),
    warn: available < (d.settings?.warn_below || 0), next, groups: gi,
  };
}
// Eine Änderung schon mal hier anwenden (damit man sofort sieht, was passiert – auch ohne Netz)
const KIND = { posten: "posten", einnahme: "einnahmen", topf: "toepfe", stand: "staende", konto: "konten", gruppe: "groups" };
function applyLocal(d, op) {
  const t = op.type;
  const [kind, verb] = t.split("_");
  if (KIND[kind] && verb === "save") {
    const list = d[KIND[kind]], it = op.item || {};
    const old = it.id && list.find((x) => x.id === it.id);
    const next = { ...(old || { id: it.id || op.op_id, active: true, months: [], pay: "keine", group: d.groups[0]?.id }), ...it };
    if ("amount" in it && kind !== "konto") next.amount = Math.abs(parseMoney(it.amount)) || 0;
    if (old) Object.assign(old, next); else list.push(next);
  } else if (KIND[kind] && verb === "delete") {
    d[KIND[kind]] = d[KIND[kind]].filter((x) => x.id !== op.id);
  } else if (t === "paid") {
    if (!op.month || op.month === d.month) d.paid[op.id] = { paid: !!op.value, ts: op.ts };
  } else if (t === "reset_checks") { d.paid = {}; d.received = {}; }
  else if (t === "konto") {
    if ("balance" in op) { d.konto.balance = parseMoney(op.balance); d.konto.updated = op.ts; }
    if ("pending" in op) d.konto.pending = parseMoney(op.pending);
  } else if (t === "booking_add") {
    if (d.bookings.some((b) => b.id === op.op_id)) return; // schon bei HA angekommen
    d.bookings.push({ id: op.op_id, name: op.name, amount: parseMoney(op.amount), ts: op.ts, month: monthKey(new Date(op.ts)), cleared: false, waiting: true });
  } else if (t === "booking_clear") { const b = d.bookings.find((x) => x.id === op.id); if (b) b.cleared = !!op.value; }
  else if (t === "booking_delete") d.bookings = d.bookings.filter((x) => x.id !== op.id);
  else if (t === "restore") {
    const key = op.kind === "booking" ? "bookings" : KIND[op.kind];
    if (key && op.item?.id && !d[key].some((x) => x.id === op.item.id)) d[key].splice(Math.min(op.index ?? d[key].length, d[key].length), 0, { ...op.item });
  }
  else if (t === "order" && KIND[op.kind]) {
    const key = KIND[op.kind], pos = new Map((op.ids || []).map((x, i) => [x, i]));
    d[key] = d[key].map((x, i) => [x, i]).sort((a, b) => (pos.get(a[0].id) ?? 1e6 + a[1]) - (pos.get(b[0].id) ?? 1e6 + b[1])).map((x) => x[0]);
    if (op.kind === "posten") for (const x of d[key]) { const g = op.groups?.[x.id]; if (g && d.groups.some((y) => y.id === g)) x.group = g; }
  }
  else if (t === "settings") d.settings = { ...d.settings, ...op.settings, warn_below: "warn_below" in (op.settings || {}) ? parseMoney(op.settings.warn_below) : d.settings.warn_below };
}

// ---------------------------------------------------------------- 🎨 Aussehen
const CSS = `
:host { display:block; --fk-green:var(--success-color,#43a047); --fk-yellow:var(--warning-color,#ffa600); --fk-red:var(--error-color,#db4437); --pc:var(--primary-color,#03a9f4); }
ha-card { display:block; padding:12px 12px 8px; overflow:hidden; background:var(--ha-card-background, var(--card-background-color)); border-radius:var(--ha-card-border-radius, 12px); }
* { box-sizing:border-box; }
button { font:inherit; color:inherit; }
ha-icon { --mdc-icon-size:20px; display:inline-flex; }
input, select, textarea { font:inherit; font-size:.95em; color:var(--primary-text-color); background:var(--card-background-color, var(--ha-card-background, #fff)); border:1px solid color-mix(in srgb, var(--primary-text-color, #000) 22%, transparent); border-radius:12px; padding:9px 10px; min-width:0; width:100%; outline:none; }
input::placeholder, textarea::placeholder { color:var(--secondary-text-color); opacity:.75; }
input:focus, select:focus, textarea:focus { border-color:var(--pc); box-shadow:0 0 0 2px color-mix(in srgb, var(--pc) 18%, transparent); }
input.swchk { -webkit-appearance:none; appearance:none; flex:none; width:40px; height:22px; margin:0; border:0; border-radius:12px; background:#bdbdbd; position:relative; cursor:pointer; transition:background .15s; padding:0; box-shadow:none; }
input.swchk::after { content:""; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.3); transition:left .15s; }
input.swchk:checked { background:var(--pc); }
input.swchk:checked::after { left:20px; }
/* 🟢 Leiste oben – wie bei der Einkaufsliste */
.topbar { display:flex; align-items:center; gap:8px; margin:0 4px 8px; font-size:13px; color:var(--secondary-text-color); }
.topbar .grow { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.topbar .ver { opacity:.8; }
.pill { cursor:pointer; border-radius:999px; padding:2px 10px; background:color-mix(in srgb, var(--fk-green) 18%, transparent); color:var(--primary-text-color); white-space:nowrap; border:0; font-size:13px; }
.pill.wait { background:color-mix(in srgb, var(--fk-yellow) 25%, transparent); }
.pill.off { background:color-mix(in srgb, var(--fk-red) 20%, transparent); }
.iconbtn { background:none; border:0; cursor:pointer; padding:6px; border-radius:50%; display:inline-flex; color:var(--secondary-text-color); line-height:0; }
.iconbtn:hover { background:var(--secondary-background-color, rgba(127,127,127,.12)); color:var(--primary-text-color); }
.iconbtn.on { color:var(--pc); }
.head { display:flex; align-items:center; gap:8px; margin:4px 4px 8px; }
.head .logo { color:var(--fk-green); --mdc-icon-size:28px; }
.badge { background:var(--pc); color:var(--text-primary-color,#fff); border-radius:999px; padding:1px 9px; font-size:.8em; font-weight:600; }
.tabs { display:flex; gap:6px; overflow-x:auto; padding:2px 2px 8px; scrollbar-width:none; }
.tabs::-webkit-scrollbar { display:none; }
.tab { flex:0 0 auto; border:1.5px solid color-mix(in srgb, var(--pc) 55%, transparent); background:transparent; border-radius:999px; padding:7px 14px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:.95em; }
.tab ha-icon { --mdc-icon-size:18px; }
.tab.active { background:var(--pc); border-color:var(--pc); color:var(--text-primary-color,#fff); }
.tip { display:flex; align-items:center; gap:8px; border-radius:12px; padding:9px 12px; margin:2px 2px 8px; background:color-mix(in srgb, var(--fk-yellow) 18%, transparent); font-size:.9em; }
.hero { border-radius:12px; padding:12px 14px; margin:2px 2px 10px; background:color-mix(in srgb, var(--hc, var(--fk-green)) 12%, transparent); }
.hero .lbl { font-size:.85em; color:var(--secondary-text-color); }
.big { font-size:2.4em; font-weight:700; line-height:1.15; color:var(--hc, var(--fk-green)); font-variant-numeric:tabular-nums; cursor:pointer; }
.bar { height:8px; background:color-mix(in srgb, var(--primary-text-color) 10%, transparent); border-radius:5px; overflow:hidden; margin-top:8px; }
.bar i { display:block; height:100%; background:var(--hc, var(--fk-green)); border-radius:5px; }
.tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:0 2px 10px; }
.tile { background:var(--secondary-background-color, rgba(127,127,127,.1)); border-radius:12px; padding:8px 10px; border:0; text-align:left; min-width:0; }
.tile.click { cursor:pointer; }
.tile b { display:block; font-size:1em; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tile span { font-size:.75em; color:var(--secondary-text-color); display:flex; align-items:center; gap:3px; }
.tile span ha-icon { --mdc-icon-size:13px; }
.next { display:flex; align-items:center; gap:8px; border-radius:12px; padding:9px 12px; margin:0 2px 6px; background:color-mix(in srgb, var(--fk-yellow) 15%, transparent); font-size:.92em; }
.next ha-icon { color:var(--fk-yellow); }
.ghead { display:flex; align-items:center; gap:8px; font-size:.95em; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--secondary-text-color); padding:14px 4px 4px; }
.ghead .gdot { width:24px; height:24px; flex:none; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:color-mix(in srgb, var(--gc, var(--pc)) 18%, transparent); color:var(--gc, var(--pc)); }
.ghead .gdot ha-icon { --mdc-icon-size:15px; }
.ghead.click { cursor:pointer; border-radius:10px; }
.ghead.click:hover { background:var(--secondary-background-color, rgba(127,127,127,.08)); }
.ghead .chev { display:inline-flex; color:var(--secondary-text-color); }
.ghead.click .n { margin-left:auto; }
.ghead .n { margin-left:auto; font-weight:500; text-transform:none; letter-spacing:0; font-size:.9em; }
.item { display:flex; align-items:center; gap:10px; padding:9px 6px; border-radius:10px; }
.item + .item { border-top:1px solid var(--divider-color, rgba(127,127,127,.15)); }
.item.click { cursor:pointer; }
.chk { width:26px; height:26px; flex:none; border-radius:50%; border:2px solid color-mix(in srgb, var(--primary-text-color) 35%, transparent); background:none; cursor:pointer; color:#fff; padding:0; display:inline-flex; align-items:center; justify-content:center; }
.chk ha-icon { --mdc-icon-size:17px; }
.chk.on { background:var(--fk-green); border-color:var(--fk-green); }
.item.done .n b { color:var(--secondary-text-color); text-decoration:line-through; font-weight:400; }
.n { flex:1; min-width:0; }
.n b { font-weight:400; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meta { display:flex; flex-wrap:wrap; gap:4px; margin-top:3px; }
.tag { font-size:.75em; border-radius:999px; padding:1px 8px; background:var(--secondary-background-color, rgba(127,127,127,.15)); color:var(--secondary-text-color); white-space:nowrap; }
.tag.wait { background:color-mix(in srgb, var(--fk-yellow) 25%, transparent); color:var(--primary-text-color); }
.amt { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.neg { color:var(--fk-red); } .pos { color:var(--fk-green); }
.quick { display:flex; flex-wrap:wrap; gap:6px; margin:4px 2px 6px; }
.chip { border:1.5px solid color-mix(in srgb, var(--pc) 55%, transparent); background:transparent; border-radius:999px; padding:5px 12px; cursor:pointer; font-size:.9em; }
.chip.on { background:var(--pc); border-color:var(--pc); color:var(--text-primary-color,#fff); }
form.add { display:grid; grid-template-columns:1fr 110px 48px; gap:6px; margin:2px 2px 6px; }
form.add input.amount { text-align:right; }
.addbtn { border:0; border-radius:12px; background:var(--fk-green); color:#fff; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.addbtn ha-icon { --mdc-icon-size:26px; }
.btn { display:inline-flex; align-items:center; gap:6px; border:1px solid color-mix(in srgb, var(--primary-text-color) 22%, transparent); background:transparent; border-radius:12px; padding:7px 12px; cursor:pointer; font-size:.9em; min-height:36px; }
.btn ha-icon { --mdc-icon-size:18px; }
.btn.main { background:var(--pc); border-color:var(--pc); color:var(--text-primary-color,#fff); }
.btn.ok { color:var(--fk-green); border-color:color-mix(in srgb, var(--fk-green) 45%, transparent); }
.btn.small { padding:4px 9px; min-height:30px; font-size:.82em; }
.sum { display:flex; justify-content:space-between; padding:8px 6px 0; font-weight:600; }
.edit { border:1px solid var(--divider-color, rgba(127,127,127,.2)); border-radius:12px; padding:10px; margin:6px 2px; }
.f { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.f label { display:flex; flex-direction:column; gap:3px; font-size:.8em; color:var(--secondary-text-color); }
.f label.wide { grid-column:1 / -1; }
.months { display:flex; flex-wrap:wrap; gap:4px; }
.months button { border:1.5px solid color-mix(in srgb, var(--pc) 45%, transparent); background:none; border-radius:999px; padding:3px 9px; font-size:.85em; cursor:pointer; }
.months button.on { background:var(--pc); color:#fff; border-color:var(--pc); }
.btnrow { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.btnrow.end { justify-content:flex-end; }
.switch { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 4px; border-bottom:1px solid var(--divider-color, rgba(127,127,127,.15)); }
.switch span { display:flex; align-items:center; gap:8px; }
.hist { display:flex; align-items:flex-end; gap:6px; height:150px; padding:8px 0 0; border-bottom:1px solid var(--divider-color); }
.hist .m { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:2px; min-width:0; }
.hist .m span { font-size:10.5px; color:var(--secondary-text-color); }
.legend { display:flex; gap:12px; font-size:12px; color:var(--secondary-text-color); margin:6px 4px; }
.legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:4px; vertical-align:-1px; }
table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
td, th { padding:6px 4px; border-bottom:1px solid var(--divider-color); text-align:right; font-variant-numeric:tabular-nums; }
td:first-child, th:first-child { text-align:left; }
.hidden-amt { filter:blur(7px); user-select:none; }
.empty { text-align:center; padding:16px 8px; color:var(--secondary-text-color); font-size:.92em; }
.small { font-size:.82em; color:var(--secondary-text-color); margin:6px 4px; }
.footer { display:flex; align-items:center; justify-content:center; gap:6px; font-size:.75em; color:var(--secondary-text-color); margin:12px 4px 2px; border-top:1px solid var(--divider-color, rgba(127,127,127,.2)); padding-top:8px; }
.footer .fbtn { font:inherit; font-size:12.5px; color:inherit; background:none; text-decoration:underline; border:1px solid var(--divider-color, rgba(127,127,127,.25)); border-radius:10px; padding:8px 12px; cursor:pointer; }
.footer .fbtn.on { border-color:var(--pc); color:var(--pc); }
details.gsec { border-radius:12px; margin:6px 2px; background:var(--secondary-background-color, rgba(127,127,127,.08)); }
details.gsec summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:10px; padding:10px 12px; font-weight:600; }
details.gsec summary::-webkit-details-marker { display:none; }
details.gsec .gdot { width:28px; height:28px; flex:none; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:color-mix(in srgb, var(--gc) 20%, transparent); color:var(--gc); }
details.gsec .gdot ha-icon { --mdc-icon-size:17px; }
details.gsec .gtext { padding:0 14px 12px 50px; font-size:.92em; line-height:1.5; }
a.btn { text-decoration:none; color:inherit; }
a.btn.paypal { background:#0070ba; border-color:#0070ba; color:#fff; }
a { color:var(--pc); }
/* 🧮 Taschenrechner */
.calc { border-radius:12px; padding:10px; margin:0 2px 10px; background:var(--secondary-background-color, rgba(127,127,127,.1)); }
.calc .disp { display:flex; flex-direction:column; align-items:flex-end; background:var(--card-background-color); border-radius:10px; padding:6px 12px; margin-bottom:8px; min-height:62px; }
.calc .expr { font-size:.9em; color:var(--secondary-text-color); min-height:1.3em; word-break:break-all; text-align:right; }
.calc .res { font-size:1.8em; font-weight:600; font-variant-numeric:tabular-nums; }
.calc .keys { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
.calc .keys button { border:0; border-radius:10px; padding:12px 0; font-size:1.15em; cursor:pointer; background:var(--card-background-color); }
.calc .keys button.op { color:var(--pc); font-weight:600; }
.calc .keys button.eq { background:var(--pc); color:#fff; }
.calc .keys button.cl { color:var(--fk-red); }
/* ⏸️ pausiert */
.item.paused .chk { opacity:.6; cursor:default; }
/* ⠿ Verschieben */
.olist { display:flex; flex-direction:column; }
.olist .item { border-top:1px solid var(--divider-color, rgba(127,127,127,.15)); }
.grip { display:inline-flex; color:var(--secondary-text-color); cursor:grab; touch-action:none; padding:4px 2px; margin:-4px 0; }
.item.drag { background:color-mix(in srgb, var(--pc) 12%, transparent); box-shadow:0 2px 8px rgba(0,0,0,.25); }
.mv { display:inline-flex; }
.mv .iconbtn { padding:3px; }
.gsub { font-size:.78em; font-weight:600; color:var(--secondary-text-color); text-transform:uppercase; letter-spacing:.04em; padding:8px 6px 2px; }
/* ⚙️ Kategorien + Kacheln wie bei der Einkaufsliste */
.scat { font-size:.85em; font-weight:600; color:var(--secondary-text-color); margin:12px 4px 6px; }
.stiles { display:flex; flex-direction:column; gap:6px; }
.stile { display:flex; align-items:center; gap:10px; width:100%; text-align:left; border:0; cursor:pointer; padding:10px 12px; border-radius:12px; background:var(--secondary-background-color, rgba(127,127,127,.08)); }
.stile .st { flex:1; display:flex; flex-direction:column; }
.stile small { color:var(--secondary-text-color); }
.stile .gdot, .shead .gdot { width:30px; height:30px; flex:none; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:color-mix(in srgb, var(--gc) 18%, transparent); color:var(--gc); }
.stile .gdot ha-icon, .shead .gdot ha-icon { --mdc-icon-size:18px; }
.sheet { position:fixed; inset:0; z-index:9; background:rgba(0,0,0,.45); display:flex; align-items:flex-end; justify-content:center; padding:12px; }
.sbox { width:100%; max-width:520px; max-height:88vh; overflow:auto; border-radius:18px; background:var(--ha-card-background, var(--card-background-color, #fff)); box-shadow:0 8px 30px rgba(0,0,0,.35); padding:6px 12px 14px; }
@media (min-width:600px) { .sheet { align-items:center; } }
.shead { display:flex; align-items:center; gap:10px; padding:8px 0; position:sticky; top:-6px; background:inherit; z-index:1; }
.shead b { flex:1; font-size:1.05em; }
.sbody textarea, .sbody input[readonly] { width:100%; }
.undo { position:sticky; bottom:8px; z-index:5; display:flex; align-items:center; justify-content:space-between; gap:10px; margin:10px 2px 0; padding:8px 8px 8px 14px; border-radius:12px; background:#323232; color:#fff; box-shadow:0 4px 14px rgba(0,0,0,.35); font-size:.92em; }
.undo .btn { color:#8ab4f8; background:transparent; border:0; }
ol.steps { padding-left:22px; }
ol.steps li { margin:3px 0; }
`;

class FixkostenCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._view = "home";
    this._open = null;          // welcher Eintrag gerade bearbeitet wird
    this._quickName = null;     // gewählter Schnellknopf
    this._queue = store.get(QKEY, []);
    this._server = null;        // letzter Stand von Home Assistant
    this._hidden = store.get(HKEY, null);
    this._openSec = new Set(store.get(OKEY, []));
    this._sheet = null;         // welches Einstellungs-Fenster offen ist
  }

  static getStubConfig() { return { title: "Fixkosten" }; }
  getCardSize() { return 8; }
  setConfig(config) {
    this._config = { title: "Fixkosten", ...config };
    if (this._hidden == null) this._hidden = !!this._config.privat; // 🙈 Beträge erst nach Antippen zeigen
  }

  get _app() { return !!window.__fkOfflineApp; }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      if (this._app) this._server = store.get(DKEY, null); // 📱 letzter Stand – auch ohne Netz
      this._subscribe();
      this._render();
    }
    if (hass.connected !== false) this._flush();
  }

  connectedCallback() { if (this._hass && !this._unsub) this._subscribe(); }
  disconnectedCallback() { this._unsub?.then((u) => u?.()).catch(() => {}); this._unsub = null; }

  _subscribe() {
    if (this._unsub || !this._hass?.connection) return;
    this._unsub = this._hass.connection.subscribeMessage((data) => {
      this._server = data;
      if (this._app) store.put(DKEY, data);
      this._render();
    }, { type: "fixkosten/subscribe" }).catch((err) => { this._err = err?.message || String(err); this._unsub = null; this._render(); });
  }

  // Der Stand, den man sieht = Stand von HA + alles, was noch im Postausgang liegt
  get _data() {
    if (!this._server) return null;
    const d = JSON.parse(JSON.stringify(this._server));
    for (const k of ["groups", "posten", "einnahmen", "toepfe", "staende", "konten", "bookings", "history"]) d[k] = d[k] || [];
    d.paid = d.paid || {}; d.konto = d.konto || {}; d.settings = d.settings || {};
    for (const op of this._queue) applyLocal(d, op);
    d.summary = summary(d);
    return d;
  }

  // ---------------------------------------------------------------- 📮 Änderungen verschicken (mit Postausgang)
  _send(op) {
    op = { op_id: uid(), ts: Date.now(), ...op };
    this._queue.push(op);
    store.put(QKEY, this._queue);
    this._render();
    this._flush();
  }
  async _flush() {
    if (this._flushing || !this._queue.length || !this._hass) return;
    this._flushing = true;
    try {
      const batch = this._queue.slice(0, 100);
      const res = await this._hass.callWS({ type: "fixkosten/apply", ops: batch });
      const done = new Set(batch.map((o) => o.op_id));
      const failed = (res?.results || []).filter((r) => !r.ok);
      this._queue = this._queue.filter((o) => !done.has(o.op_id));
      store.put(QKEY, this._queue);
      if (failed.length) this._toast("⚠️ " + failed.map((f) => f.error).join(", "));
      this._render();
      if (this._queue.length) setTimeout(() => this._flush(), 50);
    } catch (_) {
      // 📴 kein Netz – bleibt im Postausgang, nächster Versuch beim nächsten Kontakt
      clearTimeout(this._retry);
      this._retry = setTimeout(() => this._flush(), 15000);
    } finally { this._flushing = false; }
  }

  _toast(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }

  // ---------------------------------------------------------------- 🖼️ Zeichnen (Optik wie die Einkaufsliste)
  _m(v, cls = "") { return `<span class="${cls} ${this._hidden ? "hidden-amt" : ""}">${money(v)}</span>`; }
  // 📂 Abschnitt zum Auf- und Zuklappen (Standard: zu)
  _ghc(key, icon, color, title, right = "") {
    const open = this._openSec.has(key);
    return `<div class="ghead click" data-a="sec" data-v="${esc(key)}"><span class="gdot" style="--gc:${color}">${ic(icon)}</span><span>${title}</span><span class="n">${right}</span><span class="chev">${ic(open ? "chevron-up" : "chevron-down")}</span></div>`;
  }
  _gh(icon, color, title, right = "") {
    return `<div class="ghead"><span class="gdot" style="--gc:${color}">${ic(icon)}</span><span>${title}</span><span class="n">${right}</span></div>`;
  }
  _greet() {
    const h = new Date().getHours();
    const g = h < 11 ? "☀️ Guten Morgen" : h < 18 ? "🌤️ Hallo" : "🌙 Guten Abend";
    const name = String(this._hass?.user?.name || "").split(" ")[0];
    return name ? `${g}, ${esc(name)}` : g;
  }

  _render() {
    // ✍️ Nicht neu zeichnen, während jemand tippt – sonst springt der Cursor weg
    if (this._dragging) { this._pending = true; return; } // ⠿ beim Ziehen nicht neu zeichnen
    const a = this.shadowRoot.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT") && !this._force) { this._pending = true; return; }
    this._force = false;
    const d = this._data;
    const online = this._hass?.connected !== false;
    const q = this._queue.length;
    const pill = q ? `<button class="pill wait" data-a="tab" data-v="home">⏳ ${q} ${q === 1 ? "wartet" : "warten"}</button>`
      : online ? `<button class="pill" data-a="tab" data-v="home">🟢 verbunden</button>`
      : `<button class="pill off" data-a="tab" data-v="home">${this._app ? "📴 offline – letzter Stand" : "🔴 keine Verbindung"}</button>`;
    const top = `<div class="topbar">${pill}<span class="grow">${this._greet()}</span>
      <button class="iconbtn ${this._calc ? "on" : ""}" data-a="calc" title="Taschenrechner">${ic("calculator-variant-outline")}</button>
      <button class="iconbtn ${this._hidden ? "on" : ""}" data-a="hide" title="Beträge ${this._hidden ? "zeigen" : "verstecken"}">${ic(this._hidden ? "eye-off-outline" : "eye-outline")}</button>
      ${d?.pin ? `<button class="iconbtn ${pinOpen() ? "on" : ""}" data-a="lock" title="${pinOpen() ? "Jetzt sperren" : "Gesperrt – PIN nötig für ⚙️ und Bearbeiten"}">${ic(pinOpen() ? "lock-open-variant-outline" : "lock-outline")}</button>` : ""}
      <button class="iconbtn ${this._view === "set" ? "on" : ""}" data-a="tab" data-v="set" title="Einstellungen">${ic("cog-outline")}</button>
      <span class="ver">v${FK_VERSION}</span></div>`;
    let body;
    if (!d) {
      body = this._err ? `<div class="empty">⚠️ ${esc(this._err)}<br>Ist die Integration „Fixkosten“ eingerichtet?</div>` : `<div class="empty">⏳ Lade …</div>`;
    } else {
      const open = d.summary.groups.reduce((n, g) => n + g.count - g.done, 0);
      const tabs = [["home", "view-dashboard-outline", "Übersicht"], ["hist", "chart-bar", "Rückblick"], ["edit", "pencil-outline", "Bearbeiten"]];
      body = `<div class="head"><span class="logo" data-a="tab" data-v="home" style="cursor:pointer">${ic("cash-multiple")}</span>${open ? `<span class="badge" title="offene Fixkosten">${open}</span>` : ""}</div>
        <div class="tabs">${tabs.map(([k, i, l]) => `<button class="tab ${this._view === k ? "active" : ""}" data-a="tab" data-v="${k}">${ic(i)}${l}</button>`).join("")}</div>`;
      if (this._calc) body += this._calcView(d);
      const locked = d.pin && !pinOpen() && (this._view === "edit" || this._view === "set");
      if (!locked) pinTouch();
      body += locked ? this._pinView() : this._view === "guide" ? this._guideView() : this._view === "edit" ? this._editView(d) : this._view === "hist" ? this._histView(d) : this._view === "set" ? this._setView(d) : this._homeView(d);
    }
    this.shadowRoot.innerHTML = `<style>${CSS}</style><ha-card>${top}${body}${this._undo ? `<div class="undo"><span>${esc(this._undo.label)}</span><button class="btn small" data-a="undo">${ic("undo-variant")}Rückgängig</button></div>` : ""}<div class="footer"><button class="fbtn ${this._view === "guide" ? "on" : ""}" data-a="tab" data-v="guide">📖 Anleitung</button></div>${d && this._sheet && this._view === "set" && !(d.pin && !pinOpen()) ? this._sheetHtml(d) : ""}</ha-card>`;
    this._bind();
  }

  // 🧮 Taschenrechner (rechnet selbst – kein eval)
  _calcView(d) {
    const c = this._calc;
    const res = calcEval(c.expr);
    const keys = [["C", "cl"], ["⌫", "cl"], ["%", "op"], ["÷", "op"], ["7"], ["8"], ["9"], ["×", "op"], ["4"], ["5"], ["6"], ["−", "op"], ["1"], ["2"], ["3"], ["+", "op"], ["V", "op"], ["0"], [","], ["=", "eq"]];
    return `<div class="calc"><div class="disp"><div class="expr">${esc(c.expr || " ")}</div><div class="res">${res == null ? "–" : money(res)}</div></div>
      <div class="keys">${keys.map(([k, cl]) => `<button class="${cl || ""}" data-a="ckey" data-v="${k}" title="${k === "V" ? "Verfügbar einsetzen" : ""}">${k}</button>`).join("")}</div>
      <div class="btnrow"><button class="btn small" data-a="cuse" data-v="pay" ${res == null ? "disabled" : ""}>${ic("credit-card-outline")}Als Kartenzahlung</button>
      <button class="btn small" data-a="cuse" data-v="balance" ${res == null ? "disabled" : ""}>${ic("bank-outline")}Als Kontostand</button>
      <button class="btn small" data-a="cuse" data-v="copy" ${res == null ? "disabled" : ""}>${ic("content-copy")}Kopieren</button></div></div>`;
  }

  _homeView(d) {
    const s = d.summary;
    const warn = d.settings.warn_below || 0;
    const hc = s.available < warn ? "var(--fk-red)" : s.available < warn * 2 ? "var(--fk-yellow)" : "var(--fk-green)";
    const pct = s.balance > 0 ? Math.max(0, Math.min(100, (s.available / Math.max(s.balance, 1)) * 100)) : 0;
    const quick = d.settings.quick || [];
    const openBookings = d.bookings.filter((b) => !b.cleared).sort((a, b) => b.ts - a.ts);
    const upd = s.balance_updated ? new Date(s.balance_updated).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : "nie";
    let h = `<div class="hero" style="--hc:${hc}"><div class="lbl">Verfügbar · ${esc(this._monthName(d.month))}</div>
      <div class="big" data-a="hide">${this._m(s.available)}</div><div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div></div>
      <div class="tiles">
        <button class="tile click" data-a="balance"><span>${ic("bank-outline")}Konto ${upd}</span><b>${this._m(s.balance)}</b></button>
        <div class="tile"><span>${ic("calendar-clock")}Fixkosten offen</span><b>${this._m(-s.fix_open, "neg")}</b></div>
        <div class="tile"><span>${ic("credit-card-outline")}Karte offen</span><b>${this._m(-s.bookings_open, "neg")}</b></div>
      </div>`;
    // 📅 Hinweis nur für Posten mit festem Tag: der nächste, der noch nicht abgehakt ist
    const today = new Date().getDate();
    const fixed = d.posten.filter((p) => p.day && countsThisMonth(d, p) && !d.paid[p.id]?.paid).sort((a, b) => ((a.day < today) - (b.day < today)) || a.day - b.day);
    if (fixed.length) { const n = fixed[0]; h += `<div class="next">${ic("calendar-clock")}<span><b>${n.day <= today ? "Fällig" : `Am ${n.day}.`}:</b> ${esc(n.name)} · ${this._m(n.amount)}</span></div>`; }

    // 💳 Kartenzahlungen
    h += this._gh("credit-card-outline", "#ff9800", "Kartenzahlungen", `noch nicht abgebucht · ${this._m(-s.bookings_open)}`);
    h += `<div class="quick">${quick.map((q) => `<button class="chip ${this._quickName === q ? "on" : ""}" data-a="quick" data-v="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <form class="add" data-a="booking"><input name="name" placeholder="Wofür? z. B. Bäckerei" value="${esc(this._quickName || "")}" autocomplete="off">
      <input name="amount" class="amount" placeholder="0,00 €" inputmode="decimal" autocomplete="off" value="${esc(this._prefAmount || "")}"><button class="addbtn" type="submit" title="Eintragen">${ic("plus")}</button></form>`;
    h += openBookings.length ? openBookings.map((b) => `<div class="item"><div class="n"><b>${esc(b.name)}</b><div class="meta"><span class="tag">${new Date(b.ts).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>${b.by ? `<span class="tag">${esc(b.by)}</span>` : ""}${this._queue.some((o) => o.op_id === b.id) ? `<span class="tag wait">⏳ wartet</span>` : ""}</div></div>
      <div class="amt">${this._m(-b.amount, "neg")}</div>
      <button class="btn small ok" data-a="clear" data-id="${esc(b.id)}" title="Ist jetzt auf dem Konto abgebucht">${ic("check")}abgebucht</button>
      <button class="iconbtn" data-a="bdel" data-id="${esc(b.id)}" title="Löschen">${ic("close")}</button></div>`).join("") : `<div class="empty">Nichts offen 🎉</div>`;

    // 📋 Fixkosten nach Gruppen
    // ⏸️ Pausierte stehen mit drin, gelten aber als abgehakt (zählen nicht mit)
    const shown = (p) => p.active === false || countsThisMonth(d, p);
    for (const g of s.groups) {
      const items = d.posten.filter((p) => p.group === g.id && shown(p));
      if (!items.length) continue;
      const k = "g:" + g.id, sumOpen = items.filter((p) => countsThisMonth(d, p) && !d.paid[p.id]?.paid).reduce((x, p) => x + p.amount, 0);
      h += this._ghc(k, "calendar-month-outline", g.done >= g.count ? "var(--fk-green)" : "var(--pc)", esc(g.name), `${g.done} / ${g.count}${sumOpen ? ` · ${this._m(-sumOpen, "neg")}` : " ✅"}`);
      if (this._openSec.has(k)) h += items.map((p) => this._postenRow(d, p)).join("");
    }
    const loose = d.posten.filter((p) => !d.groups.some((g) => g.id === p.group) && shown(p));
    if (loose.length) h += this._ghc("g:-", "calendar-month-outline", "#9e9e9e", "Ohne Gruppe", String(loose.length)) + (this._openSec.has("g:-") ? loose.map((p) => this._postenRow(d, p)).join("") : "");
    if (!d.posten.length) h += `<div class="empty">Noch keine Fixkosten. Unter „Bearbeiten“ anlegen oder unter ⚙️ eine CSV-Datei einlesen.</div>`;

    // 💰 Einnahmen (nur Info)
    if (d.einnahmen.length) {
      h += this._ghc("einnahmen", "cash-plus", "var(--fk-green)", "Einnahmen (Info)", this._m(s.income_total, "pos"));
      if (this._openSec.has("einnahmen")) h += d.einnahmen.filter((e) => countsThisMonth(d, e)).map((e) => `<div class="item"><div class="n"><b>${esc(e.name)}</b>${e.date ? `<div class="meta"><span class="tag">${esc(e.date)}</span></div>` : ""}</div><div class="amt">${this._m(e.amount, "pos")}</div></div>`).join("");
      h += `<div class="sum"><span>Bleibt nach Fixkosten</span>${this._m(s.surplus, s.surplus < 0 ? "neg" : "pos")}</div>`;
    }
    // 🧾 Offene Stände
    if (d.staende.length) {
      h += this._gh("file-document-alert-outline", "var(--fk-red)", "Offene Stände", `${d.settings.debts_subtract ? "abgezogen · " : ""}${this._m(-s.debts, "neg")}`);
      h += d.staende.map((x) => `<div class="item"><div class="n"><b>${esc(x.name)}</b>${x.note ? `<div class="meta"><span class="tag">${esc(x.note)}</span></div>` : ""}</div><div class="amt">${this._m(-x.amount, "neg")}</div>
        <button class="btn small ok" data-a="settle" data-id="${esc(x.id)}">${ic("check")}beglichen</button></div>`).join("");
    }
    // 🐷 Töpfe
    if (d.toepfe.length) {
      h += this._ghc("toepfe", "piggy-bank-outline", "#e91e63", "Töpfe", this._m(s.total - s.balance));
      if (this._openSec.has("toepfe")) h += `<p class="small">Antippen = Stand ändern.</p>` + d.toepfe.map((t) => `<div class="item click" data-a="pot" data-id="${esc(t.id)}"><div class="n"><b>${esc(t.name)}</b></div><div class="amt">${this._m(t.amount)}</div></div>`).join("");
      h += `<div class="sum"><span>Komplett (mit Konto)</span>${this._m(s.total)}</div>`;
    }
    // 🏦 Meine Konten (nur Info)
    if (d.konten.length) {
      h += this._gh("bank-outline", "var(--pc)", "Meine Konten");
      h += d.konten.map((k) => `<div class="item"><div class="n"><b>${esc(k.name)}</b><div class="meta"><span class="tag ${this._hidden ? "hidden-amt" : ""}" style="font-family:monospace">${esc(k.iban)}</span>${k.note ? `<span class="tag">${esc(k.note)}</span>` : ""}</div></div>
        <button class="iconbtn" data-a="copy" data-id="${esc(k.id)}" title="IBAN kopieren">${ic("content-copy")}</button></div>`).join("");
    }
    return h;
  }
  _postenRow(d, p) {
    const paused = p.active === false;
    const on = paused || !!d.paid[p.id]?.paid;
    return `<div class="item ${on ? "done" : ""} ${paused ? "paused" : ""}">${paused ? `<span class="chk on" title="pausiert – zählt nicht mit">${ic("pause")}</span>` : `<button class="chk ${on ? "on" : ""}" data-a="paid" data-id="${esc(p.id)}" aria-label="abhaken">${on ? ic("check") : ""}</button>`}
      <div class="n"><b>${esc(p.name)}</b><div class="meta">${paused ? `<span class="tag">⏸️ pausiert</span>` : ""}${p.day ? `<span class="tag">am ${p.day}.</span>` : ""}<span class="tag">${esc((PAY[p.pay] || PAY.keine)[0])}</span>${p.note ? `<span class="tag">${esc(p.note)}</span>` : ""}</div></div>
      <div class="amt">${this._m(-p.amount, "neg")}</div></div>`;
  }
  _monthName(mk) { const m = Number(String(mk || "").slice(5, 7)); return m ? MONTHS[m - 1] + " " + String(mk).slice(0, 4) : ""; }

  _editView(d) {
    // ⠿ Griff zum Ziehen + ▲▼ (Notlösung fürs Handy). Posten lassen sich auch in eine andere Gruppe ziehen.
    const row = (kind, it, rowText, sortable) => this._open?.kind === kind && this._open.id === it.id ? this._form(d, kind, it)
      : `<div class="item click ${it.active === false ? "done" : ""}" data-a="open" data-k="${kind}" data-id="${esc(it.id)}" ${sortable ? `data-row="${esc(it.id)}"` : ""}>${sortable ? `<span class="grip" data-grip="${kind}" title="Ziehen zum Verschieben">${ic("drag")}</span>` : ""}<div class="n"><b>${it.active === false ? "⏸️ " : ""}${esc(it.name)}</b>${rowText(it) ? `<div class="meta">${rowText(it).filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}</div>${"amount" in it ? `<div class="amt">${this._m(it.amount)}</div>` : ""}${sortable ? `<span class="mv"><button class="iconbtn" data-a="mv" data-k="${kind}" data-id="${esc(it.id)}" data-v="-1" title="nach oben">${ic("chevron-up")}</button><button class="iconbtn" data-a="mv" data-k="${kind}" data-id="${esc(it.id)}" data-v="1" title="nach unten">${ic("chevron-down")}</button></span>` : `<span class="iconbtn">${ic("pencil-outline")}</span>`}</div>`;
    const head = (kind, icon, color, title) => this._gh(icon, color, title, `<button class="btn small" data-a="new" data-k="${kind}">${ic("plus")}Neu</button>`)
      + (this._open?.kind === kind && this._open.id === "new" ? this._form(d, kind, {}) : "");
    const block = (kind, icon, color, title, list, rowText, sortable = true) => head(kind, icon, color, title)
      + (list.length ? `<div class="olist" data-list="${kind}">${list.map((it) => row(kind, it, rowText, sortable)).join("")}</div>` : `<div class="empty">Noch leer.</div>`);
    const groups = [...d.groups].sort((a, b) => a.start_day - b.start_day);
    const ptext = (p) => [p.day ? `am ${p.day}.` : "", (PAY[p.pay] || PAY.keine)[0], p.months?.length ? p.months.map((m) => MONTHS[m - 1]).join(", ") : ""];
    // 📋 Posten: eine Liste mit Gruppen-Trennern – wer unter einen Trenner gezogen wird, landet in dieser Gruppe
    const loose = d.posten.filter((p) => !groups.some((g) => g.id === p.group));
    let posten = head("posten", "calendar-month-outline", "var(--pc)", "Fixkosten") + `<div class="olist" data-list="posten">`
      + groups.map((g) => `<div class="gsub" data-gid="${esc(g.id)}">${esc(g.name)}</div>` + d.posten.filter((p) => p.group === g.id).map((p) => row("posten", p, ptext, true)).join("")).join("")
      + (loose.length ? `<div class="gsub">ohne Gruppe</div>` + loose.map((p) => row("posten", p, ptext, true)).join("") : "") + `</div>`;
    if (!d.posten.length) posten += `<div class="empty">Noch leer.</div>`;
    return posten
      + block("einnahme", "cash-plus", "var(--fk-green)", "Einnahmen (Info)", d.einnahmen, (e) => [e.date])
      + block("topf", "piggy-bank-outline", "#e91e63", "Töpfe", d.toepfe, () => null)
      + block("stand", "file-document-alert-outline", "var(--fk-red)", "Offene Stände", d.staende, (x) => [x.note])
      + block("konto", "bank-outline", "var(--pc)", "Meine Konten (Info)", d.konten, (k) => [k.iban])
      + block("gruppe", "format-list-bulleted-square", "#9e9e9e", "Gruppen", groups, (g) => [`ab dem ${g.start_day}.`], false)
      + `<p class="small">⠿ Ziehen oder ▲▼ = Reihenfolge ändern. Fixkosten kannst du so auch in eine andere Gruppe schieben.</p>`;
  }

  // ↩️ Löschen mit „Rückgängig“ statt Nachfrage
  _removeWithUndo(kind, id, op, label) {
    const d = this._data, key = kind === "booking" ? "bookings" : KIND[kind];
    const idx = d[key].findIndex((x) => x.id === id);
    if (idx < 0) return;
    const item = JSON.parse(JSON.stringify(d[key][idx]));
    delete item.waiting;
    clearTimeout(this._undoT);
    this._undo = { label: `${label}: „${item.name}“`, op: { type: "restore", kind, item, index: idx } };
    this._undoT = setTimeout(() => { this._undo = null; this._force = true; this._render(); }, 8000);
    this._send(op);
  }

  // ⠿ Reihenfolge aus der Liste ablesen und an HA schicken
  _sendOrder(listEl) {
    const kind = listEl.dataset.list, ids = [], groups = {};
    let gid = null;
    for (const el of listEl.children) {
      if (el.classList.contains("gsub")) gid = el.dataset.gid || null;
      else if (el.dataset.row) { ids.push(el.dataset.row); if (kind === "posten" && gid) groups[el.dataset.row] = gid; }
    }
    this._send({ type: "order", kind, ids, ...(kind === "posten" ? { groups } : {}) });
  }
  _move(listEl, id, dir) {
    const kids = [...listEl.children], el = kids.find((x) => x.dataset.row === id);
    if (!el) return;
    let n = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    // über einen Gruppen-Trenner hinweg = in die Nachbar-Gruppe
    if (!n) return;
    if (dir < 0) { if (n.classList.contains("gsub") && !n.previousElementSibling) return; listEl.insertBefore(el, n); }
    else listEl.insertBefore(n, el);
    this._sendOrder(listEl);
  }
  _startDrag(grip, ev) {
    const row = grip.closest("[data-row]"), list = row?.parentElement;
    if (!row || !list) return;
    ev.preventDefault(); ev.stopPropagation();
    this._dragging = true;
    row.classList.add("drag");
    const before = [...list.children].map((x) => x.dataset.row || x.dataset.gid || "-").join();
    const move = (e) => {
      const y = e.clientY;
      const others = [...list.children].filter((x) => x !== row && (x.dataset.row || x.classList.contains("gsub")));
      let target = null;
      for (const o of others) { const r = o.getBoundingClientRect(); if (y < r.top + r.height / 2) { target = o; break; } }
      if (target && target.classList.contains("gsub") && target === list.firstElementChild) target = target.nextElementSibling;
      if (target) { if (target !== row.nextElementSibling) list.insertBefore(row, target); }
      else if (row !== list.lastElementChild) list.appendChild(row);
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      row.classList.remove("drag");
      this._dragging = false; this._dragEnd = Date.now();
      const after = [...list.children].map((x) => x.dataset.row || x.dataset.gid || "-").join();
      if (after !== before) this._sendOrder(list); else if (this._pending) { this._pending = false; this._force = true; this._render(); }
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  }
  _form(d, kind, it) {
    const isNew = !it.id;
    const f = [`<label class="wide">Name<input name="name" value="${esc(it.name || "")}" required></label>`];
    if (kind === "konto") f.push(`<label class="wide">IBAN<input name="iban" value="${esc(it.iban || "")}" autocapitalize="characters" spellcheck="false" style="font-family:monospace"></label>`, `<label class="wide">Notiz (z. B. BIC/BLZ)<input name="note" value="${esc(it.note || "")}"></label>`);
    if (kind !== "gruppe" && kind !== "konto") f.push(`<label>Betrag (€)<input name="amount" inputmode="decimal" value="${it.amount != null ? String(it.amount).replace(".", ",") : ""}"></label>`);
    if (kind === "posten") {
      f.push(`<label>Gruppe<select name="group">${[...d.groups].sort((a, b) => a.start_day - b.start_day).map((g) => `<option value="${esc(g.id)}" ${g.id === (it.group || d.groups[0]?.id) ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>`);
      f.push(`<label>Fester Tag (frei lassen = keiner)<input name="day" type="number" min="1" max="31" inputmode="numeric" placeholder="z. B. 5" value="${it.day || ""}"></label>`);
      f.push(`<label>Zahlart<select name="pay">${Object.entries(PAY).map(([k, v]) => `<option value="${k}" ${k === (it.pay || "keine") ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label>`);
    }
    if (kind === "einnahme") f.push(`<label>Datum / Info<input name="date" value="${esc(it.date || "")}" placeholder="z. B. 30.01.2026"></label>`);
    if (kind === "stand") f.push(`<label>Notiz<input name="note" value="${esc(it.note || "")}"></label>`);
    if (kind === "posten" || kind === "einnahme") {
      f.push(`<label class="wide">Notiz<input name="note" value="${esc(it.note || "")}"></label>`);
      const months = it.months || [];
      f.push(`<label class="wide">Nur in diesen Monaten (nichts gewählt = jeden Monat)<div class="months">${MONTHS.map((m, i) => `<button type="button" data-a="month" data-v="${i + 1}" class="${months.includes(i + 1) ? "on" : ""}">${m}</button>`).join("")}</div></label>`);
      f.push(`<label class="wide" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" class="swchk" name="active" ${it.active === false ? "" : "checked"}> aktiv (aus = pausiert, zählt nicht mit)</label>`);
    }
    if (kind === "gruppe") f.push(`<label>Starttag (1–28)<input name="start_day" type="number" min="1" max="28" value="${it.start_day || 1}"></label>`);
    return `<form class="edit" data-a="save" data-k="${kind}" data-id="${esc(it.id || "")}"><div class="f">${f.join("")}</div>
      <div class="btnrow end">${isNew ? "" : `<button type="button" class="btn" data-a="del" data-k="${kind}" data-id="${esc(it.id)}">${ic("delete-outline")}Löschen</button>`}
      <button type="button" class="btn" data-a="cancel">${ic("close")}Abbrechen</button><button class="btn main" type="submit">${ic("check")}Speichern</button></div></form>`;
  }

  _histView(d) {
    const hist = [...(d.history || [])].slice(-12);
    const s = d.summary;
    hist.push({ month: d.month, fix_total: s.fix_total, fix_paid: s.fix_paid, income_total: s.income_total, bookings: s.bookings_month, available_end: s.available, now: true });
    const max = Math.max(1, ...hist.map((x) => Math.max(x.fix_total + x.bookings, x.income_total)));
    const hh = (v) => Math.max(2, (v / max) * 120).toFixed(0);
    return this._gh("chart-bar", "var(--pc)", "Monatsrückblick") + `<div class="legend"><span><i style="background:#e57373"></i>Fixkosten</span><span><i style="background:#ffb74d"></i>Kartenzahlungen</span><span><i style="background:#81c784"></i>Einnahmen</span></div>
      <div class="hist">${hist.map((x) => `<div class="m" title="${esc(this._monthName(x.month))}">
        <div style="display:flex;gap:2px;align-items:flex-end;width:100%;justify-content:center">
          <div style="width:40%;display:flex;flex-direction:column;justify-content:flex-end"><div style="height:${hh(x.bookings)}px;background:#ffb74d;border-radius:4px 4px 0 0"></div><div style="height:${hh(x.fix_total)}px;background:#e57373"></div></div>
          <div style="width:40%;height:${hh(x.income_total)}px;background:#81c784;border-radius:4px 4px 0 0"></div></div>
        <span>${MONTHS[Number(x.month.slice(5, 7)) - 1]}${x.now ? "*" : ""}</span></div>`).join("")}</div>
      <table><tr><th>Monat</th><th>Fixkosten</th><th>Karte</th><th>Einnahmen</th><th>Verfügbar am Ende</th></tr>
      ${[...hist].reverse().map((x) => `<tr><td>${esc(this._monthName(x.month))}${x.now ? " (läuft)" : ""}</td><td>${this._m(x.fix_total)}</td><td>${this._m(x.bookings)}</td><td>${this._m(x.income_total)}</td><td>${this._m(x.available_end)}</td></tr>`).join("")}</table>
      <p class="small">Am Monatsende wird der Monat automatisch hier gemerkt (bis zu 3 Jahre).</p>`;
  }

  _guideView() {
    return this._gh("book-open-variant", "#3949ab", "Anleitung") + `<p class="small">Tipp auf eine Überschrift klappt sie auf.</p>`
      + FK_GUIDE.map((g) => `<details class="gsec"><summary><span class="gdot" style="--gc:${g.color}">${ic(g.icon)}</span>${g.title}</summary><div class="gtext">${g.text}</div></details>`).join("")
      + this._gh("hand-heart-outline", "#ec407a", "Credits") + this._creditsHtml();
  }
  _creditsHtml() {
    return `<p class="small" style="margin-top:2px">Fixkosten <b>v${FK_VERSION}</b> · von <b>Mister-M</b> · <a href="${REPO}" target="_blank" rel="noopener">GitHub</a> · <a href="${REPO}/issues" target="_blank" rel="noopener">Fehler melden</a></p>
      <p class="small">Die Fixkosten sind und bleiben <b>kostenlos</b>. Wenn du magst, kannst du mir ganz freiwillig eine kleine Spende schicken. Danke! 🙏</p>
      <div class="btnrow"><a class="btn paypal" href="${PAYPAL}" target="_blank" rel="noopener">${ic("hand-heart-outline")}Spenden per PayPal</a></div>
      <p class="small">Symbole: Material Design Icons (Pictogrammers, frei). Lizenz: MIT.</p>`;
  }

  // 🔒 PIN-Abfrage vor ⚙️ und „Bearbeiten“
  _pinView() {
    return this._gh("lock-outline", "#455a64", "Gesperrt") + `<p class="small">Für <b>${this._view === "set" ? "⚙️ Einstellungen" : "Bearbeiten"}</b> brauchst du die PIN. Die Übersicht und das Abhaken gehen auch ohne.</p>
      <form class="add" data-a="pinunlock"><input name="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN" maxlength="8" style="flex:1"><button class="addbtn" type="submit" title="Entsperren">${ic("lock-open-variant-outline")}</button></form>
      <p class="small">PIN vergessen? Ein Admin geht in Home Assistant auf <b>Einstellungen → Geräte & Dienste → Fixkosten → Konfigurieren</b> und hakt <b>„PIN zurücksetzen“</b> an.</p>`;
  }
  _pinSetHtml(d) {
    return `<p class="small">${d.pin ? "🔒 PIN ist <b>an</b>. ⚙️ und „Bearbeiten“ fragen nach der PIN." : "Mit einer PIN (4–8 Ziffern) sperrst du ⚙️ und „Bearbeiten“, z. B. auf dem Wand-Tablet. Abhaken und Kartenzahlungen gehen weiter ohne PIN."}</p>
      <form class="edit" data-a="pinset"><div class="f">${d.pin ? `<label>Alte PIN<input name="old" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>` : ""}
      <label>${d.pin ? "Neue PIN" : "PIN"}<input name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label>
      <label>Nochmal<input name="pin2" type="password" inputmode="numeric" autocomplete="off" maxlength="8"></label></div>
      <div class="btnrow end">${d.pin ? `<button type="submit" class="btn" name="off" value="1">${ic("lock-open-variant-outline")}PIN ausschalten</button>` : ""}<button class="btn main" type="submit">${ic("check")}${d.pin ? "PIN ändern" : "PIN einschalten"}</button></div></form>
      <p class="small">Die PIN liegt nur als Prüfsumme in Home Assistant. Vergessen? Admin → <b>Geräte & Dienste → Fixkosten → Konfigurieren → „PIN zurücksetzen“</b>. 5× falsch = 1 Minute Pause.</p>`;
  }

  // ⚙️ Einstellungen wie bei der Einkaufsliste: Kategorien mit Kacheln, jede Kachel öffnet ein eigenes Fenster
  _sheets(d) {
    const st = d.settings, admin = this._hass?.user?.is_admin !== false;
    return {
      rechnen: { icon: "calculator-variant-outline", color: "#3949ab", title: "Rechnen & Warnung", info: `Warnung unter ${money(st.warn_below || 0)}`, html: () => `
        <label class="switch"><span>${ic("undo-variant")}Haken am Monatsanfang automatisch zurücksetzen</span><input type="checkbox" class="swchk" data-a="setreset" ${st.reset_checks !== false ? "checked" : ""}></label>
        <label class="switch"><span>${ic("file-document-alert-outline")}Offene Stände von „Verfügbar“ abziehen</span><input type="checkbox" class="swchk" data-a="setdebts" ${st.debts_subtract ? "checked" : ""}></label>
        <div class="switch"><span>${ic("alert-circle-outline")}Warnen, wenn „Verfügbar“ unter</span><span><input data-a="setwarn" inputmode="decimal" value="${String(st.warn_below ?? 0).replace(".", ",")}" style="width:90px;text-align:right"> €</span></div>
        <div class="btnrow"><button class="btn" data-a="resetnow">${ic("undo-variant")}Alle Haken jetzt zurücksetzen</button><button class="btn" data-a="pending">${ic("pencil-outline")}Vorgemerkt eintragen</button></div>` },
      quick: { icon: "lightning-bolt-outline", color: "#ff9800", title: "Schnellknöpfe", info: `${(st.quick || []).length} Knöpfe`, html: () => `
        <p class="small">Die Knöpfe über „Wofür?“ bei den Kartenzahlungen. <b>Ein Knopf pro Zeile</b> (Kommas sind erlaubt).</p>
        <textarea data-a="quicktext" rows="8">${esc((st.quick || []).join("\n"))}</textarea>
        <div class="btnrow end"><button class="btn main" data-a="quicksave">${ic("content-save-outline")}Speichern</button></div>` },
      csv: { icon: "upload", color: "#546e7a", title: "Daten (CSV)", info: admin ? "einlesen & sichern" : "nur Admins", html: () => admin ? `<p class="small">Spalten: <b>Typ;Name;Betrag;Gruppe/Datum;Zahlart;Notiz</b> – Typ = ausgabe, einnahme, topf, stand (offener Stand) oder iban (Konto-Info, IBAN in Spalte 3). Gruppe = 1 oder 15 (oder der Name). Zahlart = ü, d, l, p, a, g, b oder -.</p>
        <input type="file" accept=".csv,text/csv,text/plain" data-a="file"><textarea data-a="csv" rows="5" style="margin-top:6px" placeholder="ausgabe;Miete;800,00;1;d"></textarea>
        <label class="switch"><span>vorhandene Posten, Einnahmen, Töpfe und offenen Stände vorher löschen</span><input type="checkbox" class="swchk" data-a="csvreplace"></label>
        <div class="btnrow"><button class="btn main" data-a="import">${ic("upload")}Einlesen</button><button class="btn" data-a="export">${ic("download")}Als CSV sichern</button></div>` : `<p class="small">Nur für Admins.</p>` },
      app: { icon: "cellphone-arrow-down", color: "#1e88e5", title: "Offline-App", info: "auch ohne Netz", html: () => `
        <p class="small">Eine eigene kleine App nur für die Fixkosten. Sie öffnet sich auch <b>ohne Netz</b>, zeigt den letzten Stand, lässt dich abhaken und eintragen und schickt alles nach, sobald wieder Netz da ist.</p>
        <ol class="small steps"><li>Auf dem Handy im <b>Browser</b> (Chrome oder Safari, nicht in der HA-App) die Adresse unten öffnen.</li><li>Einmal mit deinem Home-Assistant-Benutzer <b>anmelden</b>.</li><li>Im Browser-Menü <b>„Zum Startbildschirm hinzufügen“</b> – fertig, eigenes 💶-Symbol.</li></ol>
        <p class="small">Unten in der App: <b>„👆 Fingerabdruck-Sperre“</b>. <b>Abmelden</b> löscht alle Zahlen aus dem Handy. Es braucht eine <b>https</b>-Adresse (z. B. Nabu Casa).</p>
        ${d.app_url ? `<p class="small"><b>Deine Adresse für die App:</b></p><input id="appUrl" readonly value="${esc(d.app_url)}" translate="no">
        <div class="btnrow"><button class="btn main" data-a="appcopy">${ic("content-copy")}Kopieren</button></div><p class="small">Kopieren, im Handy-Browser einfügen, fertig. Die Adresse funktioniert zu Hause und unterwegs.</p>`
        : `<p class="small">⚠️ Home Assistant kennt keine https-Adresse für unterwegs. Mit <b>Nabu Casa</b> (Einstellungen → Home Assistant Cloud → Fernzugriff) oder einer eigenen https-Adresse (Einstellungen → System → Netzwerk) klappt es. Zu Hause geht auch: <code>${esc(location.origin)}/fixkosten/app/</code></p>`}` },
      pin: { icon: "shield-key-outline", color: "#455a64", title: "Schutz (PIN)", info: d.pin ? "an" : "aus", html: () => this._pinSetHtml(d) },
      privacy: { icon: "shield-lock-outline", color: "#00897b", title: "Datenschutz", info: "alles lokal", html: () => `<p class="small">🔒 Deine Zahlen bleiben in <b>deinem</b> Home Assistant. Keine Cloud, kein Tracking, nichts geht ins Internet. IBANs stehen bewusst in keinem Sensor. In der Offline-App liegen die Zahlen zusätzlich im Handy, bis du dich abmeldest.</p>` },
      credits: { icon: "hand-heart-outline", color: "#ec407a", title: "Credits & Spenden", info: `v${FK_VERSION}`, html: () => this._creditsHtml() },
    };
  }
  _setView(d) {
    const sh = this._sheets(d);
    const cats = [["🧮 Rechnen", ["rechnen", "quick"]], ["📥 Daten", ["csv"]], ["📱 App & Info", ["app", "pin", "privacy", "credits"]]];
    return this._gh("cog-outline", "#9e9e9e", "Einstellungen") + cats.map(([t, keys]) => `<div class="scat">${t}</div><div class="stiles">${keys.map((k) => `<button class="stile" data-a="sheet" data-v="${k}"><span class="gdot" style="--gc:${sh[k].color}">${ic(sh[k].icon)}</span><span class="st"><b>${sh[k].title}</b><small>${esc(sh[k].info)}</small></span>${ic("chevron-right")}</button>`).join("")}</div>`).join("");
  }
  _sheetHtml(d) {
    const x = this._sheets(d)[this._sheet];
    if (!x) return "";
    return `<div class="sheet" data-a="sheetclose" data-v="bg"><div class="sbox" role="dialog" aria-label="${esc(x.title)}"><div class="shead"><span class="gdot" style="--gc:${x.color}">${ic(x.icon)}</span><b>${x.title}</b><button class="iconbtn" data-a="sheetclose" title="Schließen">${ic("close")}</button></div><div class="sbody">${x.html()}</div></div></div>`;
  }

  // ---------------------------------------------------------------- 👆 Klicks
  _bind() {
    const root = this.shadowRoot;
    root.querySelectorAll("input,textarea,select").forEach((el) => el.addEventListener("blur", () => {
      setTimeout(() => { if (this._pending && !["INPUT", "TEXTAREA", "SELECT"].includes(root.activeElement?.tagName)) { this._pending = false; this._render(); } }, 150);
    }));
    root.querySelectorAll("form").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); this._submit(f, e.submitter); }));
    root.querySelectorAll("[data-grip]").forEach((g) => {
      g.addEventListener("pointerdown", (e) => this._startDrag(g, e));
      g.addEventListener("click", (e) => e.stopPropagation());
    });
    root.querySelectorAll("[data-a]").forEach((el) => {
      if (el.tagName === "FORM") return;
      const ev = el.tagName === "INPUT" && el.type !== "file" ? "change" : el.type === "file" ? "change" : "click";
      el.addEventListener(ev, (e) => {
        if (el.dataset.v === "bg" && e.target !== el) return; // Klick IM Fenster schließt es nicht
        if (el.dataset.a !== "month") e.stopPropagation(); this._act(el, e);
      });
    });
  }

  _act(el, e) {
    const a = el.dataset.a, id = el.dataset.id, d = this._data;
    const redraw = () => { this._force = true; this._render(); };
    if (a === "calc") { this._calc = this._calc ? null : { expr: "" }; redraw(); }
    else if (a === "ckey") {
      const k = el.dataset.v, c = this._calc;
      if (k === "C") c.expr = "";
      else if (k === "⌫") c.expr = c.expr.slice(0, -1);
      else if (k === "=") { const r = calcEval(c.expr); if (r != null) c.expr = numDe(r); }
      else if (k === "V") c.expr += numDe(d.summary.available);
      else c.expr += k;
      redraw();
    } else if (a === "cuse") {
      const r = calcEval(this._calc?.expr);
      if (r == null) return;
      if (el.dataset.v === "pay") { this._prefAmount = numDe(Math.abs(r)); this._view = "home"; this._calc = null; redraw(); setTimeout(() => this.shadowRoot.querySelector('form[data-a="booking"] input[name="name"]')?.focus(), 30); }
      else if (el.dataset.v === "balance") { if (confirm(`Kontostand auf ${money(r)} setzen?`)) { this._calc = null; this._send({ type: "konto", balance: r }); } }
      else (navigator.clipboard?.writeText(numDe(r)) || Promise.reject()).then(() => this._toast("📋 Kopiert"), () => prompt("Zum Kopieren:", numDe(r)));
    }
    else if (a === "lock") {
      if (pinOpen()) { PIN_LOCK.until = 0; this._toast("🔒 Gesperrt"); if (this._view === "edit" || this._view === "set") this._view = "home"; }
      else this._view = "set";
      this._open = null; redraw();
    }
    else if (a === "sec") { const k = el.dataset.v; this._openSec.has(k) ? this._openSec.delete(k) : this._openSec.add(k); store.put(OKEY, [...this._openSec]); redraw(); }
    else if (a === "mv") { const l = el.closest("[data-list]"); if (l) this._move(l, id, Number(el.dataset.v)); }
    else if (a === "sheet") { this._sheet = el.dataset.v; redraw(); }
    else if (a === "sheetclose") { this._sheet = null; redraw(); }
    else if (a === "appcopy") { const u = d.app_url || ""; (navigator.clipboard?.writeText(u) || Promise.reject()).then(() => this._toast("📋 Adresse kopiert"), () => prompt("Adresse zum Kopieren:", u)); }
    else if (a === "quicksave") { const t = this.shadowRoot.querySelector('[data-a="quicktext"]')?.value || ""; this._send({ type: "settings", settings: { quick: t.split("\n").map((x) => x.trim()).filter(Boolean) } }); this._toast("⚡ Schnellknöpfe gespeichert"); }
    else if (a === "hide") { this._hidden = !this._hidden; store.put(HKEY, this._hidden); redraw(); }
    else if (a === "tab") { this._view = el.dataset.v; this._open = null; this._sheet = null; redraw(); }
    else if (a === "paid") this._send({ type: "paid", id, value: !d.paid[id]?.paid, month: d.month });
    else if (a === "quick") { this._quickName = this._quickName === el.dataset.v ? null : el.dataset.v; redraw(); setTimeout(() => this.shadowRoot.querySelector('input[name="amount"]')?.focus(), 30); }
    else if (a === "settle") this._removeWithUndo("stand", id, { type: "stand_delete", id }, "✓ Beglichen");
    else if (a === "copy") {
      const k = d.konten.find((x) => x.id === id);
      const raw = (k?.iban || "").replace(/\s/g, "");
      (navigator.clipboard?.writeText(raw) || Promise.reject()).then(() => this._toast("📋 IBAN kopiert"), () => prompt("IBAN zum Kopieren:", raw));
    }
    else if (a === "clear") {
      const b = d.bookings.find((x) => x.id === id);
      clearTimeout(this._undoT);
      this._undo = { label: `✓ Abgebucht: „${b?.name || ""}“`, op: { type: "booking_clear", id, value: false } };
      this._undoT = setTimeout(() => { this._undo = null; this._force = true; this._render(); }, 8000);
      this._send({ type: "booking_clear", id, value: true });
    }
    else if (a === "bdel") this._removeWithUndo("booking", id, { type: "booking_delete", id }, "🗑️ Gelöscht");
    else if (a === "undo") { const u = this._undo; this._undo = null; clearTimeout(this._undoT); if (u) this._send(u.op); else redraw(); }
    else if (a === "balance") {
      const v = prompt("Aktueller Kontostand laut Bank-App (€):", String(d.summary.balance).replace(".", ","));
      if (v != null && !Number.isNaN(parseMoney(v))) this._send({ type: "konto", balance: parseMoney(v) });
    } else if (a === "pending") {
      const v = prompt("Vorgemerkte Umsätze laut Bank-App (€, minus = geht noch ab):", String(d.konto.pending || 0).replace(".", ","));
      if (v != null && !Number.isNaN(parseMoney(v))) this._send({ type: "konto", pending: parseMoney(v) });
    } else if (a === "pot") {
      const t = d.toepfe.find((x) => x.id === id);
      const v = t && prompt(`Neuer Stand für „${t.name}“ (€):`, String(t.amount).replace(".", ","));
      if (v != null && v !== undefined && !Number.isNaN(parseMoney(v))) this._send({ type: "topf_save", item: { id, amount: parseMoney(v) } });
    } else if ((a === "open" || a === "new") && this._dragEnd && Date.now() - this._dragEnd < 400) { /* gerade gezogen */ }
    else if (a === "open" || a === "new") { this._open = { kind: el.dataset.k, id: a === "new" ? "new" : id }; redraw(); }
    else if (a === "cancel") { this._open = null; redraw(); }
    else if (a === "month") { e.preventDefault(); el.classList.toggle("on"); }
    else if (a === "del") {
      const k = el.dataset.k;
      if (k === "gruppe") { if (confirm("Gruppe löschen? Ihre Posten wandern in die erste Gruppe.")) { this._open = null; this._send({ type: "gruppe_delete", id }); } }
      else { this._open = null; this._removeWithUndo(k, id, { type: `${k}_delete`, id }, "🗑️ Gelöscht"); }
    } else if (a === "setreset") this._send({ type: "settings", settings: { reset_checks: el.checked } });
    else if (a === "setdebts") this._send({ type: "settings", settings: { debts_subtract: el.checked } });
    else if (a === "setwarn") { const v = parseMoney(el.value); if (!Number.isNaN(v)) this._send({ type: "settings", settings: { warn_below: v } }); }
    else if (a === "resetnow") { if (confirm("Alle Haken dieses Monats entfernen?")) this._send({ type: "reset_checks" }); }
    else if (a === "file") {
      const file = el.files?.[0];
      if (file) file.text().then((t) => { this.shadowRoot.querySelector('[data-a="csv"]').value = t; });
    } else if (a === "import") this._import();
    else if (a === "export") this._export(d);
  }

  async _pin(type, payload) {
    if (this._hass?.connected === false) { this._toast("📴 Die PIN wird in Home Assistant geprüft – dafür braucht es Netz"); return null; }
    try { return await this._hass.callWS({ type, ...payload }); }
    catch (err) { this._toast("⚠️ " + (err?.message || "Ging nicht")); return null; }
  }

  _submit(f, submitter) {
    const a = f.dataset.a, data = Object.fromEntries(new FormData(f).entries());
    if (a === "pinunlock") {
      this._pin("fixkosten/pin/check", { pin: data.pin || "" }).then((r) => {
        if (!r) return;
        if (r.ok) { PIN_LOCK.until = Date.now() + 10 * 60 * 1000; this._toast("🔓 Entsperrt"); }
        else this._toast("❌ Falsche PIN");
        this._force = true; this._render();
      });
      return;
    }
    if (a === "pinset") {
      const off = submitter?.name === "off";
      const pin = off ? "" : (data.pin || "").trim();
      if (!off && !/^\d{4,8}$/.test(pin)) { this._toast("Die PIN muss 4 bis 8 Ziffern haben"); return; }
      if (!off && pin !== (data.pin2 || "").trim()) { this._toast("Die zwei PINs sind nicht gleich"); return; }
      if (off && !confirm("PIN wirklich ausschalten?")) return;
      this._pin("fixkosten/pin/set", { pin: pin || null, old: data.old || null }).then((r) => {
        if (!r) return;
        PIN_LOCK.until = pin ? Date.now() + 10 * 60 * 1000 : 0;
        this._toast(off ? "🔓 PIN ist aus" : "🔒 PIN gespeichert");
        this._force = true; this._render();
      });
      return;
    }
    if (a === "booking") {
      const amount = parseMoney(data.amount);
      if (!amount || Number.isNaN(amount)) { this._toast("Bitte einen Betrag eintippen"); return; }
      this._quickName = null; this._prefAmount = null;
      f.reset();
      this.shadowRoot.activeElement?.blur();
      this._force = true;
      this._send({ type: "booking_add", name: (data.name || "").trim() || "Kartenzahlung", amount });
      return;
    }
    if (a === "save") {
      const kind = f.dataset.k, item = { name: (data.name || "").trim() };
      if (!item.name) { this._toast("Name fehlt"); return; }
      if (f.dataset.id) item.id = f.dataset.id; else item.id = uid();
      if (kind === "konto") { item.iban = (data.iban || "").replace(/\s/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim(); item.note = data.note || ""; }
      if (kind !== "gruppe" && kind !== "konto") {
        const amount = parseMoney(data.amount || 0);
        if (Number.isNaN(amount)) { this._toast("Betrag stimmt nicht"); return; }
        item.amount = Math.abs(amount);
      }
      if (kind === "posten") {
        item.group = data.group; item.pay = data.pay;
        const day = String(data.day || "").trim();
        if (day && !(Number(day) >= 1 && Number(day) <= 31)) { this._toast("Fester Tag: 1 bis 31 oder leer"); return; }
        item.day = day ? Number(day) : null;
      }
      if (kind === "einnahme") item.date = data.date || "";
      if (kind === "stand") item.note = data.note || "";
      if (kind === "posten" || kind === "einnahme") {
        item.note = data.note || "";
        item.active = !!f.querySelector('input[name="active"]')?.checked;
        item.months = [...f.querySelectorAll(".months button.on")].map((b) => Number(b.dataset.v));
      }
      if (kind === "gruppe") item.start_day = Math.max(1, Math.min(28, Number(data.start_day) || 1));
      this._open = null;
      this.shadowRoot.activeElement?.blur();
      this._force = true;
      this._send({ type: `${kind}_save`, item });
    }
  }

  async _import() {
    const text = this.shadowRoot.querySelector('[data-a="csv"]')?.value || "";
    const replace = !!this.shadowRoot.querySelector('[data-a="csvreplace"]')?.checked;
    if (!text.trim()) { this._toast("Erst eine Datei wählen oder Text einfügen"); return; }
    if (replace && !confirm("Vorhandene Posten, Einnahmen und Töpfe werden ersetzt. Weiter?")) return;
    try {
      const r = await this._hass.callWS({ type: "fixkosten/import", text, replace });
      this._toast(`✅ Eingelesen: ${r.ausgaben} Fixkosten, ${r.einnahmen} Einnahmen, ${r.toepfe} Töpfe, ${r.staende} offene Stände, ${r.konten} Konten${r.uebersprungen ? `, ${r.uebersprungen} Zeilen übersprungen` : ""}`);
      this._view = "home"; this._sheet = null; this._force = true; this._render();
    } catch (err) { this._toast("⚠️ " + (err?.message || "Einlesen ging nicht (ohne Netz geht das nicht)")); }
  }

  _export(d) {
    const num = (v) => String((Number(v) || 0).toFixed(2)).replace(".", ",");
    const gday = (id) => d.groups.find((g) => g.id === id)?.start_day || "";
    const q = (x) => /[;"\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x ?? "");
    const lines = ["Typ;Name;Betrag;Gruppe/Datum;Zahlart;Notiz",
      ...d.posten.map((p) => ["ausgabe", p.name, num(p.amount), gday(p.group), (PAY[p.pay] || PAY.keine)[1], p.note || ""].map(q).join(";")),
      ...d.einnahmen.map((e) => ["einnahme", e.name, num(e.amount), e.date || "", (PAY[e.pay] || PAY.keine)[1], e.note || ""].map(q).join(";")),
      ...d.toepfe.map((t) => ["topf", t.name, num(t.amount), "", "", ""].map(q).join(";")),
      ...d.staende.map((x) => ["stand", x.name, num(x.amount), "", "", x.note || ""].map(q).join(";")),
      ...d.konten.map((k) => ["iban", k.name, k.iban, "", "", k.note || ""].map(q).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
    a.download = `fixkosten-${d.month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

if (!customElements.get("fixkosten-card")) customElements.define("fixkosten-card", FixkostenCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "fixkosten-card")) {
  window.customCards.push({ type: "fixkosten-card", name: "Fixkosten", description: "Monatliche Fixkosten, Kartenzahlungen und was noch verfügbar ist.", preview: false });
}
console.info(`%c 💶 FIXKOSTEN %c v${FK_VERSION} `, "background:#43a047;color:#fff;border-radius:3px 0 0 3px", "background:#333;color:#fff;border-radius:0 3px 3px 0");
