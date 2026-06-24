import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStorageProvider } from "@/lib/storage";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

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
      .select("provider, storage_key, uploader_id")
      .eq("id", fileId)
      .eq("status", "completed")
      .is("deleted_at", null)
      .single();

    if (error || !file?.storage_key) {
      throw new AppError("ファイルが見つかりません。", 404, "FILE_NOT_FOUND");
    }

    const refreshToken = await getGoogleRefreshTokenForUser(file.uploader_id);
    const download = await getStorageProvider(file.provider, { refreshToken }).getDownload({
      storageKey: file.storage_key,
    });

    return Response.redirect(new URL(download.url, request.url), 303);
  } catch (error) {
    return errorResponse(error);
  }
}
