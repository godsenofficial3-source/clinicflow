# ClinicFlow – Legal & Privacy Compliance Checklist

This is what Call 4 Action built into ClinicFlow to respect Canadian, Ontario and Quebec law. It's written so you can reuse it in your report and presentation.

> ⚠️ **Important:** this was drafted carefully for a student prototype, but it is not legal advice and it doesn't replace a lawyer's review. Before real clinics use ClinicFlow with real patients every day, have a lawyer review the documents (the University of Ottawa's legal clinic is a good place to ask). Each clinic must also complete its own privacy impact assessment (PIA) and threat/risk assessment (TRA).

## Laws considered

| Law | Why it applies | How ClinicFlow addresses it |
|---|---|---|
| **PIPEDA** (federal private-sector privacy law) | We collect names, emails and bookings in a commercial-type service | Express consent at sign-up, a Privacy Officer contact, limited purposes, minimal data, safeguards, the right of access (data download), deletion, a complaint route to the federal Privacy Commissioner (OPC), and breach reporting |
| **PHIPA** (Ontario health privacy law) | Appointment information can be personal health information. The clinic is the custodian and ClinicFlow is its electronic service provider | We use the information only to provide the service; staff accept a confidentiality agreement; an **access log** records every time staff open or change a record; the Clinic Service Agreement commits us to notify clinics of breaches; no clinical data; health card numbers removed from forms |
| **Quebec Law 25** | French-speaking or Quebec users | Separate consent in clear terms, privacy by default (preference cookies **off** unless allowed), a disclosed privacy officer, disclosure of processing outside Quebec, incident register, data portability |
| **Quebec Charter of the French Language (Bill 96)** | Standard-form agreements offered in Quebec | Every legal document is fully available in French; both language versions are equally valid; there is a language-of-contract clause |
| **CASL** (anti-spam law) | We send emails | Transactional messages only, with no marketing; every email says so |
| **AODA / WCAG 2.1 AA** (Ontario accessibility) | Public-facing web service | Accessibility statement; every page passes automated WCAG 2.1 AA testing; voice control, read-aloud, high contrast, keyboard and screen-reader support |
| **Consumer protection laws** (Ontario, Quebec) | Terms with consumers | Disclaimers and limits of liability apply "to the maximum extent permitted by law"; rights that can't be excluded are kept |

## What is in the app

**Documents** (each has its own page, plus links in the footer of every page):
- Terms of Use, including a not-for-emergencies notice, a medical disclaimer, age-of-majority and family-booking authority, acceptable use, the clinic's role, disclaimers, limitation of liability, governing law, and language.
- Privacy Policy: what we collect and don't collect, purposes, consent, who sees it, cross-border processing, a retention schedule, safeguards, breaches, your rights, and where to complain (OPC, IPC Ontario, CAI Québec).
- Cookie Policy: lists every item stored in the browser and why.
- Accessibility Statement.
- Staff Confidentiality & Acceptable Use Agreement.
- Clinic Service Agreement.

**Consent**
- **First-visit "Before you start" screen:** key points in plain language, the full Terms, Privacy and Cookie policies, and **I accept / I don't accept** buttons. Declining blocks use and explains how to book by phone instead.
- **Cookie choice:** strictly necessary items are always on; preferences are **off by default** and can be changed any time with "Cookie settings" in the footer.
- **Sign-up:** two separate required checkboxes, one for the Terms plus the age of majority and one for consent to the Privacy Policy. The server refuses an account without them.
- **Clinic sign-up:** a third checkbox for the Clinic Service Agreement, confirming the person has authority to act for the clinic.
- **Staff and admins** must accept the Confidentiality Agreement before any staff screen opens. The server enforces this too.
- **Consent records:** every acceptance is stored with the document version and date. If the documents change (a new `LEGAL_VERSION`), everyone is asked again.

**Privacy rights** (Account → Privacy & data)
- **Download my data:** one JSON file with everything we hold, without password hashes.
- **Delete my account:** asks for the password. Upcoming appointments are cancelled and offered to the waitlist; past appointments are de-identified; everything else is erased.
- **Correct my information:** the profile can be edited.

**Security & data minimization**
- Passwords and account passwords are stored as salted scrypt hashes.
- Emailed 6-digit codes expire after 10 minutes, allow 5 attempts, and are never stored in the database.
- Limits on repeated sign-in, code and sign-up attempts protect against brute-force guessing.
- Role-based access is checked on the server for every request.
- A strict Content Security Policy blocks any third-party scripts, trackers or fonts. Other security headers: no framing by other sites, HSTS on HTTPS.
- Fonts are hosted on our own server, so nothing goes to Google Fonts. The sample data uses no hot-linked photos.
- "How busy is it?" answers are saved anonymously.
- No analytics, no ads, no tracking, and nothing is ever sold.
- Data is stored in Canada (Firestore, Montréal region).

**Automatic retention clean-up**

| Data | Deleted after |
|---|---|
| Sign-in sessions | 30 days |
| Anonymous "how busy" reports | 30 days |
| Email log | 90 days |
| Notifications | 180 days |
| Staff access log | 1 year |
| Verification codes | 10 minutes (kept in memory only) |

**Safety:** "Emergency? Call 911" and "not medical advice" notices appear on every page and in every email. Free-text fields warn people not to enter medical details.

## Before a real launch, the team or clinic should
1. Have a lawyer review all documents.
2. Have each clinic complete a PIA and TRA and confirm that it informs its patients.
3. Name a real Privacy Officer and set `PRIVACY_EMAIL` to an inbox someone monitors.
4. Sign data-processing terms with Google (Firebase/Gmail) and Render, or move hosting to Canada.
5. Keep a written privacy-incident register and a breach response plan.
