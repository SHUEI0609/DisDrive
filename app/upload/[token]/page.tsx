import { auth } from "@/lib/auth/auth";
import { SignInButton } from "@/components/sign-in-button";
import { UploadForm } from "@/components/upload-form";

type UploadPageProps = {
  params: Promise<{
    token: string;
  }>;
};

export default async function UploadPage({ params }: UploadPageProps) {
  const session = await auth();
  const { token } = await params;

  if (!session?.user) {
    return (
      <main className="page">
        <section className="panel stack">
          <h1 className="title">Discordログインが必要です</h1>
          <p className="muted">
            アップロードURLを発行したDiscordアカウントでログインしてください。
          </p>
          <div className="button-row">
            <SignInButton signedIn={false} />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <UploadForm token={token} />
    </main>
  );
}
