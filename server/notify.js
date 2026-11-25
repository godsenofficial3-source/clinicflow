// Notification service: real emails sent from your Gmail account (Gmail "app password", free).
// Settings (in .env or your host's "Secrets"):  GMAIL_USER=yourname@gmail.com   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
// Every message is also saved in the "outbox" collection so clinics can see what was sent.
const nodemailer = require("nodemailer");
const store = require("./store");

let transporter = null;
let ready = false;
// EMAIL_WEBHOOK_URL: a Google Apps Script web app (see google-apps-script/send-email.gs) that sends the
// email from the Gmail account over HTTPS. Use it on hosts that block email ports (Render's free plan does).
const WEBHOOK = (process.env.EMAIL_WEBHOOK_URL || "").trim();
function setup() {
  if (WEBHOOK) { ready = true; console.log("  Email: Gmail ✔ (via Google Apps Script)"); return; }
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;
  transporter = nodemailer.createTransport({ service: "gmail", connectionTimeout: 6000, greetingTimeout: 6000, socketTimeout: 6000,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, "") } });
  transporter.verify().then(() => { ready = true; console.log("  Email: connected to Gmail as " + process.env.GMAIL_USER); })
    .catch((e) => console.error("  Email: Gmail login FAILED – check GMAIL_USER / GMAIL_APP_PASSWORD (" + e.message + ")"));
}
const demoMode = () => !transporter && !WEBHOOK;
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function html(subject, body, lang, code) {
  const fr = lang === "fr";
  return `<!doctype html><html lang="${fr ? "fr" : "en"}"><body style="margin:0;background:#F4F7F7;font-family:Arial,Helvetica,sans-serif;color:#14212B">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:14px;border:1px solid #DCE4E6" cellpadding="0" cellspacing="0">
    <tr><td style="background:#0E6F66;color:#fff;padding:18px 24px;border-radius:14px 14px 0 0;font-size:20px;font-weight:bold">✚ ClinicFlow</td></tr>
    <tr><td style="padding:24px;font-size:16px;line-height:1.5">
      <h1 style="font-size:20px;margin:0 0 12px">${esc(subject)}</h1>
      <p style="margin:0 0 16px">${esc(body).replace(/\n/g, "<br>")}</p>
      ${code ? `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#E3F4F1;color:#0E6F66;text-align:center;padding:14px;border-radius:10px;margin:8px 0 16px">${esc(code)}</p>` : ""}
      <p style="font-size:13px;color:#52616B;margin:16px 0 0">${fr ? "Message transactionnel envoyé automatiquement par ClinicFlow parce que vous avez un compte ou un rendez-vous. ClinicFlow n'envoie jamais de publicité. Pour une urgence médicale, composez le 911." : "Transactional message sent automatically by ClinicFlow because you have an account or an appointment. ClinicFlow never sends advertising. For a medical emergency, call 911."}</p>
      ${APP_URL ? `<p style="font-size:13px;margin:8px 0 0"><a href="${APP_URL}/#/legal/privacy" style="color:#0E6F66">${fr ? "Politique de confidentialité" : "Privacy Policy"}</a> · <a href="${APP_URL}/#/account" style="color:#0E6F66">${fr ? "Gérer mes avis" : "Manage my notifications"}</a></p>` : ""}
    </td></tr></table></td></tr></table></body></html>`;
}

/** send({to, subject, body, clinicId, lang, code}) – emails for real when Gmail is configured. */
async function send({ channel = "email", to, subject = "ClinicFlow", body, clinicId = null, lang = "en", code = null }) {
  if (!to || channel !== "email") return { ok: false, status: "skipped" };
  const started = Date.now();
  let status = "demo";
  let attempts = 0;
  while (!demoMode() && attempts < 2) {
    attempts++;
    try {
      const message = { to, subject, text: body + (code ? `\n\n${code}` : ""), html: html(subject, body, lang, code) };
      if (WEBHOOK) {
        const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "text/plain" }, redirect: "follow",
          body: JSON.stringify(message), signal: AbortSignal.timeout(6500) });
        const out = await r.json().catch(() => ({}));
        if (!r.ok || out.ok !== true) throw Object.assign(new Error("Email provider returned HTTP " + r.status), { temporary: r.status === 429 || r.status >= 500 });
      } else {
        await transporter.sendMail({ ...message, from: `"ClinicFlow" <${process.env.GMAIL_USER}>` });
      }
      status = "sent";
      break;
    } catch (e) {
      status = "failed";
      const temporary = e.temporary || (e.responseCode >= 400 && e.responseCode < 500) || ["ECONNECTION", "EDNS"].includes(e.code);
      if (!temporary || attempts >= 2) { console.error("[email]", e.message); break; }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  if (clinicId) store.insert("outbox", { clinic_id: clinicId, channel: "email", recipient: to, subject, body, status,
    duration_ms: Date.now() - started, attempts });
  return { ok: status !== "failed", status };
}

/** Fill a clinic message template, e.g. "confirmation", with {clinic},{date},{time},{provider}... */
function fillTemplate(clinicId, key, lang, vars) {
  const t = store.find("templates", (x) => x.clinic_id === clinicId && x.key === key);
  if (!t) return "";
  let s = (lang === "fr" ? t.body_fr : t.body_en) || t.body_en;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v ?? "");
  return s;
}

module.exports = { setup, send, fillTemplate, demoMode, isReady: () => ready };
