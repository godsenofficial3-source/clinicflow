// Live "how busy is it?" and predicted wait-time estimates for each clinic.
// Combines (1) what the clinic system knows right now (who is checked in / waiting / in consultation,
// how late the schedule is running, how long each visit type really takes) with
// (2) optional crowd reports that patients send from the clinic (like Google Maps "how crowded is it?").
const store = require("./store");
const { ymd } = require("./db");

const toDate = (s) => { const [d, t = "00:00"] = s.split(" "); const [y, m, dd] = d.split("-").map(Number); const [h, mi] = t.split(":").map(Number); return new Date(y, m - 1, dd, h, mi); };
const minsBetween = (a, b) => (toDate(b) - toDate(a)) / 60000;
const fmt = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function load(clinicId) {
  const now = new Date();
  const today = ymd(now), wd = now.getDay(), hhmm = fmt(now);
  const provIds = new Set(store.filter("providers", (p) => p.clinic_id === clinicId && p.active).map((p) => p.id));
  const onDuty = new Set(store.filter("availability", (a) => provIds.has(a.provider_id) && a.weekday === wd && a.start <= hhmm && a.end > hhmm).map((a) => a.provider_id)).size;
  const todays = store.filter("appointments", (a) => a.clinic_id === clinicId && a.start.slice(0, 10) === today);
  const count = (s) => todays.filter((a) => a.status === s).length;
  const present = count("checked_in") + count("waiting");
  const providers = Math.max(onDuty, 1);
  const late = todays.filter((a) => a.consult_at && minsBetween(a.start, `${today} ${hhmm}`) <= 120).map((a) => Math.max(0, minsBetween(a.start, a.consult_at)));
  const delay = late.length ? late.reduce((x, y) => x + y, 0) / late.length : 0;
  const since = Date.now() - 90 * 60000;
  const reports = store.filter("crowd_reports", (r) => r.clinic_id === clinicId && toDate(r.created_at.slice(0, 16)).getTime() >= since);
  let level = present / providers < 1 ? 1 : present / providers < 2.5 ? 2 : 3;
  if (onDuty === 0) level = 1;
  if (reports.length) {
    const avg = reports.reduce((s, r) => s + r.level, 0) / reports.length;
    const w = Math.min(reports.length, 5) / 2;
    level = Math.round((level + avg * w) / (1 + w));
  }
  const waited = reports.filter((r) => r.waited_minutes != null).map((r) => r.waited_minutes);
  return { level, present, inConsult: count("in_consult"), providers: onDuty, delay: Math.round(delay), reports: reports.length,
    reportedWait: waited.length ? waited.reduce((x, y) => x + y, 0) / waited.length : null, open: onDuty > 0 };
}

function consultMinutes(clinicId, typeId) {
  const type = typeId ? store.get("appt_types", typeId) : null;
  const real = store.filter("appointments", (a) => a.clinic_id === clinicId && (!typeId || a.type_id === typeId) && a.consult_at && a.completed_at)
    .slice(-30).map((a) => minsBetween(a.consult_at, a.completed_at)).filter((m) => m > 0 && m < 180);
  const planned = type ? type.minutes : 20;
  return real.length >= 3 ? Math.round(0.5 * planned + 0.5 * (real.reduce((x, y) => x + y, 0) / real.length)) : planned;
}

/** Estimate each stage of the visit. If `appointment` is given, estimate for that booked visit. */
function estimate(clinicId, typeId = null, appointment = null) {
  const L = load(clinicId);
  const checkin = 2 + L.level * 2;
  let waiting;
  if (appointment) {
    const ahead = store.count("appointments", (a) => a.provider_id === appointment.provider_id && a.start.slice(0, 10) === appointment.start.slice(0, 10)
      && a.start < appointment.start && ["checked_in", "waiting", "booked"].includes(a.status));
    waiting = Math.max(L.delay, 0) + Math.min(ahead, 3) * 2 + (L.level - 1) * 4;
  } else {
    waiting = Math.round((L.present / Math.max(L.providers, 1)) * consultMinutes(clinicId, null) * 0.6 + L.delay);
  }
  if (L.reportedWait != null) waiting = Math.round(0.6 * waiting + 0.4 * L.reportedWait);
  waiting = Math.max(waiting, 2);
  const consult = consultMinutes(clinicId, typeId || appointment?.type_id || null);
  const wrapup = 5;
  const total = checkin + waiting + consult + wrapup;
  const arrive = appointment ? new Date(toDate(appointment.start).getTime() - 10 * 60000) : new Date();
  const doneBy = new Date(Math.max(arrive.getTime(), Date.now()) + total * 60000);
  return { level: L.level, present: L.present, providers: L.providers, delay: L.delay, reports: L.reports, open: L.open,
    stages: { checkin, waiting, consult, wrapup }, total, arriveBy: fmt(arrive), doneBy: fmt(doneBy) };
}

module.exports = { load, estimate, toDate, minsBetween };
