# ClinicFlow

**Team Call 4 Action (B04.19) · GNG 1103 · Client: CaloT**

ClinicFlow is one web app with three interfaces behind a single login: **patients**, **clinic staff** (front desk and nurses) and **clinic administrators**. Everything is stored in **Firebase (Cloud Firestore)**, and codes and notifications are **really emailed through Gmail**. It includes a complete **legal & privacy layer**: Terms of Use, a Privacy Policy, a Cookie Policy, consent screens and privacy tools, in English and French.

👉 **Start here: [SETUP.md](SETUP.md)** (about 10 minutes, no coding). The short version: install Node.js 22, then run `npm install` and `npm start`.
⚖️ **Legal & privacy summary:** [LEGAL-COMPLIANCE.md](LEGAL-COMPLIANCE.md)

## Files

| File | What it is |
|---|---|
| `server/` | The backend (Node.js): login, booking rules, waitlist, emails, real-time updates |
| `public/` | The website: patient, staff and admin screens, in English and French |
| `clinicflow-app.html` | The **whole website in one file**, for pasting into Figma Make, Anvil, CodePen and similar tools (see SETUP.md) |
| `SETUP.md` | Step-by-step setup: Firebase, Gmail, Render / Replit |
| `LEGAL-COMPLIANCE.md` | What the app does to respect PIPEDA, PHIPA, Quebec Law 25, CASL and AODA |
| `public/legal-text.js` | The legal documents themselves (English + French). Change `LEGAL_VERSION` there when you edit them, and everyone is asked to accept again |

## What works

**Sign-in & security**
- One login page for every role. The server checks the role on every request.
- 6-digit codes are **emailed** when someone creates an account, signs in with 2-step verification, or resets a password. Codes expire in 10 minutes and allow 5 tries.
- An optional **family / shared-account password** is asked after the normal password. One account can book for several family members.
- Passwords are hashed (scrypt). No diagnoses, prescriptions or treatment plans are ever stored.

**Patients**
- Booking in 5 steps with a progress bar that fills to 100%:
  - choose a clinic: only registered clinics are shown, saved clinics come first, and you can search by name, street, postal code, doctor or specialty
  - choose the visit type and practitioner
  - choose a time, with weekday checkboxes, morning/afternoon/evening, and a date strip coloured by availability
  - confirm
- My appointments: a live status tracker, a "how busy is it" estimate for each step of the visit plus a "you should be done around…" time, Google Maps directions, reschedule, and cancel (with the clinic's 24-hour rule).
- Waitlist: when someone cancels, the spot is automatically offered to the next person, who accepts it in one tap.
- To-do (pre-visit forms), saved clinics, messages with the clinic, in-app notifications.
- An optional, anonymous "Are you at the clinic? How busy is it?" check. Patients' answers improve the wait estimates for everyone.
- **Privacy & data:** download all your data, or delete your account, at any time.

**Staff**
- Today's queue: Booked → Checked in → Waiting → In consultation → Completed, with a one-click "next step" button.
- Day, week and list schedule, colour-coded by visit type, with a live "now" line, search, and practitioner and weekday filters.
- Appointment card: contact details, status, practitioner, staff notes, forms (accept, or send back with a note), reschedule, cancel.
- Booking for phone calls and walk-ins, waitlist management, and a message inbox.
- A confidentiality agreement to accept at first sign-in.

**Clinic admin**
- Overview stats and a setup checklist.
- Clinic page: hours, photo, description in English and French.
- Practitioners and weekly availability, plus blocked time.
- Staff and roles: reception, nurse, admin.
- Booking rules: cancellation limit, slot length, visit types with colours.
- Custom patient statuses.
- Email templates in English and French.
- The pre-visit form.
- The list of sent emails.
- The **access log**: who opened or changed which appointment record.

**Clinic sign-up:** new clinics register themselves and get an admin account.

**Legal & privacy**
- "Before you start" consent screen (I accept / I don't accept), with the Terms, Privacy and Cookie policies in full.
- Separate consent checkboxes at sign-up.
- A cookie settings panel, with preference cookies off by default.
- Legal pages and an "Emergency? Call 911" note in the footer of every page.
- Consent records, plus protection against password guessing, strict security headers, self-hosted fonts and automatic data clean-up.

**For everyone**
- **Real-time sync:** a change in one interface shows up in the others instantly.
- **No double bookings:** every booking is checked against existing appointments before it is saved.
- **Full English/French switch** at any time.
- **Accessibility:** text size, high contrast, easier-reading spacing, reduced motion, **voice control** (works hands-free), read-aloud, and support for screen readers and keyboard-only use. It passes an automated WCAG 2.1 AA check on every page.
- **Responsive:** works on phones, tablets and desktop browsers.

## Not included (for now)

- **Text-message and phone-call codes or reminders:** these need a phone provider (such as Twilio) or Firebase's paid Blaze plan, so the team chose email only.
- **AI assistant (Clio):** removed for now. It can be added back later.
- **App Store / Google Play apps:** the website is fully responsive, so it can be wrapped as a phone app later (for example with Capacitor).
