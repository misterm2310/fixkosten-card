// 🧪 Oberflächen-Test der Karte und der Offline-App (Browser, ohne Home Assistant). Start: node tests/ui/ui.test.mjs
// Optional: SHOTS=ordner → Screenshots dort speichern.
import { chromium } from "playwright";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const app = path.join(root, "custom_components/fixkosten/www/app");
const srv = http.createServer((q, r) => {
  const url = q.url.split("?")[0];
  if (url === "/favicon.ico") { r.statusCode = 204; r.end(); return; }
  if (url.startsWith("/auth/")) { r.statusCode = 503; r.end("{}"); return; }
  let f = url === "/" ? path.join(root, "tests/ui/harness.html")
    : url.startsWith("/fixkosten/app/") ? path.join(app, url.slice(15) || "index.html")
    : url.startsWith("/fixkosten/files/") ? path.join(root, "custom_components/fixkosten/www", url.slice(17))
    : path.join(root, url);
  r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".svg") ? "image/svg+xml" : f.endsWith(".png") ? "image/png" : f.endsWith(".json") ? "application/json" : f.endsWith(".webmanifest") ? "application/manifest+json" : "text/html");
  try { const buf = fs.readFileSync(f); r.end(f.endsWith(".png") ? buf : buf.toString().replaceAll("__FK_VERSION__", "test")); } catch (e) { r.statusCode = 404; r.end(); }
}).listen(0);
const port = srv.address().port;
const exe = process.env.PLAYWRIGHT_CHROMIUM || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const shots = process.env.SHOTS;
const p = await b.newPage({ viewport: { width: 560, height: 1100 }, deviceScaleFactor: shots ? 2 : 1 });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => { if (m.type() === "error" || /Symbol fehlt/.test(m.text())) errs.push(m.text()); });
await p.goto(`http://localhost:${port}/`);
await p.waitForFunction(() => window.__ready);
await p.waitForTimeout(200);

let fails = 0;
const check = (name, ok, info = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : " – " + info}`); if (!ok) fails++; };
const sr = (js) => p.evaluate(`(() => { const h = document.querySelector('#c1').shadowRoot; ${js} })()`);
const shot = async (name) => { if (shots) await p.locator("#c1").screenshot({ path: path.join(shots, name) }); };

// Ausgaben: 1030 (Kfz-Steuer nur im März) – davon 865 bezahlt → offen 1030-865 = 165 (+ Kfz nur im März). Monat abhängig von heute:
const exp = await p.evaluate(() => { const m = new Date().getMonth() + 1; const fix = 800 + 65 + 12.99 + 50 + 45 + 58 + (m === 3 ? 120 : 0); return { open: fix - 865, avail: 1500 - (fix - 865) - 23.4 }; });
let big = await sr(`return h.querySelector('.big').textContent.trim();`);
const fmt = (v) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(v);
check("Verfügbar richtig gerechnet", big === fmt(exp.avail), `${big} statt ${fmt(exp.avail)}`);
check("Gruppen, Einnahmen, Töpfe sind zu", await sr(`return !h.querySelector('[data-a="paid"]') && !!h.querySelector('[data-a="sec"][data-v="g:g01"]') && !h.querySelector('[data-a="pot"]');`));
check("Hinweis nur für festen Tag (Streaming am 20.)", await sr(`return /Streaming/.test(h.querySelector('.next')?.textContent || '') && !/Jetzt fällig/.test(h.innerHTML);`), await sr(`return h.querySelector('.next')?.textContent || 'kein Hinweis';`));
check("Reiter: Übersicht · Rückblick · Bearbeiten", await sr(`return [...h.querySelectorAll('.tab')].map((t) => t.dataset.v).join() === "home,hist,edit";`));
await shot("1a-zugeklappt.png");
await sr(`h.querySelector('[data-a="sec"][data-v="g:g01"]').click();`);
await sr(`h.querySelector('[data-a="sec"][data-v="g:g15"]').click();`);
check("Aufklappen zeigt Posten, Pausierte grau + abgehakt", await sr(`const r = [...h.querySelectorAll('.item.paused')]; return !!h.querySelector('[data-a="paid"][data-id="p1"]') && r.length === 1 && /Zeitschrift/.test(r[0].textContent) && r[0].classList.contains('done');`));
check("Aufgeklappt wird gemerkt", await p.evaluate(() => JSON.parse(localStorage.getItem("fixkosten_offen")).includes("g:g01")));
await shot("1-uebersicht.png");

// 💳 Ausgabe über Schnellknopf
await sr(`h.querySelector('[data-a="quick"][data-v="Bäckerei"]').click();`);
await p.waitForTimeout(80);
await sr(`const f = h.querySelector('form[data-a="booking"]'); f.amount.value = "5,75"; f.requestSubmit();`);
await p.waitForTimeout(80);
big = await sr(`return h.querySelector('.big').textContent.trim();`);
check("Ausgabe zieht sofort ab", big === fmt(exp.avail - 5.75), big);
check("Änderung an HA geschickt", await p.evaluate(() => fake.applied.some((o) => o.type === "booking_add" && o.name === "Bäckerei" && o.amount === 5.75)));

check("Schnellknöpfe in einer Zeile zum Wischen", await sr(`const q = getComputedStyle(h.querySelector('.quick')); return q.flexWrap === "nowrap" && q.overflowX === "auto";`));
check("Heißt jetzt „Ausgaben“", await sr(`return /Ausgaben/.test(h.innerHTML) && !/Kartenzahlung/.test(h.innerHTML);`));
// ✏️ Ausgabe antippen = ändern
await sr(`h.querySelector('.item[data-k="booking"][data-id="b1"]').click();`);
await p.waitForTimeout(50);
await shot("2b-ausgabe-aendern.png");
await sr(`const f = h.querySelector('form[data-a="bsave"]'); f.name.value = "Tanken"; f.amount.value = "23,40"; f.requestSubmit();`);
await p.waitForTimeout(80);
check("Ausgabe ändern schickt Name und Betrag", await p.evaluate(() => fake.applied.some((o) => o.type === "booking_edit" && o.id === "b1" && o.name === "Tanken" && o.amount === 23.4)), await p.evaluate(() => JSON.stringify(fake.applied.filter((o) => o.type === "booking_edit"))));

// ↩️ Löschen mit Rückgängig
await sr(`h.querySelector('[data-a="bdel"][data-id="b1"]').click();`);
await p.waitForTimeout(80);
check("Löschen ohne Nachfrage, Rückgängig-Leiste da", await sr(`return !h.querySelector('[data-a="bdel"][data-id="b1"]') && !!h.querySelector('.undobar');`));
await shot("2a-rueckgaengig.png");
await sr(`h.querySelector('[data-a="undo"]').click();`);
await p.waitForTimeout(80);
check("Rückgängig holt die Ausgabe zurück", await sr(`return !!h.querySelector('[data-a="bdel"][data-id="b1"]') && !h.querySelector('.undobar');`) && await p.evaluate(() => fake.applied.some((o) => o.type === "restore" && o.item.id === "b1")));

// 📴 Offline: Haken setzen → Postausgang, Zahl ändert sich trotzdem
await p.evaluate(() => setOnline(false));
await sr(`h.querySelector('[data-a="paid"][data-id="p5"]').click();`);
await p.waitForTimeout(80);
const off = await sr(`return { banner: h.querySelector('.pill.wait')?.textContent || '', big: h.querySelector('.big').textContent.trim() };`);
check("Offline: Postausgang wird angezeigt", /1 wartet/.test(off.banner), off.banner);
check("Offline: Haken zählt sofort", off.big === fmt(exp.avail - 5.75 + 45), off.big);
check("Offline: Postausgang im Speicher", await p.evaluate(() => JSON.parse(localStorage.getItem("fixkosten_queue")).length === 1));
await shot("2-offline.png");
await p.evaluate(() => setOnline(true));
await p.waitForTimeout(150);
check("Wieder online: nachgeschickt", await p.evaluate(() => fake.applied.some((o) => o.type === "paid" && o.id === "p5") && JSON.parse(localStorage.getItem("fixkosten_queue")).length === 0));

// 🧮 Taschenrechner: 12,5 × 4 − 20 = 30
await sr(`h.querySelector('[data-a="calc"]').click();`);
for (const k of ["1", "2", ",", "5", "×", "4", "−", "2", "0"]) await sr(`h.querySelector('[data-a="ckey"][data-v="${k}"]').click();`);
const calcRes = await sr(`return h.querySelector('.calc .res').textContent.trim();`);
check("Taschenrechner rechnet", calcRes === fmt(30), calcRes);
await shot("1b-taschenrechner.png");
await sr(`h.querySelector('[data-a="cuse"][data-v="pay"]').click();`);
await p.waitForTimeout(80);
check("Rechner-Ergebnis landet in Ausgabe", await sr(`return h.querySelector('form[data-a="booking"]').amount.value === "30";`), await sr(`return h.querySelector('form[data-a="booking"]').amount.value;`));
await sr(`h.querySelector('form[data-a="booking"]').amount.value = ""; h.activeElement?.blur();`);

// 🙈 Beträge verstecken
await sr(`h.querySelector('[data-a="hide"]').click();`);
check("Verstecken: Beträge verschwommen", await sr(`return h.querySelectorAll('.hidden-amt').length > 5;`));
await sr(`h.querySelector('[data-a="hide"]').click();`);

// ✏️ Bearbeiten: neuen Posten anlegen
await sr(`h.querySelector('[data-a="tab"][data-v="edit"]').click();`);
await sr(`h.querySelector('[data-a="new"][data-k="posten"]').click();`);
await sr(`const f = h.querySelector('form[data-a="save"]'); f.name.value = "Fitnessstudio"; f.amount.value = "29,90"; f.group.value = "g15"; f.pay.value = "lastschrift"; h.querySelector('.months button[data-v="1"]').click(); f.requestSubmit();`);
await p.waitForTimeout(80);
const saved = await p.evaluate(() => fake.applied.find((o) => o.type === "posten_save"));
check("Posten anlegen schickt alle Felder", saved && saved.item.name === "Fitnessstudio" && saved.item.amount === 29.9 && saved.item.group === "g15" && saved.item.months.join() === "1", JSON.stringify(saved));
check("Keine ▲▼-Pfeile mehr, nur der Griff", await sr(`return !h.querySelector('[data-a="mv"]') && h.querySelectorAll('[data-grip="gruppe"]').length === 2;`));
check("Griff ⠿ zum Ziehen da", await sr(`return h.querySelectorAll('[data-grip="posten"]').length >= 7 && h.querySelectorAll('[data-grip="topf"]').length === 3;`));
// ⠿ echtes Ziehen mit der Maus: PayPal-Topf ganz nach oben
const box = async (sel) => p.evaluate((q) => { const r = document.querySelector('#c1').shadowRoot.querySelector(q).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.y }; }, sel);
const g = await box('[data-row="t3"] [data-grip]'), t1 = await box('[data-row="t1"]');
await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x, t1.top + 3, { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(80);
const tord = await p.evaluate(() => fake.applied.filter((o) => o.type === "order" && o.kind === "topf").pop());
check("Ziehen am Griff sortiert Töpfe", tord && tord.ids.join() === "t3,t1,t2", JSON.stringify(tord));
check("Ziehen öffnet nicht aus Versehen den Eintrag", await sr(`return !h.querySelector('form[data-a="save"]');`));
await shot("3-bearbeiten.png");

// 📊 Rückblick
await sr(`h.querySelector('[data-a="tab"][data-v="hist"]').click();`);
check("Rückblick: 4 Monate", await sr(`return h.querySelectorAll('.hist .m').length === 4;`));
await shot("4-rueckblick.png");

// 🔄 Neue Version: Hinweis mit „Neu laden“
await p.evaluate(() => { const c = document.querySelector('#c1'); c._server.version = "9.9.9"; c._force = true; c._render(); });
check("Neue Version: Leiste mit Neu laden", await sr(`return /Neue Version 9.9.9/.test(h.querySelector('.updbar')?.textContent || '') && !!h.querySelector('.updbar [data-a="reload"]');`));
await shot("4b-neue-version.png");
await p.evaluate(() => { const c = document.querySelector('#c1'); delete c._server.version; c._force = true; c._render(); });

// ⚙️ Einstellungen: Zahnrad oben in der Leiste
check("⚙️ sitzt oben in der Leiste, 🔒 in der Zeile darunter", await sr(`return !!h.querySelector('.topbar [data-a="tab"][data-v="set"]') && !!h.querySelector('.head [data-a="lock"]') && !h.querySelector('.head [data-v="set"]');`));
await sr(`h.querySelector('.topbar [data-a="tab"][data-v="set"]').click();`);
check("⚙️ wie Einkaufsliste: 3 Kästen, zugeklappt, ✕ oben", await sr(`return h.querySelectorAll('.lgbox').length === 3 && !h.querySelector('.lrow') && h.querySelector('.head [data-a="back"] ha-icon')?.getAttribute('icon') === 'mdi:close';`));
await sr(`h.querySelector('[data-a="setgrp"][data-v="App & Info"]').click();`);
check("Kasten aufklappen zeigt Zeilen mit bunten Symbolen", await sr(`return h.querySelectorAll('.lrow .ic').length === 5;`));
await shot("5-einstellungen.png");
await sr(`h.querySelector('[data-a="sheet"][data-v="app"]').click();`);
check("Offline-App als Seite in der Karte, ← oben", await sr(`return /Zum Startbildschirm/.test(h.querySelector('.pagehost')?.textContent || '') && h.querySelector('.head [data-a="back"] ha-icon')?.getAttribute('icon') === 'mdi:arrow-left';`));
await shot("5b-offline-app.png");
await sr(`h.querySelector('.head [data-a="back"]').click();`);
await sr(`h.querySelector('[data-a="sheet"][data-v="news"]').click();`);
check("Was ist neu: Beta-Kasten", await sr(`return /Du bist in der Beta/.test(h.querySelector('.pagehost')?.textContent || '');`));
await sr(`h.querySelector('.head [data-a="back"]').click();`);
await sr(`h.querySelector('[data-a="setgrp"][data-v="Rechnen"]').click();`);
await sr(`h.querySelector('[data-a="sheet"][data-v="quick"]').click();`);
await sr(`h.querySelector('[data-a="quicktext"]').value = "Bäckerei\\nNetto, Lidl & Co."; h.querySelector('[data-a="quicksave"]').click();`);
await p.waitForTimeout(50);
check("Schnellknöpfe: einer pro Zeile, Komma erlaubt", await p.evaluate(() => fake.applied.some((o) => o.type === "settings" && o.settings.quick?.join("|") === "Bäckerei|Netto, Lidl & Co.")));
await sr(`h.querySelector('.head [data-a="back"]').click();`);
await sr(`h.querySelector('[data-a="sheet"][data-v="rechnen"]').click();`);
await sr(`const c = h.querySelector('[data-a="setreset"]'); c.checked = false; c.dispatchEvent(new Event('change'));`);
await p.waitForTimeout(80);
check("Schalter Haken-Reset schickt Einstellung", await p.evaluate(() => fake.applied.some((o) => o.type === "settings" && o.settings.reset_checks === false)));
await sr(`h.querySelector('.head [data-a="back"]').click();`);

// 🔒 PIN einschalten (Zahlenfeld wie bei der Einkaufsliste) → sperren → falsche PIN → richtige PIN
const keys = async (pin) => { for (const k of pin) await sr(`h.querySelector('[data-a="pkey"][data-v="${k}"]').click();`); };
await sr(`h.querySelector('[data-a="setgrp"][data-v="App & Info"]').click();`);
await sr(`h.querySelector('[data-a="sheet"][data-v="pin"]').click();`);
await sr(`h.querySelector('[data-a="padstart"][data-v="set"]').click();`);
check("PIN-Zahlenfeld: 12 Tasten und Punkte", await sr(`return h.querySelectorAll('.ppad [data-a="pkey"]').length === 12 && !!h.querySelector('.pdots') && !h.querySelector('input[type="password"]');`));
await keys("4711");
check("Punkte zeigen 4 Ziffern", await sr(`return h.querySelector('.pdots').textContent === "●●●●";`));
await shot("5c-pin-zahlenfeld.png");
await keys("✔");
await keys("4711✔");
await p.waitForTimeout(120);
check("PIN gespeichert", await p.evaluate(() => fake.pin === "4711" && toasts.includes("🔒 PIN gespeichert")), await p.evaluate(() => toasts.join(" | ")));
await sr(`h.querySelector('[data-a="lock"]').click();`);
await p.waitForTimeout(50);
await sr(`h.querySelector('.topbar [data-a="tab"][data-v="set"]').click();`);
check("Gesperrt: PIN-Zahlenfeld als Seite", await sr(`return !!h.querySelector('.pagehost .ppad') && !h.querySelector('.lgbox');`));
await shot("7-pin-gesperrt.png");
for (const k of "0000") await p.keyboard.press(k);
await p.keyboard.press("Enter");
await p.waitForTimeout(80);
check("Falsche PIN (Tastatur) bleibt zu", await sr(`return !!h.querySelector('.ppad');`) && await p.evaluate(() => toasts.includes("❌ Falsche PIN")));
await keys("4711✔");
await p.waitForTimeout(80);
check("Richtige PIN entsperrt", await sr(`return !!h.querySelector('.lgbox') && !h.querySelector('.ppad');`));
check("Übersicht geht ohne PIN", await (async () => { await sr(`h.querySelector('[data-a="lock"]').click(); h.querySelector('[data-a="tab"][data-v="home"]').click();`); return sr(`return !!h.querySelector('.big');`); })());
check("Meine Konten zugeklappt", await sr(`return !!h.querySelector('[data-a="sec"][data-v="konten"]') && !h.querySelector('[data-a="copy"]');`));

// 📖 Anleitung wie bei der Einkaufsliste
await sr(`h.querySelector('.foot [data-v="guide"]').click();`);
check("Anleitung: Kästen, Was ist neu zuerst, PayPal", await sr(`const s = h.querySelectorAll('details.elg-sec'); return s.length >= 14 && /Was ist neu/.test(s[0].textContent) && !!h.querySelector('a.paypal');`));
await sr(`const q = h.querySelector('.elg-q'); q.value = "fingerabdruck"; q.dispatchEvent(new Event('input'));`);
check("Anleitung: Suche filtert", await sr(`const v = [...h.querySelectorAll('details.elg-sec')].filter((x) => !x.hidden); return v.length >= 1 && v.length < 5 && v.every((x) => x.open);`));
await sr(`const q = h.querySelector('.elg-q'); q.value = ""; q.dispatchEvent(new Event('input')); h.querySelector('details.elg-sec').open = true;`);
await shot("8-anleitung.png");

// 📱 Offline-App: Anmeldeseite lädt ohne Fehler
const a = await b.newPage({ viewport: { width: 390, height: 760 }, deviceScaleFactor: shots ? 2 : 1 });
a.on("pageerror", (e) => errs.push("app: " + String(e)));
await a.goto(`http://localhost:${port}/fixkosten/app/`);
await a.waitForSelector("#loginBtn");
check("App: Anmeldeseite da", await a.evaluate(() => document.querySelector("h1")?.textContent === "Fixkosten"));
check("App: Icon lädt", await a.evaluate(() => { const i = document.querySelector(".login img"); return i && i.complete && i.naturalWidth === 192; }));
if (shots) await a.screenshot({ path: path.join(shots, "6-app-anmeldung.png") });

check("Keine Fehler in der Konsole", errs.length === 0, errs.join(" | "));
await b.close();
srv.close();
console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen` : "\nAlles grün 🎉");
process.exit(fails ? 1 : 0);
