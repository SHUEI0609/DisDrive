import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { createGoogleOAuthClient } from "@/lib/google/oauth";
import { getUserByDiscordId } from "@/lib/google/accounts";
import { encryptText } from "@/lib/security/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.discordUserId) {
    return NextResponse.redirect(new URL("/api/auth/signin/discord", request.url));
  }

  const expectedState = request.cookies.get("google_oauth_state")?.value;
  const actualState = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const returnTo = request.cookies.get("google_oauth_return_to")?.value ?? "/";

  if (!expectedState || expectedState !== actualState || !code) {
    return NextResponse.redirect(new URL(`${returnTo}?google=failed`, request.url));
  }

  const oauth = createGoogleOAuthClient();
  const { tokens } = await oauth.getToken(code);

  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL(`${returnTo}?google=no_refresh_token`, request.url));
  }

  oauth.setCredentials(tokens);

  const oauth2 = google.oauth2({
    version: "v2",
    auth: oauth,
  });
  const me = await oauth2.userinfo.get();
  const user = await getUserByDiscordId(session.discordUserId);
  const supabase = createAdminClient();

  await supabase.from("google_accounts").upsert(
    {
      user_id: user.id,
      google_sub: me.data.id ?? null,
      email: me.data.email ?? null,
      refresh_token_encrypted: encryptText(tokens.refresh_token),
      scope: Array.isArray(tokens.scope) ? tokens.scope.join(" ") : tokens.scope ?? null,
    },
    { onConflict: "user_id" },
  );

  const response = NextResponse.redirect(new URL(`${returnTo}?google=connected`, request.url));
  response.cookies.delete("google_oauth_state");
  response.cookies.delete("google_oauth_return_to");

  return response;
}
