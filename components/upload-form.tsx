"use client";

import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "@/lib/files/format";

type UploadInfo = {
  status: string;
  visibility: string;
  description?: string | null;
  expires_at: string;
  guild?: {
    name?: string;
    discord_guild_id?: string;
  } | null;
  channel?: {
    name?: string;
    discord_channel_id?: string;
  } | null;
  googleConnected?: boolean;
  googleEmail?: string | null;
};

type UploadFormProps = {
  token: string;
};

type ViewState =
  | "validating"
  | "ready"
  | "creating_session"
  | "uploading"
  | "proxy_uploading"
  | "verifying"
  | "completed"
  | "failed";

const stateLabels: Record<ViewState, string> = {
  validating: "アップロード情報を確認中",
  ready: "アップロード準備完了",
  creating_session: "アップロード先を作成中",
  uploading: "アップロード中",
  proxy_uploading: "サーバー経由でアップロード中",
  verifying: "保存結果を確認中",
  completed: "完了",
  failed: "エラー",
};

function uploadToDrive(
  uploadUrl: string,
  file: File,
  onProgress: (progress: number) => void,
): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as { id: string });
        return;
      }

      reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
    };

    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

export function UploadForm({ token }: UploadFormProps) {
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<ViewState>("validating");
  const [error, setError] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => state === "ready" && Boolean(file) && Boolean(info?.googleConnected),
    [file, info?.googleConnected, state],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`/api/uploads/${token}`);
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.message ?? "アップロード情報を取得できませんでした。");
        }

        if (!cancelled) {
          setInfo(payload as UploadInfo);
          setDescription(payload.description ?? "");
          setState("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "エラーが発生しました。");
          setState("failed");
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) return;

    setError(null);
    setProgress(0);
    setState("creating_session");

    try {
      const sessionResponse = await fetch(`/api/uploads/${token}/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          description,
        }),
      });

      const uploadSession = await sessionResponse.json();

      if (!sessionResponse.ok) {
        throw new Error(uploadSession.message ?? "アップロードセッションを作成できませんでした。");
      }

      setFileId(uploadSession.fileId);
      setState("uploading");

      let driveFile: { id: string };
      const shouldUseProxyUpload =
        file.type.startsWith("video/") &&
        process.env.NEXT_PUBLIC_YOUTUBE_UPLOAD_VIDEOS === "true";

      try {
        if (shouldUseProxyUpload) {
          throw new Error("YouTube連携のためサーバー経由でアップロードします。");
        }

        driveFile = await uploadToDrive(
          uploadSession.uploadUrl,
          file,
          setProgress,
        );
      } catch (directUploadError) {
        setState("proxy_uploading");
        setProgress(0);

        const fallbackFormData = new FormData();
        fallbackFormData.set("fileId", uploadSession.fileId);
        fallbackFormData.set("file", file);

        const fallbackResponse = await fetch(`/api/uploads/${token}/proxy-upload`, {
          method: "POST",
          body: fallbackFormData,
        });
        const fallbackPayload = await fallbackResponse.json();

        if (!fallbackResponse.ok) {
          throw new Error(
            fallbackPayload.message ??
              (directUploadError instanceof Error
                ? directUploadError.message
                : "サーバー経由アップロードにも失敗しました。"),
          );
        }

        setFileId(fallbackPayload.fileId);
        setProgress(1);
        setState("completed");
        return;
      }

      setState("verifying");

      const completeResponse = await fetch(`/api/uploads/${token}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId: uploadSession.fileId,
          driveFileId: driveFile.id,
        }),
      });

      const completePayload = await completeResponse.json();

      if (!completeResponse.ok) {
        throw new Error(completePayload.message ?? "アップロード完了処理に失敗しました。");
      }

      setFileId(completePayload.fileId);
      setProgress(1);
      setState("completed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました。");
      setState("failed");
    }
  }

  return (
    <div className="grid">
      <form className="panel stack" onSubmit={handleSubmit}>
        <div className="stack">
          <span className={`status ${state === "completed" ? "success" : ""}`}>
            {stateLabels[state]}
          </span>
          <h1 className="title">ファイルアップロード</h1>
          <p className="muted">
            Discordで発行された一時URLです。ファイル本体はVercelを通らず、Google
            Driveへ直接送信されます。
          </p>
        </div>

        <label className="field">
          <span className="label">ファイル</span>
          <input
            className="input"
            type="file"
            disabled={state !== "ready"}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        {state !== "ready" && state !== "failed" ? (
          <p className="muted">準備が完了するとファイルを選択できるようになります。</p>
        ) : null}

        <label className="field">
          <span className="label">説明</span>
          <textarea
            className="textarea"
            value={description}
            disabled={state !== "ready"}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>

        {file ? (
          <div className="panel-subtle">
            {file.name} / {formatBytes(file.size)}
          </div>
        ) : null}

        {info && !info.googleConnected ? (
          <div className="panel-subtle stack">
            <strong>Google Drive連携が必要です</strong>
            <span className="muted">
              このファイルはアップロードする本人のGoogle Driveへ保存します。
            </span>
            <a
              className="button primary"
              href={`/api/google/connect?returnTo=${encodeURIComponent(`/upload/${token}`)}`}
            >
              Google Driveを連携
            </a>
          </div>
        ) : null}

        <div className="progress" aria-label="アップロード進捗">
          <span style={{ "--value": `${Math.round(progress * 100)}%` } as React.CSSProperties} />
        </div>

        {error ? <p className="status danger">{error}</p> : null}

        {state === "completed" && fileId ? (
          <a className="button primary" href={`/files/${fileId}`}>
            詳細を開く
          </a>
        ) : (
          <button className="button primary" type="submit" disabled={!canSubmit}>
            アップロード開始
          </button>
        )}
      </form>

      <aside className="panel stack">
        <h2 className="section-title">送信先</h2>
        <dl className="meta-list">
          <div className="meta-row">
            <dt>サーバー</dt>
            <dd>{info?.guild?.name ?? "-"}</dd>
          </div>
          <div className="meta-row">
            <dt>チャンネル</dt>
            <dd>{info?.channel?.name ?? "-"}</dd>
          </div>
          <div className="meta-row">
            <dt>公開範囲</dt>
            <dd>{info?.visibility ?? "-"}</dd>
          </div>
          <div className="meta-row">
            <dt>期限</dt>
            <dd>{info ? new Date(info.expires_at).toLocaleString("ja-JP") : "-"}</dd>
          </div>
          <div className="meta-row">
            <dt>Drive</dt>
            <dd>{info?.googleConnected ? info.googleEmail ?? "連携済み" : "未連携"}</dd>
          </div>
        </dl>
      </aside>
    </div>
  );
}
