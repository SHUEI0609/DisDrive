import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { SignInButton } from "@/components/sign-in-button";
import { formatBytes } from "@/lib/files/format";
import { createAdminClient } from "@/lib/supabase/admin";

type FilePageProps = {
  params: Promise<{
    fileId: string;
  }>;
};

type FileDetail = {
  id: string;
  storage_key: string | null;
  display_name: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  description: string | null;
  status: string;
  completed_at: string | null;
  created_at: string;
  uploader?: { discord_user_id: string; username: string } | Array<{ discord_user_id: string; username: string }>;
  guild?: { name: string } | Array<{ name: string }>;
  channel?: { name: string } | Array<{ name: string }>;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

export default async function FilePage({ params }: FilePageProps) {
  const session = await auth();
  const { fileId } = await params;

  if (!session?.user) {
    return (
      <main className="page">
        <section className="panel stack">
          <h1 className="title">Discordログインが必要です</h1>
          <p className="muted">ファイル詳細を開くにはログインしてください。</p>
          <SignInButton signedIn={false} />
        </section>
      </main>
    );
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("files")
    .select(`
      id,
      storage_key,
      display_name,
      original_name,
      mime_type,
      size_bytes,
      description,
      status,
      completed_at,
      created_at,
      uploader:users(discord_user_id, username),
      guild:guilds(name),
      channel:channels(name)
    `)
    .eq("id", fileId)
    .is("deleted_at", null)
    .single();

  const file = data as FileDetail | null;

  if (!file) {
    notFound();
  }

  const guild = firstRelation(file.guild);
  const channel = firstRelation(file.channel);
  const driveUrl = file.storage_key
    ? `https://drive.google.com/file/d/${file.storage_key}/view`
    : null;
  const isVideo = file.mime_type.startsWith("video/");

  return (
    <main className="page">
      <div className="grid">
        <section className="panel stack">
          <span className={`status ${file.status === "completed" ? "success" : ""}`}>
            {file.status}
          </span>
          <h1 className="title">{file.display_name}</h1>
          <p className="muted">{file.description ?? "説明はありません。"}</p>
          {isVideo ? (
            <video
              className="preview-video"
              src={`/api/files/${file.id}/stream`}
              controls
              preload="metadata"
            />
          ) : null}
          <div className="button-row">
            {driveUrl ? (
              <a className="button primary" href={driveUrl}>
                Driveで開く
              </a>
            ) : null}
            <form action={`/api/files/${file.id}`} method="post">
              <button className="button danger" type="submit">
                削除
              </button>
            </form>
          </div>
        </section>

        <aside className="panel stack">
          <h2 className="section-title">詳細</h2>
          <dl className="meta-list">
            <div className="meta-row">
              <dt>サイズ</dt>
              <dd>{formatBytes(file.size_bytes)}</dd>
            </div>
            <div className="meta-row">
              <dt>MIME</dt>
              <dd>{file.mime_type}</dd>
            </div>
            <div className="meta-row">
              <dt>サーバー</dt>
              <dd>{guild?.name ?? "-"}</dd>
            </div>
            <div className="meta-row">
              <dt>チャンネル</dt>
              <dd>{channel?.name ?? "-"}</dd>
            </div>
            <div className="meta-row">
              <dt>作成日</dt>
              <dd>{new Date(file.created_at).toLocaleString("ja-JP")}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
