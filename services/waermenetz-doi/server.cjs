// DOI-Service für waermenetz.hhb-agrarenergie.de — Hof Holtermann
// Läuft auf Hetzner, Port 5020
// Endpunkte:
//   POST /api/newsletter/signup   { email }
//   POST /api/interest/signup     { vorname, nachname, email, telefon, strasse, plz, ort, gebaeudetyp, nachricht, herkunft }
//   GET  /api/newsletter/confirm?token=...

const express = require('express');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const fs = require('fs');
function configuredKey() {
  if (process.env.BREVO_KEY) return process.env.BREVO_KEY;
  try { return JSON.parse(fs.readFileSync('/etc/waermenetz-doi/credentials.json', 'utf8')).brevoKey || ''; }
  catch { return ''; }
}
function createApp({ databasePath = process.env.DOI_DB_PATH || '/home/deploy/waermenetz-doi/pending.db', brevoKey = configuredKey(), fetchImpl = fetch } = {}) {
const app = express();

const PORT = process.env.PORT || 5020;
const BREVO_KEY = brevoKey;
const BASE_URL = 'https://waermenetz.hhb-agrarenergie.de';
const LIST_ID = 3;
const DOI_TEMPLATE_ID = 2;
const WELCOME_TEMPLATE_ID = 3;
const NOTIFY_OLIVER = 'oh@hofholtermann.de';

// ----- Datenbank
const db = new Database(databasePath);
db.exec(`
  CREATE TABLE IF NOT EXISTS pending (
    token TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    data  TEXT NOT NULL,
    type  TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER,
    ip TEXT,
    ua TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_email ON pending(email);
`);

if (!db.pragma('table_info(pending)').some(column => column.name === 'processing_at')) db.exec('ALTER TABLE pending ADD COLUMN processing_at INTEGER');
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// CORS (gleicher Host, aber erlauben wir, falls mal extern)
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== BASE_URL) return res.status(403).json({ ok: false, error: 'origin_denied' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', 'https://waermenetz.hhb-agrarenergie.de');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ----- Helfer: Brevo transactional email (DOI-Mail)
async function sendDoiEmail(email, confirmLink, firstName) {
  // Brevo verlangt ein nicht-leeres `name`-Feld im to-Array.
  const toName = (firstName && firstName.trim()) || email.split('@')[0] || 'Interessent';
  const body = {
    to: [{ email, name: toName }],
    templateId: DOI_TEMPLATE_ID,
    params: { confirmlink: confirmLink, vorname: firstName || '' }
  };
  const r = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Brevo DOI-Mail fehlgeschlagen: ${r.status}`);
  return JSON.parse(text);
}

// ----- Helfer: Kontakt in Brevo-Liste aufnehmen (nach Bestätigung)
async function addContactToList(email, attributes) {
  const body = {
    email,
    attributes: attributes || {},
    listIds: [LIST_ID],
    updateEnabled: true
  };
  const r = await fetchImpl('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok && r.status !== 204) {
    // 400 "Contact already exist" ist ok, wir updaten dann über PUT
    if (r.status === 400 && /already/i.test(text)) {
      const r2 = await fetchImpl(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
        method: 'PUT',
        redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes, listIds: [LIST_ID] })
      });
      if (!r2.ok && r2.status !== 204) {
        throw new Error(`Brevo PUT contact fehlgeschlagen: ${r2.status}`);
      }
      return { updated: true };
    }
    throw new Error(`Brevo POST contact fehlgeschlagen: ${r.status}`);
  }
  return text ? JSON.parse(text) : {};
}

// ----- Helfer: e-Mail validieren
function validEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

// ----- Rate-Limiter (einfach, IP-basiert)
const rateBuckets = new Map();
function rateLimit(ip, max = 5, windowMs = 60_000) {
  const now = Date.now();
  for (const [key, values] of rateBuckets) {
    if (values.every(t => now - t >= windowMs)) rateBuckets.delete(key);
  }
  if (!rateBuckets.has(ip) && rateBuckets.size >= 10000) return false;
  const arr = (rateBuckets.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  rateBuckets.set(ip, arr);
  return true;
}

// ----- Endpoint: Newsletter-Signup
app.post('/api/newsletter/signup', async (req, res) => {
  try {
    if (!BREVO_KEY) return res.status(503).json({ ok: false, error: 'provider_unconfigured' });
    const ip = req.ip || '';
    if (!rateLimit(ip)) return res.status(429).json({ ok: false, error: 'rate_limit' });

    const { email, website } = req.body || {};
    if (website) return res.json({ ok: true }); // Honeypot — leise erfolgreich vortäuschen
    if (!validEmail(email)) return res.status(400).json({ ok: false, error: 'invalid_email' });

    const token = crypto.randomBytes(32).toString('hex');
    const payload = { email: email.toLowerCase(), type: 'newsletter' };

    db.prepare(
      `INSERT INTO pending (token,email,data,type,created_at,ip,ua) VALUES (?,?,?,?,?,?,?)`
    ).run(token, email.toLowerCase(), JSON.stringify(payload), 'newsletter', Date.now(), ip.toString(), (req.headers['user-agent'] || '').slice(0, 300));

    const confirmLink = `${BASE_URL}/api/newsletter/confirm?token=${token}`;
    await sendDoiEmail(email, confirmLink, '');
    return res.json({ ok: true, message: 'doi_sent' });
  } catch (e) {
    console.error('newsletter/signup_failed');
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ----- Endpoint: Interest-Form Signup (größeres Formular)
app.post('/api/interest/signup', async (req, res) => {
  try {
    if (!BREVO_KEY) return res.status(503).json({ ok: false, error: 'provider_unconfigured' });
    const ip = req.ip || '';
    if (!rateLimit(ip, 3)) return res.status(429).json({ ok: false, error: 'rate_limit' });

    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // Honeypot
    if (b.datenschutz !== true && b.datenschutz !== 'on') return res.status(400).json({ ok: false, error: 'privacy_confirmation_required' });
    if (!validEmail(b.email)) return res.status(400).json({ ok: false, error: 'invalid_email' });

    const payload = {
      type: 'interest',
      newsletter: b.newsletter === true || b.newsletter === 'on',
      email: String(b.email).toLowerCase(),
      vorname: String(b.vorname || '').slice(0, 100),
      nachname: String(b.nachname || '').slice(0, 100),
      telefon: String(b.telefon || '').slice(0, 50),
      strasse: String(b.strasse || '').slice(0, 200),
      plz: String(b.plz || '').slice(0, 10),
      ort: String(b.ort || '').slice(0, 100),
      gebaeudetyp: String(b.gebaeudetyp || '').slice(0, 50),
      nachricht: String(b.nachricht || '').slice(0, 2000),
      herkunft: String(b.herkunft || 'website').slice(0, 60)
    };

    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(
      `INSERT INTO pending (token,email,data,type,created_at,ip,ua) VALUES (?,?,?,?,?,?,?)`
    ).run(token, payload.email, JSON.stringify(payload), 'interest', Date.now(), ip.toString(), (req.headers['user-agent'] || '').slice(0, 300));

    const confirmLink = `${BASE_URL}/api/newsletter/confirm?token=${token}`;
    await sendDoiEmail(payload.email, confirmLink, payload.vorname);
    return res.json({ ok: true, message: 'doi_sent' });
  } catch (e) {
    console.error('interest/signup_failed');
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ----- Endpoint: Bestätigung per Link-Klick
app.get('/api/newsletter/confirm', async (req, res) => {
  let claimedToken = null;
  try {
    if (!BREVO_KEY) return res.status(503).json({ ok: false, error: 'provider_unconfigured' });
    const token = String(req.query.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return res.redirect(302, `${BASE_URL}/bestaetigt.html?status=invalid`);

    const row = db.prepare('SELECT * FROM pending WHERE token = ?').get(token);
    if (!row) return res.redirect(302, `${BASE_URL}/bestaetigt.html?status=invalid`);

    // Link gültig 30 Tage
    if (Date.now() - row.created_at > 30 * 24 * 3600 * 1000) {
      return res.redirect(302, `${BASE_URL}/bestaetigt.html?status=expired`);
    }

    if (row.confirmed_at) {
      return res.redirect(302, `${BASE_URL}/bestaetigt.html?status=already`);
    }

    const claim = db.prepare('UPDATE pending SET processing_at=? WHERE token=? AND confirmed_at IS NULL AND (processing_at IS NULL OR processing_at < ?)').run(Date.now(), token, Date.now() - 120000);
    if (claim.changes !== 1) return res.status(409).send('Bestätigung wird bereits verarbeitet.');
    claimedToken = token;
    const data = JSON.parse(row.data);

    // Attributes für Brevo
    const attrs = {};
    if (data.vorname) attrs.VORNAME = data.vorname;
    if (data.nachname) attrs.NACHNAME = data.nachname;
    if (data.telefon) attrs.TELEFON = data.telefon;
    if (data.plz) attrs.PLZ = data.plz;
    if (data.ort) attrs.ORT = data.ort;
    if (data.gebaeudetyp) attrs.GEBAEUDETYP = data.gebaeudetyp;
    attrs.HERKUNFT = data.herkunft || 'website';
    attrs.DOI_CONFIRMED_AT = new Date().toISOString();

    const newsletterOptIn = data.type === 'newsletter' || data.newsletter === true;
    if (newsletterOptIn) await addContactToList(data.email, attrs);
    // Persist the confirmed request before optional messages; repeated link
    // clicks must not send a second welcome or notification.
    db.prepare('UPDATE pending SET confirmed_at=?, processing_at=NULL WHERE token=?').run(Date.now(), token);
    claimedToken = null;

    // Welcome only after an explicit newsletter opt-in.
    if (newsletterOptIn) try {
      const welcomeToName = (data.vorname && data.vorname.trim()) || data.email.split('@')[0] || 'Interessent';
      const wr = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
    redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: [{ email: data.email, name: welcomeToName }],
          templateId: WELCOME_TEMPLATE_ID,
          params: { vorname: data.vorname || '', herkunft: data.herkunft || 'website' }
        })
      });
      if (!wr.ok) {
        const t = await wr.text();
        console.warn('welcome mail failed:', wr.status);
      }
    } catch (e) { console.warn('welcome mail exception'); }

    // Wenn Interessens-Formular: auch Oliver informieren (Mini-Mail)
    if (data.type === 'interest') {
      try {
        const safe = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, escapeHtml(String(value))]));
        await fetchImpl('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
    redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: [{ email: NOTIFY_OLIVER, name: 'Oliver Holtermann' }],
            sender: { email: 'newsletter@hhb-agrarenergie.de', name: 'HHB Wärmenetz' },
            subject: `Neue Interessensbekundung Wärmenetz — ${data.vorname} ${data.nachname}`.trim(),
            htmlContent: `<h2>Neue Interessensbekundung (DOI bestätigt)</h2>
<ul>
<li><b>Name:</b> ${safe.vorname} ${safe.nachname}</li>
<li><b>E-Mail:</b> ${safe.email}</li>
<li><b>Telefon:</b> ${safe.telefon || '—'}</li>
<li><b>Adresse:</b> ${safe.strasse || ''}, ${safe.plz || ''} ${safe.ort || ''}</li>
<li><b>Gebäudetyp:</b> ${safe.gebaeudetyp || '—'}</li>
<li><b>Herkunft:</b> ${safe.herkunft || 'website'}</li>
</ul>
<p><b>Nachricht:</b><br>${(safe.nachricht || '').replace(/\n/g, '<br>')}</p>`
          })
        });
      } catch (e) { console.warn('notify oliver failed'); }
    }

    return res.redirect(302, `${BASE_URL}/bestaetigt.html?status=ok`);
  } catch (e) {
    if (claimedToken) db.prepare('UPDATE pending SET processing_at=NULL WHERE token=? AND confirmed_at IS NULL').run(claimedToken);
    console.error('confirm_failed');
    return res.redirect(302, `${BASE_URL}/bestaetigt.html?status=error`);
  }
});

// ----- Health
app.get('/api/health', (_req, res) => {
  try { db.prepare('SELECT 1').get(); res.json({ ok: true, service: 'waermenetz-doi', db: 'ok', providerConfigured: Boolean(BREVO_KEY), time: new Date().toISOString() }); }
  catch { res.status(503).json({ ok: false, db: 'unavailable' }); }
});
app.get('/api/version', (_req, res) => res.json({ buildId: process.env.GIT_SHA || 'unknown', node: process.versions.node }));

return { app, db };
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
if (require.main === module) {
  const { app } = createApp();
  app.listen(process.env.PORT || 5020, '127.0.0.1', () => console.log('waermenetz-doi ready'));
}
module.exports = { createApp };
