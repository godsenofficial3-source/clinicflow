# ClinicFlow – setup guide (about 10 minutes, no coding)

You need:
- a Google account (it's used for Firebase, Gmail and the AI)
- **Node.js 22 or newer** (https://nodejs.org → download the "LTS" version)

Each part below is optional. Without it the app still runs, but that feature stays off:

| Part | Without it | With it |
|---|---|---|
| A. Firebase database | Data is saved in a file on your computer | **All data is stored in Firebase (Firestore)** |
| B. Gmail | Codes appear on the screen | **Codes and notifications are really emailed** |

---

## A. Firebase database (5 min)

1. Go to https://console.firebase.google.com → **Create a project** → name it `clinicflow` → you can turn Google Analytics off → **Create**.
2. In the left menu, open **Build → Firestore Database** → **Create database** → location **northamerica-northeast1 (Montréal)** → choose **Production mode** → **Create**.
   (Production mode blocks direct access from the internet. Only your ClinicFlow server can read and write the data.)
3. Click the ⚙️ next to "Project overview" → **Project settings** → **Service accounts** tab → **Generate new private key** → **Generate key**. A `.json` file downloads.
4. Rename that file to **`firebase-service-account.json`** and put it in the ClinicFlow folder, next to `package.json`.
   🔒 Keep this file private. Never upload it to GitHub or share it.

## B. Gmail for real emails (2 min)

1. Sign in to the Gmail account that should send the emails (for example a new `clinicflow.team@gmail.com`).
2. Go to https://myaccount.google.com/security and turn on **2-Step Verification**. Google requires this before it gives out app passwords.
3. Go to https://myaccount.google.com/apppasswords → name it `ClinicFlow` → **Create** → copy the 16-letter password.
4. In the ClinicFlow folder, copy `.env.example` to a new file named **`.env`** and fill in:
   ```
   GMAIL_USER=clinicflow.team@gmail.com
   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
   PRIVACY_EMAIL=clinicflow.team@gmail.com
   ```
   `PRIVACY_EMAIL` is the contact shown in the Privacy Policy and Terms. People write to it to exercise their privacy rights, so use an inbox your team checks.

---

## Run it

Open a terminal in the ClinicFlow folder:

```bash
npm install
npm start
```

Then open **http://localhost:3000**. The terminal tells you what is connected:

```
✅ ClinicFlow is running → open http://localhost:3000 in your browser
Data:  Firebase Firestore ✔
Email: Gmail ✔
```

**The first time anyone opens ClinicFlow,** they see a "Before you start" screen and must accept the Terms of Use and Privacy Policy, and choose whether to allow preference cookies. Staff and admins also accept a confidentiality agreement at their first sign-in.

The first start fills Firebase with three Ottawa clinics and the sample accounts. This takes about 10 seconds. You'll then see all the data in the Firebase console under **Firestore Database**.

- **To start fresh** (this erases all data, including in Firebase): `npm run reset`
- **To start without the sample patient and appointments:** add `SAMPLE_DATA=no` to `.env` before the first start.

**Sample accounts** (password `Demo1234!`): `patient@demo.ca` (account password `2468`), `staff@demo.ca`, `nurse@demo.ca`, `admin@demo.ca`.
These are fake addresses, so they can't receive emails. **To see real emails, create your own patient account with your real email** using "Create an account".

> **"localhost" links only work on the computer that is running `npm start`.**
> To get a link anyone can open (for your client or team), use Replit below.

---

## Run it on Replit (gives you a public link)

1. Go to https://replit.com → **Create App** → **Import code or design** → upload the ClinicFlow zip (or import it from GitHub).
2. Open **Tools → Secrets** and add these (instead of the `.json` and `.env` files):
   | Secret name | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | the **whole content** of the downloaded service-account `.json` file |
   | `PRIVACY_EMAIL` | the team inbox for privacy questions |
   | `GMAIL_USER` | your Gmail address |
   | `GMAIL_APP_PASSWORD` | the 16-letter app password |
3. Set the run command to `npm install && npm start` and press **Run**. Replit shows a public `https://…` address: that's your shareable link.
   (On the free plan the app sleeps when nobody uses it. Your data is safe in Firebase, and it wakes up on the next visit.)

## Our live site (Render, free plan)

- **Link:** https://clinicflow-64da.onrender.com (the first visit after a quiet period takes about 50 seconds)
- **Data:** Firebase project `call4action-clinicflow`, Firestore in Montréal. The key is uploaded in Render → Environment → **Secret Files** (any `…firebase-adminsdk….json` file name works).
- **Email:** Render's free plan blocks normal email ports, so emails go through a small Google Apps Script owned by `clinicflowcallaction@gmail.com` (`google-apps-script/send-email.gs`). Its web app URL is saved in Render as `EMAIL_WEBHOOK_URL`. Gmail allows about 100 emails per day this way.
- **Updating the code:** upload the changed files to GitHub, then in Render click **Manual Deploy → Deploy latest commit**.

## Use it in Figma Make, Anvil, CodePen or another builder

`clinicflow-app.html` is the **whole website in one file** (all the HTML, CSS and JavaScript).

1. Keep the server running somewhere public (for example on Replit, above).
2. Open `clinicflow-app.html` in any text editor. Near the top, put your server's address between the quotes:
   ```js
   window.CLINICFLOW_SERVER = "https://your-replit-address.replit.app";
   ```
3. Paste the file into your tool:
   - **Figma Make:** "Use this HTML file as the app", then paste it.
   - **Anvil:** add it as an asset, or paste it into a Custom HTML form.
   - **CodePen or any static host:** paste it, or upload it.

   Everything still saves to Firebase through your server.

If you change the code in `public/`, rebuild this file with `npm run single-file`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm` is not recognized | Install Node.js 22+ and open a **new** terminal. |
| "Gmail login FAILED" | The app password is wrong, or 2-Step Verification is off. Make a new app password. |
| "Data: LOCAL FILE" | `firebase-service-account.json` is missing or misnamed (it must be next to `package.json`). |
| Port already in use | Close the other window running ClinicFlow, or add `PORT=3001` to `.env`. |
