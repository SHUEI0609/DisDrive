import { getServerSession, type NextAuthOptions } from "next-auth";
import Discord from "next-auth/providers/discord";

export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "identify guilds",
        },
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.discordAccessToken = account.access_token;
        token.discordAccessTokenExpiresAt = account.expires_at;
      }

      if (profile && "id" in profile) {
        token.discordUserId = String(profile.id);
      }

      return token;
    },
    async session({ session, token }) {
      session.discordUserId = token.discordUserId;
      return session;
    },
  },
};

export function auth() {
  return getServerSession(authOptions);
}
