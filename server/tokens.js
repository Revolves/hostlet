import crypto from "node:crypto";

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function signature(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signGrant(grant, secret) {
  const payload = encode(JSON.stringify(grant));
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyGrant(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !token.includes(".")) {
    return null;
  }

  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) {
    return null;
  }

  const expectedSignature = signature(payload, secret);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (suppliedBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!grant || typeof grant.exp !== "number" || grant.exp <= now) {
      return null;
    }
    return grant;
  } catch {
    return null;
  }
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

