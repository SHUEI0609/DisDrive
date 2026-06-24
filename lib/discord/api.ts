import { requireEnv } from "@/lib/env";

export async function postDiscordChannelMessage(
  channelId: string,
  payload: unknown,
) {
  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${requireEnv("DISCORD_BOT_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Discord message failed: ${await response.text()}`);
  }

  return response.json() as Promise<{ id: string }>;
}

export type DiscordUploadFile = {
  name: string;
  contentType: string;
  bytes: Buffer;
};

export async function postDiscordChannelMessageWithFiles(
  channelId: string,
  payload: unknown,
  files: DiscordUploadFile[],
) {
  const formData = new FormData();

  formData.set("payload_json", JSON.stringify(payload));

  files.forEach((file, index) => {
    const arrayBuffer = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;

    formData.set(
      `files[${index}]`,
      new Blob([arrayBuffer], { type: file.contentType }),
      file.name,
    );
  });

  const response = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${requireEnv("DISCORD_BOT_TOKEN")}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(`Discord message with files failed: ${await response.text()}`);
  }

  return response.json() as Promise<{ id: string }>;
}
