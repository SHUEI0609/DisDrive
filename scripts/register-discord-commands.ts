const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId || !botToken) {
  throw new Error("DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN are required.");
}

const commands = [
  {
    name: "upload",
    description: "ファイルをクラウドへアップロードします",
    options: [
      {
        name: "description",
        description: "ファイルの説明",
        type: 3,
        required: false,
      },
      {
        name: "visibility",
        description: "公開範囲",
        type: 3,
        required: false,
        choices: [
          { name: "チャンネル", value: "channel" },
          { name: "サーバー", value: "guild" },
          { name: "投稿者のみ", value: "uploader" },
        ],
      },
    ],
  },
];

const endpoint = guildId
  ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${applicationId}/commands`;

async function main() {
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  console.log(`Discord commands registered to ${guildId ? "guild" : "global"} scope.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
