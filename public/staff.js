/* ClinicFlow – clinic staff interface (front desk / nurses): today's queue, schedule, manual booking, waitlist, messages. */
(function () {
  const { t, esc, icon: I, api, on, onForm, route, state: S } = CF;
  const STAFF = ["staff", "admin"];
  let META = null;
  CF.meta = async (force) => { if (!META || force || META.clinic.id !== S.user.clinic_id) META = await api("GET", "/staff/meta"); return META; };
  CF.listeners.push((m) => { if (m.type === "meta") META = null; });

  // ---------- "joined the waitlist" corner notification (front desk + admins) ----------
  // A small card in the bottom-right corner, like a Windows notification. It does not take focus,
  // closes on its own after 10 s (paused while the mouse is over it) and never stacks more than 3.
  const DESK_ROLES = ["reception", "admin"];
  CF.listeners.push((m) => {
    if (m.type !== "waitlist" || m.event !== "joined" || !S.user || !DESK_ROLES.includes(S.user.staff_role)) return;
    if (CF.needsStaffAgreement && CF.needsStaffAgreement()) return;
    deskNotice(m);
  });
  function deskNotice(m) {
    let box = document.getElementById("desk-notices");
    if (!box) {
      box = document.createElement("div");
      box.id = "desk-notices"; box.className = "desk-notices";
      box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite");
      document.body.appendChild(box);
    }
    const when = m.date ? CF.relDay(m.date) : t("any_day");
    const details = [when, S.lang === "fr" ? m.type_fr : m.type_en, m.provider_name || t("wl_any_prov")].filter(Boolean).join(" · ");
    const el = document.createElement("div");
    el.className = "desk-notice";
    el.innerHTML = `<div class="dn-icon">${I("hourglass")}</div>
      <div class="dn-text"><p class="dn-app">ClinicFlow · ${t("nav_waitlist")}</p>
        <p class="dn-title">${t("wl_notice_title", { name: `<b>${esc(m.patient_name || "")}</b>` })}</p>
        <p class="dn-body">${esc(details)}${m.position ? ` · ${esc(t("wl_notice_pos", { n: m.position }))}` : ""}</p>
        <a class="dn-link" href="#/staff/waitlist">${t("wl_notice_open")}</a></div>
      <button class="dn-close" aria-label="${esc(t("close"))}">${I("x")}</button>`;
    let timer;
    const close = () => { clearTimeout(timer); el.classList.add("out"); setTimeout(() => el.remove(), 250); };
    const arm = () => { clearTimeout(timer); timer = setTimeout(close, 10000); };
    el.querySelector(".dn-close").addEventListener("click", close);
    el.querySelector(".dn-link").addEventListener("click", close);
    el.addEventListener("mouseenter", () => clearTimeout(timer));
    el.addEventListener("mouseleave", arm);
    el.addEventListener("focusin", () => clearTimeout(timer));
    el.addEventListener("focusout", arm);
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    arm();
  }
  CF.deskNotice = deskNotice;
  const st = (key) => META?.statuses.find((s) => s.key === key);
  const NEXT = { booked: ["checked_in", "act_check_in"], checked_in: ["waiting", "act_to_waiting"], waiting: ["in_consult", "act_start"], in_consult: ["completed", "act_complete"] };
  const nextBtn = (a, sm = true) => NEXT[a.status] ? `<button class="btn ${sm ? "sm" : ""} next-btn" style="--c:${esc(st(NEXT[a.status][0])?.color || "#0E6F66")}" data-act="advance" data-id="${a.id}" data-to="${NEXT[a.status][0]}">${t(NEXT[a.status][1])} ${I("chevR")}</button>` : "";
  const sourceIcon = (s) => ({ phone: "phone", in_person: "door", waitlist: "hourglass" }[s] || "globe");

  // =====================================================================
  // TODAY – live queue board
  // =====================================================================
  route("/staff/today", { title: "nav_today", roles: STAFF, live: true, render: async () => {
    await CF.meta();
    const o = await api("GET", "/staff/overview");
    const by = (k) => o.appointments.filter((a) => a.status === k);
    const counts = ["booked", "checked_in", "waiting", "in_consult", "completed"].map((k) => [k, by(k).length]);
    const now = new Date(); const nowStr = `${CF.ymd(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const late = by("booked").filter((a) => a.start < nowStr);
    const card = (a) => `<li class="q-card" style="--c:${esc(a.type?.color || "#999")}">
      <button class="q-open" data-act="appt" data-id="${a.id}" aria-label="${esc(t("open_card_for", { name: a.patient_name }))}">
        <span class="q-time">${esc(CF.fmtTime(a.start))}</span><b>${esc(a.patient_name)}</b>
        <span class="small muted">${esc(CF.L(a.type, "name"))} · ${esc(a.provider?.name || "")}</span>
        <span class="row gap small">${I(sourceIcon(a.source))}${a.forms.some((f) => f.status === "submitted") ? `<span class="chip chip-soft" style="--c:#2F80ED">${t("form_received")}</span>` : ""}${a.forms.some((f) => f.status === "todo") ? `<span class="chip chip-soft" style="--c:#B7791F">${t("form_missing")}</span>` : ""}</span></button>
      ${nextBtn(a)}</li>`;
    const col = (k, list, extra = "") => `<section class="q-col" aria-labelledby="qc_${k}" style="--c:${esc(st(k)?.color)}"><h2 id="qc_${k}"><span class="dot"></span>${esc(CF.L(st(k), "label"))} <span class="count">${list.length}</span></h2>${extra}
      <ul class="q-list">${list.map(card).join("") || `<li class="muted small q-empty">${t("nobody")}</li>`}</ul></section>`;
    return `<section class="page wide">
      <header class="page-head row between wrap"><div><h1>${t("today_title")}</h1><p class="muted">${esc(CF.fmtDate(o.today))}</p></div>
        <div class="row gap wrap"><a class="btn primary" href="#/staff/book">${I("plus")} ${t("nav_staff_book")}</a><a class="btn ghost" href="#/staff/schedule">${I("cal")} ${t("nav_schedule")}</a></div></header>
      <div class="kpis">${counts.map(([k, n]) => `<div class="kpi" style="--c:${esc(st(k)?.color)}"><b>${n}</b><span>${esc(CF.L(st(k), "label"))}</span></div>`).join("")}
        <div class="kpi wide-kpi"><span>${t("clinic_now")}</span>${CF.crowd(o.estimate.level)}<span class="small muted">${t("avg_delay", { n: o.estimate.delay })}</span></div></div>
      <div class="row gap wrap alerts">
        ${o.unread ? `<a class="notice info" href="#/staff/messages">${I("msg")} ${t("n_unread_msgs", { n: o.unread })}</a>` : ""}
        ${o.waitlist ? `<a class="notice warn" href="#/staff/waitlist">${I("hourglass")} ${t("n_waitlist", { n: o.waitlist })}</a>` : ""}
        ${o.forms_pending ? `<span class="notice info">${I("todo")} ${t("n_forms_review", { n: o.forms_pending })}</span>` : ""}
        ${late.length ? `<span class="notice warn">${I("alert")} ${t("n_late", { n: late.length })}</span>` : ""}</div>
      <div class="queue">
        ${col("booked", by("booked"), `<p class="small muted">${t("col_booked_d")}</p>`)}
        ${col("checked_in", by("checked_in"))}${col("waiting", by("waiting"))}${col("in_consult", by("in_consult"))}
        ${META.statuses.filter((s) => !s.system).map((s) => col(s.key, by(s.key))).join("")}
      </div>
      <details class="card"><summary><b>${esc(CF.L(st("completed"), "label"))} (${by("completed").length})</b> · ${esc(CF.L(st("no_show"), "label"))} (${by("no_show").length})</summary>
        <ul class="plain-list">${[...by("completed"), ...by("no_show")].map((a) => `<li class="row between"><button class="link" data-act="appt" data-id="${a.id}">${esc(CF.fmtTime(a.start))} · ${esc(a.patient_name)}</button>${CF.statusChip(a)}</li>`).join("")}</ul></details>
    </section>`;
  } });
  on("advance", async (el) => {
    el.disabled = true;
    try { await api("PATCH", `/staff/appointments/${el.dataset.id}`, { status: el.dataset.to }); CF.toast(t("status_updated", { s: CF.L(st(el.dataset.to), "label") })); CF.closeModal(); CF.refresh(); }
    catch (e) { el.disabled = false; CF.toast(CF.errMsg(e), "err"); }
  });

  // =====================================================================
  // SCHEDULE – day (by provider) / week / list, colour-coded by visit type
  // =====================================================================
  const V = { view: "week", date: CF.ymd(new Date()), provider: "", q: "", days: [1, 2, 3, 4, 5] };
  const monday = (d) => { const x = CF.toDate(d + " 00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const shift = (n) => { const x = CF.toDate(V.date + " 00:00"); x.setDate(x.getDate() + n); V.date = CF.ymd(x); };
  const K = 1.15; // px per minute
  const START = 8 * 60, END = 20 * 60;
  const block = (a) => {
    const s = CF.toDate(a.start), e = CF.toDate(a.end);
    const top = (s.getHours() * 60 + s.getMinutes() - START) * K, h = Math.max((e - s) / 60000 * K, 22);
    const label = esc(`${CF.fmtTime(a.start)} ${a.patient_name}, ${CF.L(a.type, "name")}, ${CF.L(a.status_info, "label")}`);
    const short = h < 34;
    return `<button class="appt-block st-${a.status} ${short ? "short" : ""}" style="top:${top}px;height:${h}px;--c:${esc(a.type?.color || "#999")};--s:${esc(a.status_info?.color || "#999")}" data-act="appt" data-id="${a.id}" aria-label="${label}" title="${label}">
      ${short ? `<span></span><b>${esc(a.patient_name)}</b>` : `<b>${esc(a.patient_name)}</b><span>${esc(CF.fmtTime(a.start))} · ${esc(CF.L(a.status_info, "label"))}</span>`}</button>`;
  };
  const hoursCol = () => { let h = ""; for (let m = START; m < END; m += 60) h += `<div class="hr" style="height:${60 * K}px"><span>${esc(CF.fmtTime(`${String(m / 60).padStart(2, "0")}:00`))}</span></div>`; return `<div class="hours-col" aria-hidden="true">${h}</div>`; };
  const nowLine = (date) => { const n = new Date(); if (CF.ymd(n) !== date) return ""; const m = n.getHours() * 60 + n.getMinutes(); return m > START && m < END ? `<div class="now-line" style="top:${(m - START) * K}px" aria-hidden="true"></div>` : ""; };

  route("/staff/schedule", { title: "nav_schedule", roles: STAFF, live: true, render: async () => {
    await CF.meta();
    let from = V.date, to = V.date;
    if (V.view !== "day") { const m = monday(V.date); from = CF.ymd(m); const e = new Date(m); e.setDate(m.getDate() + 6); to = CF.ymd(e); }
    // While searching, look through every date (past and future) and show the matches as a list.
    const searching = V.q.trim().length >= 2;
    const { appointments } = await api("GET", `/staff/appointments?from=${from}&to=${to}&q=${encodeURIComponent(V.q.trim())}${searching ? "&all=1" : ""}${V.provider ? `&provider=${V.provider}` : ""}`);
    const title = searching ? t("search_results_for", { q: V.q.trim() }) : V.view === "day" ? CF.fmtDate(V.date) : `${CF.fmtDate(from, { month: "long", day: "numeric" })} – ${CF.fmtDate(to, { month: "long", day: "numeric", year: "numeric" })}`;
    let grid;
    if (V.view === "list" || searching) {
      grid = `<div class="table-wrap"><table class="table"><caption class="sr-only">${esc(title)}</caption><thead><tr><th>${t("when")}</th><th>${t("patient")}</th><th>${t("visit_type")}</th><th>${t("provider")}</th><th>${t("status")}</th><th><span class="sr-only">${t("actions")}</span></th></tr></thead>
        <tbody>${appointments.filter((a) => searching || V.days.includes(CF.toDate(a.start).getDay())).map((a) => `<tr><td>${esc(CF.fmtShort(a.start))}<br/><b>${esc(CF.fmtTime(a.start))}</b></td>
          <td><button class="link" data-act="appt" data-id="${a.id}">${esc(a.patient_name)}</button><br/><span class="small muted">${I(sourceIcon(a.source))} ${t("src_" + a.source)}</span></td>
          <td>${CF.typeChip(a.type)}</td><td>${esc(a.provider?.name || "")}</td><td>${CF.statusChip(a)}</td><td>${nextBtn(a)}</td></tr>`).join("") || `<tr><td colspan="6">${CF.empty("cal", t("no_appts"))}</td></tr>`}</tbody></table></div>`;
    } else if (V.view === "day") {
      const provs = META.providers.filter((p) => p.active && (!V.provider || String(p.id) === String(V.provider)));
      grid = `<div class="cal" style="--cols:${provs.length}">${hoursCol()}${provs.map((p) => `<div class="cal-col"><div class="cal-head"><b>${esc(p.name)}</b><span class="small muted">${esc(p.specialty || "")}</span></div>
        <div class="cal-body" style="height:${(END - START) * K}px">${nowLine(V.date)}${layout(appointments.filter((a) => a.provider_id === p.id))}</div></div>`).join("")}</div>`;
    } else {
      const m = monday(V.date);
      const days = [1, 2, 3, 4, 5, 6].filter((d) => V.days.includes(d)).map((d) => { const x = new Date(m); x.setDate(m.getDate() + d - 1); return CF.ymd(x); });
      grid = `<div class="cal" style="--cols:${days.length}">${hoursCol()}${days.map((d) => `<div class="cal-col ${d === CF.ymd(new Date()) ? "is-today" : ""}"><div class="cal-head"><b>${esc(CF.fmtDate(d, { weekday: "short" }))}</b><span class="daynum">${CF.toDate(d + " 00:00").getDate()}</span></div>
        <div class="cal-body" style="height:${(END - START) * K}px">${nowLine(d)}${layout(appointments.filter((a) => a.start.startsWith(d)))}</div></div>`).join("")}</div>`;
    }
    return `<section class="page wide">
      <header class="page-head row between wrap"><h1>${t("nav_schedule")}</h1><a class="btn primary" href="#/staff/book">${I("plus")} ${t("nav_staff_book")}</a></header>
      <div class="toolbar card">
        <div class="seg-ctrl" role="radiogroup" aria-label="${esc(t("view"))}">${["day", "week", "list"].map((v) => `<button role="radio" aria-checked="${V.view === v}" data-act="sv" data-v="${v}">${t("view_" + v)}</button>`).join("")}</div>
        <div class="row gap"><button class="icon-btn" data-act="snav" data-n="-1" aria-label="${esc(t("previous"))}">${I("chevL")}</button><button class="btn sm ghost" data-act="snav" data-n="0">${t("today")}</button><button class="icon-btn" data-act="snav" data-n="1" aria-label="${esc(t("next"))}">${I("chevR")}</button>
          <input type="date" value="${V.date}" data-change="sdate" aria-label="${esc(t("choose_date"))}"/></div>
        <div class="search"><label class="sr-only" for="sq">${t("search_patient")}</label>${I("search")}<input id="sq" type="search" value="${esc(V.q)}" placeholder="${esc(t("search_patient"))}" data-input="sq"/></div>
        <div class="field inline"><label for="sp">${t("provider")}</label><select id="sp" data-change="sprov"><option value="">${t("all_providers")}</option>${META.providers.filter((p) => p.active).map((p) => `<option value="${p.id}" ${String(V.provider) === String(p.id) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
        ${V.view !== "day" ? `<fieldset class="inline"><legend class="sr-only">${t("days_of_week")}</legend><div class="check-pills">${[1, 2, 3, 4, 5, 6].map((d) => `<label class="pill"><input type="checkbox" value="${d}" data-change="sday" ${V.days.includes(d) ? "checked" : ""}/><span>${esc(CF.dayName(d, "short"))}</span></label>`).join("")}</div></fieldset>` : ""}
      </div>
      <h2 class="section-title">${esc(title)} <span class="count">${t("n_appts", { n: appointments.length })}</span>
        ${searching ? `<button class="btn sm ghost" data-act="sq-clear">${I("x")} ${t("clear_search")}</button>` : ""}</h2>
      ${searching ? `<p class="small muted">${t("search_all_dates_hint")}</p>` : ""}
      <p class="legend small">${META.types.map((ty) => `<span class="lg" style="background:${esc(ty.color)}"></span>${esc(CF.L(ty, "name"))}`).join(" ")}</p>
      ${grid}</section>`;
  }, after: () => { const n = document.querySelector(".now-line"); if (n) n.scrollIntoView({ block: "center", behavior: "instant" }); } });
  // place overlapping appointments side by side
  function layout(list) {
    // place overlapping appointments side by side (each cluster of overlaps shares the column width)
    const items = list.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end)).map((a) => ({ a, c: 0 }));
    let cluster = [], clusterEnd = "", out = [];
    const flush = () => { const n = Math.max(...cluster.map((x) => x.c)) + 1; cluster.forEach((x) => out.push({ ...x, n })); cluster = []; };
    for (const it of items) {
      if (cluster.length && it.a.start >= clusterEnd) flush();
      const used = cluster.filter((x) => x.a.end > it.a.start).map((x) => x.c);
      let c = 0; while (used.includes(c)) c++;
      it.c = c; cluster.push(it); clusterEnd = clusterEnd && cluster.length > 1 ? (it.a.end > clusterEnd ? it.a.end : clusterEnd) : it.a.end;
    }
    if (cluster.length) flush();
    return out.map(({ a, c, n }) => block(a).replace('style="', `style="left:calc(${c} * ${100 / n}% + 2px);width:calc(${100 / n}% - 4px);`)).join("");
  }
  on("sv", (el) => { V.view = el.dataset.v; CF.refresh(); });
  on("snav", (el) => { const n = Number(el.dataset.n); if (n === 0) V.date = CF.ymd(new Date()); else shift(n * (V.view === "day" ? 1 : 7)); CF.refresh(); });
  on("sdate", (el) => { if (el.value) { V.date = el.value; CF.refresh(); } });
  on("sprov", (el) => { V.provider = el.value; CF.refresh(); });
  on("sday", (el) => { const d = Number(el.value); V.days = el.checked ? [...V.days, d] : V.days.filter((x) => x !== d); CF.refresh(); });
  on("sq-clear", () => { V.q = ""; CF.refresh().then(() => document.getElementById("sq")?.focus()); });
  let sqT; on("sq", (el) => { V.q = el.value; clearTimeout(sqT); sqT = setTimeout(async () => { await CF.refresh(); const i = document.getElementById("sq"); i && (i.focus(), i.setSelectionRange(i.value.length, i.value.length)); }, 300); });

  // =====================================================================
  // APPOINTMENT CARD (side panel)
  // =====================================================================
  on("appt", async (el) => openAppt(el.dataset.id));
  const careLabel = (r) => `${t("care_" + r.kind)} ${r.label}`;
  function careForm(a, r) {
    const id = "care-" + (r?.id || "new"), today = CF.ymd(new Date());
    return `<form data-form="care-schedule" data-appt="${a.id}" class="stack">
      ${r ? `<input type="hidden" name="reminder_id" value="${r.id}"/>` : ""}
      <div class="grid2">
        <div class="field"><label for="${id}-kind">${t("care_kind")}</label><select id="${id}-kind" name="kind">
          ${["medication", "recovery"].map((k) => `<option value="${k}" ${r?.kind === k ? "selected" : ""}>${t("care_" + k)}</option>`).join("")}</select></div>
        ${CF.field("label", t("care_number"), { type: "number", value: r?.label || 1, required: true, attrs: 'min="1" max="8"' })}
        ${CF.field("start_date", t("care_start"), { type: "date", value: r?.start_date || today, required: true })}
        ${CF.field("end_date", t("care_end"), { type: "date", value: r?.end_date || today, required: true })}
      </div>
      ${CF.field("times", t("care_times"), { value: r?.times.join(", ") || "", required: true, hint: t("care_times_hint"), attrs: 'maxlength="90"' })}
      <div class="row gap wrap"><button class="btn primary sm" type="submit">${t("care_save")}</button>
        ${r ? `<button class="btn sm danger-text" type="button" data-act="care-remove" data-appt="${a.id}" data-id="${r.id}">${t("remove")}</button>` : ""}</div>
    </form>`;
  }
  async function openAppt(id) {
    await CF.meta();
    const { appointment: a } = await api("GET", `/staff/appointments/${id}`);
    CF.closeModal();
    const formHtml = (f) => `<div class="form-review"><div class="row between"><b>${esc(CF.L(f, "title"))}</b>${CF.chip(t("fs_" + f.status), { todo: "#E0A100", returned: "#C0392B", submitted: "#2F80ED", accepted: "#27AE60" }[f.status])}</div>
      ${f.fields.map((q) => `<p class="small"><span class="muted">${esc(S.lang === "fr" ? q.fr : q.en)}</span><br/>${esc(f.answers[q.id] || "—")}</p>`).join("")}
      ${f.status === "submitted" ? `<div class="row gap wrap"><button class="btn sm" data-act="form-accept" data-id="${f.id}" data-a="${a.id}">${I("check")} ${t("accept")}</button>
        <form data-form="form-return" data-id="${f.id}" data-a="${a.id}" class="row gap grow"><label class="sr-only" for="rn${f.id}">${t("return_note")}</label><input id="rn${f.id}" name="note" required placeholder="${esc(t("return_note_ph"))}"/><button class="btn sm ghost" type="submit">${t("return_form")}</button></form></div>` : ""}
      ${f.staff_note ? `<p class="small muted">${t("clinic_note")} ${esc(f.staff_note)}</p>` : ""}</div>`;
    CF.modal(`${esc(a.patient_name)}`, `
      <div class="row gap wrap">${CF.statusChip(a)}${CF.typeChip(a.type)}<span class="chip chip-soft" style="--c:#5B7FA6">${I(sourceIcon(a.source))} ${t("src_" + a.source)}</span></div>
      <p class="big-when">${I("cal")} ${esc(CF.fmtDate(a.start))} · <b>${esc(CF.fmtTime(a.start))}–${esc(CF.fmtTime(a.end))}</b></p>
      ${nextBtn(a, false)}
      <div class="field"><label for="ast">${t("status")}</label><select id="ast" data-change="set-status" data-id="${a.id}">${META.statuses.filter((s) => s.key !== "cancelled").map((s) => `<option value="${s.key}" ${s.key === a.status ? "selected" : ""}>${esc(CF.L(s, "label"))}</option>`).join("")}</select></div>
      <h3>${t("appointment_contact")}</h3>
      <form data-form="appointment-contact" data-id="${a.id}" class="stack">
        <div class="grid2">
          ${CF.field("patient_phone", t("phone"), { type: "tel", value: a.patient_phone || "", auto: "off", attrs: 'maxlength="64"' })}
          ${CF.field("patient_email", t("email"), { type: "email", value: a.patient_email || "", auto: "off", attrs: 'maxlength="254"' })}
        </div>
        <div class="row gap wrap">
          <button class="btn sm" type="submit">${t("save_contact")}</button>
          ${a.user_id ? `<a class="btn sm ghost" href="#/staff/messages?u=${a.user_id}" data-act="modal-close-go" data-to="/staff/messages?u=${a.user_id}">${I("msg")} ${t("message")}</a>` : ""}
        </div>
      </form>
      ${a.care_reminders ? `<section class="card stack"><h3>${t("nav_care")}</h3><p class="small muted">${t("care_staff_hint")}</p>
        ${a.care_reminders.map((r) => `<details><summary>${esc(careLabel(r))}</summary>${careForm(a, r)}</details>`).join("")}
        <details><summary>${t("care_add")}</summary>${careForm(a)}</details></section>` : ""}
      <p class="small muted">${t("prefers")}: ${t("via_" + (a.notify_pref || "email"))}${a.reason ? ` · ${t("reason")}: ${esc(a.reason)}` : ""}</p>
      <div class="field"><label for="apr">${t("provider")}</label><select id="apr" data-change="set-provider" data-id="${a.id}">${META.providers.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === a.provider_id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <form data-form="notes" data-id="${a.id}" class="field"><label for="anotes">${t("staff_notes")}</label><textarea id="anotes" name="staff_notes" rows="3" placeholder="${esc(t("staff_notes_ph"))}">${esc(a.staff_notes || "")}</textarea><button class="btn sm" type="submit">${t("save_notes")}</button></form>
      <h3>${t("forms")}</h3>${a.forms.map(formHtml).join("") || `<p class="muted small">${t("no_forms")}</p>`}
      <form data-form="send-form" data-id="${a.id}" class="row gap"><label class="sr-only" for="sft">${t("send_form")}</label><select id="sft" name="template_id">${META.form_templates.map((f) => `<option value="${f.id}">${esc(CF.L(f, "title"))}</option>`).join("")}</select><button class="btn sm ghost" type="submit">${I("send")} ${t("send_form")}</button></form>
      ${a.history.length ? `<h3>${t("previous_visits")}</h3><ul class="plain-list small">${a.history.map((h) => `<li>${esc(CF.fmtShort(h.start))} · ${esc(CF.L(st(h.status), "label"))}</li>`).join("")}</ul>` : ""}
      ${["cancelled", "completed", "no_show"].includes(a.status) ? "" : `<h3>${t("change_time")}</h3>
      <div class="row gap wrap"><input type="date" id="rdate" value="${a.start.slice(0, 10)}" aria-label="${esc(t("choose_date"))}" data-change="resched-date" data-id="${a.id}" data-p="${a.provider_id}" data-type="${a.type_id}"/></div>
      <div id="rslots" class="slots small-slots"></div>
      <hr/><button class="btn danger" data-act="staff-cancel" data-id="${a.id}">${I("x")} ${t("cancel_appointment")}</button>`}`, { side: true });
  }
  CF.openAppt = openAppt;
  onForm("care-schedule", async (d, f) => {
    const id = f.dataset.appt;
    await api("POST", `/staff/appointments/${id}/care-reminders`, { ...d, times: d.times.split(",").map((time) => time.trim()) });
    CF.toast(t("saved"));
    await openAppt(id);
  });
  on("care-remove", async (el) => {
    if (!await CF.confirm(t("care_remove_q"), { danger: true, ok: t("remove") })) return;
    try {
      await api("DELETE", `/staff/appointments/${el.dataset.appt}/care-reminders/${el.dataset.id}`);
      await openAppt(el.dataset.appt);
    } catch (e) { CF.toast(CF.errMsg(e), "err"); }
  });
  on("modal-close-go", (el) => { CF.closeModal(); CF.go(el.dataset.to); });
  on("set-status", async (el) => { await api("PATCH", `/staff/appointments/${el.dataset.id}`, { status: el.value }); CF.toast(t("status_updated", { s: CF.L(st(el.value), "label") })); CF.refresh(); });
  on("set-provider", async (el) => { try { await api("PATCH", `/staff/appointments/${el.dataset.id}`, { provider_id: Number(el.value) }); CF.toast(t("saved")); CF.refresh(); } catch (e) { CF.toast(CF.errMsg(e), "err"); } });
  onForm("appointment-contact", async (d, f) => {
    const fields = ["patient_phone", "patient_email"].filter((name) => d[name] !== f.elements.namedItem(name).defaultValue);
    if (!fields.length) return;
    const { appointment } = await api("PATCH", `/staff/appointments/${f.dataset.id}`, Object.fromEntries(fields.map((name) => [name, d[name]])));
    for (const name of fields) {
      const input = f.elements.namedItem(name), saved = appointment[name] || "";
      if (input.value === d[name]) input.value = saved;
      input.defaultValue = saved;
    }
    CF.toast(t("saved"));
  });
  onForm("notes", async (d, f) => { await api("PATCH", `/staff/appointments/${f.dataset.id}`, d); CF.toast(t("saved")); });
  onForm("send-form", async (d, f) => { await api("POST", `/staff/appointments/${f.dataset.id}/forms`, { template_id: Number(d.template_id) }); CF.toast(t("form_sent_patient")); openAppt(f.dataset.id); });
  on("form-accept", async (el) => { await api("POST", `/staff/forms/${el.dataset.id}/accept`); CF.toast(t("saved")); openAppt(el.dataset.a); });
  onForm("form-return", async (d, f) => { await api("POST", `/staff/forms/${f.dataset.id}/return`, d); CF.toast(t("form_returned")); openAppt(f.dataset.a); });
  on("staff-cancel", async (el) => {
    if (!(await CF.confirm(t("staff_cancel_q"), { danger: true, ok: t("yes_cancel") }))) return;
    el.disabled = true;
    try { await api("POST", `/appointments/${el.dataset.id}/cancel`); CF.closeModal(); CF.toast(t("cancelled_ok")); CF.refresh(); }
    catch (e) { el.disabled = false; CF.toast(CF.errMsg(e), "err"); }
  });
  on("resched-date", async (el) => {
    const { slots } = await api("GET", `/clinics/${S.user.clinic_id}/slots?date=${el.value}&type=${el.dataset.type}&provider=${el.dataset.p}`);
    document.getElementById("rslots").innerHTML = slots.map((s) => `<button class="slot" data-act="staff-resched" data-id="${el.dataset.id}" data-s="${s.start}" data-p="${s.provider_id}">${esc(CF.fmtTime(s.start))}</button>`).join("") || `<p class="muted small">${t("no_slots")}</p>`;
  });
  on("staff-resched", async (el) => {
    try { await api("POST", `/appointments/${el.dataset.id}/reschedule`, { start: el.dataset.s, provider_id: Number(el.dataset.p) }); CF.toast(t("rescheduled_ok")); openAppt(el.dataset.id); CF.refresh(); }
    catch (e) { CF.toast(CF.errMsg(e), "err"); }
  });

  // =====================================================================
  // MANUAL BOOKING (phone / walk-in) – few clicks
  // =====================================================================
  const initialBooking = () => ({ date: CF.ymd(new Date()), type: null, provider: "", providerQuery: "", slot: null, source: "phone", draft: {}, patient: null, matches: [], mode: "new", lookup: "" });
  const patientMatchesHtml = () => B.lookup.trim().length < 2 ? `<p class="small muted">${t("lookup_hint")}</p>` :
    B.matches.map((p) => `<button type="button" class="choice" data-act="pick-booking-patient" data-id="${p.id}">
      <b>${esc(p.name)}</b><span class="small muted">${esc([p.phone, p.email].filter(Boolean).join(" · "))}</span></button>`).join("") || `<p>${t("no_returning_patients")}</p>`;
  const B = initialBooking();
  function bookingProviderOptions() {
    const query = B.providerQuery.trim().toLowerCase();
    return `<option value="">${t("any_provider")}</option>` + META.providers.filter((p) => p.active &&
      (String(p.id) === B.provider || `${p.name} ${p.specialty || ""}`.toLowerCase().includes(query)))
      .map((p) => `<option value="${p.id}" ${String(p.id) === B.provider ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  }
  function keepBookingDraft() {
    const form = document.querySelector('form[data-form="staff-book"]');
    if (form) B.draft = CF.formData(form);
  }
  route("/staff/book", { title: "nav_staff_book", roles: STAFF, render: async () => {
    if (B.userId !== S.user.id) Object.assign(B, initialBooking(), { userId: S.user.id });
    await CF.meta();
    if (!B.type) B.type = META.types[0]?.id;
    const { slots } = await api("GET", `/clinics/${S.user.clinic_id}/slots?date=${B.date}&type=${B.type}${B.provider ? `&provider=${B.provider}` : ""}`);
    return `<section class="page">
      <header class="page-head"><h1>${t("nav_staff_book")}</h1><p class="muted">${t("staff_book_sub")}</p></header>
      <div class="grid-book">
      <div class="card stack">
        <fieldset><legend class="label">${t("booked_by")}</legend><div class="seg-ctrl" role="radiogroup">${["phone", "in_person"].map((s) => `<button role="radio" aria-checked="${B.source === s}" data-act="bsrc" data-s="${s}">${I(sourceIcon(s))} ${t("src_" + s)}</button>`).join("")}</div></fieldset>
        <fieldset><legend class="label">${t("visit_type")}</legend><div class="check-pills">${META.types.map((ty) => `<button class="pill type-pill ${B.type === ty.id ? "on" : ""}" style="--c:${esc(ty.color)}" aria-pressed="${B.type === ty.id}" data-act="btype" data-id="${ty.id}">${esc(CF.L(ty, "name"))} · ${ty.minutes}′</button>`).join("")}</div></fieldset>
        ${CF.field("provider_search", t("find_practitioner"), { type: "search", value: B.providerQuery, attrs: 'data-input="booking-provider-query"' })}
        <div class="grid2"><div class="field"><label for="bp">${t("provider")}</label><select id="bp" data-change="bprov">${bookingProviderOptions()}</select></div>
          <div class="field"><label for="bd">${t("date")}</label><input id="bd" type="date" value="${B.date}" min="${CF.ymd(new Date())}" data-change="bdate"/></div></div>
        <h2 class="label">${t("free_times")} · ${esc(CF.relDay(B.date))}</h2>
        <div class="slots">${(() => { const u = []; slots.forEach((s) => { if (!u.find((x) => x.start === s.start)) u.push(s); }); return u; })().map((s) => `<button class="slot ${B.slot?.start === s.start ? "selected" : ""}" aria-pressed="${B.slot?.start === s.start}" data-act="bslot" data-s="${s.start}" data-p="${s.provider_id}">${esc(CF.fmtTime(s.start))}${B.provider ? "" : `<small>${esc(s.provider_name.replace("Dr. ", "Dr "))}</small>`}</button>`).join("") || `<p class="muted">${t("no_slots")}</p>`}</div>
      </div>
      <form data-form="staff-book" class="card stack sticky">
        <h2>${t("patient")}</h2>
        <div class="seg-ctrl patient-mode" role="radiogroup" aria-label="${esc(t("patient"))}">
          ${["new", "returning"].map((m) => `<button type="button" role="radio" aria-checked="${B.mode === m}" data-act="bmode" data-m="${m}">${I(m === "new" ? "plus" : "user")} ${t("patient_mode_" + m)}</button>`).join("")}</div>
        ${B.mode === "returning" && !B.patient ? `<div class="field"><label for="bps">${t("lookup_patient")}</label>
            <input id="bps" type="search" autocomplete="off" value="${esc(B.lookup)}" data-input="bp-search" aria-describedby="bp-matches"/></div>
          <div id="bp-matches" class="stack patient-matches" aria-live="polite">${patientMatchesHtml()}</div>` : ""}
        ${B.patient ? `<div class="notice info row between wrap">${I("user")}<span class="grow">${t("returning_selected", { name: `<b>${esc(B.patient.name)}</b>` })}</span>
          <button type="button" class="btn sm ghost" data-act="new-booking-patient">${t("change")}</button></div>` : ""}
        ${B.mode === "new" || B.patient ? `
        ${CF.field("patient_name", t("full_name"), { required: true, value: B.draft.patient_name, auto: "off", attrs: B.patient ? "readonly" : "" })}
        ${CF.field("phone", t("phone"), { type: "tel", value: B.draft.phone, auto: "off" })}
        ${CF.field("email", t("email"), { type: "email", value: B.draft.email, auto: "off", hint: B.patient ? t("contact_update_hint") : "" })}
        ${CF.field("reason", t("reason"), { value: B.draft.reason, hint: t("no_medical") })}` : ""}
        <div class="notice ${B.slot ? "info" : "warn"}">${I("cal")} ${B.slot ? `${esc(CF.relDay(B.slot.start))} · <b>${esc(CF.fmtTime(B.slot.start))}</b> · ${esc(META.providers.find((p) => p.id === B.slot.provider_id)?.name || "")}` : t("pick_slot_first")}</div>
        <button class="btn primary block" type="submit" ${B.slot && (B.mode === "new" || B.patient) ? "" : "disabled"}>${I("check")} ${t("book")}</button></form></div></section>`;
  } });
  on("bsrc", (el) => { keepBookingDraft(); B.source = el.dataset.s; CF.refresh(); });
  on("btype", (el) => { keepBookingDraft(); B.type = Number(el.dataset.id); B.slot = null; CF.refresh(); });
  on("bprov", (el) => { keepBookingDraft(); B.provider = el.value; B.slot = null; CF.refresh(); });
  on("booking-provider-query", (el) => {
    B.providerQuery = el.value;
    const select = document.getElementById("bp");
    if (select) select.innerHTML = bookingProviderOptions();
  });
  on("bdate", (el) => { if (!el.value) return; keepBookingDraft(); B.date = el.value; B.slot = null; CF.refresh(); });
  on("bslot", (el) => {
    keepBookingDraft();
    B.slot = { start: el.dataset.s, provider_id: Number(el.dataset.p) };
    CF.refresh().then(() => (B.mode === "returning" && !B.patient ? document.getElementById("bps") : document.querySelector('form[data-form="staff-book"] input[name="patient_name"]:not([readonly]), form[data-form="staff-book"] input[name="reason"]'))?.focus());
  });
  on("returning-patient", () => {
    CF.modal(t("returning_patient"), `<form data-form="lookup-patient" class="stack">
      ${CF.field("query", t("lookup_patient"), { type: "search", required: true, attrs: 'minlength="2" autofocus' })}
      <button class="btn primary" type="submit">${t("search")}</button></form><div class="stack" id="patient-matches" aria-live="polite"></div>`);
  });
  onForm("lookup-patient", async (d) => {
    const { patients } = await api("GET", `/staff/patients?q=${encodeURIComponent(d.query)}`);
    B.matches = patients;
    const matches = document.getElementById("patient-matches");
    if (matches) matches.innerHTML = patients.map((p) => `<button type="button" class="choice" data-act="pick-booking-patient" data-id="${p.id}">
      <b>${esc(p.name)}</b><span class="small muted">${esc([p.phone, p.email].filter(Boolean).join(" · "))}</span></button>`).join("") || `<p>${t("no_returning_patients")}</p>`;
  });
  on("pick-booking-patient", (el) => {
    const p = B.matches.find((patient) => patient.id === Number(el.dataset.id));
    if (!p) return;
    keepBookingDraft();
    B.patient = p; B.mode = "returning";
    Object.assign(B.draft, { patient_name: p.name, phone: p.phone || "", email: p.email || "" });
    if (el.closest(".modal-wrap")) CF.closeModal();
    CF.refresh().then(() => document.querySelector('form[data-form="staff-book"] input[name="reason"]')?.focus());
  });
  on("new-booking-patient", () => {
    keepBookingDraft();
    B.patient = null;
    Object.assign(B.draft, { patient_name: "", phone: "", email: "" });
    CF.refresh().then(() => document.getElementById("bps")?.focus());
  });
  on("bmode", (el) => {
    if (B.mode === el.dataset.m) return;
    keepBookingDraft();
    B.mode = el.dataset.m; B.patient = null; B.matches = []; B.lookup = "";
    Object.assign(B.draft, { patient_name: "", phone: "", email: "" });
    CF.refresh().then(() => (B.mode === "returning" ? document.getElementById("bps") : document.querySelector('form[data-form="staff-book"] input[name="patient_name"]'))?.focus());
  });
  // Search returning patients as you type (name, phone or email) – results update without leaving the form.
  let bpT;
  on("bp-search", (el) => {
    B.lookup = el.value; clearTimeout(bpT);
    bpT = setTimeout(async () => {
      const q = B.lookup.trim();
      B.matches = q.length >= 2 ? (await api("GET", `/staff/patients?q=${encodeURIComponent(q)}`)).patients : [];
      if (q !== B.lookup.trim()) return; // a newer search is on its way
      const box = document.getElementById("bp-matches");
      if (box) box.innerHTML = patientMatchesHtml();
    }, 250);
  });
  onForm("staff-book", async (d) => {
    try {
      const { appointment: a } = await api("POST", "/staff/appointments", { ...d, patient_record: B.patient?.id, start: B.slot.start, provider_id: B.slot.provider_id, type_id: B.type, source: B.source });
      CF.toast(t("staff_booked", { name: a.patient_name, when: `${CF.relDay(a.start)} ${CF.fmtTime(a.start)}` }));
      B.slot = null; B.draft = {}; B.patient = null; B.lookup = ""; B.matches = []; CF.refresh();
    } catch (e) { CF.toast(CF.errMsg(e), "err"); B.slot = null; B.draft = d; CF.refresh(); }
  });

  // =====================================================================
  // WAITLIST
  // =====================================================================
  route("/staff/waitlist", { title: "nav_waitlist", roles: STAFF, live: true, render: async () => {
    await CF.meta();
    const { waitlist } = await api("GET", "/staff/waitlist");
    return `<section class="page"><header class="page-head"><h1>${t("nav_waitlist")}</h1><p class="muted">${t("waitlist_sub")}</p></header>
      <div class="table-wrap card"><table class="table"><thead><tr><th>#</th><th>${t("patient")}</th><th>${t("wanted")}</th><th>${t("contact")}</th><th>${t("status")}</th><th><span class="sr-only">${t("actions")}</span></th></tr></thead>
      <tbody>${waitlist.map((w, i) => `<tr><td>${i + 1}</td><td><b>${esc(w.patient_name)}</b></td><td>${w.date ? esc(CF.fmtShort(w.date)) : t("any_day")}${w.provider_name ? `<br/><span class="small muted">${esc(w.provider_name)}</span>` : ""}${w.type_en ? `<br/><span class="small muted">${esc(S.lang === "fr" ? w.type_fr : w.type_en)}</span>` : ""}</td>
        <td class="small">${esc(w.phone || "")}<br/>${esc(w.email || "")}</td><td>${w.status === "offered" ? CF.chip(t("offered_at", { when: CF.fmtShort(w.offer_start) + " " + CF.fmtTime(w.offer_start) }), "#2F80ED") : CF.chip(t("waiting_wl"), "#E0A100")}</td>
        <td class="row gap">${w.status === "waiting" ? `<button class="btn sm" data-act="wl-offer" data-id="${w.id}" data-date="${w.date || CF.ymd(new Date())}" data-p="${w.provider_id || ""}" data-type="${w.type_id || ""}">${t("offer_slot")}</button>` : ""}
          <button class="btn sm ghost danger-text" data-act="wl-remove" data-id="${w.id}" aria-label="${esc(t("remove") + " " + w.patient_name)}">${I("trash")}</button></td></tr>`).join("") || `<tr><td colspan="6">${CF.empty("hourglass", t("waitlist_empty"))}</td></tr>`}</tbody></table></div>
      <p class="small muted">${I("info")} ${t("waitlist_auto")}</p></section>`;
  } });
  on("wl-remove", async (el) => { if (await CF.confirm(t("remove_wl_q"), { danger: true, ok: t("remove") })) { await api("DELETE", `/staff/waitlist/${el.dataset.id}`); CF.refresh(); } });
  on("wl-offer", async (el) => {
    const load = async (date) => {
      const { slots } = await api("GET", `/clinics/${S.user.clinic_id}/slots?date=${date}${el.dataset.type ? `&type=${el.dataset.type}` : ""}${el.dataset.p ? `&provider=${el.dataset.p}` : ""}`);
      document.getElementById("wlslots").innerHTML = slots.map((s) => `<button class="slot" data-act="wl-offer-slot" data-id="${el.dataset.id}" data-s="${s.start}" data-p="${s.provider_id}">${esc(CF.fmtTime(s.start))}<small>${esc(s.provider_name)}</small></button>`).join("") || `<p class="muted">${t("no_slots")}</p>`;
    };
    const m = CF.modal(t("offer_slot"), `<div class="field"><label for="wld">${t("date")}</label><input type="date" id="wld" value="${el.dataset.date}" min="${CF.ymd(new Date())}"/></div><div id="wlslots" class="slots"></div>`);
    m.el.querySelector("#wld").onchange = (e) => load(e.target.value);
    load(el.dataset.date);
  });
  on("wl-offer-slot", async (el) => { await api("POST", `/staff/waitlist/${el.dataset.id}/offer`, { start: el.dataset.s, provider_id: Number(el.dataset.p) }); CF.closeModal(); CF.toast(t("offer_sent")); CF.refresh(); });

  // =====================================================================
  // MESSAGES (incl. conversations handed over by Clio)
  // =====================================================================
  let MU = null;
  route("/staff/messages", { title: "nav_messages", roles: STAFF, live: true, render: async (q) => {
    await CF.meta();
    if (q.u) MU = Number(q.u);
    const { threads } = await api("GET", "/staff/messages");
    if (!MU && threads[0]) MU = threads[0].user_id;
    const conv = MU ? await api("GET", `/staff/messages/${MU}`) : null;
    const tpl = META.templates;
    return `<section class="page wide"><header class="page-head"><h1>${t("nav_messages")}</h1></header>
      <div class="inbox">
        <ul class="threads card" aria-label="${esc(t("conversations"))}">${threads.map((th) => `<li><button class="thread ${th.user_id === MU ? "active" : ""}" data-act="open-thread" data-u="${th.user_id}" ${th.user_id === MU ? 'aria-current="true"' : ""}>
          <span class="row between"><b>${esc(th.first_name)} ${esc(th.last_name)}</b>${th.unread ? `<span class="badge">${th.unread}</span>` : ""}</span>
          <span class="small muted clamp">${esc(th.last_body)}</span></button></li>`).join("") || `<li class="muted">${t("no_messages")}</li>`}</ul>
        ${conv ? `<div class="card conv"><div class="row between wrap"><h2>${esc(conv.patient.first_name)} ${esc(conv.patient.last_name)}</h2>
            <span class="row gap">${conv.patient.phone ? `<a class="btn sm" href="tel:${esc(conv.patient.phone)}">${I("phone")} ${t("call")}</a>` : ""}<a class="btn sm ghost" href="mailto:${esc(conv.patient.email)}" aria-label="${esc(t("email") + " " + conv.patient.email)}">${I("mail")}</a></span></div>
          <div class="chat" aria-live="polite">${conv.messages.map((m) => `<div class="bubble ${m.sender === "staff" ? "me" : m.sender}"><span class="who">${m.sender === "staff" ? t("clinic") : esc(conv.patient.first_name)}</span><p>${esc(m.body).replace(/\n/g, "<br/>")}</p><time>${esc(CF.fmtShort(m.created_at))} ${esc(CF.fmtTime(m.created_at))}</time></div>`).join("")}</div>
          <div class="chips-row">${tpl.filter((x) => ["reminder", "forms_due", "status_update"].includes(x.key)).map((x) => `<button class="chip-btn" data-act="insert-tpl" data-k="${x.key}">${t("tpl_" + x.key)}</button>`).join("")}</div>
          <form data-form="staff-msg" class="row gap compose"><label class="sr-only" for="smb">${t("message")}</label><textarea id="smb" name="body" rows="2" required placeholder="${esc(t("write_message"))}"></textarea><button class="btn primary" type="submit" aria-label="${esc(t("send"))}">${I("send")}</button></form></div>`
          : `<div class="card">${CF.empty("msg", t("no_messages"))}</div>`}
      </div></section>`;
  }, after: () => { const c = document.querySelector(".conv .chat"); if (c) c.scrollTop = c.scrollHeight; } });
  on("open-thread", (el) => { MU = Number(el.dataset.u); CF.go("/staff/messages?u=" + MU); });
  on("insert-tpl", (el) => { const x = META.templates.find((x) => x.key === el.dataset.k); const ta = document.getElementById("smb"); ta.value = (S.lang === "fr" ? x.body_fr : x.body_en).replace("{clinic}", META.clinic.name); ta.focus(); });
  onForm("staff-msg", async (d) => { await api("POST", `/staff/messages/${MU}`, d); CF.refresh(); });
})();
