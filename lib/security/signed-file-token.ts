import crypto from "node:crypto";

type SignedFilePayload = {
  fileId: string;
  exp: number;
};

function signingSecret() {
  const secret =
    process.env.APP_ENCRYPTION_KEY ??
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET;

  if (!secret) {
    throw new Error("Missing APP_ENCRYPTION_KEY, AUTH_SECRET, or NEXTAUTH_SECRET.");
  }

  return secret;
}

function sign(value: string) {
  return crypto.createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

export function createSignedFileToken(fileId: string, ttlSeconds = 7 * 24 * 60 * 60) {
  const payload: SignedFilePayload = {
    fileId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifySignedFileToken(token: string, fileId: string) {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = sign(encodedPayload);

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return false;
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as SignedFilePayload;

  return payload.fileId === fileId && payload.exp >= Math.floor(Date.now() / 1000);
}
