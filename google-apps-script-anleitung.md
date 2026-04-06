# Google Apps Script — Einrichtung

## Schritt 1: Script erstellen
1. Öffne https://script.google.com
2. Neues Projekt erstellen
3. Code aus `google-apps-script.js` in `Code.gs` einfügen
4. Spreadsheet-ID ist bereits eingetragen: `1-BeYoeylLWFJCeSEZdnHkcrOa5MABCL8HCheUK8HRlY`

## Schritt 2: Als Web-App bereitstellen
1. Klick auf "Bereitstellen" → "Neue Bereitstellung"
2. Typ: "Web-App"
3. Ausführen als: "Ich"
4. Zugriff: "Jeder"
5. Klick "Bereitstellen"
6. Web-App-URL kopieren

## Schritt 3: URL in Landingpage eintragen
In `index.html` den Platzhalter `YOUR_GOOGLE_APPS_SCRIPT_URL` durch die Web-App-URL ersetzen.
Dann `git push` — GitHub Actions deployt automatisch.

## Optional: Brevo Newsletter
In `google-apps-script.js` Zeile 17-18:
- `BREVO_API_KEY` = Dein Brevo API-Schlüssel
- `BREVO_LIST_ID` = Die Brevo-Listen-ID für den Wärmenetz-Newsletter
