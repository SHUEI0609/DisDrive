"use client";

import { signOut } from "next-auth/react";

type AccountActionsProps = {
  signedIn: boolean;
  googleConnected?: boolean;
  returnTo?: string;
};

export function AccountActions({
  signedIn,
  googleConnected,
  returnTo = "/",
}: AccountActionsProps) {
  const encodedReturnTo = encodeURIComponent(returnTo);

  if (!signedIn) {
    return (
      <a className="button primary" href="/api/auth/signin/discord">
        Discordでログイン
      </a>
    );
  }

  return (
    <>
      <button className="button" type="button" onClick={() => signOut({ callbackUrl: "/" })}>
        Discordログアウト
      </button>
      <button
        className="button"
        type="button"
        onClick={() => signOut({ callbackUrl: "/api/auth/signin/discord" })}
      >
        Discord再ログイン
      </button>
      <a
        className={googleConnected ? "button primary" : "button"}
        href={`/api/google/connect?force=1&returnTo=${encodedReturnTo}`}
      >
        Google再認証
      </a>
    </>
  );
}
