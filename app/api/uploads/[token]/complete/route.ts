import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import {
  postDiscordChannelMessage,
  postDiscordChannelMessageWithFiles,
} from "@/lib/discord/api";
import { buildDocumentPreviewMessage } from "@/lib/discord/preview-message";
import { formatBytes } from "@/lib/files/format";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { hashUploadToken } from "@/lib/security/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageProvider } from "@/lib/storage";
import { createDriveBackedPreview } from "@/lib/preview/drive-preview";
import { savePreviewPages } from "@/lib/preview/store";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

const requestSchema = z.object({
  fileId: z.string().uuid(),
  driveFileId: z.string().min(1),
  youtubeVideoId: z.string().min(1).optional(),
  youtubeUploadError: z.string().max(1000).nullable().optional(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.discordUserId) {
      throw new AppError("Discordログインが必要です。", 401, "AUTH_REQUIRED");
    }

    const input = requestSchema.parse(await request.json());
    const { token } = await context.params;
    const tokenHash = hashUploadToken(token);
    const supabase = createAdminClient();

    const { data: uploadSession, error: sessionError } = await supabase
      .from("upload_sessions")
      .select(`
        id,
        file_id,
        requester_id,
        guild_id,
        channel_id,
        requester:users!upload_sessions_requester_id_fkey(discord_user_id, username),
        channel:channels(discord_channel_id)
      `)
      .eq("token_hash", tokenHash)
      .single();

    if (sessionError || !uploadSession || uploadSession.file_id !== input.fileId) {
      throw new AppError("アップロードセッションが見つかりません。", 404, "TOKEN_INVALID");
    }

    const requester = Array.isArray(uploadSession.requester)
      ? uploadSession.requester[0]
      : uploadSession.requester;

    if (requester?.discord_user_id !== session.discordUserId) {
      throw new AppError("このアップロードURLは別のユーザー用です。", 403, "USER_MISMATCH");
    }

    const refreshToken = await getGoogleRefreshTokenForUser(uploadSession.requester_id);
    const provider = getStorageProvider("google_drive", { refreshToken });
    const metadata = await provider.getMetadata(input.driveFileId);

    const { data: file, error: fileUpdateError } = await supabase
      .from("files")
      .update({
        storage_key: input.driveFileId,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", input.fileId)
      .select("id, display_name, size_bytes")
      .single();

    if (fileUpdateError) throw fileUpdateError;

    const { error: sessionUpdateError } = await supabase
      .from("upload_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", uploadSession.id);

    if (sessionUpdateError) throw sessionUpdateError;

    const channel = Array.isArray(uploadSession.channel)
      ? uploadSession.channel[0]
      : uploadSession.channel;

    let discordMessageId: string | null = null;

    if (channel?.discord_channel_id) {
      const youtubeUrl = input.youtubeVideoId
        ? `https://youtu.be/${input.youtubeVideoId}`
        : null;
      const contentLines = [
          "ファイルを保存しました",
          `ファイル名: ${file.display_name}`,
          `サイズ: ${formatBytes(file.size_bytes)}`,
          `投稿者: <@${session.discordUserId}>`,
          ...(youtubeUrl ? ["", youtubeUrl] : []),
          ...(input.youtubeUploadError
            ? ["", `YouTubeアップロード失敗: ${input.youtubeUploadError}`]
            : []),
        ];
      const driveUrl = `https://drive.google.com/file/d/${input.driveFileId}/view`;
      let payload: unknown = {
        content: contentLines.join("\n"),
        components: [
          {
            type: 1,
            components: [
              ...(youtubeUrl
                ? [
                    {
                      type: 2,
                      style: 5,
                      label: "YouTubeで再生",
                      url: youtubeUrl,
                    },
                  ]
                : []),
              {
                type: 2,
                style: 5,
                label: "詳細",
                url: `${env.APP_URL}/files/${file.id}`,
              },
              {
                type: 2,
                style: 5,
                label: "Driveで開く",
                url: driveUrl,
              },
            ],
          },
        ],
      };
      let filesToSend: Array<{ name: string; contentType: string; bytes: Buffer }> = [];

      if (!youtubeUrl) {
        try {
          const preview = await createDriveBackedPreview({
            refreshToken,
            driveFileId: input.driveFileId,
            fileName: file.display_name,
            mimeType: metadata.mimeType,
          });
            if (preview.note) {
              contentLines.push(`プレビュー: ${preview.note}`);
            }

            if (preview.textPreview) {
              contentLines.push("", "プレビュー:");
              contentLines.push(`\`\`\`\n${preview.textPreview.replace(/```/g, "'''")}\n\`\`\``);
            }

            if (preview.pages?.length) {
              const meta = await savePreviewPages(file.id, preview.pages, refreshToken);

              payload = buildDocumentPreviewMessage({
                fileId: file.id,
                fileName: file.display_name,
                sizeBytes: file.size_bytes,
                discordUserId: session.discordUserId,
                driveFileId: input.driveFileId,
                page: 1,
                totalPages: meta.totalPages,
                note: preview.note,
              });
              filesToSend = [
                {
                  name: "preview.jpg",
                  contentType: "image/jpeg",
                  bytes: preview.pages[0].bytes,
                },
              ];
            } else {
              payload = {
                ...(payload as Record<string, unknown>),
                content: contentLines.join("\n"),
              };
              filesToSend = preview.files;
            }
        } catch (error) {
          console.error("Preview generation failed", error);
          const detail = error instanceof Error ? ` 詳細: ${error.message.slice(0, 180)}` : "";
          contentLines.push(`プレビュー: 生成に失敗しました。ファイル本体はDriveに保存済みです。${detail}`);
          payload = {
            ...(payload as Record<string, unknown>),
            content: contentLines.join("\n"),
          };
        }
      }

      const message = filesToSend.length
        ? await postDiscordChannelMessageWithFiles(
            channel.discord_channel_id,
            payload,
            filesToSend,
          )
        : await postDiscordChannelMessage(channel.discord_channel_id, payload);
      discordMessageId = message.id;
    }

    await supabase
      .from("files")
      .update({
        discord_message_id: discordMessageId,
      })
      .eq("id", input.fileId);

    await supabase.from("audit_logs").insert({
      actor_id: uploadSession.requester_id,
      file_id: input.fileId,
      guild_id: uploadSession.guild_id,
      action: "upload_completed",
      details: {
        driveFileId: input.driveFileId,
        driveName: metadata.name,
        driveSizeBytes: metadata.sizeBytes,
        youtubeVideoId: input.youtubeVideoId ?? null,
        youtubeUploadError: input.youtubeUploadError ?? null,
      },
    });

    return Response.json({
      fileId: input.fileId,
      driveFileId: input.driveFileId,
      youtubeVideoId: input.youtubeVideoId ?? null,
      youtubeUploadError: input.youtubeUploadError ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
