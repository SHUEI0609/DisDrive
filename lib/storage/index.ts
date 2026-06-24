import { GoogleDriveStorageProvider } from "@/lib/storage/google-drive";
import type { StorageProvider } from "@/lib/storage/storage-provider";

type StorageProviderOptions = {
  refreshToken: string;
};

export function getStorageProvider(
  provider = "google_drive",
  options: StorageProviderOptions,
): StorageProvider {
  switch (provider) {
    case "google_drive":
      return new GoogleDriveStorageProvider(options.refreshToken);
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
}
