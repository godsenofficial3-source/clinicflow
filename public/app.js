/* ClinicFlow – core: state, API, router, i18n, accessibility, voice control, real-time updates, shared UI. */
(function () {
  const CF = (window.CF = {});
  // Browser storage. Only "token" (sign-in) and "consent" (your choices) are strictly necessary.
  // Everything else is a preference, saved on the device only if the person allowed preferences
  // (Cookie settings); otherwise it is kept in memory and forgotten when the page closes.
  const ESSENTIAL = ["token", "consent"];
  const mem = {};
  const prefsAllowed = () => { try { const c = JSON.parse(localStorage.getItem("cf_consent")); return !!(c && c.prefs); } catch { return false; } };
  const store = {
    get(k, d) {
      if (!ESSENTIAL.includes(k) && !prefsAllowed()) return k in mem ? mem[k] : d;
      try { const v = localStorage.getItem("cf_" + k); return v == null ? d : JSON.parse(v); } catch { return k in mem ? mem[k] : d; }
    },
    set(k, v) {
      mem[k] = v;
      if (!ESSENTIAL.includes(k) && !prefsAllowed()) return;
      try { localStorage.setItem("cf_" + k, JSON.stringify(v)); } catch {}
    },
    del(k) { delete mem[k]; try { localStorage.removeItem("cf_" + k); } catch {} },
    clearPrefs() { try { Object.keys(localStorage).filter((k) => k.startsWith("cf_") && !ESSENTIAL.includes(k.slice(3))).forEach((k) => localStorage.removeItem(k)); } catch {} },
  };
  CF.store = store;
  const S = (CF.state = {
    token: store.get("token", null), user: null, members: [], clinic: null, config: {}, unread: { notifications: 0, messages: 0 },
    lang: store.get("lang", (navigator.language || "en").startsWith("fr") ? "fr" : "en"),
    a11y: Object.assign({ size: 100, contrast: false, motion: false, spacing: false }, store.get("a11y", {})),
  });

  // ---------- i18n ----------
  CF.t = (key, vars) => {
    let s = (window.I18N[S.lang] && window.I18N[S.lang][key]) ?? window.I18N.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
    return s;
  };
  const t = CF.t;
  CF.L = (o, base) => (o ? (S.lang === "fr" ? o[base + "_fr"] || o[base + "_en"] : o[base + "_en"] || o[base + "_fr"]) || "" : "");
  CF.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const esc = CF.esc;
  const loc = () => (S.lang === "fr" ? "fr-CA" : "en-CA");
  CF.toDate = (s) => { const [d, tm = "00:00"] = s.split(" "); const [y, m, dd] = d.split("-").map(Number); const [h, mi] = tm.split(":").map(Number); return new Date(y, m - 1, dd, h, mi); };
  CF.ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  CF.fmtTime = (s) => { const d = s.includes(" ") ? CF.toDate(s) : CF.toDate(`2000-01-01 ${s}`); return d.toLocaleTimeString(loc(), { hour: "numeric", minute: "2-digit" }); };
  CF.fmtDate = (s, opts = { weekday: "long", month: "long", day: "numeric" }) => CF.toDate(s.length > 10 ? s : s + " 00:00").toLocaleDateString(loc(), opts);
  CF.fmtShort = (s) => CF.fmtDate(s, { weekday: "short", month: "short", day: "numeric" });
  CF.dayName = (wd, style = "long") => new Date(2024, 0, 7 + wd).toLocaleDateString(loc(), { weekday: style });
  CF.relDay = (s) => {
    const d = s.slice(0, 10), today = CF.ymd(new Date()), tm = new Date(); tm.setDate(tm.getDate() + 1);
    return d === today ? t("today") : d === CF.ymd(tm) ? t("tomorrow") : CF.fmtDate(d);
  };
  CF.mins = (m) => (m >= 60 ? t("hours_mins", { h: Math.floor(m / 60), m: m % 60 }) : t("n_min", { n: m }));

  // ---------- API ----------
  // Where the server is. Empty = same website. In the one-file version, set window.CLINICFLOW_SERVER = "https://your-server".
  CF.base = String(window.CLINICFLOW_SERVER || "").replace(/\/$/, "");
  CF.api = async (method, path, body) => {
    const r = await fetch(CF.base + "/api" + path, {
      method, headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && j.error === "auth_required" && S.user) { CF.logout(true); throw Object.assign(new Error("auth"), { data: j }); }
    if (!r.ok) throw Object.assign(new Error(j.error || "error"), { data: j, status: r.status });
    return j;
  };
  CF.errMsg = (e) => t("err_" + (e?.data?.error || (e instanceof TypeError ? "Failed_to_fetch" : "server_error")), e?.data || {});

  // ---------- icons (Lucide, MIT) ----------
  const P = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', check: '<path d="M20 6 9 17l-5-5"/>',
    todo: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    a11y: '<circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>', nav: '<path d="m3 11 19-9-9 19-2-8-8-2z"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
    speak: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    queue: '<rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="10" rx="1"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>', bot: '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
    chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>', chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>', trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>', alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    door: '<path d="M13 4h3a2 2 0 0 1 2 2v14M2 20h3M13 20h9M10 12v.01M13 4.56v16.88a.5.5 0 0 1-.63.48L5 20V5.24a1 1 0 0 1 .76-.97l6.62-1.65a.5.5 0 0 1 .62.49z"/>',
    steth: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  CF.icon = (n, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[n] || ""}</svg>`;
  const I = CF.icon;

  // ---------- shared UI pieces ----------
  CF.chip = (label, color, extra = "") => `<span class="chip ${extra}" style="--c:${esc(color || "#5B7FA6")}"><span class="dot" aria-hidden="true"></span>${esc(label)}</span>`;
  CF.statusChip = (a) => CF.chip(a.status_info ? CF.L(a.status_info, "label") : a.status, a.status_info?.color);
  CF.typeChip = (ty) => (ty ? CF.chip(`${CF.L(ty, "name")} · ${t("n_min", { n: ty.minutes })}`, ty.color, "chip-soft") : "");
  CF.crowd = (level) => {
    const k = ["", "quiet", "moderate", "busy"][level] || "quiet";
    return `<span class="crowd crowd-${k}"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>${t("crowd_" + k)}</span>`;
  };
  const STEPS = ["booked", "checked_in", "waiting", "in_consult", "completed"];
  CF.tracker = (a) => {
    const idx = Math.max(STEPS.indexOf(a.status), 0);
    return `<ol class="tracker" aria-label="${esc(t("visit_progress"))}">${STEPS.map((s, i) =>
      `<li class="${i < idx ? "done" : i === idx ? "now" : ""}" ${i === idx ? 'aria-current="step"' : ""}><span class="node" aria-hidden="true">${i < idx ? I("check") : i + 1}</span><span class="lbl">${t("st_" + s)}</span></li>`).join("")}</ol>`;
  };
  CF.estimateView = (e, { compact = false } = {}) => {
    if (!e) return "";
    const st = e.stages, tot = Math.max(e.total, 1);
    const seg = (k, cls) => `<span class="seg ${cls}" style="flex:${Math.max(st[k], 2)}" title="${esc(t("stage_" + k))}: ${CF.mins(st[k])}"></span>`;
    return `<div class="estimate">
      <div class="est-head">${CF.crowd(e.level)}<span class="muted">${e.reports ? t("based_on_reports", { n: e.reports }) : t("based_on_clinic")}</span></div>
      <div class="est-bar" role="img" aria-label="${esc(t("est_aria", { a: st.checkin, b: st.waiting, c: st.consult, d: st.wrapup }))}">${seg("checkin", "s1")}${seg("waiting", "s2")}${seg("consult", "s3")}${seg("wrapup", "s4")}</div>
      ${compact ? "" : `<ul class="est-legend">
        <li><i class="s1"></i>${t("stage_checkin")} <b>${CF.mins(st.checkin)}</b></li><li><i class="s2"></i>${t("stage_waiting")} <b>${CF.mins(st.waiting)}</b></li>
        <li><i class="s3"></i>${t("stage_consult")} <b>${CF.mins(st.consult)}</b></li><li><i class="s4"></i>${t("stage_wrapup")} <b>${CF.mins(st.wrapup)}</b></li></ul>`}
      <p class="est-total">${I("clock")} ${t("est_total", { total: CF.mins(tot), time: CF.fmtTime(e.doneBy) })}</p></div>`;
  };
  CF.empty = (icon, text, action = "") => `<div class="empty">${I(icon)}<p>${text}</p>${action}</div>`;
  CF.mapsUrl = (c) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${c.name}, ${c.address}, ${c.city || ""} ${c.postal || ""}`)}`;
  CF.field = (name, label, { type = "text", value = "", required = false, auto = "", hint = "", attrs = "" } = {}) => {
    const id = "f_" + name + "_" + Math.random().toString(36).slice(2, 7);
    return `<div class="field"><label for="${id}">${label}${required ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>
      <input id="${id}" name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${auto ? `autocomplete="${auto}"` : ""} ${hint ? `aria-describedby="${id}_h"` : ""} ${attrs}/>
      ${hint ? `<p class="hint" id="${id}_h">${hint}</p>` : ""}</div>`;
  };
  CF.formData = (form) => Object.fromEntries(new FormData(form).entries());

  // ---------- toasts, modals, announcements ----------
  CF.announce = (msg) => { const el = document.getElementById("sr-announcer"); el.textContent = ""; setTimeout(() => (el.textContent = msg), 50); };
  CF.toast = (msg, kind = "ok", ms = 4500) => {
    const el = document.createElement("div");
    el.className = "toast toast-" + kind;
    el.innerHTML = `${I(kind === "err" ? "alert" : kind === "info" ? "info" : "check")}<span>${msg}</span>`;
    document.getElementById("toasts").appendChild(el);
    setTimeout(() => el.classList.add("out"), ms);
    setTimeout(() => el.remove(), ms + 400);
  };
  let modalStack = [];
  CF.modal = (title, body, { side = false, wide = false, onClose } = {}) => {
    const prev = document.activeElement;
    const wrap = document.createElement("div");
    wrap.className = "modal-wrap" + (side ? " side" : "");
    const id = "m" + Date.now();
    wrap.innerHTML = `<div class="modal-backdrop" data-act="modal-close"></div>
      <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${id}">
        <div class="modal-head"><h2 id="${id}">${title}</h2><button class="icon-btn" data-act="modal-close" aria-label="${esc(t("close"))}">${I("x")}</button></div>
        <div class="modal-body">${body}</div></div>`;
    document.getElementById("modal-root").appendChild(wrap);
    const close = () => { wrap.remove(); modalStack = modalStack.filter((m) => m.wrap !== wrap); onClose && onClose(); prev && prev.focus && prev.focus(); };
    modalStack.push({ wrap, close });
    setTimeout(() => (wrap.querySelector(".modal-body [autofocus], .modal-body input, .modal-body button, .modal-body select, .modal-body textarea, .modal-head button") || wrap).focus(), 30);
    return { el: wrap.querySelector(".modal"), close, body: wrap.querySelector(".modal-body") };
  };
  CF.closeModal = () => modalStack.length && modalStack[modalStack.length - 1].close();
  CF.confirm = (text, { ok = t("confirm"), danger = false } = {}) => new Promise((resolve) => {
    let done = false;
    const m = CF.modal(t("are_you_sure"), `<p>${text}</p><div class="row end gap"><button class="btn ghost" data-act="cf-no">${t("go_back")}</button><button class="btn ${danger ? "danger" : "primary"}" data-act="cf-yes">${ok}</button></div>`,
      { onClose: () => !done && resolve(false) });
    m.el.querySelector('[data-act="cf-yes"]').onclick = () => { done = true; m.close(); resolve(true); };
    m.el.querySelector('[data-act="cf-no"]').onclick = () => { done = true; m.close(); resolve(false); };
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalStack.length) { e.preventDefault(); CF.closeModal(); }
    if (e.key === "Tab" && modalStack.length) { // keep focus inside the open dialog
      const m = modalStack[modalStack.length - 1].wrap.querySelector(".modal");
      const f = [...m.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  // ---------- actions (event delegation) ----------
  const A = (CF.actions = {});
  CF.on = (name, fn) => (A[name] = fn);
  const forms = (CF.forms = {});
  CF.onForm = (name, fn) => (forms[name] = fn);
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const fn = A[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener("change", (e) => { const el = e.target.closest("[data-change]"); if (el && A[el.dataset.change]) A[el.dataset.change](el, e); });
  document.addEventListener("input", (e) => { const el = e.target.closest("[data-input]"); if (el && A[el.dataset.input]) A[el.dataset.input](el, e); });
  document.addEventListener("submit", async (e) => {
    const f = e.target.closest("form[data-form]");
    if (!f || !forms[f.dataset.form]) return;
    e.preventDefault();
    const btn = f.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try { await forms[f.dataset.form](CF.formData(f), f); }
    catch (err) { if (err.message !== "auth") { CF.toast(CF.errMsg(err), "err"); CF.announce(CF.errMsg(err)); } }
    finally { if (btn) btn.disabled = false; }
  });
  CF.on("modal-close", () => CF.closeModal());
  CF.on("go", (el) => CF.go(el.dataset.to));

  // ---------- router ----------
  const R = (CF.routes = {});
  CF.route = (path, def) => (R[path] = def);
  CF.go = (path) => { if (location.hash === "#" + path) CF.render(); else location.hash = path; };
  CF.homeFor = (u) => (!u ? "/login" : u.role === "patient" ? "/home" : "/staff/today");
  let renderSeq = 0;
  CF.render = async (opts = {}) => {
    const seq = ++renderSeq;
    const path = (location.hash.slice(1) || "/").split("?")[0];
    const def = R[path];
    if (!def) return CF.go(CF.homeFor(S.user));
    if (def.roles && (!S.user || !def.roles.includes(S.user.role))) return CF.go(CF.homeFor(S.user));
    if (CF.needsStaffAgreement && CF.needsStaffAgreement() && !["/agreement", "/account"].includes(path) && !path.startsWith("/legal")) return CF.go("/agreement");
    if (!def.roles && S.user && def.guestOnly) return CF.go(CF.homeFor(S.user));
    CF.renderChrome(path);
    const main = document.getElementById("main");
    if (!opts.quiet) main.setAttribute("aria-busy", "true");
    try {
      const html = await def.render(CF.query());
      if (seq !== renderSeq) return;
      main.innerHTML = html;
      document.title = `${t(def.title)} · ClinicFlow`;
      def.after && def.after(main);
      if (!opts.quiet) { main.focus({ preventScroll: true }); window.scrollTo(0, 0); CF.announce(t(def.title)); }
    } catch (e) {
      if (e.message !== "auth") main.innerHTML = `<div class="card">${CF.empty("alert", CF.errMsg(e))}</div>`;
    } finally { main.removeAttribute("aria-busy"); }
  };
  CF.query = () => Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || ""));
  CF.refresh = () => CF.render({ quiet: true });
  window.addEventListener("hashchange", () => CF.render());

  // ---------- navigation chrome ----------
  CF.navItems = () => {
    const u = S.user;
    if (!u) return [];
    if (u.role === "patient") return [
      ["/home", "home", "nav_home"], ["/book", "plus", "nav_book"], ["/appointments", "cal", "nav_appointments"],
      ["/todo", "todo", "nav_todo", S.unread.forms], ["/messages", "msg", "nav_messages", S.unread.messages], ["/clinics", "building", "nav_clinics"], ["/account", "user", "nav_account"]];
    const items = [["/staff/today", "queue", "nav_today"], ["/staff/schedule", "cal", "nav_schedule"], ["/staff/book", "plus", "nav_staff_book"],
      ["/staff/waitlist", "hourglass", "nav_waitlist"], ["/staff/messages", "msg", "nav_messages", S.unread.messages]];
    if (u.role === "admin") items.push(["/admin", "settings", "nav_admin"]);
    items.push(["/account", "user", "nav_account"]);
    return items;
  };
  CF.renderChrome = (path) => {
    const u = S.user;
    document.documentElement.lang = S.lang === "fr" ? "fr-CA" : "en-CA";
    document.body.classList.toggle("signed-out", !u);
    document.getElementById("topbar").innerHTML = `
      <a class="brand" href="#${CF.homeFor(u)}" aria-label="ClinicFlow – ${esc(t("nav_home"))}"><span class="logo" aria-hidden="true">${I("plus")}</span><span>Clinic<b>Flow</b></span></a>
      ${u && u.role !== "patient" && S.clinic ? `<span class="clinic-name">${I("building")} ${esc(S.clinic.name)}</span>` : ""}
      <div class="top-actions">
        <button class="icon-btn labeled" data-act="lang" aria-label="${esc(t("switch_lang"))}" lang="${S.lang === "fr" ? "en" : "fr"}">${I("globe")}<span>${S.lang === "fr" ? "EN" : "FR"}</span></button>
        <button class="icon-btn labeled" data-act="a11y" aria-haspopup="dialog">${I("a11y")}<span class="hide-sm">${t("accessibility")}</span></button>
        ${u ? `<button class="icon-btn" data-act="notifs" aria-label="${esc(t("notifications"))}${S.unread.notifications ? ` (${S.unread.notifications})` : ""}">${I("bell")}${S.unread.notifications ? `<span class="badge">${S.unread.notifications}</span>` : ""}</button>
        <button class="icon-btn user-btn" data-act="logout" aria-label="${esc(t("sign_out"))}"><span class="avatar" aria-hidden="true">${esc((u.first_name || "?")[0])}</span><span class="hide-sm">${esc(u.first_name)} · ${t("role_" + (u.staff_role || u.role))}</span>${I("out")}</button>` : ""}
      </div>`;
    const items = CF.navItems();
    const link = (it, cls) => `<a href="#${it[0]}" class="${cls} ${path.startsWith(it[0]) ? "active" : ""}" ${path.startsWith(it[0]) ? 'aria-current="page"' : ""}>${I(it[1])}<span>${t(it[2])}</span>${it[3] ? `<span class="badge" aria-label="${esc(t("n_new", { n: it[3] }))}">${it[3]}</span>` : ""}</a>`;
    document.getElementById("sidenav").innerHTML = items.map((it) => link(it, "nav-link")).join("");
    const tabs = S.user?.role === "patient" ? items.filter((i) => ["/home", "/book", "/appointments", "/todo", "/messages"].includes(i[0])) : items.slice(0, 5);
    document.getElementById("tabbar").innerHTML = tabs.map((it) => link(it, "tab")).join("");
    document.querySelector(".skip-link").textContent = t("skip");
    CF.renderFooter && CF.renderFooter();
  };

  CF.on("lang", async () => {
    S.lang = S.lang === "fr" ? "en" : "fr";
    store.set("lang", S.lang);
    if (S.user) CF.api("PATCH", "/me", { lang: S.lang }).catch(() => {});
    await CF.render();
    CF.refreshGate && CF.refreshGate();
    CF.toast(t("lang_changed"), "info", 2500);
  });
  CF.on("logout", async () => { if (await CF.confirm(t("sign_out_q"), { ok: t("sign_out") })) CF.logout(); });
  CF.logout = async (expired) => {
    try { if (!expired) await CF.api("POST", "/auth/logout"); } catch {}
    S.token = null; S.user = null; store.del("token");
    if (CF.es) CF.es.close();
    CF.go("/login");
    if (expired) CF.toast(t("session_expired"), "info");
  };

  // ---------- notifications ----------
  CF.on("notifs", async () => {
    const { notifications } = await CF.api("GET", "/my/notifications");
    CF.modal(t("notifications"), notifications.length ? `<ul class="notif-list">${notifications.map((n) =>
      `<li class="${n.read ? "" : "unread"}"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><time>${esc(CF.fmtShort(n.created_at))} · ${esc(CF.fmtTime(n.created_at))}</time>
        ${n.kind === "waitlist_offer" ? `<button class="btn sm primary" data-act="go" data-to="/appointments">${t("see_offer")}</button>` : ""}</li>`).join("")}</ul>` : CF.empty("bell", t("no_notifications")), { side: true });
    await CF.api("POST", "/my/notifications/read");
    S.unread.notifications = 0;
    CF.renderChrome((location.hash.slice(1) || "/").split("?")[0]);
  });

  // ---------- accessibility ----------
  CF.applyA11y = () => {
    const a = S.a11y, html = document.documentElement;
    html.style.fontSize = a.size + "%";
    html.classList.toggle("hc", !!a.contrast);
    html.classList.toggle("reduce-motion", !!a.motion);
    html.classList.toggle("spacing", !!a.spacing);
    store.set("a11y", a);
  };
  CF.on("a11y", () => {
    const a = S.a11y;
    const sw = (k, label, desc) => `<div class="switch-row"><div><b id="lbl_${k}">${label}</b><p class="muted">${desc}</p></div>
      <button class="switch" role="switch" aria-checked="${!!a[k]}" aria-labelledby="lbl_${k}" data-act="a11y-toggle" data-k="${k}"><span></span></button></div>`;
    CF.modal(t("accessibility"), `
      <div class="a11y-group"><b id="lbl_size">${t("text_size")}</b>
        <div class="seg-ctrl" role="radiogroup" aria-labelledby="lbl_size">${[100, 115, 130, 150].map((s) => `<button role="radio" aria-checked="${a.size === s}" data-act="a11y-size" data-s="${s}" style="font-size:${s * 0.15}px">A</button>`).join("")}</div></div>
      ${sw("contrast", t("high_contrast"), t("high_contrast_d"))}
      ${sw("spacing", t("spacing"), t("spacing_d"))}
      ${sw("motion", t("reduce_motion"), t("reduce_motion_d"))}
      <div class="switch-row"><div><b>${t("voice_control")}</b><p class="muted">${CF.voice.supported ? t("voice_control_d") : t("voice_unsupported")}</p></div>
        <button class="switch" role="switch" aria-checked="${CF.voice.on}" data-act="voice-toggle" ${CF.voice.supported ? "" : "disabled"} aria-label="${esc(t("voice_control"))}"><span></span></button></div>
      <div class="switch-row"><div><b>${t("read_aloud")}</b><p class="muted">${t("read_aloud_d")}</p></div><button class="btn sm" data-act="read-page">${I("speak")} ${t("read_page")}</button></div>
      <p class="muted small">${t("a11y_note")}</p>`, { side: true });
  });
  CF.on("a11y-size", (el) => { S.a11y.size = Number(el.dataset.s); CF.applyA11y(); el.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", b === el)); });
  CF.on("a11y-toggle", (el) => { const k = el.dataset.k; S.a11y[k] = !S.a11y[k]; el.setAttribute("aria-checked", S.a11y[k]); CF.applyA11y(); });
  CF.on("read-page", () => CF.speak(document.getElementById("main").innerText));
  CF.speak = (text) => {
    if (!("speechSynthesis" in window)) return CF.toast(t("voice_unsupported"), "err");
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\s+/g, " ").slice(0, 4000));
    u.lang = S.lang === "fr" ? "fr-CA" : "en-CA";
    speechSynthesis.speak(u);
  };

  // Voice control: say "book appointment", "my appointments", "next", "click confirm", "scroll down", "read page", "stop"...
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  CF.voice = { supported: !!SR, on: false, rec: null };
  CF.on("voice-toggle", (el) => { CF.voice.on ? CF.voiceStop() : CF.voiceStart(); el && el.setAttribute("aria-checked", CF.voice.on); });
  CF.voiceStart = () => {
    if (!SR) return;
    const rec = new SR();
    rec.lang = S.lang === "fr" ? "fr-CA" : "en-CA";
    rec.continuous = true; rec.interimResults = false;
    rec.onresult = (ev) => CF.voiceCommand(ev.results[ev.results.length - 1][0].transcript.trim());
    rec.onend = () => { if (CF.voice.on) try { rec.start(); } catch {} };
    rec.onerror = (e) => { if (e.error === "not-allowed") { CF.voice.on = false; CF.toast(t("mic_denied"), "err"); } };
    try { rec.start(); } catch {}
    CF.voice = { ...CF.voice, on: true, rec };
    document.body.classList.add("voice-on");
    CF.toast(t("voice_on"), "info", 6000);
  };
  CF.voiceStop = () => { CF.voice.on = false; try { CF.voice.rec && CF.voice.rec.stop(); } catch {} document.body.classList.remove("voice-on"); CF.toast(t("voice_off"), "info"); };
  CF.voiceCommand = (said) => {
    const s = said.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    CF.toast(`🎙 “${esc(said)}”`, "info", 2500);
    const active = document.activeElement;
    if (active && ["INPUT", "TEXTAREA"].includes(active.tagName) && !/^(click|press|cliquer|clique|appuyer|appuie|next|suivant|back|retour|stop|arret)/.test(s)) {
      active.value = active.type === "email" ? said.replace(/\s+at\s+|\s+arobase\s+/gi, "@").replace(/\s+dot\s+|\s+point\s+/gi, ".").replace(/\s/g, "") : said;
      active.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const pages = { book: "/book", reserv: "/book", "rendez-vous": "/appointments", appointment: "/appointments", "to do": "/todo", "a faire": "/todo", form: "/todo",
      message: "/messages", clinic: "/clinics", clinique: "/clinics", account: "/account", compte: "/account", home: "/home", accueil: "/home",
      schedule: "/staff/schedule", horaire: "/staff/schedule", today: "/staff/today", "aujourd": "/staff/today", waitlist: "/staff/waitlist", "liste d'attente": "/staff/waitlist" };
    if (/^(stop|arret|desactiv)/.test(s)) return CF.voiceStop();
    if (/(read|lire|lis)/.test(s)) return CF.speak(document.getElementById("main").innerText);
    if (/(scroll down|descend|plus bas)/.test(s)) return window.scrollBy(0, innerHeight * 0.7);
    if (/(scroll up|monte|plus haut)/.test(s)) return window.scrollBy(0, -innerHeight * 0.7);
    if (/^(back|retour|precedent)/.test(s)) { const b = document.querySelector('[data-act="wiz-back"]'); return b ? b.click() : history.back(); }
    const m = s.match(/^(?:click|press|select|choose|open|cliquer sur|clique sur|appuyer sur|appuie sur|choisir|ouvrir|next|suivant|confirm|confirmer)\s*(.*)$/);
    const target = m ? (m[1] || s) : s;
    const clickables = [...document.querySelectorAll("main button, main a, main [role=radio], .modal button, .modal a, nav a")].filter((x) => x.offsetParent !== null);
    const norm = (x) => (x.getAttribute("aria-label") || x.innerText || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    const hit = clickables.find((x) => norm(x) === target) || clickables.find((x) => target && norm(x).includes(target)) || (target.length > 3 && clickables.find((x) => target.includes(norm(x)) && norm(x).length > 3));
    if (hit) { hit.focus(); return hit.click(); }
    for (const [k, p] of Object.entries(pages)) if (s.includes(k) && CF.routes[p] && (!CF.routes[p].roles || CF.routes[p].roles.includes(S.user?.role))) return CF.go(p);
    CF.toast(t("voice_not_understood"), "err");
  };

  // ---------- real-time ----------
  let refreshTimer = null;
  CF.listeners = [];
  CF.connect = () => {
    if (CF.es) CF.es.close();
    if (!S.token || !window.EventSource) return;
    CF.es = new EventSource(CF.base + "/api/events?token=" + encodeURIComponent(S.token));
    CF.es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      CF.listeners.forEach((fn) => fn(msg));
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        await CF.loadMe();
        const def = CF.routes[(location.hash.slice(1) || "/").split("?")[0]];
        if (def && def.live && !document.querySelector(".modal-wrap") && !document.activeElement?.matches("input,textarea,select")) CF.refresh();
        else CF.renderChrome((location.hash.slice(1) || "/").split("?")[0]);
      }, 400);
    };
  };

  // ---------- session ----------
  CF.loadMe = async () => {
    const me = await CF.api("GET", "/me");
    S.user = me.user; S.members = me.members; S.clinic = me.clinic;
    S.unread = { ...S.unread, ...me.unread };
    if (me.user.role === "patient") {
      try { const f = await CF.api("GET", "/my/forms"); S.unread.forms = f.forms.filter((x) => ["todo", "returned"].includes(x.status)).length; } catch {}
    }
    return me;
  };
  CF.signedIn = async (token) => {
    S.token = token; store.set("token", token);
    await CF.loadMe();
    if (S.user.lang && S.user.lang !== S.lang) { S.lang = S.user.lang; store.set("lang", S.lang); }
    CF.connect();
    await CF.recordServerConsent();
    CF.go(CF.needsStaffAgreement() ? "/agreement" : CF.homeFor(S.user));
  };

  CF.start = async () => {
    CF.applyA11y();
    try { S.config = await CF.api("GET", "/config"); } catch {}
    if (S.token) {
      try { await CF.loadMe(); CF.connect(); await CF.recordServerConsent(); } catch { S.token = null; store.del("token"); }
    }
    if (!location.hash || location.hash === "#/") location.hash = CF.homeFor(S.user);
    else CF.render();
    CF.checkGate();
  };
})();
