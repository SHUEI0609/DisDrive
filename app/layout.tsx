import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Discord Cloud",
  description: "Discordから大容量ファイルを安全にアップロードするMVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-mark">D</span>
              <span>Discord Cloud File Bot</span>
            </Link>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
