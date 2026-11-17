/* ClinicFlow – legal & privacy layer: first-visit consent (Terms, Privacy, Cookies), cookie settings,
   legal pages, footer, staff confidentiality agreement and consent records. */
(function () {
  const { t, esc, icon: I, api, on, route, state: S } = CF;
  const V = window.LEGAL_VERSION;
  const DOCS = ["terms", "privacy", "cookies", "accessibility"];

  // ---------- documents ----------
  const contact = () => esc(S.config.privacyEmail || t("privacy_contact_fallback"));
  CF.legalDoc = (key, { headingLevel = 1 } = {}) => {
    const d = window.LEGAL[key][S.lang] || window.LEGAL[key].en;
    const fill = (s) => esc(s).replace(/\{email\}/g, `<b>${contact()}</b>`);
    const h = headingLevel, h2 = Math.min(h + 1, 6);
    const body = d.sections.map(([title, paras]) => {
      let html = `<h${h2}>${esc(title)}</h${h2}>`, list = [];
      const flush = () => { if (list.length) { html += `<ul>${list.map((li) => `<li>${fill(li)}</li>`).join("")}</ul>`; list = []; } };
      paras.forEach((p) => { if (p.startsWith("• ")) list.push(p.slice(2)); else { flush(); html += `<p>${fill(p)}</p>`; } });
      flush();
      return html;
    }).join("");
    return `<article class="legal-doc" lang="${S.lang === "fr" ? "fr-CA" : "en-CA"}"><h${h}>${esc(d.title)}</h${h}><p class="updated">${t("last_updated")}: ${esc(CF.fmtDate(V, { year: "numeric", month: "long", day: "numeric" }))}</p><p class="lead">${fill(d.intro)}</p>${body}</article>`;
  };
  const docLink = (k) => `<a href="#/legal/${k}">${esc((window.LEGAL[k][S.lang] || window.LEGAL[k].en).title)}</a>`;
  CF.docLink = docLink;

  // ---------- public legal pages ----------
  DOCS.forEach((k) => route("/legal/" + k, { title: "legal_" + k, render: () => `<section class="page">
      <nav class="legal-tabs" aria-label="${esc(t("legal_docs"))}">${DOCS.map((x) => `<a class="pill ${x === k ? "on" : ""}" href="#/legal/${x}" ${x === k ? 'aria-current="page"' : ""}>${esc((window.LEGAL[x][S.lang] || window.LEGAL[x].en).title)}</a>`).join("")}</nav>
      <div class="card">${CF.legalDoc(k)}</div>
      ${k === "cookies" ? `<button class="btn primary" data-act="cookie-settings">${I("settings")} ${t("cookie_settings")}</button>` : ""}
      <p class="small muted">${t("legal_versions_note")}</p></section>` }));

  // ---------- footer ----------
  CF.renderFooter = () => {
    const f = document.getElementById("footer");
    if (!f) return;
    f.innerHTML = `<nav aria-label="${esc(t("legal_docs"))}">${DOCS.map(docLink).join("")}<button class="link" data-act="cookie-settings">${t("cookie_settings")}</button></nav>
      <p><span class="sos">${I("alert")} ${t("footer_emergency")}</span> · ${t("footer_not_medical")}</p>
      <p>© 2026 Call 4 Action · ${t("footer_team")}</p>`;
  };

  // ---------- consent storage ----------
  CF.consent = () => CF.store.get("consent", null);
  const consentValid = () => { const c = CF.consent(); return !!(c && c.v === V && Date.now() - (c.at || 0) < 365 * 86400000); };
  function saveConsent(prefs) {
    CF.store.set("consent", { v: V, at: Date.now(), prefs: !!prefs });
    if (prefs) { CF.store.set("lang", S.lang); CF.store.set("a11y", S.a11y); } else CF.store.clearPrefs();
  }
  CF.recordServerConsent = async () => {
    if (S.user && consentValid() && S.user.consent_version !== V) {
      try { const r = await api("POST", "/me/consent", { kinds: ["terms", "privacy"], method: "consent_screen" }); S.user = r.user; } catch {}
    }
  };

  // ---------- first-visit consent screen (Terms + Privacy + Cookies) ----------
  let declined = false;
  CF.showGate = () => {
    if (document.querySelector(".gate-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "gate-wrap";
    wrap.innerHTML = gateHTML();
    document.body.appendChild(wrap);
    document.querySelectorAll("body > :not(.gate-wrap):not(script)").forEach((el) => el.setAttribute("inert", ""));
    setTimeout(() => wrap.querySelector("h1")?.focus(), 30);
  };
  const closeGate = () => {
    document.querySelector(".gate-wrap")?.remove();
    document.querySelectorAll("[inert]").forEach((el) => el.removeAttribute("inert"));
  };
  function gateHTML() {
    if (declined) return `<div class="gate" role="dialog" aria-modal="true" aria-labelledby="gate-t"><div class="gate-head"><h1 id="gate-t" tabindex="-1">${I("info")} ${t("gate_declined_title")}</h1></div>
      <div class="gate-body"><p>${t("gate_declined_1")}</p><p>${t("gate_declined_2")}</p><p class="sos small">${I("alert")} ${t("footer_emergency")}</p></div>
      <div class="gate-foot"><button class="btn primary" data-act="gate-review">${t("gate_review")}</button></div></div>`;
    return `<div class="gate" role="dialog" aria-modal="true" aria-labelledby="gate-t" aria-describedby="gate-d">
      <div class="gate-head"><h1 id="gate-t" tabindex="-1">${I("shield")} ${t("gate_title")}</h1>
        <p id="gate-d" class="muted">${t("gate_intro")}</p>
        <button class="btn sm ghost" data-act="lang" lang="${S.lang === "fr" ? "en" : "fr"}">${I("globe")} ${S.lang === "fr" ? "English" : "Français"}</button></div>
      <div class="gate-body">
        <ul class="key-points">${[1, 2, 3, 4, 5, 6].map((n) => `<li>${t("gate_p" + n)}</li>`).join("")}</ul>
        ${["terms", "privacy", "cookies"].map((k) => `<details><summary><b>${t("read_full")} ${esc((window.LEGAL[k][S.lang] || window.LEGAL[k].en).title)}</b></summary>${CF.legalDoc(k, { headingLevel: 2 })}</details>`).join("")}
        <div class="cookie-cat"><div><b>${t("ck_essential")}</b><p>${t("ck_essential_d")}</p></div><span class="chip chip-soft" style="--c:#0E6F66">${t("always_on")}</span></div>
        <div class="cookie-cat"><div><b id="gp-l">${t("ck_prefs")}</b><p>${t("ck_prefs_d")}</p></div>
          <button class="switch" role="switch" aria-checked="false" aria-labelledby="gp-l" data-act="gate-prefs"><span></span></button></div>
        <p class="small muted">${t("gate_note")}</p>
      </div>
      <div class="gate-foot"><button class="btn ghost" data-act="gate-decline">${t("gate_decline")}</button><button class="btn primary" data-act="gate-accept">${I("check")} ${t("gate_accept")}</button></div></div>`;
  }
  const rerenderGate = (CF.refreshGate = () => { const w = document.querySelector(".gate-wrap"); if (w) { w.innerHTML = gateHTML(); w.querySelector("h1")?.focus(); } });
  on("gate-prefs", (el) => el.setAttribute("aria-checked", el.getAttribute("aria-checked") !== "true"));
  on("gate-accept", async () => {
    const prefs = document.querySelector('[data-act="gate-prefs"]')?.getAttribute("aria-checked") === "true";
    saveConsent(prefs);
    closeGate();
    await CF.recordServerConsent();
    CF.toast(t("consent_saved"), "ok", 3000);
    CF.render();
  });
  on("gate-decline", () => { declined = true; rerenderGate(); });
  on("gate-review", () => { declined = false; rerenderGate(); });
  document.addEventListener("keydown", (e) => {     // keep keyboard focus inside the consent screen
    const g = document.querySelector(".gate");
    if (!g || e.key !== "Tab") return;
    const f = [...g.querySelectorAll("a[href],button,summary,[tabindex='-1']")].filter((x) => x.offsetParent !== null && x.tabIndex >= -1);
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  CF.checkGate = () => { if (!consentValid()) CF.showGate(); };

  // ---------- cookie settings (from the footer, any time) ----------
  on("cookie-settings", () => {
    const c = CF.consent() || {};
    const m = CF.modal(t("cookie_settings"), `<p>${t("ck_intro")}</p>
      <div class="cookie-cat"><div><b>${t("ck_essential")}</b><p>${t("ck_essential_d")}</p></div><span class="chip chip-soft" style="--c:#0E6F66">${t("always_on")}</span></div>
      <div class="cookie-cat"><div><b id="cp-l">${t("ck_prefs")}</b><p>${t("ck_prefs_d")}</p></div><button class="switch" role="switch" aria-checked="${!!c.prefs}" aria-labelledby="cp-l" data-act="gate-prefs" id="cp-sw"><span></span></button></div>
      <p class="small">${docLink("cookies")} · ${docLink("privacy")}</p>
      <div class="row end gap"><button class="btn primary" data-act="cookie-save">${t("save")}</button></div>`);
  });
  on("cookie-save", () => {
    const prefs = document.getElementById("cp-sw").getAttribute("aria-checked") === "true";
    saveConsent(prefs);
    CF.closeModal();
    CF.toast(t("consent_saved"), "ok", 2500);
  });

  // ---------- staff confidentiality agreement (required before using staff screens) ----------
  route("/agreement", { title: "staff_agreement", roles: ["staff", "admin"], render: () => `<section class="page narrow">
      <div class="card">${CF.legalDoc("staff")}
      <form data-form="staff-agree" class="stack"><label class="check-row"><input type="checkbox" name="ok" required/> <span>${t("staff_agree_check")}</span></label>
        <button class="btn primary" type="submit">${I("check")} ${t("staff_agree_btn")}</button></form></div></section>` });
  CF.onForm("staff-agree", async () => {
    const r = await api("POST", "/me/staff-agreement");
    S.user = r.user;
    CF.toast(t("consent_saved"));
    CF.go(CF.homeFor(S.user));
  });
  CF.needsStaffAgreement = () => S.user && S.user.role !== "patient" && S.user.staff_agreement_version !== V;

  // ---------- consent checkboxes used on sign-up forms ----------
  CF.consentChecks = (clinic = false) => `<fieldset class="consent-checks"><legend class="sr-only">${t("consents")}</legend>
    ${clinic ? `<label class="check-row"><input type="checkbox" name="accept_clinic" required/> <span>${t("chk_clinic_agreement", { doc: `<a href="#/legal/clinic" data-act="show-doc" data-doc="clinic">${esc((window.LEGAL.clinic[S.lang] || window.LEGAL.clinic.en).title)}</a>` })}</span></label>` : ""}
    <label class="check-row"><input type="checkbox" name="accept_terms" required/> <span>${t("chk_terms", { terms: `<a href="#/legal/terms" data-act="show-doc" data-doc="terms">${esc(window.LEGAL.terms[S.lang].title)}</a>` })}</span></label>
    <label class="check-row"><input type="checkbox" name="accept_privacy" required/> <span>${t("chk_privacy", { privacy: `<a href="#/legal/privacy" data-act="show-doc" data-doc="privacy">${esc(window.LEGAL.privacy[S.lang].title)}</a>` })}</span></label>
    <p class="small muted">${t("chk_note")}</p></fieldset>`;
  on("show-doc", (el) => CF.modal(esc((window.LEGAL[el.dataset.doc][S.lang] || window.LEGAL[el.dataset.doc].en).title), CF.legalDoc(el.dataset.doc, { headingLevel: 3 }), { side: true, wide: true }));
  route("/legal/clinic", { title: "legal_clinic", render: () => `<section class="page"><div class="card">${CF.legalDoc("clinic")}</div></section>` });
})();
