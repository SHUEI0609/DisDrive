import { google } from "googleapis";
import { Readable } from "node:stream";
import { env, requireEnv } from "@/lib/env";
import { sanitizeFileName } from "@/lib/security/sanitize";
import type {
  CreateUploadSessionInput,
  DownloadResult,
  StorageProvider,
  StoredObjectMetadata,
  UploadSession,
} from "@/lib/storage/storage-provider";

function createOAuthClient(refreshToken: string) {
  const client = new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
  );

  client.setCredentials({
    refresh_token: refreshToken,
  });

  return client;
}

export async function getGoogleAccessToken(refreshToken: string) {
  const auth = createOAuthClient(refreshToken);
  const { token } = await auth.getAccessToken();

  if (!token) {
    throw new Error("Failed to obtain Google access token.");
  }

  return token;
}

export function createDriveClient(refreshToken: string) {
  return google.drive({
    version: "v3",
    auth: createOAuthClient(refreshToken),
  });
}

function googleWorkspaceMimeTypeForOffice(input: {
  fileName: string;
  mimeType: string;
}) {
  const lowerName = input.fileName.toLowerCase();

  if (
    input.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    input.mimeType === "application/vnd.ms-powerpoint" ||
    lowerName.endsWith(".pptx") ||
    lowerName.endsWith(".ppt")
  ) {
    return "application/vnd.google-apps.presentation";
  }

  if (
    input.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    input.mimeType === "application/msword" ||
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc")
  ) {
    return "application/vnd.google-apps.document";
  }

  return null;
}

export async function exportDriveOfficeFileAsPdf(input: {
  refreshToken: string;
  driveFileId: string;
  fileName: string;
  mimeType: string;
}) {
  const googleMimeType = googleWorkspaceMimeTypeForOffice(input);

  if (!googleMimeType) {
    return null;
  }

  const drive = createDriveClient(input.refreshToken);
  const converted = await drive.files.copy({
    fileId: input.driveFileId,
    requestBody: {
      name: `${input.fileName}.preview`,
      mimeType: googleMimeType,
    },
    fields: "id",
  });
  const convertedFileId = converted.data.id;

  if (!convertedFileId) {
    throw new Error("Google Drive did not return a converted document id.");
  }

  try {
    const exported = await drive.files.export(
      {
        fileId: convertedFileId,
        mimeType: "application/pdf",
      },
      {
        responseType: "arraybuffer",
      },
    );

    return Buffer.from(exported.data as ArrayBuffer);
  } finally {
    await drive.files.delete({ fileId: convertedFileId }).catch(() => undefined);
  }
}

export class GoogleDriveStorageProvider implements StorageProvider {
  constructor(private readonly refreshToken: string) {}

  async createUploadSession(input: CreateUploadSessionInput): Promise<UploadSession> {
    const auth = createOAuthClient(this.refreshToken);
    const { token } = await auth.getAccessToken();

    if (!token) {
      throw new Error("Failed to obtain Google access token.");
    }

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": input.mimeType,
          "X-Upload-Content-Length": String(input.sizeBytes),
        },
        body: JSON.stringify({
          name: sanitizeFileName(input.fileName),
          ...(input.folderId || env.GOOGLE_DRIVE_ROOT_FOLDER_ID
            ? { parents: [input.folderId ?? env.GOOGLE_DRIVE_ROOT_FOLDER_ID] }
            : {}),
        }),
      },
    );

    const uploadUrl = response.headers.get("location");

    if (!response.ok || !uploadUrl) {
      throw new Error(`Failed to create Drive upload session: ${await response.text()}`);
    }

    return {
      uploadUrl,
      providerSessionId: uploadUrl,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  async getDownload(input: { storageKey: string }): Promise<DownloadResult> {
    return {
      url: `https://drive.google.com/file/d/${input.storageKey}/view`,
    };
  }

  async uploadObject(input: {
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    folderId?: string;
  }) {
    const drive = createDriveClient(this.refreshToken);
    const folderId = input.folderId ?? env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const response = await drive.files.create({
      requestBody: {
        name: sanitizeFileName(input.fileName),
        ...(folderId ? { parents: [folderId] } : {}),
      },
      media: {
        mimeType: input.mimeType,
        body: Readable.from(input.bytes),
      },
      fields: "id,name,mimeType,size",
    });

    if (!response.data.id) {
      throw new Error("Google Drive upload did not return a file id.");
    }

    if (env.GOOGLE_DRIVE_LINK_EMBEDS) {
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          type: "anyone",
          role: "reader",
        },
      });
    }

    return {
      storageKey: response.data.id,
      name: response.data.name ?? input.fileName,
      mimeType: response.data.mimeType ?? input.mimeType,
      sizeBytes: Number(response.data.size ?? input.bytes.length),
    };
  }

  async deleteObject(storageKey: string): Promise<void> {
    const drive = createDriveClient(this.refreshToken);
    await drive.files.delete({
      fileId: storageKey,
    });
  }

  async getMetadata(storageKey: string): Promise<StoredObjectMetadata> {
    const drive = createDriveClient(this.refreshToken);
    const response = await drive.files.get({
      fileId: storageKey,
      fields: "id,name,mimeType,size",
    });

    return {
      storageKey,
      name: response.data.name ?? storageKey,
      mimeType: response.data.mimeType ?? "application/octet-stream",
      sizeBytes: Number(response.data.size ?? 0),
    };
  }
}
