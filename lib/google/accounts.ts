import { AppError } from "@/lib/errors";
import { decryptText } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getUserByDiscordId(discordUserId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("users")
    .select("id,discord_user_id,username")
    .eq("discord_user_id", discordUserId)
    .single();

  if (error || !data) {
    throw new AppError("DiscordユーザーがDBに見つかりません。", 404, "USER_NOT_FOUND");
  }

  return data;
}

export async function getGoogleRefreshTokenForUser(userId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("google_accounts")
    .select("refresh_token_encrypted")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new AppError(
      "Google Drive連携が必要です。先にGoogle Driveを連携してください。",
      403,
      "GOOGLE_NOT_CONNECTED",
    );
  }

  return decryptText(data.refresh_token_encrypted);
}
