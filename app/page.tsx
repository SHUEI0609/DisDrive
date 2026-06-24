import { auth } from "@/lib/auth/auth";
import { SignInButton } from "@/components/sign-in-button";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth().catch((error) => {
    console.error("Failed to load session on home page", error);
    return null;
  });

  return (
    <main className="page">
      <div className="grid">
        <section className="panel stack">
          <div className="stack">
            <span className="status">MVP</span>
            <h1 className="title">Discordからクラウドへ、大きなファイルを預ける</h1>
            <p className="muted">
              Discordのスラッシュコマンドで一時アップロードURLを発行し、Web画面で本人確認してからGoogle
              Driveへ保存します。
            </p>
          </div>
          <div className="button-row">
            <SignInButton signedIn={Boolean(session?.user)} />
          </div>
        </section>

        <aside className="panel stack">
          <h2 className="section-title">現在の状態</h2>
          <dl className="meta-list">
            <div className="meta-row">
              <dt>ログイン</dt>
              <dd>{session?.user ? "済み" : "未ログイン"}</dd>
            </div>
            <div className="meta-row">
              <dt>ユーザー</dt>
              <dd>{session?.user?.name ?? "-"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
