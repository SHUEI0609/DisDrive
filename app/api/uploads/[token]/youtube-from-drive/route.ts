import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { hashUploadToken } from "@/lib/security/token";
import { getGoogleAccessToken } from "@/lib/storage/google-drive";
import { uploadUnlistedYouTubeVideoStream } from "@/lib/storage/youtube";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

const requestSchema = z.object({
  fileId: z.string().uuid(),
  driveFileId: z.string().min(1),
});

export const runtime = "nodejs";
export const maxDuration = 300;

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
        description,
        requester:users!upload_sessions_requester_id_fkey(discord_user_id),
        file:files(id, display_name, mime_type, description)
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

    const file = Array.isArray(uploadSession.file)
      ? uploadSession.file[0]
      : uploadSession.file;

    if (!file?.mime_type?.startsWith("video/")) {
      throw new AppError("動画ファイルではありません。", 400, "NOT_VIDEO");
    }

    const refreshToken = await getGoogleRefreshTokenForUser(uploadSession.requester_id);
    const accessToken = await getGoogleAccessToken(refreshToken);
    const driveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${input.driveFileId}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!driveResponse.ok || !driveResponse.body) {
      throw new AppError(
        `Google Driveから動画を取得できませんでした: ${await driveResponse.text()}`,
        502,
        "DRIVE_DOWNLOAD_FAILED",
      );
    }

    const body = Readable.fromWeb(driveResponse.body as never);
    const youtubeVideo = await uploadUnlistedYouTubeVideoStream({
      refreshToken,
      title: file.display_name,
      description: file.description ?? uploadSession.description,
      mimeType: file.mime_type,
      body,
    });

    return Response.json({
      youtubeVideoId: youtubeVideo.id,
      youtubeUrl: youtubeVideo.url,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
