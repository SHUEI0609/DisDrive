import { after, NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUploadToken } from "@/lib/security/token";
import { requireEnv, env } from "@/lib/env";
import { buildDocumentPreviewMessage } from "@/lib/discord/preview-message";
import { postDiscordInteractionFollowup } from "@/lib/discord/api";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { verifyDiscordRequest } from "@/lib/discord/verify";
import { readPreviewMeta, readPreviewPage } from "@/lib/preview/store";
import {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  type DiscordInteraction,
} from "@/lib/discord/types";

export const runtime = "nodejs";

function optionValue(
  interaction: DiscordInteraction,
  name: string,
): string | number | boolean | undefined {
  return interaction.data?.options?.find((option) => option.name === name)?.value;
}

function multipartInteractionResponse(payload: unknown, file: Buffer) {
  const formData = new FormData();
  const arrayBuffer = file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  ) as ArrayBuffer;

  formData.set("payload_json", JSON.stringify(payload));
  formData.set(
    "files[0]",
    new Blob([arrayBuffer], { type: "image/jpeg" }),
    "preview.jpg",
  );

  return new Response(formData);
}

async function handlePreviewPageButton(interaction: DiscordInteraction) {
  const customId = interaction.data?.custom_id;

  if (!customId?.startsWith("preview:")) {
    return null;
  }

  const [, fileId, rawPage] = customId.split(":");
  const requestedPage = Number(rawPage);

  if (!fileId || !Number.isInteger(requestedPage)) {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        flags: MessageFlags.Ephemeral,
        content: "プレビューのページ指定が不正です。",
      },
    };
  }

  const supabase = createAdminClient();
  const { data: file, error } = await supabase
    .from("files")
    .select("id, display_name, size_bytes, storage_key, uploader_id, uploader:users(discord_user_id)")
    .eq("id", fileId)
    .single();

  if (error || !file?.storage_key) {
    return {
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        flags: MessageFlags.Ephemeral,
        content: "プレビュー対象のファイルが見つかりません。",
      },
    };
  }

  const uploader = Array.isArray(file.uploader) ? file.uploader[0] : file.uploader;
  const refreshToken = await getGoogleRefreshTokenForUser(file.uploader_id);
  const meta = await readPreviewMeta(file.id, refreshToken);
  const page = Math.min(Math.max(requestedPage, 1), meta.totalPages);

  const pageBytes = await readPreviewPage(file.id, page, refreshToken);

  return multipartInteractionResponse({
    type: InteractionResponseType.UpdateMessage,
    data: buildDocumentPreviewMessage({
      fileId: file.id,
      fileName: file.display_name,
      sizeBytes: Number(file.size_bytes),
      discordUserId: uploader?.discord_user_id ?? "unknown",
      driveFileId: file.storage_key,
      page,
      totalPages: meta.totalPages,
    }),
  }, pageBytes);
}

async function createUploadUrlResponse(interaction: DiscordInteraction) {
  const discordUser = interaction.member?.user ?? interaction.user;

  if (!discordUser?.id || !interaction.guild_id || !interaction.channel_id) {
    return {
      flags: MessageFlags.Ephemeral,
      content: "サーバー内のチャンネルから実行してください。",
    };
  }

  const supabase = createAdminClient();
  const ttlMinutes = env.UPLOAD_TOKEN_TTL_MINUTES;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const { rawToken, tokenHash } = createUploadToken();

  const { data: user, error: userError } = await supabase
    .from("users")
    .upsert(
      {
        discord_user_id: discordUser.id,
        username: discordUser.username ?? `user-${discordUser.id}`,
        avatar_url: discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : null,
      },
      { onConflict: "discord_user_id" },
    )
    .select("id")
    .single();

  if (userError) throw userError;

  const { data: guild, error: guildError } = await supabase
    .from("guilds")
    .upsert(
      {
        discord_guild_id: interaction.guild_id,
        name: `guild-${interaction.guild_id}`,
      },
      { onConflict: "discord_guild_id" },
    )
    .select("id")
    .single();

  if (guildError) throw guildError;

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .upsert(
      {
        guild_id: guild.id,
        discord_channel_id: interaction.channel_id,
        name: `channel-${interaction.channel_id}`,
      },
      { onConflict: "discord_channel_id" },
    )
    .select("id")
    .single();

  if (channelError) throw channelError;

  const visibility = String(optionValue(interaction, "visibility") ?? "channel");
  const description = optionValue(interaction, "description");

  const { error: sessionError } = await supabase.from("upload_sessions").insert({
    requester_id: user.id,
    guild_id: guild.id,
    channel_id: channel.id,
    token_hash: tokenHash,
    visibility: ["uploader", "channel", "guild"].includes(visibility)
      ? visibility
      : "channel",
    description: typeof description === "string" ? description : null,
    expires_at: expiresAt,
  });

  if (sessionError) throw sessionError;

  const uploadUrl = `${env.APP_URL}/upload/${rawToken}`;

  return {
    flags: MessageFlags.Ephemeral,
    content: `アップロードURLを発行しました。このリンクは${ttlMinutes}分間有効です。`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "ファイルをアップロード",
            url: uploadUrl,
          },
        ],
      },
    ],
  };
}

async function postUploadUrlFollowup(interaction: DiscordInteraction) {
  const applicationId = interaction.application_id ?? env.DISCORD_APPLICATION_ID;

  if (!applicationId) {
    throw new Error("Missing Discord application id for followup response.");
  }

  try {
    const data = await createUploadUrlResponse(interaction);
    await postDiscordInteractionFollowup(applicationId, interaction.token, data);
  } catch (error) {
    console.error(error);
    await postDiscordInteractionFollowup(applicationId, interaction.token, {
      flags: MessageFlags.Ephemeral,
      content:
        "アップロードURLの発行に失敗しました。サーバー設定とSupabase接続を確認してください。",
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-signature-ed25519");
    const timestamp = request.headers.get("x-signature-timestamp");
    const body = await request.text();

    if (!signature || !timestamp) {
      return new NextResponse("Missing signature", { status: 401 });
    }

    const verified = verifyDiscordRequest(
      body,
      signature,
      timestamp,
      requireEnv("DISCORD_PUBLIC_KEY"),
    );

    if (!verified) {
      return new NextResponse("Invalid signature", { status: 401 });
    }

    const interaction = JSON.parse(body) as DiscordInteraction;

    if (interaction.type === InteractionType.Ping) {
      return NextResponse.json({ type: InteractionResponseType.Pong });
    }

    if (interaction.type === InteractionType.MessageComponent) {
      const response = await handlePreviewPageButton(interaction);

      if (response) {
        if (response instanceof Response) {
          return response;
        }

        return NextResponse.json(response);
      }
    }

    if (
      interaction.type !== InteractionType.ApplicationCommand ||
      interaction.data?.name !== "upload"
    ) {
      return NextResponse.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          flags: MessageFlags.Ephemeral,
          content: "未対応の操作です。",
        },
      });
    }

    if (!interaction.member?.user?.id && !interaction.user?.id) {
      return NextResponse.json({
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          flags: MessageFlags.Ephemeral,
          content: "サーバー内のチャンネルから実行してください。",
        },
      });
    }

    after(() => postUploadUrlFollowup(interaction));

    return NextResponse.json({
      type: InteractionResponseType.DeferredChannelMessageWithSource,
      data: {
        flags: MessageFlags.Ephemeral,
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        flags: MessageFlags.Ephemeral,
        content:
          "アップロードURLの発行に失敗しました。サーバー設定とSupabase接続を確認してください。",
      },
    });
  }
}
