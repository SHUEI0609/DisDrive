import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGoogleAccessToken } from "@/lib/storage/google-drive";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.discordUserId) {
      throw new AppError("Discordログインが必要です。", 401, "AUTH_REQUIRED");
    }

    const { fileId } = await context.params;
    const supabase = createAdminClient();
    const { data: file, error } = await supabase
      .from("files")
      .select("storage_key, uploader_id, mime_type")
      .eq("id", fileId)
      .eq("provider", "google_drive")
      .eq("status", "completed")
      .is("deleted_at", null)
      .single();

    if (error || !file?.storage_key) {
      throw new AppError("ファイルが見つかりません。", 404, "FILE_NOT_FOUND");
    }

    const refreshToken = await getGoogleRefreshTokenForUser(file.uploader_id);
    const accessToken = await getGoogleAccessToken(refreshToken);
    const range = request.headers.get("range");
    const driveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${file.storage_key}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(range ? { Range: range } : {}),
        },
      },
    );

    if (!driveResponse.ok || !driveResponse.body) {
      throw new AppError("動画の取得に失敗しました。", 502, "STREAM_FAILED");
    }

    const headers = new Headers();
    headers.set("Content-Type", file.mime_type || "video/mp4");
    headers.set("Accept-Ranges", "bytes");

    for (const header of ["content-length", "content-range"]) {
      const value = driveResponse.headers.get(header);

      if (value) {
        headers.set(header, value);
      }
    }

    return new Response(driveResponse.body, {
      status: driveResponse.status,
      headers,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
