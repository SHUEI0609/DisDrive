import { Readable } from "node:stream";
import { env } from "@/lib/env";
import { createDriveClient } from "@/lib/storage/google-drive";

export type StoredPreviewMeta = {
  totalPages: number;
};

export type PreviewPageInput = {
  bytes: Buffer;
  contentType: string;
};

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

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findFolder(input: {
  refreshToken: string;
  name: string;
  parentId?: string;
}) {
  const drive = createDriveClient(input.refreshToken);
  const query = [
    `name = '${escapeDriveQueryValue(input.name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    ...(input.parentId ? [`'${escapeDriveQueryValue(input.parentId)}' in parents`] : []),
  ].join(" and ");
  const response = await drive.files.list({
    q: query,
    pageSize: 1,
    fields: "files(id,name)",
  });

  return response.data.files?.[0]?.id ?? null;
}

async function ensureFolder(input: {
  refreshToken: string;
  name: string;
  parentId?: string;
}) {
  const existing = await findFolder(input);
  if (existing) return existing;

  const drive = createDriveClient(input.refreshToken);
  const response = await drive.files.create({
    requestBody: {
      name: input.name,
      mimeType: "application/vnd.google-apps.folder",
      ...(input.parentId ? { parents: [input.parentId] } : {}),
    },
    fields: "id",
  });

  if (!response.data.id) {
    throw new Error("Failed to create preview folder.");
  }

  return response.data.id;
}

async function previewRootFolder(refreshToken: string) {
  return ensureFolder({
    refreshToken,
    name: ".cloudbot-previews",
    parentId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
  });
}

async function filePreviewFolder(fileId: string, refreshToken: string) {
  return ensureFolder({
    refreshToken,
    name: safeFileId(fileId),
    parentId: await previewRootFolder(refreshToken),
  });
}

async function findPreviewFile(input: {
  refreshToken: string;
  folderId: string;
  name: string;
}) {
  const drive = createDriveClient(input.refreshToken);
  const response = await drive.files.list({
    q: [
      `name = '${escapeDriveQueryValue(input.name)}'`,
      "trashed = false",
      `'${escapeDriveQueryValue(input.folderId)}' in parents`,
    ].join(" and "),
    pageSize: 1,
    fields: "files(id,name)",
  });

  return response.data.files?.[0]?.id ?? null;
}

async function uploadPreviewFile(input: {
  refreshToken: string;
  folderId: string;
  name: string;
  contentType: string;
  bytes: Buffer;
}) {
  const drive = createDriveClient(input.refreshToken);
  const existingId = await findPreviewFile(input);
  const media = {
    mimeType: input.contentType,
    body: Readable.from(input.bytes),
  };

  if (existingId) {
    await drive.files.update({
      fileId: existingId,
      media,
      fields: "id",
    });
    return existingId;
  }

  const response = await drive.files.create({
    requestBody: {
      name: input.name,
      parents: [input.folderId],
    },
    media,
    fields: "id",
  });

  if (!response.data.id) {
    throw new Error(`Failed to upload preview file: ${input.name}`);
  }

  return response.data.id;
}

export async function savePreviewPages(
  fileId: string,
  pages: PreviewPageInput[],
  refreshToken: string,
) {
  const folderId = await filePreviewFolder(fileId, refreshToken);
  const meta: StoredPreviewMeta = {
    totalPages: pages.length,
  };

  await Promise.all([
    uploadPreviewFile({
      refreshToken,
      folderId,
      name: "meta.json",
      contentType: "application/json",
      bytes: Buffer.from(JSON.stringify(meta), "utf8"),
    }),
    ...pages.map((page, index) =>
      uploadPreviewFile({
        refreshToken,
        folderId,
        name: `page-${index + 1}.jpg`,
        contentType: page.contentType,
        bytes: page.bytes,
      }),
    ),
  ]);

  return meta;
}

export async function readPreviewMeta(
  fileId: string,
  refreshToken: string,
): Promise<StoredPreviewMeta> {
  const raw = await readPreviewFileByName(fileId, refreshToken, "meta.json");
  return JSON.parse(raw.toString("utf8")) as StoredPreviewMeta;
}

async function readPreviewFileByName(fileId: string, refreshToken: string, name: string) {
  const folderId = await filePreviewFolder(fileId, refreshToken);
  const fileIdInDrive = await findPreviewFile({
    refreshToken,
    folderId,
    name,
  });

  if (!fileIdInDrive) {
    throw new Error(`Preview file not found: ${name}`);
  }

  const drive = createDriveClient(refreshToken);
  const response = await drive.files.get(
    {
      fileId: fileIdInDrive,
      alt: "media",
    },
    {
      responseType: "arraybuffer",
    },
  );

  return Buffer.from(response.data as ArrayBuffer);
}

export async function readPreviewPage(fileId: string, page: number, refreshToken: string) {
  return readPreviewFileByName(fileId, refreshToken, `page-${safePage(page)}.jpg`);
}
