/* ClinicFlow – sign-in flows, patient interface, account page. */
(function () {
  const { t, esc, icon: I, api, on, onForm, route, state: S } = CF;

  // =====================================================================
  // SIGN-IN / REGISTRATION / VERIFICATION
  // =====================================================================
  let pending = {};
  const authShell = (title, sub, inner, extra = "") => `<section class="auth">
      <div class="auth-card card"><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ""}${inner}</div>
      <aside class="auth-side" aria-hidden="true"><div><span class="logo big">${I("plus")}</span><h2>${t("tagline")}</h2><ul>
        <li>${I("cal")} ${t("pitch_1")}</li><li>${I("clock")} ${t("pitch_2")}</li><li>${I("globe")} ${t("pitch_3")}</li><li>${I("a11y")} ${t("pitch_4")}</li></ul></div></aside>${extra}</section>`;
  const demoBanner = () => (pending.demoCode ? `<div class="notice info" role="note">${I("info")}<div><b>${t("demo_mode")}</b> ${t("demo_code", { code: `<b class="code">${pending.demoCode}</b>` })}</div></div>` : "");
  async function afterAuth(r) {
    pending = { ...pending, ...r };
    if (r.token) pending.token = r.token;
    if (r.stage === "ok") return CF.signedIn(pending.token);
    CF.state.token = pending.token;
    CF.go(r.stage === "pin" ? "/pin" : "/verify");
  }

  route("/login", { title: "sign_in", guestOnly: true, render: () => authShell(t("welcome_back"), t("sign_in_sub"), `
    <form data-form="login" class="stack" novalidate>
      ${CF.field("email", t("email"), { type: "email", required: true, auto: "email" })}
      ${CF.field("password", t("password"), { type: "password", required: true, auto: "current-password" })}
      <button class="btn primary block" type="submit">${t("sign_in")}</button>
      <div class="row between small"><a href="#/forgot">${t("forgot_password")}</a><a href="#/register">${t("create_account")}</a></div>
    </form>
    ${S.config.samples ? `<details class="demo-accounts"><summary>${t("demo_accounts")}</summary>
      <ul>${[["patient@demo.ca", "role_patient", "2468"], ["staff@demo.ca", "role_reception"], ["nurse@demo.ca", "role_nurse"], ["admin@demo.ca", "role_admin"]].map(([e, r, pin]) =>
        `<li><button class="link" data-act="demo-fill" data-email="${e}">${e}</button> · ${t(r)}${pin ? ` · ${t("account_password")}: <code>${pin}</code>` : ""}</li>`).join("")}</ul>
      <p class="small muted">${t("demo_password")}: <code>Demo1234!</code></p></details>` : ""}
    <hr/><p class="small">${I("building")} ${t("clinic_q")} <a href="#/clinic-signup">${t("clinic_signup_link")}</a></p>`) });
  on("demo-fill", (el) => { const f = document.querySelector('form[data-form="login"]'); f.email.value = el.dataset.email; f.password.value = "Demo1234!"; f.password.focus(); });
  onForm("login", async (d) => { pending = {}; afterAuth(await api("POST", "/auth/login", d)); });

  route("/pin", { title: "account_password", render: () => authShell(t("account_password"), t("pin_sub"), `
    <form data-form="pin" class="stack">${CF.field("pin", t("account_password"), { type: "password", required: true, auto: "off", attrs: 'inputmode="numeric" autofocus' })}
      <button class="btn primary block" type="submit">${t("continue")}</button><a href="#/login" class="small">${t("use_other_account")}</a></form>`) });
  onForm("pin", async (d) => afterAuth(await api("POST", "/auth/pin", d)));

  route("/verify", { title: "verify_identity", render: () => authShell(t("verify_identity"), t("code_sent_to", { to: esc(pending.sent_to || ""), via: t("via_" + (pending.channel || "email")) }), `
    ${demoBanner()}
    <form data-form="verify" class="stack">${CF.field("code", t("code_6"), { required: true, auto: "one-time-code", attrs: 'inputmode="numeric" maxlength="6" autofocus pattern="[0-9]*"' })}
      <button class="btn primary block" type="submit">${t("verify")}</button></form>
    <p class="small muted">${t("check_spam")}</p>
    <button class="btn sm ghost" data-act="resend">${I("mail")} ${t("send_new_code")}</button>`) });
  onForm("verify", async (d) => afterAuth(await api("POST", "/auth/verify", d)));
  on("resend", async (el) => {
    try { pending = { ...pending, ...(await api("POST", "/auth/send-code", {})) }; CF.render(); CF.toast(t("code_resent")); }
    catch (e) { CF.toast(CF.errMsg(e), "err"); }
  });

  route("/register", { title: "create_account", guestOnly: true, render: () => authShell(t("create_account"), t("register_sub"), `
    <form data-form="register" class="stack">
      <div class="grid2">${CF.field("first_name", t("first_name"), { required: true, auto: "given-name" })}${CF.field("last_name", t("last_name"), { required: true, auto: "family-name" })}</div>
      ${CF.field("email", t("email"), { type: "email", required: true, auto: "email" })}
      ${CF.field("phone", t("phone"), { type: "tel", auto: "tel", hint: t("phone_hint") })}
      ${CF.field("password", t("password"), { type: "password", required: true, auto: "new-password", hint: t("password_hint"), attrs: 'minlength="8"' })}
      <p class="small muted">${I("mail")} ${t("we_email_code")}</p>
      <p class="small muted">${I("shield")} ${t("privacy_note")}</p>
      ${CF.consentChecks()}
      <button class="btn primary block" type="submit">${t("create_account")}</button>
      <a href="#/login" class="small">${t("have_account")}</a></form>`) });
  onForm("register", async (d) => { pending = {}; afterAuth(await api("POST", "/auth/register", { ...d, lang: S.lang, accept_terms: !!d.accept_terms, accept_privacy: !!d.accept_privacy })); });

  route("/forgot", { title: "forgot_password", guestOnly: true, render: () => authShell(t("forgot_password"), t("forgot_sub"), `
    ${demoBanner()}
    ${pending.resetEmail ? `<form data-form="reset" class="stack">${CF.field("code", t("code_6"), { required: true, attrs: 'inputmode="numeric" maxlength="6" autofocus' })}
        ${CF.field("password", t("new_password"), { type: "password", required: true, auto: "new-password", attrs: 'minlength="8"', hint: t("password_hint") })}
        <button class="btn primary block" type="submit">${t("save_password")}</button></form>`
      : `<form data-form="forgot" class="stack">${CF.field("email", t("email"), { type: "email", required: true, auto: "email" })}
        <button class="btn primary block" type="submit">${t("send_code")}</button><a href="#/login" class="small">${t("back_to_sign_in")}</a></form>`}`) });
  onForm("forgot", async (d) => { const r = await api("POST", "/auth/forgot", d); pending = { ...r, resetEmail: d.email }; CF.render(); });
  onForm("reset", async (d) => { await api("POST", "/auth/reset", { ...d, email: pending.resetEmail }); pending = {}; CF.toast(t("password_saved")); CF.go("/login"); });

  route("/clinic-signup", { title: "clinic_signup", guestOnly: true, render: () => `<section class="page narrow">
    <header class="page-head"><h1>${t("clinic_signup")}</h1><p class="muted">${t("clinic_signup_sub")}</p></header>
    <ol class="benefits">${[1, 2, 3].map((n) => `<li>${I(["cal", "queue", "users"][n - 1])}<div><b>${t("cs_b" + n)}</b><p class="muted">${t("cs_b" + n + "_d")}</p></div></li>`).join("")}</ol>
    <form data-form="clinic-signup" class="card stack">
      <h2>${t("your_clinic")}</h2>
      ${CF.field("name", t("clinic_name"), { required: true, auto: "organization" })}
      <div class="grid2">${CF.field("address", t("address"), { required: true, auto: "street-address" })}${CF.field("city", t("city"), { value: "Ottawa", auto: "address-level2" })}</div>
      <div class="grid2">${CF.field("postal", t("postal"), { auto: "postal-code" })}${CF.field("phone", t("clinic_phone"), { type: "tel", auto: "tel" })}</div>
      ${CF.field("first_provider", t("first_provider"), { hint: t("first_provider_hint") })}
      <h2>${t("admin_account")}</h2>
      <div class="grid2">${CF.field("admin_first_name", t("first_name"), { required: true, auto: "given-name" })}${CF.field("admin_last_name", t("last_name"), { auto: "family-name" })}</div>
      <div class="grid2">${CF.field("admin_email", t("email"), { type: "email", required: true, auto: "email" })}${CF.field("admin_password", t("password"), { type: "password", required: true, auto: "new-password", attrs: 'minlength="8"', hint: t("password_hint") })}</div>
      ${CF.consentChecks(true)}
      <button class="btn primary" type="submit">${t("join_clinicflow")}</button>
      <p class="small"><a href="#/login">${t("back_to_sign_in")}</a></p></form></section>` });
  onForm("clinic-signup", async (d) => { const r = await api("POST", "/clinics/register", { ...d, lang: S.lang, accept_terms: !!d.accept_terms, accept_privacy: !!d.accept_privacy, accept_clinic: !!d.accept_clinic }); CF.toast(t("clinic_created")); await CF.signedIn(r.token); CF.go("/admin"); });

  // =====================================================================
  // PATIENT HOME
  // =====================================================================
  const apptCard = (a, { full = false } = {}) => {
    const soon = a.estimate;
    const atClinic = ["checked_in", "waiting"].includes(a.status) || (soon && a.start.slice(0, 10) === CF.ymd(new Date()) && CF.toDate(a.start) - Date.now() < 3600000);
    return `<article class="card appt" aria-labelledby="ap${a.id}">
      <div class="appt-when"><span class="day">${esc(CF.relDay(a.start))}</span><span class="time">${esc(CF.fmtTime(a.start))}</span></div>
      <div class="appt-main">
        <h3 id="ap${a.id}">${esc(a.clinic.name)}</h3>
        <p class="muted">${I("steth")} ${esc(a.provider?.name || "")} ${a.member_id ? `· ${I("user")} ${esc(a.patient_name)}` : ""}</p>
        <div class="row gap wrap">${CF.statusChip(a)}${CF.typeChip(a.type)}</div>
        ${CF.tracker(a)}
        ${soon ? `<div class="live"><h4>${I("clock")} ${t("live_estimate")}</h4>${CF.estimateView(a.estimate)}</div>` : ""}
        ${atClinic ? crowdPrompt(a) : ""}
        ${a.forms.filter((f) => ["todo", "returned"].includes(f.status)).map((f) => `<a class="notice warn" href="#/todo">${I("todo")}<span>${t("form_due", { form: esc(CF.L(f, "title")) })}</span>${I("chevR")}</a>`).join("")}
        <div class="row gap wrap actions">
          <a class="btn sm" href="${CF.mapsUrl(a.clinic)}" target="_blank" rel="noopener">${I("nav")} ${t("directions")}<span class="sr-only"> (${t("opens_new")})</span></a>
          <a class="btn sm ghost" href="tel:${esc(a.clinic.phone)}">${I("phone")} ${t("call_clinic")}</a>
          ${full ? `<button class="btn sm ghost" data-act="resched" data-id="${a.id}">${I("cal")} ${t("reschedule")}</button>
          <button class="btn sm ghost danger-text" data-act="cancel-appt" data-id="${a.id}">${I("x")} ${t("cancel")}</button>` : `<a class="btn sm ghost" href="#/appointments">${t("manage")}</a>`}
        </div>
        <p class="small muted">${I("pin")} ${esc(a.clinic.address)}, ${esc(a.clinic.city)}</p>
      </div></article>`;
  };
  const crowdPrompt = (a) => CF.store.get("crowd_" + a.id) ? `<p class="small muted">${I("check")} ${t("crowd_thanks")}</p>` : `
    <div class="crowd-prompt" role="group" aria-labelledby="cp${a.id}"><p id="cp${a.id}"><b>${t("at_clinic_q")}</b> <span class="muted">${t("optional")}</span></p>
      <div class="row gap wrap">${[1, 2, 3].map((l) => `<button class="btn sm crowd-btn c${l}" data-act="crowd" data-clinic="${a.clinic_id}" data-appt="${a.id}" data-l="${l}">${t("crowd_" + ["", "quiet", "moderate", "busy"][l])}</button>`).join("")}</div></div>`;
  on("crowd", async (el) => {
    await api("POST", "/crowd", { clinic_id: Number(el.dataset.clinic), level: Number(el.dataset.l), waited_minutes: null });
    CF.store.set("crowd_" + el.dataset.appt, 1);
    CF.toast(t("crowd_thanks"));
    CF.refresh();
  });

  route("/home", { title: "nav_home", roles: ["patient"], live: true, render: async () => {
    const [{ upcoming }, { waitlist }, { forms }] = await Promise.all([api("GET", "/my/appointments"), api("GET", "/my/waitlist"), api("GET", "/my/forms")]);
    const todo = forms.filter((f) => ["todo", "returned"].includes(f.status));
    const offers = waitlist.filter((w) => w.status === "offered");
    const hr = new Date().getHours();
    return `<section class="page">
      <header class="page-head row between wrap"><div><h1>${t(hr < 12 ? "good_morning" : hr < 18 ? "good_afternoon" : "good_evening", { name: esc(S.user.first_name) })}</h1>
        <p class="muted">${upcoming.length ? t("you_have_n", { n: upcoming.length }) : t("no_upcoming")}</p></div>
        <a class="btn primary lg" href="#/book?new=1">${I("plus")} ${t("book_appointment")}</a></header>
      ${offers.map(offerCard).join("")}
      ${upcoming[0] ? `<h2 class="section-title">${t("next_appointment")}</h2>${apptCard(upcoming[0])}` : `<div class="card">${CF.empty("cal", t("no_upcoming"), `<a class="btn primary" href="#/book?new=1">${t("book_appointment")}</a>`)}</div>`}
      <h2 class="section-title">${t("quick_access")}</h2>
      <div class="tiles">
        <a class="tile" href="#/appointments" style="--c:var(--blue)">${I("cal")}<b>${t("nav_appointments")}</b><span>${t("n_upcoming", { n: upcoming.length })}</span></a>
        <a class="tile" href="#/todo" style="--c:var(--amber)">${I("todo")}<b>${t("nav_todo")}</b><span>${todo.length ? t("n_forms_due", { n: todo.length }) : t("all_done")}</span></a>
        <a class="tile" href="#/clinics?saved=1" style="--c:var(--pink)">${I("star")}<b>${t("saved_clinics")}</b><span>${t("find_quickly")}</span></a>
        <a class="tile" href="#/messages" style="--c:var(--violet)">${I("msg")}<b>${t("nav_messages")}</b><span>${S.unread.messages ? t("n_new", { n: S.unread.messages }) : t("talk_clinic")}</span></a>
      </div></section>`;
  } });

  const offerCard = (w) => `<div class="card offer" role="alert">${I("bell")}<div><h3>${t("spot_opened")}</h3>
    <p>${t("offer_text", { clinic: esc(w.clinic_name), date: esc(CF.relDay(w.offer_start)), time: esc(CF.fmtTime(w.offer_start)), provider: esc(w.offer_provider_name || "") })}</p>
    <div class="row gap"><button class="btn primary" data-act="wl-accept" data-id="${w.id}">${t("accept_spot")}</button><button class="btn ghost" data-act="wl-decline" data-id="${w.id}">${t("decline")}</button></div></div></div>`;
  on("wl-accept", async (el) => { try { await api("POST", `/waitlist/${el.dataset.id}/accept`); CF.toast(t("booked_ok")); CF.go("/appointments"); } catch (e) { CF.toast(CF.errMsg(e), "err"); CF.refresh(); } });
  on("wl-decline", async (el) => { await api("POST", `/waitlist/${el.dataset.id}/decline`); CF.refresh(); });
  on("wl-leave", async (el) => { if (await CF.confirm(t("leave_waitlist_q"))) { await api("DELETE", `/waitlist/${el.dataset.id}`); CF.refresh(); } });

  // =====================================================================
  // MY APPOINTMENTS
  // =====================================================================
  route("/appointments", { title: "nav_appointments", roles: ["patient"], live: true, render: async () => {
    const [{ upcoming, past }, { waitlist }] = await Promise.all([api("GET", "/my/appointments"), api("GET", "/my/waitlist")]);
    return `<section class="page">
      <header class="page-head row between wrap"><h1>${t("nav_appointments")}</h1><a class="btn primary" href="#/book?new=1">${I("plus")} ${t("book_appointment")}</a></header>
      ${waitlist.filter((w) => w.status === "offered").map(offerCard).join("")}
      <h2 class="section-title">${t("upcoming")} <span class="count">${upcoming.length}</span></h2>
      ${upcoming.length ? upcoming.map((a) => apptCard(a, { full: true })).join("") : `<div class="card">${CF.empty("cal", t("no_upcoming"))}</div>`}
      ${waitlist.length ? `<h2 class="section-title">${t("my_waitlists")}</h2><div class="card"><ul class="plain-list">${waitlist.map((w) => `<li class="row between wrap">
        <div><b>${esc(w.clinic_name)}</b> · ${w.date ? esc(CF.relDay(w.date)) : t("any_day")} ${w.provider_name ? "· " + esc(w.provider_name) : ""}
          <p class="small muted">${w.status === "offered" ? t("offer_waiting") : t("waitlist_position", { n: w.position })}</p></div>
        <button class="btn sm ghost" data-act="wl-leave" data-id="${w.id}">${t("leave")}</button></li>`).join("")}</ul></div>` : ""}
      <details class="past"><summary><h2 class="section-title inline">${t("past")} <span class="count">${past.length}</span></h2></summary>
        <ul class="plain-list card">${past.map((a) => `<li class="row between wrap"><span>${esc(CF.fmtShort(a.start))} · ${esc(CF.fmtTime(a.start))} — <b>${esc(a.clinic.name)}</b> · ${esc(a.provider?.name || "")}</span>
          <span class="row gap">${CF.statusChip(a)}<button class="btn sm ghost" data-act="book-again" data-clinic="${a.clinic_id}">${t("book_again")}</button></span></li>`).join("") || `<li>${t("none")}</li>`}</ul></details>
    </section>`;
  } });
  on("cancel-appt", async (el) => {
    if (!(await CF.confirm(t("cancel_q"), { ok: t("yes_cancel"), danger: true }))) return;
    try { await api("POST", `/appointments/${el.dataset.id}/cancel`); CF.toast(t("cancelled_ok")); CF.refresh(); }
    catch (e) { CF.modal(t("cannot_cancel"), `<p>${CF.errMsg(e)}</p><a class="btn primary" href="tel:${esc(e.data?.phone || "")}">${I("phone")} ${t("call_clinic")} ${esc(e.data?.phone || "")}</a>`); }
  });
  on("resched", async (el) => {
    const { upcoming } = await api("GET", "/my/appointments");
    const a = upcoming.find((x) => x.id === Number(el.dataset.id));
    W = newWizard();
    Object.assign(W, { reschedule: a, member_id: a.member_id, clinic: { id: a.clinic_id, name: a.clinic.name }, type: a.type, provider_id: a.provider_id, step: "time" });
    W.clinic = (await api("GET", `/clinics/${a.clinic_id}`)).clinic;
    CF.go("/book?r=" + a.id);
  });
  on("book-again", async (el) => { W = newWizard(); W.clinic = (await api("GET", `/clinics/${el.dataset.clinic}`)).clinic; W.step = S.members.length ? "who" : "visit"; CF.go("/book?c=" + el.dataset.clinic); });

  // =====================================================================
  // BOOKING WIZARD (progress bar fills up as you go)
  // =====================================================================
  const newWizard = () => ({ step: null, member_id: null, clinic: null, type: null, provider_id: "", reason: "", date: CF.ymd(new Date()), slot: null,
    days: [1, 2, 3, 4, 5], tod: ["am", "pm", "eve"], q: "", reschedule: null });
  let W = newWizard();
  const steps = () => (W.reschedule ? ["time", "confirm"] : [...(S.members.length ? ["who"] : []), "clinic", "visit", "time", "confirm"]);
  route("/book", { title: "book_appointment", roles: ["patient"], render: async (q) => {
    if (q.new) { W = newWizard(); history.replaceState(null, "", "#/book" + (q.c ? "?c=" + q.c : "")); }
    if (!W.step) W.step = steps()[0];
    if (q.c && !W.clinic) { W.clinic = (await api("GET", `/clinics/${q.c}`)).clinic; }
    const st = steps();
    if (!st.includes(W.step)) W.step = st[0];
    const i = st.indexOf(W.step);
    const pct = Math.round((i / st.length) * 100);
    const body = await ({ who: stepWho, clinic: stepClinic, visit: stepVisit, time: stepTime, confirm: stepConfirm }[W.step])();
    return `<section class="page narrow wizard">
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(t("booking_progress"))}">
        <div class="progress-fill" style="width:${pct}%"></div><span class="progress-label">${pct}%</span></div>
      <ol class="wiz-steps">${st.map((s, k) => `<li class="${k < i ? "done" : k === i ? "now" : ""}" ${k === i ? 'aria-current="step"' : ""}>${k < i ? I("check") : `<span>${k + 1}</span>`}<em>${t("step_" + s)}</em></li>`).join("")}</ol>
      ${W.reschedule ? `<div class="notice info">${I("info")} ${t("rescheduling", { when: esc(CF.relDay(W.reschedule.start) + " " + CF.fmtTime(W.reschedule.start)) })}</div>` : ""}
      ${body}
      <div class="row between wiz-nav">${i > 0 ? `<button class="btn ghost" data-act="wiz-back">${I("chevL")} ${t("back")}</button>` : `<a class="btn ghost" href="#/home">${t("cancel")}</a>`}<span class="muted small">${t("step_x_of_y", { x: i + 1, y: st.length })}</span></div>
    </section>`;
  } });
  const next = () => { const st = steps(); W.step = st[Math.min(st.indexOf(W.step) + 1, st.length - 1)]; CF.render(); };
  on("wiz-back", () => { const st = steps(); W.step = st[Math.max(st.indexOf(W.step) - 1, 0)]; CF.render(); });

  async function stepWho() {
    return `<h1>${t("who_for")}</h1><div class="choice-grid">
      ${[{ id: "", label: `${S.user.first_name} ${S.user.last_name}`, sub: t("myself") }, ...S.members.map((m) => ({ id: m.id, label: `${m.first_name} ${m.last_name || ""}`, sub: t("rel_" + (m.relation || "other")) }))].map((p) =>
        `<button class="choice ${String(W.member_id || "") === String(p.id) ? "selected" : ""}" data-act="pick-who" data-id="${p.id}"><span class="avatar">${esc(p.label[0])}</span><b>${esc(p.label)}</b><span class="muted">${esc(p.sub)}</span></button>`).join("")}
      <a class="choice add" href="#/account">${I("plus")}<b>${t("add_family")}</b></a></div>`;
  }
  on("pick-who", (el) => { W.member_id = el.dataset.id ? Number(el.dataset.id) : null; next(); });

  async function stepClinic() {
    const { clinics } = await api("GET", `/clinics?q=${encodeURIComponent(W.q)}`);
    return `<h1>${t("which_clinic")}</h1>
      <div class="search"><label class="sr-only" for="cq">${t("search_clinic")}</label>${I("search")}<input id="cq" type="search" value="${esc(W.q)}" placeholder="${esc(t("search_clinic_ph"))}" data-input="wiz-q" autocomplete="off"/></div>
      <p class="small muted">${t("only_registered")}</p>
      <div class="stack">${clinics.map((c) => `<button class="choice row-choice ${W.clinic?.id === c.id ? "selected" : ""}" data-act="pick-clinic" data-id="${c.id}">
        ${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy"/>` : `<span class="ph">${I("building")}</span>`}
        <span class="grow"><b>${c.saved ? `${I("star", "star-on")} ` : ""}${esc(c.name)}</b><span class="muted">${esc(c.address)} · ${esc(c.city)}</span>
          <span class="row gap wrap">${CF.crowd(c.crowd)}${c.next_available ? `<span class="chip chip-soft" style="--c:#1E8E5A">${t("next_free", { when: esc(CF.relDay(c.next_available) + " " + CF.fmtTime(c.next_available)) })}</span>` : ""}</span></span>
        ${I("chevR")}</button>`).join("") || CF.empty("search", t("no_clinic_found"))}</div>`;
  }
  let qTimer;
  on("wiz-q", (el) => { W.q = el.value; clearTimeout(qTimer); qTimer = setTimeout(async () => { await CF.render({ quiet: true }); const i = document.getElementById("cq"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 300); });
  on("pick-clinic", async (el) => { W.clinic = (await api("GET", `/clinics/${el.dataset.id}`)).clinic; W.type = null; W.provider_id = ""; next(); });

  async function stepVisit() {
    const c = W.clinic;
    return `<h1>${t("what_visit")}</h1><p class="muted">${esc(c.name)}</p>
      <div class="grid2">
        <div class="field"><label for="wprov">${t("provider")}</label><select id="wprov" data-change="wiz-prov"><option value="">${t("any_provider")}</option>
          ${c.providers.map((p) => `<option value="${p.id}" ${String(W.provider_id) === String(p.id) ? "selected" : ""}>${esc(p.name)} — ${esc(p.specialty || "")}</option>`).join("")}</select></div>
        <div class="field"><label for="wreason">${t("reason")} <span class="muted">(${t("optional")})</span></label>
          <input id="wreason" maxlength="140" value="${esc(W.reason)}" data-input="wiz-reason" aria-describedby="wrh" placeholder="${esc(t("reason_ph"))}"/>
          <p class="hint" id="wrh">${I("shield")} ${t("no_medical")}</p></div></div>
      <fieldset><legend class="label">${t("visit_type")}</legend><div class="choice-grid">
        ${c.types.map((ty) => `<button class="choice type ${W.type?.id === ty.id ? "selected" : ""}" style="--c:${esc(ty.color)}" data-act="pick-type" data-id="${ty.id}">
          <span class="type-dot" aria-hidden="true"></span><b>${esc(CF.L(ty, "name"))}</b><span class="muted">${I("clock")} ${t("n_min", { n: ty.minutes })}</span></button>`).join("")}</div></fieldset>`;
  }
  on("wiz-prov", (el) => (W.provider_id = el.value));
  on("wiz-reason", (el) => (W.reason = el.value));
  on("pick-type", (el) => { W.type = W.clinic.types.find((x) => x.id === Number(el.dataset.id)); next(); });

  async function stepTime() {
    const c = W.clinic, ty = W.type;
    const qs = `type=${ty.id}${W.provider_id ? `&provider=${W.provider_id}` : ""}`;
    const { days } = await api("GET", `/clinics/${c.id}/days?days=21&${qs}`);
    const visible = days.filter((d) => W.days.includes(CF.toDate(d.date + " 00:00").getDay()));
    if (!visible.find((d) => d.date === W.date)) W.date = (visible.find((d) => d.count) || visible[0] || days[0]).date;
    const { slots } = await api("GET", `/clinics/${c.id}/slots?date=${W.date}&${qs}`);
    const tod = (s) => { const h = Number(s.start.slice(11, 13)); return h < 12 ? "am" : h < 17 ? "pm" : "eve"; };
    const shown = slots.filter((s) => W.tod.includes(tod(s)));
    const uniq = []; shown.forEach((s) => { if (!uniq.find((u) => u.start === s.start)) uniq.push(s); });
    const avail = (n) => (n === 0 ? "none" : n < 6 ? "few" : "many");
    return `<h1>${t("pick_time")}</h1><p class="muted">${esc(c.name)} · ${esc(CF.L(ty, "name"))} · ${W.provider_id ? esc(c.providers.find((p) => String(p.id) === String(W.provider_id))?.name || "") : t("any_provider")}</p>
      <div class="filters card">
        <fieldset><legend class="label">${t("days_of_week")}</legend><div class="check-pills">${[1, 2, 3, 4, 5, 6].map((d) =>
          `<label class="pill"><input type="checkbox" data-change="wiz-day" value="${d}" ${W.days.includes(d) ? "checked" : ""}/><span>${esc(CF.dayName(d, "short"))}</span></label>`).join("")}</div></fieldset>
        <fieldset><legend class="label">${t("time_of_day")}</legend><div class="check-pills">${["am", "pm", "eve"].map((k) =>
          `<label class="pill"><input type="checkbox" data-change="wiz-tod" value="${k}" ${W.tod.includes(k) ? "checked" : ""}/><span>${t("tod_" + k)}</span></label>`).join("")}</div></fieldset>
      </div>
      <div class="date-strip" role="radiogroup" aria-label="${esc(t("choose_date"))}">${visible.map((d) => `<button role="radio" aria-checked="${d.date === W.date}" class="date-btn avail-${avail(d.count)}" data-act="wiz-date" data-d="${d.date}" ${d.count ? "" : 'aria-disabled="true"'}>
        <span>${esc(CF.fmtDate(d.date, { weekday: "short" }))}</span><b>${CF.toDate(d.date + " 00:00").getDate()}</b><small>${d.count ? t("n_free", { n: d.count }) : t("full")}</small></button>`).join("")}</div>
      <p class="legend small"><span class="lg many"></span>${t("many_slots")} <span class="lg few"></span>${t("few_slots")} <span class="lg none"></span>${t("no_slots")}</p>
      <h2 class="section-title">${esc(CF.fmtDate(W.date))}</h2>
      ${uniq.length ? `<div class="slots" role="list">${uniq.map((s) => `<button class="slot" role="listitem" data-act="pick-slot" data-s="${s.start}" data-p="${s.provider_id}">${esc(CF.fmtTime(s.start))}${W.provider_id ? "" : `<small>${esc(s.provider_name.replace("Dr. ", "Dr "))}</small>`}</button>`).join("")}</div>`
        : `<div class="card">${CF.empty("hourglass", t("day_full"), `<button class="btn primary" data-act="join-wl">${I("hourglass")} ${t("join_waitlist")}</button>`)}</div>`}
      ${uniq.length ? `<p class="small muted">${t("none_fit")} <button class="link" data-act="join-wl">${t("join_waitlist")}</button></p>` : ""}`;
  }
  on("wiz-day", (el) => { const d = Number(el.value); W.days = el.checked ? [...W.days, d] : W.days.filter((x) => x !== d); if (!W.days.length) W.days = [d]; CF.render({ quiet: true }); });
  on("wiz-tod", (el) => { W.tod = el.checked ? [...W.tod, el.value] : W.tod.filter((x) => x !== el.value); if (!W.tod.length) W.tod = [el.value]; CF.render({ quiet: true }); });
  on("wiz-date", (el) => { if (el.getAttribute("aria-disabled") === "true") return; W.date = el.dataset.d; CF.render({ quiet: true }).then(() => document.querySelector(`[data-d="${W.date}"]`)?.focus()); });
  on("pick-slot", (el) => { W.slot = { start: el.dataset.s, provider_id: Number(el.dataset.p) }; next(); });
  on("join-wl", async () => {
    await api("POST", "/waitlist", { clinic_id: W.clinic.id, provider_id: W.provider_id || null, type_id: W.type?.id, date: W.date, member_id: W.member_id });
    CF.toast(t("waitlist_joined")); W = newWizard(); CF.go("/appointments");
  });

  async function stepConfirm() {
    const c = W.clinic, ty = W.type || W.reschedule?.type, prov = c.providers.find((p) => p.id === W.slot.provider_id);
    const who = W.member_id ? S.members.find((m) => m.id === W.member_id) : null;
    const est = (await api("GET", `/clinics/${c.id}/estimate?type=${ty.id}`));
    return `<h1>${t("review_confirm")}</h1>
      <div class="card summary"><dl>
        <div><dt>${I("user")} ${t("patient")}</dt><dd>${esc(who ? `${who.first_name} ${who.last_name || ""}` : `${S.user.first_name} ${S.user.last_name}`)}</dd></div>
        <div><dt>${I("building")} ${t("clinic")}</dt><dd>${esc(c.name)}<br/><span class="muted">${esc(c.address)}</span></dd></div>
        <div><dt>${I("cal")} ${t("when")}</dt><dd><b>${esc(CF.fmtDate(W.slot.start))}</b> · ${esc(CF.fmtTime(W.slot.start))}</dd></div>
        <div><dt>${I("steth")} ${t("provider")}</dt><dd>${esc(prov?.name || "")}</dd></div>
        <div><dt>${I("clock")} ${t("visit_type")}</dt><dd>${CF.typeChip(ty)}</dd></div>
        ${W.reason ? `<div><dt>${I("info")} ${t("reason")}</dt><dd>${esc(W.reason)}</dd></div>` : ""}</dl></div>
      ${W.reschedule ? "" : `<form id="contact-form" data-form="noop" class="card stack"><h2>${t("contact_details")}</h2>
        <div class="grid2">${CF.field("phone", t("phone"), { type: "tel", value: S.user.phone || "", auto: "tel" })}${CF.field("email", t("email"), { type: "email", value: S.user.email, auto: "email" })}</div>
        <fieldset class="field"><legend>${t("notify_me_by")}</legend><div class="radio-cards">${["email", "app"].map((k) =>
          `<label class="radio-card"><input type="radio" name="notify_pref" value="${k}" ${S.user.notify_pref === k ? "checked" : ""}/>${I({ email: "mail", sms: "msg", call: "phone", app: "bell" }[k])}<span>${t("via_" + k)}</span></label>`).join("")}</div></fieldset></form>`}
      <details class="card"><summary><b>${I("clock")} ${t("what_to_expect")}</b></summary>${CF.estimateView({ ...est, doneBy: addMin(W.slot.start, est.total - 10) })}</details>
      <p class="small muted">${t("cancel_policy", { h: c.cancel_hours })}</p>
      <button class="btn primary lg block" data-act="confirm-book">${I("check")} ${W.reschedule ? t("confirm_new_time") : t("confirm_booking")}</button>`;
  }
  const addMin = (s, m) => { const d = new Date(CF.toDate(s).getTime() + m * 60000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  on("confirm-book", async (el) => {
    el.disabled = true;
    try {
      let appt;
      if (W.reschedule) appt = (await api("POST", `/appointments/${W.reschedule.id}/reschedule`, { start: W.slot.start, provider_id: W.slot.provider_id })).appointment;
      else {
        const f = document.getElementById("contact-form");
        const d = CF.formData(f);
        appt = (await api("POST", "/appointments", { clinic_id: W.clinic.id, provider_id: W.slot.provider_id, type_id: W.type.id, start: W.slot.start, member_id: W.member_id, reason: W.reason, phone: d.phone, email: d.email, notify_pref: d.notify_pref }));
        appt = appt.appointment;
      }
      const main = document.getElementById("main");
      main.innerHTML = `<section class="page narrow wizard"><div class="progress done" role="progressbar" aria-valuenow="100" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(t("booking_progress"))}"><div class="progress-fill" style="width:100%"></div><span class="progress-label">100%</span></div>
        <div class="card success-card"><span class="big-check" aria-hidden="true">${I("check")}</span><h1>${W.reschedule ? t("rescheduled_ok") : t("booked_ok")}</h1>
        <p>${esc(appt.clinic.name)} · <b>${esc(CF.fmtDate(appt.start))}</b> · ${esc(CF.fmtTime(appt.start))} · ${esc(appt.provider.name)}</p>
        ${appt.forms.length ? `<a class="notice warn" href="#/todo">${I("todo")} ${t("form_added")}</a>` : ""}
        <div class="row gap wrap center"><a class="btn primary" href="#/appointments">${t("see_my_appointments")}</a><a class="btn ghost" href="${CF.mapsUrl(appt.clinic)}" target="_blank" rel="noopener">${I("nav")} ${t("directions")}</a></div></div></section>`;
      main.focus(); CF.announce(t("booked_ok"));
      W = newWizard();
      CF.loadMe().then(() => CF.renderChrome("/book"));
    } catch (e) {
      el.disabled = false;
      CF.toast(CF.errMsg(e), "err");
      if (e.data?.error === "slot_taken") { W.step = "time"; CF.render(); }
    }
  });

  // =====================================================================
  // FIND CLINICS / SAVED
  // =====================================================================
  let CQ = { q: "", open: false };
  route("/clinics", { title: "nav_clinics", roles: ["patient"], render: async (q) => {
    const saved = q.saved === "1";
    const { clinics } = await api("GET", `/clinics?q=${encodeURIComponent(CQ.q)}${CQ.open ? "&open=1" : ""}${saved ? "&saved=1" : ""}`);
    return `<section class="page">
      <header class="page-head"><h1>${saved ? t("saved_clinics") : t("nav_clinics")}</h1><p class="muted">${t("only_registered")}</p></header>
      <div class="row gap wrap toolbar"><div class="search grow"><label class="sr-only" for="clq">${t("search_clinic")}</label>${I("search")}<input id="clq" type="search" value="${esc(CQ.q)}" placeholder="${esc(t("search_clinic_ph"))}" data-input="cl-q"/></div>
        <label class="pill"><input type="checkbox" data-change="cl-open" ${CQ.open ? "checked" : ""}/><span>${t("open_now")}</span></label>
        <a class="pill ${saved ? "on" : ""}" href="#/clinics${saved ? "" : "?saved=1"}" ${saved ? 'aria-current="page"' : ""}>${I("star")} ${t("saved_only")}</a></div>
      <div class="clinic-grid">${clinics.map((c) => `<article class="card clinic">
        ${c.photo ? `<img src="${esc(c.photo)}" alt="${esc(t("photo_of", { name: c.name }))}" loading="lazy"/>` : `<div class="ph">${I("building")}</div>`}
        <div class="clinic-body"><div class="row between"><h2>${esc(c.name)}</h2>
          <button class="icon-btn star ${c.saved ? "on" : ""}" data-act="save-clinic" data-id="${c.id}" aria-pressed="${c.saved}" aria-label="${esc(c.saved ? t("unsave", { name: c.name }) : t("save_clinic", { name: c.name }))}">${I("star")}</button></div>
          <p class="muted">${I("pin")} ${esc(c.address)}, ${esc(c.city)}</p>
          <div class="row gap wrap">${CF.crowd(c.crowd)}${CF.chip(c.open_now ? t("open_now") : t("closed_now"), c.open_now ? "#1E8E5A" : "#7F8C8D", "chip-soft")}</div>
          <p class="small">${I("steth")} ${c.providers.map((p) => esc(p.name)).join(", ")}</p>
          ${c.next_available ? `<p class="small"><b>${t("next_free", { when: esc(CF.relDay(c.next_available) + " " + CF.fmtTime(c.next_available)) })}</b></p>` : ""}
          <div class="row gap wrap"><button class="btn primary sm" data-act="book-here" data-id="${c.id}">${t("book_here")}</button><button class="btn sm ghost" data-act="clinic-info" data-id="${c.id}">${t("details")}</button></div></div></article>`).join("")
        || `<div class="card">${CF.empty(saved ? "star" : "search", saved ? t("no_saved") : t("no_clinic_found"))}</div>`}</div></section>`;
  } });
  on("cl-q", (el) => { CQ.q = el.value; clearTimeout(qTimer); qTimer = setTimeout(async () => { await CF.render({ quiet: true }); const i = document.getElementById("clq"); i && (i.focus(), i.setSelectionRange(i.value.length, i.value.length)); }, 300); });
  on("cl-open", (el) => { CQ.open = el.checked; CF.render({ quiet: true }); });
  on("save-clinic", async (el) => { const on_ = el.getAttribute("aria-pressed") === "true"; await api(on_ ? "DELETE" : "POST", `/clinics/${el.dataset.id}/save`); CF.toast(on_ ? t("unsaved_ok") : t("saved_ok")); CF.refresh(); });
  on("book-here", async (el) => { W = newWizard(); W.clinic = (await api("GET", `/clinics/${el.dataset.id}`)).clinic; W.step = S.members.length ? "who" : "visit"; CF.closeModal(); CF.go("/book?c=" + el.dataset.id); });
  on("clinic-info", async (el) => {
    const { clinic: c } = await api("GET", `/clinics/${el.dataset.id}`);
    CF.modal(esc(c.name), `${c.photo ? `<img class="modal-img" src="${esc(c.photo)}" alt=""/>` : ""}
      <p>${esc(CF.L(c, "description"))}</p>
      <div class="row gap wrap"><a class="btn sm" href="tel:${esc(c.phone)}">${I("phone")} ${esc(c.phone)}</a><a class="btn sm ghost" href="mailto:${esc(c.email)}">${I("mail")} ${t("email")}</a>
        <a class="btn sm ghost" href="${CF.mapsUrl(c)}" target="_blank" rel="noopener">${I("nav")} ${t("directions")}</a></div>
      <h3>${t("right_now")}</h3>${c.estimate.open ? CF.estimateView(c.estimate) : `<p class="muted">${t("closed_now")}</p>`}
      <h3>${t("hours")}</h3><table class="hours"><tbody>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<tr ${new Date().getDay() === d ? 'class="today"' : ""}><th scope="row">${esc(CF.dayName(d))}</th><td>${c.hours[d] ? `${esc(CF.fmtTime(c.hours[d][0]))} – ${esc(CF.fmtTime(c.hours[d][1]))}` : t("closed")}</td></tr>`).join("")}</tbody></table>
      <h3>${t("practitioners")}</h3><ul class="plain-list">${c.providers.map((p) => `<li><b>${esc(p.name)}</b> · ${esc(p.specialty || "")}<br/><span class="small muted">${I("globe")} ${esc(p.languages || "")} · ${p.avail.map((a) => esc(CF.dayName(a.weekday, "short"))).join(", ")}</span></li>`).join("")}</ul>
      <button class="btn primary block" data-act="book-here" data-id="${c.id}">${t("book_here")}</button>`, { side: true });
  });

  // =====================================================================
  // TO-DO (pre-visit forms)
  // =====================================================================
  route("/todo", { title: "nav_todo", roles: ["patient"], live: true, render: async () => {
    const { forms } = await api("GET", "/my/forms");
    const col = { todo: "#E0A100", returned: "#C0392B", submitted: "#2F80ED", accepted: "#27AE60" };
    return `<section class="page narrow"><header class="page-head"><h1>${t("nav_todo")}</h1><p class="muted">${t("todo_sub")}</p></header>
      ${forms.map((f) => `<details class="card form-card" ${["todo", "returned"].includes(f.status) ? "open" : ""}>
        <summary><span class="grow"><b>${esc(CF.L(f, "title"))}</b><span class="muted small">${esc(f.clinic_name)} · ${esc(f.patient_name)} · ${t("before", { date: esc(CF.relDay(f.start)) })}</span></span>${CF.chip(t("fs_" + f.status), col[f.status])}</summary>
        ${f.status === "returned" ? `<div class="notice err">${I("alert")}<div><b>${t("clinic_note")}</b> ${esc(f.staff_note || "")}</div></div>` : ""}
        <form data-form="save-form" data-id="${f.id}" class="stack">
          ${f.fields.map((q) => CF.field(q.id, esc(S.lang === "fr" ? q.fr : q.en), { value: f.answers[q.id] || "", attrs: f.status === "accepted" ? "readonly" : "" })).join("")}
          <p class="small muted">${I("shield")} ${t("form_privacy")}</p>
          ${f.status !== "accepted" ? `<div class="row gap"><button class="btn ghost" type="submit" name="draft" value="1">${t("save_draft")}</button><button class="btn primary" type="button" data-act="submit-form" data-id="${f.id}">${t("send_to_clinic")}</button></div>` : ""}
        </form></details>`).join("") || `<div class="card">${CF.empty("check", t("nothing_todo"))}</div>`}</section>`;
  } });
  const formAnswers = (id) => { const f = document.querySelector(`form[data-id="${id}"]`); const d = CF.formData(f); delete d.draft; return d; };
  onForm("save-form", async (d, f) => { delete d.draft; await api("PUT", `/forms/${f.dataset.id}`, { answers: d }); CF.toast(t("draft_saved")); });
  on("submit-form", async (el) => { await api("PUT", `/forms/${el.dataset.id}`, { answers: formAnswers(el.dataset.id), submit: true }); CF.toast(t("form_sent")); await CF.loadMe(); CF.refresh(); });

  // =====================================================================
  // MESSAGES (patient ↔ clinic)
  // =====================================================================
  let MC = null;
  route("/messages", { title: "nav_messages", roles: ["patient"], live: true, render: async () => {
    const { messages, clinics } = await api("GET", "/my/messages");
    S.unread.messages = 0;
    if (!MC || !clinics.find((c) => c.id === MC)) MC = (messages[messages.length - 1] || {}).clinic_id || clinics[0]?.id;
    const thread = messages.filter((m) => m.clinic_id === MC);
    return `<section class="page narrow"><header class="page-head"><h1>${t("nav_messages")}</h1></header>
      ${clinics.length ? `<div class="field"><label for="mc">${t("clinic")}</label><select id="mc" data-change="msg-clinic">${clinics.map((c) => `<option value="${c.id}" ${c.id === MC ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="card chat" aria-live="polite">${thread.map((m) => `<div class="bubble ${m.sender === "patient" ? "me" : m.sender}"><span class="who">${m.sender === "patient" ? t("you") : m.sender === "assistant" ? "Clio" : esc(m.clinic_name)}</span><p>${esc(m.body).replace(/\n/g, "<br/>")}</p><time>${esc(CF.fmtShort(m.created_at))} ${esc(CF.fmtTime(m.created_at))}</time></div>`).join("") || `<p class="muted center">${t("no_messages")}</p>`}</div>
      <form data-form="send-msg" class="row gap compose"><label class="sr-only" for="mbody">${t("message")}</label><textarea id="mbody" name="body" rows="2" required placeholder="${esc(t("write_message"))}"></textarea><button class="btn primary" type="submit" aria-label="${esc(t("send"))}">${I("send")}</button></form>
      <p class="small muted">${I("shield")} ${t("msg_privacy")}</p>` : `<div class="card">${CF.empty("msg", t("no_clinics_msg"))}</div>`}</section>`;
  }, after: () => { const c = document.querySelector(".chat"); if (c) c.scrollTop = c.scrollHeight; } });
  on("msg-clinic", (el) => { MC = Number(el.value); CF.refresh(); });
  onForm("send-msg", async (d) => { await api("POST", "/my/messages", { clinic_id: MC, body: d.body }); CF.refresh(); });

  // =====================================================================
  // ACCOUNT (everyone)
  // =====================================================================
  route("/account", { title: "nav_account", roles: ["patient", "staff", "admin"], render: async () => {
    await CF.loadMe();
    const u = S.user;
    const ver = (ok) => ok ? `<span class="chip chip-soft" style="--c:#1E8E5A">${I("check")} ${t("verified")}</span>` : `<span class="chip chip-soft" style="--c:#B7791F">${t("not_verified")}</span>`;
    return `<section class="page narrow"><header class="page-head"><h1>${t("nav_account")}</h1></header>
      <form data-form="profile" class="card stack"><h2>${t("profile")}</h2>
        <div class="grid2">${CF.field("first_name", t("first_name"), { value: u.first_name, auto: "given-name" })}${CF.field("last_name", t("last_name"), { value: u.last_name, auto: "family-name" })}</div>
        <div class="field"><label>${t("email")}</label><div class="row gap wrap"><span>${esc(u.email)}</span>${ver(u.email_verified)}${u.email_verified ? "" : `<button type="button" class="btn sm ghost" data-act="verify-contact" data-c="email">${t("verify")}</button>`}</div></div>
        ${CF.field("phone", t("phone"), { type: "tel", value: u.phone || "", auto: "tel", hint: t("phone_hint") })}
        ${u.role === "patient" ? `<fieldset class="field"><legend>${t("notify_me_by")}</legend><div class="radio-cards">${["email", "app"].map((k) =>
          `<label class="radio-card"><input type="radio" name="notify_pref" value="${k}" ${u.notify_pref === k ? "checked" : ""}/>${I({ email: "mail", sms: "msg", call: "phone", app: "bell" }[k])}<span>${t("via_" + k)}</span></label>`).join("")}</div></fieldset>` : ""}
        <button class="btn primary" type="submit">${t("save")}</button></form>

      <form data-form="security" class="card stack"><h2>${I("shield")} ${t("security")}</h2>
        <fieldset class="field"><legend>${t("two_step")}</legend><p class="hint">${t("two_step_d")}</p><div class="radio-cards">${["none", "email"].map((k) =>
          `<label class="radio-card"><input type="radio" name="twofa" value="${k}" ${u.twofa === k ? "checked" : ""}/>${I({ none: "x", email: "mail", sms: "msg", call: "phone" }[k])}<span>${t(k === "none" ? "off" : "via_" + k)}</span></label>`).join("")}</div></fieldset>
        ${u.role === "patient" ? `<div class="field"><label for="apin">${t("account_password")}</label><p class="hint">${t("account_password_d")}</p>
          <input id="apin" name="account_pin" type="password" inputmode="numeric" autocomplete="new-password" placeholder="${u.has_pin ? "••••" : t("not_set")}"/>
          ${u.has_pin ? `<button type="button" class="link small" data-act="remove-pin">${t("remove_account_password")}</button>` : ""}</div>` : ""}
        <button class="btn primary" type="submit">${t("save")}</button></form>

      ${u.role === "patient" ? `<section class="card stack"><h2>${I("users")} ${t("family")}</h2><p class="hint">${t("family_d")}</p>
        <ul class="plain-list">${S.members.map((m) => `<li class="row between"><span><b>${esc(m.first_name)} ${esc(m.last_name || "")}</b> · ${t("rel_" + (m.relation || "other"))}</span>
          <button class="btn sm ghost danger-text" data-act="del-member" data-id="${m.id}" aria-label="${esc(t("remove") + " " + m.first_name)}">${I("trash")}</button></li>`).join("") || `<li class="muted">${t("no_family")}</li>`}</ul>
        <form data-form="add-member" class="row gap wrap end">${CF.field("first_name", t("first_name"), { required: true })}${CF.field("last_name", t("last_name"))}
          <div class="field"><label for="rel">${t("relation")}</label><select id="rel" name="relation">${["child", "partner", "parent", "sibling", "other"].map((r) => `<option value="${r}">${t("rel_" + r)}</option>`).join("")}</select></div>
          <button class="btn" type="submit">${I("plus")} ${t("add")}</button></form></section>` : ""}
      <section class="card stack"><h2>${I("lock")} ${t("privacy_data")}</h2>
        <p class="hint">${t("privacy_data_d")}</p>
        <p class="small">${u.consent_at ? t("consent_on_file", { date: esc(CF.fmtDate(u.consent_at.slice(0, 10), { year: "numeric", month: "long", day: "numeric" })), v: esc(u.consent_version || "") }) : ""}</p>
        <div class="row gap wrap"><button class="btn" data-act="export-data">${I("todo")} ${t("download_data")}</button><button class="btn ghost" data-act="cookie-settings">${I("settings")} ${t("cookie_settings")}</button></div>
        <p class="small">${["terms", "privacy", "cookies", "accessibility"].map(CF.docLink).join(" · ")}</p></section>
      ${u.role === "patient" ? `<section class="card stack danger-zone"><h2>${I("trash")} ${t("delete_account")}</h2><p class="hint">${t("delete_account_d")}</p>
        <button class="btn danger" data-act="delete-account">${t("delete_account")}</button></section>` : `<p class="small muted">${t("staff_delete_note")}</p>`}
      <section class="card stack"><h2>${I("globe")} ${t("language")}</h2><div class="seg-ctrl" role="radiogroup" aria-label="${esc(t("language"))}">
        <button role="radio" aria-checked="${S.lang === "en"}" data-act="${S.lang === "en" ? "" : "lang"}" lang="en">English</button><button role="radio" aria-checked="${S.lang === "fr"}" data-act="${S.lang === "fr" ? "" : "lang"}" lang="fr">Français</button></div></section>
    </section>`;
  } });
  CF.onForm("noop", () => {});
  on("export-data", async () => {
    const data = await api("GET", "/me/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `clinicflow-my-data-${CF.ymd(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    CF.toast(t("data_downloaded"));
  });
  on("delete-account", () => {
    CF.modal(t("delete_account"), `<p>${t("delete_confirm_text")}</p>
      <form data-form="delete-account" class="stack">${CF.field("password", t("password"), { type: "password", required: true, auto: "current-password" })}
        <label class="check-row"><input type="checkbox" name="sure" required/> <span>${t("delete_check")}</span></label>
        <div class="row end gap"><button type="button" class="btn ghost" data-act="modal-close">${t("go_back")}</button><button class="btn danger" type="submit">${t("delete_forever")}</button></div></form>`);
  });
  onForm("delete-account", async (d) => {
    await api("POST", "/me/delete", { password: d.password });
    CF.closeModal();
    CF.state.token = null; CF.state.user = null; CF.store.del("token");
    CF.toast(t("account_deleted"), "ok", 6000);
    CF.go("/login");
  });
  onForm("profile", async (d) => { await api("PATCH", "/me", d); await CF.loadMe(); CF.toast(t("saved")); CF.refresh(); });
  onForm("security", async (d) => { const body = { twofa: d.twofa }; if (d.account_pin) body.account_pin = d.account_pin; await api("PATCH", "/me", body); CF.toast(t("saved")); CF.refresh(); });
  on("remove-pin", async () => { await api("PATCH", "/me", { account_pin: "" }); CF.toast(t("saved")); CF.refresh(); });
  onForm("add-member", async (d) => { await api("POST", "/me/members", d); await CF.loadMe(); CF.toast(t("saved")); CF.refresh(); });
  on("del-member", async (el) => { if (await CF.confirm(t("remove_member_q"), { danger: true, ok: t("remove") })) { await api("DELETE", `/me/members/${el.dataset.id}`); await CF.loadMe(); CF.refresh(); } });
  on("verify-contact", async (el) => {
    const channel = el.dataset.c;
    try {
      const r = await api("POST", "/me/verify-contact", { channel });
      const m = CF.modal(t("verify_identity"), `<p>${t("code_sent_to", { to: esc(r.sent_to), via: t("via_" + channel) })}</p>
        ${r.demoCode ? `<div class="notice info">${I("info")}<div><b>${t("demo_mode")}</b> ${t("demo_code", { code: `<b class="code">${r.demoCode}</b>` })}</div></div>` : ""}
        <form data-form="verify-contact" data-c="${channel}" class="stack">${CF.field("code", t("code_6"), { required: true, attrs: 'inputmode="numeric" maxlength="6" autocomplete="one-time-code"' })}<button class="btn primary" type="submit">${t("verify")}</button></form>`);
    } catch (e) { CF.toast(CF.errMsg(e), "err"); }
  });
  onForm("verify-contact", async (d, f) => { await api("POST", "/me/verify-contact/confirm", { channel: f.dataset.c === "email" ? "email" : "phone", code: d.code }); CF.closeModal(); CF.toast(t("verified")); CF.refresh(); });

  CF.resetWizard = () => (W = newWizard());
})();
