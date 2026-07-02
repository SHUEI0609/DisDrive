import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import {
  postDiscordChannelMessage,
  postDiscordChannelMessageWithFiles,
} from "@/lib/discord/api";
import { formatBytes } from "@/lib/files/format";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { buildDocumentPreviewMessage } from "@/lib/discord/preview-message";
import { createDriveBackedPreview } from "@/lib/preview/drive-preview";
import { savePreviewPages } from "@/lib/preview/store";
import { createSignedFileToken } from "@/lib/security/signed-file-token";
import { hashUploadToken } from "@/lib/security/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { GoogleDriveStorageProvider } from "@/lib/storage/google-drive";
import { uploadUnlistedYouTubeVideo } from "@/lib/storage/youtube";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.discordUserId) {
      throw new AppError("Discordログインが必要です。", 401, "AUTH_REQUIRED");
    }

    const formData = await request.formData();
    const fileId = formData.get("fileId");
    const file = formData.get("file");

    if (typeof fileId !== "string" || !(file instanceof File)) {
      throw new AppError("アップロードするファイルが不正です。", 400, "INVALID_FILE");
    }

    if (file.size > env.MAX_FILE_SIZE_BYTES) {
      throw new AppError("ファイルサイズが上限を超えています。", 413, "FILE_TOO_LARGE");
    }

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
        requester:users!upload_sessions_requester_id_fkey(discord_user_id),
        channel:channels(discord_channel_id)
      `)
      .eq("token_hash", tokenHash)
      .single();

    if (sessionError || !uploadSession || uploadSession.file_id !== fileId) {
      throw new AppError("アップロードセッションが見つかりません。", 404, "TOKEN_INVALID");
    }

    const requester = Array.isArray(uploadSession.requester)
      ? uploadSession.requester[0]
      : uploadSession.requester;

    if (requester?.discord_user_id !== session.discordUserId) {
      throw new AppError("このアップロードURLは別のユーザー用です。", 403, "USER_MISMATCH");
    }

    const refreshToken = await getGoogleRefreshTokenForUser(uploadSession.requester_id);
    const provider = new GoogleDriveStorageProvider(refreshToken);
    const bytes = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";
    const uploaded = await provider.uploadObject({
      fileName: file.name,
      mimeType,
      bytes,
    });
    const isVideo = mimeType.startsWith("video/");
    let youtubeUpload: { id: string; url: string } | null = null;
    let youtubeUploadError: string | null = null;

    if (isVideo && env.YOUTUBE_UPLOAD_VIDEOS) {
      try {
        youtubeUpload = await uploadUnlistedYouTubeVideo({
          refreshToken,
          title: file.name,
          description: "Uploaded from Discord Cloud File Bot",
          mimeType,
          bytes,
        });
      } catch (error) {
        console.error("YouTube upload failed", error);
        youtubeUploadError =
          error instanceof Error
            ? error.message
            : "YouTubeアップロードに失敗しました。";
      }
    }

    const { data: storedFile, error: fileUpdateError } = await supabase
      .from("files")
      .update({
        storage_key: uploaded.storageKey,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", fileId)
      .select("id,display_name,size_bytes")
      .single();

    if (fileUpdateError) throw fileUpdateError;

    await supabase
      .from("upload_sessions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", uploadSession.id);

    const channel = Array.isArray(uploadSession.channel)
      ? uploadSession.channel[0]
      : uploadSession.channel;

    let discordMessageId: string | null = null;

    if (channel?.discord_channel_id) {
      let preview = youtubeUpload
        ? { files: [], textPreview: undefined, pages: undefined, note: undefined }
        : await createDriveBackedPreview({
            refreshToken,
            driveFileId: uploaded.storageKey,
            fileName: file.name,
            mimeType,
            fallbackBytes: bytes,
          }).catch((error) => {
            console.error("Preview generation failed", error);
            return {
              files: [],
              textPreview: undefined,
              pages: undefined,
              note: "プレビュー生成に失敗しました。ファイル本体はDriveに保存済みです。",
            };
          });
      const contentLines = [
          "ファイルを保存しました",
          `ファイル名: ${storedFile.display_name}`,
          `サイズ: ${formatBytes(storedFile.size_bytes)}`,
          `投稿者: <@${session.discordUserId}>`,
        ];
      const driveUrl = `https://drive.google.com/file/d/${uploaded.storageKey}/view`;
      const signedVideoToken = isVideo ? createSignedFileToken(storedFile.id) : null;
      const nativeVideoUrl = signedVideoToken
        ? `${env.APP_URL}/api/files/${storedFile.id}/video/${signedVideoToken}/${encodeURIComponent(storedFile.display_name)}`
        : null;

      if (youtubeUpload) {
        contentLines.push("", youtubeUpload.url);
      }

      if (env.YOUTUBE_UPLOAD_VIDEOS && isVideo && !youtubeUpload) {
        contentLines.push(
          "",
          `YouTubeアップロード失敗: ${youtubeUploadError ?? "Google連携/YouTube API設定を確認してください。"}`,
        );
      }

      if (env.GOOGLE_DRIVE_LINK_EMBEDS) {
        contentLines.push("", driveUrl);
      }

      if (nativeVideoUrl && !youtubeUpload && !env.YOUTUBE_UPLOAD_VIDEOS) {
        contentLines.push("", nativeVideoUrl);
      }

      if (preview.note && !youtubeUpload) {
        contentLines.push(`プレビュー: ${preview.note}`);
      }

      if (preview.textPreview) {
        contentLines.push("", "プレビュー:");
        contentLines.push(`\`\`\`\n${preview.textPreview.replace(/```/g, "'''")}\n\`\`\``);
      }

      const actionButtons = [
        {
          type: 2,
          style: 5,
          label: "詳細",
          url: `${env.APP_URL}/files/${storedFile.id}`,
        },
        {
          type: 2,
          style: 5,
          label: "Driveで開く",
          url: driveUrl,
        },
      ];

      if (isVideo) {
        actionButtons.unshift({
          type: 2,
          style: 5,
          label: youtubeUpload ? "YouTubeで再生" : "動画を再生",
          url: youtubeUpload?.url ?? `${env.APP_URL}/files/${storedFile.id}`,
        });
      }

      let payload: unknown = {
        content: contentLines.join("\n"),
        components: [
          {
            type: 1,
            components: actionButtons,
          },
        ],
      };
      let filesToSend = youtubeUpload ? [] : preview.files;

      if (
        nativeVideoUrl && !youtubeUpload && !env.YOUTUBE_UPLOAD_VIDEOS
      ) {
        contentLines.push("外部ストリーミングURLの埋め込みを試しています。");
        payload = {
          content: contentLines.join("\n"),
          components: [
            {
              type: 1,
              components: actionButtons,
            },
          ],
        };
        filesToSend = [];
      }

      if (preview.pages?.length) {
        const meta = await savePreviewPages(storedFile.id, preview.pages, refreshToken);

        payload = buildDocumentPreviewMessage({
          fileId: storedFile.id,
          fileName: storedFile.display_name,
          sizeBytes: storedFile.size_bytes,
          discordUserId: session.discordUserId,
          driveFileId: uploaded.storageKey,
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
      }

      const message =
        filesToSend.length > 0
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
      .eq("id", fileId);

    await supabase.from("audit_logs").insert({
      actor_id: uploadSession.requester_id,
      file_id: fileId,
      guild_id: uploadSession.guild_id,
      action: "upload_completed_via_proxy",
      details: {
        driveFileId: uploaded.storageKey,
        driveName: uploaded.name,
        driveSizeBytes: uploaded.sizeBytes,
        youtubeVideoId: youtubeUpload?.id ?? null,
        youtubeUploadError,
      },
    });

    return Response.json({
      fileId,
      driveFileId: uploaded.storageKey,
      mode: "proxy",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
