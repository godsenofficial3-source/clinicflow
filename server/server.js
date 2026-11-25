// ClinicFlow server: REST API + real-time updates (Server-Sent Events) + serves the web app.
// Data is stored in Firebase (Cloud Firestore) – see store.js. Emails are sent from Gmail – see notify.js.
// Settings are read from a .env file next to package.json (see .env.example) or from your host's "Secrets".
const fs = require("node:fs");
const path = require("node:path");
try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
process.env.TZ = process.env.TZ || "America/Toronto";

const express = require("express");
const store = require("./store");
const { setupClinicDefaults, seed, ymd, hm } = require("./db");
const { hashSecret, verifySecret, newToken, newCode, sha256 } = require("./security");
const notify = require("./notify");
const { estimate, load, toDate } = require("./estimates");
const { daysAfter, occurrences } = require("./care");

// Version of the Terms / Privacy / Cookie documents (single source of truth: public/legal-text.js)
const LEGAL_VERSION = fs.readFileSync(path.join(__dirname, "..", "public", "legal-text.js"), "utf8").match(/LEGAL_VERSION = "([^"]+)"/)[1];

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" }));
app.disable("x-powered-by");
app.use((req, res, next) => {
  // Security headers: strict content policy (no third-party scripts, trackers or fonts), no framing by other sites.
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin", "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), geolocation=(), payment=(), microphone=(self)",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" });
  if (req.secure || req.headers["x-forwarded-proto"] === "https") res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // CORS: lets the one-file version of the app (pasted into Figma Make, Anvil, Replit...) talk to this server.
  if (req.path.startsWith("/api")) {
    res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" });
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  if (req.headers["x-forwarded-proto"] === "http" && process.env.FORCE_HTTPS) return res.redirect(301, `https://${req.headers.host}${req.url}`);
  next();
});
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- helpers ----------
const S = store;
const err = (res, code, key, extra = {}) => res.status(code).json({ error: key, ...extra });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const nowStr = () => { const d = new Date(); return `${ymd(d)} ${hm(d.getHours() * 60 + d.getMinutes())}`; };
const addMin = (s, m) => { const d = new Date(toDate(s).getTime() + m * 60000); return `${ymd(d)} ${hm(d.getHours() * 60 + d.getMinutes())}`; };
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const N = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const userLang = (u) => (u && u.lang === "fr" ? "fr" : "en");
const userByEmail = (e) => S.find("users", (u) => u.email === String(e || "").toLowerCase().trim());
const statusOf = (clinicId, key) => S.find("statuses", (s) => s.clinic_id === clinicId && s.key === key);
const clinicName = (id) => S.get("clinics", id)?.name || "";
const publicUser = (u) => u && ({ id: u.id, email: u.email, phone: u.phone, role: u.role, clinic_id: u.clinic_id, staff_role: u.staff_role, provider_id: u.provider_id || null,
  first_name: u.first_name, last_name: u.last_name, lang: u.lang, twofa: u.twofa, has_pin: !!u.account_pin_hash,
  email_verified: !!u.email_verified, notify_pref: u.notify_pref, consent_version: u.consent_version || null, consent_at: u.consent_at || null,
  staff_agreement_version: u.staff_agreement_version || null, legal_version: LEGAL_VERSION });
const fmtT = (s, lang) => toDate(s).toLocaleTimeString(lang === "fr" ? "fr-CA" : "en-CA", { hour: "numeric", minute: "2-digit" });
const fmtDate = (s, lang) => toDate(s).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { weekday: "long", month: "long", day: "numeric" });
const notifyUser = (userId, title, body, kind, ref_id) => S.insert("notifications", { user_id: userId, title, body, kind, ref_id, read: 0 });

// ---------- real-time (Server-Sent Events) ----------
const streams = new Map();
function push(filter, payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [res, who] of streams) if (filter(who)) res.write(data);
}
const pushClinic = (clinicId, payload) => push((w) => w.clinicId === clinicId && w.role !== "patient", payload);
const pushUser = (userId, payload) => userId && push((w) => w.userId === userId, payload);
function changed(appt, what = "appointments") {
  pushClinic(appt.clinic_id, { type: what, id: appt.id });
  pushUser(appt.user_id, { type: what, id: appt.id });
  push((w) => w.role === "patient", { type: "crowd", clinic_id: appt.clinic_id });
}

// ---------- auth ----------
function session(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : req.query.token;
  if (!token) return null;
  const s = S.find("sessions", (x) => x.token_hash === sha256(token));
  if (!s) return null;
  const user = S.get("users", s.user_id);
  return user ? { ...s, token, user } : null;
}
const setStage = (s, stage) => S.update("sessions", s.id, { stage });
const newSession = (userId, stage) => { const token = newToken(); S.insert("sessions", { token_hash: sha256(token), user_id: userId, stage }); return token; };
const auth = (...roles) => (req, res, next) => {
  const s = session(req);
  if (!s || s.stage !== "ok") return err(res, 401, "auth_required");
  if (roles.length && !roles.includes(s.user.role)) return err(res, 403, "forbidden");
  req.user = s.user; req.sess = s;
  next();
};
const agreed = (req, res, next) => (req.user.staff_agreement_version === LEGAL_VERSION ? next() : err(res, 403, "agreement_required"));
const staffOnly = [auth("staff", "admin"), agreed];
const adminOnly = [auth("admin"), agreed];

// ---------- consent records, access log, rate limits ----------
function recordConsent(userId, kinds, method) {
  const at = S.nowStamp();
  kinds.forEach((kind) => S.insert("consents", { user_id: userId, kind, version: LEGAL_VERSION, method, accepted_at: at }));
  const patch = {};
  if (kinds.includes("terms") && kinds.includes("privacy")) Object.assign(patch, { consent_version: LEGAL_VERSION, consent_at: at });
  if (kinds.includes("staff")) Object.assign(patch, { staff_agreement_version: LEGAL_VERSION, staff_agreement_at: at });
  return S.update("users", userId, patch);
}
// Every time staff open or change an appointment record, it is logged (PHIPA access log).
function logAccess(req, action, appt) {
  S.insert("audit", { clinic_id: req.user.clinic_id, user_id: req.user.id, staff_name: `${req.user.first_name} ${req.user.last_name}`.trim(),
    action, appointment_id: appt?.id || null, patient_name: appt?.patient_name || null });
}
// Simple protection against password-guessing and code-guessing.
const hits = new Map();
function limited(key, max, minutes) {
  const now = Date.now(), h = (hits.get(key) || []).filter((x) => now - x < minutes * 60000);
  h.push(now); hits.set(key, h);
  return h.length > max;
}
const rate = (name, max, minutes, keyFn = (req) => req.ip) => (req, res, next) =>
  (limited(`${name}:${keyFn(req)}`, max, minutes) ? err(res, 429, "too_many_requests") : next());
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((x) => now - x < 3600000)) hits.delete(k); }, 600000).unref();

// 6-digit codes, emailed for real. Kept in memory only (never written to the database).
const codes = new Map();
async function sendCode(user, purpose) {
  const key = `${user.id}:${purpose}`, previous = codes.get(key);
  const entry = previous && previous.expires > Date.now() ? previous : { code: newCode(), expires: Date.now() + 10 * 60000, attempts: 0 };
  if (entry.attempts >= 5) throw new Error("code_locked");
  codes.set(key, entry);
  const { code } = entry;
  const fr = userLang(user) === "fr";
  const r = await notify.send({ to: user.email, lang: userLang(user), code,
    subject: fr ? "Votre code ClinicFlow" : "Your ClinicFlow code",
    body: fr ? `Bonjour ${user.first_name}, voici votre code de vérification. Il expire dans 10 minutes. Si vous n'avez pas fait cette demande, ignorez ce courriel.`
      : `Hi ${user.first_name}, here is your verification code. It expires in 10 minutes. If you didn't ask for it, you can ignore this email.` });
  if (r.status === "failed") throw Object.assign(new Error("email_failed"), { status: 502 });
  return notify.demoMode() ? { demoCode: code } : {};
}
function checkCode(userId, purpose, code) {
  const k = `${userId}:${purpose}`, c = codes.get(k);
  if (!c || c.expires < Date.now()) return "code_expired";
  if (c.attempts >= 5) return "too_many_attempts";
  if (sha256(c.code) !== sha256(String(code).trim())) { c.attempts++; return "code_wrong"; }
  codes.delete(k);
  return null;
}
const mask = (s = "") => s.replace(/^(.).*(@.*)$/, "$1•••$2");

app.get("/api/config", (req, res) => {
  res.json({ demoMode: notify.demoMode(), storage: S.mode, samples: S.count("users", (u) => u.email === "patient@demo.ca") > 0,
    demoPractitioner: !!S.find("users", (u) => u.email === "doctor@demo.ca" && u.staff_role === "practitioner"),
    legalVersion: LEGAL_VERSION, privacyEmail: process.env.PRIVACY_EMAIL || process.env.GMAIL_USER || "" });
});

app.post("/api/auth/register", rate("register", 5, 60), wrap(async (req, res) => {
  const { first_name, last_name, email, phone, password, lang = "en" } = req.body || {};
  if (!first_name || !email || !password) return err(res, 400, "missing_fields");
  if (req.body.accept_terms !== true || req.body.accept_privacy !== true) return err(res, 400, "consent_required");
  if (!emailPattern.test(String(email).trim())) return err(res, 400, "bad_email");
  if (String(password).length < 8) return err(res, 400, "weak_password");
  if (userByEmail(email)) return err(res, 409, "email_taken");
  const user = S.insert("users", { email: email.toLowerCase().trim(), phone: phone || null, password_hash: hashSecret(password), role: "patient", clinic_id: null, staff_role: null,
    first_name: first_name.trim(), last_name: (last_name || "").trim(), lang, twofa: "none", account_pin_hash: null, email_verified: 0, notify_pref: "email" });
  recordConsent(user.id, ["terms", "privacy"], "signup");
  const token = newSession(user.id, "code");
  res.json({ token, stage: "code", channel: "email", sent_to: mask(user.email), ...(await sendCode(user, "login")) });
}));

app.post("/api/auth/login", rate("login-ip", 20, 15), rate("login-email", 8, 15, (req) => String(req.body?.email || "").toLowerCase()), wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = userByEmail(email);
  if (!user || !verifySecret(password || "", user.password_hash)) return err(res, 401, "bad_login");
  const needCode = user.twofa === "email" || !user.email_verified;
  const stage = user.account_pin_hash ? "pin" : needCode ? "code" : "ok";
  const token = newSession(user.id, stage);
  const extra = stage === "code" ? { channel: "email", sent_to: mask(user.email), ...(await sendCode(user, "login")) } : {};
  res.json({ token, stage, ...extra, user: stage === "ok" ? publicUser(user) : undefined });
}));

app.post("/api/auth/pin", rate("pin", 8, 15), wrap(async (req, res) => {
  const s = session(req);
  if (!s || s.stage !== "pin") return err(res, 401, "auth_required");
  if (!verifySecret(req.body?.pin || "", s.user.account_pin_hash)) return err(res, 401, "bad_pin");
  const stage = s.user.twofa === "email" || !s.user.email_verified ? "code" : "ok";
  setStage(s, stage);
  const extra = stage === "code" ? { channel: "email", sent_to: mask(s.user.email), ...(await sendCode(s.user, "login")) } : {};
  res.json({ stage, ...extra, user: stage === "ok" ? publicUser(s.user) : undefined });
}));

app.post("/api/auth/send-code", rate("send-code", 5, 15), wrap(async (req, res) => {
  const s = session(req);
  if (!s || s.stage !== "code") return err(res, 401, "auth_required");
  res.json({ channel: "email", sent_to: mask(s.user.email), ...(await sendCode(s.user, "login")) });
}));

app.post("/api/auth/verify", rate("verify", 15, 15), (req, res) => {
  const s = session(req);
  if (!s || s.stage !== "code") return err(res, 401, "auth_required");
  const e = checkCode(s.user.id, "login", req.body?.code || "");
  if (e) return err(res, 401, e);
  const u = S.update("users", s.user.id, { email_verified: 1 });
  setStage(s, "ok");
  res.json({ stage: "ok", user: publicUser(u) });
});

app.post("/api/auth/forgot", rate("forgot", 5, 30), rate("forgot-email", 3, 30, (req) => String(req.body?.email || "").toLowerCase()), wrap(async (req, res) => {
  const user = userByEmail(req.body?.email);
  if (!user) return res.json({ ok: true, channel: "email" }); // don't reveal which emails exist
  res.json({ ok: true, channel: "email", sent_to: mask(user.email), ...(await sendCode(user, "reset")) });
}));
app.post("/api/auth/reset", rate("reset", 10, 15), (req, res) => {
  const { email, code, password } = req.body || {};
  const user = userByEmail(email);
  if (!user) return err(res, 400, "code_wrong");
  if (String(password || "").length < 8) return err(res, 400, "weak_password");
  const e = checkCode(user.id, "reset", code);
  if (e) return err(res, 400, e);
  S.update("users", user.id, { password_hash: hashSecret(password), email_verified: 1 });
  S.removeWhere("sessions", (x) => x.user_id === user.id);
  res.json({ ok: true });
});
app.post("/api/auth/logout", (req, res) => { const s = session(req); if (s) S.remove("sessions", s.id); res.json({ ok: true }); });

// ---------- account ----------
const membersOf = (uid) => S.filter("family_members", (m) => m.user_id === uid).sort((a, b) => a.id - b.id);
app.get("/api/me", auth(), (req, res) => {
  const u = req.user;
  res.json({
    user: publicUser(u), members: membersOf(u.id), clinic: u.clinic_id ? S.get("clinics", u.clinic_id) : null,
    unread: {
      notifications: S.count("notifications", (n) => n.user_id === u.id && !n.read),
      messages: u.role === "patient" ? S.count("messages", (m) => m.user_id === u.id && m.sender !== "patient" && !m.read_patient)
        : S.count("messages", (m) => m.clinic_id === u.clinic_id && m.sender !== "staff" && !m.read_staff),
    },
  });
});
app.patch("/api/me", auth(), (req, res) => {
  const b = req.body || {}, u = req.user;
  const patch = { first_name: b.first_name ?? u.first_name, last_name: b.last_name ?? u.last_name, phone: b.phone ?? u.phone,
    lang: ["en", "fr"].includes(b.lang) ? b.lang : u.lang, twofa: ["none", "email"].includes(b.twofa) ? b.twofa : u.twofa,
    notify_pref: ["email", "app"].includes(b.notify_pref) ? b.notify_pref : u.notify_pref };
  if (b.account_pin !== undefined) {
    if (b.account_pin === "" || b.account_pin === null) patch.account_pin_hash = null;
    else if (String(b.account_pin).length >= 4) patch.account_pin_hash = hashSecret(b.account_pin);
    else return err(res, 400, "pin_short");
  }
  res.json({ user: publicUser(S.update("users", u.id, patch)) });
});
app.post("/api/me/members", auth("patient"), (req, res) => {
  const { first_name, last_name, relation } = req.body || {};
  if (!first_name) return err(res, 400, "missing_fields");
  S.insert("family_members", { user_id: req.user.id, first_name, last_name: last_name || "", relation: relation || "" });
  res.json({ members: membersOf(req.user.id) });
});
app.delete("/api/me/members/:id", auth("patient"), (req, res) => {
  const m = S.get("family_members", req.params.id);
  if (m && m.user_id === req.user.id) S.remove("family_members", m.id);
  res.json({ members: membersOf(req.user.id) });
});
app.post("/api/me/verify-contact", auth(), rate("verify-contact", 5, 15), wrap(async (req, res) => res.json({ channel: "email", sent_to: mask(req.user.email), ...(await sendCode(req.user, "verify_email")) })));
app.post("/api/me/verify-contact/confirm", auth(), (req, res) => {
  const e = checkCode(req.user.id, "verify_email", req.body?.code || "");
  if (e) return err(res, 400, e);
  res.json({ user: publicUser(S.update("users", req.user.id, { email_verified: 1 })) });
});

// ---------- legal: consent, staff agreement, your data ----------
app.post("/api/me/consent", auth(), (req, res) => {
  const kinds = (req.body?.kinds || []).filter((k) => ["terms", "privacy"].includes(k));
  if (kinds.length !== 2) return err(res, 400, "consent_required");
  res.json({ user: publicUser(recordConsent(req.user.id, kinds, String(req.body?.method || "consent_screen").slice(0, 40))) });
});
app.post("/api/me/staff-agreement", auth("staff", "admin"), (req, res) => res.json({ user: publicUser(recordConsent(req.user.id, ["staff"], "staff_screen")) }));
// Right of access / portability: everything we hold about you, as a file.
app.get("/api/me/export", auth(), rate("export", 10, 60), (req, res) => {
  const u = req.user, strip = ({ password_hash, account_pin_hash, ...rest }) => rest;
  const appts = S.filter("appointments", (a) => a.user_id === u.id).map(({ staff_notes, ...a }) => ({ ...a, clinic: clinicName(a.clinic_id), provider: S.get("providers", a.provider_id)?.name }));
  const ids = new Set(appts.map((a) => a.id));
  res.set("Content-Disposition", "attachment; filename=clinicflow-my-data.json");
  res.json({ exported_at: S.nowStamp(), notice: "Personal information ClinicFlow holds about you. Passwords are stored only as encrypted hashes and are not included.",
    account: strip(u), family_members: membersOf(u.id), appointments: appts,
    forms: S.filter("forms", (f) => ids.has(f.appointment_id)).map(formOut), waitlist: S.filter("waitlist", (w) => w.user_id === u.id),
    messages: S.filter("messages", (m) => m.user_id === u.id), saved_clinics: S.filter("saved_clinics", (x) => x.user_id === u.id).map((x) => clinicName(x.clinic_id)),
    care_reminders: S.filter("care_reminders", (r) => r.user_id === u.id),
    notifications: S.filter("notifications", (n) => n.user_id === u.id), consents: S.filter("consents", (c) => c.user_id === u.id) });
});
// Right to deletion / withdrawal of consent.
app.post("/api/me/delete", auth("patient"), rate("delete", 5, 60), async (req, res) => {
  const u = req.user;
  if (!verifySecret(req.body?.password || "", u.password_hash)) return err(res, 401, "bad_password");
  const now = nowStr();
  const freed = [];
  for (const a of S.filter("appointments", (x) => x.user_id === u.id)) {
    const result = await S.schedule({ clinicId: a.clinic_id, date: a.start.slice(0, 10), appointmentId: a.id }, ({ appointment }) => {
      if (appointment?.user_id !== u.id) return {};
      const future = appointment.start > now && !finalStatuses.includes(appointment.status);
      const value = revised(appointment, { user_id: null, member_id: null, patient_record_id: null, anonymized: true,
        patient_name: future ? "Cancelled – account deleted" : "Deleted user", patient_email: null, patient_phone: null, reason: "",
        staff_notes: "", notify_pref: "app", ...(future ? { status: "cancelled" } : {}) });
      return { future, value, writes: [{ collection: "appointments", value }] };
    });
    S.filter("forms", (f) => f.appointment_id === a.id).forEach((f) => S.update("forms", f.id, { answers: "{}" }));
    if (result.future) { pushClinic(a.clinic_id, { type: "appointments" }); freed.push(result.value); }
  }
  for (const col of ["family_members", "saved_clinics", "notifications", "messages", "waitlist", "sessions", "consents", "care_reminders"]) S.removeWhere(col, (x) => x.user_id === u.id);
  S.remove("users", u.id);
  freed.forEach(offerFreedTime);
  res.json({ ok: true });
});

// ---------- clinics & availability ----------
function clinicOpenNow(c) {
  const h = JSON.parse(c.hours || "{}")[new Date().getDay()];
  if (!h) return false;
  const t = hm(new Date().getHours() * 60 + new Date().getMinutes());
  return t >= h[0] && t < h[1];
}
const validDay = (date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && ymd(toDate(date + " 00:00")) === date;
const validTime = (time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
const validStart = (start) => typeof start === "string" && start.length === 16 && start[10] === " " && validDay(start.slice(0, 10)) && validTime(start.slice(11));
const offerActive = (w) => w.status === "offered" && validStart(w.offer_start) && Date.now() < (w.offer_expires_at ?? toDate(w.offer_start).getTime());
const waitlistOrder = (a, b) => (a.joined_at || toDate(a.created_at.slice(0, 16)).getTime()) -
  (b.joined_at || toDate(b.created_at.slice(0, 16)).getTime()) || a.id - b.id;
function slotsFor(clinicId, date, { providerId = null, typeId = null, ignoreId = null, ignoreOffer = null,
  staff = false, duration = null, appointments, offers } = {}) {
  const clinic = S.get("clinics", clinicId);
  if (!clinic || (!staff && !clinic.accepting_online) || !validDay(date)) return [];
  const type = typeId ? S.get("appt_types", typeId) : null;
  const len = duration ?? (type && type.clinic_id === clinicId ? type.minutes : 15);
  const step = clinic.slot_minutes || 15;
  const wd = toDate(`${date} 00:00`).getDay();
  if (date < ymd(new Date())) return [];
  const hours = JSON.parse(clinic.hours || "{}")[wd];
  if (!hours || !validTime(hours[0]) || !validTime(hours[1])) return [];
  const minStart = date === ymd(new Date()) ? new Date().getHours() * 60 + new Date().getMinutes() + (staff ? 0 : 30) : 0;
  const dayAppointments = appointments ?? S.filter("appointments", (a) => a.clinic_id === clinicId && a.start.slice(0, 10) === date);
  const dayOffers = offers ?? S.filter("waitlist", (w) => w.clinic_id === clinicId && w.offer_start?.slice(0, 10) === date);
  const provs = S.filter("providers", (p) => p.clinic_id === clinicId && p.active && (!providerId || p.id === Number(providerId)));
  const out = [];
  for (const p of provs) {
    const windows = S.filter("availability", (a) => a.provider_id === p.id && a.weekday === wd);
    const taken = dayAppointments.filter((a) => a.provider_id === p.id && a.status !== "cancelled" && a.id !== ignoreId)
      .map((a) => [toMin(a.start.slice(11)), toMin(a.end.slice(11))]);
    S.filter("blocks", (b) => b.provider_id === p.id && b.date === date).forEach((b) => taken.push([toMin(b.start), toMin(b.end)]));
    for (const w of dayOffers) if (w.id !== ignoreOffer && w.offer_provider_id === p.id && offerActive(w)) {
      const start = toMin(w.offer_start.slice(11));
      taken.push([start, start + (w.offer_minutes || S.get("appt_types", w.type_id)?.minutes || 15)]);
    }
    for (const w of windows) for (let m = toMin(w.start); m + len <= toMin(w.end); m += step) {
      if (m < Math.max(minStart, toMin(hours[0])) || m + len > toMin(hours[1]) || taken.some(([s, e]) => m < e && m + len > s)) continue;
      out.push({ start: `${date} ${hm(m)}`, provider_id: p.id, provider_name: p.name });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.provider_name.localeCompare(b.provider_name));
}
function nextAvailable(clinicId) {
  const d = new Date();
  for (let i = 0; i < 14; i++) { const s = slotsFor(clinicId, ymd(d))[0]; if (s) return s.start; d.setDate(d.getDate() + 1); }
  return null;
}
const providersOf = (cid) => S.filter("providers", (p) => p.clinic_id === cid && p.active);
function clinicSummary(c, userId) {
  const L = load(c.id);
  return { ...c, hours: JSON.parse(c.hours || "{}"), open_now: clinicOpenNow(c), crowd: L.level, present: L.present,
    providers: providersOf(c.id).map(({ id, name, title, specialty, languages }) => ({ id, name, title, specialty, languages })),
    saved: userId ? !!S.find("saved_clinics", (x) => x.user_id === userId && x.clinic_id === c.id) : false, next_available: nextAvailable(c.id) };
}
app.get("/api/clinics", (req, res) => {
  const s = session(req);
  const uid = s?.stage === "ok" ? s.user.id : null;
  const q = (req.query.q || "").toLowerCase();
  const hit = (c) => !q || [c.name, c.address, c.city, c.postal].some((x) => String(x || "").toLowerCase().includes(q))
    || providersOf(c.id).some((p) => [p.name, p.specialty].some((x) => String(x || "").toLowerCase().includes(q)));
  let list = S.filter("clinics", (c) => c.accepting_online && hit(c)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => clinicSummary(c, uid));
  if (req.query.open === "1") list = list.filter((c) => c.open_now);
  if (req.query.saved === "1") list = list.filter((c) => c.saved);
  list.sort((a, b) => b.saved - a.saved);
  res.json({ clinics: list });
});
app.get("/api/clinics/:id", (req, res) => {
  const s = session(req);
  const c = S.get("clinics", req.params.id);
  if (!c) return err(res, 404, "not_found");
  res.json({ clinic: { ...clinicSummary(c, s?.stage === "ok" ? s.user.id : null),
    providers: providersOf(c.id).map((p) => ({ ...p, avail: S.filter("availability", (a) => a.provider_id === p.id).map(({ weekday, start, end }) => ({ weekday, start, end })) })),
    types: S.filter("appt_types", (t) => t.clinic_id === c.id), estimate: estimate(c.id) } });
});
app.post("/api/clinics/:id/save", auth("patient"), (req, res) => {
  const cid = Number(req.params.id);
  if (!S.find("saved_clinics", (x) => x.user_id === req.user.id && x.clinic_id === cid)) S.insert("saved_clinics", { user_id: req.user.id, clinic_id: cid });
  res.json({ saved: true });
});
app.delete("/api/clinics/:id/save", auth("patient"), (req, res) => { S.removeWhere("saved_clinics", (x) => x.user_id === req.user.id && x.clinic_id === Number(req.params.id)); res.json({ saved: false }); });
app.get("/api/clinics/:id/slots", (req, res) => {
  const date = req.query.date || ymd(new Date()), clinicId = Number(req.params.id), s = session(req);
  const staff = s?.stage === "ok" && s.user.role !== "patient" && s.user.clinic_id === clinicId && s.user.staff_agreement_version === LEGAL_VERSION;
  res.json({ date, slots: slotsFor(clinicId, date, { providerId: N(req.query.provider), typeId: N(req.query.type), staff }) });
});
app.get("/api/clinics/:id/days", (req, res) => {
  const days = [], d = new Date();
  for (let i = 0; i < Math.min(Number(req.query.days || 21), 60); i++) {
    const date = ymd(d);
    days.push({ date, count: slotsFor(Number(req.params.id), date, { providerId: N(req.query.provider), typeId: N(req.query.type) }).length });
    d.setDate(d.getDate() + 1);
  }
  res.json({ days });
});
app.get("/api/clinics/:id/estimate", (req, res) => res.json(estimate(Number(req.params.id), N(req.query.type))));

// Clinic sign-up: a new clinic joins ClinicFlow and gets an administrator account.
app.post("/api/clinics/register", rate("clinic-register", 3, 60), (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.address || !b.admin_email || !b.admin_password || !b.admin_first_name) return err(res, 400, "missing_fields");
  if (b.accept_terms !== true || b.accept_privacy !== true || b.accept_clinic !== true) return err(res, 400, "consent_required");
  if (String(b.admin_password).length < 8) return err(res, 400, "weak_password");
  if (userByEmail(b.admin_email)) return err(res, 409, "email_taken");
  const hours = JSON.stringify({ 1: ["09:00", "17:00"], 2: ["09:00", "17:00"], 3: ["09:00", "17:00"], 4: ["09:00", "17:00"], 5: ["09:00", "17:00"] });
  const c = S.insert("clinics", { name: b.name, address: b.address, city: b.city || "", postal: b.postal || "", phone: b.phone || "", email: b.email || b.admin_email,
    description_en: b.description || "", description_fr: b.description || "", specialty: b.specialty || "family", photo: "", hours, cancel_hours: 24, slot_minutes: 15, accepting_online: b.first_provider ? 1 : 0 });
  setupClinicDefaults(c.id);
  if (b.first_provider) {
    const p = S.insert("providers", { clinic_id: c.id, name: b.first_provider, title: "MD", specialty: b.specialty || "Family medicine", languages: "", bio_en: "", bio_fr: "", active: 1 });
    for (let wd = 1; wd <= 5; wd++) S.insert("availability", { provider_id: p.id, weekday: wd, start: "09:00", end: "17:00" });
  }
  const u = S.insert("users", { email: b.admin_email.toLowerCase().trim(), phone: b.admin_phone || b.phone || null, password_hash: hashSecret(b.admin_password), role: "admin", clinic_id: c.id,
    staff_role: "admin", first_name: b.admin_first_name, last_name: b.admin_last_name || "", lang: b.lang || "en", twofa: "none", account_pin_hash: null, email_verified: 0, notify_pref: "email" });
  recordConsent(u.id, ["terms", "privacy", "clinic"], "clinic_signup");
  S.update("clinics", c.id, { agreement_version: LEGAL_VERSION, agreement_at: S.nowStamp(), agreement_by: u.id });
  res.json({ token: newSession(u.id, "ok"), stage: "ok", user: publicUser(S.get("users", u.id)), clinic_id: c.id });
});

// ---------- appointments ----------
function apptView(a) {
  const pr = S.get("providers", a.provider_id), cl = S.get("clinics", a.clinic_id);
  return { ...a, provider: pr && { id: pr.id, name: pr.name, title: pr.title, specialty: pr.specialty },
    clinic: cl && { id: cl.id, name: cl.name, address: cl.address, city: cl.city, postal: cl.postal, phone: cl.phone, email: cl.email, cancel_hours: cl.cancel_hours },
    type: a.type_id ? S.get("appt_types", a.type_id) : null, status_info: statusOf(a.clinic_id, a.status),
    forms: S.filter("forms", (f) => f.appointment_id === a.id).map(({ id, title_en, title_fr, status, due, staff_note }) => ({ id, title_en, title_fr, status, due, staff_note })) };
}
function patientApptView(a) {
  const { staff_notes, patient_record_id, _v, ...view } = a.clinic ? a : apptView(a);
  return view;
}
const finalStatuses = ["cancelled", "completed", "no_show"];
const revised = (row, patch) => ({ ...row, ...patch, _v: (row._v || 0) + 1 });
const TITLES = { confirmation: ["Appointment confirmed", "Rendez-vous confirmé"], cancellation: ["Appointment cancelled", "Rendez-vous annulé"],
  provider_change: ["Appointment changed", "Rendez-vous modifié"], reminder: ["Appointment reminder", "Rappel de rendez-vous"] };
function bookingNotice(appt, user, key = "confirmation") {
  const lang = userLang(user);
  const body = notify.fillTemplate(appt.clinic_id, key, lang, { clinic: appt.clinic.name, date: fmtDate(appt.start, lang), time: fmtT(appt.start, lang), provider: appt.provider?.name || "" });
  const title = (TITLES[key] || ["ClinicFlow", "ClinicFlow"])[lang === "fr" ? 1 : 0];
  if (appt.user_id) notifyUser(appt.user_id, title, body, key, appt.id);
  if ((appt.notify_pref || user?.notify_pref || "email") === "email" && appt.patient_email)
    notify.send({ to: appt.patient_email, subject: `${title} – ${appt.clinic.name}`, body, clinicId: appt.clinic_id, lang });
}

async function bookSlot({ clinicId, providerId, typeId, start, user, memberId, patientRecordId, name, phone, email, notifyPref, reason, source, offerId }) {
  const type = S.get("appt_types", typeId);
  if (!type || type.clinic_id !== clinicId) return { error: "bad_type" };
  if (!validStart(start)) return { error: "slot_taken" };
  const date = start.slice(0, 10);
  const staff = source === "phone" || source === "in_person";
  if (!staff && !S.get("clinics", clinicId)?.accepting_online) return { error: "online_closed" };
  const a = S.newScheduleRecord("appointments", { clinic_id: clinicId, type_id: typeId, user_id: user?.id || null, member_id: memberId || null, patient_name: name,
    patient_record_id: patientRecordId || null, patient_phone: phone || null, patient_email: email || null, notify_pref: notifyPref || "email", reason: String(reason || "").slice(0, 140), start,
    status: "booked", source: source || "online", staff_notes: "", checked_in_at: null, consult_at: null, completed_at: null, reminder_sent: 0 });
  const ft = S.filter("form_templates", (f) => f.clinic_id === clinicId).sort((x, y) => x.id - y.id)[0];
  const form = ft && S.newScheduleRecord("forms", { appointment_id: a.id, template_id: ft.id, title_en: ft.title_en, title_fr: ft.title_fr, fields: ft.fields, answers: "{}", status: "todo", staff_note: null, due: date });
  const result = await S.schedule({ clinicId, date, waitlistId: offerId }, ({ appointments, offers, waiting }) => {
    if (offerId && (!waiting || !offerActive(waiting) || waiting.user_id !== user?.id || waiting.offer_start !== start)) return { error: "offer_expired" };
    const duration = waiting?.offer_minutes || type.minutes;
    const slot = slotsFor(clinicId, date, { providerId, typeId, staff, duration, ignoreOffer: offerId, appointments, offers }).find((s) => s.start === start);
    if (!slot) return { error: "slot_taken" };
    const appointment = { ...a, provider_id: slot.provider_id, end: addMin(start, duration) };
    const writes = [{ collection: "appointments", value: appointment, insert: true }];
    if (form) writes.push({ collection: "forms", value: form, insert: true });
    if (waiting) writes.push({ collection: "waitlist", value: revised(waiting, { status: "booked" }) });
    return { appointment, writes };
  });
  return result.error ? result : { appt: apptView(result.appointment) };
}

app.post("/api/appointments", auth("patient"), async (req, res) => {
  const b = req.body || {}, u = req.user;
  const member = b.member_id ? S.find("family_members", (m) => m.id === Number(b.member_id) && m.user_id === u.id) : null;
  if (b.member_id && !member) return err(res, 400, "bad_member");
  const name = member ? `${member.first_name} ${member.last_name || ""}`.trim() : `${u.first_name} ${u.last_name}`.trim();
  const r = await bookSlot({ clinicId: Number(b.clinic_id), providerId: N(b.provider_id), typeId: Number(b.type_id), start: b.start, user: u, memberId: member?.id,
    name, phone: b.phone || u.phone, email: b.email || u.email, notifyPref: b.notify_pref || u.notify_pref, reason: b.reason, source: "online" });
  if (r.error) return err(res, 409, r.error);
  bookingNotice(r.appt, u, "confirmation");
  changed(r.appt);
  res.json({ appointment: patientApptView(r.appt) });
});

app.get("/api/my/appointments", auth("patient"), (req, res) => {
  const list = S.filter("appointments", (a) => a.user_id === req.user.id).sort((a, b) => a.start.localeCompare(b.start)).map(patientApptView);
  const now = nowStr(), today = ymd(new Date());
  const upcoming = list.filter((a) => !finalStatuses.includes(a.status) && (a.end >= now || (a.start.slice(0, 10) === today && a.status !== "booked")))
    .map((a) => ({ ...a, can_change_online: !canChange(req, a), can_reschedule_online: !canChange(req, a) && !!S.get("clinics", a.clinic_id)?.accepting_online,
      ...(a.start.slice(0, 10) === today || toDate(a.start) - Date.now() < 36 * 3600000 ? { estimate: estimate(a.clinic_id, a.type_id, a) } : {}) }));
  const ids = new Set(upcoming.map((a) => a.id));
  res.json({ upcoming, past: list.filter((a) => !ids.has(a.id)).reverse() });
});

const waitlistType = (w) => w.type_id ? S.get("appt_types", w.type_id) :
  S.filter("appt_types", (t) => t.clinic_id === w.clinic_id).sort((a, b) => a.minutes - b.minutes)[0];
async function sendOffer(w, start, providerId) {
  if (!validStart(start) || !providerId) return false;
  const date = start.slice(0, 10), type = waitlistType(w);
  if (!type || (w.date && w.date !== date) || (w.provider_id && w.provider_id !== providerId)) return false;
  const expires = Math.min(Date.now() + 30 * 60000, toDate(start).getTime() - 30 * 60000);
  if (expires <= Date.now()) return false;
  const result = await S.schedule({ clinicId: w.clinic_id, date, waitlistId: w.id }, ({ appointments, offers, waiting }) => {
    if (waiting?.status !== "waiting" || !slotsFor(w.clinic_id, date, { providerId, typeId: type.id, appointments, offers }).some((s) => s.start === start)) return {};
    const value = revised(waiting, { status: "offered", offer_start: start, offer_provider_id: providerId,
      offer_expires_at: expires, offer_minutes: type.minutes });
    return { writes: [{ collection: "waitlist", value }] };
  });
  if (!result.writes) return false;
  const u = w.user_id ? S.get("users", w.user_id) : null;
  if (u) {
    const lang = userLang(u);
    const body = notify.fillTemplate(w.clinic_id, "waitlist_offer", lang, { clinic: clinicName(w.clinic_id), date: fmtDate(start, lang), time: fmtT(start, lang) });
    const title = lang === "fr" ? "Une place s'est libérée!" : "A spot opened up!";
    notifyUser(u.id, title, body, "waitlist_offer", w.id);
    if (u.notify_pref === "email") notify.send({ to: u.email, subject: title, body, clinicId: w.clinic_id, lang });
    pushUser(u.id, { type: "waitlist" });
  }
  pushClinic(w.clinic_id, { type: "waitlist" });
  return true;
}
async function offerToWaitlist(clinicId, providerId, start) {
  const date = start.slice(0, 10);
  const rows = S.filter("waitlist", (x) => x.clinic_id === clinicId && x.status === "waiting" && (!x.date || x.date === date) && (!x.provider_id || x.provider_id === providerId))
    .sort(waitlistOrder);
  for (const w of rows) if (await sendOffer(w, start, providerId)) return;
}
function offerFreedTime(a) {
  if (validStart(a.start) && toDate(a.start) > new Date())
    void offerToWaitlist(a.clinic_id, a.provider_id, a.start).catch((e) => console.error("[waitlist]", e.message));
}

function canChange(req, a, cancelling = false) {
  const u = req.user;
  const isStaff = u.role !== "patient" && u.clinic_id === a.clinic_id;
  if (!isStaff && a.user_id !== u.id) return { code: 403, error: "forbidden" };
  if (isStaff && u.staff_agreement_version !== LEGAL_VERSION) return { code: 403, error: "agreement_required" };
  if (cancelling && a.status === "cancelled") return null;
  if (finalStatuses.includes(a.status)) return { code: 409, error: "visit_closed" };
  const clinic = S.get("clinics", a.clinic_id);
  if (!isStaff && (toDate(a.start) - Date.now()) / 3600000 < clinic.cancel_hours) return { code: 400, error: "too_late_to_cancel", hours: clinic.cancel_hours, phone: clinic.phone };
  return null;
}
app.post("/api/appointments/:id/cancel", auth(), async (req, res) => {
  const a = S.get("appointments", req.params.id);
  if (!a) return err(res, 404, "not_found");
  const result = await S.schedule({ clinicId: a.clinic_id, date: a.start.slice(0, 10), appointmentId: a.id }, ({ appointment }) => {
    if (!appointment) return { code: 404, error: "not_found" };
    const no = canChange(req, appointment, true);
    if (no) return no;
    if (appointment.status === "cancelled") return {};
    const value = revised(appointment, { status: "cancelled" });
    return { value, writes: [{ collection: "appointments", value }] };
  });
  if (result.error) return err(res, result.code, result.error, result);
  if (!result.value) return res.json({ ok: true });
  const v = apptView(result.value);
  if (req.user.role !== "patient") logAccess(req, "cancel", v);
  bookingNotice(v, v.user_id ? S.get("users", v.user_id) : null, "cancellation");
  changed(v);
  offerFreedTime(v);
  res.json({ ok: true });
});
app.post("/api/appointments/:id/reschedule", auth(), async (req, res) => {
  const a = S.get("appointments", req.params.id);
  if (!a) return err(res, 404, "not_found");
  const start = req.body?.start;
  if (!validStart(start)) return err(res, 409, "slot_taken");
  const date = start.slice(0, 10), staff = req.user.role !== "patient";
  const result = await S.schedule({ clinicId: a.clinic_id, date, appointmentId: a.id }, ({ appointments, offers, appointment }) => {
    if (!appointment) return { code: 404, error: "not_found" };
    const no = canChange(req, appointment);
    if (no) return no;
    const providerId = N(req.body?.provider_id) || appointment.provider_id;
    const type = S.get("appt_types", appointment.type_id);
    if (!type || !slotsFor(a.clinic_id, date, { providerId, typeId: type.id, ignoreId: a.id, staff, appointments, offers }).some((s) => s.start === start))
      return { code: 409, error: "slot_taken" };
    const value = revised(appointment, { start, end: addMin(start, type.minutes), provider_id: providerId, status: "booked",
      checked_in_at: null, consult_at: null, completed_at: null, reminder_sent: 0 });
    return { value, previous: appointment, writes: [{ collection: "appointments", value }] };
  });
  if (result.error) return err(res, result.code, result.error, result);
  if (req.user.role !== "patient") logAccess(req, "reschedule", a);
  const v = apptView(result.value);
  S.filter("forms", (f) => f.appointment_id === a.id).forEach((f) => S.update("forms", f.id, { due: date }));
  bookingNotice(v, a.user_id ? S.get("users", a.user_id) : null, "confirmation");
  changed(v);
  if (v.start !== result.previous.start || v.provider_id !== result.previous.provider_id) offerFreedTime(result.previous);
  res.json({ appointment: staff ? v : patientApptView(v) });
});

// ---------- waitlist ----------
app.post("/api/waitlist", auth("patient"), async (req, res) => {
  const b = req.body || {};
  const clinicId = Number(b.clinic_id), providerId = N(b.provider_id), typeId = N(b.type_id), date = b.date || null;
  if (!S.get("clinics", clinicId)?.accepting_online) return err(res, 409, "online_closed");
  if (date && (!validDay(date) || date < ymd(new Date()))) return err(res, 400, "bad_date");
  if (typeId && S.get("appt_types", typeId)?.clinic_id !== clinicId) return err(res, 400, "bad_type");
  if (providerId && !providersOf(clinicId).some((p) => p.id === providerId)) return err(res, 400, "not_found");
  const member = b.member_id ? S.find("family_members", (m) => m.id === Number(b.member_id) && m.user_id === req.user.id) : null;
  if (b.member_id && !member) return err(res, 400, "bad_member");
  const name = member ? `${member.first_name} ${member.last_name || ""}`.trim() : `${req.user.first_name} ${req.user.last_name}`;
  const value = S.newScheduleRecord("waitlist", { clinic_id: clinicId, provider_id: providerId, type_id: typeId, user_id: req.user.id, member_id: member?.id || null,
    patient_name: name, date, status: "waiting", offer_start: null, offer_provider_id: null, joined_at: Date.now() });
  const result = await S.schedule({ clinicId, date: date || ymd(new Date()), readQueue: true }, ({ queue }) => {
    const duplicate = queue.some((w) => w.user_id === value.user_id && (w.member_id || null) === value.member_id &&
      w.date === date && w.provider_id === providerId && w.type_id === typeId && (w.status === "waiting" || offerActive(w)));
    return duplicate ? {} : { writes: [{ collection: "waitlist", value, insert: true }] };
  });
  if (result.writes) {
    // "joined" lets the front desk show a small corner notification (staff can already see the waitlist).
    const type = S.get("appt_types", typeId), position = S.count("waitlist", (x) => x.clinic_id === clinicId && x.status === "waiting");
    pushClinic(clinicId, { type: "waitlist", event: "joined", id: value.id, patient_name: name, date, position,
      provider_name: providerId ? S.get("providers", providerId)?.name || null : null, type_en: type?.name_en || null, type_fr: type?.name_fr || null });
  }
  res.json({ ok: true });
});
app.get("/api/my/waitlist", auth("patient"), (req, res) => {
  res.json({ waitlist: S.filter("waitlist", (w) => w.user_id === req.user.id && (w.status === "waiting" || offerActive(w))).sort(waitlistOrder).map((w) => ({
    ...w, clinic_name: clinicName(w.clinic_id), provider_name: S.get("providers", w.provider_id)?.name || null, offer_provider_name: S.get("providers", w.offer_provider_id)?.name || null,
    position: S.count("waitlist", (x) => x.clinic_id === w.clinic_id && x.status === "waiting" && waitlistOrder(x, w) <= 0 &&
      (!x.date || !w.date || x.date === w.date) && (!x.provider_id || !w.provider_id || x.provider_id === w.provider_id)) })) });
});
async function releaseWaitlist(w, nextStatus) {
  if (!w || !["waiting", "offered"].includes(w.status)) return false;
  const date = w.offer_start?.slice(0, 10) || w.date || ymd(new Date());
  const result = await S.schedule({ clinicId: w.clinic_id, date, waitlistId: w.id }, ({ waiting }) => {
    if (!waiting || !["waiting", "offered"].includes(waiting.status) || (nextStatus === "expired" && (waiting.status !== "offered" || offerActive(waiting)))) return {};
    return { previous: waiting, writes: [{ collection: "waitlist", value: revised(waiting, { status: nextStatus }) }] };
  });
  if (!result.previous) return false;
  pushClinic(w.clinic_id, { type: "waitlist" });
  pushUser(w.user_id, { type: "waitlist" });
  if (result.previous.status === "offered") offerFreedTime({ ...w, start: result.previous.offer_start, provider_id: result.previous.offer_provider_id });
  return true;
}
app.delete("/api/waitlist/:id", auth("patient"), async (req, res) => {
  const w = S.get("waitlist", req.params.id);
  if (w?.user_id === req.user.id) await releaseWaitlist(w, "left");
  res.json({ ok: true });
});
app.post("/api/waitlist/:id/accept", auth("patient"), async (req, res) => {
  const w = S.get("waitlist", req.params.id);
  if (!w || w.user_id !== req.user.id || w.status !== "offered") return err(res, 404, "not_found");
  if (!offerActive(w)) return err(res, 409, "offer_expired");
  const r = await bookSlot({ clinicId: w.clinic_id, providerId: w.offer_provider_id, typeId: waitlistType(w)?.id, start: w.offer_start, user: req.user, memberId: w.member_id,
    name: w.patient_name, phone: req.user.phone, email: req.user.email, notifyPref: req.user.notify_pref, reason: "Waitlist", source: "waitlist", offerId: w.id });
  if (r.error) return err(res, 409, r.error);
  bookingNotice(r.appt, req.user, "confirmation");
  changed(r.appt);
  res.json({ appointment: patientApptView(r.appt) });
});
app.post("/api/waitlist/:id/decline", auth("patient"), async (req, res) => {
  const w = S.get("waitlist", req.params.id);
  if (!w || w.user_id !== req.user.id || w.status !== "offered") return err(res, 404, "not_found");
  await releaseWaitlist(w, "declined");
  res.json({ ok: true });
});

// ---------- forms (to-do) ----------
const formOut = (f) => ({ ...f, fields: JSON.parse(f.fields || "[]"), answers: JSON.parse(f.answers || "{}") });
app.get("/api/my/forms", auth("patient"), (req, res) => {
  const order = { returned: 0, todo: 1 };
  const rows = [];
  for (const f of S.all("forms")) {
    const a = S.get("appointments", f.appointment_id);
    if (!a || a.user_id !== req.user.id || a.status === "cancelled") continue;
    rows.push({ ...formOut(f), start: a.start, patient_name: a.patient_name, clinic_name: clinicName(a.clinic_id) });
  }
  rows.sort((x, y) => (order[x.status] ?? 2) - (order[y.status] ?? 2) || x.start.localeCompare(y.start));
  res.json({ forms: rows });
});
app.put("/api/forms/:id", auth("patient"), (req, res) => {
  const f = S.get("forms", req.params.id);
  const a = f && S.get("appointments", f.appointment_id);
  if (!a || a.user_id !== req.user.id) return err(res, 404, "not_found");
  const status = req.body?.submit ? "submitted" : f.status === "returned" ? "returned" : "todo";
  S.update("forms", f.id, { answers: JSON.stringify(req.body?.answers || {}), status });
  pushClinic(a.clinic_id, { type: "forms" });
  res.json({ ok: true, status });
});

// ---------- messages & notifications ----------
app.get("/api/my/messages", auth("patient"), (req, res) => {
  const uid = req.user.id;
  const rows = S.filter("messages", (m) => m.user_id === uid).sort((a, b) => a.id - b.id).map((m) => ({ ...m, clinic_name: clinicName(m.clinic_id) }));
  rows.filter((m) => !m.read_patient).forEach((m) => S.update("messages", m.id, { read_patient: 1 }));
  const ids = new Set([...S.filter("appointments", (a) => a.user_id === uid).map((a) => a.clinic_id), ...S.filter("saved_clinics", (x) => x.user_id === uid).map((x) => x.clinic_id), ...rows.map((m) => m.clinic_id)]);
  res.json({ messages: rows, clinics: [...ids].map((id) => S.get("clinics", id)).filter(Boolean).map((c) => ({ id: c.id, name: c.name })) });
});
app.post("/api/my/messages", auth("patient"), (req, res) => {
  const body = String(req.body?.body || "").trim().slice(0, 2000);
  if (!body || !req.body?.clinic_id) return err(res, 400, "missing_fields");
  S.insert("messages", { clinic_id: Number(req.body.clinic_id), user_id: req.user.id, sender: "patient", body, handoff: 0, read_staff: 0, read_patient: 1 });
  pushClinic(Number(req.body.clinic_id), { type: "messages" });
  res.json({ ok: true });
});
app.get("/api/my/notifications", auth(), (req, res) => {
  res.json({ notifications: S.filter("notifications", (n) => n.user_id === req.user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, 30) });
});
app.post("/api/my/notifications/read", auth(), (req, res) => {
  S.filter("notifications", (n) => n.user_id === req.user.id && !n.read).forEach((n) => S.update("notifications", n.id, { read: 1 }));
  res.json({ ok: true });
});
app.post("/api/crowd", auth("patient"), (req, res) => {
  const { clinic_id, level, waited_minutes } = req.body || {};
  if (![1, 2, 3].includes(Number(level))) return err(res, 400, "bad_level");
  S.insert("crowd_reports", { clinic_id: Number(clinic_id), level: Number(level), waited_minutes: waited_minutes ?? null }); // anonymous: not linked to the person
  push(() => true, { type: "crowd", clinic_id: Number(clinic_id) });
  res.json({ ok: true, estimate: estimate(Number(clinic_id)) });
});

// ---------- staff ----------
const clinicOf = (req) => req.user.clinic_id;
app.get("/api/staff/meta", staffOnly, (req, res) => {
  const c = clinicOf(req), clinic = S.get("clinics", c), today = ymd(new Date());
  const provIds = new Set(S.filter("providers", (p) => p.clinic_id === c).map((p) => p.id));
  res.json({
    clinic: { ...clinic, hours: JSON.parse(clinic.hours || "{}") },
    providers: S.filter("providers", (p) => p.clinic_id === c).sort((a, b) => b.active - a.active || a.name.localeCompare(b.name))
      .map((p) => ({ ...p, avail: S.filter("availability", (a) => a.provider_id === p.id).map(({ weekday, start, end }) => ({ weekday, start, end })) })),
    types: S.filter("appt_types", (t) => t.clinic_id === c), statuses: S.filter("statuses", (s) => s.clinic_id === c).sort((a, b) => a.sort - b.sort),
    templates: S.filter("templates", (t) => t.clinic_id === c), form_templates: S.filter("form_templates", (f) => f.clinic_id === c),
    blocks: S.filter("blocks", (b) => provIds.has(b.provider_id) && b.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .map((b) => ({ ...b, provider_name: S.get("providers", b.provider_id)?.name })),
  });
});
app.get("/api/staff/overview", staffOnly, (req, res) => {
  const c = clinicOf(req), today = ymd(new Date());
  const appts = S.filter("appointments", (a) => a.clinic_id === c && a.start.slice(0, 10) === today && a.status !== "cancelled").sort((a, b) => a.start.localeCompare(b.start)).map(apptView);
  const apptIds = new Set(S.filter("appointments", (a) => a.clinic_id === c).map((a) => a.id));
  res.json({ today, appointments: appts, estimate: estimate(c),
    unread: S.count("messages", (m) => m.clinic_id === c && m.sender !== "staff" && !m.read_staff),
    waitlist: S.count("waitlist", (w) => w.clinic_id === c && w.status === "waiting"),
    forms_pending: S.count("forms", (f) => f.status === "submitted" && apptIds.has(f.appointment_id)) });
});
app.get("/api/staff/appointments", staffOnly, (req, res) => {
  const c = clinicOf(req), from = req.query.from || ymd(new Date()), to = req.query.to || from, prov = N(req.query.provider);
  // Search matches name, email or phone (phone digits only, so "613 555-0101" finds "613-555-0101").
  // With ?all=1 the search covers every date instead of the visible week.
  const q = String(req.query.q || "").trim().toLowerCase(), qDigits = q.replace(/\D/g, ""), allDates = !!q && !!req.query.all;
  const matches = (a) => !q || String(a.patient_name || "").toLowerCase().includes(q) || String(a.patient_email || "").toLowerCase().includes(q)
    || (qDigits.length >= 3 && String(a.patient_phone || "").replace(/\D/g, "").includes(qDigits));
  res.json({ appointments: S.filter("appointments", (a) => a.clinic_id === c && (allDates || (a.start.slice(0, 10) >= from && a.start.slice(0, 10) <= to)) && matches(a)
    && (!prov || a.provider_id === prov) && (req.query.include_cancelled || a.status !== "cancelled")).sort((a, b) => a.start.localeCompare(b.start)).slice(0, allDates ? 200 : undefined).map(apptView) });
});
const clinicAppt = (req) => { const a = S.get("appointments", req.params.id); return a && a.clinic_id === clinicOf(req) ? a : null; };
const canManageCare = (u, a) => u.staff_role === "practitioner" && u.provider_id === a.provider_id &&
  S.get("providers", a.provider_id)?.active && a.status === "completed" && !!S.get("users", a.user_id);
const careRows = (appointmentId) => S.filter("care_reminders", (r) => r.appointment_id === appointmentId).sort((a, b) => a.id - b.id);
const patientIdentity = (a) => a.user_id ? `portal:${a.user_id}:${a.member_id || 0}` : `visit:${a.patient_record_id || a.id}`;
app.get("/api/staff/patients", staffOnly, (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.json({ patients: [] });
  const rows = S.filter("appointments", (a) => a.clinic_id === clinicOf(req) && a.patient_name && !a.anonymized
    && !["Deleted user", "Cancelled – account deleted"].includes(a.patient_name))
    .sort((x, y) => y.start.localeCompare(x.start));
  const unique = new Map();
  for (const a of rows) if (!unique.has(patientIdentity(a))) unique.set(patientIdentity(a), a);
  const qDigits = q.replace(/\D/g, "");
  const patients = [...unique.values()].filter((a) => [a.patient_name, a.patient_email].some((value) => String(value || "").toLowerCase().includes(q))
    || (qDigits.length >= 3 && String(a.patient_phone || "").replace(/\D/g, "").includes(qDigits)))
    .slice(0, 15).map((a) => ({ id: a.id, name: a.patient_name, phone: a.patient_phone, email: a.patient_email, linked: !!a.user_id }));
  res.json({ patients });
});
app.get("/api/staff/appointments/:id", staffOnly, (req, res) => {
  const a = clinicAppt(req);
  if (!a) return err(res, 404, "not_found");
  logAccess(req, "view", a);
  const v = apptView(a);
  v.forms = S.filter("forms", (f) => f.appointment_id === a.id).map(formOut);
  if (canManageCare(req.user, a)) v.care_reminders = careRows(a.id);
  v.history = S.filter("appointments", (x) => x.clinic_id === a.clinic_id && x.id !== a.id && patientIdentity(x) === patientIdentity(a))
    .sort((x, y) => y.start.localeCompare(x.start)).slice(0, 5).map(({ id, start, status }) => ({ id, start, status }));
  res.json({ appointment: v });
});
app.post("/api/staff/appointments/:id/care-reminders", staffOnly, (req, res) => {
  const a = clinicAppt(req);
  if (!a) return err(res, 404, "not_found");
  if (!canManageCare(req.user, a)) return err(res, 403, "forbidden");
  const { reminder_id, kind, start_date, end_date, times } = req.body || {};
  const label = Number(req.body?.label);
  const daily = Array.isArray(times) ? [...new Set(times)].sort() : [];
  if (!["medication", "recovery"].includes(kind) || !Number.isInteger(label) || label < 1 || label > 8 ||
    !validDay(start_date) || !validDay(end_date) || start_date < a.start.slice(0, 10) || end_date < start_date ||
    end_date > daysAfter(start_date, 365) || !daily.length || daily.length > 12 || !daily.every(validTime))
    return err(res, 400, "bad_care_schedule");
  const rows = careRows(a.id), existing = reminder_id ? rows.find((r) => r.id === Number(reminder_id)) : null;
  if (reminder_id && !existing) return err(res, 404, "not_found");
  if (rows.some((r) => r.id !== existing?.id && r.kind === kind && r.label === label)) return err(res, 409, "care_label_in_use");
  const data = { kind, label, start_date, end_date, times: daily };
  if (existing) S.update("care_reminders", existing.id, data);
  else S.insert("care_reminders", { ...data, appointment_id: a.id, clinic_id: a.clinic_id, user_id: a.user_id, last_notified: null });
  logAccess(req, "care", a);
  pushUser(a.user_id, { type: "care" });
  res.json({ reminders: careRows(a.id) });
});
app.delete("/api/staff/appointments/:id/care-reminders/:reminderId", staffOnly, (req, res) => {
  const a = clinicAppt(req);
  if (!a) return err(res, 404, "not_found");
  if (!canManageCare(req.user, a)) return err(res, 403, "forbidden");
  const r = S.get("care_reminders", req.params.reminderId);
  if (!r || r.appointment_id !== a.id) return err(res, 404, "not_found");
  S.remove("care_reminders", r.id);
  logAccess(req, "care", a);
  pushUser(a.user_id, { type: "care" });
  res.json({ reminders: careRows(a.id) });
});
app.get("/api/my/care-reminders", auth("patient"), (req, res) => {
  const from = req.query.from || ymd(new Date());
  if (!validDay(from)) return err(res, 400, "bad_date");
  const days = req.query.days === "7" ? 7 : 1;
  const reminders = S.filter("care_reminders", (r) => r.user_id === req.user.id && r.end_date >= from && r.start_date <= daysAfter(from, days - 1));
  const events = reminders.flatMap((r) => {
    const a = S.get("appointments", r.appointment_id);
    if (a?.status !== "completed" || a.user_id !== req.user.id) return [];
    return occurrences(r, from, days).map((event) => ({ ...event, kind: r.kind, label: r.label,
      clinic: clinicName(r.clinic_id), patient: a.patient_name }));
  }).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.label - b.label);
  res.json({ from, days, timezone: process.env.TZ, events });
});
app.patch("/api/staff/appointments/:id", staffOnly, async (req, res) => {
  const a = clinicAppt(req);
  if (!a) return err(res, 404, "not_found");
  const b = req.body || {}, patch = {};
  if (b.patient_phone !== undefined) {
    if (b.patient_phone !== null && typeof b.patient_phone !== "string") return err(res, 400, "bad_phone");
    const phone = b.patient_phone?.trim() || null;
    if (phone && (phone.length > 64 || !/\d/.test(phone) || /[\r\n]/.test(phone))) return err(res, 400, "bad_phone");
    patch.patient_phone = phone;
  }
  if (b.patient_email !== undefined) {
    if (b.patient_email !== null && typeof b.patient_email !== "string") return err(res, 400, "bad_email");
    const email = b.patient_email?.trim() || null;
    if (email && (email.length > 254 || !emailPattern.test(email))) return err(res, 400, "bad_email");
    patch.patient_email = email;
  }
  const editsContact = Object.keys(patch).length > 0;
  let status;
  if (b.status && b.status !== a.status) {
    status = statusOf(a.clinic_id, b.status);
    if (!status) return err(res, 400, "bad_status");
    if (b.status === "cancelled") return err(res, 400, "use_cancel");
    const n = nowStr(), inside = ["checked_in", "waiting", "in_consult", "completed"].includes(b.status);
    Object.assign(patch, { status: b.status, checked_in_at: a.checked_in_at || (inside ? n : null),
      consult_at: a.consult_at || (["in_consult", "completed"].includes(b.status) ? n : null), completed_at: b.status === "completed" ? n : a.completed_at });
  }
  if (b.staff_notes !== undefined) patch.staff_notes = String(b.staff_notes).slice(0, 2000);
  const date = a.start.slice(0, 10);
  const result = await S.schedule({ clinicId: a.clinic_id, date, appointmentId: a.id }, ({ appointments, offers, appointment }) => {
    if (!appointment) return { code: 404, error: "not_found" };
    if (appointment._v !== a._v) return { code: 409, error: "appointment_changed" };
    const providerId = N(b.provider_id);
    const next = { ...patch };
    if (providerId && providerId !== appointment.provider_id) {
      if (appointment.status === "cancelled" || !slotsFor(a.clinic_id, date, { providerId, staff: true,
        duration: toMin(a.end.slice(11)) - toMin(a.start.slice(11)), ignoreId: a.id, appointments, offers }).some((s) => s.start === appointment.start))
        return { code: 409, error: "slot_taken" };
      next.provider_id = providerId;
    }
    if (a.status === "cancelled" && next.status) return { code: 409, error: "visit_closed" };
    if (!Object.keys(next).length) return { value: appointment };
    const value = revised(appointment, next);
    return { value, writes: [{ collection: "appointments", value }] };
  });
  if (result.error) return err(res, result.code, result.error);
  const v = apptView(result.value);
  const user = a.user_id ? S.get("users", a.user_id) : null;
  if (status && user) {
    const lang = userLang(user);
    notifyUser(user.id, lang === "fr" ? "Mise à jour du statut" : "Status update",
      notify.fillTemplate(a.clinic_id, "status_update", lang, { clinic: clinicName(a.clinic_id), status: lang === "fr" ? status.label_fr : status.label_en }), "status", a.id);
  }
  if (v.provider_id !== a.provider_id) {
    bookingNotice(v, user, "provider_change");
    offerFreedTime(a);
  }
  logAccess(req, editsContact ? "contact" : b.status ? "status" : b.provider_id ? "provider" : "notes", a);
  changed(v);
  res.json({ appointment: v });
});
app.post("/api/staff/appointments", staffOnly, async (req, res) => {
  const b = req.body || {};
  const name = String(b.patient_name || "").trim();
  if (!name || !b.start || !b.type_id) return err(res, 400, "missing_fields");
  const prior = b.patient_record ? S.get("appointments", b.patient_record) : null;
  if (b.patient_record && (!prior || prior.clinic_id !== clinicOf(req) || prior.patient_name !== name)) return err(res, 400, "not_found");
  const patient = prior?.user_id ? S.get("users", prior.user_id) : null;
  const member = prior?.member_id ? S.get("family_members", prior.member_id) : null;
  if (prior?.user_id && (!patient || (prior.member_id && member?.user_id !== patient.id))) return err(res, 400, "not_found");
  const r = await bookSlot({ clinicId: clinicOf(req), providerId: N(b.provider_id), typeId: Number(b.type_id), start: b.start, user: patient, memberId: member?.id,
    patientRecordId: prior?.patient_record_id || prior?.id, name, phone: b.phone, email: b.email,
    notifyPref: b.email ? (patient?.notify_pref || "email") : "app", reason: b.reason, source: b.source === "in_person" ? "in_person" : "phone" });
  if (r.error) return err(res, 409, r.error);
  if (b.email || patient) bookingNotice(r.appt, patient, "confirmation");
  logAccess(req, "book", r.appt);
  changed(r.appt);
  res.json({ appointment: r.appt });
});
const clinicForm = (req) => { const f = S.get("forms", req.params.id); const a = f && S.get("appointments", f.appointment_id); return a && a.clinic_id === clinicOf(req) ? { f, a } : null; };
app.post("/api/staff/forms/:id/return", staffOnly, (req, res) => {
  const x = clinicForm(req);
  if (!x) return err(res, 404, "not_found");
  const note = String(req.body?.note || "").slice(0, 500);
  S.update("forms", x.f.id, { status: "returned", staff_note: note });
  logAccess(req, "form", x.a);
  if (x.a.user_id) {
    const u = S.get("users", x.a.user_id), lang = userLang(u), title = lang === "fr" ? "Formulaire à corriger" : "Form needs a fix";
    notifyUser(u.id, title, note, "form", x.f.id);
    if (u.notify_pref === "email") notify.send({ to: u.email, subject: title, body: note, clinicId: x.a.clinic_id, lang });
    pushUser(u.id, { type: "forms" });
  }
  res.json({ ok: true });
});
app.post("/api/staff/forms/:id/accept", staffOnly, (req, res) => {
  const x = clinicForm(req);
  if (!x) return err(res, 404, "not_found");
  S.update("forms", x.f.id, { status: "accepted" });
  logAccess(req, "form", x.a);
  res.json({ ok: true });
});
app.post("/api/staff/appointments/:id/forms", staffOnly, (req, res) => {
  const a = clinicAppt(req), t = S.get("form_templates", req.body?.template_id);
  if (!a || !t || t.clinic_id !== a.clinic_id) return err(res, 404, "not_found");
  S.insert("forms", { appointment_id: a.id, template_id: t.id, title_en: t.title_en, title_fr: t.title_fr, fields: t.fields, answers: "{}", status: "todo", staff_note: null, due: a.start.slice(0, 10) });
  if (a.user_id) {
    const u = S.get("users", a.user_id), lang = userLang(u);
    const body = notify.fillTemplate(a.clinic_id, "forms_due", lang, { form: lang === "fr" ? t.title_fr : t.title_en, date: fmtDate(a.start, lang) });
    notifyUser(u.id, lang === "fr" ? "Nouveau formulaire" : "New form to complete", body, "form", a.id);
    if (u.notify_pref === "email") notify.send({ to: u.email, subject: lang === "fr" ? "Nouveau formulaire" : "New form to complete", body, clinicId: a.clinic_id, lang });
    pushUser(u.id, { type: "forms" });
  }
  res.json({ ok: true });
});
app.get("/api/staff/waitlist", staffOnly, (req, res) => {
  res.json({ waitlist: S.filter("waitlist", (w) => w.clinic_id === clinicOf(req) && (w.status === "waiting" || offerActive(w))).sort(waitlistOrder).map((w) => {
    const t = S.get("appt_types", w.type_id), u = S.get("users", w.user_id);
    return { ...w, provider_name: S.get("providers", w.provider_id)?.name || null, type_en: t?.name_en, type_fr: t?.name_fr, phone: u?.phone, email: u?.email };
  }) });
});
app.post("/api/staff/waitlist/:id/offer", staffOnly, async (req, res) => {
  const w = S.get("waitlist", req.params.id);
  if (!w || w.clinic_id !== clinicOf(req) || w.status !== "waiting" || !req.body?.start) return err(res, 404, "not_found");
  if (!await sendOffer(w, req.body.start, Number(req.body.provider_id))) return err(res, 409, "slot_taken");
  res.json({ ok: true });
});
app.delete("/api/staff/waitlist/:id", staffOnly, async (req, res) => {
  const w = S.get("waitlist", req.params.id);
  if (w && w.clinic_id === clinicOf(req)) await releaseWaitlist(w, "removed");
  res.json({ ok: true });
});
app.get("/api/staff/messages", staffOnly, (req, res) => {
  const by = new Map();
  for (const m of S.filter("messages", (x) => x.clinic_id === clinicOf(req)).sort((a, b) => a.id - b.id)) {
    const t = by.get(m.user_id) || { user_id: m.user_id, unread: 0, handoff: 0 };
    t.last_id = m.id; t.last_body = m.body; t.last_at = m.created_at;
    if (m.sender !== "staff" && !m.read_staff) t.unread++;
    if (m.handoff && !m.read_staff) t.handoff = 1;
    by.set(m.user_id, t);
  }
  const threads = [...by.values()].map((t) => { const u = S.get("users", t.user_id) || {}; return { ...t, first_name: u.first_name, last_name: u.last_name, phone: u.phone, email: u.email }; })
    .sort((a, b) => b.handoff - a.handoff || b.last_id - a.last_id);
  res.json({ threads });
});
app.get("/api/staff/messages/:userId", staffOnly, (req, res) => {
  const uid = Number(req.params.userId);
  const rows = S.filter("messages", (m) => m.clinic_id === clinicOf(req) && m.user_id === uid).sort((a, b) => a.id - b.id);
  rows.filter((m) => !m.read_staff).forEach((m) => S.update("messages", m.id, { read_staff: 1 }));
  res.json({ messages: rows, patient: publicUser(S.get("users", uid)) });
});
app.post("/api/staff/messages/:userId", staffOnly, (req, res) => {
  const body = String(req.body?.body || "").trim().slice(0, 2000), uid = Number(req.params.userId);
  if (!body) return err(res, 400, "missing_fields");
  S.insert("messages", { clinic_id: clinicOf(req), user_id: uid, sender: "staff", body, handoff: 0, read_staff: 1, read_patient: 0 });
  const u = S.get("users", uid);
  if (u?.notify_pref === "email") {
    const lang = userLang(u);
    notify.send({ to: u.email, subject: (lang === "fr" ? "Nouveau message de " : "New message from ") + clinicName(clinicOf(req)), body, clinicId: clinicOf(req), lang });
  }
  pushUser(uid, { type: "messages" });
  pushClinic(clinicOf(req), { type: "messages" });
  res.json({ ok: true });
});

// ---------- administration ----------
app.patch("/api/admin/clinic", adminOnly, (req, res) => {
  const b = req.body || {}, patch = {};
  ["name", "address", "city", "postal", "phone", "email", "description_en", "description_fr", "photo", "specialty"].forEach((k) => { if (b[k] !== undefined) patch[k] = String(b[k]).slice(0, 1000); });
  if (b.hours) patch.hours = JSON.stringify(b.hours);
  if (b.cancel_hours !== undefined) patch.cancel_hours = Math.max(0, Number(b.cancel_hours) || 0);
  if (b.slot_minutes !== undefined) patch.slot_minutes = Math.max(5, Number(b.slot_minutes) || 15);
  if (b.accepting_online !== undefined) patch.accepting_online = b.accepting_online ? 1 : 0;
  if (patch.hours && Object.values(JSON.parse(patch.hours)).some((h) => !Array.isArray(h) || !validTime(h[0]) || !validTime(h[1]) || h[0] >= h[1]))
    return err(res, 400, "bad_hours");
  S.update("clinics", clinicOf(req), patch);
  res.json({ ok: true });
});
const clinicProv = (req) => { const p = S.get("providers", req.params.id); return p && p.clinic_id === clinicOf(req) ? p : null; };
app.post("/api/admin/providers", adminOnly, (req, res) => {
  const b = req.body || {};
  if (!b.name) return err(res, 400, "missing_fields");
  const p = S.insert("providers", { clinic_id: clinicOf(req), name: b.name, title: b.title || "", specialty: b.specialty || "", languages: b.languages || "", bio_en: "", bio_fr: "", active: 1 });
  for (let wd = 1; wd <= 5; wd++) S.insert("availability", { provider_id: p.id, weekday: wd, start: "09:00", end: "17:00" });
  res.json({ id: p.id });
});
app.patch("/api/admin/providers/:id", adminOnly, (req, res) => {
  const p = clinicProv(req);
  if (!p) return err(res, 404, "not_found");
  const b = req.body || {};
  S.update("providers", p.id, { name: b.name ?? p.name, title: b.title ?? p.title, specialty: b.specialty ?? p.specialty, languages: b.languages ?? p.languages, active: b.active ? 1 : 0 });
  pushClinic(clinicOf(req), { type: "meta" });
  res.json({ ok: true });
});
app.put("/api/admin/providers/:id/availability", adminOnly, (req, res) => {
  const p = clinicProv(req);
  if (!p) return err(res, 404, "not_found");
  S.removeWhere("availability", (a) => a.provider_id === p.id);
  for (const a of req.body?.availability || []) if (a.start < a.end) S.insert("availability", { provider_id: p.id, weekday: Number(a.weekday), start: a.start, end: a.end });
  pushClinic(clinicOf(req), { type: "meta" });
  res.json({ ok: true });
});
app.post("/api/admin/blocks", adminOnly, (req, res) => {
  const b = req.body || {}, p = S.get("providers", b.provider_id);
  if (!p || p.clinic_id !== clinicOf(req)) return err(res, 404, "not_found");
  S.insert("blocks", { provider_id: p.id, date: b.date, start: b.start, end: b.end, reason: b.reason || "" });
  pushClinic(clinicOf(req), { type: "meta" });
  res.json({ ok: true });
});
app.delete("/api/admin/blocks/:id", adminOnly, (req, res) => {
  const b = S.get("blocks", req.params.id);
  if (b && S.get("providers", b.provider_id)?.clinic_id === clinicOf(req)) S.remove("blocks", b.id);
  res.json({ ok: true });
});
app.get("/api/admin/staff", adminOnly, (req, res) => {
  res.json({ staff: S.filter("users", (u) => u.clinic_id === clinicOf(req) && u.role !== "patient").sort((a, b) => (a.role === "admin" ? -1 : 1) - (b.role === "admin" ? -1 : 1) || a.first_name.localeCompare(b.first_name)).map(publicUser) });
});
const staffRoles = ["reception", "nurse", "practitioner", "admin"];
function staffAssignment(clinicId, staffRole, providerId) {
  if (!staffRoles.includes(staffRole)) return null;
  const provider = staffRole === "practitioner" ? S.get("providers", providerId) : null;
  if (staffRole === "practitioner" && (!provider?.active || provider.clinic_id !== clinicId)) return null;
  return { staff_role: staffRole, provider_id: provider?.id || null, role: staffRole === "admin" ? "admin" : "staff" };
}
app.post("/api/admin/staff", adminOnly, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.first_name || !b.password) return err(res, 400, "missing_fields");
  if (String(b.password).length < 8) return err(res, 400, "weak_password");
  if (userByEmail(b.email)) return err(res, 409, "email_taken");
  const assignment = staffAssignment(clinicOf(req), b.staff_role || "reception", b.provider_id);
  if (!assignment) return err(res, 400, "bad_staff_assignment");
  const u = S.insert("users", { email: b.email.toLowerCase().trim(), phone: b.phone || null, password_hash: hashSecret(b.password), ...assignment, clinic_id: clinicOf(req),
    first_name: b.first_name, last_name: b.last_name || "", lang: b.lang || "en", twofa: "none", account_pin_hash: null, email_verified: 0, notify_pref: "app" });
  const lang = userLang(u), cn = clinicName(clinicOf(req));
  notify.send({ to: u.email, lang, clinicId: clinicOf(req), subject: lang === "fr" ? `Votre accès ClinicFlow – ${cn}` : `Your ClinicFlow access – ${cn}`,
    body: lang === "fr" ? `Bonjour ${u.first_name}, un compte ClinicFlow a été créé pour vous à ${cn}. Connectez-vous avec ce courriel et le mot de passe temporaire que l'administrateur vous a donné.`
      : `Hi ${u.first_name}, a ClinicFlow account was created for you at ${cn}. Sign in with this email and the temporary password your administrator gave you.` });
  res.json({ ok: true });
}));
app.patch("/api/admin/staff/:id", adminOnly, (req, res) => {
  const u = S.get("users", req.params.id);
  if (!u || u.clinic_id !== clinicOf(req)) return err(res, 404, "not_found");
  const sr = req.body?.staff_role || u.staff_role;
  if (u.id === req.user.id && sr !== "admin") return err(res, 400, "cannot_demote_self");
  const assignment = staffAssignment(clinicOf(req), sr, req.body?.provider_id ?? u.provider_id);
  if (!assignment) return err(res, 400, "bad_staff_assignment");
  S.update("users", u.id, assignment);
  res.json({ ok: true });
});
app.delete("/api/admin/staff/:id", adminOnly, (req, res) => {
  const u = S.get("users", req.params.id);
  if (Number(req.params.id) === req.user.id) return err(res, 400, "cannot_demote_self");
  if (u && u.clinic_id === clinicOf(req) && u.role !== "patient") { S.remove("users", u.id); S.removeWhere("sessions", (s) => s.user_id === u.id); }
  res.json({ ok: true });
});
const clinicRow = (col, req) => { const x = S.get(col, req.params.id); return x && x.clinic_id === clinicOf(req) ? x : null; };
app.post("/api/admin/types", adminOnly, (req, res) => {
  const b = req.body || {};
  S.insert("appt_types", { clinic_id: clinicOf(req), name_en: b.name_en, name_fr: b.name_fr || b.name_en, minutes: Number(b.minutes) || 15, color: b.color || "#2BB3A3" });
  res.json({ ok: true });
});
app.patch("/api/admin/types/:id", adminOnly, (req, res) => {
  const t = clinicRow("appt_types", req);
  if (!t) return err(res, 404, "not_found");
  const b = req.body || {};
  S.update("appt_types", t.id, { name_en: b.name_en ?? t.name_en, name_fr: b.name_fr ?? t.name_fr, minutes: Number(b.minutes) || t.minutes, color: b.color || t.color });
  res.json({ ok: true });
});
app.delete("/api/admin/types/:id", adminOnly, (req, res) => {
  const t = clinicRow("appt_types", req);
  if (!t) return err(res, 404, "not_found");
  if (S.find("appointments", (a) => a.type_id === t.id)) return err(res, 400, "type_in_use");
  S.remove("appt_types", t.id);
  res.json({ ok: true });
});
app.post("/api/admin/statuses", adminOnly, (req, res) => {
  const b = req.body || {};
  if (!b.label_en) return err(res, 400, "missing_fields");
  const key = b.label_en.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom";
  if (statusOf(clinicOf(req), key)) return err(res, 409, "status_exists");
  const sort = Math.max(0, ...S.filter("statuses", (s) => s.clinic_id === clinicOf(req) && !["no_show", "cancelled"].includes(s.key)).map((s) => s.sort)) + 1;
  S.insert("statuses", { clinic_id: clinicOf(req), key, label_en: b.label_en, label_fr: b.label_fr || b.label_en, color: b.color || "#16A085", sort: Number(b.sort) || sort, system: 0 });
  pushClinic(clinicOf(req), { type: "meta" });
  res.json({ ok: true });
});
app.patch("/api/admin/statuses/:id", adminOnly, (req, res) => {
  const s = clinicRow("statuses", req);
  if (!s) return err(res, 404, "not_found");
  const b = req.body || {};
  S.update("statuses", s.id, { label_en: b.label_en ?? s.label_en, label_fr: b.label_fr ?? s.label_fr, color: b.color || s.color, sort: Number(b.sort) || s.sort });
  res.json({ ok: true });
});
app.delete("/api/admin/statuses/:id", adminOnly, (req, res) => {
  const s = clinicRow("statuses", req);
  if (!s || s.system) return err(res, 400, "system_status");
  if (S.find("appointments", (a) => a.clinic_id === s.clinic_id && a.status === s.key)) return err(res, 400, "status_in_use");
  S.remove("statuses", s.id);
  res.json({ ok: true });
});
app.put("/api/admin/templates/:key", adminOnly, (req, res) => {
  const t = S.find("templates", (x) => x.clinic_id === clinicOf(req) && x.key === req.params.key);
  const data = { body_en: req.body?.body_en || "", body_fr: req.body?.body_fr || "", reviewed_at: S.nowStamp() };
  if (t) S.update("templates", t.id, data); else S.insert("templates", { clinic_id: clinicOf(req), key: req.params.key, ...data });
  res.json({ ok: true });
});
app.put("/api/admin/form-templates/:id", adminOnly, (req, res) => {
  const b = req.body || {};
  const fields = JSON.stringify((b.fields || []).filter((f) => f.en).map((f, i) => ({ id: f.id || `q${i + 1}`, en: f.en, fr: f.fr || f.en, type: "text" })));
  const data = { title_en: b.title_en, title_fr: b.title_fr || b.title_en, fields };
  if (req.params.id === "new") S.insert("form_templates", { clinic_id: clinicOf(req), ...data });
  else { const f = clinicRow("form_templates", req); if (!f) return err(res, 404, "not_found"); S.update("form_templates", f.id, data); }
  res.json({ ok: true });
});
app.get("/api/admin/audit", adminOnly, (req, res) => {
  res.json({ audit: S.filter("audit", (a) => a.clinic_id === clinicOf(req)).sort((a, b) => b.id - a.id).slice(0, 300), agreement: S.get("clinics", clinicOf(req))?.agreement_at || null });
});
app.get("/api/admin/outbox", adminOnly, (req, res) => {
  res.json({ outbox: S.filter("outbox", (o) => o.clinic_id === clinicOf(req)).sort((a, b) => b.id - a.id).slice(0, 60), demoMode: notify.demoMode() });
});
app.get("/api/admin/stats", adminOnly, (req, res) => {
  const c = clinicOf(req), since = ymd(new Date(Date.now() - 30 * 86400000));
  const rows = S.filter("appointments", (a) => a.clinic_id === c && a.start.slice(0, 10) >= since);
  const done = rows.filter((r) => r.checked_in_at && r.consult_at);
  const avgWait = done.length ? Math.round(done.reduce((s, r) => s + Math.max(0, (toDate(r.consult_at) - toDate(r.checked_in_at)) / 60000), 0) / done.length) : 0;
  const n = (fn) => rows.filter(fn).length;
  res.json({ total: rows.length, online: n((r) => r.source === "online"), phone: n((r) => r.source === "phone"), in_person: n((r) => r.source === "in_person"),
    cancelled: n((r) => r.status === "cancelled"), no_show: n((r) => r.status === "no_show"), avg_wait: avgWait,
    waitlist_filled: S.count("waitlist", (w) => w.clinic_id === c && w.status === "booked") });
});

// ---------- real-time stream ----------
app.get("/api/events", (req, res) => {
  const s = session(req);
  if (!s || s.stage !== "ok") return res.status(401).end();
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  streams.set(res, { userId: s.user.id, clinicId: s.user.clinic_id, role: s.user.role });
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); streams.delete(res); });
});

// ---------- reminders + retention clean-up: emailed automatically ~24 h before each visit (checked every 10 minutes) ----------
function sendReminders() {
  const now = nowStr(), soon = addMin(now, 24 * 60);
  for (const a of S.filter("appointments", (x) => x.status === "booked" && !x.reminder_sent && x.start >= now && x.start <= soon)) {
    const u = a.user_id ? S.get("users", a.user_id) : null, lang = userLang(u);
    const body = notify.fillTemplate(a.clinic_id, "reminder", lang, { clinic: clinicName(a.clinic_id), time: fmtT(a.start, lang), date: fmtDate(a.start, lang) });
    const title = lang === "fr" ? "Rappel de rendez-vous" : "Appointment reminder";
    if ((a.notify_pref || "email") === "email" && a.patient_email) notify.send({ to: a.patient_email, subject: title, body, clinicId: a.clinic_id, lang });
    if (u) notifyUser(u.id, title, body, "reminder", a.id);
    S.update("appointments", a.id, { reminder_sent: 1 });
  }
  // Retention schedule (see Privacy Policy section 9): delete what we no longer need.
  const older = (days) => (x) => toDate(String(x.created_at).slice(0, 16)).getTime() < Date.now() - days * 86400000;
  S.removeWhere("sessions", older(30));
  S.removeWhere("crowd_reports", older(30));
  S.removeWhere("outbox", older(90));
  S.removeWhere("notifications", older(180));
  S.removeWhere("audit", older(365));
}

async function checkCareReminders() {
  const now = nowStr(), from = now.slice(0, 10), cutoff = addMin(now, -5);
  const rows = S.filter("care_reminders", (r) => r.start_date <= from && r.end_date >= cutoff.slice(0, 10));
  for (const r of rows) {
    const a = S.get("appointments", r.appointment_id), u = S.get("users", r.user_id);
    if (!u || a?.status !== "completed" || a.user_id !== u.id) continue;
    const due = occurrences(r, cutoff.slice(0, 10), cutoff.slice(0, 10) === from ? 1 : 2)
      .map(({ date, time }) => date + " " + time)
      .filter((when) => when <= now && when >= cutoff && when > (r.last_notified || "")).at(-1);
    if (!due) continue;
    const lang = userLang(u), fr = lang === "fr";
    const title = fr ? "Rappel ClinicFlow" : "ClinicFlow reminder";
    const body = fr ? "Un rappel est prévu. Ouvrez votre calendrier de rappels dans ClinicFlow." : "You have a scheduled reminder. Open your reminder calendar in ClinicFlow.";
    const sent = await S.addCareNotice(r, due, { user_id: u.id, title, body, kind: "care", ref_id: r.id, read: 0 });
    if (!sent) continue;
    pushUser(u.id, { type: "care" });
    if (u.email_verified && u.notify_pref === "email") void notify.send({ to: u.email, subject: title, body, lang });
  }
}
async function checkShortTimers() {
  for (const [key, value] of codes) if (value.expires <= Date.now()) codes.delete(key);
  for (const w of S.filter("waitlist", (x) => x.status === "offered" && !offerActive(x))) await releaseWaitlist(w, "expired");
  await checkCareReminders();
}

// ---------- errors & app fallback ----------
app.use("/api", (req, res) => err(res, 404, "not_found"));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
app.use((e, req, res, next) => {
  if (e.message === "email_failed") return err(res, 502, "email_failed");
  if (e.message === "code_locked") return err(res, 429, "too_many_attempts");
  console.error(e);
  err(res, 500, "server_error");
});

const PORT = Number(process.env.PORT) || 3000;
async function main() {
  const reset = process.argv.includes("--reset");
  console.log("\n  Starting ClinicFlow…");
  const mode = await store.init({ reset });
  const samples = process.env.SAMPLE_DATA === "yes" || (mode === "file" && process.env.SAMPLE_DATA !== "no");
  if (store.isEmpty() && samples) { seed(); console.log("  Created the starter clinics and sample accounts"); }
  notify.setup();
  await store.flush();
  setInterval(sendReminders, 10 * 60000);
  setTimeout(sendReminders, 5000);
  const timerJob = () => void checkShortTimers().catch((e) => console.error("[reminders]", e.message));
  setInterval(timerJob, 30 * 1000);
  setTimeout(timerJob, 5000);
  app.listen(PORT, () => {
    console.log(`\n  ✅ ClinicFlow is running → open http://localhost:${PORT} in your browser`);
    console.log(`  Data:  ${mode === "firebase" ? "Firebase Firestore ✔" : "LOCAL FILE (add your Firebase key to use Firebase – see SETUP.md)"}`);
    console.log(`  Email: ${notify.demoMode() ? "NOT SET UP – codes appear on screen (add GMAIL_USER and GMAIL_APP_PASSWORD – see SETUP.md)" : "Gmail ✔"}\n`);
  });
}
if (require.main === module) main().catch((e) => { console.error("\n  ❌ ClinicFlow could not start:", e.message, "\n"); process.exit(1); });
module.exports = app;
