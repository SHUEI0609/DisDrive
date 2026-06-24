import { google } from "googleapis";
import { Readable } from "node:stream";
import { requireEnv } from "@/lib/env";

function createOAuthClient(refreshToken: string) {
  const client = new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
  );

  client.setCredentials({
    refresh_token: refreshToken,
  });

  return client;
}

export async function uploadUnlistedYouTubeVideo(input: {
  refreshToken: string;
  title: string;
  description?: string | null;
  mimeType: string;
  bytes: Buffer;
}) {
  const youtube = google.youtube({
    version: "v3",
    auth: createOAuthClient(input.refreshToken),
  });
  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: input.title,
        description: input.description ?? undefined,
      },
      status: {
        privacyStatus: "unlisted",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      mimeType: input.mimeType,
      body: Readable.from(input.bytes),
    },
  });

  if (!response.data.id) {
    throw new Error("YouTube upload did not return a video id.");
  }

  return {
    id: response.data.id,
    url: `https://youtu.be/${response.data.id}`,
  };
}

export async function createYouTubeUploadSession(input: {
  refreshToken: string;
  title: string;
  description?: string | null;
  mimeType: string;
  sizeBytes: number;
}) {
  const auth = createOAuthClient(input.refreshToken);
  const { token } = await auth.getAccessToken();

  if (!token) {
    throw new Error("Failed to obtain Google access token.");
  }

  const response = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.sizeBytes),
      },
      body: JSON.stringify({
        snippet: {
          title: input.title,
          description: input.description ?? undefined,
        },
        status: {
          privacyStatus: "unlisted",
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  const uploadUrl = response.headers.get("location");

  if (!response.ok || !uploadUrl) {
    throw new Error(`Failed to create YouTube upload session: ${await response.text()}`);
  }

  return {
    uploadUrl,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}
