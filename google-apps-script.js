/**
 * Google Apps Script — Zentraler Formular-Endpoint für alle Hof Holtermann Marken
 * 
 * Verarbeitet Formulare von:
 * - Wärmenetz-Landingpage (waermenetz.hhb-agrarenergie.de)
 * - Hofladen (hofladen-harsefeld.de)
 * - Hof Holtermann / PremiumEi (premiumei.de / hofholtermann.de)
 * 
 * EINRICHTUNG:
 * 1. Code in Code.gs einfügen
 * 2. Zeile 17: Brevo API Key eintragen
 * 3. Bereitstellen → Bereitstellungen verwalten → Neue Version → Bereitstellen
 */

// ===== KONFIGURATION =====
const SPREADSHEET_ID = '1-BeYoeylLWFJCeSEZdnHkcrOa5MABCL8HCheUK8HRlY';
const BREVO_API_KEY = '';  // <-- Brevo API Key hier eintragen (xkeysib-...)
const NOTIFICATION_EMAIL = 'oh@hofholtermann.de';

// Brevo-Listen pro Marke
const BREVO_LISTS = {
  'waermenetz': 3,
  'hofladen': 4,
  'hof-holtermann': 5,
  'premiumei': 6
};

// Sheet-Tabs pro Marke (werden automatisch erstellt)
const SHEET_NAMES = {
  'waermenetz': 'Interessenten',
  'hofladen': 'Hofladen Kontakte',
  'hof-holtermann': 'Hof Holtermann Kontakte',
  'premiumei': 'PremiumEi Kontakte',
  'newsletter': 'Newsletter'
};

// ===== WEB APP ENDPOINTS =====

function doPost(e) {
  try {
    var raw = e.postData ? e.postData.contents : '{}';
    var data;
    try { data = JSON.parse(raw); } catch(err) {
      data = e.parameter || {};
    }
    if (data.type === 'newsletter') {
      return handleNewsletter(data);
    } else {
      return handleContactForm(data);
    }
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Hof Holtermann API aktiv', marken: Object.keys(BREVO_LISTS) }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== KONTAKTFORMULAR =====

function handleContactForm(data) {
  var marke = data.marke || 'waermenetz';
  var sheetName = SHEET_NAMES[marke] || 'Sonstige';
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(['Timestamp', 'Vorname', 'Nachname', 'E-Mail', 'Telefon',
                     'Strasse', 'PLZ', 'Ort', 'Typ', 'Nachricht', 'Newsletter', 'Marke']);
  }
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.vorname || '', data.nachname || '', data.email || '',
    data.telefon || '', data.strasse || '', data.plz || '', data.ort || '',
    data.gebaeudetyp || data.typ || '', data.nachricht || '',
    data.newsletter ? 'Ja' : 'Nein', marke
  ]);
  if (data.newsletter && BREVO_API_KEY) {
    addToBrevo(data.email, data.vorname, data.nachname, BREVO_LISTS[marke] || 5);
  }
  sendNotification(data, marke);
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== NEWSLETTER =====

function handleNewsletter(data) {
  var marke = data.marke || 'waermenetz';
  if (BREVO_API_KEY) {
    addToBrevo(data.email, data.vorname || '', data.nachname || '', BREVO_LISTS[marke] || 5);
  }
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var nlSheet = ss.getSheetByName('Newsletter');
  if (!nlSheet) {
    nlSheet = ss.insertSheet('Newsletter');
    nlSheet.appendRow(['Timestamp', 'E-Mail', 'Marke']);
  }
  nlSheet.appendRow([new Date().toISOString(), data.email, marke]);
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== BREVO =====

function addToBrevo(email, firstName, lastName, listId) {
  if (!BREVO_API_KEY) return;
  UrlFetchApp.fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    payload: JSON.stringify({ email: email, attributes: { VORNAME: firstName, NACHNAME: lastName }, listIds: [listId], updateEnabled: true }),
    muteHttpExceptions: true
  });
}

// ===== BENACHRICHTIGUNG =====

function sendNotification(data, marke) {
  try {
    var namen = { 'waermenetz': 'Waermenetz', 'hofladen': 'Hofladen', 'hof-holtermann': 'Hof Holtermann', 'premiumei': 'PremiumEi' };
    var m = namen[marke] || marke;
    var subject = 'Neue Anfrage ' + m + ': ' + (data.vorname||'') + ' ' + (data.nachname||'');
    var body = 'Neue Kontaktanfrage ueber ' + m + ':\n\n' +
      'Name: ' + (data.vorname||'') + ' ' + (data.nachname||'') + '\n' +
      'E-Mail: ' + (data.email||'') + '\n' +
      'Telefon: ' + (data.telefon||'-') + '\n' +
      'Adresse: ' + (data.strasse||'') + ', ' + (data.plz||'') + ' ' + (data.ort||'') + '\n' +
      'Typ: ' + (data.gebaeudetyp||data.typ||'-') + '\n' +
      'Nachricht: ' + (data.nachricht||'-') + '\n' +
      'Newsletter: ' + (data.newsletter ? 'Ja' : 'Nein') + '\n' +
      'Marke: ' + m + '\n\n---\nAlle Kontakte: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID;
    MailApp.sendEmail(NOTIFICATION_EMAIL, subject, body);
  } catch (e) {
    console.log('E-Mail fehlgeschlagen: ' + e.toString());
  }
}
