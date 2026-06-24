export type CreateUploadSessionInput = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string;
};

export type UploadSession = {
  uploadUrl: string;
  providerSessionId: string;
  expiresAt: string;
};

export type GetDownloadInput = {
  storageKey: string;
};

export type DownloadResult = {
  url: string;
};

export type StoredObjectMetadata = {
  storageKey: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export interface StorageProvider {
  createUploadSession(input: CreateUploadSessionInput): Promise<UploadSession>;
  getDownload(input: GetDownloadInput): Promise<DownloadResult>;
  deleteObject(storageKey: string): Promise<void>;
  getMetadata(storageKey: string): Promise<StoredObjectMetadata>;
}
