// ClinicFlow data store.
// All data lives in FIREBASE (Cloud Firestore). The server keeps a live in-memory mirror of every
// collection (kept in sync with Firestore listeners) so pages load instantly and Firestore reads stay
// inside the free quota. Every change is written to Firestore right away.
//
// If no Firebase key is found, it falls back to a local file (data/clinicflow.json) so the app still runs.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const COLLECTIONS = ["clinics", "users", "family_members", "sessions", "providers", "availability", "blocks", "appt_types", "statuses",
  "appointments", "waitlist", "form_templates", "forms", "messages", "templates", "saved_clinics", "crowd_reports", "notifications", "outbox", "consents", "audit"];

const mem = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
const nextId = Object.fromEntries(COLLECTIONS.map((c) => [c, 1]));
let fsdb = null;          // Firestore instance when connected
let mode = "file";
let fileTimer = null;
let writeChain = Promise.resolve();

function serviceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try { return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch { console.error("[store] FIREBASE_SERVICE_ACCOUNT is not valid JSON"); }
  }
  for (const f of ["firebase-service-account.json", "serviceAccountKey.json"]) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  // Also accept the key file under the name Firebase gave it (…-firebase-adminsdk-….json), in the
  // project folder or in /etc/secrets (Render "Secret Files").
  for (const dir of [ROOT, "/etc/secrets"]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const f of names.filter((n) => n.endsWith(".json") && n !== "package.json" && n !== "package-lock.json")) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if (j && j.type === "service_account" && j.private_key) return j;
      } catch {}
    }
  }
  return null;
}

const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const FILE = path.join(DATA_DIR, "clinicflow.json");

function track(col, obj, fromListener = false) {
  const cur = mem[col].get(Number(obj.id));
  if (fromListener && cur && (cur._v || 0) > (obj._v || 0)) return;   // ignore an older echo of our own write
  mem[col].set(Number(obj.id), obj);
  if (Number(obj.id) >= nextId[col]) nextId[col] = Number(obj.id) + 1;
}

async function init({ reset = false } = {}) {
  const sa = serviceAccount();
  if (sa) {
    const { initializeApp, cert, getApps } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    if (!getApps().length) initializeApp({ credential: cert(sa) });
    fsdb = getFirestore();
    fsdb.settings({ ignoreUndefinedProperties: true });
    mode = "firebase";
    if (reset) await wipeFirestore();
    await Promise.all(COLLECTIONS.map(async (c) => {
      const snap = await fsdb.collection(c).get();
      snap.forEach((d) => track(c, { ...d.data(), id: Number(d.id) }));
    }));
    // keep the mirror in sync with changes made directly in the Firebase console
    COLLECTIONS.filter((c) => c !== "sessions").forEach((c) => fsdb.collection(c).onSnapshot((snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type === "removed") mem[c].delete(Number(ch.doc.id));
        else track(c, { ...ch.doc.data(), id: Number(ch.doc.id) }, true);
      });
    }, (e) => console.error("[store] listener", c, e.message)));
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (reset && fs.existsSync(FILE)) fs.rmSync(FILE);
    if (fs.existsSync(FILE)) {
      const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
      for (const c of COLLECTIONS) (data[c] || []).forEach((o) => track(c, o));
    }
  }
  return mode;
}

async function wipeFirestore() {
  for (const c of COLLECTIONS) {
    const snap = await fsdb.collection(c).get();
    let batch = fsdb.batch(), n = 0;
    for (const d of snap.docs) { batch.delete(d.ref); if (++n % 400 === 0) { await batch.commit(); batch = fsdb.batch(); } }
    await batch.commit();
  }
}

function persist(col, id, obj) {
  if (mode === "firebase") {
    const ref = fsdb.collection(col).doc(String(id));
    writeChain = writeChain.then(() => (obj ? ref.set(obj) : ref.delete())).catch((e) => console.error("[store] write failed", col, id, e.message));
  } else {
    clearTimeout(fileTimer);
    fileTimer = setTimeout(() => {
      const out = Object.fromEntries(COLLECTIONS.map((c) => [c, [...mem[c].values()]]));
      fs.writeFileSync(FILE + ".tmp", JSON.stringify(out));
      fs.renameSync(FILE + ".tmp", FILE);
    }, 150);
  }
}

const clone = (o) => (o ? { ...o } : o);
const store = {
  get mode() { return mode; },
  init,
  flush: () => writeChain,
  all: (col) => [...mem[col].values()].map(clone),
  get: (col, id) => (id == null ? undefined : clone(mem[col].get(Number(id)))),
  find: (col, fn) => { for (const o of mem[col].values()) if (fn(o)) return clone(o); return undefined; },
  filter: (col, fn) => [...mem[col].values()].filter(fn).map(clone),
  count: (col, fn) => { let n = 0; for (const o of mem[col].values()) if (!fn || fn(o)) n++; return n; },
  insert(col, data) {
    const id = nextId[col]++;
    const obj = { ...data, id, created_at: data.created_at || nowStamp(), _v: 1 };
    mem[col].set(id, obj);
    persist(col, id, obj);
    return clone(obj);
  },
  update(col, id, patch) {
    const cur = mem[col].get(Number(id));
    if (!cur) return undefined;
    const obj = { ...cur, ...patch, id: cur.id, _v: (cur._v || 0) + 1 };
    mem[col].set(cur.id, obj);
    persist(col, cur.id, obj);
    return clone(obj);
  },
  remove(col, id) { if (mem[col].delete(Number(id))) persist(col, Number(id), null); },
  removeWhere(col, fn) { for (const o of [...mem[col].values()]) if (fn(o)) store.remove(col, o.id); },
  isEmpty: () => mem.clinics.size === 0,
};

function nowStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
store.nowStamp = nowStamp;

module.exports = store;
