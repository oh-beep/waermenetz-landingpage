# Wärmenetz-Formularservice

Versionierte Node-24-Laufzeit für den bestehenden Dienst auf Port5020. Die statische Seite verwendet die vorhandene gleichnamige HTTPS-Origin und prüft den JSON-Erfolg. Der Google-Apps-Script-Endpunkt ist für diese Seite nicht mehr erforderlich; seine anderen Nutzer werden nicht verändert.

Credentials: `BREVO_KEY` aus der geschützten Laufzeit oder `/etc/waermenetz-doi/credentials.json` mit Feld `brevoKey`. Kein Schlüssel im Git. Datenbank: bestehende `/home/deploy/waermenetz-doi/pending.db`, für isolierte Tests `DOI_DB_PATH`. Credentials-Datei nur für den Dienstbenutzer lesbar. Der Server bindet ausschließlich127.0.0.1.

Deployment: Node24.19.0 und exakt eingechecktes package-lock; `npm ci --omit=dev` auf Linux, native SQLite-ABI prüfen. Vorher vorhandene Service-Dateien und eine konsistente SQLite-Sicherung erstellen. Alten statischen index.html sichern. Neue API zunächst isoliert prüfen, dann mit geschütztem Schlüssel und unveränderter DB auf5020 starten; `/api/health` muss db=ok und providerConfigured=true melden, `/api/version` die Release-SHA. Erst danach die gleichnamige Formular-Origin in index.html veröffentlichen. Bei Fehlern Code, native Abhängigkeiten und alten Node-Interpreter gemeinsam zurücksetzen. Die additive processing_at-Spalte kann erhalten bleiben.

Tests verwenden synthetische Adressen und einen injizierten Provider. Sie senden keine echten E-Mails. Newsletter-Anmeldung erfolgt erst nach Bestätigung; eine Interessenbekundung wird ohne ausdrückliche Newsletter-Auswahl nicht zusätzlich abonniert. Bestätigungslinks sind einmalig und laufen nach30Tagen ab. Anwendungslogs enthalten keine Providerantworten oder Formulardaten.

`npm test` prüft gültige, wiederholte, abgelaufene und fehlerhafte Abläufe, Providerfehler, HTML-Escaping und Origin-/Konfigurationsgrenzen. Eine reale Zustellprüfung bleibt getrennt und benötigt ausdrücklich freigegebene Testempfänger.
