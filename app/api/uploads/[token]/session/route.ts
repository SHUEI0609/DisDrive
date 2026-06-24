import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { postDiscordChannelMessage } from "@/lib/discord/api";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { sanitizeFileName } from "@/lib/security/sanitize";
import { hashUploadToken } from "@/lib/security/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageProvider } from "@/lib/storage";
import { createYouTubeUploadSession } from "@/lib/storage/youtube";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

const requestSchema = z.object({
  fileName: z.string().min(1).max(240),
  mimeType: z.string().min(1).max(160),
  sizeBytes: z.number().int().nonnegative(),
  description: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.discordUserId) {
      throw new AppError("Discordログインが必要です。", 401, "AUTH_REQUIRED");
    }

    const input = requestSchema.parse(await request.json());

    if (input.sizeBytes > env.MAX_FILE_SIZE_BYTES) {
      throw new AppError("ファイルサイズが上限を超えています。", 413, "FILE_TOO_LARGE");
    }

    const { token } = await context.params;
    const tokenHash = hashUploadToken(token);
    const supabase = createAdminClient();

    const { data: uploadSession, error: sessionError } = await supabase
      .from("upload_sessions")
      .select(`
        id,
        status,
        visibility,
        description,
        expires_at,
        requester_id,
        guild_id,
        channel_id,
        requester:users!upload_sessions_requester_id_fkey(discord_user_id),
        guild:guilds(discord_guild_id),
        channel:channels(discord_channel_id)
      `)
      .eq("token_hash", tokenHash)
      .single();

    if (sessionError || !uploadSession) {
      throw new AppError("アップロードURLが見つかりません。", 404, "TOKEN_INVALID");
    }

    if (uploadSession.status !== "created") {
      throw new AppError("このアップロードURLは利用済みです。", 409, "TOKEN_USED");
    }

    if (new Date(uploadSession.expires_at).getTime() < Date.now()) {
      throw new AppError("アップロードURLの期限が切れています。", 410, "TOKEN_EXPIRED");
    }

    const requester = Array.isArray(uploadSession.requester)
      ? uploadSession.requester[0]
      : uploadSession.requester;

    if (requester?.discord_user_id !== session.discordUserId) {
      throw new AppError("このアップロードURLは別のユーザー用です。", 403, "USER_MISMATCH");
    }

    const storedName = sanitizeFileName(input.fileName);
    const refreshToken = await getGoogleRefreshTokenForUser(uploadSession.requester_id);
    const provider = getStorageProvider("google_drive", { refreshToken });
    const storageSession = await provider.createUploadSession({
      fileName: storedName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
    const isVideo = input.mimeType.startsWith("video/");
    let youtubeSession: { uploadUrl: string; expiresAt: string } | null = null;

    if (isVideo && env.YOUTUBE_UPLOAD_VIDEOS) {
      youtubeSession = await createYouTubeUploadSession({
        refreshToken,
        title: storedName,
        description: input.description ?? uploadSession.description,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
      });
    }

    const { data: file, error: fileError } = await supabase
      .from("files")
      .insert({
        uploader_id: uploadSession.requester_id,
        guild_id: uploadSession.guild_id,
        channel_id: uploadSession.channel_id,
        provider: "google_drive",
        original_name: input.fileName,
        display_name: storedName,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        description: input.description ?? uploadSession.description,
        status: "uploading",
        visibility: uploadSession.visibility,
      })
      .select("id")
      .single();

    if (fileError) throw fileError;

    const { error: updateError } = await supabase
      .from("upload_sessions")
      .update({
        file_id: file.id,
        provider_session_id: storageSession.providerSessionId,
        status: "uploading",
        used_at: new Date().toISOString(),
      })
      .eq("id", uploadSession.id);

    if (updateError) throw updateError;

    await supabase.from("audit_logs").insert({
      actor_id: uploadSession.requester_id,
      file_id: file.id,
      guild_id: uploadSession.guild_id,
      action: "upload_session_started",
      details: {
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
      },
    });

    return Response.json({
      fileId: file.id,
      uploadUrl: storageSession.uploadUrl,
      youtubeUploadUrl: youtubeSession?.uploadUrl ?? null,
      expiresAt: storageSession.expiresAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
