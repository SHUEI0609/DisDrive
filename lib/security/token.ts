import crypto from "node:crypto";

export function createUploadToken() {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashUploadToken(rawToken);

  return {
    rawToken,
    tokenHash,
  };
}

export function hashUploadToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
