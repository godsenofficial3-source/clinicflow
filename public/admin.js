/* ClinicFlow – clinic administration dashboard (clinic manager settings). */
(function () {
  const { t, esc, icon: I, api, on, onForm, route, state: S } = CF;
  const TABS = [["insights", "chart"], ["clinic", "building"], ["providers", "steth"], ["staff", "users"], ["rules", "settings"], ["statuses", "queue"], ["templates", "mail"], ["outbox", "send"], ["audit", "shield"]];

  route("/admin", { title: "nav_admin", roles: ["admin"], render: async (q) => {
    const tab = TABS.find((x) => x[0] === q.tab) ? q.tab : "insights";
    const M = await CF.meta(true);
    const body = await { insights, clinic, providers, staff, rules, statuses, templates, outbox, audit }[tab](M);
    return `<section class="page wide"><header class="page-head"><h1>${t("nav_admin")}</h1><p class="muted">${esc(M.clinic.name)}</p></header>
      <div class="tabs" role="tablist" aria-label="${esc(t("nav_admin"))}">${TABS.map(([k, ic]) => `<a role="tab" href="#/admin?tab=${k}" aria-selected="${k === tab}" class="${k === tab ? "active" : ""}">${I(ic)} ${t("adm_" + k)}</a>`).join("")}</div>
      <div role="tabpanel">${body}</div></section>`;
  } });
  const reload = () => CF.refresh();

  // ---------- insights ----------
  async function insights(M) {
    const s = await api("GET", "/admin/stats");
    const pct = (n) => (s.total ? Math.round((n / s.total) * 100) : 0);
    const bar = (label, n, color) => `<div class="hbar"><span>${label}</span><div><i style="width:${pct(n)}%;background:${color}"></i></div><b>${n} (${pct(n)}%)</b></div>`;
    return `<div class="kpis">
      <div class="kpi" style="--c:#0E6F66"><b>${s.total}</b><span>${t("bookings_30d")}</span></div>
      <div class="kpi" style="--c:#2F80ED"><b>${pct(s.online)}%</b><span>${t("booked_online")}</span></div>
      <div class="kpi" style="--c:#E0A100"><b>${s.avg_wait} min</b><span>${t("avg_wait_room")}</span></div>
      <div class="kpi" style="--c:#8E44AD"><b>${s.waitlist_filled}</b><span>${t("filled_from_waitlist")}</span></div>
      <div class="kpi" style="--c:#C0392B"><b>${s.cancelled}</b><span>${t("cancellations")}</span></div></div>
      <div class="card stack"><h2>${t("how_patients_book")}</h2>${bar(t("src_online"), s.online, "#2F80ED")}${bar(t("src_phone"), s.phone, "#E0A100")}${bar(t("src_in_person"), s.in_person, "#8E44AD")}</div>
      <div class="card"><h2>${t("setup_checklist")}</h2><ul class="checklist">
        ${[[M.providers.length > 0, "providers", "chk_providers"], [!!M.clinic.photo, "clinic", "chk_photo"], [M.clinic.accepting_online, "clinic", "chk_online"], [true, "staff", "chk_staff"], [true, "templates", "chk_templates"]]
          .map(([ok, tab, k]) => `<li class="${ok ? "ok" : ""}">${I(ok ? "check" : "info")} <a href="#/admin?tab=${tab}">${t(k)}</a></li>`).join("")}</ul></div>`;
  }

  // ---------- clinic page ----------
  async function clinic(M) {
    const c = M.clinic;
    return `<form data-form="adm-clinic" class="card stack">
      <h2>${t("clinic_page")}</h2><p class="hint">${t("clinic_page_d")}</p>
      <div class="grid2">${CF.field("name", t("clinic_name"), { value: c.name, required: true })}${CF.field("phone", t("clinic_phone"), { type: "tel", value: c.phone })}</div>
      <div class="grid2">${CF.field("address", t("address"), { value: c.address })}${CF.field("city", t("city"), { value: c.city })}</div>
      <div class="grid2">${CF.field("postal", t("postal"), { value: c.postal })}${CF.field("email", t("email"), { type: "email", value: c.email })}</div>
      ${CF.field("photo", t("photo_url"), { type: "url", value: c.photo || "", hint: t("photo_url_hint") })}
      <div class="grid2"><div class="field"><label for="den">${t("description")} (EN)</label><textarea id="den" name="description_en" rows="3">${esc(c.description_en || "")}</textarea></div>
        <div class="field"><label for="dfr">${t("description")} (FR)</label><textarea id="dfr" name="description_fr" rows="3" lang="fr">${esc(c.description_fr || "")}</textarea></div></div>
      <fieldset><legend class="label">${t("hours")}</legend><div class="hours-edit">${[1, 2, 3, 4, 5, 6, 0].map((d) => { const h = c.hours[d]; return `<div class="row gap wrap">
        <label class="pill"><input type="checkbox" name="open_${d}" ${h ? "checked" : ""}/><span>${esc(CF.dayName(d))}</span></label>
        <label class="sr-only" for="o${d}">${t("opens")}</label><input id="o${d}" type="time" name="from_${d}" value="${h ? h[0] : "09:00"}"/> – <label class="sr-only" for="c${d}">${t("closes")}</label><input id="c${d}" type="time" name="to_${d}" value="${h ? h[1] : "17:00"}"/></div>`; }).join("")}</div></fieldset>
      <div class="switch-row"><div><b id="lbl_online">${t("accept_online")}</b><p class="muted">${t("accept_online_d")}</p></div><label class="pill"><input type="checkbox" name="accepting_online" ${c.accepting_online ? "checked" : ""} aria-labelledby="lbl_online"/><span>${t("on")}</span></label></div>
      <button class="btn primary" type="submit">${t("save")}</button></form>`;
  }
  onForm("adm-clinic", async (d) => {
    const hours = {};
    [0, 1, 2, 3, 4, 5, 6].forEach((x) => { if (d["open_" + x]) hours[x] = [d["from_" + x], d["to_" + x]]; });
    await api("PATCH", "/admin/clinic", { ...d, hours, accepting_online: !!d.accepting_online });
    CF.toast(t("saved")); reload();
  });

  // ---------- providers, availability & schedule blocks ----------
  async function providers(M) {
    return `<div class="stack">${M.providers.map((p) => `<details class="card" ${M.providers.length < 4 ? "" : ""}><summary class="row between"><span><b>${esc(p.name)}</b> · ${esc(p.specialty || "")} ${p.active ? "" : CF.chip(t("inactive"), "#7F8C8D")}</span>
        <span class="small muted">${p.avail.map((a) => esc(CF.dayName(a.weekday, "short"))).join(" ")}</span></summary>
      <form data-form="adm-avail" data-id="${p.id}" class="stack"><h3>${t("availability")}</h3>
        ${[1, 2, 3, 4, 5, 6, 0].map((d) => { const a = p.avail.find((x) => x.weekday === d); return `<div class="row gap wrap"><label class="pill"><input type="checkbox" name="on_${d}" ${a ? "checked" : ""}/><span>${esc(CF.dayName(d))}</span></label>
          <input type="time" name="s_${d}" value="${a ? a.start : "09:00"}" aria-label="${esc(CF.dayName(d) + " " + t("from"))}"/> – <input type="time" name="e_${d}" value="${a ? a.end : "17:00"}" aria-label="${esc(CF.dayName(d) + " " + t("to"))}"/></div>`; }).join("")}
        <button class="btn sm primary" type="submit">${t("save_availability")}</button></form>
      <form data-form="adm-prov" data-id="${p.id}" class="stack"><h3>${t("profile")}</h3>
        <div class="grid2">${CF.field("name", t("full_name"), { value: p.name })}${CF.field("specialty", t("specialty"), { value: p.specialty || "" })}</div>
        <div class="grid2">${CF.field("title", t("title_cred"), { value: p.title || "" })}${CF.field("languages", t("languages"), { value: p.languages || "" })}</div>
        <label class="pill"><input type="checkbox" name="active" ${p.active ? "checked" : ""}/><span>${t("active_bookable")}</span></label>
        <button class="btn sm" type="submit">${t("save")}</button></form></details>`).join("")}
      <form data-form="adm-new-prov" class="card row gap wrap end"><h2 class="grow-full">${I("plus")} ${t("add_provider")}</h2>${CF.field("name", t("full_name"), { required: true })}${CF.field("specialty", t("specialty"))}<button class="btn primary" type="submit">${t("add")}</button></form>
      <section class="card stack"><h2>${t("schedule_blocks")}</h2><p class="hint">${t("schedule_blocks_d")}</p>
        <ul class="plain-list">${M.blocks.map((b) => `<li class="row between"><span><b>${esc(b.provider_name)}</b> · ${esc(CF.fmtShort(b.date))} ${esc(CF.fmtTime(b.start))}–${esc(CF.fmtTime(b.end))} · ${esc(b.reason || "")}</span><button class="btn sm ghost danger-text" data-act="del-block" data-id="${b.id}" aria-label="${esc(t("remove"))}">${I("trash")}</button></li>`).join("") || `<li class="muted">${t("none")}</li>`}</ul>
        <form data-form="adm-block" class="row gap wrap end"><div class="field"><label for="bkp">${t("provider")}</label><select id="bkp" name="provider_id">${M.providers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
          ${CF.field("date", t("date"), { type: "date", required: true, value: CF.ymd(new Date()) })}${CF.field("start", t("from"), { type: "time", value: "12:00", required: true })}${CF.field("end", t("to"), { type: "time", value: "13:00", required: true })}${CF.field("reason", t("block_reason"))}
          <button class="btn" type="submit">${I("plus")} ${t("block_time")}</button></form></section></div>`;
  }
  onForm("adm-avail", async (d, f) => {
    const availability = [0, 1, 2, 3, 4, 5, 6].filter((x) => d["on_" + x]).map((x) => ({ weekday: x, start: d["s_" + x], end: d["e_" + x] }));
    await api("PUT", `/admin/providers/${f.dataset.id}/availability`, { availability }); CF.toast(t("saved")); reload();
  });
  onForm("adm-prov", async (d, f) => { await api("PATCH", `/admin/providers/${f.dataset.id}`, { ...d, active: !!d.active }); CF.toast(t("saved")); reload(); });
  onForm("adm-new-prov", async (d) => { await api("POST", "/admin/providers", d); CF.toast(t("provider_added")); reload(); });
  onForm("adm-block", async (d) => { await api("POST", "/admin/blocks", d); CF.toast(t("saved")); reload(); });
  on("del-block", async (el) => { await api("DELETE", `/admin/blocks/${el.dataset.id}`); reload(); });

  // ---------- staff & roles ----------
  async function staff() {
    const { staff } = await api("GET", "/admin/staff");
    const roles = ["reception", "nurse", "admin"];
    return `<div class="card"><h2>${t("staff_roles")}</h2><p class="hint">${t("staff_roles_d")}</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>${t("full_name")}</th><th>${t("email")}</th><th>${t("role")}</th><th><span class="sr-only">${t("actions")}</span></th></tr></thead><tbody>
      ${staff.map((u) => `<tr><td><b>${esc(u.first_name)} ${esc(u.last_name)}</b>${u.id === S.user.id ? ` <span class="muted small">(${t("you")})</span>` : ""}</td><td>${esc(u.email)}</td>
        <td><label class="sr-only" for="r${u.id}">${t("role")}</label><select id="r${u.id}" data-change="set-role" data-id="${u.id}" ${u.id === S.user.id ? "disabled" : ""}>${roles.map((r) => `<option value="${r}" ${u.staff_role === r ? "selected" : ""}>${t("role_" + r)}</option>`).join("")}</select></td>
        <td>${u.id === S.user.id ? "" : `<button class="btn sm ghost danger-text" data-act="del-staff" data-id="${u.id}" aria-label="${esc(t("remove") + " " + u.first_name)}">${I("trash")}</button>`}</td></tr>`).join("")}</tbody></table></div>
      <dl class="role-help">${roles.map((r) => `<div><dt>${t("role_" + r)}</dt><dd>${t("role_" + r + "_d")}</dd></div>`).join("")}</dl></div>
      <form data-form="adm-staff" class="card stack"><h2>${I("plus")} ${t("add_staff")}</h2>
        <div class="grid2">${CF.field("first_name", t("first_name"), { required: true })}${CF.field("last_name", t("last_name"))}</div>
        <div class="grid2">${CF.field("email", t("email"), { type: "email", required: true, auto: "off" })}${CF.field("password", t("temp_password"), { type: "text", required: true, attrs: 'minlength="8"', hint: t("temp_password_hint") })}</div>
        <div class="field"><label for="nsr">${t("role")}</label><select id="nsr" name="staff_role">${roles.map((r) => `<option value="${r}">${t("role_" + r)}</option>`).join("")}</select></div>
        <button class="btn primary" type="submit">${t("add_staff")}</button></form>`;
  }
  on("set-role", async (el) => { await api("PATCH", `/admin/staff/${el.dataset.id}`, { staff_role: el.value }); CF.toast(t("saved")); });
  on("del-staff", async (el) => { if (await CF.confirm(t("remove_staff_q"), { danger: true, ok: t("remove") })) { await api("DELETE", `/admin/staff/${el.dataset.id}`); reload(); } });
  onForm("adm-staff", async (d) => { await api("POST", "/admin/staff", d); CF.toast(t("staff_added")); reload(); });

  // ---------- booking rules & visit types ----------
  async function rules(M) {
    return `<form data-form="adm-rules" class="card stack"><h2>${t("booking_rules")}</h2>
      <div class="grid2">${CF.field("cancel_hours", t("cancel_limit"), { type: "number", value: M.clinic.cancel_hours, attrs: 'min="0" max="168"', hint: t("cancel_limit_hint") })}
        ${CF.field("slot_minutes", t("slot_step"), { type: "number", value: M.clinic.slot_minutes, attrs: 'min="5" max="60" step="5"', hint: t("slot_step_hint") })}</div>
      <button class="btn primary" type="submit">${t("save")}</button></form>
      <div class="card stack"><h2>${t("visit_types")}</h2><p class="hint">${t("visit_types_d")}</p>
        ${M.types.map((ty) => `<form data-form="adm-type" data-id="${ty.id}" class="row gap wrap end type-row" style="--c:${esc(ty.color)}">
          ${CF.field("name_en", t("name") + " (EN)", { value: ty.name_en })}${CF.field("name_fr", t("name") + " (FR)", { value: ty.name_fr })}
          ${CF.field("minutes", t("minutes"), { type: "number", value: ty.minutes, attrs: 'min="5" max="240" step="5"' })}
          <div class="field"><label for="tc${ty.id}">${t("colour")}</label><input id="tc${ty.id}" type="color" name="color" value="${esc(ty.color)}"/></div>
          <button class="btn sm" type="submit">${t("save")}</button><button type="button" class="btn sm ghost danger-text" data-act="del-type" data-id="${ty.id}" aria-label="${esc(t("remove"))}">${I("trash")}</button></form>`).join("")}
        <form data-form="adm-new-type" class="row gap wrap end">${CF.field("name_en", t("name") + " (EN)", { required: true })}${CF.field("name_fr", t("name") + " (FR)")}${CF.field("minutes", t("minutes"), { type: "number", value: 15 })}
          <div class="field"><label for="ntc">${t("colour")}</label><input id="ntc" type="color" name="color" value="#16A085"/></div><button class="btn" type="submit">${I("plus")} ${t("add")}</button></form></div>`;
  }
  onForm("adm-rules", async (d) => { await api("PATCH", "/admin/clinic", d); CF.toast(t("saved")); reload(); });
  onForm("adm-type", async (d, f) => { await api("PATCH", `/admin/types/${f.dataset.id}`, d); CF.toast(t("saved")); reload(); });
  onForm("adm-new-type", async (d) => { await api("POST", "/admin/types", d); CF.toast(t("saved")); reload(); });
  on("del-type", async (el) => { try { await api("DELETE", `/admin/types/${el.dataset.id}`); reload(); } catch (e) { CF.toast(CF.errMsg(e), "err"); } });

  // ---------- custom statuses ----------
  async function statuses(M) {
    return `<div class="card stack"><h2>${t("patient_statuses")}</h2><p class="hint">${t("patient_statuses_d")}</p>
      ${M.statuses.map((s) => `<form data-form="adm-status" data-id="${s.id}" class="row gap wrap end">
        <span class="chip" style="--c:${esc(s.color)}"><span class="dot"></span>${esc(CF.L(s, "label"))}</span>
        ${CF.field("label_en", "EN", { value: s.label_en })}${CF.field("label_fr", "FR", { value: s.label_fr })}
        ${CF.field("sort", t("order"), { type: "number", value: s.sort, attrs: 'min="1" max="99" style="width:5rem"' })}
        <div class="field"><label for="sc${s.id}">${t("colour")}</label><input id="sc${s.id}" type="color" name="color" value="${esc(s.color)}"/></div>
        <button class="btn sm" type="submit">${t("save")}</button>${s.system ? `<span class="small muted">${t("built_in")}</span>` : `<button type="button" class="btn sm ghost danger-text" data-act="del-status" data-id="${s.id}" aria-label="${esc(t("remove"))}">${I("trash")}</button>`}</form>`).join("")}
      <form data-form="adm-new-status" class="row gap wrap end"><h3 class="grow-full">${I("plus")} ${t("add_status")}</h3>${CF.field("label_en", "EN", { required: true, hint: t("status_example") })}${CF.field("label_fr", "FR")}
        <div class="field"><label for="nsc">${t("colour")}</label><input id="nsc" type="color" name="color" value="#16A085"/></div><button class="btn" type="submit">${t("add")}</button></form></div>`;
  }
  onForm("adm-status", async (d, f) => { await api("PATCH", `/admin/statuses/${f.dataset.id}`, d); CF.toast(t("saved")); reload(); });
  onForm("adm-new-status", async (d) => { try { await api("POST", "/admin/statuses", d); CF.toast(t("saved")); reload(); } catch (e) { CF.toast(CF.errMsg(e), "err"); } });
  on("del-status", async (el) => { try { await api("DELETE", `/admin/statuses/${el.dataset.id}`); reload(); } catch (e) { CF.toast(CF.errMsg(e), "err"); } });

  // ---------- message & form templates ----------
  async function templates(M) {
    const ft = M.form_templates[0];
    return `<div class="card stack"><h2>${t("message_templates")}</h2><p class="hint">${t("message_templates_d")}</p>
      ${M.templates.map((x) => `<form data-form="adm-tpl" data-k="${x.key}" class="stack tpl"><h3>${t("tpl_" + x.key)}</h3>
        <div class="grid2"><div class="field"><label for="te${x.key}">English</label><textarea id="te${x.key}" name="body_en" rows="2">${esc(x.body_en)}</textarea></div>
        <div class="field"><label for="tf${x.key}">Français</label><textarea id="tf${x.key}" name="body_fr" rows="2" lang="fr">${esc(x.body_fr)}</textarea></div></div>
        <button class="btn sm" type="submit">${t("save")}</button></form>`).join("")}</div>
      ${ft ? `<form data-form="adm-form-tpl" data-id="${ft.id}" class="card stack"><h2>${t("previsit_form")}</h2><p class="hint">${t("previsit_form_d")}</p>
        <div class="grid2">${CF.field("title_en", t("title") + " (EN)", { value: ft.title_en })}${CF.field("title_fr", t("title") + " (FR)", { value: ft.title_fr })}</div>
        ${[...JSON.parse(ft.fields), {}, {}].map((q, i) => `<div class="grid2">${CF.field("q_en_" + i, `${t("question")} ${i + 1} (EN)`, { value: q.en || "" })}${CF.field("q_fr_" + i, `${t("question")} ${i + 1} (FR)`, { value: q.fr || "" })}</div>`).join("")}
        <p class="small muted">${I("shield")} ${t("form_privacy_admin")}</p><button class="btn primary" type="submit">${t("save")}</button></form>` : ""}`;
  }
  onForm("adm-tpl", async (d, f) => { await api("PUT", `/admin/templates/${f.dataset.k}`, d); CF.toast(t("saved")); });
  onForm("adm-form-tpl", async (d, f) => {
    const fields = []; for (let i = 0; i < 20; i++) if (d["q_en_" + i]) fields.push({ id: "q" + (i + 1), en: d["q_en_" + i], fr: d["q_fr_" + i] });
    await api("PUT", `/admin/form-templates/${f.dataset.id}`, { title_en: d.title_en, title_fr: d.title_fr, fields }); CF.toast(t("saved")); reload();
  });

  // ---------- access log (who opened or changed which appointment record) ----------
  async function audit() {
    const { audit, agreement } = await api("GET", "/admin/audit");
    return `<div class="card"><h2>${t("access_log")}</h2><p class="hint">${t("access_log_d")}</p>
      ${agreement ? `<p class="small">${I("check")} ${t("clinic_agreement_on_file", { date: esc(CF.fmtDate(agreement.slice(0, 10), { year: "numeric", month: "long", day: "numeric" })) })}</p>` : ""}
      <div class="table-wrap"><table class="table"><thead><tr><th>${t("when")}</th><th>${t("staff_member")}</th><th>${t("action")}</th><th>${t("patient")}</th></tr></thead><tbody>
      ${audit.map((a) => `<tr><td class="small">${esc(CF.fmtShort(a.created_at))} ${esc(CF.fmtTime(a.created_at))}</td><td>${esc(a.staff_name)}</td><td>${t("au_" + a.action)}</td><td>${esc(a.patient_name || "")}</td></tr>`).join("") || `<tr><td colspan="4">${t("none")}</td></tr>`}</tbody></table></div></div>`;
  }

  // ---------- notification outbox ----------
  async function outbox() {
    const { outbox, demoMode } = await api("GET", "/admin/outbox");
    return `<div class="card"><h2>${t("outbox")}</h2>${demoMode ? `<div class="notice info">${I("info")} ${t("outbox_demo")}</div>` : ""}
      <div class="table-wrap"><table class="table"><thead><tr><th>${t("when")}</th><th>${t("channel")}</th><th>${t("to")}</th><th>${t("message")}</th><th>${t("status")}</th></tr></thead><tbody>
      ${outbox.map((o) => `<tr><td class="small">${esc(CF.fmtShort(o.created_at))} ${esc(CF.fmtTime(o.created_at))}</td><td>${I({ email: "mail", sms: "msg", call: "phone" }[o.channel] || "bell")} ${t("via_" + o.channel)}</td><td class="small">${esc(o.recipient)}</td><td class="small">${esc(o.body)}</td>
        <td>${CF.chip(t("ob_" + o.status), { sent: "#27AE60", demo: "#5B7FA6", failed: "#C0392B" }[o.status])}</td></tr>`).join("") || `<tr><td colspan="5">${t("none")}</td></tr>`}</tbody></table></div></div>`;
  }
})();
