// 💶 Fixkosten-Karte – zeigt, wie viel Geld diesen Monat wirklich noch verfügbar ist.
// Läuft im Dashboard UND in der Offline-App (/fixkosten/app/). Kein Build-Schritt, reines JavaScript.
//
// So funktioniert's (für Doofe 😄):
// - Home Assistant schickt alle Daten („subscribe“).
// - Jede Änderung (Haken, Ausgabe, Kontostand …) wird als kleine „Änderung“ verschickt.
// - Klappt das Verschicken nicht (kein Netz), landet die Änderung im Postausgang und wird später nachgeschickt.
//   Bis dahin rechnet die Karte selbst so, als wäre sie schon angekommen.
const FK_VERSION = "1.0.1";

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
  { icon: "cash-check", color: "#43a047", title: "Was heißt „Verfügbar“?", text: `Die große Zahl oben ist das Geld, das du diesen Monat <b>wirklich</b> noch ausgeben kannst:<br><b>Kontostand</b> − <b>Fixkosten, die noch nicht abgehakt sind</b> − <b>Ausgaben, die noch nicht abgebucht sind</b>.<br>Grün = im Plus · Rot = im Minus. Die Warngrenze (⚙️ → „Rechnen & Warnung“, dort auch ganz ausschaltbar) schaltet nur den Warn-Sensor für Automationen.` },
  { icon: "bank-outline", color: "#0288d1", title: "Kontostand eintragen", text: `Tippe auf die Kachel <b>„Konto“</b> und gib den Stand aus deiner Bank-App ein. Es öffnet sich eine eigene Seite, wie bei der Einkaufsliste. Das Datum auf der Kachel zeigt, wann du ihn zuletzt eingetragen hast.` },
  { icon: "calendar-month-outline", color: "#3949ab", title: "Fixkosten abhaken", text: `Deine Fixkosten stehen in Gruppen wie <b>„ab dem 1.“</b> und <b>„ab dem 15.“</b>. Die Gruppen sind <b>zugeklappt</b>: Tipp auf die Überschrift klappt sie auf. Beim nächsten Öffnen ist wieder alles zu (nur die Ausgaben sind offen). Rechts steht „2 / 4“ und was noch offen ist.<br>Ist ein Posten vom Konto abgebucht: <b>Kreis antippen</b> ✅ – dahinter steht dann, <b>wann</b> du abgehakt hast. Am Monatsanfang gehen die Haken von selbst wieder auf (Schalter in ⚙️ → „Rechnen & Warnung“).<br>Hat ein Posten einen <b>festen Tag</b> (z. B. am 5.), steht „am 5.“ direkt am Posten. <b>Ratenzahlung?</b> Beim Posten „Raten bis“ eintragen – dann steht dran, wie viele Raten noch kommen, und nach der letzten zählt er nicht mehr mit 🎉. <b>Pausierte</b> Posten (⏸️) stehen grau und abgehakt mit drin und zählen nicht mit.<br><b>Preis nur diesen Monat anders?</b> (z. B. Nachzahlung, teurere Handyrechnung) Hinten auf den <b>Betrag tippen</b>, neuen Preis rein, ✓. Er gilt <b>nur diesen Monat</b> (✏️ am Posten), nächsten Monat ist automatisch wieder der gespeicherte Preis da. ↺ stellt ihn sofort zurück.` },
  { icon: "credit-card-outline", color: "#ff9800", title: "Ausgaben", text: `Etwas bezahlt (Karte, PayPal, bar …), das noch nicht vom Konto abgebucht ist? Schnellknopf antippen (z. B. „Bäckerei“) oder selbst etwas eintippen, Betrag rein, <b>＋</b>. Der Betrag ist <b>sofort</b> von „Verfügbar“ abgezogen.<br>Taucht er auf dem Konto auf: den <b>Kreis vorne</b> antippen (wie bei den Fixkosten) (lange drücken zeigt, was ein Knopf macht). Dann steckt er im Kontostand und fliegt aus der Rechnung. Vertippt? <b>Eintrag antippen</b> = Name und Betrag ändern. Die Schnellknöpfe stellst du in ⚙️ → „Schnellknöpfe“ ein – wie die Kategorien der Einkaufsliste: ＋ Neu, ⠿ ziehen = Reihenfolge, antippen = Name, Farbe und Symbol ändern. Jeder bekommt von selbst eine <b>eigene, feste Farbe</b> (bleibt gleich, auch wenn du die Reihenfolge änderst) – dort kannst du sie auch selbst wählen. Ausgaben, die genauso heißen oder so anfangen (z. B. „PayPal - Claude“), tragen unten die gleiche Farbe. Orange = passt zu keinem Knopf.` },
  { icon: "calculator-variant-outline", color: "#7b1fa2", title: "Taschenrechner", text: `Oben auf 🧮 tippen. Rechnet mit + − × ÷ und %. <b>V</b> setzt „Verfügbar“ ein.<br>Das Ergebnis übernimmst du mit einem Tipp als <b>Ausgabe</b>, als <b>Kontostand</b> oder kopierst es.` },
  { icon: "piggy-bank-outline", color: "#e91e63", title: "Töpfe, offene Stände, Konten", text: `<b>🐷 Töpfe:</b> Was wo liegt (Sparkonto, Bargeld zu Hause, PayPal …). Antippen = <b>➖ Rausnehmen</b> oder <b>➕ Zurücklegen</b>. Darunter: <b>Stand korrigieren</b> mit grünem Haken ✓ (z. B. nach dem Nachzählen; leeres Feld = 0). Unter jedem Topf steht, <b>wann</b> er zuletzt geändert wurde. Auf den Namen tippen klappt wieder zu. Was du rausnimmst, steht in Orange als „geliehen“ dabei, bis du es zurücklegst (auch in Teilbeträgen). Kommt es nicht mehr zurück: Topf öffnen und den <b>orangen Zettel antippen</b> → weg. „Komplett“ = Verfügbar + alle Töpfe (also schon ohne offene Fixkosten und Ausgaben).<br><b>🧾 Offene Stände:</b> Was du noch begleichen musst. Erledigt? Grünen Haken ✓ antippen. Auf Wunsch zieht ⚙️ sie von „Verfügbar“ ab.<br><b>🏦 Meine Konten:</b> Deine IBANs. 📋 kopiert sie für Überweisungen.<br><b>💵 Einnahmen</b> sind nur Info und ändern „Verfügbar“ nicht. Mit dem Kreis hakst du ab, ob sie schon auf dem Konto gebucht sind (geht am Monatsanfang wieder auf).` },
  { icon: "pencil-outline", color: "#00897b", title: "Bearbeiten", text: `Unter <b>„Bearbeiten“</b> legst du alles an (＋ Neu) oder tippst einen Eintrag zum Ändern an. Posten können auf <b>bestimmte Monate</b> beschränkt werden (z. B. Kfz-Steuer nur im März) oder <b>pausiert</b> werden. Neue Gruppen bekommen einen Starttag (1–28).<br><b>Reihenfolge ändern:</b> am Griff ⠿ vorne ziehen. Fixkosten kannst du so auch in eine andere Gruppe schieben. Das klappt auch bei Gruppen, Töpfen, Einnahmen, offenen Ständen und Konten.` },
  { icon: "chart-bar", color: "#5e35b1", title: "Rückblick", text: `Am Monatsende merkt sich die Karte den Monat von selbst: Fixkosten, Ausgaben, Einnahmen und was am Ende übrig war (bis zu 3 Jahre). Du findest ihn im Reiter <b>📊 Statistik</b> (und in ⚙️ → Daten → Rückblick). Dort stehen auch Durchschnitt, bester und schlechtester Monat, Vergleich zum Vormonat und Vorjahr, die Jahressumme und wie viel Prozent deines Einkommens für Fixkosten weggehen.` },
  { icon: "stethoscope", color: "#00897b", title: "Gesundheit, Fehler und Werkseinstellungen", text: `In ⚙️ → <b>🩺 Gesundheit</b>: <b>„Alles ok?“</b> sucht nach Dingen, die nicht zusammenpassen (Posten ohne Gruppe, alter Kontostand, vergessene Ausgaben …) und sagt, wie man es repariert. <b>Fehler-Protokoll</b> zeigt, was beim Speichern nicht geklappt hat. <b>Ressourcen</b> zeigt, wie viel Platz alles braucht.<br><b>💣 Werkseinstellungen</b> (⚙️ → Daten, nur Admins): alles zurück auf Anfang, nur die PIN bleibt. Zwei Sicherheitsfragen – vorher lieber „Als CSV sichern“.` },
  { icon: "eye-off-outline", color: "#607d8b", title: "Beträge verstecken", text: `Das 👁️ oben verschwimmt alle Beträge und IBANs, z. B. wenn jemand mitschaut. Nochmal tippen = wieder zeigen. Mit <code>privat: true</code> im Karten-YAML startet die Karte versteckt.` },
  { icon: "book-multiple-outline", color: "#8e24aa", title: "Mehrere Bücher (eins pro Person)", text: `Wie bei mehreren Anlagen: <b>Einstellungen → Geräte &amp; Dienste → Fixkosten → Eintrag hinzufügen</b> und einen Namen geben (z. B. „Partnerin“). Jedes Buch hat eigene Fixkosten, Töpfe, Kontostand, PIN und Sensoren.<br>Neue Karte anlegen, im Karten-Editor bei <b>„Welches Buch?“</b> wählen und unter <b>Sichtbarkeit</b> nur die passende Person anhaken. Ehrlich: Ordnung, kein Tresor – ein HA-Admin kann alles sehen.` },
  { icon: "cellphone-lock", color: "#1e88e5", title: "Offline-App mit Fingerabdruck", text: `Deine Adresse für die App steht in ⚙️ → <b>„Offline-App“</b> (mit Kopieren-Knopf). Im Handy-Browser öffnen → anmelden → im Browser-Menü „Zum Startbildschirm“.<br>Ohne Netz siehst du den letzten Stand. Was du einträgst, wartet im <b>Postausgang</b> (oben „⏳ wartet“) und wird von selbst nachgeschickt. Nichts zählt doppelt.<br>Unten in der App: <b>„👆 Fingerabdruck-Sperre“</b>. Ist sie an, sperrt das 🔒 Schloss oben die ganze App sofort. Abmelden löscht nur die Kopie im Handy, in Home Assistant bleibt alles erhalten.` },
  { icon: "shield-key-outline", color: "#455a64", title: "PIN-Sperre und Seitenleiste", text: `In ⚙️ unter <b>„Schutz (PIN)“</b> legst du eine PIN (4–8 Ziffern) fest. Dann fragen ⚙️ und „Bearbeiten“ danach. Übersicht, Abhaken und Ausgaben gehen weiter ohne PIN. Das 🔓 Schloss unter der Leiste (neben 🧮 und 👁️) sperrt sofort wieder (sonst nach 10 Minuten Ruhe). Die PIN tippst du wie am Handy auf dem Zahlenfeld ein.<br><b>PIN vergessen?</b> Kein Drama: Ein Admin geht auf <b>Einstellungen → Geräte & Dienste → Fixkosten → Konfigurieren</b> und hakt <b>„PIN zurücksetzen“</b> an.<br>Im selben Fenster schaltest du auch <b>„In der Seitenleiste anzeigen“</b> an oder aus.` },
  { icon: "upload", color: "#546e7a", title: "CSV einlesen und sichern", text: `In ⚙️ → <b>„Daten (CSV)“</b> (nur Admins): Datei wählen oder Text einfügen → „Einlesen“. Spalten: <b>Typ;Name;Betrag;Gruppe/Datum;Zahlart;Notiz</b>. „Als CSV sichern“ lädt alles als Datei herunter.` },
  { icon: "storefront-outline", color: "#1e88e5", title: "Installieren und Updates (HACS / Marketplace)", text: `Fixkosten kommt über <b>HACS</b>. Ab <b>Home Assistant 2026.11</b> steckt HACS direkt in Home Assistant und heißt <b>Einstellungen → Marketplace</b>. Dort findest du Fixkosten, Updates und die Beta-Versionen – alles andere bleibt gleich.<br>Die kleinen <b>ⓘ</b> in ⚙️ klappen die Erklärung zu einem Schalter auf.` },
  { icon: "lock-outline", color: "#455a64", title: "Datenschutz", text: `Alles bleibt in <b>deinem</b> Home Assistant. Keine Cloud, kein Tracking, nichts geht ins Internet. IBANs stehen bewusst in keinem Sensor.` },
  { icon: "eye-outline", color: "#00897b", title: "Verlauf, Ansicht und Sparschwein", text: `<b>📜 Verlauf</b> (⚙️ → Daten): wer hat wann was geändert – abgehakt, Kontostand, Ausgaben, Töpfe … Die letzten 300 Einträge, ausschaltbar, Admins können ihn leeren.<br><b>👁️ Ansicht</b> (⚙️ → Ansicht, gilt für alle): Abschnitte wie Töpfe, Einnahmen oder Meine Konten ausblenden. <b>Beschriftungen</b> zeigen kurzen Text unter den Symbol-Knöpfen. <b>Ruhiger Modus</b> (nur dieses Gerät): gedämpfte Farben, nichts bewegt sich. In der Offline-App gibt es noch <b>Hell / Dunkel</b>.<br><b>🐷 Sparschwein</b> (⚙️ → Ansicht → Maskottchen): sitzt oben links und zeigt, wie es um dein Geld steht – fröhlich im Plus, skeptisch knapp über der Warngrenze, erschrocken im Minus. Sind alle Fixkosten abgehakt, hüpft es. Morgens gähnt es, ab 21 Uhr schläft es. Antippen = zurück zur Übersicht.` },
];
// 🆕 Was ist neu – das Neueste oben (wie bei der Einkaufsliste)
const FK_NEWS = [
  ["1.0.1", "🎉 <b>Offizielle Version 1.0.1:</b> Alles aus 6 Betas ist jetzt fest drin – danke fürs Testen! · 📊 Neuer Reiter <b>Statistik</b> (Ø pro Monat, bester und schlechtester Monat, Vergleich, Jahressumme, Fixkosten-Anteil) · ⚡ Schnellknöpfe wie die Kategorien der Einkaufsliste (Farbe, Symbol, ziehen) · 💶 Preis nur für diesen Monat · 💳 Raten bis Monat/Jahr · ✅ Datum beim Abhaken · ⓘ Erklärungen zum Antippen statt Textwand"],
  ["1.0.1-beta.6", "📊 <b>Neuer Reiter „Statistik“</b> neben Übersicht und Bearbeiten: Ø pro Monat (ausgegeben, Einnahmen, übrig), 🏆 bester und 🙈 schlechtester Monat, <b>Vergleich</b> zum Vormonat und Vorjahr (▲ rot = mehr ausgegeben), <b>Jahressumme</b>, <b>Fixkosten-Anteil</b> am Einkommen und die Monats-Balken. Der Rückblick steht weiter auch in ⚙️ → Daten."],
  ["1.0.1-beta.5", "ⓘ <b>Weniger Textwand in ⚙️:</b> Die Erklärungen sind jetzt zugeklappt. Ein kleines <b>ⓘ</b> neben dem Schalter (oder neben der Überschrift) klappt sie auf – wie bei der Einkaufsliste. · 🛒 <b>Marketplace:</b> Ab Home Assistant 2026.11 steckt HACS in Home Assistant drin und heißt <b>Einstellungen → Marketplace</b>. Steht jetzt in der Anleitung und im README."],
  ["1.0.1-beta.4", "⚡ <b>Schnellknöpfe wie die Kategorien der Einkaufsliste:</b> unter ⚙️ → Schnellknöpfe jede Zeile mit Farbe und <b>Symbol</b>, ⠿ ziehen = Reihenfolge, ＋ Neu, antippen = Name, Farbe und Symbol ändern, 🗑️ löschen mit Rückgängig. Das Symbol steht auch auf dem Knopf. · ✏️ <b>Bearbeiten klappt unter der Zeile auf</b> (Preis nur diesen Monat, Ausgaben, Töpfe, Bearbeiten) – die Zeile bleibt stehen, nochmal antippen = zu, wie in der Einkaufsliste. · 📅 <b>Raten bis</b> jetzt mit Monat + Jahr zum Auswählen – das Jahr lässt sich überall ändern."],
  ["1.0.1-beta.3", "🎨 <b>Schnellknöpfe behalten ihre Farbe</b>, auch wenn du sie umsortierst – und unter ⚙️ → Schnellknöpfe kannst du jede Farbe selbst wählen. · ⭕ <b>Ausgaben abhaken mit dem Kreis vorne</b>, genau wie bei den Fixkosten. · 💳 <b>Ratenzahlung:</b> beim Posten „Raten bis“ eintragen – dran steht, wie viele Raten noch kommen, danach zählt er nicht mehr mit. · 🧹 Der Hinweis „Nächste Abbuchung“ oben ist weg – der feste Tag steht weiter am Posten."],
  ["1.0.1-beta.2", "🎨 <b>Ausgaben-Farben repariert:</b> Fängt der Name mit einem Schnellknopf an (z. B. „PayPal - Claude“), bekommt die Ausgabe dessen Farbe. Kein Schnellknopf ist mehr orange – Orange heißt jetzt nur noch „passt zu keinem Knopf“."],
  ["1.0.1-beta.1", "💶 <b>Preis nur für diesen Monat:</b> hinten auf den Betrag eines Postens tippen und z. B. die Nachzahlung eintragen – nächsten Monat gilt wieder der gespeicherte Preis. · ✅ Abgehakte Fixkosten zeigen, <b>wann</b> sie abgehakt wurden. · 🐷 Töpfe zeigen das <b>Datum der letzten Änderung</b>, „Stand korrigieren“ mit leerem Feld = 0. · 🎨 <b>Schnellknöpfe bunt</b> – und die passenden Ausgaben unten in derselben Farbe."],
  ["1.0.0", "🎉 <b>Erste offizielle Version!</b> Alles aus 23 Betas ist jetzt fest drin – danke fürs Testen! · 💶 Verfügbar-Rechnung, Fixkosten und Einnahmen abhaken, Ausgaben, 🐷 Töpfe, 🧮 Taschenrechner, Rückblick und 📜 Verlauf · 🔒 PIN (auch ohne Netz, auf Wunsch für die ganze Karte), 🙈 verschwommene Summen, 📱 Offline-App mit Fingerabdruck · 🌍 Englisch und andere Währungen (CHF, USD …), 📚 mehrere Bücher, 💡 Bildschirm-an-Knopf"],
  ["0.1.0-beta.23", "📋 <b>Kopieren klappt jetzt auch in der HA-App:</b> Sperrt das Handy die Zwischenablage, kopiert die Karte auf dem Ersatzweg wie bei der Einkaufsliste – statt ein Fenster aufzumachen. Gilt für die Adresse der Offline-App, IBANs und das Ergebnis im Taschenrechner."],
  ["0.1.0-beta.22", "💡 Der Knopf <b>Bildschirm immer an</b> sieht jetzt aus wie bei der Einkaufsliste (blau, wenn an) · 🌑 Geht das Handy-Display aus, ist auch „Bildschirm an“ wieder aus"],
  ["0.1.0-beta.21", "📴🔒 <b>PIN geht jetzt auch ohne Netz:</b> Ist die Verbindung weg, prüft die Karte die PIN selbst – die ganze Karte, ⚙️ und „Bearbeiten“ lassen sich also auch offline entsperren. Einmal die PIN <b>mit Netz</b> eintippen, dann kennt das Gerät den Schlüssel. PIN ändern oder ausschalten geht weiter nur mit Netz."],
  ["0.1.0-beta.20", "💡 Neuer Knopf <b>Bildschirm anlassen</b> oben zwischen 👁️ und 🔒 (wie beim Kegelclub): einmal antippen, dann geht das Handy beim Abarbeiten nicht mehr aus"],
  ["0.1.0-beta.19", "🙏 <b>Credits wie bei der Einkaufsliste:</b> Mister-M-Logo, Version, Knöpfe für GitHub, 💡 Idee oder Wunsch, 🐞 Fehler melden und Spenden mit PayPal – in ⚙️ → Credits und unten in der Anleitung."],
  ["0.1.0-beta.18", "⚙️ <b>Zahnrad vor „Einstellungen“</b> wie bei der Einkaufsliste. · 🧮 In den Einstellungen sind <b>Rechner und Auge ausgeblendet</b> – dort braucht man sie nicht. · 📖 <b>Anleitung</b> mit demselben Buch-Symbol wie die Einkaufsliste. · 🚪 Offline-App: „Abmelden“ ohne Symbol, wie bei der Einkaufsliste."],
  ["0.1.0-beta.17", "🌍 <b>Englisch:</b> Ist Home Assistant nicht auf Deutsch (oder steht <code>language: en</code> in der Karte), spricht die Karte Englisch. Deine eigenen Namen bleiben, wie sie sind. · 💱 <b>Währung wählbar</b> (⚙️ → Rechnen &amp; Warnung): Euro, Schweizer Franken, US-Dollar, Pfund und mehr. Ändert nur Zeichen und Schreibweise, es wird nichts umgerechnet. · 👗 <b>Sparschwein-Kostüme:</b> Blume im Frühling, Sonnenbrille im Sommer, Blatt im Herbst, Schal im Winter, Hasenohren zu Ostern – wie der Einkaufswagen der Einkaufsliste."],
  ["0.1.0-beta.16", "🔒 <b>Ganze Karte mit PIN sperren</b> (⚙️ → App &amp; Info → Schutz, Standard aus): Dann zeigt die Karte zuerst das Zahlenfeld – erst nach der PIN sieht man Zahlen. Nach 10 Minuten Ruhe oder mit 🔒 ist sie wieder zu."],
  ["0.1.0-beta.15", "🙈 Verschwommen sind jetzt nur noch die <b>Summen</b>: hinter „Einnahmen“, hinter „Töpfe“ und bei „Komplett“. Die einzelnen Einnahmen und Töpfe sind wieder klar zu sehen."],
  ["0.1.0-beta.14", "🙈 <b>Einnahmen, Töpfe und „Komplett“ sind verschwommen</b>, falls jemand mitschaut. Am PC Maus drüber = zeigen, am Handy auf den Betrag drücken = <b>4 Sekunden</b> sichtbar, dann verschwimmt er wieder. Abschaltbar in ⚙️ → Ansicht → „Ansicht – für alle“."],
  ["0.1.0-beta.13", "📜 <b>Verlauf</b> (⚙️ → Daten): wer hat wann was geändert – abgehakt, Kontostand, Ausgaben, Töpfe (die letzten 300, ausschaltbar). · 👁️ Neue Gruppe <b>Ansicht</b> wie bei der Einkaufsliste: Abschnitte für alle ein- und ausblenden, <b>Beschriftungen</b> unter den Symbol-Knöpfen, <b>Ruhiger Modus</b> und in der Offline-App <b>Hell / Dunkel</b>. · 👆 Der Knopf <b>„Fingerabdruck-Sperre“</b> erscheint in der Offline-App nur noch, wo es auch geht (Fingerabdruck oder Face ID und https). · 🐷 <b>Maskottchen Sparschwein</b> (Standard aus): freut sich im Plus, guckt skeptisch knapp über der Warngrenze, erschrickt im Minus und hüpft, wenn alle Fixkosten abgehakt sind."],
  ["0.1.0-beta.12", "📚 <b>Mehrere Bücher</b> (wie mehrere Anlagen bei Solis): Einstellungen → Geräte &amp; Dienste → Fixkosten → <b>Eintrag hinzufügen</b>, z. B. eins pro Person. Jedes Buch hat eigene Daten, Sensoren und PIN. Im Karten-Editor wählst du bei „Welches Buch?“, und mit der Sichtbarkeit der Karte sieht jeder nur sein eigenes. Dein bisheriges Buch bleibt genau wie es ist."],
  ["0.1.0-beta.11", "📂 Die Karte <b>merkt sich aufgeklappte Kategorien nicht mehr</b>: Beim Öffnen sieht sie immer gleich aus – Ausgaben offen, alles andere zu."],
  ["0.1.0-beta.10", "🔵 Die <b>blaue Zahl oben</b> zählt jetzt offene Fixkosten <b>und</b> Ausgaben, die noch nicht abgebucht sind. · 🐷 „Nicht mehr zurücklegen“ gibt es nur noch <b>im geöffneten Topf</b> (orangen Zettel dort antippen) – in der Liste passiert beim Antippen nichts aus Versehen."],
  ["0.1.0-beta.9", "🐷 <b>Orangen „geliehen“-Zettel antippen</b> = „nicht mehr zurücklegen“: der Zettel ist weg, das Geld gilt als ausgegeben. · 💳 <b>Ausgaben einklappbar</b> (Standard offen) – zugeklappt bleiben Schnellknöpfe und Eingabe da. · 💾 <b>CSV-Sicherung</b> hat jetzt den <b>Kontostand</b> (mit Datum) und das <b>Datum bei Töpfen</b> – beides kommt beim Einlesen wieder rein. · 🧹 „Bleibt nach Fixkosten“ ist weg (hat nur verwirrt)."],
  ["0.1.0-beta.8", "🐷 <b>Topf-Fenster schlank:</b> nur noch zwei Zeilen. Oben Betrag mit ➖ und ➕, darunter „Stand korrigieren“ mit grünem Haken ✓ und ✕. Nur Symbole – lange drücken zeigt, was ein Knopf macht. Auf den Topf-Namen tippen klappt wieder zu."],
  ["0.1.0-beta.7", "🎛️ <b>Symbole wie bei der Einkaufsliste:</b> Emojis vorn an Knöpfen und Überschriften werden zu schlichten Linien-Symbolen, die Gruppen in ⚙️ haben farbige Kästchen mit weißem Symbol. · 🟢 <b>„Verfügbar“ ist im Plus immer grün</b>, rot nur im Minus. · 🐷 <b>Topf:</b> „Stand korrigieren“ hat jetzt ein eigenes Feld – der Betrag für Rausnehmen/Zurücklegen setzt nie mehr aus Versehen den Stand. · 🚪 Offline-App: klarer Text, dass <b>Abmelden</b> nur die Kopie im Handy löscht."],
  ["0.1.0-beta.6", "💵 <b>Einnahmen zum Abhaken</b> – so siehst du, ob der Lohn schon da ist (Haken gehen am Monatsanfang mit zurück). · 📊 Der <b>Rückblick</b> wohnt jetzt in ⚙️ → Daten, oben bleiben Übersicht und Bearbeiten. · 💣 <b>Werkseinstellungen</b> wie bei der Einkaufsliste (⚙️ → Daten, nur Admins, zwei Sicherheitsfragen, die PIN bleibt). · 🩺 Neue Gruppe <b>Gesundheit</b>: „Alles ok?“ findet z. B. Posten ohne Gruppe, alten Kontostand oder vergessene Ausgaben, dazu Fehler-Protokoll und Ressourcen. · 🎨 Symbole und Namen in ⚙️ wie bei der Einkaufsliste."],
  ["0.1.0-beta.5", "✅ „abgebucht“ und „beglichen“ sind nur noch ein <b>grüner Haken</b>. <b>Lange drücken</b> auf einen Symbol-Knopf zeigt, was er macht (wie bei der Einkaufsliste). · ↩️ Die <b>Zurück-Taste am Handy</b> geht in der Karte einen Schritt zurück (PIN → Einstellungen → Übersicht), statt alles zu schließen. · 🔕 <b>Warnung ausschaltbar</b> (⚙️ → Rechnen &amp; Warnung): dann bleibt „Verfügbar“ grün und der Warn-Sensor aus. · 🏦 Die Kachel <b>„Konto“</b> öffnet eine eigene Seite zum Eintragen. · 🗑️ <b>„Vorgemerkt“ ist weg</b> – die Ausgaben machen das schon. · 🐷 <b>Töpfe:</b> ➖ Rausnehmen und ➕ Zurücklegen (auch in Teilbeträgen), Geliehenes steht in Orange dabei."],
  ["0.1.0-beta.4", "🔢 <b>PIN wie am Handy:</b> Zahlenfeld mit Punkten, ⌫ und ✔ – genau wie bei der Einkaufsliste (am PC geht auch die Tastatur). · ⚙️ <b>Zahnrad oben in der Leiste</b>, darunter das 🔒 Schloss zum sofort Sperren (in der Offline-App mit Fingerabdruck-Sperre sperrt es die ganze App). · 🪟 Einstellungen, PIN und Anleitung öffnen als <b>Seite in der Karte</b> mit ← / ✕ oben rechts. · ↔️ Schnellknöpfe in einer Zeile zum <b>Wischen</b>. · 🔄 <b>„Neu laden“</b>-Hinweis, wenn eine neue Version da ist. · 🏦 <b>Meine Konten</b> zum Einklappen. · ⠿ <b>Gruppen</b> lassen sich jetzt auch verschieben. · 💳 „Kartenzahlungen“ heißen jetzt <b>„Ausgaben“</b> (Karte, PayPal, bar …) und lassen sich per Antippen <b>ändern</b>. · ⠿ Verschieben nur noch am Griff (ohne ▲▼). · 📖 Anleitung im Look der Einkaufsliste, mit Suche und „Was ist neu“."],
  ["0.1.0-beta.3", "🎨 Optik wie die Einkaufsliste (Leiste über der Karte, Farbstreifen je Gruppe, Rückgängig-Leiste). · ⚙️ Einstellungen als Kästen mit bunten Symbolen. · 🐷 „Komplett“ = Verfügbar + Töpfe."],
  ["0.1.0-beta.2", "📂 Gruppen, Einnahmen und Töpfe zum Einklappen. · ⏸️ Pausierte stehen grau und abgehakt mit drin. · 📅 Hinweis nur bei festem Tag. · ⠿ Verschieben. · ↩️ Rückgängig nach dem Löschen. · 📱 Adresse der Offline-App mit Kopieren-Knopf."],
  ["0.1.0-beta.1", "🎉 Erste Beta: Verfügbar-Rechnung, Ausgaben mit Schnellknöpfen, Taschenrechner, Töpfe, offene Stände, Rückblick, CSV, PIN-Sperre und Offline-App mit Fingerabdruck."],
];
const FK_NOSLEEP = { mp4: "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANQbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAnp0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHybWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAUABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABnW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAV1zdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAK/+EAF2dCwArZBCbARAAAAwAEAAADACg8SJkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAL5AAAC+QAAAAYc3R0cwAAAAAAAAABAAAACgAACAAAAAAYc3RzcwAAAAAAAAACAAAAAQAAAAYAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAoAAAABAAAAPHN0c3oAAAAAAAAAAAAAAAoAAAKMAAAACgAAAAsAAAAKAAAACgAAABsAAAAKAAAACwAAAAoAAAAKAAAAFHN0Y28AAAAAAAAAAQAAA4AAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYwLjE2LjEwMAAAAAhmcmVlAAADAW1kYXQAAAJtBgX//2ncRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY0IHIzMTA4IDMxZTE5ZjkgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDIzIC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD01IGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTUgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAF2WIhAR8mKAANiMnJyddddddddddddeAAAAABkGaOAj4RgAAAAdBmlQCPhGAAAAABkGaYBHwjAAAAAZBmoAR8IwAAAAXZYiCAU8mKAAP78nJyddddddddddddeAAAAAGQZo4CPhGAAAAB0GaVAI+EYAAAAAGQZpgEPCMAAAABkGagD/CMA==", webm: "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAALCEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggKs7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECfQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYiU74J2vpmbxJyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhAvrwgDgibCBQLqBQJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYiU74J2vpmbxGfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDIuMDAwMDAwMDAwAB9DtnVBB+eBAKOqgQAAgPACAJ0BKkAAQAAARwiFhYiFhIgCAgAGcDxCYAqyIPcwAP7/q1CAo5aBAMgA0QEAARAQABgAGFgv9AAIjoAAo5aBAZAA0QEAARAQABgAGFgv9AAIjoAAo5aBAlgA0QEAARAQABgAGFgv9AAIjoAAo5aBAyAA0QEAARAQABgAGFgv9AAIjoAAo5aBA+gA0QEAARAQABgAGFgv9AAIjoAAo5aBBLAA0QEAARAQABgAGFgv9AAIjoAAo5aBBXgA0QEAARAQFGAAYWC/0AAiOgAAo5aBBkAA0QEAARAQABgAGFgv9AAIjoAAo5aBBwgA0QEAARAQABgAGFgv9AAIjoAAHFO7a5G7j7OBALeK94EB8YIBn/CBAw==" };
async function fkKeepAwake(ov, noVideo) { // noVideo: in der HA-App bringt der Video-Trick nichts (dort hilft nur deren Einstellung)
  let lock = null, vid = null, mode = "", over = false;
  const getLock = async () => {
    try {
      const l = await navigator.wakeLock?.request("screen");
      if (l) { lock = l; l.addEventListener?.("release", () => { if (lock === l) lock = null; }); }
    } catch (_) { /* dann das Video */ }
  };
  const startVideo = async () => {
    try {
      vid = document.createElement("video");
      vid.muted = true; vid.defaultMuted = true; vid.loop = true; vid.playsInline = true;
      vid.setAttribute("muted", ""); vid.setAttribute("playsinline", ""); vid.setAttribute("loop", ""); vid.setAttribute("aria-hidden", "true");
      vid.style.cssText = "position:fixed;left:0;bottom:0;width:48px;height:48px;opacity:.02;pointer-events:none;z-index:0";
      for (const [t, d] of [["video/mp4", FK_NOSLEEP.mp4], ["video/webm", FK_NOSLEEP.webm]]) { const so = document.createElement("source"); so.src = d; so.type = t; vid.append(so); }
      document.body.append(vid); // nicht ins Fenster: dessen Inhalt wird teils neu aufgebaut
      await vid.play();
      return !vid.paused;
    } catch (_) { return false; }
  };
  await getLock();
  if (lock) mode = "lock";
  else if (!noVideo && await startVideo()) mode = "video";
  const onVis = () => { // Handy zwischendurch weggelegt und wieder da: neu anfordern
    if (over || document.visibilityState !== "visible") return;
    if (mode === "lock" && !lock) getLock();
    if (mode === "video" && vid?.paused) vid.play().catch(() => {});
  };
  document.addEventListener("visibilitychange", onVis);
  const stop = () => {
    if (over) return;
    over = true;
    clearInterval(watch);
    document.removeEventListener("visibilitychange", onVis);
    try { lock?.release(); } catch (_) { /* egal */ }
    try { vid?.pause(); vid?.remove(); } catch (_) { /* egal */ }
  };
  const watch = setInterval(() => { if (ov && !ov.isConnected) stop(); }, 1000);
  return { mode, stop };
}
function fkVerCmp(a, b) {
  const p = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/.exec(String(v).trim()); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? Infinity : +m[4]] : [0, 0, 0, Infinity]; };
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
const GUIDE_EMO = ["💶", "🏦", "📅", "💳", "🧮", "🐷", "✏️", "📊", "🩺", "🙈", "📚", "📱", "🔒", "📄", "🛡️", "👁️"];
const GUIDE_SUB = ["die große Zahl oben", "Stand aus der Bank-App", "Kreis antippen", "Bäckerei & Co.", "🧮 oben in der Karte", "Töpfe, Stände, IBANs", "neu, ändern, verschieben", "Monate im Vergleich", "Alles ok?, Fehler, Reset", "👁️ oben in der Karte", "eins pro Person", "ohne Netz, mit Fingerabdruck", "PIN, Schloss, Seitenleiste", "Datei einlesen und sichern", "alles bleibt bei dir", "Verlauf, Ansicht, Sparschwein"];
const FK_CARDS = new Set(); // ↩️ alle Fixkosten-Karten auf der Seite (für die Zurück-Taste)
const DKEY = "fixkosten_data";
const HKEY = "fixkosten_hidden";
const CALMKEY = "fixkosten_calm"; // 🧘 Ruhiger Modus – nur dieses Gerät
const THEMEKEY = "fkapp_theme";   // 🌓 Hell / Dunkel – nur in der Offline-App
const fkTheme = () => { try { return localStorage.getItem(THEMEKEY) || "auto"; } catch (_) { return "auto"; } };
// 👁️ Was man für alle ausblenden kann (gleiche Schlüssel wie VIEW_KEYS in manager.py)
const FK_VIEW = [["ausgaben", "credit-card-outline", "Ausgaben", "Schnellknöpfe, Eingabe und Liste"], ["fixkosten", "calendar-month-outline", "Fixkosten-Gruppen", "„ab dem 1.“, „ab dem 15.“ …"], ["einnahmen", "cash-plus", "Einnahmen", "Lohn & Co. zum Abhaken"], ["staende", "file-document-alert-outline", "Offene Stände", "was du noch begleichen musst"], ["toepfe", "piggy-bank-outline", "Töpfe", "Sparkonto, Bargeld …"], ["konten", "bank-outline", "Meine Konten", "IBANs zum Kopieren"]];
const OKEY = "fixkosten_offen"; // 📂 alter Merkzettel fürs Aufklappen (wird nicht mehr benutzt, nur noch weggeräumt)

const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// 💱 Währung (⚙️ → Rechnen & Warnung). CHF wird schweizerisch geschrieben (CHF 1’234.50), der Rest deutsch (1.234,50 €)
const FK_CUR = { EUR: "Euro (€)", CHF: "Schweizer Franken (CHF)", USD: "US-Dollar ($)", GBP: "Britisches Pfund (£)", PLN: "Polnischer Złoty (zł)", CZK: "Tschechische Krone (Kč)", DKK: "Dänische Krone (kr)", SEK: "Schwedische Krone (kr)", NOK: "Norwegische Krone (kr)", HUF: "Ungarischer Forint (Ft)" };
const FK_MONEY = { key: "", fmt: null, code: "EUR", sym: "€", dec: "," };
function fkSetMoney(code, lang = "de") {
  code = FK_CUR[code] ? code : "EUR";
  const key = `${code}|${lang}`;
  if (FK_MONEY.key === key) return;
  const loc = code === "CHF" ? (lang === "en" ? "en-CH" : "de-CH") : (lang === "en" ? "en-IE" : "de-DE");
  const fmt = new Intl.NumberFormat(loc, { style: "currency", currency: code });
  const parts = fmt.formatToParts(1234.5);
  Object.assign(FK_MONEY, { key, fmt, code, sym: parts.find((x) => x.type === "currency")?.value || code, dec: parts.find((x) => x.type === "decimal")?.value || "," });
}
fkSetMoney("EUR");
const money = (v) => FK_MONEY.fmt.format(Number(v) || 0);
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2) + Date.now().toString(36));
const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
function parseMoney(v) {
  if (typeof v === "number") return Math.round(v * 100) / 100;
  let s = String(v ?? "").replace("−", "-").replace(/\b(EUR|CHF|SFr\.?|Fr\.|USD|US\$|GBP|PLN|CZK|DKK|SEK|NOK|HUF|zł|Kč|kr\.?|Ft)(?![a-z])|[€$£]/gi, "").replace(/[\s  '’]/g, ""); // 💱 Zeichen weg
  if (!s) return 0;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""); // 1.234,56 oder 1,234.56
  else if (s.includes(",")) s = s.replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* voll/privat */ } },
};

// 🌍 Englisch als zweite Sprache (wie bei der Einkaufsliste): Die Karte ist auf Deutsch geschrieben. Ist Home Assistant
// NICHT auf Deutsch (oder steht in der Karte „language: en“), holt sie einmal das Wörterbuch fixkosten-en.json und übersetzt,
// was sie anzeigt. Deine eigenen Namen (Posten, Töpfe, Gruppen …) bleiben, wie sie sind.
let FK_LANG = "de", FK_DICT = null, FK_PATTERNS = [], FK_DICT_PROMISE = null, FK_DICT_FAIL = 0;
const FK_USER = new Set(); // ✋ Namen, die die Leute selbst getippt haben – nie übersetzen
const FK_ATTRS = ["placeholder", "title", "aria-label", "alt"];
const FK_SKIP = "textarea,style,script,option[data-user],[translate=no]";
const FK_INLINE = new Set(["B", "I", "EM", "STRONG", "BR", "CODE", "U", "SMALL"]);
const fkNorm = (t) => String(t).replace(/\s+/g, " ").trim();
function fkWantLang(hass, config) {
  const want = String(config?.language || "auto").toLowerCase();
  const l = want !== "auto" ? want : String(hass?.locale?.language || hass?.language || "de").toLowerCase();
  return l.startsWith("de") ? "de" : "en";
}
function fkLoadDict() {
  if (!FK_DICT_PROMISE && Date.now() - FK_DICT_FAIL > 60000) {
    FK_DICT_PROMISE = fetch(`/fixkosten/files/fixkosten-en.json?v=${FK_VERSION}`).then((r) => r.json()).then((raw) => {
      const dict = {}, pats = [];
      for (const [de, en] of Object.entries(raw)) {
        if (de.startsWith("//")) continue; // Kommentar-Zeilen
        const key = fkNorm(de);
        if (!key.includes("{}")) { dict[key] = en; continue; }
        const parts = key.split("{}");
        pats.push([new RegExp("^" + parts.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.*?)") + "$", "s"), en, parts.join("").length]);
      }
      pats.sort((a, b) => b[2] - a[2]); // genauere Muster zuerst
      FK_DICT = dict; FK_PATTERNS = pats;
      for (const c of FK_CARDS) { c._force = true; c._render(); }
    }).catch(() => { FK_DICT_PROMISE = null; FK_DICT_FAIL = Date.now(); });
  }
  return FK_DICT_PROMISE || Promise.resolve();
}
// 📝 Ein Text auf Englisch (oder unverändert, wenn es ihn im Wörterbuch nicht gibt)
function fkT(text, depth = 0) {
  if (FK_LANG === "de" || !FK_DICT || text == null) return text;
  const raw = String(text), key = fkNorm(raw);
  if (!key || !/[A-Za-zÄÖÜäöüß]/.test(key) || FK_USER.has(key)) return raw;
  const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0], wrap = (x) => lead + x + trail;
  if (key in FK_DICT) return wrap(FK_DICT[key]);
  for (const [rx, en] of FK_PATTERNS) {
    const m = key.match(rx);
    if (m) return wrap(en.replace(/\{(\d)\}/g, (_, i) => { const g = m[Number(i) + 1] ?? ""; return depth < 2 ? fkT(g, depth + 1) : g; }));
  }
  const m = depth < 2 && key.match(/^([^\p{L}\p{N}„“"(<]+?)\s(.+)$/u); // „🐷 Töpfe“: Zeichen vorne weg, Rest übersetzen
  if (m) { const rest = fkT(m[2], depth + 1); if (rest !== m[2]) return wrap(`${m[1]} ${rest}`); }
  return raw;
}
// 🧱 Ein Absatz mit <b>fett</b> darin wird als Ganzes übersetzt (sonst zerfällt der Satz in Stücke)
function fkBlockKey(el) {
  if (!el.firstElementChild || el.closest(FK_SKIP)) return null;
  let words = false;
  for (const n of el.childNodes) {
    if (n.nodeType === 3) { if (/[A-Za-zÄÖÜäöüß]/.test(n.data)) words = true; }
    else if (n.nodeType === 1) { if (!FK_INLINE.has(n.tagName) || n.firstElementChild || n.attributes.length) return null; }
  }
  return words ? fkNorm(el.innerHTML) : null;
}
function fkTranslateTree(root) {
  if (FK_LANG === "de" || !FK_DICT || !root) return;
  const w = document.createTreeWalker(root, 5 /* Elemente + Text */);
  let n = w.nextNode();
  while (n) {
    if (n.nodeType === 1) {
      if (n.matches(FK_SKIP)) { n = w.nextSibling() || fkNext(w); continue; }
      for (const a of FK_ATTRS) { const v = n.getAttribute(a); if (v) { const t = fkT(v); if (t !== v) n.setAttribute(a, t); } }
      const bk = fkBlockKey(n);
      if (bk) { const t = fkT(bk); if (t !== bk) { n.innerHTML = t; n = w.nextSibling() || fkNext(w); continue; } }
    } else if (n.parentElement && !n.parentElement.closest(FK_SKIP)) { const t = fkT(n.data); if (t !== n.data) n.data = t; }
    n = w.nextNode();
  }
}
function fkNext(w) { let p; while ((p = w.parentNode())) { const s = w.nextSibling(); if (s) return s; } return null; }
const fkConfirm = (t) => confirm(fkT(t));
// ✋ Alles, was die Leute selbst benannt haben, landet in FK_USER und wird nie übersetzt
function fkCollectUser(d) {
  FK_USER.clear();
  if (!d) return;
  const add = (x) => { const k = fkNorm(x ?? ""); if (k) FK_USER.add(k); };
  for (const k of ["posten", "groups", "einnahmen", "toepfe", "staende", "konten", "bookings"]) for (const it of d[k] || []) { add(it.name); add(it.note); add(it.bank); add(it.owner); }
  for (const q of d.settings?.quick || []) add(q);
  add(d.book?.title);
}
const fkLoc = () => (FK_LANG === "en" ? "en-GB" : "de-DE");
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 🔒 Entsperrt gilt für alle Fixkosten-Karten dieser Seite, bis 🔒 angetippt wird oder 10 Minuten nichts passiert
const PIN_LOCK = { until: 0 };
const pinOpen = () => PIN_LOCK.until > Date.now();
const pinTouch = () => { if (pinOpen()) PIN_LOCK.until = Date.now() + 10 * 60 * 1000; };
// 📴 PIN ohne Netz prüfen: HA schickt einen Offline-Schlüssel (PBKDF2-SHA256), die Karte rechnet genauso nach.
// Ohne https (z. B. http://192.168…) gibt es kein crypto.subtle – dann rechnet ein kleines SHA-256 hier im Code.
const PINOFF_FAIL = "fixkosten_pinfehler";
function pinSha256(bytes) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  const w = new Uint32Array(64), r = (x, c) => (x >>> c) | (x << (32 - c));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10))) | 0;
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer);
  H.forEach((v, i) => ov.setUint32(i * 4, v));
  return out;
}
function pinPbkdf2Js(pw, salt, iter) { // 🐢 Notfall ohne crypto.subtle (1 Block = 32 Byte reicht)
  let key = pw; if (key.length > 64) key = pinSha256(key);
  const ip = new Uint8Array(64).fill(0x36), op = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < key.length; i++) { ip[i] ^= key[i]; op[i] ^= key[i]; }
  const hmacf = (msg) => { const a = new Uint8Array(64 + msg.length); a.set(ip); a.set(msg, 64); const b = new Uint8Array(96); b.set(op); b.set(pinSha256(a), 64); return pinSha256(b); };
  const s1 = new Uint8Array(salt.length + 4); s1.set(salt); s1[salt.length + 3] = 1;
  let u = hmacf(s1); const t = u.slice();
  for (let i = 1; i < iter; i++) { u = hmacf(u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; }
  return t;
}
async function pinPbkdf2(pin, saltHex, iter) {
  const pw = new TextEncoder().encode(String(pin)), salt = new Uint8Array((saltHex.match(/../g) || []).map((h) => parseInt(h, 16)));
  let out;
  try {
    const k = await crypto.subtle.importKey("raw", pw, "PBKDF2", false, ["deriveBits"]);
    out = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, k, 256));
  } catch (_) { out = pinPbkdf2Js(pw, salt, iter); }
  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}
// ✔ / ✘ / Wartezeit – auch offline: 5× falsch = 1 Minute Pause, danach jedes Mal doppelt so lang (höchstens 1 Stunde)
async function pinCheckOffline(off, pin) {
  const f = store.get(PINOFF_FAIL, { n: 0, until: 0 });
  if (f.until > Date.now()) return { wait: Math.ceil((f.until - Date.now()) / 1000) };
  if (!off || !off.salt || !off.hash || !off.iter) return { unknown: true };
  const ok = (await pinPbkdf2(pin, off.salt, off.iter)) === off.hash;
  if (ok) { store.put(PINOFF_FAIL, { n: 0, until: 0 }); return { ok: true }; }
  f.n = (f.n || 0) + 1;
  if (f.n >= 5) f.until = Date.now() + Math.min(3600, 60 * 2 ** (f.n - 5)) * 1000;
  store.put(PINOFF_FAIL, f);
  return { ok: false };
}
// 🎨 Farben wie bei der Einkaufsliste: jede Gruppe bekommt ihre Farbe (Streifen links + Punkt im Kopf)
const GROUP_COLORS = ["#1e88e5", "#fb8c00", "#8e24aa", "#00897b", "#e53935", "#6d4c41", "#3949ab"];
// ⚡ Schnellknöpfe: jeder bekommt automatisch eine eigene Farbe – passende Ausgaben unten tragen dieselbe.
// 🟠 Orange gibt es hier NICHT: das bleibt für Ausgaben ohne passenden Knopf (sonst sieht „PayPal - Claude“ aus wie „Bäckerei“)
const QUICK_COLORS = ["#1e88e5", "#43a047", "#8e24aa", "#e53935", "#00897b", "#6d4c41", "#3949ab", "#d81b60", "#00acc1", "#546e7a"]; // 10 gut unterscheidbare Farben (kein Orange, kein Hellgrün/Gelb)
// 🔎 Passt, wenn der Name genau so heißt ODER damit anfängt („PayPal - Claude“ → „PayPal“). Der längste passende Knopf gewinnt.
// 🎨 Feste Farbe je Knopf-NAME (nicht je Platz): Umsortieren ändert nichts. Selbst gewählte Farbe (⚙️) gewinnt.
const fkHash = (t) => { let h = 0; for (const c of t) h = (h * 31 + c.codePointAt(0)) >>> 0; return h; };
function quickColors(d) {
  const own = d.settings?.quick_colors || {}, used = new Set(), out = {};
  const names = [...new Set((d.settings?.quick || []).map((q) => String(q).trim().toLowerCase()).filter(Boolean))];
  for (const n of names) if (own[n]) { out[n] = own[n]; used.add(own[n]); }
  for (const n of [...names].sort()) { // alphabetisch verteilen, damit zwei Knöpfe nicht dieselbe Farbe bekommen
    if (out[n]) continue;
    let i = fkHash(n) % QUICK_COLORS.length;
    for (let k = 0; k < QUICK_COLORS.length && used.has(QUICK_COLORS[i]); k++) i = (i + 1) % QUICK_COLORS.length;
    out[n] = QUICK_COLORS[i]; used.add(out[n]);
  }
  return out;
}
// ⚡ Symbol je Schnellknopf (wie die Kategorien der Einkaufsliste): selbst gewählt oder keins
const QUICK_ICONS = ["cart-outline", "basket-outline", "bread-slice-outline", "food-outline", "hamburger", "coffee-outline", "glass-mug-variant", "pizza", "store-outline", "shopping-outline", "package-variant-closed", "truck-delivery-outline", "credit-card-outline", "cash", "bank-transfer", "wallet-outline", "google", "gas-station-outline", "car-outline", "bus", "train", "medical-bag", "pill", "tshirt-crew-outline", "gift-outline", "gamepad-variant-outline", "movie-open-outline", "paw", "baby-carriage", "home-outline", "tools", "cellphone", "dots-horizontal"];
const qiconOf = (d, q) => { const v = d.settings?.quick_icons?.[String(q || "").trim().toLowerCase()]; return v ? (v.includes(":") ? v : "mdi:" + v) : null; };
const qcolOf = (d, q) => quickColors(d)[String(q || "").trim().toLowerCase()] || QUICK_COLORS[0];
// 🔎 Passt, wenn der Name genau so heißt ODER damit anfängt („PayPal - Claude“ → „PayPal“). Der längste passende Knopf gewinnt.
const qcol = (d, name) => {
  const k = String(name || "").trim().toLowerCase();
  let best = null, len = 0;
  (d.settings?.quick || []).forEach((q) => { const n = String(q).trim().toLowerCase(); if (n && n.length > len && (k === n || (k.startsWith(n) && !/[\p{L}\p{N}]/u.test(k[n.length])))) { best = q; len = n.length; } });
  return best == null ? null : qcolOf(d, best);
};
const fkUntil = (u) => { const [y, m] = String(u || "").split("-"); return m ? `${m}/${y}` : ""; };
const fkDay = (ts) => new Date(ts).toLocaleDateString(fkLoc(), { day: "2-digit", month: "2-digit" });
const gcol = (d, gid) => { const i = d.groups.findIndex((g) => g.id === gid); return i < 0 ? "#9e9e9e" : GROUP_COLORS[i % GROUP_COLORS.length]; };
const ic = (name) => `<ha-icon icon="mdi:${name}"></ha-icon>`;

const FK_EMOJI_ICONS = {
  "🏷": "mdi:tag-outline", "✏": "mdi:pencil-outline", "✍": "mdi:account-edit-outline", "📷": "mdi:camera-outline", "📖": "mdi:book-open-variant", "➕": "mdi:plus",
  "📍": "mdi:map-marker-outline", "👁": "mdi:eye-outline", "🛒": "mdi:cart-outline", "✅": "mdi:check-circle-outline", "🔄": "mdi:sync", "🔁": "mdi:repeat",
  "⚠": "mdi:alert-outline", "📋": "mdi:clipboard-text-outline", "📊": "mdi:chart-bar", "✔": "mdi:check", "🧂": "mdi:shaker-outline", "⏳": "mdi:timer-sand",
  "⌛": "mdi:timer-sand", "🏪": "mdi:store-outline", "📧": "mdi:email-outline", "↩": "mdi:undo-variant", "⇄": "mdi:swap-horizontal",
  "🤷": "mdi:map-marker-question-outline", "🕒": "mdi:clock-outline", "💡": "mdi:lightbulb-outline", "🧾": "mdi:receipt-text-outline", "🎉": "mdi:party-popper",
  "👥": "mdi:account-group-outline", "👪": "mdi:account-multiple-outline", "👤": "mdi:account-outline", "⏲": "mdi:pot-steam-outline", "⏱": "mdi:timer-outline",
  "🧲": "mdi:magnet", "🗓": "mdi:calendar-month-outline", "📅": "mdi:calendar-outline", "🚫": "mdi:cancel", "🥫": "mdi:food-variant", "📈": "mdi:chart-line",
  "🧽": "mdi:delete-sweep-outline", "🧹": "mdi:broom", "💣": "mdi:nuke", "🔧": "mdi:wrench-outline", "📝": "mdi:note-text-outline", "⭐": "mdi:star-outline",
  "⌨": "mdi:keyboard-outline", "🗞": "mdi:newspaper-variant-outline", "🖼": "mdi:image-outline", "🔒": "mdi:lock-outline", "🔓": "mdi:lock-open-variant-outline",
  "📦": "mdi:package-variant-closed", "🔥": "mdi:fire", "🤖": "mdi:robot-happy-outline", "🔠": "mdi:format-size", "⚙": "mdi:cog-outline", "🗂": "mdi:shape-outline",
  "🗺": "mdi:map-outline", "🧠": "mdi:brain", "🗣": "mdi:microphone-outline", "🌐": "mdi:web", "🍽": "mdi:silverware-fork-knife", "📄": "mdi:file-document-outline",
  "🧮": "mdi:calculator-variant-outline", "🔊": "mdi:volume-high", "📳": "mdi:vibrate", "🎌": "mdi:flag-outline", "👋": "mdi:hand-wave-outline", "🔐": "mdi:key-outline",
  "📏": "mdi:ruler", "✖": "mdi:close", "🗑": "mdi:delete-outline", "▥": "mdi:barcode", "🧩": "mdi:puzzle-outline", "🧰": "mdi:toolbox-outline", "🔢": "mdi:numeric", "🎨": "mdi:palette-outline", "🔀": "mdi:shuffle-variant", "✓": "mdi:check", "🍕": "mdi:pizza", "🍝": "mdi:pasta", "🥔": "mdi:food-variant", "🥚": "mdi:egg-outline", "🥦": "mdi:carrot", "🍗": "mdi:food-drumstick-outline", "🐟": "mdi:fish", "🍲": "mdi:pot-steam-outline", "💨": "mdi:weather-windy", "🍰": "mdi:cake-variant-outline", "🎛": "mdi:tune-variant", "💾": "mdi:content-save-outline", "🩺": "mdi:stethoscope", "📱": "mdi:cellphone", "🧪": "mdi:flask-outline", "👨‍🍳": "mdi:chef-hat", "🛍": "mdi:shopping-outline", "🪟": "mdi:window-open-variant", "✨": "mdi:creation-outline", "👆": "mdi:gesture-tap", "💳": "mdi:credit-card-outline", "🙏": "mdi:hand-heart-outline", "🐙": "mdi:github", "🐞": "mdi:bug-outline", "🔍": "mdi:magnify", "📥": "mdi:tray-arrow-down", "🕘": "mdi:history", "🌓": "mdi:theme-light-dark", "🛡": "mdi:shield-outline",
};
// 🎨 Farben zu den Symbolen (damit es nicht trist wird): nur außerhalb von Knöpfen/Links, dort gilt die Schriftfarbe des Knopfes
const FK_EMOJI_COLORS = {
  "🧹": "#fb8c00", "✍": "#5c6bc0", "📍": "#e53935", "🏷": "#d81b60", "🛒": "#43a047", "✅": "#43a047", "⚠": "#f9a825", "🔧": "#607d8b", "🥫": "#8d6e63",
  "🧾": "#3949ab", "📖": "#1e88e5", "⭐": "#f9a825", "🔒": "#546e7a", "🔓": "#546e7a", "📷": "#1e88e5", "📝": "#6d4c41", "✏": "#6d4c41", "💡": "#f9a825",
  "🎉": "#ab47bc", "🔥": "#ef6c00", "🕒": "#546e7a", "🌐": "#1e88e5", "🔊": "#1e88e5", "📊": "#00897b", "🧂": "#8d6e63", "🏪": "#43a047", "📧": "#1e88e5",
  "🔄": "#1e88e5", "🔁": "#1e88e5", "📋": "#1e88e5", "🗓": "#43a047", "📅": "#43a047", "👥": "#8e24aa", "👪": "#8e24aa", "👤": "#8e24aa", "🧲": "#e53935",
  "🚫": "#e53935", "🗑": "#e53935", "💣": "#b71c1c", "🧽": "#fb8c00", "📈": "#00897b", "🗞": "#d81b60", "🤖": "#5e35b1", "🧠": "#5e35b1", "🤷": "#78909c",
  "⏳": "#fb8c00", "⌛": "#fb8c00", "↩": "#1e88e5", "⇄": "#1e88e5", "🔠": "#546e7a", "🗂": "#fb8c00", "🗺": "#43a047", "🗣": "#1e88e5", "📦": "#8d6e63",
  "🍽": "#fb8c00", "📄": "#546e7a", "🧮": "#00897b", "📳": "#546e7a", "🎌": "#e53935", "👋": "#fb8c00", "🔐": "#546e7a", "📏": "#546e7a", "🧪": "#8e24aa",
  "👨‍🍳": "#e53935", "🛍": "#43a047", "🪟": "#1e88e5", "✨": "#f9a825", "👆": "#1e88e5", "💳": "#00acc1", "🙏": "#ec407a", "🐞": "#e53935", "🔍": "#546e7a",
  "📥": "#1e88e5", "🕘": "#546e7a", "🌓": "#546e7a", "🛡": "#455a64", "⌨": "#546e7a", "🖼": "#1e88e5", "⏲": "#ef6c00", "⏱": "#26a69a", "▥": "#6d4c41", "🍝": "#f9a825", "🥔": "#8d6e63", "🥚": "#fbc02d", "🥦": "#43a047", "🍗": "#bf6b3a", "🐟": "#1e88e5", "🍲": "#ef6c00", "💨": "#546e7a", "🧩": "#8e24aa", "🧰": "#546e7a", "🔢": "#1e88e5", "🎨": "#ec407a", "🔀": "#1e88e5",
};
// 🧩 Farben der großen Gruppen-Kästchen in den Einstellungen (Emoji der Gruppe → Farbe)
const FK_GEM_COLORS = { "🧮": "#00897b", "📋": "#1e88e5", "🎛": "#8e24aa", "💾": "#43a047", "🩺": "#e53935", "👁": "#00897b", "📱": "#3949ab" };

// 🐷 Extra-Symbole nur für die Fixkosten
Object.assign(FK_EMOJI_ICONS, { "🐷": "mdi:piggy-bank-outline", "🏦": "mdi:bank-outline", "💵": "mdi:cash", "➖": "mdi:minus", "💰": "mdi:cash-multiple" });
Object.assign(FK_EMOJI_COLORS, { "🐷": "#e91e63", "🏦": "#1e88e5", "💵": "#43a047", "💰": "#43a047" });
const FK_EMOJI_RX = new RegExp("^\\s*(" + Object.keys(FK_EMOJI_ICONS).sort((a, b) => b.length - a.length).join("|") + ")\\uFE0F?(?=\\s|$)\\s*", "u");
const FK_ICON_PARENTS = "button,h2,h3,h4,summary,legend,label,b,span,li,a,small,p,.lbl,.ic";
const FK_ICON_SKIP = "option,select,textarea,input,ha-icon,style,script,[data-noicon]";
// 🎛️ Wie bei der Einkaufsliste: Emoji vorn an Knöpfen/Überschriften → Linien-Symbol (sieht auf jedem Gerät gleich aus)
function fkIconizeTree(root) {
  if (!root) return;
  const nodes = []; const w = document.createTreeWalker(root, 4 /* Text */); let n; while ((n = w.nextNode())) nodes.push(n);
  for (const t of nodes) {
    const p = t.parentElement;
    if (!p || !p.matches(FK_ICON_PARENTS) || p.closest(FK_ICON_SKIP)) continue; // eigene Namen bekommen data-noicon
    let first = p.firstChild; // das Emoji muss ganz vorn stehen
    while (first && first !== t && ((first.nodeType === 3 && !first.data.trim()) || (p.tagName === "LABEL" && first.nodeType === 1 && first.matches("input")))) first = first.nextSibling;
    if (first !== t) continue;
    const m = FK_EMOJI_RX.exec(t.data);
    if (!m) continue;
    const key = m[1];
    const ic = document.createElement("ha-icon");
    ic.setAttribute("icon", FK_EMOJI_ICONS[key]);
    ic.dataset.eli = "1";
    const gem = p.classList.contains("gem"); // großes Kästchen in den Einstellungen: farbiger Grund, weißes Symbol
    const plain = !gem && !p.closest("button,a,.tgl,.swline"); // Knöpfe und Links behalten ihre Schriftfarbe
    const flex = /flex/.test(getComputedStyle(p).display || "");
    ic.style.cssText = `--mdc-icon-size:${gem ? "1.25em" : "1.2em"};vertical-align:-.22em;flex:none;${flex || gem ? "" : "margin-right:.3em;"}${plain && FK_EMOJI_COLORS[key] ? `color:${FK_EMOJI_COLORS[key]};` : ""}`;
    if (gem) { p.style.setProperty("background", FK_GEM_COLORS[key] || FK_EMOJI_COLORS[key] || "#607d8b"); p.style.color = "#fff"; }
    const rest = t.data.slice(m[0].length);
    t.data = rest;
    if (p.tagName === "LABEL") { const wrap = document.createElement("span"); p.insertBefore(wrap, t); wrap.append(ic, t); }
    else p.insertBefore(ic, t);
  }
}

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
const numDe = (v) => (FK_MONEY.dec === "," ? String(v).replace(".", ",") : String(v)); // ✍️ Zahl fürs Eingabefeld, passend zur Währung
// 📋 Text kopieren – mit Ersatzweg wie bei der Einkaufsliste, falls das Handy die Zwischenablage sperrt (z. B. in der HA-App oder ohne https)
function fkCopy(text, inp) {
  const old = () => {
    try {
      let tmp = null;
      if (!inp) { tmp = document.createElement("textarea"); tmp.value = text; tmp.setAttribute("readonly", ""); tmp.style.cssText = "position:fixed;opacity:0;top:0;left:0"; document.body.appendChild(tmp); }
      (inp || tmp).select();
      document.execCommand?.("copy");
      tmp?.remove();
    } catch (_) { /* egal */ }
  };
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(old);
  old();
  return Promise.resolve();
}

// ---------------------------------------------------------------- 🧮 Rechnen (genau wie in manager.py)
// 💳 Ratenzahlung: „until“ = letzter Monat (JJJJ-MM). Danach zählt der Posten nicht mehr mit.
const ratesLeft = (d, it) => { if (!it.until) return null; const [y, m] = String(d.month || monthKey()).split("-").map(Number), [uy, um] = it.until.split("-").map(Number); return (uy - y) * 12 + (um - m) + 1; };
function countsThisMonth(d, it) {
  if (it.active === false) return false;
  if (it.until && ratesLeft(d, it) < 1) return false;
  const m = it.months || [];
  return !m.length || m.includes(Number(String(d.month || monthKey()).slice(5, 7)));
}
// 💶 Betrag eines Postens in diesem Monat: Sonderpreis (nur dieser Monat) oder der gespeicherte
function pamt(d, p) { const v = d.month_price?.[p.id]; return v == null ? p.amount : v; }
function summary(d) {
  const today = new Date().getDate();
  const groups = [...(d.groups || [])]; // ⠿ Reihenfolge wie in der Liste
  const paid = d.paid || {};
  let fixTotal = 0, fixOpen = 0, next = null;
  const gi = groups.map((g) => {
    const items = d.posten.filter((p) => p.group === g.id && countsThisMonth(d, p));
    const open = items.filter((p) => !paid[p.id]?.paid);
    const total = items.reduce((s, p) => s + pamt(d, p), 0), openSum = open.reduce((s, p) => s + pamt(d, p), 0);
    const due = today >= (g.start_day || 1);
    fixTotal += total; fixOpen += openSum;
    if (open.length && !next) next = { name: open[0].name, amount: pamt(d, open[0]), group: g.name, start_day: g.start_day, due };
    return { ...g, due, total, open: openSum, count: items.length, done: items.length - open.length };
  });
  const known = new Set(groups.map((g) => g.id));
  for (const p of d.posten) if (!known.has(p.group) && countsThisMonth(d, p)) { fixTotal += pamt(d, p); if (!paid[p.id]?.paid) fixOpen += pamt(d, p); }
  const incomeTotal = d.einnahmen.filter((e) => countsThisMonth(d, e)).reduce((s, e) => s + e.amount, 0);
  const k = d.konto || {};
  const bookingsOpen = d.bookings.filter((b) => !b.cleared).reduce((s, b) => s + b.amount, 0);
  const bookingsMonth = d.bookings.filter((b) => b.month === d.month).reduce((s, b) => s + b.amount, 0);
  const pots = d.toepfe.reduce((s, t) => s + t.amount, 0);
  const debts = d.staende.reduce((s, x) => s + x.amount, 0);
  const available = (k.balance || 0) - fixOpen - bookingsOpen - (d.settings?.debts_subtract ? debts : 0);
  return {
    month: d.month, today, available, balance: k.balance || 0, balance_updated: k.updated || 0,
    fix_total: fixTotal, fix_open: fixOpen, fix_paid: fixTotal - fixOpen, income_total: incomeTotal, surplus: incomeTotal - fixTotal,
    bookings_open: bookingsOpen, bookings_month: bookingsMonth, pots_total: pots, debts, total: pots + available,
    warn: d.settings?.warn_enabled !== false && available < (d.settings?.warn_below || 0), pots_lent: d.toepfe.reduce((x, t) => x + (Number(t.lent) || 0), 0), next, groups: gi,
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
    if (d.month_price) delete d.month_price[op.id];
  } else if (t === "posten_month") { // 💶 Preis nur für diesen Monat
    if (op.month && op.month !== d.month) return;
    d.month_price = d.month_price || {};
    if (op.amount == null || String(op.amount).trim() === "") delete d.month_price[op.id]; else d.month_price[op.id] = Math.abs(parseMoney(op.amount)) || 0;
  } else if (t === "paid") {
    if (!op.month || op.month === d.month) d.paid[op.id] = { paid: !!op.value, ts: op.ts };
  } else if (t === "received") {
    d.received = d.received || {};
    if (!op.month || op.month === d.month) d.received[op.id] = { paid: !!op.value, ts: op.ts };
  } else if (t === "reset_checks") { d.paid = {}; d.received = {}; }
  else if (t === "konto") {
    if ("balance" in op) { d.konto.balance = parseMoney(op.balance); d.konto.updated = op.ts; }
  } else if (t === "booking_add") {
    if (d.bookings.some((b) => b.id === op.op_id)) return; // schon bei HA angekommen
    d.bookings.push({ id: op.op_id, name: op.name, amount: parseMoney(op.amount), ts: op.ts, month: monthKey(new Date(op.ts)), cleared: false, waiting: true });
  } else if (t === "booking_clear") { const b = d.bookings.find((x) => x.id === op.id); if (b) b.cleared = !!op.value; }
  else if (t === "booking_edit") { const b = d.bookings.find((x) => x.id === op.id); if (b) { if ("name" in op) b.name = op.name; if ("amount" in op) b.amount = parseMoney(op.amount); } }
  else if (t === "topf_take" || t === "topf_return") {
    const p = d.toepfe.find((x) => x.id === op.id), v = Math.abs(parseMoney(op.amount)) || 0;
    if (p && v) { p.updated = op.ts || Date.now(); p.amount = Math.round(((Number(p.amount) || 0) + (t === "topf_take" ? -v : v)) * 100) / 100; p.lent = Math.max(0, Math.round(((Number(p.lent) || 0) + (t === "topf_take" ? v : -v)) * 100) / 100); }
  }
  else if (t === "topf_keep") { const p = d.toepfe.find((x) => x.id === op.id); if (p) { p.lent = 0; p.updated = op.ts || Date.now(); } }
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
  else if (t === "settings") d.settings = { ...d.settings, ...op.settings, view: { ...(d.settings.view || {}), ...(op.settings?.view || {}) }, warn_below: "warn_below" in (op.settings || {}) ? parseMoney(op.settings.warn_below) : d.settings.warn_below };
  else if (t === "log_clear") d.log = [];
}

// ---------------------------------------------------------------- 🐷 Maskottchen Sparschwein (wie der Einkaufswagen der Einkaufsliste)
function fkMascotMood(d, now = new Date()) {
  const hr = now.getHours();
  if (hr >= 21 || hr < 6) return "sleep"; // 😴 ab 21 Uhr bis 6 Uhr
  if (hr < 9) return "tired";             // 🥱 morgens gähnen
  const s = d.summary, st = d.settings || {};
  if (s.available < 0) return "shock";    // 😱 im Minus
  if (st.warn_enabled !== false && s.available < (Number(st.warn_below) || 0)) return "worried"; // 😐 knapp
  return "happy";                         // 😄 im Plus
}
function fkEaster(y) { // 🐣 Gauß'sche Osterformel (wie bei der Einkaufsliste)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
function fkMascotDeco(now = new Date()) {
  const m = now.getMonth() + 1, day = now.getDate();
  if ((m === 12 && day === 31) || (m === 1 && day === 1)) return "party";
  if (m === 12 && day <= 26) return "santa";
  const today = new Date(now.getFullYear(), now.getMonth(), day), diff = Math.round((today - fkEaster(now.getFullYear())) / 86400000);
  if (diff >= -3 && diff <= 1) return "bunny"; // 🐰 Gründonnerstag bis Ostermontag
  if ((m === 10 && day >= 17) || (m === 11 && day <= 7)) return "pumpkin"; // 🎃 17.10.–7.11. wie bei der Einkaufsliste
  // 👗 Sonst das Kostüm der Jahreszeit: Frühling = Blume, Sommer = Sonnenbrille, Herbst = Blatt, Winter = Schal
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
}
function fkMascotSvg(mood, deco = "") {
  const k = "currentColor";
  const eye = mood === "sleep" || mood === "tired" ? `<path d="M20.4 11.6q1.3 1 2.6 0" fill="none" stroke="${k}" stroke-width="1.2" stroke-linecap="round"/>`
    : mood === "shock" ? `<circle cx="21.7" cy="11.4" r="1.6" fill="#fff" stroke="${k}" stroke-width=".9"/><circle cx="21.7" cy="11.4" r=".6" fill="${k}"/>`
    : mood === "worried" ? `<circle cx="21.7" cy="11.8" r="1.1" fill="${k}"/><path d="M20.2 9.6l3-.8" stroke="${k}" stroke-width="1" stroke-linecap="round"/>`
    : `<circle cx="21.7" cy="11.6" r="1.2" fill="${k}"/>`;
  const mouth = { happy: `<path d="M24.2 17.6q1.8 1.6 3.6 0" fill="none" stroke="${k}" stroke-width="1.2" stroke-linecap="round"/>`,
    worried: `<path d="M24.4 18.2h3.2" stroke="${k}" stroke-width="1.2" stroke-linecap="round"/>`,
    shock: `<ellipse cx="26" cy="18.4" rx="1.2" ry="1.4" fill="${k}"/>`,
    tired: `<ellipse cx="26" cy="18.4" rx="1.4" ry="1.8" fill="${k}"/>`,
    sleep: `<path d="M24.6 18q1.4.8 2.8 0" fill="none" stroke="${k}" stroke-width="1" stroke-linecap="round"/>` }[mood] || "";
  const extra = mood === "shock" ? `<path d="M17.4 6.4q1.4 2.2 0 3.2q-1.4-1 0-3.2z" fill="#4fc3f7"/>`
    : mood === "sleep" ? `<text x="25" y="7" font-size="5.5" font-weight="700" fill="${k}" opacity=".7">z</text><text x="28.4" y="3.8" font-size="4" font-weight="700" fill="${k}" opacity=".5">z</text>`
    : mood === "happy" ? `<path d="M29.5 3.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="#fdd835"/>` : "";
  const hat = { santa: `<path d="M15.4 6.6q4-7.4 10.6-1.2l-1.8 1.4z" fill="#e53935"/><rect x="14.6" y="5.6" width="11.4" height="2.4" rx="1.2" fill="#fff"/><circle cx="26.4" cy="4.4" r="1.6" fill="#fff"/>`,
    party: `<path d="M17.6 6.8l3-7 3 7z" fill="#ab47bc" stroke="#6a1b9a" stroke-width=".5"/><circle cx="20.6" cy=".4" r="1.2" fill="#fdd835"/>`,
    pumpkin: `<g transform="translate(5 24)"><ellipse cx="0" cy="0" rx="4.6" ry="3.8" fill="#fb8c00" stroke="#e65100" stroke-width=".6"/><path d="M0-3.8q-1.8 3.8 0 7.6M-2.4-3.2q-2 3.2 0 6.4M2.4-3.2q2 3.2 0 6.4" fill="none" stroke="#e65100" stroke-width=".5"/><path d="M0-3.8v-1.6q.8-.8 2-.6" fill="none" stroke="#43a047" stroke-width="1.2" stroke-linecap="round"/></g>`,
    bunny: `<ellipse cx="17.8" cy="1.8" rx="1.6" ry="4.6" transform="rotate(-14 17.8 6)" fill="#f8bbd0" stroke="${k}" stroke-width=".9"/><ellipse cx="21.4" cy="1.6" rx="1.6" ry="4.6" transform="rotate(12 21.4 6)" fill="#f8bbd0" stroke="${k}" stroke-width=".9"/>`,
    spring: `<g transform="translate(24.2 5.2) scale(1.25)"><circle cx="0" cy="-1.5" r="1.2" fill="#f48fb1"/><circle cx="1.5" cy="0" r="1.2" fill="#f48fb1"/><circle cx="0" cy="1.5" r="1.2" fill="#f48fb1"/><circle cx="-1.5" cy="0" r="1.2" fill="#f48fb1"/><circle cx="0" cy="0" r="1" fill="#fdd835"/></g>`,
    summer: `<path d="M18.8 10h6.2v1.4q0 2.6-2.6 2.6h-1q-2.6 0-2.6-2.6z" fill="#263238"/><path d="M18.4 10h7" stroke="#263238" stroke-width=".9" stroke-linecap="round"/><path d="M19.4 11l-4.2-1.4" stroke="#263238" stroke-width="1" stroke-linecap="round"/><path d="M20.2 10.6l1.2 1" stroke="#fff" stroke-width=".6" stroke-linecap="round" opacity=".7"/>`,
    autumn: `<g transform="translate(13.2 4.6) rotate(-18) scale(1.2)"><path d="M0 0q3.2-4.2 6.4.2q-3.2 3.4-6.4-.2z" fill="#ef6c00"/><path d="M.2-.2l4.2-.6" stroke="#8d4a00" stroke-width=".5"/></g>`,
    winter: `<path d="M18.2 18.4q2.6 3 2.2 7.4" fill="none" stroke="#c62828" stroke-width="2.6" stroke-linecap="round"/><path d="M19.6 25.6l-.2 1.6M20.6 25.6l.2 1.6" stroke="#c62828" stroke-width=".6" stroke-linecap="round"/><path d="M17.2 7.4q2.4 8 .6 16.4" fill="none" stroke="#e53935" stroke-width="3.2" stroke-linecap="round"/><path d="M17.2 10.6l2.4-.4M18 14.6l2.4-.2M17.8 18.6l2.4.2" stroke="#fff" stroke-width=".9" stroke-linecap="round"/>` }[deco] || "";
  return `<svg class="mascot ${mood}" viewBox="0 0 34 30" width="32" height="28" style="overflow:visible" aria-hidden="true">
    <path d="M4.6 14.6q-3.2-.6-2.4-3q.8-1.8 2.4-.4" fill="none" stroke="${k}" stroke-width="1.2" stroke-linecap="round"/>
    <rect x="8.4" y="21" width="3.4" height="5.4" rx="1.4" fill="#f8bbd0" stroke="${k}" stroke-width="1.2"/><rect x="20" y="21" width="3.4" height="5.4" rx="1.4" fill="#f8bbd0" stroke="${k}" stroke-width="1.2"/>
    <ellipse cx="16" cy="15.4" rx="11.6" ry="8.6" fill="#f8bbd0" stroke="${k}" stroke-width="1.4"/>
    <path d="M17.6 7.6l1.4-4.4 3.4 3.6" fill="#f48fb1" stroke="${k}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M11.4 8.4h5" stroke="${k}" stroke-width="1.4" stroke-linecap="round"/>
    <ellipse cx="27.6" cy="14.8" rx="3" ry="2.6" fill="#f48fb1" stroke="${k}" stroke-width="1.2"/><circle cx="26.8" cy="14.8" r=".55" fill="${k}"/><circle cx="28.6" cy="14.8" r=".55" fill="${k}"/>
    ${mood === "happy" ? `<circle cx="20.4" cy="15.6" r="1.4" fill="#ec407a" opacity=".45"/>` : ""}
    ${eye}${mouth}${extra}${hat}</svg>`;
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
.topbar .grow { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:center; color:var(--primary-text-color); }
.topbar .ver { opacity:.8; }
.topbar .lbl { display:none; }
.pill { cursor:pointer; border-radius:999px; padding:2px 10px; background:color-mix(in srgb, var(--fk-green) 18%, transparent); color:var(--primary-text-color); white-space:nowrap; border:0; font-size:13px; }
.pill.wait { background:color-mix(in srgb, var(--fk-yellow) 25%, transparent); }
.pill.off { background:color-mix(in srgb, var(--fk-red) 20%, transparent); }
.iconbtn { background:none; border:0; cursor:pointer; padding:6px; border-radius:50%; display:inline-flex; color:var(--secondary-text-color); line-height:0; }
.iconbtn:hover { background:var(--secondary-background-color, rgba(127,127,127,.12)); color:var(--primary-text-color); }
.iconbtn.on { color:var(--pc); }
.iconbtn.awake.on { color:var(--primary-color,#03a9f4); }
/* 🏷️ Kopf in der Karte – wie bei der Einkaufsliste: Symbol + Zähler links, Werkzeuge rechts */
.head { display:flex; align-items:center; gap:4px; margin:0 2px 8px; min-height:36px; }
.title { display:flex; align-items:center; gap:8px; font-size:1.25em; font-weight:600; flex:1; min-width:0; }
.title .logo { cursor:pointer; display:inline-flex; }
.badge { cursor:pointer; background:var(--pc); color:var(--text-primary-color,#fff); border-radius:999px; padding:1px 9px; font-size:.75em; font-weight:600; }
.tabs { display:flex; gap:6px; overflow-x:auto; padding:2px 2px 8px; scrollbar-width:none; }
.tabs::-webkit-scrollbar { display:none; }
.tab { -webkit-user-select:none; user-select:none; flex:0 0 auto; border:1.5px solid color-mix(in srgb, var(--pc) 55%, transparent); background:transparent; border-radius:999px; padding:5px 12px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; font-size:.9em; }
.tab ha-icon { --mdc-icon-size:18px; }
.tab.active { background:var(--pc); border-color:var(--pc); color:var(--text-primary-color,#fff); }
.tip { display:flex; align-items:center; gap:8px; border-radius:12px; padding:9px 12px; margin:2px 2px 8px; background:color-mix(in srgb, var(--fk-yellow) 18%, transparent); font-size:.9em; }
.hero { border-radius:12px; padding:12px 14px; margin:2px 2px 10px; background:color-mix(in srgb, var(--hc, var(--fk-green)) 12%, transparent); }
.hero .lbl { font-size:.85em; color:var(--secondary-text-color); }
.big { font-size:2.4em; font-weight:700; line-height:1.15; color:var(--hc, var(--fk-green)); font-variant-numeric:tabular-nums; cursor:pointer; }
.bar { height:8px; background:color-mix(in srgb, var(--primary-text-color) 10%, transparent); border-radius:5px; overflow:hidden; margin-top:8px; }
.bar i { display:block; height:100%; background:var(--hc, var(--fk-green)); border-radius:5px; }
.tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin:0 2px 10px; }
.tile { background:var(--secondary-background-color, rgba(127,127,127,.06)); border:1px solid var(--divider-color, rgba(127,127,127,.25)); border-radius:16px; padding:10px 12px; text-align:left; min-width:0; color:var(--primary-text-color); }
.tile.click:hover { border-color:var(--pc); }
.tile.click { cursor:pointer; }
.tile b { display:block; font-size:1em; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.tile span { font-size:.75em; color:var(--secondary-text-color); display:flex; align-items:center; gap:3px; }
.tile span ha-icon { --mdc-icon-size:13px; }
.next { display:flex; align-items:center; gap:8px; border-radius:12px; padding:9px 12px; margin:0 2px 6px; background:color-mix(in srgb, var(--fk-yellow) 15%, transparent); font-size:.92em; }
.next ha-icon { color:var(--fk-yellow); }
.ghead { display:flex; align-items:center; gap:6px; font-size:.8em; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--secondary-text-color); padding:12px 4px 2px; }
.ghead .gdot { width:22px; height:22px; flex:none; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:color-mix(in srgb, var(--gc, var(--pc)) 18%, transparent); color:var(--gc, var(--pc)); }
.ghead .gdot ha-icon { --mdc-icon-size:16px; }
.ghead.click { cursor:pointer; border-radius:10px; }
.ghead.click:hover { background:var(--secondary-background-color, rgba(127,127,127,.08)); }
.ghead .chev { display:inline-flex; color:var(--secondary-text-color); }
.ghead.click .n { margin-left:auto; }
.ghead .n { margin-left:auto; font-weight:500; text-transform:none; letter-spacing:0; font-size:.9em; }
/* 🧾 Zeilen wie bei der Einkaufsliste: kompakt, farbiger Streifen links */
.item { display:flex; align-items:center; gap:8px; padding:5px 4px 5px 6px; border-radius:12px; border-left:4px solid var(--cc, transparent); transition:opacity .25s, background .2s; }
.item.click:hover { background:color-mix(in srgb, var(--pc) 6%, transparent); }
.item.click { cursor:pointer; }
.item.opened, .item:has(+ .edit) { background:color-mix(in srgb, var(--pc) 10%, transparent); } /* ✏️ die Zeile bleibt stehen, darunter klappt das Bearbeiten auf (wie in der Einkaufsliste) */
.chk { width:26px; height:26px; flex:none; border-radius:50%; border:2px solid var(--pc); background:none; cursor:pointer; color:#fff; padding:0; display:inline-flex; align-items:center; justify-content:center; }
.chk ha-icon { --mdc-icon-size:17px; }
.chk.on { background:var(--fk-green); border-color:var(--fk-green); }
.item.done .n b { opacity:.6; text-decoration:line-through; }
.n { flex:1; min-width:0; padding:2px 0; }
.n b { font-weight:500; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meta { font-size:.75em; color:var(--secondary-text-color); display:flex; flex-wrap:wrap; gap:3px 6px; margin-top:2px; }
.tag { border-radius:8px; padding:0 6px; background:color-mix(in srgb, var(--primary-text-color, #000) 6%, transparent); white-space:nowrap; }
.tag.wait { background:color-mix(in srgb, var(--fk-yellow) 25%, transparent); color:var(--primary-text-color); }
.amt { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
.neg { color:var(--fk-red); } .pos { color:var(--fk-green); }
.quick { display:flex; flex-wrap:nowrap; gap:6px; margin:4px 2px 6px; overflow-x:auto; scrollbar-width:none; -webkit-overflow-scrolling:touch; padding-bottom:2px; } /* ↔️ volle Leiste = wischen, wie die Reiter der Einkaufsliste */
.quick::-webkit-scrollbar { display:none; }
.chip { flex:0 0 auto; white-space:nowrap; border:1.5px solid var(--divider-color, rgba(127,127,127,.35)); background:transparent; border-radius:999px; padding:7px 14px; cursor:pointer; font-size:.95em; }
.chip.on { background:var(--pc); border-color:var(--pc); color:var(--text-primary-color,#fff); }
.chip[style*="--qc"] { border-color:var(--qc); color:var(--qc); font-weight:500; }
.chip.on[style*="--qc"] { background:var(--qc); border-color:var(--qc); color:#fff; }
.chip ha-icon { --mdc-icon-size:18px; margin:-2px 4px 0 -4px; }
/* ⚡ Schnellknöpfe-Liste wie die Kategorien der Einkaufsliste */
.srow { display:flex; align-items:center; gap:6px; margin:5px 0; }
.srow input.grow { flex:1; min-width:80px; }
.srow input[type=color] { width:42px; height:42px; padding:2px; flex:0 0 auto; cursor:pointer; box-sizing:border-box; }
.storelist { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
.storerow { border:1px solid color-mix(in srgb, var(--primary-text-color, #000) 22%, transparent); border-left:6px solid var(--sc); border-radius:12px; background:var(--card-background-color, var(--ha-card-background, #fff)); padding:2px 4px 2px 6px; margin:0; }
.storerow.drag { box-shadow:0 2px 8px rgba(0,0,0,.25); }
.storepick { flex:1; display:flex; align-items:center; gap:10px; min-width:0; padding:8px 10px; border:0; background:none; color:var(--primary-text-color); font:inherit; text-align:left; cursor:pointer; }
.storepick ha-icon { color:var(--sc); flex:0 0 auto; }
.storepick span { display:flex; flex-direction:column; min-width:0; }
.storepick b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
.storepick small { color:var(--secondary-text-color); font-size:.78em; }
.storehead { display:flex; align-items:center; gap:8px; font-size:1.1em; margin:4px 2px 8px; }
.storehead ha-icon { color:var(--sc); }
.qicons { display:grid; grid-template-columns:repeat(auto-fill, minmax(44px, 1fr)); gap:6px; margin:6px 0 10px; }
.qic { height:44px; border-radius:10px; border:1.5px solid var(--divider-color, rgba(127,127,127,.35)); background:none; color:var(--primary-text-color); cursor:pointer; display:flex; align-items:center; justify-content:center; }
.qic.on { border-color:var(--pc); background:color-mix(in srgb, var(--pc) 15%, transparent); color:var(--pc); }
.amt.click { cursor:pointer; border-radius:8px; padding:2px 4px; margin:-2px -4px; }
.amt.click:hover { background:rgba(127,127,127,.12); }
.tag.mp { color:#fb8c00; border-color:#fb8c00; }
form.add { display:grid; grid-template-columns:1fr 110px 48px; gap:6px; margin:2px 2px 6px; }
form.add.pinf { grid-template-columns:1fr 48px; }
.potbox { padding:8px 10px; }
.pothead { cursor:pointer; margin:0 0 6px; }
.potrow { display:grid; grid-template-columns:1fr auto auto; gap:6px; align-items:center; margin:0 0 6px; }
.potrow.set { grid-template-columns:auto 1fr auto auto; margin:0; }
.potrow.set.mp3 { grid-template-columns:auto 1fr auto auto auto; }
.potrow input.amount { text-align:right; min-width:0; }
.lentbtn { border:0; font:inherit; font-size:.85em; cursor:pointer; display:inline-flex; align-items:center; gap:2px; vertical-align:middle; }
.lentbtn ha-icon { --mdc-icon-size:14px; }
.potlbl { font-size:.85em; color:var(--secondary-text-color); }
.iconbtn.potbtn { border:1.5px solid var(--divider-color, rgba(127,127,127,.35)); padding:7px; }
form.add input.amount { text-align:right; }
.addbtn { border:0; border-radius:12px; background:var(--fk-green); color:#fff; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.addbtn ha-icon { --mdc-icon-size:26px; }
.btn { box-sizing:border-box; min-height:40px; border:1px solid color-mix(in srgb, var(--primary-text-color, #000) 22%, transparent); background:transparent; color:var(--primary-text-color); border-radius:12px; padding:8px 14px; cursor:pointer; font:inherit; font-size:.9em; font-weight:500; display:inline-flex; align-items:center; justify-content:center; gap:6px; transition:background .15s, border-color .15s; }
.btn:hover:not([disabled]) { border-color:var(--pc); background:color-mix(in srgb, var(--pc) 6%, transparent); }
.btn:active:not([disabled]) { transform:scale(.97); }
.btn ha-icon { --mdc-icon-size:18px; }
.btn.main { border:1px solid transparent; background:var(--pc); color:var(--text-primary-color,#fff); }
.btn.main:hover:not([disabled]) { background:color-mix(in srgb, var(--pc) 88%, #000); border-color:transparent; }
.btn.ok { color:var(--fk-green); border-color:color-mix(in srgb, var(--fk-green) 45%, transparent); }
.btn.small { padding:5px 10px; min-height:32px; font-size:.85em; }
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
.stiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(96px, 1fr)); gap:8px; margin:0 0 8px; }
.stile { display:flex; flex-direction:column; gap:2px; padding:10px; border-radius:12px; background:color-mix(in srgb, var(--primary-text-color, #000) 5%, transparent); min-width:0; }
.stile b { font-size:1.05em; overflow-wrap:anywhere; } .stile small { color:var(--secondary-text-color); font-size:.78em; }
.trend { font-weight:700; white-space:nowrap; } .trend.up { color:var(--error-color, #e53935); } .trend.down { color:var(--success-color, #43a047); }
.share { margin:0 2px 6px; } .share b { font-size:1.3em; }
.sharebar { height:10px; border-radius:6px; background:color-mix(in srgb, var(--primary-text-color, #000) 8%, transparent); overflow:hidden; margin:0 2px 6px; } .sharebar i { display:block; height:100%; border-radius:6px; }
.legend { display:flex; gap:12px; font-size:12px; color:var(--secondary-text-color); margin:6px 4px; }
.legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:4px; vertical-align:-1px; }
table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
td, th { padding:6px 4px; border-bottom:1px solid var(--divider-color); text-align:right; font-variant-numeric:tabular-nums; }
td:first-child, th:first-child { text-align:left; }
.hidden-amt { filter:blur(7px); user-select:none; }
.empty { text-align:center; padding:22px 8px; color:var(--secondary-text-color); }
.small { font-size:.82em; color:var(--secondary-text-color); margin:6px 4px; }
/* 📖 Knöpfe UNTER der Karte – wie bei der Einkaufsliste */
.foot { display:flex; justify-content:center; gap:10px; margin:14px 6px 8px; font-size:13px; color:var(--secondary-text-color); }
.foot button { font:inherit; color:inherit; background:none; text-decoration:underline; border:1px solid var(--divider-color, rgba(127,127,127,.3)); border-radius:12px; padding:8px 18px; cursor:pointer; }
.foot button.on { border-color:var(--pc); color:var(--pc); }
.foot button { display:inline-flex; align-items:center; gap:6px; }
.foot button ha-icon { --mdc-icon-size:18px; }
details.gsec { border-radius:12px; margin:6px 2px; background:var(--secondary-background-color, rgba(127,127,127,.08)); }
details.gsec summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:10px; padding:10px 12px; font-weight:600; }
details.gsec summary::-webkit-details-marker { display:none; }
details.gsec .gdot { width:28px; height:28px; flex:none; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; background:color-mix(in srgb, var(--gc) 20%, transparent); color:var(--gc); }
details.gsec .gdot ha-icon { --mdc-icon-size:17px; }
details.gsec .gtext { padding:0 14px 12px 50px; font-size:.92em; line-height:1.5; }
a.btn { text-decoration:none; color:inherit; }
a.btn.paypal { background:#0070ba; border-color:#0070ba; color:#fff; }
/* 🙏 Credits – wie bei der Einkaufsliste */
.elcredits { text-align:center; } .elcredits p { margin:8px 0; }
.ellogo { background:#fff; border-radius:16px; padding:10px; display:inline-block; max-width:100%; box-shadow:0 1px 4px rgba(0,0,0,.12); }
.ellogo img { display:block; max-width:100%; width:200px; height:auto; }
.elcbtns { display:flex; flex-wrap:wrap; gap:8px; justify-content:center; margin:12px 0; }
a.elcbtn { color:var(--primary-text-color); background:var(--secondary-background-color, rgba(127,127,127,.12)); border-radius:12px; padding:10px 14px; text-decoration:none; font-weight:500; }
a.elcbtn.pp { display:inline-flex; align-items:center; gap:8px; background:#0070BA; color:#fff; border:2px solid #003087; font-weight:700; }
.elcbtn.pp svg { width:20px; height:20px; flex:none; }
.elcsmall { opacity:.7; font-size:.9em; }
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

.grip { display:inline-flex; color:var(--secondary-text-color); cursor:grab; touch-action:none; padding:4px 2px; margin:-4px 0; }
.item.drag { background:color-mix(in srgb, var(--pc) 12%, transparent); box-shadow:0 2px 8px rgba(0,0,0,.25); }
.gsub { font-size:.78em; font-weight:600; color:var(--secondary-text-color); text-transform:uppercase; letter-spacing:.04em; padding:8px 6px 2px; }
/* ⚙️ Einstellungen wie bei der Einkaufsliste: ein Kasten pro Zweck, Zeilen mit bunten Symbol-Kästchen */
.sethead { font-weight:600; font-size:1.05em; margin:4px 4px 2px; display:flex; align-items:center; gap:8px; }
.lgbox { margin:10px 0 0; border:1px solid var(--divider-color, rgba(127,127,127,.25)); border-radius:12px; overflow:hidden; }
.lgroup { display:flex; align-items:center; gap:12px; width:100%; margin:0; padding:10px 12px; font:inherit; font-size:1em; color:var(--primary-text-color); background:color-mix(in srgb, var(--primary-text-color, #000) 3%, transparent); border:0; cursor:pointer; text-align:left; }
.lgroup[aria-expanded="true"] { border-bottom:1px solid var(--divider-color, rgba(127,127,127,.25)); }
.lgroup b, .lrow b { display:block; font-weight:600; }
.lrow b { font-weight:500; }
.lgroup small, .lrow small { display:block; color:var(--secondary-text-color); font-size:.8em; font-weight:400; }
.lgroup .gem { width:36px; height:36px; flex:none; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:18px; background:color-mix(in srgb, var(--primary-text-color, #000) 7%, transparent); }
.lgroup .grow, .lrow .grow { flex:1 1 auto; min-width:0; }
.lgroup > ha-icon, .lrow > ha-icon:last-child { flex:none; color:var(--secondary-text-color); }
.lrow { display:flex; align-items:center; gap:12px; width:calc(100% - 4px); margin:0 0 0 4px; text-align:left; padding:10px 12px; cursor:pointer; border:0; border-top:1px solid var(--divider-color, rgba(127,127,127,.25)); background:none; color:var(--primary-text-color); font:inherit; }
.lgroup + .lrow { border-top:0; }
.lrow:hover { background:color-mix(in srgb, var(--pc) 6%, transparent); }
.lrow > ha-icon:last-child { opacity:.5; }
.ic { --ic:#607d8b; width:36px; height:36px; flex:none; border-radius:12px; display:flex; align-items:center; justify-content:center; background:var(--ic); color:#fff; }
.ic ha-icon { --mdc-icon-size:20px; color:#fff; }
.pagebody textarea, .pagebody input[readonly] { width:100%; }
/* ↩️ Rückgängig-Leiste unten in der Mitte – wie bei der Einkaufsliste */
/* ✓ nur ein grüner Haken – was er macht, zeigt langes Drücken (wie bei der Einkaufsliste) */
.iconbtn.okbtn { color:var(--fk-green); border:1.5px solid color-mix(in srgb, var(--fk-green) 45%, transparent); padding:5px; }
.iconbtn.okbtn:hover { background:color-mix(in srgb, var(--fk-green) 12%, transparent); color:var(--fk-green); }
.iconbtn.potbtn.okbtn { padding:7px; }
.finding { border:1px solid var(--divider-color, rgba(127,127,127,.25)); border-left:4px solid var(--fk-yellow); border-radius:12px; padding:8px 10px; margin:6px 0; }
.okmsg { color:var(--fk-green); font-weight:600; }
.btn.danger { color:#fff; background:#c62828; border-color:#c62828; }
.tag.lent, .lenttxt { color:#ef6c00; } .tag.lent { background:color-mix(in srgb, #fb8c00 18%, transparent); }
.undobar { position:fixed; left:50%; bottom:calc(20px + env(safe-area-inset-bottom, 0px)); transform:translateX(-50%); z-index:50; max-width:calc(100vw - 24px); display:flex; align-items:center; gap:12px; padding:8px 8px 8px 16px; border-radius:24px; background:#323232; color:#fff; box-shadow:0 3px 12px rgba(0,0,0,.35); font-size:.92em; }
.undobar .ut { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.undobar .ub { border:0; border-radius:16px; padding:7px 12px; background:#fff; color:#222; font:inherit; font-weight:600; cursor:pointer; white-space:nowrap; }
/* 🔄 Neue Version – wie bei der Einkaufsliste */
.updbar { margin:0 2px 8px; padding:8px 10px; border-radius:12px; background:color-mix(in srgb, var(--primary-color,#03a9f4) 14%, transparent); font-size:.88em; display:flex; align-items:center; gap:8px; }
.updbar b { flex:1; }
/* 🪟 Seiten IN der Karte – wie bei der Einkaufsliste (Symbol + Titel, ← / ✕ oben rechts) */
.sec { margin:4px 2px 16px; }
.sechead { display:flex; align-items:center; gap:12px; margin-bottom:10px; }
.sechead h3 { min-width:0; margin:0; font-size:1em; }
.finfo { flex:none; width:20px; height:20px; padding:0; border-radius:50%; border:1.5px solid var(--primary-color, #03a9f4); background:none; color:var(--primary-color, #03a9f4); font:700 11px/1 serif; font-style:italic; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
.finfo[aria-expanded="true"] { background:var(--primary-color, #03a9f4); color:#fff; }
.fhint { margin:4px 2px 8px; padding:8px 10px; border-radius:10px; background:color-mix(in srgb, var(--primary-color, #03a9f4) 10%, transparent); }
.fhint[hidden] { display:none; }
.pagebody p { line-height:1.4; }
/* 🔢 PIN-Eingabe wie am Handy – wie bei der Einkaufsliste */
.pinpad { text-align:center; max-width:300px; width:100%; margin:0 auto; }
.pinpad .pdots { font-size:28px; letter-spacing:10px; min-height:40px; margin:10px 0 16px; }
.pinpad .ppad { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
.pinpad .ppad .btn { font-size:24px; padding:16px 0; margin:0; width:100%; }
.pinpad .pcancel { margin-top:18px; }
.btn.primary { border:1px solid transparent; background:var(--pc); color:var(--text-primary-color,#fff); }
/* 📖 Anleitung wie bei der Einkaufsliste */
.elg { font:15px/1.5 Roboto, sans-serif; }
.elg h2 { font-size:20px; margin:6px 0 4px; }
.elg .elg-sub { color:var(--secondary-text-color); margin:0 0 12px; font-size:14px; }
.elg-q { width:100%; margin:0 0 10px; font-size:16px; padding:10px 12px; }
.elg-none { color:var(--secondary-text-color); margin:8px 2px; }
.elg-sec { border:1px solid var(--divider-color, rgba(127,127,127,.3)); border-radius:12px; margin:10px 0 0; overflow:hidden; }
.elg-sec[hidden] { display:none; }
.elg-sec summary { cursor:pointer; padding:10px 12px; font-weight:600; font-size:16px; list-style:none; display:flex; align-items:center; gap:12px; background:color-mix(in srgb, var(--primary-text-color, #000) 3%, transparent); }
.elg-sec summary::-webkit-details-marker { display:none; }
.elg-sec summary::after { content:""; flex:none; width:8px; height:8px; margin:0 6px 4px auto; border-right:2px solid var(--secondary-text-color); border-bottom:2px solid var(--secondary-text-color); transform:rotate(45deg); transition:transform .2s; }
.elg-sec[open] summary::after { transform:rotate(225deg); margin-bottom:-4px; }
.elg-sec[open] summary { border-bottom:1px solid var(--divider-color, rgba(127,127,127,.3)); }
.elg-ic { flex:none; width:36px; height:36px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:18px; background:color-mix(in srgb, var(--primary-text-color, #000) 7%, transparent); }
.elg-tt { flex:1; min-width:0; } .elg-tt b { display:block; } .elg-tt small { display:block; font-weight:400; font-size:12.5px; color:var(--secondary-text-color); }
.elg-sec > div { padding:8px 12px 12px; }
.elg-sec ul { margin:4px 0; padding-left:20px; } .elg-sec li { margin:4px 0; }
.betabox { border:1px solid #fb8c00; border-radius:12px; padding:10px 12px; margin:0 0 12px; background:rgba(251,140,0,.1); }
ol.steps { padding-left:22px; }
ol.steps li { margin:3px 0; }
/* 🔤 Beschriftungen unter Symbol-Knöpfen (⚙️ → Ansicht) */
.iconbtn .lbl { font-size:10px; line-height:1.1; font-weight:500; }
:host(.labels) .iconbtn:has(.lbl) { flex-direction:column; align-items:center; gap:2px; border-radius:10px; padding:4px 5px; }
:host(.labels) .topbar .lbl { display:inline; }
:host(.labels) .topbar .iconbtn { flex-direction:column; align-items:center; gap:2px; border-radius:10px; }
/* 🧘 Ruhiger Modus (nur dieses Gerät) */
:host(.calm) *, :host(.calm) *::before, :host(.calm) *::after { animation:none !important; transition:none !important; }
:host(.calm) .gdot, :host(.calm) .ic, :host(.calm) .gem, :host(.calm) .hero, :host(.calm) .badge, :host(.calm) .mascot { filter:saturate(.35); }
/* 🐷 Maskottchen */
.mascotbox { color:var(--primary-text-color); }
.mascot.happy { animation:fkwob 2.6s ease-in-out infinite; transform-origin:50% 90%; }
.mascotbox.hop .mascot { animation:fkhop .7s ease-out 2; }
@keyframes fkwob { 0%,100% { transform:rotate(0); } 25% { transform:rotate(-4deg); } 75% { transform:rotate(4deg); } }
@keyframes fkhop { 0%,100% { transform:translateY(0); } 40% { transform:translateY(-7px); } }
@media (prefers-reduced-motion: reduce) { .mascot, .mascotbox .mascot { animation:none !important; } }
.mascotprev { display:flex; flex-wrap:wrap; gap:14px; margin:10px 0; color:var(--primary-text-color); }
.mascotprev > span { display:flex; flex-direction:column; align-items:center; gap:2px; }
.mascotprev svg { width:44px; height:39px; }
.mascotprev small { font-size:11px; color:var(--secondary-text-color); }
.mascotprev > span.now { outline:2px solid #ec407a; outline-offset:3px; border-radius:10px; }
/* 📜 Verlauf */
.logday { margin:12px 0 4px; font-size:.8em; font-weight:600; color:var(--secondary-text-color); text-transform:uppercase; letter-spacing:.03em; }
.logrow { display:flex; align-items:baseline; gap:8px; padding:4px 2px; border-bottom:1px solid var(--divider-color, rgba(127,127,127,.15)); font-size:.9em; }
.logrow .lt { flex:none; width:42px; color:var(--secondary-text-color); font-variant-numeric:tabular-nums; }
.logrow .lx { flex:1; min-width:0; }
.switch .vt { display:flex; flex-direction:column; } .switch .vt small { color:var(--secondary-text-color); font-size:.82em; }
/* 🙈 verschleierte Beträge: PC = Maus drüber, Handy = antippen (4 Sekunden) */
.veil { filter:blur(6px); cursor:pointer; user-select:none; -webkit-user-select:none; transition:filter .2s; }
.veil.peek { filter:none; }
@media (hover:hover) { .veil:hover { filter:none; } }
`;

class FixkostenCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._view = "home";
    this._open = null;          // welcher Eintrag gerade bearbeitet wird
    this._quickName = null;     // gewählter Schnellknopf
    this._qk = QKEY; this._dk = DKEY; // 📚 je Buch eigener Postausgang + eigener gemerkter Stand
    this._queue = store.get(this._qk, []);
    this._server = null;        // letzter Stand von Home Assistant
    this._hidden = store.get(HKEY, null);
    this._openSec = new Set(); // 📂 nichts merken (Marco): beim Öffnen immer Standard – Ausgaben offen, Rest zu
    try { localStorage.removeItem(OKEY); } catch (_) { /* alter Merkzettel weg */ }
    this._sheet = null;         // welche Einstellungs-Seite offen ist
    this._pad = null;           // 🔢 PIN-Zahlenfeld (entsperren, PIN ändern …)
    // 👆 Knöpfe nur mit Symbol: lange drücken zeigt kurz, was sie machen (wie bei der Einkaufsliste) – der Druck löst dann nichts aus
    const root = this.shadowRoot;
    let lpTimer = null, lpFired = false;
    const lpBtn = (t) => { const b = t?.closest?.("button"); return b && !(b.innerText || "").trim() && (b.getAttribute("title") || b.getAttribute("aria-label")) ? b : null; };
    root.addEventListener("pointerdown", (e) => {
      const b = lpBtn(e.target);
      clearTimeout(lpTimer); lpFired = false;
      if (!b) return;
      const text = b.getAttribute("title") || b.getAttribute("aria-label");
      lpTimer = setTimeout(() => { lpFired = true; try { navigator.vibrate?.(20); } catch (_) { /* egal */ } this._toast(text); }, 550);
    }, true);
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) root.addEventListener(ev, () => clearTimeout(lpTimer), true);
    root.addEventListener("click", (e) => { if (lpFired) { lpFired = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    root.addEventListener("contextmenu", (e) => { if (lpBtn(e.target)) e.preventDefault(); }, true);
    // ⌨️ Am PC: Ziffern, ⌫, Enter und Esc gehen auch auf dem PIN-Zahlenfeld
    this._onKey = (e) => {
      if (!this._padShown || !this.isConnected || !this._pad) return;
      if (/^\d$/.test(e.key)) this._padPress(e.key);
      else if (e.key === "Backspace") this._padPress("⌫");
      else if (e.key === "Enter" || e.code === "NumpadEnter") this._padPress("✔");
      else if (e.key === "Escape") this.shadowRoot.querySelector('[data-a="back"]')?.click();
      else return;
      e.preventDefault(); e.stopPropagation();
    };
  }

  static getStubConfig() { return { title: "Fixkosten" }; }
  getCardSize() { return 8; }
  static getConfigElement() { return document.createElement("fixkosten-card-editor"); }
  setConfig(config) {
    this._config = { title: "Fixkosten", ...config };
    // 📚 Welches Buch? (leer = erstes Buch). Jedes Buch hat im Handy seinen eigenen Postausgang.
    const book = String(this._config.buch || "").trim();
    if (book !== (this._book ?? "")) {
      const changed = this._book !== undefined;
      this._book = book;
      const sfx = book ? "_" + book.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "_") : "";
      this._qk = QKEY + sfx; this._dk = DKEY + sfx;
      this._queue = store.get(this._qk, []);
      if (changed) { this._unsub?.then((u) => u?.()).catch(() => {}); this._unsub = null; this._server = null; if (this._hass) { this._subscribe(); this._render(); } }
    }
    if (this._hidden == null) this._hidden = !!this._config.privat; // 🙈 Beträge erst nach Antippen zeigen
    if (this._hass) { const before = FK_LANG; this._useLang(); if (before !== FK_LANG) { this._force = true; this._render(); } }
  }
  // 🌍 Sprache: „language:“ in der Karte (de/en) oder die Sprache von Home Assistant
  _useLang() {
    const lang = fkWantLang(this._hass, this._config);
    if (lang !== FK_LANG) { FK_LANG = lang; for (const c of FK_CARDS) if (c !== this) { c._force = true; c._render(); } }
    if (FK_LANG !== "de") fkLoadDict();
  }

  get _app() { return !!window.__fkOfflineApp; }
  _bk() { return this._book ? { book: this._book } : {}; } // 📚 an jede Anfrage: welches Buch

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this._useLang(); // 🌍
    if (first) {
      if (this._app) this._server = store.get(this._dk, null); // 📱 letzter Stand – auch ohne Netz
      this._subscribe();
      this._render();
    }
    if (hass.connected !== false) this._flush();
  }

  connectedCallback() { if (this._hass && !this._unsub) this._subscribe(); document.addEventListener("keydown", this._onKey, true); }
  disconnectedCallback() { this._awakeStop(); this._unsub?.then((u) => u?.()).catch(() => {}); this._unsub = null; document.removeEventListener("keydown", this._onKey, true); }

  _subscribe() {
    if (this._unsub || !this._hass?.connection) return;
    this._unsub = this._hass.connection.subscribeMessage((data) => {
      this._server = data;
      if (this._app) store.put(this._dk, data);
      this._render();
    }, { type: "fixkosten/subscribe", ...this._bk() }).catch((err) => { this._err = err?.message || String(err); this._unsub = null; this._render(); });
  }

  // Der Stand, den man sieht = Stand von HA + alles, was noch im Postausgang liegt
  get _data() {
    if (!this._server) return null;
    const d = JSON.parse(JSON.stringify(this._server));
    for (const k of ["groups", "posten", "einnahmen", "toepfe", "staende", "konten", "bookings", "history"]) d[k] = d[k] || [];
    d.paid = d.paid || {}; d.received = d.received || {}; d.konto = d.konto || {}; d.settings = d.settings || {}; d.log = d.log || [];
    for (const op of this._queue) applyLocal(d, op);
    d.summary = summary(d);
    return d;
  }

  // ---------------------------------------------------------------- 📮 Änderungen verschicken (mit Postausgang)
  _send(op) {
    op = { op_id: uid(), ts: Date.now(), ...op };
    this._queue.push(op);
    store.put(this._qk, this._queue);
    this._render();
    this._flush();
  }
  async _flush() {
    if (this._flushing || !this._queue.length || !this._hass) return;
    this._flushing = true;
    try {
      const batch = this._queue.slice(0, 100);
      const res = await this._hass.callWS({ type: "fixkosten/apply", ops: batch, ...this._bk() });
      const done = new Set(batch.map((o) => o.op_id));
      const failed = (res?.results || []).filter((r) => !r.ok);
      this._queue = this._queue.filter((o) => !done.has(o.op_id));
      store.put(this._qk, this._queue);
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
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message: fkT(message) }, bubbles: true, composed: true }));
  }

  // ---------------------------------------------------------------- 🖼️ Zeichnen (Optik wie die Einkaufsliste)
  _m(v, cls = "") { return `<span class="${cls} ${this._hidden ? "hidden-amt" : ""}">${money(v)}</span>`; }
  // 🙈 Verschleierter Betrag (Einnahmen, Töpfe, Komplett): PC = Maus drüber, Handy = antippen → 4 Sekunden sichtbar
  _mv(v, key, cls = "") {
    if (this._hidden || this._data?.settings?.veil === false) return this._m(v, cls);
    const on = this._peek?.key === key && this._peek.until > Date.now();
    return `<span class="${cls} veil ${on ? "peek" : ""}" data-a="peek" data-v="${esc(key)}" title="Antippen = 4 Sekunden zeigen">${money(v)}</span>`;
  }
  // 📂 Abschnitt zum Auf- und Zuklappen (Standard: zu)
  _ghc(key, icon, color, title, right = "") {
    const open = this._openSec.has(key);
    return `<div class="ghead click" data-a="sec" data-v="${esc(key)}"><span class="gdot" style="--gc:${color}">${ic(icon)}</span><span>${title}</span><span class="n">${right}</span><span class="chev">${ic(open ? "chevron-up" : "chevron-down")}</span></div>`;
  }
  _gh(icon, color, title, right = "") {
    return `<div class="ghead"><span class="gdot" style="--gc:${color}">${ic(icon)}</span><span>${title}</span><span class="n">${right}</span></div>`;
  }
  _inHaApp() { return !!this._hass?.auth?.external && !this._app; }
  _awakeHint() { return this._inHaApp() ? "💡 Bildschirm bleibt nur an mit: HA-App → Einstellungen → Companion App → „Keep screen On“ einschalten" : "💡 Der Bildschirm kann hier nicht angehalten werden – bitte in den Handy-Einstellungen die Bildschirmzeit erhöhen"; }
  _awakeStop() { this._awakeOn = false; if (this._awakeVis) document.removeEventListener("visibilitychange", this._awakeVis); this._awakeVis = null; try { this._awakeH?.stop(); } catch (_) { /* egal */ } this._awakeH = null; }
  _lb(t) { return this._labels ? `<span class="lbl">${esc(t)}</span>` : ""; } // 🔤 Beschriftung unter einem Symbol-Knopf
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
    fkSetMoney(d?.settings?.currency, FK_LANG); // 💱
    this._labels = !!d?.settings?.labels; // 🔤 Text unter den Symbol-Knöpfen (für alle)
    this.classList.toggle("labels", this._labels);
    this.classList.toggle("calm", !!store.get(CALMKEY, false)); // 🧘 Ruhiger Modus (nur dieses Gerät)
    const online = this._hass?.connected !== false;
    const q = this._queue.length;
    const pill = q ? `<button class="pill wait" data-a="tab" data-v="home">⏳ ${q} ${q === 1 ? "wartet" : "warten"}</button>`
      : online ? `<button class="pill" data-a="tab" data-v="home">🟢 verbunden</button>`
      : `<button class="pill off" data-a="tab" data-v="home">${this._app ? "📴 offline – letzter Stand" : "🔴 keine Verbindung"}</button>`;
    // 🟢 Leiste ÜBER der Karte (mit ⚙️ wie bei der Einkaufsliste) und Knöpfe UNTER der Karte
    const top = `<div class="topbar">${pill}<span class="grow">${this._greet()}</span>${d ? `<button class="iconbtn ${this._view === "set" ? "on" : ""}" data-a="tab" data-v="set" title="Einstellungen">${ic("cog-outline")}<span class="lbl">Einstellungen</span></button>` : ""}<span class="ver" translate="no">v${FK_VERSION}</span></div>`;
    const lockAll = !!(d && d.pin && d.settings?.lock_all && !(this._app && window.__fkAppLock?.on?.())); // in der Offline-App mit Fingerabdruck reicht der Fingerabdruck // 🔒 ganze Karte gesperrt (Schalter in ⚙️ → Schutz)
    const locked = !!(d && d.pin && !pinOpen() && (lockAll || this._view === "edit" || this._view === "set"));
    this._lockAll = lockAll && locked;
    if (lockAll && !locked) { clearTimeout(this._relockT); this._relockT = setTimeout(() => { this._force = true; this._render(); }, Math.max(1000, PIN_LOCK.until - Date.now() + 500)); } // ⏳ nach 10 Min. Ruhe wieder zu
    if (locked && this._pad?.step !== "unlock") this._pad = { purpose: "unlock", step: "unlock", buf: "", back: "home" };
    if (!locked && this._pad?.step === "unlock") this._pad = null;
    const page = !d ? null : this._pad ? this._padPage(d) : this._view === "guide" ? { icon: "book-open-variant", color: "#3949ab", title: "Anleitung", html: this._guideView() }
      : this._view === "konto" ? this._kontoPage(d) : this._view === "set" && this._sheet ? this._sheetPage(d) : null;
    this._padShown = !!(d && this._pad);
    if (this._view !== "set") this._setOpen = null; // 🗂️ wie bei der Einkaufsliste: wer die Einstellungen verlässt, findet beim nächsten Mal alles zugeklappt
    // ✕ / ← oben rechts wie bei der Einkaufsliste: ✕ = zurück zur Übersicht, ← = eine Stufe zurück
    const deeper = !!(this._pad ? this._pad.back === "sheet" : this._view === "set" && this._sheet);
    const showBack = !!(d && !this._lockAll && (this._view === "set" || this._view === "guide" || this._view === "konto" || this._pad));
    const appLock = this._app && !!window.__fkAppLock?.on?.();
    const isLocked = d?.pin && !pinOpen();
    if (this._lockAll) this._calc = null; // 🔒 gesperrt: kein Rechner (der kennt „Verfügbar“)
    const inSet = this._view === "set"; // ⚙️ in den Einstellungen braucht man weder Rechner noch Auge (wie bei der Einkaufsliste)
    if (inSet) this._calc = null;
    const tools = this._lockAll ? "" : `${inSet ? "" : `<button class="iconbtn ${this._calc ? "on" : ""}" data-a="calc" title="Taschenrechner">${ic("calculator-variant-outline")}${this._lb("Rechner")}</button>
      <button class="iconbtn ${this._hidden ? "on" : ""}" data-a="hide" title="Beträge ${this._hidden ? "zeigen" : "verstecken"}">${ic(this._hidden ? "eye-off-outline" : "eye-outline")}${this._lb(this._hidden ? "Zeigen" : "Verstecken")}</button>
      <button class="iconbtn awake ${this._awakeOn ? "on" : ""}" data-a="awake" title="${this._awakeOn ? "Bildschirm immer an – antippen zum Ausschalten" : "Bildschirm immer an (antippen)"}" aria-label="Bildschirm immer an">${ic(this._awakeOn ? "lightbulb-on" : "lightbulb-outline")}${this._lb("Bildschirm")}</button>`}
      <button class="iconbtn" data-a="lock" title="${appLock ? "App jetzt sperren" : isLocked ? "Gesperrt – PIN nötig für ⚙️ und Bearbeiten" : "Jetzt sperren"}">${ic(isLocked && !appLock ? "lock-outline" : "lock-open-variant-outline")}${this._lb(isLocked && !appLock ? "Gesperrt" : "Sperren")}</button>
      ${showBack ? `<button class="iconbtn" data-a="back" title="${deeper ? "Zurück" : "Schließen"}">${ic(deeper ? "arrow-left" : "close")}${this._lb(deeper ? "Zurück" : "Schließen")}</button>` : ""}`;
    let body;
    if (!d) {
      body = this._err ? `<div class="empty">⚠️ ${esc(this._err)}<br>Ist die Integration „Fixkosten“ eingerichtet?</div>` : `<div class="empty">⏳ Lade …</div>`;
    } else {
      const openFix = d.summary.groups.reduce((n, g) => n + g.count - g.done, 0), openBk = d.bookings.filter((b) => !b.cleared).length;
      const open = openFix + openBk; // 🔵 offene Fixkosten + Ausgaben, die noch nicht abgebucht sind
      const tabs = [["home", "view-dashboard-outline", "Übersicht"], ["stat", "chart-bar", "Statistik"], ["edit", "pencil-outline", "Bearbeiten"]]; // 📊 Statistik als eigener Reiter (der Rückblick steht zusätzlich in ⚙️ → Daten)
      // 🐷 Maskottchen statt Geldbörse (Schalter in ⚙️ → Ansicht) – hüpft einmal, wenn die letzte Fixkosten abgehakt wird
      const hop = this._prevOpenFix > 0 && openFix === 0 && d.posten.length > 0;
      this._prevOpenFix = openFix;
      const logo = d.settings.mascot ? `<span class="logo mascotbox ${hop ? "hop" : ""}" data-a="tab" data-v="home" title="Zurück zur Übersicht">${fkMascotSvg(fkMascotMood(d), fkMascotDeco())}</span>`
        : `<span class="logo" data-a="tab" data-v="home" title="Zurück zur Übersicht">${ic("wallet-outline")}</span>`;
      body = `<div class="head"><div class="title">${logo}${open && !this._lockAll ? `<span class="badge" data-a="tab" data-v="home" title="noch offen: ${openFix} Fixkosten, ${openBk} Ausgaben">${open}</span>` : ""}</div>${tools}</div>`;
      body += this._updHtml(d);
      if (!page && this._view !== "set") body += `<div class="tabs">${tabs.map(([k, i, l]) => `<button class="tab ${this._view === k ? "active" : ""}" data-a="tab" data-v="${k}">${ic(i)}${l}</button>`).join("")}</div>`;
      if (this._calc) body += this._calcView(d);
      if (!locked) pinTouch();
      body += page ? `<div class="sec pagehost"><div class="sechead"><span class="ic" style="--ic:${page.color}">${ic(page.icon)}</span><h3>${page.title}</h3></div><div class="pagebody">${page.html}</div></div>`
        : this._view === "edit" ? this._editView(d) : this._view === "stat" ? this._statView(d) : this._view === "set" ? this._setView(d) : this._homeView(d);
    }
    this.shadowRoot.innerHTML = `<style>${CSS}</style>${top}<ha-card>${body}</ha-card>
      <div class="foot"><button class="${this._view === "guide" ? "on" : ""}" data-a="tab" data-v="${this._view === "guide" ? "home" : "guide"}">${ic("book-open-page-variant-outline")}<span>Anleitung</span></button></div>
      ${this._undo ? `<div class="undobar" role="status"><span class="ut">${esc(this._undo.label)}</span><button class="ub" data-a="undo">↩️ Rückgängig</button></div>` : ""}`;
    if (FK_LANG !== "de" && FK_DICT) { // 🌍 erst übersetzen, dann Emojis zu Symbolen machen
      try { fkCollectUser(this._data); if (this._config?.title && this._config.title !== "Fixkosten") FK_USER.add(fkNorm(this._config.title)); fkTranslateTree(this.shadowRoot); } catch (_) { /* dann eben Deutsch */ }
    }
    try { this._helpify(); } catch (_) { /* ⓘ ist nur Komfort */ }
    if (!window.__fkNoIcons) try { fkIconizeTree(this.shadowRoot); } catch (_) { /* Symbole sind nur Deko */ } // (__fkNoIcons nur für den Text-Sammler der Tests)
    this._bind();
    FK_CARDS.add(this);
    try { window.dispatchEvent(new CustomEvent("fixkosten-nav")); } catch (_) { /* egal */ }
  }

  // ↩️ Zurück-Taste am Handy: ist die Karte gerade auf ihrer Startseite? Sonst geht „Zurück“ einen Schritt zurück.
  fixkostenIsRoot() { return !this._pad && !this._open && !["set", "guide", "konto"].includes(this._view); }
  fixkostenBack() {
    if (this.fixkostenIsRoot()) return false;
    if (this._pad?.step === "unlock") { this._pad = null; this._view = "home"; this._sheet = null; }
    else if (this._pad) { const back = this._pad.back; this._pad = null; if (back !== "sheet") { this._view = "home"; this._sheet = null; } }
    else if (this._open) this._open = null;
    else if (this._view === "set" && this._sheet === "quick" && this._qSel != null) this._qSel = null;
    else if (this._view === "set" && this._sheet) this._sheet = null;
    else { this._view = "home"; this._sheet = null; }
    this._force = true; this._render();
    return true;
  }

  // 🔄 Neue Version da? (Home Assistant hat eine andere Version als die geladene Karte) – wie bei der Einkaufsliste
  _updHtml(d) {
    const server = d.version;
    if (!server || server === FK_VERSION) return "";
    return fkVerCmp(server, FK_VERSION) > 0
      ? `<div class="updbar">🔄 <b>Neue Version ${esc(server)} ist da (hier läuft noch ${FK_VERSION}).</b><button class="btn small" data-a="reload">Neu laden</button></div>`
      : `<div class="updbar">🔄 <b>Die Karte ist schon ${FK_VERSION}, Home Assistant noch ${esc(server)} – bitte Home Assistant neu starten.</b></div>`;
  }

  // 🧮 Taschenrechner (rechnet selbst – kein eval)
  _calcView(d) {
    const c = this._calc;
    const res = calcEval(c.expr);
    const keys = [["C", "cl"], ["⌫", "cl"], ["%", "op"], ["÷", "op"], ["7"], ["8"], ["9"], ["×", "op"], ["4"], ["5"], ["6"], ["−", "op"], ["1"], ["2"], ["3"], ["+", "op"], ["V", "op"], ["0"], [","], ["=", "eq"]];
    return `<div class="calc"><div class="disp"><div class="expr">${esc(c.expr || " ")}</div><div class="res">${res == null ? "–" : money(res)}</div></div>
      <div class="keys">${keys.map(([k, cl]) => `<button class="${cl || ""}" data-a="ckey" data-v="${k}" title="${k === "V" ? "Verfügbar einsetzen" : ""}">${k}</button>`).join("")}</div>
      <div class="btnrow"><button class="btn small" data-a="cuse" data-v="pay" ${res == null ? "disabled" : ""}>${ic("credit-card-outline")}Als Ausgabe</button>
      <button class="btn small" data-a="cuse" data-v="balance" ${res == null ? "disabled" : ""}>${ic("bank-outline")}Als Kontostand</button>
      <button class="btn small" data-a="cuse" data-v="copy" ${res == null ? "disabled" : ""}>${ic("content-copy")}Kopieren</button></div></div>`;
  }

  _homeView(d) {
    const s = d.summary;
    const hc = s.available < 0 ? "var(--fk-red)" : "var(--fk-green)"; // 🟢 im Plus immer grün, 🔴 nur im Minus (die Warngrenze steuert nur den Warn-Sensor)
    const pct = s.balance > 0 ? Math.max(0, Math.min(100, (s.available / Math.max(s.balance, 1)) * 100)) : 0;
    const quick = d.settings.quick || [];
    const openBookings = d.bookings.filter((b) => !b.cleared).sort((a, b) => b.ts - a.ts);
    const upd = s.balance_updated ? new Date(s.balance_updated).toLocaleDateString(fkLoc(), { day: "2-digit", month: "2-digit" }) : "nie";
    let h = `<div class="hero" style="--hc:${hc}"><div class="lbl">Verfügbar${d.book && !d.book.primary ? ` · ${esc(d.book.title)}` : ""} · ${esc(this._monthName(d.month))}</div>
      <div class="big" data-a="hide">${this._m(s.available)}</div><div class="bar"><i style="width:${pct.toFixed(0)}%"></i></div></div>
      <div class="tiles">
        <button class="tile click" data-a="balance"><span>${ic("bank-outline")}Konto ${upd}</span><b>${this._m(s.balance)}</b></button>
        <div class="tile"><span>${ic("calendar-clock")}Fixkosten offen</span><b>${this._m(-s.fix_open, "neg")}</b></div>
        <div class="tile"><span>${ic("credit-card-outline")}Ausgaben offen</span><b>${this._m(-s.bookings_open, "neg")}</b></div>
      </div>`;
    const v = d.settings.view || {}, show = (k) => v[k] !== false; // 👁️ Ansicht für alle (der Hinweis „Nächste Abbuchung“ oben ist weg – Marco: der Tag steht am Posten)

    // 💳 Ausgaben
    if (show("ausgaben")) {
    const bOpen = !this._openSec.has("ausgaben_zu"); // 💳 Standard offen – zugeklappt verschwindet nur die Liste, Schnellknöpfe + Eingabe bleiben
    h += `<div class="ghead click" data-a="sec" data-v="ausgaben_zu"><span class="gdot" style="--gc:#ff9800">${ic("credit-card-outline")}</span><span>Ausgaben</span><span class="n">noch nicht abgebucht · ${this._m(-s.bookings_open)}${!bOpen && openBookings.length ? ` · ${openBookings.length}` : ""}</span><span class="chev">${ic(bOpen ? "chevron-up" : "chevron-down")}</span></div>`;
    h += `<div class="quick">${quick.map((q) => `<button class="chip ${this._quickName === q ? "on" : ""}" style="--qc:${qcolOf(d, q)}" data-a="quick" data-v="${esc(q)}">${qiconOf(d, q) ? `<ha-icon icon="${esc(qiconOf(d, q))}"></ha-icon>` : ""}${esc(q)}</button>`).join("")}</div>
      <form class="add" data-a="booking"><input name="name" placeholder="Wofür? z. B. Bäckerei" value="${esc(this._quickName || "")}" autocomplete="off">
      <input name="amount" class="amount" placeholder="${money(0)}" inputmode="decimal" autocomplete="off" value="${esc(this._prefAmount || "")}"><button class="addbtn" type="submit" title="Eintragen">${ic("plus")}</button></form>`;
    if (bOpen) h += openBookings.length ? openBookings.map((b) => (`<div class="item click" style="--cc:${qcol(d, b.name) || "#ff9800"}" data-a="open" data-k="booking" data-id="${esc(b.id)}" title="Antippen = ändern"><button class="chk" data-a="clear" data-id="${esc(b.id)}" title="Antippen, wenn es auf dem Konto abgebucht ist" aria-label="abgebucht"></button><div class="n"><b>${esc(b.name)}</b><div class="meta"><span class="tag">${new Date(b.ts).toLocaleDateString(fkLoc(), { weekday: "short", day: "2-digit", month: "2-digit" })}</span>${b.by ? `<span class="tag">${esc(b.by)}</span>` : ""}${this._queue.some((o) => o.op_id === b.id) ? `<span class="tag wait">⏳ wartet</span>` : ""}</div></div>
      <div class="amt">${this._m(-b.amount, "neg")}</div>
      <button class="iconbtn" data-a="bdel" data-id="${esc(b.id)}" title="Löschen">${ic("close")}${this._lb("löschen")}</button></div>` + (this._open?.kind === "booking" && this._open.id === b.id ? this._bookingForm(b) : ""))).join("") : `<div class="empty">Nichts offen 🎉</div>`;
    }

    // 📋 Fixkosten nach Gruppen
    // ⏸️ Pausierte stehen mit drin, gelten aber als abgehakt (zählen nicht mit)
    const shown = (p) => p.active === false || countsThisMonth(d, p);
    if (show("fixkosten")) {
    for (const g of s.groups) {
      const items = d.posten.filter((p) => p.group === g.id && shown(p));
      if (!items.length) continue;
      const k = "g:" + g.id, sumOpen = items.filter((p) => countsThisMonth(d, p) && !d.paid[p.id]?.paid).reduce((x, p) => x + pamt(d, p), 0);
      h += this._ghc(k, "calendar-month-outline", gcol(d, g.id), esc(g.name), `${g.done} / ${g.count}${sumOpen ? ` · ${this._m(-sumOpen, "neg")}` : " ✅"}`);
      if (this._openSec.has(k)) h += items.map((p) => this._postenRow(d, p)).join("");
    }
    const loose = d.posten.filter((p) => !d.groups.some((g) => g.id === p.group) && shown(p));
    if (loose.length) h += this._ghc("g:-", "calendar-month-outline", "#9e9e9e", "Ohne Gruppe", String(loose.length)) + (this._openSec.has("g:-") ? loose.map((p) => this._postenRow(d, p)).join("") : "");
    if (!d.posten.length) h += `<div class="empty">Noch keine Fixkosten. Unter „Bearbeiten“ anlegen oder unter ⚙️ eine CSV-Datei einlesen.</div>`;
    }

    // 💰 Einnahmen (nur Info)
    if (d.einnahmen.length && show("einnahmen")) {
      h += this._ghc("einnahmen", "cash-plus", "var(--fk-green)", "Einnahmen (Info)", this._mv(s.income_total, "inc", "pos"));
      if (this._openSec.has("einnahmen")) h += d.einnahmen.filter((e) => countsThisMonth(d, e)).map((e) => { const on = !!d.received?.[e.id]?.paid; return `<div class="item ${on ? "done" : ""}" style="--cc:var(--fk-green)"><button class="chk ${on ? "on" : ""}" data-a="recv" data-id="${esc(e.id)}" aria-label="ist gebucht" title="${on ? "Ist gebucht ✓ – antippen = doch nicht" : "Antippen, wenn es auf dem Konto ist"}">${on ? ic("check") : ""}</button><div class="n"><b>${esc(e.name)}</b>${e.date ? `<div class="meta"><span class="tag">${esc(e.date)}</span></div>` : ""}</div><div class="amt">${this._m(e.amount, "pos")}</div></div>`; }).join("");
    }
    // 🧾 Offene Stände
    if (d.staende.length && show("staende")) {
      h += this._gh("file-document-alert-outline", "var(--fk-red)", "Offene Stände", `${d.settings.debts_subtract ? "abgezogen · " : ""}${this._m(-s.debts, "neg")}`);
      h += d.staende.map((x) => `<div class="item" style="--cc:var(--fk-red)"><div class="n"><b>${esc(x.name)}</b>${x.note ? `<div class="meta"><span class="tag">${esc(x.note)}</span></div>` : ""}</div><div class="amt">${this._m(-x.amount, "neg")}</div>
        <button class="iconbtn okbtn" data-a="settle" data-id="${esc(x.id)}" title="✓ Ist beglichen" aria-label="beglichen">${ic("check-bold")}${this._lb("beglichen")}</button></div>`).join("");
    }
    // 🐷 Töpfe
    if (d.toepfe.length && show("toepfe")) {
      h += this._ghc("toepfe", "piggy-bank-outline", "#e91e63", "Töpfe", this._mv(s.pots_total, "pots"));
      if (this._openSec.has("toepfe")) h += d.toepfe.map((t) => (`<div class="item click" style="--cc:#e91e63" data-a="open" data-k="pot" data-id="${esc(t.id)}" title="Antippen = rausnehmen, zurücklegen oder Stand ändern"><div class="n"><b>${esc(t.name)}</b>${t.lent > 0 || t.updated ? `<div class="meta">${t.updated ? `<span class="tag" title="zuletzt geändert">${new Date(t.updated).toLocaleDateString(fkLoc(), { weekday: "short", day: "2-digit", month: "2-digit" })}</span>` : ""}${t.lent > 0 ? `<span class="tag lent">${this._m(t.lent)} geliehen</span>` : ""}</div>` : ""}</div><div class="amt">${this._m(t.amount)}</div></div>` + (this._open?.kind === "pot" && this._open.id === t.id ? this._potForm(t) : ""))).join("");
      h += `<div class="sum"><span>Komplett (Verfügbar + Töpfe)</span>${this._mv(s.total, "total")}</div>`;
    }
    // 🏦 Meine Konten (nur Info)
    if (d.konten.length && show("konten")) {
      h += this._ghc("konten", "bank-outline", "var(--pc)", "Meine Konten", String(d.konten.length));
      if (this._openSec.has("konten")) h += d.konten.map((k) => `<div class="item"><div class="n"><b>${esc(k.name)}</b><div class="meta"><span class="tag ${this._hidden ? "hidden-amt" : ""}" style="font-family:monospace">${esc(k.iban)}</span>${k.note ? `<span class="tag">${esc(k.note)}</span>` : ""}</div></div>
        <button class="iconbtn" data-a="copy" data-id="${esc(k.id)}" title="IBAN kopieren">${ic("content-copy")}${this._lb("kopieren")}</button></div>`).join("");
    }
    return h;
  }
  // 🐷 Topf: rausnehmen, zurücklegen oder Stand ändern
  _potForm(t) {
    // 🐷 Schlank (Marco): Kopf antippen = zu · Zeile 1 Betrag ➖ ➕ · Zeile 2 Stand korrigieren ✓ ✕ – nur Symbole, lange drücken zeigt den Namen
    const lent = Number(t.lent) || 0;
    return `<div class="edit potbox" style="--cc:#e91e63"><div class="pothead" data-a="cancel" title="Zuklappen"><b>${esc(t.name)}</b> · ${this._m(t.amount)}${lent > 0 ? ` <button type="button" class="tag lent lentbtn" data-a="lentoff" data-id="${esc(t.id)}" title="Antippen = nicht mehr zurücklegen">${this._m(lent)} geliehen ${ic("close")}</button>` : ""}</div>
      <form class="potrow" data-a="potmove" data-id="${esc(t.id)}"><input name="amount" class="amount" inputmode="decimal" autocomplete="off" placeholder="Betrag ${FK_MONEY.sym}" aria-label="Betrag" value="${lent > 0 ? numDe(lent) : ""}"><button class="iconbtn potbtn" type="submit" name="act" value="take" title="Rausnehmen" aria-label="Rausnehmen">${ic("minus")}${this._lb("raus")}</button><button class="iconbtn potbtn okbtn" type="submit" name="act" value="return" title="Zurücklegen" aria-label="Zurücklegen">${ic("plus")}${this._lb("zurück")}</button></form>
      <form class="potrow set" data-a="potset" data-id="${esc(t.id)}"><span class="potlbl">Stand korrigieren</span><input name="stand" class="amount" inputmode="decimal" autocomplete="off" aria-label="Stand korrigieren" value="${numDe(Number(t.amount) || 0)}"><button class="iconbtn potbtn okbtn" type="submit" title="Stand speichern" aria-label="Stand speichern">${ic("check-bold")}${this._lb("speichern")}</button><button type="button" class="iconbtn potbtn" data-a="cancel" title="Abbrechen" aria-label="Abbrechen">${ic("close")}${this._lb("abbrechen")}</button></form></div>`;
  }
  // 🏦 Kontostand eintragen – eigene Seite wie bei der Einkaufsliste
  _kontoPage(d) {
    const upd = d.summary.balance_updated ? new Date(d.summary.balance_updated).toLocaleString(fkLoc(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "noch nie";
    return { icon: "bank-outline", color: "#0288d1", title: "Kontostand", html: `<p class="small">Den Stand aus deiner Bank-App eintragen. Zuletzt: <b>${upd}</b></p>
      <form class="edit" data-a="kontosave"><div class="f"><label class="wide">Kontostand (${FK_MONEY.sym})<input name="balance" inputmode="decimal" autocomplete="off" value="${numDe(d.summary.balance)}"></label></div>
      <div class="btnrow end"><button type="button" class="btn" data-a="back">${ic("close")}Abbrechen</button><button class="btn main" type="submit">${ic("check")}Speichern</button></div></form>` };
  }
  // ✏️ Ausgabe ändern (Name und Betrag)
  _bookingForm(b) {
    return `<form class="edit" data-a="bsave" data-id="${esc(b.id)}" style="--cc:#ff9800"><div class="f"><label class="wide">Wofür?<input name="name" value="${esc(b.name)}" autocomplete="off"></label>
      <label>Betrag (${FK_MONEY.sym})<input name="amount" inputmode="decimal" autocomplete="off" value="${numDe(b.amount)}"></label></div>
      <div class="btnrow end"><button type="button" class="btn" data-a="bdel" data-id="${esc(b.id)}">${ic("delete-outline")}Löschen</button><button type="button" class="btn" data-a="cancel">${ic("close")}Abbrechen</button><button class="btn main" type="submit">${ic("check")}Speichern</button></div></form>`;
  }
  _postenRow(d, p) {
    const paused = p.active === false;
    const on = paused || !!d.paid[p.id]?.paid;
    const special = d.month_price?.[p.id], mon = this._monthName(d.month).split(" ")[0];
    const mpOpen = this._open?.kind === "mprice" && this._open.id === p.id;
    const mpForm = () => { // 💶 Preis nur für diesen Monat – klappt UNTER der Zeile auf, die Zeile bleibt stehen (wie in der Einkaufsliste)
      return `<form class="edit potbox" data-a="mpsave" data-id="${esc(p.id)}" style="--cc:${gcol(d, p.group)}"><div class="pothead" data-a="cancel" title="Zuklappen">Normal ${this._m(p.amount)}</div>
        <div class="potrow set${special != null ? " mp3" : ""}"><span class="potlbl">Nur im ${esc(mon)}</span><input name="amount" class="amount" inputmode="decimal" autocomplete="off" aria-label="Preis nur diesen Monat" value="${numDe(pamt(d, p))}"><button class="iconbtn potbtn okbtn" type="submit" title="Preis nur für diesen Monat speichern" aria-label="speichern">${ic("check-bold")}${this._lb("speichern")}</button>${special != null ? `<button type="button" class="iconbtn potbtn" data-a="mpreset" data-id="${esc(p.id)}" title="Wieder normaler Preis" aria-label="normaler Preis">${ic("restore")}${this._lb("normal")}</button>` : ""}<button type="button" class="iconbtn potbtn" data-a="cancel" title="Abbrechen" aria-label="Abbrechen">${ic("close")}${this._lb("abbrechen")}</button></div>
        <p class="small">Gilt nur diesen Monat. Nächsten Monat ist wieder ${this._m(p.amount)} da.</p></form>`;
    };
    return `<div class="item ${on ? "done" : ""} ${mpOpen ? "opened" : ""} ${paused ? "paused" : ""}" style="--cc:${gcol(d, p.group)}">${paused ? `<span class="chk on" title="pausiert – zählt nicht mit">${ic("pause")}</span>` : `<button class="chk ${on ? "on" : ""}" data-a="paid" data-id="${esc(p.id)}" aria-label="abhaken">${on ? ic("check") : ""}</button>`}
      <div class="n"><b>${esc(p.name)}</b><div class="meta">${paused ? `<span class="tag">⏸️ pausiert</span>` : ""}${p.day ? `<span class="tag">am ${p.day}.</span>` : ""}${p.until ? `<span class="tag" title="Ratenzahlung bis ${esc(fkUntil(p.until))}">${this._rates(d, p)}</span>` : ""}<span class="tag">${esc((PAY[p.pay] || PAY.keine)[0])}</span>${!paused && on && d.paid[p.id]?.ts ? `<span class="tag" title="abgehakt am">✓ ${fkDay(d.paid[p.id].ts)}</span>` : ""}${special != null ? `<span class="tag mp" title="normal ${esc(money(p.amount))}">✏️ nur ${esc(mon)}</span>` : ""}${p.note ? `<span class="tag">${esc(p.note)}</span>` : ""}</div></div>
      <div class="amt ${paused ? "" : "click"}" ${paused ? "" : `data-a="mprice" data-id="${esc(p.id)}" title="Antippen = Preis nur für diesen Monat ändern"`}>${this._m(-pamt(d, p), "neg")}</div></div>${mpOpen ? mpForm() : ""}`;
  }
  // 💳 „noch 3 Raten“ / „letzte Rate“ / „abbezahlt 🎉“
  _rates(d, p) { const n = ratesLeft(d, p); return n == null ? "" : n < 1 ? "abbezahlt 🎉" : n === 1 ? "letzte Rate" : `noch ${n} Raten`; }
  _monthName(mk) { const m = Number(String(mk || "").slice(5, 7)); return m ? (FK_LANG === "en" ? MONTHS_EN : MONTHS)[m - 1] + " " + String(mk).slice(0, 4) : ""; }

  _editView(d) {
    // ⠿ Griff vorne zum Ziehen. Posten lassen sich auch in eine andere Gruppe ziehen.
    const row = (kind, it, rowText, sortable) => (`<div class="item click ${it.active === false ? "done" : ""}" data-a="open" data-k="${kind}" data-id="${esc(it.id)}" ${sortable ? `data-row="${esc(it.id)}"` : ""}>${sortable ? `<span class="grip" data-grip="${kind}" title="Ziehen zum Verschieben">${ic("drag")}</span>` : ""}<div class="n"><b>${it.active === false ? "⏸️ " : ""}${esc(it.name)}</b>${rowText(it) ? `<div class="meta">${rowText(it).filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : ""}</div>${"amount" in it ? `<div class="amt">${this._m(it.amount)}</div>` : ""}${sortable ? "" : `<span class="iconbtn">${ic("pencil-outline")}</span>`}</div>` + (this._open?.kind === kind && this._open.id === it.id ? this._form(d, kind, it) : ""));
    const head = (kind, icon, color, title) => this._gh(icon, color, title, `<button class="btn small" data-a="new" data-k="${kind}">${ic("plus")}Neu</button>`)
      + (this._open?.kind === kind && this._open.id === "new" ? this._form(d, kind, {}) : "");
    const block = (kind, icon, color, title, list, rowText, sortable = true) => head(kind, icon, color, title)
      + (list.length ? `<div class="olist" data-list="${kind}">${list.map((it) => row(kind, it, rowText, sortable)).join("")}</div>` : `<div class="empty">Noch leer.</div>`);
    const groups = [...d.groups];
    const ptext = (p) => [p.day ? `am ${p.day}.` : "", p.until ? `${this._rates(d, p)} · bis ${fkUntil(p.until)}` : "", (PAY[p.pay] || PAY.keine)[0], p.months?.length ? p.months.map((m) => MONTHS[m - 1]).join(", ") : ""];
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
      + block("gruppe", "format-list-bulleted-square", "#9e9e9e", "Gruppen", groups, (g) => [`ab dem ${g.start_day}.`])
      + `<p class="small">⠿ Am Griff vorne ziehen = Reihenfolge ändern. Fixkosten kannst du so auch in eine andere Gruppe schieben, und auch die Gruppen selbst lassen sich verschieben.</p>`;
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
    if (listEl.dataset.list === "quick") { this._quickSave([...listEl.children].map((x) => x.dataset.row).filter(Boolean)); return; } // ⚡ neue Reihenfolge der Schnellknöpfe
    const kind = listEl.dataset.list, ids = [], groups = {};
    let gid = null;
    for (const el of listEl.children) {
      if (el.classList.contains("gsub")) gid = el.dataset.gid || null;
      else if (el.dataset.row) { ids.push(el.dataset.row); if (kind === "posten" && gid) groups[el.dataset.row] = gid; }
    }
    this._send({ type: "order", kind, ids, ...(kind === "posten" ? { groups } : {}) });
  }
  // ⚡ Schnellknöpfe wie die Kategorien der Einkaufsliste: erst die Liste, antippen = nur diesen Knopf einstellen
  _quickHtml(d) {
    const st = d.settings, list = st.quick || [];
    const sel = this._qSel != null ? list.find((q) => q === this._qSel) : null;
    const icOf = (q) => qiconOf(d, q) || "mdi:lightning-bolt-outline";
    if (sel != null) {
      const k = String(sel).trim().toLowerCase(), cur = qiconOf(d, sel), own = !!st.quick_colors?.[k];
      return `
        <div class="storehead" style="--sc:${qcolOf(d, sel)}"><ha-icon icon="${esc(icOf(sel))}"></ha-icon><b>${esc(sel)}</b></div>
        <div class="srow"><input type="color" data-a="qcolor" data-v="${esc(k)}" value="${qcolOf(d, sel)}" title="Farbe"><input class="grow" data-a="qrename" data-v="${esc(sel)}" value="${esc(sel)}" maxlength="30" placeholder="Name, z. B. Bäckerei" title="Name"><button class="iconbtn" data-a="qdel" data-v="${esc(sel)}" title="Löschen">${ic("trash-can-outline")}</button></div>
        ${own ? `<div class="btnrow"><button class="btn" data-a="qcolreset" data-v="${esc(k)}">${ic("restore")}Wieder automatische Farbe</button></div>` : ""}
        <p class="small" style="margin-top:10px"><b>Symbol</b> – antippen zum Wählen:</p>
        <div class="qicons"><button class="qic ${cur ? "" : "on"}" data-a="qicon" data-v="${esc(k)}" data-i="" title="Kein Symbol">${ic("close")}</button>${QUICK_ICONS.map((n) => `<button class="qic ${cur === "mdi:" + n ? "on" : ""}" data-a="qicon" data-v="${esc(k)}" data-i="mdi:${n}" title="${n}">${ic(n)}</button>`).join("")}</div>
        <div class="btnrow end"><button class="btn main" data-a="qback">${ic("check")}Fertig</button></div>
        <p class="small">Name, Farbe und Symbol ändern, 🗑️ löscht den Knopf (mit Rückgängig). Ausgaben mit dem alten Namen behalten ihren Namen.</p>`;
    }
    return `
        <p class="small">Die Knöpfe über „Wofür?“ bei den Ausgaben – genau wie die Kategorien der Einkaufsliste.</p>
        <div class="storelist" data-list="quick">${list.map((q) => `<div class="srow storerow" data-row="${esc(q)}" style="--sc:${qcolOf(d, q)}"><span class="grip" data-grip="quick" title="Ziehen zum Verschieben">${ic("drag")}</span><button class="storepick grow" type="button" data-a="qsel" data-v="${esc(q)}"><ha-icon icon="${esc(icOf(q))}"></ha-icon><span><b>${esc(q)}</b><small>antippen zum Einstellen</small></span></button></div>`).join("")}</div>
        ${list.length < 16 ? `<form class="srow" data-a="qadd"><input class="grow" name="name" maxlength="30" placeholder="Neuer Knopf, z. B. Tankstelle" autocomplete="off"><button class="btn main" type="submit" title="Hinzufügen">${ic("plus")}Neu</button></form>` : `<p class="small">Mehr als 16 Knöpfe gehen nicht.</p>`}
        <p class="small">⠿ ziehen = Reihenfolge. Knopf antippen = Name, Farbe und Symbol ändern. Jeder Knopf behält seine Farbe, auch beim Umsortieren.</p>`;
  }
  _quickSave(list, extra = {}) {
    this._send({ type: "settings", settings: { quick: list, ...extra } });
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
    if (kind !== "gruppe" && kind !== "konto") f.push(`<label>Betrag (${FK_MONEY.sym})<input name="amount" inputmode="decimal" value="${it.amount != null ? numDe(it.amount) : ""}"></label>`);
    if (kind === "posten") {
      f.push(`<label>Gruppe<select name="group">${d.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === (it.group || d.groups[0]?.id) ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>`);
      f.push(`<label>Fester Tag (frei lassen = keiner)<input name="day" type="number" min="1" max="31" inputmode="numeric" placeholder="z. B. 5" value="${it.day || ""}"></label>`);
      { // 💳 Raten bis: zwei einfache Auswahlen (Monat + Jahr) statt Kalender – da lässt sich das Jahr überall ändern
        const [uy, um] = String(it.until || "").split("-");
        const y0 = new Date().getFullYear(), years = [];
        for (let y = Math.min(y0, Number(uy) || y0); y <= Math.max(y0 + 15, Number(uy) || 0); y++) years.push(y);
        const MON = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
        f.push(`<label>Raten bis (letzter Monat, leer = keine Raten)<span style="display:flex;gap:6px"><select name="until_m" style="flex:1"><option value="">– keine Raten –</option>${MON.map((n, i) => `<option value="${String(i + 1).padStart(2, "0")}" ${Number(um) === i + 1 ? "selected" : ""}>${n}</option>`).join("")}</select><select name="until_y" style="flex:none;width:auto">${years.map((y) => `<option value="${y}" ${String(y) === (uy || String(y0)) ? "selected" : ""}>${y}</option>`).join("")}</select></span></label>`);
      }
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

  // 📊 Statistik: Durchschnitt, bester/schlechtester Monat, Vergleich und Jahressumme – nur aus dem, was schon gemerkt ist
  _statView(d) {
    const hist = d.history || [], s = d.summary, spent = (x) => (x.fix_total || 0) + (x.bookings || 0);
    const cur = { month: d.month, fix_total: s.fix_total, income_total: s.income_total, bookings: s.bookings_month, available_end: s.available };
    const avg = (f) => hist.reduce((a, x) => a + f(x), 0) / hist.length;
    const tile = (emo, lbl, val, sub = "") => `<div class="stile"><small>${emo} ${lbl}</small><b>${val}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
    const pct = (a, b, good = false) => { if (!b) return ""; const p = Math.round(((a - b) / Math.abs(b)) * 100); return `<span class="trend ${(good ? -p : p) > 0 ? "up" : (good ? -p : p) < 0 ? "down" : ""}">${p > 0 ? "▲" : p < 0 ? "▼" : "＝"} ${p > 0 ? "+" : ""}${p} %</span>`; };
    let h = "";
    if (hist.length) {
      const best = hist.reduce((a, x) => (x.available_end > a.available_end ? x : a)), worst = hist.reduce((a, x) => (x.available_end < a.available_end ? x : a));
      h += `<div class="sec"><div class="sechead"><span class="ic" style="--ic:#5e35b1">${ic("chart-line")}</span><h3>Durchschnitt pro Monat</h3></div>
        <div class="stiles">${tile("💸", "Ausgegeben", this._m(avg(spent)), "Fixkosten + Ausgaben")}${tile("💵", "Einnahmen", this._m(avg((x) => x.income_total || 0)))}${tile("🐷", "Übrig am Ende", this._m(avg((x) => x.available_end || 0)))}</div>
        <div class="stiles">${tile("🏆", "Bester Monat", esc(this._monthName(best.month)), `${this._m(best.available_end)} übrig`)}${tile("🙈", "Schlechtester Monat", esc(this._monthName(worst.month)), `${this._m(worst.available_end)} übrig`)}</div>
        <p class="small">Aus ${hist.length} ${hist.length === 1 ? "fertigen Monat" : "fertigen Monaten"}. Der laufende Monat zählt erst mit, wenn er vorbei ist.</p></div>`;
      const last = hist[hist.length - 1], prev = hist[hist.length - 2];
      const [ly, lm] = last.month.split("-"), yago = hist.find((x) => x.month === `${Number(ly) - 1}-${lm}`);
      h += `<div class="sec"><div class="sechead"><span class="ic" style="--ic:#00897b">${ic("compare-horizontal")}</span><h3>Vergleich</h3></div>
        <table><tr><th></th><th>Ausgegeben</th><th>Einnahmen</th></tr>
        <tr><td><b>${esc(this._monthName(last.month))}</b></td><td>${this._m(spent(last))}</td><td>${this._m(last.income_total)}</td></tr>
        ${prev ? `<tr><td>zum Vormonat</td><td>${pct(spent(last), spent(prev))}</td><td>${pct(last.income_total, prev.income_total, true)}</td></tr>` : ""}
        ${yago ? `<tr><td>zum Vorjahr</td><td>${pct(spent(last), spent(yago))}</td><td>${pct(last.income_total, yago.income_total, true)}</td></tr>` : ""}</table>
        ${prev ? "" : `<p class="small">Den Vergleich gibt's ab dem zweiten fertigen Monat.</p>`}
        <p class="small">Grün = gut für dich (weniger ausgegeben oder mehr eingenommen), rot = andersrum.</p></div>`;
    } else h += `<div class="sec"><p class="okmsg">📊 Durchschnitt und Vergleich gibt's nach dem ersten Monatsende. Die Karte merkt sich jeden Monat von selbst.</p></div>`;
    const yr = d.month.slice(0, 4), ym = [...hist.filter((x) => x.month.startsWith(yr)), cur], sum = (f) => ym.reduce((a, x) => a + (f(x) || 0), 0);
    h += `<div class="sec"><div class="sechead"><span class="ic" style="--ic:#fb8c00">${ic("calendar-month-outline")}</span><h3>${yr} bisher</h3></div>
      <div class="stiles">${tile("📅", "Fixkosten", this._m(sum((x) => x.fix_total)))}${tile("💳", "Ausgaben", this._m(sum((x) => x.bookings)))}${tile("💵", "Einnahmen", this._m(sum((x) => x.income_total)))}</div>
      <p class="small">${ym.length} ${ym.length === 1 ? "Monat" : "Monate"}, der laufende Monat mit dem Stand von heute.</p></div>`;
    const fixAvg = hist.length ? avg((x) => x.fix_total || 0) : cur.fix_total || 0, incAvg = hist.length ? avg((x) => x.income_total || 0) : cur.income_total || 0;
    if (incAvg > 0) {
      const share = Math.round((fixAvg / incAvg) * 100), col = share <= 50 ? "#43a047" : share <= 70 ? "#fb8c00" : "#e53935";
      h += `<div class="sec"><div class="sechead"><span class="ic" style="--ic:${col}">${ic("chart-donut")}</span><h3>Fixkosten-Anteil</h3></div>
        <p class="share"><b style="color:${col}">${share} %</b> deines Einkommens gehen für Fixkosten weg.</p>
        <div class="sharebar"><i style="width:${Math.min(100, share)}%;background:${col}"></i></div>
        <p class="small">${share <= 50 ? "😎 Entspannt – da bleibt Luft." : share <= 70 ? "😐 Geht, aber viel Spielraum ist nicht." : "😱 Puh, das ist eng."} ${hist.length ? "Durchschnitt der fertigen Monate." : "Stand des laufenden Monats."}</p></div>`;
    }
    h += `<div class="sec"><div class="sechead"><span class="ic" style="--ic:#e91e63">${ic("chart-bar")}</span><h3>Monat für Monat</h3></div>${this._histView(d)}</div>`;
    return h;
  }
  _histView(d) {
    const hist = [...(d.history || [])].slice(-12);
    const s = d.summary;
    hist.push({ month: d.month, fix_total: s.fix_total, fix_paid: s.fix_paid, income_total: s.income_total, bookings: s.bookings_month, available_end: s.available, now: true });
    const max = Math.max(1, ...hist.map((x) => Math.max(x.fix_total + x.bookings, x.income_total)));
    const hh = (v) => Math.max(2, (v / max) * 120).toFixed(0);
    return `<div class="legend"><span><i style="background:#e57373"></i>Fixkosten</span><span><i style="background:#ffb74d"></i>Ausgaben</span><span><i style="background:#81c784"></i>Einnahmen</span></div>
      <div class="hist">${hist.map((x) => `<div class="m" title="${esc(this._monthName(x.month))}">
        <div style="display:flex;gap:2px;align-items:flex-end;width:100%;justify-content:center">
          <div style="width:40%;display:flex;flex-direction:column;justify-content:flex-end"><div style="height:${hh(x.bookings)}px;background:#ffb74d;border-radius:4px 4px 0 0"></div><div style="height:${hh(x.fix_total)}px;background:#e57373"></div></div>
          <div style="width:40%;height:${hh(x.income_total)}px;background:#81c784;border-radius:4px 4px 0 0"></div></div>
        <span>${MONTHS[Number(x.month.slice(5, 7)) - 1]}${x.now ? "*" : ""}</span></div>`).join("")}</div>
      <table><tr><th>Monat</th><th>Fixkosten</th><th>Karte</th><th>Einnahmen</th><th>Verfügbar am Ende</th></tr>
      ${[...hist].reverse().map((x) => `<tr><td>${esc(this._monthName(x.month))}${x.now ? " (läuft)" : ""}</td><td>${this._m(x.fix_total)}</td><td>${this._m(x.bookings)}</td><td>${this._m(x.income_total)}</td><td>${this._m(x.available_end)}</td></tr>`).join("")}</table>
      <p class="small">Am Monatsende wird der Monat automatisch hier gemerkt (bis zu 3 Jahre).</p>`;
  }

  // 📖 Anleitung wie bei der Einkaufsliste: Kästen zum Aufklappen (immer nur einer offen), Suche oben, „Was ist neu“ zuerst
  _guideView() {
    const sec = (emo, title, sub, body) => `<details class="elg-sec"><summary><span class="elg-ic">${emo}</span><span class="elg-tt"><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</span></summary><div>${body}</div></details>`;
    return `<div class="elg"><h2>💶 So funktionieren die Fixkosten</h2>
      <p class="elg-sub">Tipp auf eine Überschrift klappt sie auf. Diese Anleitung findest du immer über den Knopf <b>📖 Anleitung</b> ganz unten unter der Karte.</p>
      <input type="search" class="elg-q" placeholder="🔎 In dieser Anleitung suchen, z. B. PIN" aria-label="In dieser Anleitung suchen" autocomplete="off" enterkeyhint="search"><p class="elg-none" hidden>Nichts gefunden 🤷 – versuch ein anderes Wort.</p>
      ${sec("🆕", "Was ist neu", "die letzten Neuerungen", this._newsHtml())}
      ${FK_GUIDE.map((g, i) => sec(GUIDE_EMO[i] || "📌", g.title, GUIDE_SUB[i] || "", g.text)).join("")}
      ${sec("🙏", "Credits", "wer das gemacht hat", this._creditsHtml())}</div>`;
  }
  // 🆕 Was ist neu – in der Beta oben ein oranger Kasten mit dem, was in DIESER Beta neu ist
  _newsHtml() {
    if (FK_LANG === "en") return `<div class="betabox" translate="no"><b>${/-beta/.test(FK_VERSION) ? "🧪 You are on beta" : "Version"} ${FK_VERSION}</b><p class="small" style="margin:4px 0 2px">The release notes are written in German. You find them (and every version) on <a href="https://github.com/misterm2310/fixkosten-card/releases" target="_blank" rel="noopener">GitHub → Releases</a>.</p></div>`;
    const li = (t) => `<ul>${t.split(" · ").map((x) => `<li>${x}</li>`).join("")}</ul>`;
    const cur = FK_NEWS.find((n) => n[0] === FK_VERSION);
    const beta = /-beta/.test(FK_VERSION) && cur ? `<div class="betabox"><b>🧪 Du bist in der Beta ${FK_VERSION}</b><p class="small" style="margin:4px 0 2px">Neu in dieser Beta:</p>${li(cur[1])}</div>` : "";
    return `${beta}<p class="small">Das Neueste steht oben.</p>${FK_NEWS.filter((n) => !beta || n !== cur).map((n) => `<p style="margin:10px 0 0"><b>v${n[0]}</b></p>${li(n[1])}`).join("")}`;
  }
  // 🙏 Credits – genau wie bei der Einkaufsliste (Logo, Version, Knöpfe, PayPal), in ⚙️ und in der Anleitung
  _creditsHtml() {
    const t = (de, en) => (FK_LANG === "en" ? en : de);
    return `<div class="elcredits" translate="no">
      <div class="ellogo"><img src="/fixkosten/files/mister-m.webp?v=${FK_VERSION}" alt="Mister-M" loading="lazy"></div>
      <p class="elcv"><b>Fixkosten</b> v${FK_VERSION}</p>
      <p>${t("Gemacht von <b>Mister-M</b> – mit Hilfe von Claude 🤖", "Made by <b>Mister-M</b> – with help from Claude 🤖")}</p>
      <p>${t("Ich versuche, Updates und Fehler-Korrekturen zeitnah zu erledigen.", "I try to ship updates and fixes promptly.")}</p>
      <p class="elcsmall">📅 ${t("Neue offizielle Versionen kommen immer sonntags. An den anderen Tagen gibt es nur Test-Versionen (Beta) – die siehst du in HACS unter „Beta-Versionen anzeigen“.", "New official versions always come out on Sundays. On the other days there are only test versions (beta) – you see them in HACS under “Show beta versions”.")}</p>
      <div class="elcbtns">
        <a class="elcbtn" href="${REPO}" target="_blank" rel="noopener">🐙 GitHub</a>
        <a class="elcbtn" href="${REPO}/discussions" target="_blank" rel="noopener">💡 ${t("Idee oder Wunsch", "Idea or request")}</a>
        <a class="elcbtn" href="${REPO}/issues" target="_blank" rel="noopener">🐞 ${t("Fehler melden", "Report a bug")}</a>
        <a class="elcbtn pp" href="${PAYPAL}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C1 8.6 2.7 5 6.2 5c2 0 3.5 1.1 5.8 3.4C14.3 6.1 15.8 5 17.8 5c3.5 0 5.2 3.6 3.8 6.8C19.5 16.4 12 21 12 21z" fill="#fff"/></svg><span>${t("Spenden mit PayPal", "Donate with PayPal")}</span></a>
      </div>
      <p class="elcsmall">${t("Die Fixkosten sind und bleiben kostenlos. Wenn sie dir gefallen, freue ich mich über eine kleine Spende – ganz freiwillig. Beim Antippen öffnet sich PayPal im Browser; vorher geht nichts ins Internet.", "Fixkosten is and stays free. If you like it, I would be happy about a small donation – completely voluntary. Tapping opens PayPal in your browser; nothing goes to the internet before that.")}</p>
      <p>🔒 ${t("Alle Daten bleiben in deinem Home Assistant. Keine Cloud, kein Tracking – ins Internet geht nichts. Mehr unter ⚙️ → Datenschutz.", "All data stays in your Home Assistant. No cloud, no tracking – nothing goes to the internet. More under ⚙️ → Privacy.")}</p>
      <p class="elcsmall">${t("Symbole: Material Design Icons (Pictogrammers) · Lizenz: MIT", "Icons: Material Design Icons (Pictogrammers) · License: MIT")}</p>
    </div>`;
  }

  // 🔢 PIN-Eingabe wie am Handy (wie bei der Einkaufsliste): Punkte, Zahlenfeld 1–9, ⌫ 0 ✔ und „Abbrechen“
  _padPage(d) {
    const p = this._pad;
    const what = this._view === "set" ? "⚙️ Einstellungen" : "Bearbeiten";
    const t = {
      unlock: ["PIN eingeben", this._lockAll ? "Die Fixkosten sind gesperrt. Mit der PIN geht's weiter." : `Für <b>${what}</b> brauchst du die PIN. Die Übersicht und das Abhaken gehen auch ohne.`],
      old: ["Alte PIN", p.purpose === "off" ? "Zum Ausschalten erst die jetzige PIN eintippen." : "Erst die jetzige PIN eintippen."],
      new: ["Neue PIN", "4 bis 8 Ziffern, dann ✔."],
      new2: ["Neue PIN nochmal", "Zur Sicherheit noch einmal dieselbe PIN."],
    }[p.step];
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✔"];
    return { icon: "lock-outline", color: "#f4511e", title: t[0], html: `<div class="pinpad"><p class="small">${t[1]}</p>
      <div class="pdots">${p.buf ? "●".repeat(p.buf.length) : "&nbsp;"}</div>
      <div class="ppad">${keys.map((k) => `<button type="button" class="btn ${k === "✔" ? "primary" : ""}" data-a="pkey" data-v="${k}" aria-label="${k === "⌫" ? "Löschen" : k === "✔" ? "OK" : k}">${k}</button>`).join("")}</div>
      ${this._lockAll ? "" : `<button type="button" class="btn pcancel" data-a="back">Abbrechen</button>`}
      ${p.step === "unlock" ? `<p class="small" style="margin-top:16px">PIN vergessen? Ein Admin geht in Home Assistant auf <b>Einstellungen → Geräte & Dienste → Fixkosten → Konfigurieren</b> und hakt <b>„PIN zurücksetzen“</b> an.</p>` : ""}</div>` };
  }
  _padPress(k) {
    const p = this._pad;
    if (!p) return;
    try { navigator.vibrate?.(12); } catch (_) { /* egal */ }
    if (k === "⌫") p.buf = p.buf.slice(0, -1);
    else if (k === "✔") { if (p.buf.length >= 4) this._padNext(); else this._toast("Die PIN hat 4 bis 8 Ziffern"); }
    else if (/^\d$/.test(k) && p.buf.length < 8) p.buf += k;
    this._force = true; this._render();
  }
  _padNext() {
    const p = this._pad, v = p.buf;
    p.buf = "";
    const redraw = () => { this._force = true; this._render(); };
    const restart = () => { if (this._pad === p) { p.step = p.purpose === "unlock" ? "unlock" : this._data?.pin ? "old" : "new"; p.buf = ""; } redraw(); };
    const setPin = (pin) => this._pin("fixkosten/pin/set", { pin, old: p.old || null }).then((r) => {
      if (!r) { restart(); return; }
      PIN_LOCK.until = pin ? Date.now() + 10 * 60 * 1000 : 0;
      this._toast(pin ? "🔒 PIN gespeichert" : "🔓 PIN ist aus");
      this._pad = null; redraw();
    });
    if (p.step === "unlock") {
      if (this._hass?.connected === false) { // 📴 ohne Netz prüft die Karte selbst (Offline-Schlüssel aus dem letzten Stand)
        this._toast("🔎 PIN wird auf diesem Gerät geprüft …");
        pinCheckOffline(this._data?.pin_off, v).then((r) => {
          if (r.ok) { PIN_LOCK.until = Date.now() + 10 * 60 * 1000; this._pad = null; this._toast("🔓 Entsperrt (offline)"); }
          else if (r.wait) this._toast(`⏳ Zu oft falsch – bitte ${r.wait} Sekunden warten`);
          else if (r.unknown) this._toast("📴 Diese PIN kennt das Gerät noch nicht – einmal mit Netz eingeben, danach geht's auch offline");
          else this._toast("❌ Falsche PIN");
          redraw();
        });
        return;
      }
      this._pin("fixkosten/pin/check", { pin: v }).then((r) => {
        if (r?.ok) { PIN_LOCK.until = Date.now() + 10 * 60 * 1000; this._pad = null; this._toast("🔓 Entsperrt"); }
        else if (r) this._toast("❌ Falsche PIN");
        redraw();
      });
    } else if (p.step === "old") { p.old = v; if (p.purpose === "off") setPin(null); else p.step = "new"; }
    else if (p.step === "new") { p.neu = v; p.step = "new2"; }
    else if (p.step === "new2") { if (v === p.neu) setPin(v); else { this._toast("Die zwei PINs sind nicht gleich – bitte nochmal"); p.step = "new"; } }
  }
  _pinSetHtml(d) {
    return `<p class="small">${d.pin ? "🔒 PIN ist <b>an</b>. ⚙️ und „Bearbeiten“ fragen nach der PIN." : "Mit einer PIN (4–8 Ziffern) sperrst du ⚙️ und „Bearbeiten“, z. B. auf dem Wand-Tablet. Abhaken und Ausgaben gehen weiter ohne PIN."}</p>
      <div class="btnrow">${d.pin ? `<button class="btn main" data-a="padstart" data-v="set">${ic("lock-reset")}PIN ändern</button><button class="btn" data-a="padstart" data-v="off">${ic("lock-open-variant-outline")}PIN ausschalten</button>` : `<button class="btn main" data-a="padstart" data-v="set">${ic("lock-outline")}PIN einschalten</button>`}</div>
      ${d.pin ? `<label class="switch"><span>${ic("lock-outline")}<span class="vt"><b>Ganze Karte sperren</b><small>Aus = nur ⚙️ und Bearbeiten. An = ohne PIN sieht man gar nichts.</small></span></span><input type="checkbox" class="swchk" data-a="setlockall" ${d.settings.lock_all ? "checked" : ""}></label>` : ""}
      <p class="small help">Die PIN tippst du wie am Handy auf dem Zahlenfeld ein. Sie liegt nur als Prüfsumme in Home Assistant. Vergessen? Admin → <b>Geräte & Dienste → Fixkosten → Konfigurieren → „PIN zurücksetzen“</b>. 5× falsch = 1 Minute Pause.</p>`;
  }

  // ⚙️ Einstellungen wie bei der Einkaufsliste: Kategorien mit Kacheln, jede Kachel öffnet ein eigenes Fenster
  _sheets(d) {
    const st = d.settings, admin = this._hass?.user?.is_admin !== false;
    return {
      rechnen: { icon: "calculator-variant-outline", color: "#43a047", title: "Rechnen & Warnung", info: `${FK_MONEY.code}${st.warn_enabled === false ? " · Warnung aus" : ` · Warnung unter ${money(st.warn_below || 0)}`}`, html: () => `
        <label class="switch"><span>${ic("undo-variant")}Haken am Monatsanfang automatisch zurücksetzen</span><input type="checkbox" class="swchk" data-a="setreset" ${st.reset_checks !== false ? "checked" : ""}></label>
        <label class="switch"><span>${ic("file-document-alert-outline")}Offene Stände von „Verfügbar“ abziehen</span><input type="checkbox" class="swchk" data-a="setdebts" ${st.debts_subtract ? "checked" : ""}></label>
        <label class="switch"><span>${ic("bell-outline")}Warnung an (Warn-Sensor)</span><input type="checkbox" class="swchk" data-a="setwarnon" ${st.warn_enabled !== false ? "checked" : ""}></label>
        ${st.warn_enabled === false ? "" : `<div class="switch"><span>${ic("alert-circle-outline")}Warnen, wenn „Verfügbar“ unter</span><span><input data-a="setwarn" inputmode="decimal" value="${numDe(st.warn_below ?? 0)}" style="width:90px;text-align:right"> ${FK_MONEY.sym}</span></div>`}
        <div class="switch"><span>${ic("cash-multiple")}Währung</span><select data-a="setcur" style="width:auto;max-width:60%">${Object.entries(FK_CUR).map(([c, n]) => `<option value="${c}" ${(st.currency || "EUR") === c ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <p class="small help">Ändert nur das Zeichen und die Schreibweise (z. B. <b>CHF 1’234.50</b>). Es wird <b>nichts umgerechnet</b>. Gilt für <b>alle</b> und auch für die Sensoren.</p>
        <div class="btnrow"><button class="btn" data-a="resetnow">${ic("undo-variant")}Alle Haken jetzt zurücksetzen</button></div>` },
      quick: { icon: "lightning-bolt-outline", color: "#fb8c00", title: "Schnellknöpfe", info: `${(st.quick || []).length} Knöpfe`, html: () => this._quickHtml(d) },
      csv: { icon: "database-import-outline", color: "#1e88e5", title: "Import & Sicherung", info: admin ? "CSV einlesen & sichern" : "nur Admins", html: () => admin ? `<p class="small help">Spalten: <b>Typ;Name;Betrag;Gruppe/Datum;Zahlart;Notiz</b> – Typ = ausgabe, einnahme, topf, stand (offener Stand), iban (Konto-Info, IBAN in Spalte 3) oder kontostand (Betrag, Datum in Spalte 4). Gruppe = 1 oder 15 (oder der Name). Zahlart = ü, d, l, p, a, g, b oder -.</p>
        <input type="file" accept=".csv,text/csv,text/plain" data-a="file"><textarea data-a="csv" rows="5" style="margin-top:6px" placeholder="ausgabe;Miete;800,00;1;d"></textarea>
        <label class="switch"><span>vorhandene Posten, Einnahmen, Töpfe und offenen Stände vorher löschen</span><input type="checkbox" class="swchk" data-a="csvreplace"></label>
        <div class="btnrow"><button class="btn main" data-a="import">${ic("upload")}Einlesen</button><button class="btn" data-a="export">${ic("download")}Als CSV sichern</button></div>` : `<p class="small">Nur für Admins.</p>` },
      app: { icon: "cellphone-arrow-down", color: "#3949ab", title: "Offline-App", info: "auch ohne Netz", html: () => `
        <p class="small">Eine eigene kleine App nur für die Fixkosten. Sie öffnet sich auch <b>ohne Netz</b>, zeigt den letzten Stand, lässt dich abhaken und eintragen und schickt alles nach, sobald wieder Netz da ist.</p>
        <ol class="small steps"><li>Auf dem Handy im <b>Browser</b> (Chrome oder Safari, nicht in der HA-App) die Adresse unten öffnen.</li><li>Einmal mit deinem Home-Assistant-Benutzer <b>anmelden</b>.</li><li>Im Browser-Menü <b>„Zum Startbildschirm hinzufügen“</b> – fertig, eigenes 💶-Symbol.</li></ol>
        <p class="small">Unten in der App: <b>„👆 Fingerabdruck-Sperre“</b> (nur auf Handys, die Fingerabdruck oder Face ID können). <b>Abmelden</b> meldet nur das Handy ab – deine Daten in Home Assistant bleiben erhalten. Es braucht eine <b>https</b>-Adresse (z. B. Nabu Casa).</p>
        ${d.app_url ? `<p class="small"><b>Deine Adresse für die App:</b></p><input id="appUrl" readonly value="${esc(d.app_url)}" translate="no">
        <div class="btnrow"><button class="btn main" data-a="appcopy">${ic("content-copy")}Kopieren</button></div><p class="small">Kopieren, im Handy-Browser einfügen, fertig. Die Adresse funktioniert zu Hause und unterwegs.</p>`
        : `<p class="small">⚠️ Home Assistant kennt keine https-Adresse für unterwegs. Mit <b>Nabu Casa</b> (Einstellungen → Home Assistant Cloud → Fernzugriff) oder einer eigenen https-Adresse (Einstellungen → System → Netzwerk) klappt es. Zu Hause geht auch: <code>${esc(location.origin)}/fixkosten/app/</code></p>`}` },
      pin: { icon: d.pin ? "lock-outline" : "lock-open-variant-outline", color: "#f4511e", title: "Schutz", info: d.pin ? "PIN ist an" : "PIN fürs Zahnrad", html: () => this._pinSetHtml(d) },
      privacy: { icon: "shield-lock-outline", color: "#455a64", title: "Datenschutz", info: "alles lokal", html: () => `<p class="small">🔒 Deine Zahlen bleiben in <b>deinem</b> Home Assistant. Keine Cloud, kein Tracking, nichts geht ins Internet. IBANs stehen bewusst in keinem Sensor. In der Offline-App liegen die Zahlen zusätzlich im Handy, bis du dich abmeldest.</p>` },
      hist: { icon: "chart-bar", color: "#e91e63", title: "Rückblick", info: `${(d.history || []).length} Monate gemerkt`, html: () => this._histView(d) },
      factory: { icon: "nuke", color: "#b71c1c", title: "Werkseinstellungen", info: admin ? "alles zurücksetzen" : "nur Admins", html: () => admin ? `
        <p><b>💣 Werkseinstellungen</b><br>Setzt <b>wirklich alles</b> zurück, als hättest du die Fixkosten frisch installiert: Fixkosten, Gruppen, Einnahmen, Ausgaben, Töpfe, offene Stände, Konten, Kontostand, Haken, Rückblick und alle Schalter. Danach sind die Standard-Gruppen „ab dem 1.“ und „ab dem 15.“ wieder da. Nur die <b>PIN</b> bleibt. <b>Das geht nicht rückgängig</b> – vorher unter „Import &amp; Sicherung“ → „Als CSV sichern“.</p>
        <div class="btnrow"><button class="btn danger" data-a="factory">${ic("nuke")}Werkseinstellungen – alles löschen</button></div>` : `<p class="small">💣 Werkseinstellungen gibt es nur für Admins.</p>` },
      log: { icon: "history", color: "#5e35b1", title: "Verlauf", info: st.log_on === false ? "aus" : `${(d.log || []).length} Einträge · wer, wann, was`, html: () => this._logHtml(d, admin) },
      view: { icon: "eye-outline", color: "#00897b", title: "Ansicht – für alle", info: (() => { const n = FK_VIEW.filter(([k]) => (st.view || {})[k] === false).length; return n ? `${n} ausgeblendet` : "alles sichtbar"; })(), html: () => `
        <p class="small help">Was auf der Übersicht zu sehen ist. Gilt für <b>alle</b> – auf allen Handys, im Dashboard und in der App. Ausgeblendetes ist nicht weg, nur versteckt. Unter „Bearbeiten“ bleibt alles da.</p>
        <label class="switch"><span>${ic("eye-off-outline")}<span class="vt"><b>Summen von Einnahmen, Töpfen und „Komplett“ verschleiern</b><small>PC: Maus drüber · Handy: Betrag antippen = 4 Sekunden sichtbar</small></span></span><input type="checkbox" class="swchk" data-a="setveil" ${st.veil !== false ? "checked" : ""}></label>
        ${FK_VIEW.map(([k, i, t, sub]) => `<label class="switch"><span>${ic(i)}<span class="vt"><b>${t}</b><small>${sub}</small></span></span><input type="checkbox" class="swchk" data-a="setview" data-v="${k}" ${(st.view || {})[k] !== false ? "checked" : ""}></label>`).join("")}` },
      labels: { icon: "format-text", color: "#546e7a", title: "Beschriftungen", info: st.labels ? "an – für alle" : "aus", html: () => `
        <label class="switch"><span>${ic("format-text")}Beschriftungen anzeigen</span><input type="checkbox" class="swchk" data-a="setlabels" ${st.labels ? "checked" : ""}></label>
        <p class="small help">Zeigt unter den kleinen Symbol-Knöpfen (🧮 Rechner, 👁️ Verstecken, ✓ abgebucht …) einen kurzen Text. Handys haben ja keine Tooltips. Gilt für <b>alle</b>. Auch ohne den Schalter gilt: <b>Länger auf ein Symbol drücken</b> zeigt kurz, was es macht.</p>` },
      mascot: { icon: "piggy-bank-outline", color: "#ec407a", title: "Maskottchen", info: st.mascot ? "Sparschwein ist da" : "aus", html: () => `
        <label class="switch"><span>${ic("piggy-bank-outline")}Sparschwein oben links zeigen</span><input type="checkbox" class="swchk" data-a="setmascot" ${st.mascot ? "checked" : ""}></label>
        <p class="small help">Statt der Geldbörse sitzt oben links ein <b>Sparschwein</b> und zeigt, wie es um dein Geld steht. Antippen = zurück zur Übersicht. Gilt für <b>alle</b>.</p>
        <div class="mascotprev">${[["happy", "im Plus"], ["worried", "knapp"], ["shock", "im Minus"], ["tired", "morgens"], ["sleep", "ab 21 Uhr"]].map(([m, t]) => `<span>${fkMascotSvg(m)}<small>${t}</small></span>`).join("")}</div>
        <p class="small help">😄 <b>Im Plus</b> freut es sich und wackelt · 😐 <b>knapp über der Warngrenze</b> guckt es skeptisch · 😱 <b>im Minus</b> erschrickt es · 🎉 Sind <b>alle Fixkosten abgehakt</b>, hüpft es einmal · 🥱 Morgens bis 9 Uhr gähnt es, 😴 ab 21 Uhr schläft es.</p>
        <p class="small"><b>👗 Kostüme</b> – das Schwein zieht sich selbst um, je nach Datum:</p>
        <div class="mascotprev">${[["spring", "Frühling"], ["summer", "Sommer"], ["autumn", "Herbst"], ["winter", "Winter"], ["bunny", "Ostern"], ["pumpkin", "Halloween"], ["santa", "Advent"], ["party", "Silvester"]].map(([c, t]) => `<span class="${fkMascotDeco() === c ? "now" : ""}">${fkMascotSvg("happy", c)}<small>${t}</small></span>`).join("")}</div>
        <p class="small help">🌸 März–Mai Blume · 😎 Juni–August Sonnenbrille · 🍂 September–November Blatt · 🧣 Dezember–Februar Schal · 🐰 Ostern Hasenohren · 🎃 17.10.–7.11. Kürbis · 🎅 bis 26.12. Mütze · 🎉 Silvester/Neujahr Partyhut. Das heutige Kostüm ist eingerahmt.</p>` },
      calm: { icon: "meditation", color: "#5c6bc0", title: "Ruhiger Modus", info: store.get(CALMKEY, false) ? "an – nur dieses Gerät" : "aus", html: () => `
        <label class="switch"><span>${ic("meditation")}Ruhiger Modus</span><input type="checkbox" class="swchk" data-a="setcalm" ${store.get(CALMKEY, false) ? "checked" : ""}></label>
        <p class="small help">Nur für <b>dieses Gerät</b>. Gedämpfte Farben, keine Animationen, das Sparschwein hält still – angenehm für empfindliche Augen und alte Tablets.</p>` },
      ...(this._app ? { theme: { icon: "theme-light-dark", color: "#37474f", title: "Hell / Dunkel", info: { light: "☀️ Hell", dark: "🌙 Dunkel" }[fkTheme()] || "🌓 Automatisch", html: () => `
        <p class="small help">Nur für die Offline-App auf diesem Gerät. „Automatisch“ richtet sich nach dem Handy – so wie Home Assistant auch.</p>
        <div class="btnrow">${[["auto", "🌓 Automatisch"], ["light", "☀️ Hell"], ["dark", "🌙 Dunkel"]].map(([v, l]) => `<button class="btn ${fkTheme() === v ? "main" : ""}" data-a="theme" data-v="${v}">${l}</button>`).join("")}</div>` } } : {}),
      check: { icon: "check-decagram-outline", color: "#43a047", title: "Alles ok?", info: "prüfen", html: () => this._checkHtml(d) },
      errors: { icon: "bug-outline", color: "#e53935", title: "Fehler-Protokoll", info: this._health ? (this._health.errors.length ? `${this._health.errors.length} Meldungen` : "keine Fehler 🎉") : "Meldungen ansehen", html: () => this._errorsHtml() },
      stats: { icon: "chart-donut", color: "#00897b", title: "Ressourcen", info: "Speicher & Umfang", html: () => this._statsHtml(d) },
      news: { icon: "new-box", color: "#fb8c00", title: "Was ist neu", info: `Version ${FK_VERSION}`, html: () => this._newsHtml() },
      credits: { icon: "hand-heart-outline", color: "#ec407a", title: "Credits", info: `v${FK_VERSION} · von Mister-M`, html: () => this._creditsHtml() },
    };
  }
  _setView(d) {
    // 🗂️ wie die Einkaufsliste: Kästen nach Zweck (zugeklappt), darin Zeilen mit bunten Symbolen – jede Zeile öffnet ein eigenes Fenster
    const sh = this._sheets(d);
    const cats = [["🧮", "Rechnen", ["rechnen", "quick"]], ["💾", "Daten", ["csv", "log", "hist", "factory"]], ["🩺", "Gesundheit", ["check", "errors", "stats"]], ["👁️", "Ansicht", ["view", "labels", "mascot", "calm", ...(this._app ? ["theme"] : [])]], ["📱", "App & Info", ["app", "pin", "privacy", "news", "credits"]]];
    return `<div class="sethead">${ic("cog-outline")}<span>Einstellungen</span></div>` + cats.map(([emo, title, keys]) => {
      const open = this._setOpen === title;
      const rows = open ? keys.map((k) => `<button class="lrow" data-a="sheet" data-v="${k}"><span class="ic" style="--ic:${sh[k].color}">${ic(sh[k].icon)}</span><span class="grow"><b>${sh[k].title}</b><small>${esc(sh[k].info)}</small></span>${ic("chevron-right")}</button>`).join("") : "";
      return `<div class="lgbox"><button class="lgroup" data-a="setgrp" data-v="${esc(title)}" aria-expanded="${open}"><span class="gem">${emo}</span><span class="grow"><b>${title}</b><small>${keys.map((k) => sh[k].title).join(", ")}</small></span>${ic(open ? "chevron-up" : "chevron-down")}</button>${rows}</div>`;
    }).join("");
  }
  // 📜 Verlauf: wer hat wann was geändert (neuestes oben, nach Tagen)
  _logHtml(d, admin) {
    const on = d.settings.log_on !== false, log = (d.log || []).slice().reverse();
    let day = "", rows = "";
    for (const e of log.slice(0, 150)) {
      const dt = new Date(e.ts), dk = dt.toLocaleDateString(fkLoc(), { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
      if (dk !== day) { day = dk; rows += `<div class="logday">${esc(dk)}</div>`; }
      rows += `<div class="logrow"><span class="lt">${dt.toLocaleTimeString(fkLoc(), { hour: "2-digit", minute: "2-digit" })}</span><span class="lx ${this._hidden ? "hidden-amt" : ""}">${esc(e.text)}</span>${e.by ? `<span class="tag">${esc(e.by)}</span>` : ""}</div>`;
    }
    return `<label class="switch"><span>${ic("history")}Verlauf an</span><input type="checkbox" class="swchk" data-a="setlog" ${on ? "checked" : ""}></label>
      <p class="small help">Merkt sich <b>wer wann was</b> geändert hat: abgehakt, Kontostand, Ausgaben, Töpfe, Bearbeiten … Die letzten 300 Einträge, nur in deinem Home Assistant.${this._queue.length ? " Was noch im Postausgang wartet, kommt dazu, sobald es angekommen ist." : ""}</p>
      ${log.length ? rows + (log.length > 150 ? `<p class="small">… und ${log.length - 150} ältere.</p>` : "") : `<p class="okmsg">Noch nichts passiert 🙂</p>`}
      ${admin && log.length ? `<div class="btnrow"><button class="btn" data-a="logclear">${ic("delete-sweep-outline")}Verlauf leeren</button></div>` : ""}`;
  }
  // 🩺 Alles ok? – sucht nach Dingen, die nicht zusammenpassen (wie bei der Einkaufsliste), jeder Fund mit „so reparierst du's“
  _checks(d) {
    const out = [], day = 86400000, now = Date.now();
    const gids = new Set(d.groups.map((g) => g.id));
    for (const p of d.posten.filter((x) => !gids.has(x.group))) out.push({ t: `„${p.name}“ hat keine Gruppe`, fix: "Unter „Bearbeiten“ antippen und eine Gruppe wählen – oder hier:", act: `<button class="btn small" data-a="fixgroup" data-id="${esc(p.id)}">${ic("wrench-outline")}In „${esc(d.groups[0]?.name || "")}“ schieben</button>` });
    for (const p of d.posten.filter((x) => !x.amount)) out.push({ t: `„${p.name}“ kostet ${money(0)}`, fix: "Unter „Bearbeiten“ den Betrag eintragen oder den Posten löschen." });
    if (!d.konto.updated) out.push({ t: "Kontostand wurde noch nie eingetragen", fix: "Oben auf die Kachel „Konto“ tippen." });
    else if (now - d.konto.updated > 7 * day) out.push({ t: `Kontostand ist ${Math.floor((now - d.konto.updated) / day)} Tage alt`, fix: "Oben auf die Kachel „Konto“ tippen und den Stand aus der Bank-App eintragen." });
    for (const b of d.bookings.filter((x) => !x.cleared && now - (x.ts || now) > 30 * day)) out.push({ t: `Ausgabe „${b.name}“ ist seit über 30 Tagen nicht abgebucht`, fix: "Längst auf dem Konto? Den Kreis vorne antippen. Sonst löschen." });
    for (const t of d.toepfe.filter((x) => x.amount < 0)) out.push({ t: `Topf „${t.name}“ steht im Minus`, fix: "Topf antippen und den richtigen Stand setzen." });
    for (const k of d.konten.filter((x) => x.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(String(x.iban).replace(/\s/g, "")))) out.push({ t: `IBAN von „${k.name}“ sieht komisch aus`, fix: "Unter „Bearbeiten“ → Meine Konten nachsehen." });
    if (d.month && d.month !== monthKey()) out.push({ t: "Der Monat wurde noch nicht umgestellt", fix: "Passiert normalerweise um Mitternacht von selbst. Läuft Home Assistant?" });
    if (d.settings.warn_enabled !== false && !(d.settings.warn_below > 0)) out.push({ t: `Warngrenze ist ${money(0)}`, fix: "⚙️ → Rechnen & Warnung: Grenze eintragen oder die Warnung ausschalten." });
    return out;
  }
  _checkHtml(d) {
    const res = this._checks(d);
    return `<p class="small help">Sucht nach Dingen, die nicht zusammenpassen: Posten ohne Gruppe oder ohne Betrag, alter Kontostand, vergessene Ausgaben, Töpfe im Minus, komische IBANs. Jeder Fund steht einzeln da – mit „so reparierst du's“.</p>
      ${res.length ? `<p><b>${res.length} ${res.length === 1 ? "Sache" : "Sachen"} gefunden:</b></p>` + res.map((x) => `<div class="finding"><b>⚠️ ${esc(x.t)}</b><div class="small" style="margin:2px 0 0">${x.fix}</div>${x.act ? `<div class="btnrow">${x.act}</div>` : ""}</div>`).join("") : `<p class="okmsg">✅ Alles ok – nichts gefunden. 🎉</p>`}`;
  }
  async _loadHealth() {
    try { this._health = await this._hass.callWS({ type: "fixkosten/health", ...this._bk() }); }
    catch (_) { this._health = { errors: [], size: 0, counts: {}, offline: true }; }
    this._force = true; this._render();
  }
  _errorsHtml() {
    const h = this._health;
    if (!h) return `<p class="small">Lade …</p>`;
    if (h.offline) return `<p class="small">📴 Das Protokoll liegt in Home Assistant – dafür braucht es Netz.</p>`;
    return `<p class="small help">Hier steht, was beim Speichern nicht geklappt hat (z. B. eine Änderung, die Home Assistant abgelehnt hat). Nur Art und Fehler, keine Beträge. Wird beim Neustart von Home Assistant geleert.</p>
      ${h.errors.length ? h.errors.map((e) => `<div class="finding"><b>${esc(e.error)}</b><div class="small" style="margin:2px 0 0">${new Date(e.ts).toLocaleString(fkLoc())} · ${esc(e.type)}${e.by ? ` · ${esc(e.by)}` : ""}</div></div>`).join("")
        + `<div class="btnrow"><button class="btn" data-a="errclear">${ic("delete-sweep-outline")}Protokoll leeren</button></div>` : `<p class="okmsg">Keine Fehler 🎉</p>`}`;
  }
  _statsHtml(d) {
    const h = this._health;
    if (!h) return `<p class="small">Lade …</p>`;
    const kb = (n) => n > 1024 * 1024 ? `${(n / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
    const c = h.counts || {};
    const rows = [["Fixkosten", c.posten], ["Gruppen", c.groups], ["Einnahmen", c.einnahmen], ["Ausgaben (gemerkt)", c.bookings], ["Töpfe", c.toepfe], ["Offene Stände", c.staende], ["Meine Konten", c.konten], ["Rückblick (Monate)", c.history]];
    let local = 0;
    try { for (const k of [this._dk, this._qk, HKEY]) local += (localStorage.getItem(k) || "").length; } catch (_) { /* egal */ }
    return `<p class="small">So viel Platz brauchen die Fixkosten.</p>
      ${h.offline ? `<p class="small">📴 Ohne Netz sieht man nur den Platz auf diesem Gerät.</p>` : `<table><tr><td>In Home Assistant</td><td><b>${kb(h.size)}</b></td></tr>${rows.map(([l, n]) => `<tr><td>${l}</td><td>${n ?? 0}</td></tr>`).join("")}</table>`}
      <table><tr><td>Auf diesem Gerät</td><td><b>${kb(local)}</b></td></tr><tr><td>Im Postausgang</td><td>${this._queue.length}</td></tr></table>`;
  }

  // 🪟 Einstellungs-Seite IN der Karte (wie bei der Einkaufsliste), ← bringt zurück zur Liste der Einstellungen
  _sheetPage(d) {
    const x = this._sheets(d)[this._sheet];
    return x ? { icon: x.icon, color: x.color, title: x.title, html: x.html() } : null;
  }

  // ---------------------------------------------------------------- 👆 Klicks
  // ⓘ wie bei der Einkaufsliste: Erklärtexte sind zu, ein kleines ⓘ neben dem Feld (oder der Überschrift) klappt sie auf
  _helpify() {
    const root = this.shadowRoot, ps = [...root.querySelectorAll("p.help")];
    if (!ps.length) return;
    this._fhOpen = this._fhOpen || new Set();
    const pg = this._view + ":" + (this._sheet || ""), tip = fkT("Was ist das?");
    const btn = (k, open) => { const b = document.createElement("button"); b.type = "button"; b.className = "finfo"; b.dataset.a = "finfo"; b.dataset.v = k; b.title = tip; b.setAttribute("aria-label", tip); b.setAttribute("aria-expanded", String(open)); b.textContent = "i"; return b; };
    let headBtn = null;
    ps.forEach((p, i) => {
      const prev = p.previousElementSibling, sw = prev?.classList.contains("switch") ? prev : null;
      const k = sw ? `${pg}:${i}` : `${pg}:head`, open = this._fhOpen.has(k);
      p.classList.add("fhint"); p.dataset.h = k; p.hidden = !open;
      if (sw) (sw.firstElementChild || sw).appendChild(btn(k, open));
      else if (!headBtn) { const h = root.querySelector(".pagehost .sechead h3"); if (h) { headBtn = btn(k, open); h.after(headBtn); } else p.hidden = false; }
    });
  }
  _bind() {
    const root = this.shadowRoot;
    root.querySelectorAll("input,textarea,select").forEach((el) => el.addEventListener("blur", () => {
      setTimeout(() => { if (this._pending && !["INPUT", "TEXTAREA", "SELECT"].includes(root.activeElement?.tagName)) { this._pending = false; this._render(); } }, 150);
    }));
    root.querySelectorAll("form").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); this._submit(f, e.submitter); }));
    // 📖 Anleitung: immer nur ein Kasten offen, Suche zeigt nur passende Kästen (wie bei der Einkaufsliste)
    const gsecs = [...root.querySelectorAll("details.elg-sec")];
    let searching = false;
    gsecs.forEach((x) => x.addEventListener("toggle", () => { if (x.open && !searching) gsecs.forEach((o) => { if (o !== x) o.open = false; }); }));
    const gq = root.querySelector(".elg-q");
    if (gq) {
      const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss");
      const texts = gsecs.map((x) => norm(x.textContent));
      gq.addEventListener("input", () => {
        const words = norm(gq.value).split(/\s+/).filter(Boolean);
        searching = words.length > 0;
        let hits = 0;
        gsecs.forEach((x, i) => { const hit = !words.length || words.every((w) => texts[i].includes(w)); x.hidden = !hit; x.open = !!words.length && hit; if (hit && words.length) hits++; });
        root.querySelector(".elg-none").hidden = !words.length || hits > 0;
      });
    }
    root.querySelectorAll("[data-grip]").forEach((g) => {
      g.addEventListener("pointerdown", (e) => this._startDrag(g, e));
      g.addEventListener("click", (e) => e.stopPropagation());
    });
    root.querySelectorAll("[data-a]").forEach((el) => {
      if (el.tagName === "FORM") return;
      const ev = (el.tagName === "INPUT" && el.type !== "file") || el.tagName === "SELECT" ? "change" : el.type === "file" ? "change" : "click";
      el.addEventListener(ev, (e) => {
        if (el.dataset.v === "bg" && e.target !== el) return; // Klick IM Fenster schließt es nicht
        if (el.dataset.a !== "month") e.stopPropagation(); this._act(el, e);
      });
    });
  }

  _act(el, e) {
    const a = el.dataset.a, id = el.dataset.id, d = this._data;
    const redraw = () => { this._force = true; this._render(); };
    if (a === "finfo") {
      e?.preventDefault?.(); const k = el.dataset.v, hs = this.shadowRoot.querySelectorAll(`p.fhint[data-h="${k}"]`), open = !this._fhOpen.has(k);
      if (open) this._fhOpen.add(k); else this._fhOpen.delete(k);
      hs.forEach((h) => { h.hidden = !open; }); el.setAttribute("aria-expanded", String(open)); return;
    }
    if (a === "awake") {
      if (this._awakeOn) { this._awakeStop(); this._toast("💡 Bildschirm wieder normal"); redraw(); return; }
      this._awakeOn = true; redraw();
      if (!this._awakeVis) { // 🌑 Display aus (oder andere App) = „Bildschirm an“ ganz aus, Glühbirne wieder aus
        this._awakeVis = () => { if (document.visibilityState === "hidden" && this._awakeOn) { this._awakeStop(); redraw(); } };
        document.addEventListener("visibilitychange", this._awakeVis);
      }
      fkKeepAwake(null, this._inHaApp()).then((w) => {
        if (!this._awakeOn || this._awakeH) { w.stop(); return; }
        if (!w.mode) { this._awakeOn = false; redraw(); this._toast(this._awakeHint()); w.stop(); return; }
        this._awakeH = w; this._toast("💡 Bildschirm bleibt an");
      }).catch(() => { this._awakeOn = false; redraw(); });
    }
    else if (a === "calc") { this._calc = this._calc ? null : { expr: "" }; redraw(); }
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
      else if (el.dataset.v === "balance") { if (fkConfirm(`Kontostand auf ${money(r)} setzen?`)) { this._calc = null; this._send({ type: "konto", balance: r }); } }
      else fkCopy(numDe(r), null).then(() => this._toast("📋 Kopiert"));
    }
    else if (a === "lock") {
      const appLock = this._app && window.__fkAppLock?.on?.();
      if (appLock) { PIN_LOCK.until = 0; this._pad = null; this._sheet = null; this._view = "home"; this._open = null; redraw(); window.__fkAppLock.now(); return; } // 📱 ganze App sperren (Fingerabdruck)
      if (!d?.pin) { this._toast("🔒 Erst eine PIN festlegen – dann sperrt das Schloss ⚙️ und Bearbeiten"); this._view = "set"; this._sheet = "pin"; this._pad = null; }
      else if (pinOpen()) { PIN_LOCK.until = 0; this._pad = null; this._toast("🔒 Gesperrt"); if (this._view === "edit" || this._view === "set") { this._view = "home"; this._sheet = null; } }
      else this._view = "set";
      this._open = null; redraw();
    }
    else if (a === "back") {
      if (this._pad) { const back = this._pad.back; this._pad = null; if (back !== "sheet") { this._view = "home"; this._sheet = null; } }
      else if (this._view === "set" && this._sheet === "quick" && this._qSel != null) this._qSel = null; // ⚡ erst zurück zur Knopf-Liste
      else if (this._view === "set" && this._sheet) this._sheet = null;
      else { this._view = "home"; this._sheet = null; }
      this._open = null; redraw();
    }
    else if (a === "pkey") this._padPress(el.dataset.v);
    else if (a === "padstart") { this._pad = { purpose: el.dataset.v, step: d.pin ? "old" : "new", buf: "", back: "sheet" }; redraw(); }
    else if (a === "reload") {
      // 🔄 nur die eigenen Zwischenspeicher leeren und den Offline-Helfer zum Aktualisieren bitten – wie bei der Einkaufsliste
      try { caches?.keys?.().then((ks) => ks.filter((k) => k.startsWith("fixkosten-")).forEach((k) => caches.delete(k))); } catch (_) { /* egal */ }
      try { navigator.serviceWorker?.getRegistrations?.().then((rs) => rs.forEach((r) => { if (/\/fixkosten\/app\//.test(r.scope)) r.update().catch(() => {}); })); } catch (_) { /* egal */ }
      setTimeout(() => location.reload(), 300);
    }
    else if (a === "sec") { const k = el.dataset.v; this._openSec.has(k) ? this._openSec.delete(k) : this._openSec.add(k); redraw(); }
    else if (a === "sheet") { this._sheet = el.dataset.v; this._qSel = null; redraw(); if (["errors", "stats"].includes(this._sheet)) this._loadHealth(); }
    else if (a === "errclear") { this._hass.callWS({ type: "fixkosten/errors_clear", ...this._bk() }).then(() => this._loadHealth(), () => this._toast("📴 Geht nur mit Netz")); }
    else if (a === "fixgroup") { const p = d.posten.find((x) => x.id === id); if (p && d.groups[0]) this._send({ type: "posten_save", item: { id, group: d.groups[0].id } }); }
    else if (a === "factory") {
      if (!fkConfirm("Wirklich ALLES zurücksetzen?\n\nFixkosten, Gruppen, Einnahmen, Ausgaben, Töpfe, offene Stände, Konten, Kontostand, Rückblick und alle Schalter werden gelöscht. Nur die PIN bleibt.\n\nDas geht nicht rückgängig.")) return;
      if (!fkConfirm("Letzte Frage: Wirklich ALLES auf Werkseinstellungen setzen?")) return;
      this._queue = []; store.put(this._qk, this._queue);
      this._hass.callWS({ type: "fixkosten/factory_reset", ...this._bk() }).then(() => { this._toast("💣 Alles zurückgesetzt"); this._sheet = null; this._view = "home"; this._force = true; this._render(); }, (err) => this._toast("⚠️ " + (err?.message || "Das hat nicht geklappt")));
    }
    else if (a === "setgrp") { this._setOpen = this._setOpen === el.dataset.v ? null : el.dataset.v; redraw(); }
    else if (a === "appcopy") { const u = d.app_url || ""; fkCopy(u, this.shadowRoot.getElementById("appUrl")).then(() => this._toast("📋 Adresse kopiert")); }
    else if (a === "qsel") { this._qSel = el.dataset.v; redraw(); }
    else if (a === "qback") { this._qSel = null; redraw(); }
    else if (a === "qicon") { const ics = { ...(d.settings.quick_icons || {}) }; if (el.dataset.i) ics[el.dataset.v] = el.dataset.i; else delete ics[el.dataset.v]; this._send({ type: "settings", settings: { quick_icons: ics } }); }
    else if (a === "qrename") {
      const old = el.dataset.v, nu = el.value.trim().slice(0, 30), list = [...(d.settings.quick || [])];
      if (!nu || nu === old) { el.value = old; return; }
      if (list.some((q) => q.toLowerCase() === nu.toLowerCase() && q !== old)) { this._toast("Den Knopf gibt es schon"); el.value = old; return; }
      const ko = old.toLowerCase(), kn = nu.toLowerCase(), cols = { ...(d.settings.quick_colors || {}) }, ics = { ...(d.settings.quick_icons || {}) };
      if (ko !== kn) { if (cols[ko]) { cols[kn] = cols[ko]; delete cols[ko]; } if (ics[ko]) { ics[kn] = ics[ko]; delete ics[ko]; } }
      this._qSel = nu;
      this._quickSave(list.map((q) => (q === old ? nu : q)), { quick_colors: cols, quick_icons: ics });
    }
    else if (a === "qdel") {
      const name = el.dataset.v, old = { quick: [...(d.settings.quick || [])], quick_colors: { ...(d.settings.quick_colors || {}) }, quick_icons: { ...(d.settings.quick_icons || {}) } };
      this._qSel = null;
      this._quickSave(old.quick.filter((q) => q !== name));
      clearTimeout(this._undoT);
      this._undo = { label: `🗑️ Schnellknopf weg: „${name}“`, op: { type: "settings", settings: old } };
      this._undoT = setTimeout(() => { this._undo = null; this._force = true; this._render(); }, 8000);
    }
    else if (a === "qcolreset") { const c = { ...(d.settings.quick_colors || {}) }; delete c[el.dataset.v]; this._send({ type: "settings", settings: { quick_colors: c } }); }
    else if (a === "hide") { this._hidden = !this._hidden; store.put(HKEY, this._hidden); redraw(); }
    else if (a === "tab") { this._view = el.dataset.v; this._open = null; this._sheet = null; if (this._pad?.step !== "unlock") this._pad = null; redraw(); }
    else if (a === "lentoff") { // 🐷 Geliehenes nicht mehr zurücklegen: Zettel weg, Geld gilt als ausgegeben
      const t = d.toepfe.find((x) => x.id === id);
      if (!t || !fkConfirm(`${money(t.lent)} aus „${t.name}“ nicht mehr zurücklegen?\n\nDer orange Zettel verschwindet, das Geld gilt als ausgegeben. Der Topf-Stand bleibt wie er ist.`)) return;
      this._open = null; this._force = true; this._send({ type: "topf_keep", id }); this._toast("✓ Zettel weg – Geld gilt als ausgegeben");
    }
    else if (a === "recv") this._send({ type: "received", id, value: !d.received?.[id]?.paid, month: d.month });
    else if (a === "mprice" && this._open?.kind === "mprice" && this._open.id === id) { this._open = null; redraw(); } // nochmal antippen = zuklappen
    else if (a === "mprice") { this._open = { kind: "mprice", id }; redraw(); setTimeout(() => { const i = this.shadowRoot.querySelector('form[data-a="mpsave"] input'); i?.focus(); i?.select?.(); }, 30); }
    else if (a === "mpreset") { this._open = null; this._force = true; this._send({ type: "posten_month", id, amount: "", month: d.month }); this._toast("↺ Wieder der normale Preis"); }
    else if (a === "paid") this._send({ type: "paid", id, value: !d.paid[id]?.paid, month: d.month });
    else if (a === "quick") { this._quickName = this._quickName === el.dataset.v ? null : el.dataset.v; redraw(); setTimeout(() => this.shadowRoot.querySelector('input[name="amount"]')?.focus(), 30); }
    else if (a === "settle") this._removeWithUndo("stand", id, { type: "stand_delete", id }, "✓ Beglichen");
    else if (a === "copy") {
      const k = d.konten.find((x) => x.id === id);
      const raw = (k?.iban || "").replace(/\s/g, "");
      fkCopy(raw, null).then(() => this._toast("📋 IBAN kopiert"));
    }
    else if (a === "clear") {
      const b = d.bookings.find((x) => x.id === id);
      clearTimeout(this._undoT);
      this._undo = { label: `✓ Abgebucht: „${b?.name || ""}“`, op: { type: "booking_clear", id, value: false } };
      this._undoT = setTimeout(() => { this._undo = null; this._force = true; this._render(); }, 8000);
      this._send({ type: "booking_clear", id, value: true });
    }
    else if (a === "bdel") this._open = null, this._removeWithUndo("booking", id, { type: "booking_delete", id }, "🗑️ Gelöscht");
    else if (a === "undo") { const u = this._undo; this._undo = null; clearTimeout(this._undoT); if (u) this._send(u.op); else redraw(); }
    else if (a === "balance") { this._view = "konto"; this._open = null; this._calc = null; redraw(); setTimeout(() => this.shadowRoot.querySelector('form[data-a="kontosave"] input')?.select(), 30); }
    else if ((a === "open" || a === "new") && this._dragEnd && Date.now() - this._dragEnd < 400) { /* gerade gezogen */ }
    else if (a === "open" && this._open?.kind === el.dataset.k && this._open.id === id) { this._open = null; redraw(); } // ✏️ nochmal antippen = zuklappen
    else if (a === "open" || a === "new") { this._open = { kind: el.dataset.k, id: a === "new" ? "new" : id }; redraw(); }
    else if (a === "cancel") { this._open = null; redraw(); }
    else if (a === "month") { e.preventDefault(); el.classList.toggle("on"); }
    else if (a === "del") {
      const k = el.dataset.k;
      if (k === "gruppe") { if (fkConfirm("Gruppe löschen? Ihre Posten wandern in die erste Gruppe.")) { this._open = null; this._send({ type: "gruppe_delete", id }); } }
      else { this._open = null; this._removeWithUndo(k, id, { type: `${k}_delete`, id }, "🗑️ Gelöscht"); }
    } else if (a === "setreset") this._send({ type: "settings", settings: { reset_checks: el.checked } });
    else if (a === "setdebts") this._send({ type: "settings", settings: { debts_subtract: el.checked } });
    else if (a === "setlog") this._send({ type: "settings", settings: { log_on: el.checked } });
    else if (a === "setview") this._send({ type: "settings", settings: { view: { [el.dataset.v]: el.checked } } });
    else if (a === "setlabels") this._send({ type: "settings", settings: { labels: el.checked } });
    else if (a === "setmascot") this._send({ type: "settings", settings: { mascot: el.checked } });
    else if (a === "peek") { // 🙈 4 Sekunden zeigen, dann wieder verschwimmen
      clearTimeout(this._peekT);
      this._peek = { key: el.dataset.v, until: Date.now() + 4000 };
      el.classList.add("peek");
      this._peekT = setTimeout(() => { this._peek = null; this.shadowRoot.querySelectorAll(".veil.peek").forEach((x) => x.classList.remove("peek")); }, 4000);
    }
    else if (a === "setlockall") this._send({ type: "settings", settings: { lock_all: el.checked } });
    else if (a === "setveil") this._send({ type: "settings", settings: { veil: el.checked } });
    else if (a === "setcalm") { store.put(CALMKEY, el.checked); redraw(); }
    else if (a === "theme") { // 🌓 nur Offline-App
      const v = el.dataset.v;
      try { v === "auto" ? localStorage.removeItem(THEMEKEY) : localStorage.setItem(THEMEKEY, v); } catch (_) { /* egal */ }
      v === "auto" ? document.documentElement.removeAttribute("data-theme") : document.documentElement.setAttribute("data-theme", v);
      redraw();
    }
    else if (a === "logclear") { if (fkConfirm("Den ganzen Verlauf löschen?")) this._send({ type: "log_clear" }); }
    else if (a === "setwarnon") this._send({ type: "settings", settings: { warn_enabled: el.checked } });
    else if (a === "qcolor") this._send({ type: "settings", settings: { quick_colors: { ...(d.settings.quick_colors || {}), [el.dataset.v]: el.value } } });
    else if (a === "setcur") this._send({ type: "settings", settings: { currency: el.value } });
    else if (a === "setwarn") { const v = parseMoney(el.value); if (!Number.isNaN(v)) this._send({ type: "settings", settings: { warn_below: v } }); }
    else if (a === "resetnow") { if (fkConfirm("Alle Haken dieses Monats entfernen?")) this._send({ type: "reset_checks" }); }
    else if (a === "file") {
      const file = el.files?.[0];
      if (file) file.text().then((t) => { this.shadowRoot.querySelector('[data-a="csv"]').value = t; });
    } else if (a === "import") this._import();
    else if (a === "export") this._export(d);
  }

  async _pin(type, payload) {
    if (this._hass?.connected === false) { this._toast("📴 PIN ändern oder ausschalten geht nur mit Netz – entsperren klappt auch offline"); return null; }
    try { return await this._hass.callWS({ type, ...payload, ...this._bk() }); }
    catch (err) { this._toast("⚠️ " + (err?.message || "Ging nicht")); return null; }
  }

  _submit(f, submitter) {
    const a = f.dataset.a, data = Object.fromEntries(new FormData(f).entries());
    if (a === "qadd") { // ⚡ neuer Schnellknopf
      const n = String(data.name || "").trim().slice(0, 30), list = this._data.settings.quick || [];
      if (!n) { this._toast("Bitte einen Namen eintippen"); return; }
      if (list.some((q) => q.toLowerCase() === n.toLowerCase())) { this._toast("Den Knopf gibt es schon"); return; }
      this._quickSave([...list, n]); this._toast(`⚡ „${n}“ ist dazu`);
      return;
    }
    if (a === "kontosave") {
      const v = parseMoney(data.balance);
      if (Number.isNaN(v) || String(data.balance || "").trim() === "") { this._toast("Bitte den Kontostand eintippen"); return; }
      this._view = "home"; this.shadowRoot.activeElement?.blur(); this._force = true;
      this._send({ type: "konto", balance: v });
      return;
    }
    if (a === "potmove") {
      const v = parseMoney(data.amount), act = submitter?.value === "return" ? "return" : "take"; // ↵ Enter = Rausnehmen
      if (Number.isNaN(v) || !v || String(data.amount || "").trim() === "") { this._toast("Bitte einen Betrag eintippen"); return; }
      const id = f.dataset.id;
      this._open = null; this.shadowRoot.activeElement?.blur(); this._force = true;
      this._send({ type: act === "return" ? "topf_return" : "topf_take", id, amount: Math.abs(v) }); this._toast(act === "return" ? `➕ ${money(Math.abs(v))} zurückgelegt` : `➖ ${money(Math.abs(v))} rausgenommen`);
      return;
    }
    if (a === "potset") { // ✏️ Stand korrigieren: eigenes Feld, damit „Rausnehmen“ nie aus Versehen den Stand überschreibt
      const v = String(data.stand || "").trim() === "" ? 0 : parseMoney(data.stand); // leer = 0,00 (Marco)
      if (Number.isNaN(v)) { this._toast("Bitte den Stand eintippen"); return; }
      this._open = null; this.shadowRoot.activeElement?.blur(); this._force = true;
      this._send({ type: "topf_save", item: { id: f.dataset.id, amount: v } }); this._toast(`✏️ Stand jetzt ${money(v)}`);
      return;
    }
    if (a === "mpsave") { // 💶 Preis nur für diesen Monat (gleich wie normal = Sonderpreis weg)
      const v = parseMoney(data.amount), p = this._data?.posten?.find((x) => x.id === f.dataset.id);
      if (Number.isNaN(v) || String(data.amount || "").trim() === "") { this._toast("Bitte einen Betrag eintippen"); return; }
      const same = p && Math.abs(Math.abs(v) - p.amount) < 0.005;
      this._open = null; this.shadowRoot.activeElement?.blur(); this._force = true;
      this._send({ type: "posten_month", id: f.dataset.id, amount: same ? "" : Math.abs(v), month: this._data?.month });
      this._toast(same ? "↺ Wieder der normale Preis" : `💶 Nur diesen Monat: ${money(Math.abs(v))}`);
      return;
    }
    if (a === "bsave") {
      const amount = parseMoney(data.amount);
      if (!amount || Number.isNaN(amount)) { this._toast("Bitte einen Betrag eintippen"); return; }
      this._open = null; this.shadowRoot.activeElement?.blur(); this._force = true;
      this._send({ type: "booking_edit", id: f.dataset.id, name: (data.name || "").trim() || "Ausgabe", amount });
      return;
    }
    if (a === "booking") {
      const amount = parseMoney(data.amount);
      if (!amount || Number.isNaN(amount)) { this._toast("Bitte einen Betrag eintippen"); return; }
      this._quickName = null; this._prefAmount = null;
      f.reset();
      this.shadowRoot.activeElement?.blur();
      this._force = true;
      this._send({ type: "booking_add", name: (data.name || "").trim() || "Ausgabe", amount });
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
        const until = data.until_m ? `${data.until_y}-${data.until_m}` : String(data.until || "").trim(); // 💳 Ratenzahlung bis (JJJJ-MM)
        if (until && !/^\d{4}-(0[1-9]|1[0-2])$/.test(until)) { this._toast("Raten bis: Monat wählen oder leer lassen"); return; }
        item.until = until || null;
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
    if (replace && !fkConfirm("Vorhandene Posten, Einnahmen und Töpfe werden ersetzt. Weiter?")) return;
    try {
      const r = await this._hass.callWS({ type: "fixkosten/import", text, replace, ...this._bk() });
      this._toast(`✅ Eingelesen: ${r.ausgaben} Fixkosten, ${r.einnahmen} Einnahmen, ${r.toepfe} Töpfe, ${r.staende} offene Stände, ${r.konten} Konten${r.uebersprungen ? `, ${r.uebersprungen} Zeilen übersprungen` : ""}`);
      this._view = "home"; this._sheet = null; this._force = true; this._render();
    } catch (err) { this._toast("⚠️ " + (err?.message || "Einlesen ging nicht (ohne Netz geht das nicht)")); }
  }

  _export(d) {
    const num = (v) => String((Number(v) || 0).toFixed(2)).replace(".", ",");
    const gday = (id) => d.groups.find((g) => g.id === id)?.start_day || "";
    const q = (x) => /[;"\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x ?? "");
    const day = (ms) => ms ? new Date(ms).toLocaleDateString(fkLoc(), { day: "2-digit", month: "2-digit", year: "numeric" }) : ""; // 📅 TT.MM.JJJJ
    const upd = day(d.summary?.balance_updated);
    const lines = ["Typ;Name;Betrag;Gruppe/Datum;Zahlart;Notiz",
      ["kontostand", "Konto", num(d.summary?.balance), upd, "", ""].map(q).join(";"), // 🏦 Kontostand mit Datum (für Tabellen & Sicherung)
      ...d.posten.map((p) => ["ausgabe", p.name, num(p.amount), gday(p.group), (PAY[p.pay] || PAY.keine)[1], p.note || ""].map(q).join(";")),
      ...d.einnahmen.map((e) => ["einnahme", e.name, num(e.amount), e.date || "", (PAY[e.pay] || PAY.keine)[1], e.note || ""].map(q).join(";")),
      ...d.toepfe.map((t) => ["topf", t.name, num(t.amount), day(t.updated), "", ""].map(q).join(";")),
      ...d.staende.map((x) => ["stand", x.name, num(x.amount), day(x.updated), "", x.note || ""].map(q).join(";")),
      ...d.konten.map((k) => ["iban", k.name, k.iban, "", "", k.note || ""].map(q).join(";"))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv" }));
    a.download = `fixkosten-${d.month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}

// ↩️ Zurück-Taste am Handy (wie bei der Einkaufsliste): Solange in der Karte eine Unterseite offen ist, liegt ein „Merkzettel“ im Verlauf.
// Zurück nimmt ihn weg und geht genau einen Schritt zurück (PIN → Einstellungen → Übersicht) – die Seite selbst bleibt stehen.
(function fkBackGuard() {
  if (window.__fkBackGuard) return;
  window.__fkBackGuard = true;
  let timer = null, ignorePop = false;
  const live = () => [...FK_CARDS].filter((c) => c.isConnected);
  const isOpen = () => live().some((c) => !c.fixkostenIsRoot());
  const push = (state) => {
    const prev = history.scrollRestoration;
    try { history.scrollRestoration = "manual"; } catch (_) { /* egal */ }
    history.pushState(state, "");
    try { history.scrollRestoration = prev || "auto"; } catch (_) { /* egal */ }
  };
  const sync = () => {
    timer = null;
    const open = isOpen(), st = history.state;
    if (open && !st?.fkCardGuard) push({ ...(st || {}), fkCardGuard: 1 });
    else if (!open && st?.fkCardGuard) { ignorePop = true; history.back(); }
  };
  window.addEventListener("popstate", () => {
    if (ignorePop) { ignorePop = false; return; }
    if (history.state?.fkCardGuard) return;
    const c = live().find((x) => !x.fixkostenIsRoot());
    if (c?.fixkostenBack()) setTimeout(sync, 60);
  });
  window.addEventListener("fixkosten-nav", () => { if (!timer) timer = setTimeout(sync, 80); });
})();

if (!customElements.get("fixkosten-card")) customElements.define("fixkosten-card", FixkostenCard);
FixkostenCard.mascotDeco = fkMascotDeco; // 🧪 für Tests: welches Kostüm an welchem Tag
FixkostenCard.i18n = { fkBlockKey, fkNorm, fkT, skip: FK_SKIP, attrs: FK_ATTRS }; // 🧪 für Tests: Übersetzung

// ✏️ Karten-Editor: Titel, welches Buch, Beträge erst nach Antippen zeigen
class FixkostenCardEditor extends HTMLElement {
  setConfig(config) { this._config = { ...config }; this._draw(); }
  set hass(hass) {
    const first = !this._hass; this._hass = hass;
    if (first) hass.callWS({ type: "fixkosten/books" }).then((r) => { this._books = r.books || []; this._draw(); }, () => { this._books = []; this._draw(); });
  }
  _set(key, value) {
    const c = { ...this._config };
    if (value === "" || value === false || value == null) delete c[key]; else c[key] = value;
    this._config = c;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: c }, bubbles: true, composed: true }));
  }
  _draw() {
    if (!this._config) return;
    const c = this._config, books = this._books || [];
    const esc2 = (x) => String(x ?? "").replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
    const opts = books.map((b) => `<option value="${b.primary ? "" : esc2(b.title)}" ${(b.primary ? !c.buch : String(c.buch || "").toLowerCase() === b.title.toLowerCase()) ? "selected" : ""}>${esc2(b.title)}${b.primary ? " (erstes Buch)" : ""}</option>`).join("");
    this.innerHTML = `<div style="display:grid;gap:12px;padding:4px 0">
      <label style="display:grid;gap:4px">Titel<input data-k="title" value="${esc2(c.title || "")}" style="padding:8px;border-radius:8px;border:1px solid var(--divider-color,#ccc);background:none;color:inherit;font:inherit"></label>
      <label style="display:grid;gap:4px">📚 Welches Buch?<select data-k="buch" style="padding:8px;border-radius:8px;border:1px solid var(--divider-color,#ccc);background:var(--card-background-color,#fff);color:inherit;font:inherit">${opts || `<option value="">Fixkosten</option>`}</select>
        <small style="opacity:.7">Weitere Bücher: Einstellungen → Geräte &amp; Dienste → Fixkosten → Eintrag hinzufügen. Mit „Sichtbarkeit“ der Karte siehst du nur dein eigenes Buch.</small></label>
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-k="privat" ${c.privat ? "checked" : ""}> 🙈 Beträge erst nach Antippen zeigen</label>
      <label style="display:grid;gap:4px">🌍 Sprache / Language<select data-k="language" style="padding:8px;border-radius:8px;border:1px solid var(--divider-color,#ccc);background:var(--card-background-color,#fff);color:inherit;font:inherit">${[["", "Automatisch (wie Home Assistant)"], ["de", "Deutsch"], ["en", "English"]].map(([v, t]) => `<option value="${v}" ${(c.language || "") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>`;
    this.querySelector('[data-k="title"]').addEventListener("change", (e) => this._set("title", e.target.value));
    this.querySelector('[data-k="buch"]').addEventListener("change", (e) => this._set("buch", e.target.value));
    this.querySelector('[data-k="privat"]').addEventListener("change", (e) => this._set("privat", e.target.checked));
    this.querySelector('[data-k="language"]').addEventListener("change", (e) => this._set("language", e.target.value));
  }
}
if (!customElements.get("fixkosten-card-editor")) customElements.define("fixkosten-card-editor", FixkostenCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "fixkosten-card")) {
  window.customCards.push({ type: "fixkosten-card", name: "Fixkosten", description: "Monatliche Fixkosten, Ausgaben und was noch verfügbar ist.", preview: false });
}
console.info(`%c 💶 FIXKOSTEN %c v${FK_VERSION} `, "background:#43a047;color:#fff;border-radius:3px 0 0 3px", "background:#333;color:#fff;border-radius:0 3px 3px 0");
