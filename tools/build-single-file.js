// Builds clinicflow-app.html: the whole ClinicFlow website (HTML + CSS + JavaScript) in ONE file,
// for pasting into Figma Make, Anvil, Replit, CodePen or any website builder.
// Run:  npm run single-file
const fs = require("fs"), path = require("path");
const pub = path.join(__dirname, "..", "public");
const read = (f) => fs.readFileSync(path.join(pub, f), "utf8");
let html = read("index.html");
html = html.replace('<link rel="stylesheet" href="/styles.css" />', `<style>\n${read("styles.css")}\n</style>`);
const config = `<script>
  /* ==== CLINICFLOW SETTINGS ====================================================================
     Paste the web address of your running ClinicFlow server between the quotes
     (for example "https://clinicflow.yourname.repl.co"). Leave it empty ("") if this file is
     opened from the ClinicFlow server itself.                                                  */
  window.CLINICFLOW_SERVER = "";
  /* ============================================================================================ */
</script>`;
for (const f of ["legal-text.js", "i18n.js", "app.js", "patient.js", "staff.js", "admin.js", "legal.js", "boot.js"]) html = html.replace(`<script src="/${f}"></script>`, `<script>\n${read(f)}\n</script>`);
html = html.replace("<script>\n/* ClinicFlow – legal documents", config + "\n<script>\n/* ClinicFlow – legal documents");
fs.writeFileSync(path.join(__dirname, "..", "clinicflow-app.html"), html);
console.log("Created clinicflow-app.html (" + Math.round(html.length / 1024) + " KB)");
