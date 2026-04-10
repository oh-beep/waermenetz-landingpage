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

// Brevo-Template-IDs
const BREVO_TEMPLATES = {
  'doi': 2,        // DOI-Bestätigungsmail
  'willkommen': 3  // Willkommens-Newsletter (wird nach DOI-Bestätigung gesendet)
};

// Sheet-Tabs pro Marke (werden automatisch erstellt)
const SHEET_NAMES = {
  'waermenetz': 'Interessenten',
  'hofladen': 'Hofladen Kontakte',
  'hof-holtermann': 'Hof Holtermann Kontakte',
  'premiumei': 'PremiumEi Kontakte',
  'newsletter': 'Newsletter'
};

// Redirect-URL nach DOI-Bestätigung
const DOI_REDIRECT_URL = 'https://waermenetz.hhb-agrarenergie.de/?confirmed=1';

// ===== WEB APP ENDPOINTS =====

function doPost(e) {
  try {
    var raw = e.postData ? e.postData.contents : '{}';
    var data;
    try { data = JSON.parse(raw); } catch(err) {
      data = e.parameter || {};
    }
    
    // Brevo Webhook: Kontakt zu Liste hinzugefügt → Willkommens-Newsletter senden
    if (data.event === 'listAddition' || (e.parameter && e.parameter.action === 'welcome')) {
      return handleBrevoWebhook(data);
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

/**
 * Verarbeitet Brevo-Webhooks (listAddition Event)
 * Wird aufgerufen, wenn ein Kontakt über DOI bestätigt und zur Liste hinzugefügt wird.
 * Sendet automatisch den Willkommens-Newsletter.
 */
function handleBrevoWebhook(data) {
  try {
    var email = '';
    var firstName = '';
    
    // Brevo Webhook-Format: { event: 'listAddition', email: '...', list_id: [...] }
    if (data.email) {
      email = data.email;
    }
    
    // Nur für Wärmenetz-Liste (3) den Willkommens-Newsletter senden
    var listIds = data.list_id || [];
    if (listIds.indexOf(3) === -1 && listIds.indexOf('3') === -1) {
      // Nicht die Wärmenetz-Liste → ignorieren
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, action: 'skipped', reason: 'not waermenetz list' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    if (email) {
      // Kurze Verzögerung, damit der Kontakt in Brevo vollständig angelegt ist
      Utilities.sleep(3000);
      sendWelcomeEmail(email, firstName);
      
      console.log('Willkommens-Newsletter gesendet an: ' + email);
    }
    
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, action: 'welcome_sent', email: email }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    console.log('Webhook-Fehler: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var params = e.parameter || {};
  
  // Webhook: Willkommens-Newsletter nach DOI-Bestätigung senden
  if (params.action === 'welcome' && params.email) {
    sendWelcomeEmail(params.email, params.name || '');
    // Redirect zur Landingpage mit Bestätigungsmeldung
    return HtmlService.createHtmlOutput(
      '<html><head><meta http-equiv="refresh" content="0;url=https://waermenetz.hhb-agrarenergie.de/?confirmed=1"></head>' +
      '<body>Weiterleitung...</body></html>'
    );
  }
  
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
  // Wenn Newsletter gewünscht → DOI starten
  if (data.newsletter && BREVO_API_KEY) {
    startDoubleOptIn(data.email, data.vorname, data.nachname, marke);
  }
  sendNotification(data, marke);
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== NEWSLETTER =====

function handleNewsletter(data) {
  var marke = data.marke || 'waermenetz';
  
  // In Sheet speichern (als Nachweis)
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var nlSheet = ss.getSheetByName('Newsletter');
  if (!nlSheet) {
    nlSheet = ss.insertSheet('Newsletter');
    nlSheet.appendRow(['Timestamp', 'E-Mail', 'Marke', 'DOI Status']);
  }
  nlSheet.appendRow([new Date().toISOString(), data.email, marke, 'DOI gesendet']);
  
  // DOI starten (Bestätigungsmail senden)
  if (BREVO_API_KEY) {
    startDoubleOptIn(data.email, data.vorname || '', data.nachname || '', marke);
  }
  
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== DOUBLE-OPT-IN via Brevo =====

/**
 * Startet den Double-Opt-In-Prozess über Brevo:
 * 1. Sendet Bestätigungsmail (Template 2) an den Nutzer
 * 2. Nutzer klickt Bestätigungslink
 * 3. Brevo fügt Kontakt automatisch zur Liste hinzu
 * 4. Danach wird automatisch der Willkommens-Newsletter gesendet (via Webhook/Automation)
 */
function startDoubleOptIn(email, firstName, lastName, marke) {
  if (!BREVO_API_KEY) return;
  
  var listId = BREVO_LISTS[marke] || 5;
  
  var payload = {
    email: email,
    attributes: {
      VORNAME: firstName,
      NACHNAME: lastName
    },
    includeListIds: [listId],
    templateId: BREVO_TEMPLATES.doi,  // Template 2: DOI-Bestätigungsmail
    redirectionUrl: DOI_REDIRECT_URL
  };
  
  var response = UrlFetchApp.fetch('https://api.brevo.com/v3/contacts/doubleOptinConfirmation', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();
  
  console.log('DOI Response (' + responseCode + '): ' + responseText);
  
  // Nach erfolgreicher DOI-Anfrage: Willkommens-Mail wird über Brevo Automation gesendet
  // (Brevo Automation: Trigger = "Kontakt zu Liste 3 hinzugefügt" → Sende Template 3)
  // Falls keine Automation konfiguriert: sendWelcomeEmail() als Fallback
  
  return responseCode >= 200 && responseCode < 300;
}

// ===== WILLKOMMENS-NEWSLETTER (Fallback — falls Brevo Automation nicht genutzt wird) =====

/**
 * Sendet den Willkommens-Newsletter direkt via Brevo Transactional API.
 * Wird nur aufgerufen, wenn KEINE Brevo-Automation konfiguriert ist.
 * 
 * Um diese Funktion als Webhook zu nutzen:
 * 1. Brevo → Einstellungen → Webhooks → Neuer Webhook
 * 2. Event: "Contact added to list"
 * 3. URL: [Diese Apps Script Web-App URL]?action=welcome&email={email}
 */
function sendWelcomeEmail(email, firstName) {
  if (!BREVO_API_KEY) return;
  
  UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    payload: JSON.stringify({
      templateId: BREVO_TEMPLATES.willkommen,  // Template 3: Willkommens-Newsletter
      to: [{ email: email, name: firstName || '' }],
      params: {
        VORNAME: firstName || ''
      }
    }),
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
      'Newsletter: ' + (data.newsletter ? 'Ja (DOI gesendet)' : 'Nein') + '\n' +
      'Marke: ' + m + '\n\n---\nAlle Kontakte: https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID;
    MailApp.sendEmail(NOTIFICATION_EMAIL, subject, body);
  } catch (e) {
    console.log('E-Mail fehlgeschlagen: ' + e.toString());
  }
}
