import { google } from "googleapis";
import { env, requireEnv } from "@/lib/env";

export const googleDriveScopes = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

export function getGoogleRedirectUri() {
  return `${env.APP_URL}/api/google/callback`;
}

export function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    getGoogleRedirectUri(),
  );
}

export function getGoogleAuthUrl(state: string) {
  return createGoogleOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: googleDriveScopes,
    state,
  });
}
