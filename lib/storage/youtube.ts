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
