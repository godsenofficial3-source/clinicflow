// ClinicFlow email sender – paste this into a Google Apps Script project owned by the clinic's Gmail account,
// then Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
// Put the web app URL in the server's EMAIL_WEBHOOK_URL setting. Keep that URL private.
function doPost(e) {
  try {
    var m = JSON.parse(e.postData.contents);
    if (!m.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.to)) throw new Error("bad recipient");
    GmailApp.sendEmail(m.to, String(m.subject || "ClinicFlow").slice(0, 200), String(m.text || ""),
      { htmlBody: String(m.html || ""), name: "ClinicFlow" });
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}
