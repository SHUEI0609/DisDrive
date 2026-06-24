"use client";

import { signIn, signOut } from "next-auth/react";

type SignInButtonProps = {
  signedIn: boolean;
};

export function SignInButton({ signedIn }: SignInButtonProps) {
  if (signedIn) {
    return (
      <button className="button" type="button" onClick={() => signOut()}>
        ログアウト
      </button>
    );
  }

  return (
    <a className="button primary" href="/api/auth/signin/discord">
      Discordでログイン
    </a>
  );
}
