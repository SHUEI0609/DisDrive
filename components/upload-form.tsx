"use client";

import { useEffect, useMemo, useState } from "react";
import { AccountActions } from "@/components/account-actions";
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

const maxProxyUploadBytes = 4 * 1024 * 1024;
const uploadChunkBytes = 512 * 1024;
const maxChunkUploadRetries = 8;

type UploadTarget = "Google Drive" | "YouTube";
type SavedUploadStage = "drive" | "youtube" | "complete";
type SavedUploadState = {
  version: 1;
  token: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileLastModified: number;
  driveUploadUrl: string;
  youtubeUploadUrl: string | null;
  driveFileId?: string;
  youtubeVideoId?: string;
  youtubeUploadError?: string | null;
  stage: SavedUploadStage;
  uploadedBytes: number;
  updatedAt: number;
};

function savedUploadKey(token: string) {
  return `discord-cloud-file-bot:upload:${token}`;
}

function fileMatchesSavedUpload(file: File, savedUpload: SavedUploadState) {
  return (
    file.name === savedUpload.fileName &&
    file.size === savedUpload.fileSize &&
    file.type === savedUpload.fileType &&
    file.lastModified === savedUpload.fileLastModified
  );
}

function loadSavedUpload(token: string) {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(savedUploadKey(token));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SavedUploadState;
    if (parsed.version !== 1 || parsed.token !== token) return null;

    return {
      ...parsed,
      uploadedBytes: parsed.uploadedBytes ?? 0,
    };
  } catch {
    return null;
  }
}

function persistSavedUpload(token: string, savedUpload: SavedUploadState | null) {
  if (typeof window === "undefined") return;

  if (!savedUpload) {
    window.localStorage.removeItem(savedUploadKey(token));
    return;
  }

  window.localStorage.setItem(savedUploadKey(token), JSON.stringify(savedUpload));
}

function parseUploadedId(responseText: string, target: UploadTarget) {
  if (!responseText) {
    throw new Error(`${target} upload completed without a response body.`);
  }

  const payload = JSON.parse(responseText) as { id?: string };

  if (!payload.id) {
    throw new Error(`${target} upload completed without returning an id.`);
  }

  return { id: payload.id };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadChunk(
  uploadUrl: string,
  file: File,
  start: number,
  endExclusive: number,
  onProgress: (uploadedBytes: number) => void,
): Promise<{ status: number; responseText: string; range?: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const chunk = file.slice(start, endExclusive);
    const endInclusive = endExclusive - 1;

    xhr.open("PUT", uploadUrl);
    xhr.timeout = 180_000;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader(
      "Content-Range",
      `bytes ${start}-${endInclusive}/${file.size}`,
    );

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(start + event.loaded);
    };

    xhr.onload = () => {
      resolve({
        status: xhr.status,
        responseText: xhr.responseText,
        range: xhr.getResponseHeader("Range"),
      });
    };

    xhr.onerror = () => {
      reject(
        new Error(
          `Network error while sending ${formatBytes(start)}-${formatBytes(endExclusive)}`,
        ),
      );
    };
    xhr.ontimeout = () => {
      reject(
        new Error(
          `Upload timed out while sending ${formatBytes(start)}-${formatBytes(endExclusive)}`,
        ),
      );
    };
    xhr.send(chunk);
  });
}

function queryUploadStatus(
  uploadUrl: string,
  file: File,
  target: UploadTarget,
): Promise<{ completedId?: string; nextStart: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", uploadUrl);
    xhr.timeout = 60_000;
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("Content-Range", `bytes */${file.size}`);

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve({
            completedId: parseUploadedId(xhr.responseText, target).id,
            nextStart: file.size,
          });
        } catch (error) {
          reject(error);
        }
        return;
      }

      if (xhr.status === 308) {
        resolve({
          nextStart: nextStartFromRange(xhr.getResponseHeader("Range"), 0),
        });
        return;
      }

      reject(
        new Error(
          `${target} upload resume check failed: ${xhr.status} ${xhr.responseText}`,
        ),
      );
    };

    xhr.onerror = () => {
      reject(new Error(`${target} upload resume check failed with a network error.`));
    };
    xhr.ontimeout = () => {
      reject(new Error(`${target} upload resume check timed out.`));
    };

    xhr.send();
  });
}

function nextStartFromRange(range: string | null | undefined, fallback: number) {
  const match = range?.match(/bytes=0-(\d+)/);

  if (!match) {
    return fallback;
  }

  return Number(match[1]) + 1;
}

async function uploadResumable(
  uploadUrl: string,
  file: File,
  target: UploadTarget,
  onProgress: (progress: number) => void,
  options?: {
    resume?: boolean;
    onUploadedBytes?: (uploadedBytes: number) => void;
  },
): Promise<{ id: string }> {
  let start = 0;

  if (options?.resume) {
    const status = await queryUploadStatus(uploadUrl, file, target);

    if (status.completedId) {
      onProgress(1);
      options.onUploadedBytes?.(file.size);
      return { id: status.completedId };
    }

    start = status.nextStart;
    onProgress(Math.min(start / file.size, 0.999));
    options.onUploadedBytes?.(start);
  }

  while (start < file.size) {
    const endExclusive = Math.min(start + uploadChunkBytes, file.size);
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxChunkUploadRetries; attempt += 1) {
      try {
        const result = await uploadChunk(uploadUrl, file, start, endExclusive, (uploadedBytes) => {
          onProgress(Math.min(uploadedBytes / file.size, 0.999));
        });

        if (result.status >= 200 && result.status < 300) {
          onProgress(1);
          return parseUploadedId(result.responseText, target);
        }

        if (result.status === 308) {
          start = nextStartFromRange(result.range, endExclusive);
          onProgress(Math.min(start / file.size, 0.999));
          options?.onUploadedBytes?.(start);
          lastError = null;
          break;
        }

        throw new Error(
          `${target} upload failed at ${formatBytes(start)}-${formatBytes(endExclusive)}: ${result.status} ${result.responseText}`,
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(`${target} upload failed.`);

        try {
          const status = await queryUploadStatus(uploadUrl, file, target);

          if (status.completedId) {
            onProgress(1);
            options?.onUploadedBytes?.(file.size);
            return { id: status.completedId };
          }

          if (status.nextStart > start) {
            start = status.nextStart;
            onProgress(Math.min(start / file.size, 0.999));
            options?.onUploadedBytes?.(start);
            lastError = null;
            break;
          }
        } catch {
          // Keep the original upload error. Some mobile in-app browsers report a
          // network error even when Google accepted the chunk, so the status
          // check above is best-effort and should not hide the real failure.
        }

        if (attempt < maxChunkUploadRetries) {
          await sleep(750 * attempt);
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  throw new Error(`${target} upload did not complete.`);
}

async function readJsonOrText(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

export function UploadForm({ token }: UploadFormProps) {
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<ViewState>("validating");
  const [error, setError] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [savedUpload, setSavedUpload] = useState<SavedUploadState | null>(null);

  const canSubmit = useMemo(
    () =>
      (state === "ready" || state === "failed") &&
      Boolean(file) &&
      Boolean(info?.googleConnected),
    [file, info?.googleConnected, state],
  );
  const canResume = useMemo(
    () =>
      state === "failed" &&
      Boolean(file) &&
      Boolean(savedUpload) &&
      Boolean(info?.googleConnected) &&
      fileMatchesSavedUpload(file as File, savedUpload as SavedUploadState),
    [file, info?.googleConnected, savedUpload, state],
  );

  function saveUploadState(nextSavedUpload: SavedUploadState | null) {
    setSavedUpload(nextSavedUpload);
    persistSavedUpload(token, nextSavedUpload);
  }

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

  useEffect(() => {
    setSavedUpload(loadSavedUpload(token));
  }, [token]);

  async function runUpload(resumeFrom?: SavedUploadState) {
    if (!file) return;
    setError(null);
    setProgress(resumeFrom ? progress : 0);

    try {
      let activeUpload = resumeFrom;

      if (activeUpload && !fileMatchesSavedUpload(file, activeUpload)) {
        throw new Error("前回と同じファイルを選択してから続きから再開してください。");
      }

      if (!activeUpload) {
        setState("creating_session");

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

        const uploadSession = await readJsonOrText(sessionResponse);

        if (!sessionResponse.ok) {
          throw new Error(String(uploadSession.message ?? "アップロードセッションを作成できませんでした。"));
        }

        activeUpload = {
          version: 1,
          token,
          fileId: String(uploadSession.fileId),
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileLastModified: file.lastModified,
          driveUploadUrl: String(uploadSession.uploadUrl),
          youtubeUploadUrl:
            typeof uploadSession.youtubeUploadUrl === "string"
              ? uploadSession.youtubeUploadUrl
              : null,
          stage: "drive",
          uploadedBytes: 0,
          updatedAt: Date.now(),
        };
        saveUploadState(activeUpload);
      }

      setFileId(activeUpload.fileId);
      setState("uploading");

      let driveFile: { id: string };

      try {
        if (activeUpload.stage === "drive") {
          driveFile = await uploadResumable(
            activeUpload.driveUploadUrl,
            file,
            "Google Drive",
            setProgress,
            {
              resume: Boolean(resumeFrom),
              onUploadedBytes: (uploadedBytes) => {
                if (!activeUpload) return;
                saveUploadState({
                  ...activeUpload,
                  stage: "drive",
                  uploadedBytes,
                  updatedAt: Date.now(),
                });
              },
            },
          );
          activeUpload = {
            ...activeUpload,
            driveFileId: driveFile.id,
            stage: activeUpload.youtubeUploadUrl ? "youtube" : "complete",
            uploadedBytes: file.size,
            updatedAt: Date.now(),
          };
          saveUploadState(activeUpload);
        } else if (activeUpload.driveFileId) {
          driveFile = { id: activeUpload.driveFileId };
        } else {
          throw new Error("再開に必要なGoogle Drive保存情報が見つかりません。");
        }
      } catch (directUploadError) {
        if (file.size > maxProxyUploadBytes) {
          throw new Error(
            directUploadError instanceof Error
              ? `Google Driveへの直接アップロードに失敗しました。${formatBytes(maxProxyUploadBytes)}を超えるファイルはVercel経由に切り替えず、Googleへ直接送る必要があります。Chrome/Safariなど別ブラウザで開いて再試行してください。詳細: ${directUploadError.message}`
              : `Google Driveへの直接アップロードに失敗しました。Chrome/Safariなど別ブラウザで開いて再試行してください。`,
          );
        }

        setState("proxy_uploading");
        setProgress(0);

        const fallbackFormData = new FormData();
        fallbackFormData.set("fileId", activeUpload.fileId);
        fallbackFormData.set("file", file);

        const fallbackResponse = await fetch(`/api/uploads/${token}/proxy-upload`, {
          method: "POST",
          body: fallbackFormData,
        });
        const fallbackPayload = await readJsonOrText(fallbackResponse);

        if (!fallbackResponse.ok) {
          throw new Error(
            String(
              fallbackPayload.message ??
              (directUploadError instanceof Error
                ? directUploadError.message
                : "サーバー経由アップロードにも失敗しました。"),
            ),
          );
        }

        setFileId(String(fallbackPayload.fileId ?? activeUpload.fileId));
        setProgress(1);
        saveUploadState(null);
        setState("completed");
        return;
      }

      setState("verifying");
      let youtubeVideo: { id: string } | null = null;
      let youtubeUploadError: string | null = null;

      if (activeUpload.youtubeUploadUrl) {
        try {
          if (activeUpload.stage === "youtube") {
            youtubeVideo = await uploadResumable(
              activeUpload.youtubeUploadUrl,
              file,
              "YouTube",
              (youtubeProgress) => {
                setProgress(0.5 + youtubeProgress * 0.5);
              },
              {
                resume: Boolean(resumeFrom),
                onUploadedBytes: (uploadedBytes) => {
                  if (!activeUpload) return;
                  saveUploadState({
                    ...activeUpload,
                    stage: "youtube",
                    uploadedBytes,
                    updatedAt: Date.now(),
                  });
                },
              },
            );
            activeUpload = {
              ...activeUpload,
              youtubeVideoId: youtubeVideo.id,
              youtubeUploadError: null,
              stage: "complete",
              uploadedBytes: file.size,
              updatedAt: Date.now(),
            };
            saveUploadState(activeUpload);
          } else if (activeUpload.youtubeVideoId) {
            youtubeVideo = { id: activeUpload.youtubeVideoId };
          }
        } catch (youtubeError) {
          youtubeUploadError =
            youtubeError instanceof Error
              ? youtubeError.message
              : "YouTubeアップロードに失敗しました。";
          activeUpload = {
            ...activeUpload,
            youtubeUploadError,
            stage: "complete",
            uploadedBytes: file.size,
            updatedAt: Date.now(),
          };
          saveUploadState(activeUpload);
        }
      }

      const completeResponse = await fetch(`/api/uploads/${token}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId: activeUpload.fileId,
          driveFileId: driveFile.id,
          youtubeVideoId: youtubeVideo?.id,
          youtubeUploadError: youtubeUploadError ?? activeUpload.youtubeUploadError,
        }),
      });

      const completePayload = await readJsonOrText(completeResponse);

      if (!completeResponse.ok) {
        throw new Error(String(completePayload.message ?? "アップロード完了処理に失敗しました。"));
      }

      setFileId(String(completePayload.fileId ?? activeUpload.fileId));
      setProgress(1);
      saveUploadState(null);
      setState("completed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロードに失敗しました。");
      setState("failed");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runUpload();
  }

  async function handleResume() {
    if (!savedUpload) return;
    await runUpload(savedUpload);
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
            disabled={state !== "ready" && state !== "failed"}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              if (state === "failed") {
                setError(null);
              }
            }}
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
            disabled={state !== "ready" && state !== "failed"}
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

        {info?.googleConnected ? (
          <div className="panel-subtle stack">
            <strong>アカウント操作</strong>
            <span className="muted">
              `invalid_grant` が出た場合はGoogle再認証を行ってください。
            </span>
            <div className="button-row">
              <AccountActions
                signedIn
                googleConnected={Boolean(info.googleConnected)}
                returnTo={`/upload/${token}`}
              />
            </div>
          </div>
        ) : null}

        <div className="progress" aria-label="アップロード進捗">
          <span style={{ "--value": `${Math.round(progress * 100)}%` } as React.CSSProperties} />
        </div>

        {error ? <p className="status danger">{error}</p> : null}

        {savedUpload && state !== "completed" ? (
          <div className="panel-subtle stack">
            <strong>途中のアップロードがあります</strong>
            <span className="muted">
              {savedUpload.fileName} / {formatBytes(savedUpload.fileSize)}
            </span>
            <span className="muted">
              保存済み位置: {formatBytes(savedUpload.uploadedBytes)} 付近
            </span>
            <span className="muted">
              同じファイルを選択すると、Googleに確認して最後の送信位置から再開します。
            </span>
          </div>
        ) : null}

        {state === "completed" && fileId ? (
          <a className="button primary" href={`/files/${fileId}`}>
            詳細を開く
          </a>
        ) : (
          <div className="button-row">
            {canResume ? (
              <button className="button primary" type="button" onClick={handleResume}>
                続きから再開
              </button>
            ) : null}
            <button className="button primary" type="submit" disabled={!canSubmit}>
              アップロード開始
            </button>
          </div>
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
