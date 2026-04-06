/**
 * Google Apps Script — Web App Endpoint für Wärmenetz-Interessenbekundungen
 * 
 * EINRICHTUNG:
 * 1. Öffne https://script.google.com → Neues Projekt
 * 2. Kopiere diesen Code in die Code.gs Datei
 * 3. Ersetze SPREADSHEET_ID mit der echten ID
 * 4. Optional: Ersetze BREVO_API_KEY mit deinem Brevo-API-Schlüssel
 * 5. Veröffentlichen → Als Web-App bereitstellen
 *    - Ausführen als: ICH (dein Account)
 *    - Zugriff: Jeder (auch anonym)
 * 6. Kopiere die Web-App-URL in die Landingpage (index.html)
 */

// ===== KONFIGURATION =====
const SPREADSHEET_ID = '1-BeYoeylLWFJCeSEZdnHkcrOa5MABCL8HCheUK8HRlY';
const SHEET_NAME = 'Interessenten';
const BREVO_API_KEY = ''; // Optional: Brevo API Key für Newsletter-Anmeldung
const BREVO_LIST_ID = 0;  // Optional: Brevo-Listen-ID für Wärmenetz-Newsletter

// ===== WEB APP ENDPOINTS =====

function doPost(e) {
  try {
    var raw = e.postData ? e.postData.contents : '{}';
    var data;
    try { data = JSON.parse(raw); } catch(err) {
      // Fallback: URL-Parameter
      data = e.parameter || {};
    }
    
    // Route: Newsletter-only oder vollständige Interessenbekundung
    if (data.type === 'newsletter') {
      return handleNewsletter(data);
    } else {
      return handleInterestForm(data);
    }
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Wärmenetz API aktiv' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== INTERESSENBEKUNDUNG =====

function handleInterestForm(data) {
  // In Google Sheet schreiben
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.vorname || '',
    data.nachname || '',
    data.email || '',
    data.telefon || '',
    data.strasse || '',
    data.plz || '',
    data.ort || '',
    data.gebaeudetyp || '',
    data.nachricht || '',
    data.newsletter ? 'Ja' : 'Nein'
  ]);
  
  // Falls Newsletter gewünscht und Brevo konfiguriert
  if (data.newsletter && BREVO_API_KEY && BREVO_LIST_ID) {
    addToBrevo(data.email, data.vorname, data.nachname);
  }
  
  // Benachrichtigungs-E-Mail an HHB
  sendNotification(data);
  
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== NEWSLETTER =====

function handleNewsletter(data) {
  if (BREVO_API_KEY && BREVO_LIST_ID) {
    addToBrevo(data.email, '', '');
  }
  
  // Auch im Sheet notieren (optional, in separatem Tab)
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let nlSheet = ss.getSheetByName('Newsletter');
    if (!nlSheet) {
      nlSheet = ss.insertSheet('Newsletter');
      nlSheet.appendRow(['Timestamp', 'E-Mail']);
    }
    nlSheet.appendRow([new Date().toISOString(), data.email]);
  } catch (e) {
    // Ignorieren, wenn es nicht klappt
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== BREVO INTEGRATION =====

function addToBrevo(email, firstName, lastName) {
  if (!BREVO_API_KEY) return;
  
  const payload = {
    email: email,
    attributes: {
      VORNAME: firstName,
      NACHNAME: lastName
    },
    listIds: [BREVO_LIST_ID],
    updateEnabled: true
  };
  
  UrlFetchApp.fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// ===== E-MAIL-BENACHRICHTIGUNG =====

function sendNotification(data) {
  try {
    const subject = `Neue Wärmenetz-Interessenbekundung: ${data.vorname} ${data.nachname}`;
    const body = `
Neue Interessenbekundung über das Wärmenetz-Formular:

Name: ${data.vorname} ${data.nachname}
E-Mail: ${data.email}
Telefon: ${data.telefon || '-'}
Adresse: ${data.strasse}, ${data.plz} ${data.ort}
Gebäudetyp: ${data.gebaeudetyp || '-'}
Nachricht: ${data.nachricht || '-'}
Newsletter: ${data.newsletter ? 'Ja' : 'Nein'}
Zeitpunkt: ${data.timestamp}

---
Automatisch generiert von der Wärmenetz-Landingpage
Alle Interessenten: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}
    `.trim();
    
    MailApp.sendEmail('info@hhb-agrarenergie.de', subject, body);
  } catch (e) {
    // E-Mail-Fehler nicht als Gesamtfehler werten
    console.log('E-Mail-Benachrichtigung fehlgeschlagen: ' + e.toString());
  }
}
