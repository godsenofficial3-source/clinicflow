// Password / passcode hashing and verification codes (Node's built-in crypto, no extra packages).
const crypto = require("node:crypto");

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifySecret(secret, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(String(secret), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}
const newToken = () => crypto.randomBytes(32).toString("hex");
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

module.exports = { hashSecret, verifySecret, newToken, newCode, sha256 };
