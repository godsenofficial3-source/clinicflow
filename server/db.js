// Clinic defaults (statuses, visit types, message templates, pre-visit form) and the starter data.
const store = require("./store");
const { hashSecret } = require("./security");

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

const DEFAULT_STATUSES = [
  ["booked", "Booked", "Réservé", "#5B7FA6", 1],
  ["checked_in", "Checked in", "Arrivée confirmée", "#2F80ED", 2],
  ["waiting", "Waiting", "En attente", "#E0A100", 3],
  ["in_consult", "In consultation", "En consultation", "#8E44AD", 4],
  ["completed", "Completed", "Terminé", "#27AE60", 5],
  ["no_show", "No-show", "Absent", "#7F8C8D", 6],
  ["cancelled", "Cancelled", "Annulé", "#C0392B", 7],
];
const DEFAULT_TYPES = [
  ["Follow-up", "Suivi", 15, "#2BB3A3"],
  ["Consultation", "Consultation", 30, "#6C7BE0"],
  ["New patient", "Nouveau patient", 45, "#F2994A"],
  ["Prescription renewal", "Renouvellement d'ordonnance", 15, "#E86A92"],
];
const DEFAULT_TEMPLATES = {
  confirmation: ["Your appointment at {clinic} is confirmed for {date} at {time} with {provider}.", "Votre rendez-vous à {clinic} est confirmé le {date} à {time} avec {provider}."],
  reminder: ["Reminder: you have an appointment at {clinic} on {date} at {time}.", "Rappel : vous avez un rendez-vous à {clinic} le {date} à {time}."],
  cancellation: ["Your appointment at {clinic} on {date} at {time} has been cancelled.", "Votre rendez-vous à {clinic} du {date} à {time} a été annulé."],
  waitlist_offer: ["Good news! A spot opened at {clinic} on {date} at {time}. Open ClinicFlow to accept it.", "Bonne nouvelle! Une place s'est libérée à {clinic} le {date} à {time}. Ouvrez ClinicFlow pour l'accepter."],
  forms_due: ["Please complete \"{form}\" before your visit on {date}.", "Veuillez remplir « {form} » avant votre visite du {date}."],
  status_update: ["Update from {clinic}: your status is now \"{status}\".", "Mise à jour de {clinic} : votre statut est maintenant « {status} »."],
  provider_change: ["Your appointment on {date} at {time} is now with {provider}.", "Votre rendez-vous du {date} à {time} sera maintenant avec {provider}."],
};
// Administrative questions only – no health card numbers or clinical questions (data minimization / PHIPA).
const DEFAULT_FORM = {
  title_en: "Pre-visit check-in form", title_fr: "Formulaire de préenregistrement",
  fields: [
    { id: "language", en: "Preferred language for your visit", fr: "Langue préférée pour votre visite", type: "text" },
    { id: "accommodation", en: "Do you need an accommodation at the clinic? (e.g., wheelchair access, interpreter, quiet waiting area)", fr: "Avez-vous besoin d'une mesure d'adaptation à la clinique? (p. ex. accès en fauteuil roulant, interprète, salle d'attente calme)", type: "text" },
    { id: "phone_day", en: "Best phone number to reach you on the day of your visit", fr: "Meilleur numéro pour vous joindre le jour de votre visite", type: "text" },
  ],
};

function setupClinicDefaults(clinicId) {
  DEFAULT_STATUSES.forEach(([key, label_en, label_fr, color, sort]) => store.insert("statuses", { clinic_id: clinicId, key, label_en, label_fr, color, sort, system: 1 }));
  DEFAULT_TYPES.forEach(([name_en, name_fr, minutes, color]) => store.insert("appt_types", { clinic_id: clinicId, name_en, name_fr, minutes, color }));
  Object.entries(DEFAULT_TEMPLATES).forEach(([key, [body_en, body_fr]]) => store.insert("templates", { clinic_id: clinicId, key, body_en, body_fr }));
  store.insert("form_templates", { clinic_id: clinicId, title_en: DEFAULT_FORM.title_en, title_fr: DEFAULT_FORM.title_fr, fields: JSON.stringify(DEFAULT_FORM.fields) });
}

// Starter data: 3 Ottawa clinics with practitioners, and (optionally) sample accounts and appointments.
function seed({ samples = true } = {}) {
  const weekHours = JSON.stringify({ 1: ["08:00", "18:00"], 2: ["08:00", "18:00"], 3: ["08:00", "18:00"], 4: ["08:00", "20:00"], 5: ["08:00", "17:00"], 6: ["09:00", "13:00"] });
  const clinics = [
    ["Riverside Medical Centre", "124 Rideau Street", "Ottawa", "K1N 5X5", "613-221-2221", "hello@riverside.example",
      "Family medicine clinic in the ByWard Market. Walk-ins welcome in the morning.", "Clinique de médecine familiale au marché By. Sans rendez-vous le matin.", "family", ""],
    ["Elgin Family Clinic", "302 Elgin Street", "Ottawa", "K2P 1M5", "613-555-0142", "info@elginfamily.example",
      "Preventive care and family medicine in Centretown.", "Soins préventifs et médecine familiale au centre-ville.", "family", ""],
    ["Parkside Health Clinic", "88 Bank Street", "Ottawa", "K1P 5N2", "613-555-0199", "care@parkside.example",
      "Wellness, women's health and pediatrics downtown.", "Bien-être, santé des femmes et pédiatrie au centre-ville.", "wellness", ""],
  ];
  const clinicIds = clinics.map(([name, address, city, postal, phone, email, description_en, description_fr, specialty, photo]) =>
    store.insert("clinics", { name, address, city, postal, phone, email, description_en, description_fr, specialty, photo, hours: weekHours, cancel_hours: 24, slot_minutes: 15, accepting_online: 1 }).id);
  clinicIds.forEach(setupClinicDefaults);

  const provs = [
    [clinicIds[0], "Dr. Maya Chen", "MD", "Family medicine", "English, Mandarin"],
    [clinicIds[0], "Dr. Owen Patel", "MD", "Family medicine", "English, French"],
    [clinicIds[0], "Dr. Lena Morris", "MD", "Women's health", "English, French"],
    [clinicIds[1], "Dr. James Wilson", "MD", "Preventive care", "English"],
    [clinicIds[1], "Dr. Amélie Roy", "MD", "Family medicine", "French, English"],
    [clinicIds[2], "Dr. Sarah Ahmed", "MD", "Pediatrics", "English, Arabic"],
    [clinicIds[2], "Dr. Noah Fair", "ND", "Wellness", "English"],
  ];
  const provIds = provs.map(([clinic_id, name, title, specialty, languages]) => {
    const id = store.insert("providers", { clinic_id, name, title, specialty, languages, active: 1,
      bio_en: `${name} practises ${specialty.toLowerCase()} and speaks ${languages}.`, bio_fr: `${name} pratique en ${specialty.toLowerCase()}.` }).id;
    for (let wd = 1; wd <= 5; wd++) if (!(name.includes("Morris") && wd === 3)) store.insert("availability", { provider_id: id, weekday: wd, start: "09:00", end: wd === 4 ? "19:00" : "17:00" });
    return id;
  });

  const H = (pw) => hashSecret(pw);
  if (!samples) return;
  const user = (email, phone, role, clinic_id, staff_role, first_name, last_name, pin) => store.insert("users", { email, phone, password_hash: H("Demo1234!"), role, clinic_id, staff_role,
    first_name, last_name, lang: "en", twofa: "none", account_pin_hash: pin ? H(pin) : null, email_verified: 1, phone_verified: 0, notify_pref: "email" }).id;
  user("staff@demo.ca", "613-555-0102", "staff", clinicIds[0], "reception", "Alex", "Rivera");
  user("nurse@demo.ca", "613-555-0104", "staff", clinicIds[0], "nurse", "Priya", "Nair");
  user("admin@demo.ca", "613-555-0103", "admin", clinicIds[0], "admin", "Jordan", "Lee");
  const doctorId = user("doctor@demo.ca", "613-555-0105", "staff", clinicIds[0], "practitioner", "Owen", "Patel");
  store.update("users", doctorId, { provider_id: provIds[1] });
  const patientId = user("patient@demo.ca", "613-555-0101", "patient", null, null, "Sarah", "Tremblay", "2468");
  const kidId = store.insert("family_members", { user_id: patientId, first_name: "Léo", last_name: "Tremblay", relation: "child" }).id;
  store.insert("family_members", { user_id: patientId, first_name: "Marc", last_name: "Tremblay", relation: "partner" });
  store.insert("saved_clinics", { user_id: patientId, clinic_id: clinicIds[0] });

  const types = store.filter("appt_types", (t) => t.clinic_id === clinicIds[0]);
  const names = ["Eleanor Hayes", "Marcus Reed", "Sofia Bennett", "Noah Williams", "Amelia Torres", "James Kim", "Priya Shah", "Daniel Brooks", "Grace Sullivan", "Ethan Foster", "Mia Coleman", "Lucas Nguyen", "Chloe Martin", "Henry Adams", "Olivia Gagnon", "Liam Dubois"];
  const appt = (o) => store.insert("appointments", { member_id: null, user_id: null, checked_in_at: null, consult_at: null, completed_at: null, staff_notes: "", reminder_sent: 0, ...o });
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  let n = 0;
  for (let d = 0; d < 7; d++) {
    const day = new Date(monday); day.setDate(monday.getDate() + d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const date = ymd(day);
    const isToday = date === ymd(now);
    [0, 1, 2].forEach((pi) => {
      const slots = isToday ? [540, 570, 600, 660, 720, 780, 840, 900, 960] : [540, 630, 720, 840, 930];
      let lastEnd = 0;
      slots.forEach((m, si) => {
        if ((d + pi + si) % 3 === 0 && !isToday) return;
        const ty = types[(si + pi + d) % types.length];
        if (m < lastEnd) return;
        lastEnd = m + ty.minutes;
        const name = names[n++ % names.length];
        let status = "booked", ci = null, co = null, cp = null;
        const dayDiff = day - new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (dayDiff < 0) status = "completed";
        else if (isToday) {
          if (m + ty.minutes < nowMin - 10) status = "completed";
          else if (m <= nowMin && m + ty.minutes > nowMin) status = "in_consult";
          else if (m > nowMin && m - nowMin <= 30) status = si % 2 ? "waiting" : "checked_in";
        }
        if (["checked_in", "waiting", "in_consult", "completed"].includes(status)) ci = `${date} ${hm(Math.max(m - 12, 0))}`;
        if (["in_consult", "completed"].includes(status)) co = `${date} ${hm(m + 3)}`;
        if (status === "completed") cp = `${date} ${hm(m + ty.minutes + 2)}`;
        appt({ clinic_id: clinicIds[0], provider_id: provIds[pi], type_id: ty.id, patient_name: name, patient_phone: `613-555-${String(1000 + n).slice(-4)}`,
          patient_email: null, notify_pref: "app", reason: ty.name_en === "New patient" ? "First visit" : "Check-up",
          start: `${date} ${hm(m)}`, end: `${date} ${hm(m + ty.minutes)}`, status, source: n % 4 ? "online" : "phone", checked_in_at: ci, consult_at: co, completed_at: cp, reminder_sent: 1 });
      });
    });
  }
  const nextDay = new Date(now); do nextDay.setDate(nextDay.getDate() + 1); while ([0, 6].includes(nextDay.getDay()));
  const fu = types.find((t) => t.name_en === "Follow-up");
  const completedAt = `${ymd(now)} 07:30`;
  appt({ clinic_id: clinicIds[0], provider_id: provIds[1], type_id: fu.id, user_id: patientId, patient_name: "Sarah Tremblay",
    patient_phone: "613-555-0101", patient_email: "patient@demo.ca", notify_pref: "app", reason: "Follow-up visit",
    start: completedAt, end: `${ymd(now)} 07:45`, status: "completed", source: "online", completed_at: `${ymd(now)} 07:45`, reminder_sent: 1 });
  const a1 = appt({ clinic_id: clinicIds[0], provider_id: provIds[1], type_id: fu.id, user_id: patientId, patient_name: "Sarah Tremblay", patient_phone: "613-555-0101", patient_email: "patient@demo.ca",
    notify_pref: "app", reason: "Follow-up visit", start: `${ymd(nextDay)} 10:15`, end: `${ymd(nextDay)} 10:30`, status: "booked", source: "online", reminder_sent: 1 }).id;
  const later = new Date(nextDay); later.setDate(later.getDate() + 7);
  const cons = types.find((t) => t.name_en === "Consultation");
  appt({ clinic_id: clinicIds[0], provider_id: provIds[2], type_id: cons.id, user_id: patientId, member_id: kidId, patient_name: "Léo Tremblay", patient_phone: "613-555-0101", patient_email: "patient@demo.ca",
    notify_pref: "app", reason: "Annual check-up", start: `${ymd(later)} 15:00`, end: `${ymd(later)} 15:30`, status: "booked", source: "online", reminder_sent: 1 });
  const ft = store.find("form_templates", (f) => f.clinic_id === clinicIds[0]);
  store.insert("forms", { appointment_id: a1, template_id: ft.id, title_en: ft.title_en, title_fr: ft.title_fr, fields: ft.fields, answers: "{}", status: "todo", staff_note: null, due: ymd(nextDay) });
  store.insert("messages", { clinic_id: clinicIds[0], user_id: patientId, sender: "staff", body: "Hi Sarah, please remember to bring your health card to your next visit. – Riverside front desk", handoff: 0, read_staff: 1, read_patient: 0 });
  store.insert("blocks", { provider_id: provIds[0], date: ymd(nextDay), start: "12:00", end: "13:00", reason: "Lunch / meeting" });
}

module.exports = { setupClinicDefaults, seed, ymd, hm };
