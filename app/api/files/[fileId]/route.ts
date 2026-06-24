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

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.discordUserId) {
      throw new AppError("Discordログインが必要です。", 401, "AUTH_REQUIRED");
    }

    const { fileId } = await context.params;
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("id", fileId)
      .is("deleted_at", null)
      .single();

    if (error || !data) {
      throw new AppError("ファイルが見つかりません。", 404, "FILE_NOT_FOUND");
    }

    return Response.json(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.discordUserId) {
      throw new AppError("Discordログインが必要です。", 401, "AUTH_REQUIRED");
    }

    const { fileId } = await context.params;
    const supabase = createAdminClient();
    const { data: file, error } = await supabase
      .from("files")
      .select("id, provider, storage_key, uploader_id, guild_id, uploader:users(discord_user_id)")
      .eq("id", fileId)
      .is("deleted_at", null)
      .single();

    if (error || !file) {
      throw new AppError("ファイルが見つかりません。", 404, "FILE_NOT_FOUND");
    }

    const uploader = Array.isArray(file.uploader) ? file.uploader[0] : file.uploader;

    if (uploader?.discord_user_id !== session.discordUserId) {
      throw new AppError("投稿者のみ削除できます。", 403, "DELETE_DENIED");
    }

    await supabase
      .from("files")
      .update({
        status: "deleting",
      })
      .eq("id", file.id);

    if (file.storage_key) {
      const refreshToken = await getGoogleRefreshTokenForUser(file.uploader_id);
      await getStorageProvider(file.provider, { refreshToken }).deleteObject(file.storage_key);
    }

    await supabase
      .from("files")
      .update({
        status: "deleted",
        deleted_at: new Date().toISOString(),
      })
      .eq("id", file.id);

    await supabase.from("audit_logs").insert({
      actor_id: file.uploader_id,
      file_id: file.id,
      guild_id: file.guild_id,
      action: "file_deleted",
      details: {},
    });

    return Response.redirect(new URL("/", _request.url), 303);
  } catch (error) {
    return errorResponse(error);
  }
}
