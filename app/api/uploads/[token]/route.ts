import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { hashUploadToken } from "@/lib/security/token";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.discordUserId) {
      throw new AppError("Discordログインが必要です。", 401, "AUTH_REQUIRED");
    }

    const { token } = await context.params;
    const tokenHash = hashUploadToken(token);
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("upload_sessions")
      .select("id,status,visibility,description,expires_at,requester_id,guild_id,channel_id")
      .eq("token_hash", tokenHash)
      .single();

    if (error || !data) {
      throw new AppError("アップロードURLが見つかりません。", 404, "TOKEN_INVALID");
    }

    if (new Date(data.expires_at).getTime() < Date.now()) {
      throw new AppError("アップロードURLの期限が切れています。", 410, "TOKEN_EXPIRED");
    }

    const { data: requester, error: requesterError } = await supabase
      .from("users")
      .select("discord_user_id,username")
      .eq("id", data.requester_id)
      .single();

    if (requesterError || requester?.discord_user_id !== session.discordUserId) {
      throw new AppError("このアップロードURLは別のユーザー用です。", 403, "USER_MISMATCH");
    }

    const [{ data: guild }, { data: channel }] = await Promise.all([
      supabase
        .from("guilds")
        .select("name,discord_guild_id")
        .eq("id", data.guild_id)
        .single(),
      supabase
        .from("channels")
        .select("name,discord_channel_id")
        .eq("id", data.channel_id)
        .single(),
    ]);

    const { data: googleAccount } = await supabase
      .from("google_accounts")
      .select("id,email")
      .eq("user_id", data.requester_id)
      .single();

    return Response.json({
      id: data.id,
      status: data.status,
      visibility: data.visibility,
      description: data.description,
      expires_at: data.expires_at,
      requester,
      guild,
      channel,
      googleConnected: Boolean(googleAccount),
      googleEmail: googleAccount?.email ?? null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
