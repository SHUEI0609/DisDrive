import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { getUserByDiscordId } from "@/lib/google/accounts";
import { getGoogleAuthUrl } from "@/lib/google/oauth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.discordUserId) {
    return NextResponse.redirect(new URL("/api/auth/signin/discord", request.url));
  }

  const state = crypto.randomBytes(32).toString("base64url");
  const returnTo = request.nextUrl.searchParams.get("returnTo") ?? "/";
  const forceReconnect = request.nextUrl.searchParams.get("force") === "1";

  if (forceReconnect) {
    const user = await getUserByDiscordId(session.discordUserId);
    await createAdminClient()
      .from("google_accounts")
      .delete()
      .eq("user_id", user.id);
  }

  const response = NextResponse.redirect(getGoogleAuthUrl(state));

  response.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 10 * 60,
  });
  response.cookies.set("google_oauth_return_to", returnTo, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
