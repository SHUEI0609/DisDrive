import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredPreviewMeta = {
  totalPages: number;
};

export type PreviewPageInput = {
  bytes: Buffer;
  contentType: string;
};

const previewRoot = path.join(process.cwd(), ".data", "previews");

function safeFileId(fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) {
    throw new Error("Invalid file id");
  }

  return fileId;
}

function safePage(page: number) {
  if (!Number.isInteger(page) || page < 1 || page > 999) {
    throw new Error("Invalid preview page");
  }

  return page;
}

function filePreviewDir(fileId: string) {
  return path.join(previewRoot, safeFileId(fileId));
}

export async function savePreviewPages(fileId: string, pages: PreviewPageInput[]) {
  const dir = filePreviewDir(fileId);

  await mkdir(dir, { recursive: true });

  await Promise.all(
    pages.map((page, index) =>
      writeFile(path.join(dir, `page-${index + 1}.jpg`), page.bytes),
    ),
  );

  const meta: StoredPreviewMeta = {
    totalPages: pages.length,
  };

  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");

  return meta;
}

export async function readPreviewMeta(fileId: string): Promise<StoredPreviewMeta> {
  const raw = await readFile(path.join(filePreviewDir(fileId), "meta.json"), "utf8");
  return JSON.parse(raw) as StoredPreviewMeta;
}

export async function readPreviewPage(fileId: string, page: number) {
  return readFile(path.join(filePreviewDir(fileId), `page-${safePage(page)}.jpg`));
}
