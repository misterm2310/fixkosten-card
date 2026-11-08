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
  try { const buf = fs.readFileSync(f); r.end(/\.(png|webp)$/.test(f) ? buf : buf.toString().replaceAll("__FK_VERSION__", "test")); } catch (e) { r.statusCode = 404; r.end(); }
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
check("Kein Hinweis „Nächste Abbuchung“ oben mehr", await sr(`return !h.querySelector('.next');`));
check("Reiter: Übersicht · Statistik · Bearbeiten", await sr(`return [...h.querySelectorAll('.tab')].map((t) => t.dataset.v).join() === "home,stat,edit";`));
await shot("1a-zugeklappt.png");
await sr(`h.querySelector('[data-a="sec"][data-v="g:g01"]').click();`);
await sr(`h.querySelector('[data-a="sec"][data-v="g:g15"]').click();`);
check("Aufklappen zeigt Posten, Pausierte grau + abgehakt", await sr(`const r = [...h.querySelectorAll('.item.paused')]; return !!h.querySelector('[data-a="paid"][data-id="p1"]') && r.length === 1 && /Zeitschrift/.test(r[0].textContent) && r[0].classList.contains('done');`));
check("Aufgeklappt wird nicht gemerkt", await p.evaluate(() => localStorage.getItem("fixkosten_offen") === null));
await shot("1-uebersicht.png");
// ✅ 1.0.1-beta.1: abgehakt am … · 💶 Preis nur diesen Monat
check("Abgehakte Fixkosten zeigen das Datum", await sr(`return /\\d\\d\\.\\d\\d\\./.test(h.querySelector('[data-a="paid"][data-id="p1"]').closest('.item').querySelector('.meta').textContent) && !/\\d\\d\\.\\d\\d\\./.test(h.querySelector('[data-a="paid"][data-id="p4"]').closest('.item').textContent);`), await sr(`return h.querySelector('[data-a="paid"][data-id="p1"]').closest('.item').textContent;`));
await sr(`h.querySelector('.amt[data-a="mprice"][data-id="p4"]').click();`);
await p.waitForTimeout(60);
check("Betrag antippen öffnet „nur diesen Monat“ unter der Zeile (Zeile bleibt)", await sr(`const f = h.querySelector('form[data-a="mpsave"][data-id="p4"]'); return !!f && /Normal/.test(f.textContent) && f.previousElementSibling?.classList.contains("opened") && f.amount.value === "50";`));
await shot("14-preis-nur-diesen-monat.png");
await sr(`const f = h.querySelector('form[data-a="mpsave"]'); f.amount.value = "70"; f.requestSubmit();`);
await p.waitForTimeout(100);
check("Sonderpreis geschickt und gerechnet", await p.evaluate(() => fake.applied.some((o) => o.type === "posten_month" && o.id === "p4" && o.amount === 70 && o.month)) && (await sr(`return h.querySelector('.big').textContent.trim();`)) === fmt(exp.avail - 20), await sr(`return h.querySelector('.big').textContent.trim();`));
check("Sonderpreis: ✏️ nur … am Posten, Betrag 70", await sr(`const r = h.querySelector('.amt[data-id="p4"]').closest('.item'); return /nur /.test(r.querySelector('.tag.mp')?.textContent || '') && /70,00/.test(r.querySelector('.amt').textContent);`), await sr(`return h.querySelector('.amt[data-id="p4"]').closest('.item').textContent;`));
await shot("15-sonderpreis.png");
await sr(`h.querySelector('.amt[data-a="mprice"][data-id="p4"]').click();`);
await p.waitForTimeout(60);
await sr(`h.querySelector('[data-a="mpreset"][data-id="p4"]').click();`);
await p.waitForTimeout(100);
check("↺ zurück auf normal", await p.evaluate(() => fake.applied.some((o) => o.type === "posten_month" && o.id === "p4" && o.amount === "")) && (await sr(`return h.querySelector('.big').textContent.trim();`)) === fmt(exp.avail));
check("Schnellknöpfe haben verschiedene Farben", await sr(`const c = [...h.querySelectorAll('.quick .chip')].map((x) => getComputedStyle(x).borderTopColor); return c.length >= 3 && new Set(c).size === c.length;`));
// 🎨 beta.3: Farbe hängt am Namen – umsortieren ändert nichts; eigene Farbe gewinnt
const colBefore = await sr(`return h.querySelector('.quick .chip[data-v="Amazon"]').style.getPropertyValue('--qc');`);
await sr(`const c = h.host; c._server.settings.quick = ["Amazon", ...c._server.settings.quick.filter((q) => q !== "Amazon")]; c._force = true; c._render();`);
await p.waitForTimeout(60);
check("Schnellknopf behält Farbe beim Umsortieren", await sr(`return h.querySelector('.quick .chip').dataset.v === "Amazon" && h.querySelector('.quick .chip[data-v="Amazon"]').style.getPropertyValue('--qc') === "${colBefore}";`), colBefore);
await sr(`const c = h.host; c._server.settings.quick_colors = { amazon: "#123456" }; c._force = true; c._render();`);
await p.waitForTimeout(40);
check("Eigene Farbe für Schnellknopf", await sr(`return h.querySelector('.quick .chip[data-v="Amazon"]').style.getPropertyValue('--qc') === "#123456";`));
await sr(`const c = h.host; delete c._server.settings.quick_colors; c._force = true; c._render();`);
// 💳 Raten
await sr(`const c = h.host, d = c._server, [y, m] = d.month.split("-").map(Number), u = new Date(y, m - 1 + 2, 1); d.posten.find((p) => p.id === "p6").until = u.getFullYear() + "-" + String(u.getMonth() + 1).padStart(2, "0"); c._force = true; c._render();`);
await p.waitForTimeout(40);
check("Raten: „noch 3 Raten“ am Posten", await sr(`return /noch 3 Raten/.test(h.querySelector('[data-a="paid"][data-id="p6"]').closest('.item').textContent);`), await sr(`return h.querySelector('[data-a="paid"][data-id="p6"]').closest('.item').textContent;`));
await shot("16-raten.png");
await sr(`const c = h.host, d = c._server; d.posten.find((p) => p.id === "p6").until = "2020-01"; c._force = true; c._render();`);
await p.waitForTimeout(40);
check("Raten abbezahlt: zählt nicht mehr mit", await sr(`return !h.querySelector('[data-a="paid"][data-id="p6"]');`));
await sr(`const c = h.host; delete c._server.posten.find((p) => p.id === "p6").until; c._force = true; c._render();`);
check("Raten bis: Monat + Jahr als Auswahl (Jahr änderbar)", await sr(`const c = h.host, t = document.createElement("div"); t.innerHTML = c._form(c._server, "posten", { id: "p6", name: "Kredit", until: "2027-03" }); const m = t.querySelector('select[name="until_m"]'), y = t.querySelector('select[name="until_y"]'); return !!m && !!y && m.value === "03" && y.value === "2027" && y.options.length >= 10 && !t.querySelector('input[type="month"]');`));
await p.waitForTimeout(40);

// 💳 Ausgabe über Schnellknopf
await sr(`h.querySelector('[data-a="quick"][data-v="Bäckerei"]').click();`);
await p.waitForTimeout(80);
await sr(`const f = h.querySelector('form[data-a="booking"]'); f.amount.value = "5,75"; f.requestSubmit();`);
await p.waitForTimeout(80);
big = await sr(`return h.querySelector('.big').textContent.trim();`);
check("Ausgabe zieht sofort ab", big === fmt(exp.avail - 5.75), big);
check("Änderung an HA geschickt", await p.evaluate(() => fake.applied.some((o) => o.type === "booking_add" && o.name === "Bäckerei" && o.amount === 5.75)));
check("Ausgabe „Bäckerei“ hat die Farbe ihres Schnellknopfs", await sr(`const chip = h.querySelector('.quick .chip[data-v="Bäckerei"]'), row = [...h.querySelectorAll('.item[data-k="booking"]')].find((x) => /Bäckerei/.test(x.textContent)); return !!row && row.style.getPropertyValue('--cc') === chip.style.getPropertyValue('--qc');`));
// 🎨 beta.2: Namensanfang zählt („PayPal - Claude“ → PayPal), Orange nur ohne passenden Knopf
await sr(`const f = h.querySelector('form[data-a="booking"]'); f.name.value = "PayPal - Claude"; f.amount.value = "1"; f.requestSubmit();`);
await p.waitForTimeout(80);
await sr(`const f = h.querySelector('form[data-a="booking"]'); f.name.value = "PayPalX"; f.amount.value = "1"; f.requestSubmit();`);
await p.waitForTimeout(80);
check("„PayPal - Claude“ bekommt die PayPal-Farbe, „PayPalX“ bleibt orange, kein Knopf orange", await sr(`const row = (n) => [...h.querySelectorAll('.item[data-k="booking"]')].find((x) => x.querySelector('b').textContent === n); const pp = h.querySelector('.quick .chip[data-v="PayPal"]').style.getPropertyValue('--qc'); const chips = [...h.querySelectorAll('.quick .chip')].map((x) => x.style.getPropertyValue('--qc')); return row("PayPal - Claude").style.getPropertyValue('--cc') === pp && row("PayPalX").style.getPropertyValue('--cc') === "#ff9800" && !chips.includes("#ff9800");`));
await sr(`for (const n of ["PayPal - Claude", "PayPalX"]) { const r = [...h.querySelectorAll('.item[data-k="booking"]')].find((x) => x.querySelector('b').textContent === n); r.querySelector('[data-a="bdel"]').click(); }`);
await p.waitForTimeout(80);

check("Schnellknöpfe in einer Zeile zum Wischen", await sr(`const q = getComputedStyle(h.querySelector('.quick')); return q.flexWrap === "nowrap" && q.overflowX === "auto";`));
check("Heißt jetzt „Ausgaben“", await sr(`return /Ausgaben/.test(h.innerHTML) && !/Kartenzahlung/.test(h.innerHTML);`));
// ✏️ Ausgabe antippen = ändern
await sr(`h.querySelector('.item[data-k="booking"][data-id="b1"]').click();`);
await p.waitForTimeout(50);
await shot("2b-ausgabe-aendern.png");
await sr(`const f = h.querySelector('form[data-a="bsave"]'); f.name.value = "Tanken"; f.amount.value = "23,40"; f.requestSubmit();`);
await p.waitForTimeout(80);
check("Ausgabe ändern schickt Name und Betrag", await p.evaluate(() => fake.applied.some((o) => o.type === "booking_edit" && o.id === "b1" && o.name === "Tanken" && o.amount === 23.4)), await p.evaluate(() => JSON.stringify(fake.applied.filter((o) => o.type === "booking_edit"))));

check("Ausgaben abhaken mit dem Kreis vorne (wie Fixkosten)", await sr(`const b = h.querySelector('[data-a="clear"]'); return !!b && b.classList.contains('chk') && b.parentElement.firstElementChild === b && /abgebucht/.test(b.title);`));
// 👆 lange drücken zeigt den Namen, löst aber nichts aus
const cb = await p.evaluate(() => { const r = document.querySelector('#c1').shadowRoot.querySelector('[data-a="clear"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const nApplied = await p.evaluate(() => fake.applied.length);
await p.mouse.move(cb.x, cb.y); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up();
await p.waitForTimeout(80);
check("Lange drücken zeigt Info statt abzubuchen", await p.evaluate((n) => toasts.some((t) => /abgebucht/.test(t)) && fake.applied.length === n, nApplied), await p.evaluate(() => toasts.join(" | ")));

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
check("Bildschirm-an-Knopf oben zwischen Auge und Schloss", await sr(`const b = [...h.querySelectorAll('.head .iconbtn, .iconbtn')].map((x) => x.dataset.a).join(','); return b.includes('hide,awake,lock');`));
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

// 💵 Einnahmen abhaken
await sr(`h.querySelector('[data-a="tab"][data-v="home"]').click();`);
await sr(`h.querySelector('[data-a="sec"][data-v="einnahmen"]').click();`);
await p.waitForTimeout(50);
await sr(`h.querySelector('[data-a="recv"]').click();`);
await p.waitForTimeout(100);
check("Einnahme abhaken schickt „received“", await p.evaluate(() => fake.applied.some((o) => o.type === "received" && o.value === true)));
await sr(`h.querySelector('[data-a="sec"][data-v="einnahmen"]').click();`);

// 🏦 Kontostand auf eigener Seite
await sr(`h.querySelector('[data-a="tab"][data-v="home"]').click();`);
await sr(`h.querySelector('[data-a="balance"]').click();`);
check("Konto: eigene Seite, kein „Vorgemerkt“", await sr(`return !!h.querySelector('.pagehost form[data-a="kontosave"]') && !/orgemerkt/.test(h.innerHTML);`));
await shot("4c-konto.png");
await sr(`const f = h.querySelector('form[data-a="kontosave"]'); f.balance.value = "1500,00"; f.requestSubmit();`);
await p.waitForTimeout(80);
check("Konto speichern schickt Stand", await p.evaluate(() => fake.applied.some((o) => o.type === "konto" && o.balance === 1500)) && await sr(`return !!h.querySelector('.big');`));
// 🐷 Topf: rausnehmen
await p.waitForTimeout(200); // erst die Antwort von HA abwarten (zeichnet neu)
await sr(`h.querySelector('[data-a="sec"][data-v="toepfe"]').click();`);
await p.waitForTimeout(50);
await sr(`h.querySelector('.item[data-k="pot"][data-id="t2"]').click();`);
await p.waitForTimeout(50);
await shot("4d-topf.png");
await sr(`const f = h.querySelector('form[data-a="potmove"]'); f.amount.value = "50"; f.querySelector('button[value="take"]').click();`);
await p.waitForTimeout(80);
check("Topf: Rausnehmen schickt topf_take", await p.evaluate(() => fake.applied.some((o) => o.type === "topf_take" && o.id === "t2" && o.amount === 50)));
check("Topf: „geliehen“ in Orange", await sr(`const t = h.querySelector('.item[data-id="t2"] .tag.lent')?.textContent || ''; return /50,00/.test(t) && /geliehen/.test(t);`), await sr(`return h.querySelector('.item[data-id="t2"]')?.textContent || '-';`));
check("Topf-Liste: oranger Zettel ist nur Anzeige", await sr(`return !h.querySelector('.item[data-id="t2"] [data-a="lentoff"]');`));
await p.waitForTimeout(200); // erst die Antwort von HA abwarten (zeichnet neu)
await sr(`h.querySelector('.item[data-k="pot"][data-id="t2"]').click();`);
await p.waitForTimeout(50);
p.once("dialog", (dl) => dl.accept());
await shot("4e-topf-geliehen.png");
await sr(`h.querySelector('.potbox [data-a="lentoff"]').click();`);
await p.waitForTimeout(80);
check("Topf: orangen Zettel antippen = nicht mehr zurücklegen (topf_keep)", await p.evaluate(() => fake.applied.some((o) => o.type === "topf_keep" && o.id === "t2")) && await sr(`return !h.querySelector('.item[data-id="t2"] .tag.lent');`));
await sr(`h.querySelector('.item[data-k="pot"][data-id="t2"]').click();`);
await p.waitForTimeout(50);
await sr(`const f = h.querySelector('form[data-a="potmove"]'); f.amount.value = "50"; f.querySelector('button[value="take"]').click();`);
await p.waitForTimeout(150);
await sr(`h.querySelector('.item[data-k="pot"][data-id="t2"]').click();`);
await p.waitForTimeout(50);
await sr(`const f = h.querySelector('form[data-a="potmove"]'); f.querySelector('button[value="return"]').click();`);
await p.waitForTimeout(80);
check("Topf: Zurücklegen (Vorschlag = geliehen)", await p.evaluate(() => fake.applied.some((o) => o.type === "topf_return" && o.id === "t2" && o.amount === 50)) && await sr(`return !h.querySelector('.item[data-id="t2"] .tag.lent');`));
// ✏️ Topf: Stand korrigieren hat ein eigenes Feld (mit dem jetzigen Stand drin)
await p.waitForTimeout(150);
await sr(`h.querySelector('.item[data-k="pot"][data-id="t2"]').click();`);
await p.waitForTimeout(50);
check("Topf: schlank – nur Symbol-Knöpfe ohne Text, mit Namen für langes Drücken", await sr(`const b = [...h.querySelectorAll('.potbox button')]; return b.length === 4 && b.every((x) => !x.textContent.trim() && x.title);`));
check("Topf: kein „Als neuen Stand setzen“ mehr am Betragsfeld", await sr(`return !h.querySelector('form[data-a="potmove"] button[value="set"]') && !!h.querySelector('form[data-a="potset"] input[name="stand"]').value;`));
await sr(`const f = h.querySelector('form[data-a="potset"]'); f.stand.value = "777"; f.requestSubmit();`);
await p.waitForTimeout(80);
check("Topf: Stand korrigieren schickt topf_save", await p.evaluate(() => fake.applied.some((o) => o.type === "topf_save" && o.item?.id === "t2" && o.item?.amount === 777)));
await p.waitForTimeout(150);
check("Töpfe zeigen das Datum der letzten Änderung", await sr(`return /\\d\\d\\.\\d\\d\\./.test(h.querySelector('.item[data-k="pot"][data-id="t2"] .meta')?.textContent || '');`), await sr(`return h.querySelector('.item[data-k="pot"][data-id="t2"]')?.textContent;`));
await sr(`h.querySelector('.item[data-k="pot"][data-id="t3"]').click();`);
await p.waitForTimeout(50);
await sr(`const f = h.querySelector('form[data-a="potset"]'); f.stand.value = ""; f.requestSubmit();`);
await p.waitForTimeout(80);
check("Stand korrigieren: leeres Feld = 0,00", await p.evaluate(() => fake.applied.some((o) => o.type === "topf_save" && o.item?.id === "t3" && o.item?.amount === 0)));
await p.waitForTimeout(150);
// 💾 CSV-Export: Kontostand-Zeile + Datum bei Töpfen
const csv = await p.evaluate(async () => { const c = document.querySelector('#c1') || document.querySelector('fixkosten-card'); let blob; const o = URL.createObjectURL; URL.createObjectURL = (b) => { blob = b; return "blob:x"; }; const ac = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () {}; c._export(c._data); URL.createObjectURL = o; HTMLAnchorElement.prototype.click = ac; return await blob.text(); });
check("CSV hat Kontostand-Zeile", /\nkontostand;Konto;1500,00;\d\d\.\d\d\.\d{4}/.test(csv), csv.slice(0, 200));
check("CSV hat Datum bei Töpfen", /\ntopf;[^;]+;[^;]+;\d\d\.\d\d\.\d{4}/.test(csv), csv);
check("Blaue Zahl = offene Fixkosten + offene Ausgaben", await sr(`const b = h.querySelector('.badge'); return /Ausgaben/.test(b?.title || '') && Number(b.textContent) === Number(b.title.match(/(\\d+) Fixkosten/)[1]) + Number(b.title.match(/(\\d+) Ausgaben/)[1]);`));
// 💳 Ausgaben einklappbar: Standard offen, zu = nur Liste weg, Eingabe bleibt
check("Ausgaben: Standard offen", await sr(`return !!h.querySelector('[data-a="sec"][data-v="ausgaben_zu"]') && !!h.querySelector('.item[data-k="booking"]');`));
await sr(`h.querySelector('[data-a="sec"][data-v="ausgaben_zu"]').click();`);
await p.waitForTimeout(50);
check("Ausgaben zugeklappt: Liste weg, Schnellknöpfe + Eingabe bleiben", await sr(`return !h.querySelector('.item[data-k="booking"]') && !!h.querySelector('form[data-a="booking"]') && !!h.querySelector('.quick .chip');`));
await sr(`h.querySelector('[data-a="sec"][data-v="ausgaben_zu"]').click();`);
await p.waitForTimeout(50);
// ↩️ Zurück-Taste am Handy: Einstellungen → Seite → zurück → zurück
await sr(`h.querySelector('.topbar [data-a="tab"][data-v="set"]').click();`);
await sr(`h.querySelector('[data-a="setgrp"][data-v="Rechnen"]').click(); h.querySelector('[data-a="sheet"][data-v="rechnen"]').click();`);
await p.waitForTimeout(300);
check("Zurück-Merkzettel im Verlauf", await p.evaluate(() => !!history.state?.fkCardGuard));
check("Warnung ausschaltbar", await sr(`return !!h.querySelector('[data-a="setwarnon"]');`));
await sr(`const c = h.querySelector('[data-a="setwarnon"]'); c.checked = false; c.dispatchEvent(new Event('change'));`);
await p.waitForTimeout(80);
check("Warnung aus schickt Einstellung, Grenze verschwindet", await p.evaluate(() => fake.applied.some((o) => o.type === "settings" && o.settings.warn_enabled === false)) && await sr(`return !h.querySelector('[data-a="setwarn"]');`));
await p.goBack(); await p.waitForTimeout(300);
check("Zurück: Seite zu, Einstellungen bleiben", await sr(`return !h.querySelector('.pagehost') && h.querySelectorAll('.lgbox').length === 5;`));
await p.goBack(); await p.waitForTimeout(300);
check("Zurück: dann Übersicht", await sr(`return !!h.querySelector('.big');`));

// 🔄 Neue Version: Hinweis mit „Neu laden“
await p.evaluate(() => { const c = document.querySelector('#c1'); c._server.version = "9.9.9"; c._force = true; c._render(); });
check("Neue Version: Leiste mit Neu laden", await sr(`return /Neue Version 9.9.9/.test(h.querySelector('.updbar')?.textContent || '') && !!h.querySelector('.updbar [data-a="reload"]');`));
await shot("4b-neue-version.png");
await p.evaluate(() => { const c = document.querySelector('#c1'); delete c._server.version; c._force = true; c._render(); });

// ⚙️ Einstellungen: Zahnrad oben in der Leiste
check("⚙️ sitzt oben in der Leiste, 🔒 in der Zeile darunter", await sr(`return !!h.querySelector('.topbar [data-a="tab"][data-v="set"]') && !!h.querySelector('.head [data-a="lock"]') && !h.querySelector('.head [data-v="set"]');`));
await sr(`h.querySelector('.topbar [data-a="tab"][data-v="set"]').click();`);
check("⚙️ wie Einkaufsliste: 5 Kästen, zugeklappt, ✕ oben", await sr(`return h.querySelectorAll('.lgbox').length === 5 && !h.querySelector('.lrow') && h.querySelector('.head [data-a="back"] ha-icon')?.getAttribute('icon') === 'mdi:close';`));
await sr(`h.querySelector('[data-a="setgrp"][data-v="App & Info"]').click();`);
check("Kasten aufklappen zeigt Zeilen mit bunten Symbolen", await sr(`return h.querySelectorAll('.lrow .ic').length === 5;`));
await shot("5-einstellungen.png");
check("⚙️ Gruppen-Kästchen: farbig mit Linien-Symbol statt Emoji (wie EL)", await sr(`const g = [...h.querySelectorAll('.lgroup .gem')]; return g.length === 5 && g.every((x) => x.querySelector('ha-icon') && !/\\p{Extended_Pictographic}/u.test(x.textContent) && x.style.background);`));
await sr(`h.querySelector('[data-a="sheet"][data-v="app"]').click();`);
check("Offline-App als Seite in der Karte, ← oben", await sr(`return /Zum Startbildschirm/.test(h.querySelector('.pagehost')?.textContent || '') && h.querySelector('.head [data-a="back"] ha-icon')?.getAttribute('icon') === 'mdi:arrow-left';`));
await shot("5b-offline-app.png");
await sr(`h.querySelector('.head [data-a="back"]').click();`);
await sr(`h.querySelector('[data-a="sheet"][data-v="news"]').click();`);
// 🧪 Beta-Kasten nur in Testversionen; in offiziellen Versionen steht er NICHT da
const fkVer = JSON.parse(fs.readFileSync(path.join(root, "custom_components/fixkosten/manifest.json"), "utf8")).version;
const hatBetaKasten = await sr(`return /Du bist in der Beta/.test(h.querySelector('.pagehost')?.textContent || '');`);
check(/-beta/.test(fkVer) ? "Was ist neu: Beta-Kasten" : "Was ist neu: kein Beta-Kasten (offizielle Version)", /-beta/.test(fkVer) ? hatBetaKasten : !hatBetaKasten && await sr(`return (h.querySelector('.pagehost')?.textContent || '').includes('v${fkVer}');`));
await sr(`h.querySelector('.head [data-a="back"]').click();`);
// 📊 Rückblick, 🩺 Gesundheit, 💣 Werkseinstellungen in ⚙️
await sr(`h.querySelector('[data-a="setgrp"][data-v="Daten"]').click(); h.querySelector('[data-a="sheet"][data-v="hist"]').click();`);
check("Rückblick in ⚙️: 4 Monate", await sr(`return h.querySelectorAll('.pagehost .hist .m').length === 4;`));
await shot("4-rueckblick.png");
await sr(`h.querySelector('.head [data-a="back"]').click(); h.querySelector('[data-a="sheet"][data-v="factory"]').click();`);
check("Werkseinstellungen-Seite mit rotem Knopf", await sr(`return !!h.querySelector('.pagehost .btn.danger[data-a="factory"]');`));
await sr(`h.querySelector('.head [data-a="back"]').click(); h.querySelector('[data-a="setgrp"][data-v="Gesundheit"]').click(); h.querySelector('[data-a="sheet"][data-v="check"]').click();`);
check("Alles ok? zeigt Funde", await sr(`return h.querySelectorAll('.pagehost .finding').length >= 1 || !!h.querySelector('.pagehost .okmsg');`));
await shot("5d-alles-ok.png");
await sr(`h.querySelector('.head [data-a="back"]').click(); h.querySelector('[data-a="sheet"][data-v="errors"]').click();`);
await p.waitForTimeout(100);
check("Fehler-Protokoll lädt", await sr(`return /Keine Fehler|Protokoll leeren/.test(h.querySelector('.pagehost')?.textContent || '');`), await sr(`return h.querySelector('.pagehost')?.textContent || '-';`));
await sr(`h.querySelector('.head [data-a="back"]').click(); h.querySelector('[data-a="sheet"][data-v="stats"]').click();`);
await p.waitForTimeout(100);
check("Ressourcen zeigen Speicher", await sr(`return /In Home Assistant/.test(h.querySelector('.pagehost')?.textContent || '');`));
await sr(`h.querySelector('.head [data-a="back"]').click();`);
await sr(`h.querySelector('[data-a="setgrp"][data-v="Rechnen"]').click();`);
await sr(`h.querySelector('[data-a="sheet"][data-v="quick"]').click();`);
await p.waitForTimeout(40);
await shot("6a-schnellknoepfe-liste.png");
check("Schnellknöpfe: Liste wie Kategorien (Farbstreifen, Symbol, Griff, antippen)", await sr(`const r = h.querySelectorAll('.pagehost .storelist[data-list="quick"] .storerow'); return r.length >= 3 && !!r[0].querySelector('.grip') && !!r[0].querySelector('.storepick ha-icon') && !!r[0].style.getPropertyValue('--sc') && !h.querySelector('[data-a="quicktext"]');`));
await sr(`const f = h.querySelector('form[data-a="qadd"]'); f.querySelector('input[name="name"]').value = "Tankstelle"; f.requestSubmit();`);
await p.waitForTimeout(50);
check("Schnellknöpfe: ＋ Neu hängt den Knopf hinten an", await p.evaluate(() => fake.applied.some((o) => o.type === "settings" && o.settings.quick?.at(-1) === "Tankstelle")));
await sr(`h.querySelector('[data-a="qsel"][data-v="Amazon"]').click();`);
await p.waitForTimeout(40);
check("Schnellknopf antippen: eigene Seite mit Farbe, Name, Löschen und Symbolen", await sr(`return /Amazon/.test(h.querySelector('.pagehost .storehead')?.textContent || "") && !!h.querySelector('[data-a="qcolor"]') && !!h.querySelector('[data-a="qrename"]') && !!h.querySelector('[data-a="qdel"]') && h.querySelectorAll('.qicons .qic').length > 10;`));
await sr(`h.querySelector('.qic[data-i="mdi:package-variant-closed"]').click();`);
await p.waitForTimeout(40);
await shot("6b-schnellknopf-einstellen.png");
check("Schnellknopf: Symbol wählen schickt quick_icons", await p.evaluate(() => fake.applied.some((o) => o.type === "settings" && o.settings.quick_icons?.amazon === "mdi:package-variant-closed")));
await sr(`const i = h.querySelector('[data-a="qrename"]'); i.value = "Amazon Prime"; i.dispatchEvent(new Event('change'));`);
await p.waitForTimeout(40);
check("Schnellknopf umbenennen: Name, Farbe und Symbol wandern mit", await p.evaluate(() => fake.applied.some((o) => o.type === "settings" && o.settings.quick?.includes("Amazon Prime") && !o.settings.quick.includes("Amazon") && "quick_icons" in o.settings)));
await sr(`h.querySelector('[data-a="qdel"]').click();`);
await p.waitForTimeout(40);
check("Schnellknopf löschen: mit Rückgängig", await sr(`return /Schnellknopf weg/.test(h.querySelector('.undobar')?.textContent || "") && !h.querySelector('.storehead');`));
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
check("Anleitung: Kästen, Was ist neu zuerst, Credits wie Einkaufsliste (Logo, 4 Knöpfe, PayPal)", await sr(`const s = h.querySelectorAll('details.elg-sec'); return s.length >= 14 && /Was ist neu/.test(s[0].textContent) && !!h.querySelector('.elcredits a.elcbtn.pp') && h.querySelectorAll('.elcredits a.elcbtn').length === 4 && /mister-m\.webp/.test(h.querySelector('.elcredits .ellogo img')?.getAttribute('src') || '');`));
await sr(`const q = h.querySelector('.elg-q'); q.value = "fingerabdruck"; q.dispatchEvent(new Event('input'));`);
check("Anleitung: Suche filtert", await sr(`const v = [...h.querySelectorAll('details.elg-sec')].filter((x) => !x.hidden); return v.length >= 1 && v.length < 5 && v.every((x) => x.open);`));
await sr(`const q = h.querySelector('.elg-q'); q.value = ""; q.dispatchEvent(new Event('input')); h.querySelector('details.elg-sec').open = true;`);
await shot("8-anleitung.png");

// 👁️ Ansicht, 🔤 Beschriftungen, 🐷 Sparschwein, 🧘 Ruhiger Modus, 📜 Verlauf (beta.13)
await sr(`h.querySelector('.topbar [data-a="tab"][data-v="set"]').click();`);
await new Promise((r) => setTimeout(r, 60));
if (await sr(`return !!h.querySelector('.ppad');`)) { await keys("4711✔"); await p.waitForTimeout(80); }
await sr(`h.querySelector('[data-a="setgrp"][data-v="Ansicht"]').click();`);
check("Ansicht: Gruppe mit Ansicht, Beschriftungen, Maskottchen, Ruhig", await sr(`return ["view", "labels", "mascot", "calm"].every((k) => h.querySelector('[data-a="sheet"][data-v="' + k + '"]')) && !h.querySelector('[data-a="sheet"][data-v="theme"]');`));
await sr(`h.querySelector('[data-a="sheet"][data-v="mascot"]').click();`);
check("Maskottchen: Vorschau mit 5 Gesichtern + 8 Kostümen", await sr(`return h.querySelectorAll('.mascotprev svg.mascot').length === 13 && h.querySelectorAll('.mascotprev span.now').length === 1;`));
await shot("mascot-kostueme.png");
check("Kostüme: Jahreszeit + Feiertage richtig", await p.evaluate(() => { const D = customElements.get("fixkosten-card").mascotDeco; if (!D) return false;
  const t = (y, m, d) => D(new Date(y, m - 1, d, 12));
  return t(2027, 4, 15) === "spring" && t(2027, 7, 1) === "summer" && t(2027, 9, 20) === "autumn" && t(2027, 2, 1) === "winter" && t(2027, 1, 10) === "winter"
    && t(2027, 3, 28) === "bunny" && t(2027, 3, 25) === "bunny" && t(2027, 3, 30) === "spring" && t(2027, 10, 31) === "pumpkin" && t(2027, 12, 24) === "santa" && t(2027, 12, 31) === "party" && t(2027, 12, 28) === "winter"; }));
await sr(`const x = h.querySelector('[data-a="setmascot"]'); x.checked = true; x.dispatchEvent(new Event('change'));`);
await new Promise((r) => setTimeout(r, 80));
check("Maskottchen: Sparschwein statt Geldbörse", await sr(`return !!h.querySelector('.head .mascotbox svg.mascot') && /mascot (happy|worried|shock|tired|sleep)/.test(h.querySelector('.head .mascotbox svg').getAttribute('class'));`));
await shot("9a-maskottchen.png");
await sr(`h.querySelector('.head [data-a="back"]').click(); h.querySelector('[data-a="sheet"][data-v="labels"]').click();`);
await sr(`const x = h.querySelector('[data-a="setlabels"]'); x.checked = true; x.dispatchEvent(new Event('change'));`);
await new Promise((r) => setTimeout(r, 80));
check("Beschriftungen: Text unter den Knöpfen (in ⚙️ nur Sperren/Zurück)", await sr(`return [...h.querySelectorAll('.head .iconbtn .lbl')].map((x) => x.textContent).join() .startsWith("Sperren,Zurück");`), await sr(`return [...h.querySelectorAll('.head .iconbtn .lbl')].map((x) => x.textContent).join();`));
check("Beschriftungen: Host hat Klasse labels", await p.evaluate(() => document.querySelector('#c1').classList.contains('labels')));
await sr(`h.querySelector('.head [data-a="back"]').click(); h.querySelector('[data-a="sheet"][data-v="calm"]').click();`);
await sr(`const x = h.querySelector('[data-a="setcalm"]'); x.checked = true; x.dispatchEvent(new Event('change'));`);
check("Ruhiger Modus: nur auf diesem Gerät (localStorage)", await p.evaluate(() => document.querySelector('#c1').classList.contains('calm') && localStorage.getItem('fixkosten_calm') === 'true'));
await sr(`const x = h.querySelector('[data-a="setcalm"]'); x.checked = false; x.dispatchEvent(new Event('change'));`);
await sr(`h.querySelector('.head [data-a="back"]').click(); h.querySelector('[data-a="sheet"][data-v="view"]').click();`);
check("Ansicht: 6 Schalter, alle an (ohne „Nächste Abbuchung“)", await sr(`const x = [...h.querySelectorAll('[data-a="setview"]')]; return x.length === 6 && x.every((i) => i.checked);`));
await shot("9b-ansicht.png");
await sr(`const x = h.querySelector('[data-a="setview"][data-v="toepfe"]'); x.checked = false; x.dispatchEvent(new Event('change'));`);
await new Promise((r) => setTimeout(r, 80));
check("Ansicht: schickt view-Schalter", await p.evaluate(() => fake.applied.some((o) => o.type === "settings" && o.settings.view?.toepfe === false)));
await sr(`h.querySelector('.head [data-a="back"]').click(); h.querySelector('.head [data-a="back"]').click();`);
await new Promise((r) => setTimeout(r, 60));
check("Ansicht: Töpfe auf der Übersicht ausgeblendet", await sr(`return !h.querySelector('[data-a="sec"][data-v="toepfe"]') && !!h.querySelector('[data-a="sec"][data-v="ausgaben_zu"]');`));
await shot("9c-beschriftungen.png");
await sr(`h.querySelector('.topbar [data-a="tab"][data-v="set"]').click();`);
await new Promise((r) => setTimeout(r, 60));
if (await sr(`return !!h.querySelector('.ppad');`)) { await keys("4711✔"); await p.waitForTimeout(80); }
await sr(`h.querySelector('[data-a="setgrp"][data-v="Daten"]').click(); h.querySelector('[data-a="sheet"][data-v="log"]').click();`);
check("Verlauf: Einträge mit Uhrzeit und Name", await sr(`return h.querySelectorAll('.logrow').length > 3 && !!h.querySelector('.logday') && /Test/.test(h.querySelector('.logrow').textContent);`));
await shot("9d-verlauf.png");
await p.evaluate(() => { window.confirm = () => true; });
await sr(`h.querySelector('[data-a="logclear"]').click();`);
await new Promise((r) => setTimeout(r, 80));
check("Verlauf: leeren schickt log_clear", await p.evaluate(() => fake.applied.some((o) => o.type === "log_clear")));
// zurück auf Standard, damit die folgenden Prüfungen wie vorher laufen
await p.evaluate(() => { const c = document.querySelector('#c1'); c._send({ type: "settings", settings: { labels: false, mascot: false, view: { toepfe: true } } }); c._view = "home"; c._sheet = null; c._force = true; c._render(); });
await new Promise((r) => setTimeout(r, 80));

// 🙈 Einnahmen, Töpfe, Komplett verschleiert – antippen = 4 Sekunden sichtbar (beta.14)
await sr(`const t = h.querySelector('[data-a="sec"][data-v="toepfe"]'); if (t && !h.querySelector('[data-a="open"][data-k="pot"]')) t.click();`);
await new Promise((r) => setTimeout(r, 60));
check("Verschleiert: nur Summen (Komplett, Töpfe, Einnahmen), einzelne Töpfe klar", await sr(`return !!h.querySelector('.sum .veil[data-v="total"]') && !!h.querySelector('.ghead .veil[data-v="pots"]') && !h.querySelector('.item .veil') && !!h.querySelector('.ghead .veil[data-v="inc"]');`));
await shot("10a-verschleiert.png");
await sr(`h.querySelector('.ghead .veil[data-v="pots"]').click();`);
await new Promise((r) => setTimeout(r, 60));
check("Antippen: Summe sichtbar, Töpfe klappen NICHT zu", await sr(`return h.querySelector('.ghead .veil[data-v="pots"]').classList.contains('peek') && !!h.querySelector('[data-a="open"][data-k="pot"]');`));
await p.evaluate(() => { const c = document.querySelector('#c1'); c._force = true; c._render(); });
check("Bleibt sichtbar, auch wenn die Karte neu zeichnet", await sr(`return h.querySelector('.ghead .veil[data-v="pots"]').classList.contains('peek');`));
await new Promise((r) => setTimeout(r, 4200));
check("Nach 4 Sekunden wieder verschwommen", await sr(`return !h.querySelector('.veil.peek');`));
await p.evaluate(() => { const c = document.querySelector('#c1'); c._send({ type: "settings", settings: { veil: false } }); });
await new Promise((r) => setTimeout(r, 80));
check("Schalter aus: nichts mehr verschwommen", await sr(`return !h.querySelector('.veil') && !!h.querySelector('.sum');`));
await p.evaluate(() => { const c = document.querySelector('#c1'); c._send({ type: "settings", settings: { veil: true } }); });
await new Promise((r) => setTimeout(r, 80));

// 🔒 Ganze Karte mit PIN sperren (beta.16)
await p.evaluate(() => { const c = document.querySelector('#c1'); c._send({ type: "settings", settings: { lock_all: true } }); });
await new Promise((r) => setTimeout(r, 80));
await sr(`h.querySelector('.head [data-a="lock"]').click();`);
await new Promise((r) => setTimeout(r, 60));
check("Ganze Karte gesperrt: nur Zahlenfeld, keine Zahlen, kein Abbrechen", await sr(`return !!h.querySelector('.ppad') && !h.querySelector('.big') && !h.querySelector('.pcancel') && !h.querySelector('.badge') && !h.querySelector('[data-a="calc"]');`));
await shot("11-ganze-karte-gesperrt.png");
await keys("4711✔");
await p.waitForTimeout(80);
check("Richtige PIN zeigt die Übersicht", await sr(`return !!h.querySelector('.big') && !h.querySelector('.ppad');`));
// 📴 PIN ohne Netz: Karte prüft selbst mit dem Offline-Schlüssel (beta.21)
{
  const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90", hash = (await import("crypto")).pbkdf2Sync("4711", Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex");
  await p.evaluate((po) => { fake.data.pin_off = null; cb && cb(JSON.parse(JSON.stringify(fake.data))); }, null);
  await p.waitForTimeout(60);
  await p.evaluate(() => setOnline(false));
  await sr(`h.querySelector('.head [data-a="lock"]').click();`);
  await keys("4711✔");
  await p.waitForTimeout(150);
  check("Offline ohne Schlüssel: ehrlicher Hinweis, bleibt zu", await sr(`return !!h.querySelector('.ppad');`) && await p.evaluate(() => toasts.some((t) => t.includes("kennt das Gerät noch nicht"))));
  await p.evaluate(() => setOnline(true));
  await p.evaluate((po) => { fake.data.pin_off = po; cb && cb(JSON.parse(JSON.stringify(fake.data))); }, { salt, iter: 100000, hash });
  await p.waitForTimeout(60);
  await p.evaluate(() => setOnline(false));
  await keys("0000✔");
  await p.waitForTimeout(400);
  check("Offline: falsche PIN bleibt zu", await sr(`return !!h.querySelector('.ppad');`) && await p.evaluate(() => toasts.at(-1) === "❌ Falsche PIN"));
  await keys("4711✔");
  await p.waitForTimeout(400);
  check("Offline: richtige PIN entsperrt", await sr(`return !!h.querySelector('.big') && !h.querySelector('.ppad');`), await p.evaluate(() => toasts.slice(-3).join(" | ")));
  await p.evaluate(() => setOnline(true));
  await p.waitForTimeout(100);
}
await sr(`h.querySelector('[data-a="tab"][data-v="set"]').click();`);
await sr(`h.querySelector('[data-a="setgrp"][data-v="App & Info"]').click(); h.querySelector('[data-a="sheet"][data-v="pin"]').click();`);
check("Schalter „Ganze Karte sperren“ in Schutz", await sr(`return !!h.querySelector('[data-a="setlockall"]')?.checked;`));
await p.evaluate(() => { const c = document.querySelector('#c1'); c._send({ type: "settings", settings: { lock_all: false } }); c._view = "home"; c._sheet = null; c._force = true; c._render(); });
await new Promise((r) => setTimeout(r, 80));

// 💱 Währung (beta.17)
await sr(`h.querySelector('[data-a="tab"][data-v="set"]').click();`);
await sr(`h.querySelector('[data-a="setgrp"][data-v="Rechnen"]')?.click(); h.querySelector('[data-a="sheet"][data-v="rechnen"]').click();`);
check("Währung: Auswahl in Rechnen & Warnung, Euro vorgewählt", await sr(`const x = h.querySelector('select[data-a="setcur"]'); return !!x && x.value === "EUR" && x.options.length >= 4;`));
await sr(`const x = h.querySelector('select[data-a="setcur"]'); x.value = "CHF"; x.dispatchEvent(new Event('change'));`);
await new Promise((r) => setTimeout(r, 80));
await p.evaluate(() => { const c = document.querySelector('#c1'); c._view = "home"; c._sheet = null; c._force = true; c._render(); });
check("Währung CHF: große Zahl als CHF geschrieben, kein €", await sr(`const t = h.querySelector('.big').textContent; return /CHF/.test(t) && !/€/.test(t) && !/€/.test(h.querySelector('.tiles').textContent);`), await sr(`return h.querySelector('.big').textContent;`));
check("Währung CHF: Eingabefeld zeigt CHF", await sr(`return /CHF/.test(h.querySelector('form.add .amount').placeholder);`));
await shot("12-waehrung-chf.png");
await p.evaluate(() => { const c = document.querySelector('#c1'); c._send({ type: "settings", settings: { currency: "EUR" } }); c._force = true; c._render(); });
await new Promise((r) => setTimeout(r, 80));
check("Währung zurück auf €", await sr(`return /€/.test(h.querySelector('.big').textContent);`));

// ⚙️ beta.18: Zahnrad vor „Einstellungen“, in ⚙️ kein Rechner/Auge, Anleitung mit Buch-Symbol
await sr(`h.querySelector('[data-a="tab"][data-v="set"]').click();`);
check("Einstellungen: Zahnrad vor der Überschrift, kein Rechner/Auge", await sr(`return h.querySelector('.sethead ha-icon')?.getAttribute('icon') === 'mdi:cog-outline' && !h.querySelector('[data-a="calc"]') && !h.querySelector('[data-a="hide"]') && !!h.querySelector('[data-a="lock"]');`));
await shot("14-einstellungen-zahnrad.png");
await p.evaluate(() => { const c = document.querySelector('#c1'); c._view = "home"; c._sheet = null; c._force = true; c._render(); });
check("Übersicht: Rechner und Auge wieder da, Anleitung mit Buch-Symbol", await sr(`return !!h.querySelector('[data-a="calc"]') && !!h.querySelector('[data-a="hide"]') && h.querySelector('.foot ha-icon')?.getAttribute('icon') === 'mdi:book-open-page-variant-outline';`));

// ⓘ beta.19: Erklärungen zugeklappt, ⓘ am Schalter bzw. an der Überschrift klappt auf (wie Einkaufsliste)
await p.evaluate(() => { const c = document.querySelector('#c1'); c._view = "set"; c._sheet = "rechnen"; c._force = true; c._render(); });
check("ⓘ: Währungs-Erklärung ist zu, ⓘ sitzt am Schalter", await sr(`const hi = h.querySelector('p.fhint'); const b = h.querySelector('.switch .finfo'); return !!hi && hi.hidden && !!b && b.getAttribute('aria-expanded') === 'false';`));
await sr(`h.querySelector('.switch .finfo').click();`);
check("ⓘ: antippen klappt auf", await sr(`return !h.querySelector('p.fhint').hidden && h.querySelector('.switch .finfo').getAttribute('aria-expanded') === 'true';`));
await p.evaluate(() => { const c = document.querySelector('#c1'); c._force = true; c._render(); });
check("ⓘ: bleibt nach neuem Zeichnen offen", await sr(`return !h.querySelector('p.fhint').hidden;`));
await shot("15-info-knopf.png");
await p.evaluate(() => { const c = document.querySelector('#c1'); c._sheet = "view"; c._force = true; c._render(); });
check("ⓘ: Seiten ohne Schalter davor haben das ⓘ an der Überschrift", await sr(`return !!h.querySelector('.pagehost .sechead .finfo') && h.querySelector('p.fhint').hidden;`));
await sr(`h.querySelector('.sechead .finfo').click();`);
check("ⓘ: Überschrift-ⓘ klappt auf", await sr(`return !h.querySelector('p.fhint').hidden;`));
await p.evaluate(() => { const c = document.querySelector('#c1'); c._view = "home"; c._sheet = null; c._force = true; c._render(); });

// 📊 Statistik-Reiter (1.0.1-beta.6): Durchschnitt, bester/schlechtester Monat, Vergleich, Jahressumme, Fixkosten-Anteil, Balken
await p.evaluate(() => { const c = document.querySelector('#c1'); c._view = "home"; c._sheet = null; c._force = true; c._render(); });
await sr(`h.querySelector('[data-a="tab"][data-v="stat"]').click();`);
check("Statistik: Reiter da und alle Teile sichtbar", await sr(`const t = h.querySelector('ha-card').textContent; return /Durchschnitt pro Monat/.test(t) && /Bester Monat/.test(t) && /Vergleich/.test(t) && /bisher/.test(t) && /Fixkosten-Anteil/.test(t) && h.querySelectorAll('.hist .m').length >= 2;`), await sr(`return h.querySelector('ha-card').textContent.slice(0, 300);`));
check("Statistik: Vergleich mit Pfeil", await sr(`return !!h.querySelector('.trend');`));
await shot("16-statistik.png");
await p.evaluate(() => { const c = document.querySelector('#c1'); c._view = "home"; c._force = true; c._render(); });

// 🌍 Englisch (beta.17): language: en → Wörterbuch laden, alles übersetzen, eigene Namen bleiben
await p.evaluate(() => { const c = document.querySelector('#c1'); c.setConfig({ title: "Fixkosten", language: "en" }); });
await p.waitForFunction(() => /Available/.test(document.querySelector('#c1').shadowRoot.querySelector('.hero .lbl')?.textContent || ""), null, { timeout: 4000 }).catch(() => {});
check("Englisch: „Available“, Reiter Overview/Statistics/Edit", await sr(`return /^Available/.test(h.querySelector('.hero .lbl').textContent) && [...h.querySelectorAll('.tab')].map((x) => x.textContent.trim()).join("|") === "Overview|Statistics|Edit";`), await sr(`return h.querySelector('.hero .lbl').textContent;`));
check("Englisch: eigene Namen bleiben deutsch (Schnellknopf „Bäckerei“)", await sr(`return [...h.querySelectorAll('.quick .chip')].some((x) => x.textContent.trim() === "Bäckerei");`));
check("Englisch: Euro englisch geschrieben (€ vorn)", await sr(`return /^-?€/.test(h.querySelector('.big').textContent.trim());`), await sr(`return h.querySelector('.big').textContent;`));
await shot("13-englisch.png");
await p.evaluate(() => { const c = document.querySelector('#c1'); c._view = "stat"; c._sheet = null; c._force = true; c._render(); });
await new Promise((r) => setTimeout(r, 80));
check("Englisch: Statistik übersetzt", await sr(`const t = h.querySelector('ha-card').textContent; return /Average per month/.test(t) && /Comparison/.test(t) && /so far/.test(t) && !/Durchschnitt|Vergleich|bisher|Einkommens|übrig/.test(t);`), await sr(`return h.querySelector('ha-card').textContent.replace(/\s+/g, " ").slice(0, 900);`));
await shot("17-statistik-englisch.png");
await sr(`h.querySelector('[data-a="tab"][data-v="set"]').click();`);
check("Englisch: Einstellungen übersetzt", await sr(`const t = h.querySelector('ha-card').textContent; return /Calculation/.test(t) && /Health/.test(t) && !/Gesundheit|Rechnen/.test(t);`));
await p.evaluate(() => { const c = document.querySelector('#c1'); c.setConfig({ title: "Fixkosten" }); c._view = "home"; c._sheet = null; c._force = true; c._render(); });
await new Promise((r) => setTimeout(r, 80));
check("Zurück auf Deutsch", await sr(`return /^Verfügbar/.test(h.querySelector('.hero .lbl').textContent);`));

// 📱 Offline-App: Anmeldeseite lädt ohne Fehler
const a = await b.newPage({ viewport: { width: 390, height: 760 }, deviceScaleFactor: shots ? 2 : 1 });
a.on("pageerror", (e) => errs.push("app: " + String(e)));
await a.goto(`http://localhost:${port}/fixkosten/app/`);
await a.waitForSelector("#loginBtn");
check("App: Anmeldeseite da", await a.evaluate(() => document.querySelector("h1")?.textContent === "Fixkosten"));
check("App: Icon lädt", await a.evaluate(() => { const i = document.querySelector(".login img"); return i && i.complete && i.naturalWidth === 192; }));
if (shots) await a.screenshot({ path: path.join(shots, "6-app-anmeldung.png") });

// 📚 Zweites Buch: Karte mit „buch“ fragt nach genau diesem Buch, eigener Postausgang, Editor zeigt alle Bücher
const rb = await p.evaluate(async () => {
  fake.msgs = [];
  const c = document.createElement("fixkosten-card"); c.id = "c2"; c.setConfig({ buch: "Partnerin" }); document.body.append(c);
  c.hass = document.querySelector("#c1")._hass;
  await new Promise((res) => setTimeout(res, 80));
  const sub = fake.msgs.find((m) => m.type === "fixkosten/subscribe");
  const ed = document.createElement("fixkosten-card-editor"); document.body.append(ed);
  ed.setConfig({ buch: "Partnerin" }); ed.hass = c._hass;
  await new Promise((res) => setTimeout(res, 50));
  const opts = [...ed.querySelectorAll('select[data-k="buch"] option')].map((o) => [o.textContent, o.selected]);
  let changed = null; ed.addEventListener("config-changed", (e) => { changed = e.detail.config; });
  const sel = ed.querySelector('select[data-k="buch"]'); sel.value = ""; sel.dispatchEvent(new Event("change"));
  const out = { book: sub?.book, qk: c._qk, opts, changed, label: c.shadowRoot.querySelector(".hero .lbl")?.textContent || "" };
  c.remove(); ed.remove();
  return out;
});
check("Buch: Karte abonniert genau ihr Buch", rb.book === "Partnerin", JSON.stringify(rb));
check("Buch: eigener Postausgang im Handy", rb.qk === "fixkosten_queue_partnerin", rb.qk);
check("Buch: Editor zeigt beide Bücher, „Partnerin“ gewählt", rb.opts.length === 2 && rb.opts[1][0] === "Partnerin" && rb.opts[1][1], JSON.stringify(rb.opts));
check("Buch: Editor zurück auf erstes Buch entfernt „buch“", rb.changed && !("buch" in rb.changed), JSON.stringify(rb.changed));

// 📋 Kopieren, wenn das Handy die Zwischenablage sperrt (HA-App): Ersatzweg wie bei der Einkaufsliste, kein Fenster, kein Link
{
  let dialogs = 0; const onDlg = (dl) => { dialogs++; dl.dismiss(); }; p.on("dialog", onDlg);
  const r = await p.evaluate(async () => {
    const c = document.querySelector("#c1"), d = c._data || {};
    const oldUrl = d.app_url; d.app_url = "https://beispiel.ui.nabu.casa/fixkosten/app/";
    const oldCb = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("NotAllowedError")) } });
    const oldEx = document.execCommand; let copied = null;
    document.execCommand = (cmd) => { if (cmd === "copy") { const a = document.activeElement; const el = a?.shadowRoot?.activeElement || a; copied = (el?.value || "").slice(el.selectionStart, el.selectionEnd) || window.getSelection().toString(); } return true; };
    let toast = ""; const onT = (e) => { toast = e.detail?.message || ""; }; c.addEventListener("hass-notification", onT);
    const inp = document.createElement("input"); inp.id = "appUrl"; inp.value = d.app_url; c.shadowRoot.appendChild(inp);
    c._act({ dataset: { a: "appcopy" } }, new Event("click"));
    await new Promise((res) => setTimeout(res, 50));
    inp.remove(); c.removeEventListener("hass-notification", onT); document.execCommand = oldEx; delete navigator.clipboard; if (oldCb) Object.defineProperty(Navigator.prototype, "clipboard", oldCb); d.app_url = oldUrl;
    return { copied, toast };
  });
  p.off("dialog", onDlg);
  check("Offline-App-Adresse kopieren klappt auch ohne Zwischenablage-Erlaubnis (kein Fenster)", r.copied?.includes("/app/") && dialogs === 0 && /kopiert/i.test(r.toast), JSON.stringify({ ...r, dialogs }));
}
check("Keine Fehler in der Konsole", errs.length === 0, errs.join(" | "));
await b.close();
srv.close();
console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen` : "\nAlles grün 🎉");
process.exit(fails ? 1 : 0);
