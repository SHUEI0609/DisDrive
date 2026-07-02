import { getGoogleAccessToken, exportDriveOfficeFileAsPdf } from "@/lib/storage/google-drive";
import { createDiscordPreview, createPdfPreview, type PreviewResult } from "@/lib/preview/create-preview";

function isPdf(mimeType: string, fileName: string) {
  return mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

async function downloadDriveFile(input: {
  refreshToken: string;
  driveFileId: string;
}) {
  const accessToken = await getGoogleAccessToken(input.refreshToken);
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${input.driveFileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to download Drive file: ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function createDriveBackedPreview(input: {
  refreshToken: string;
  driveFileId: string;
  fileName: string;
  mimeType: string;
  fallbackBytes?: Buffer;
}): Promise<PreviewResult> {
  if (isPdf(input.mimeType, input.fileName)) {
    const pdfBytes =
      input.fallbackBytes ??
      await downloadDriveFile({
        refreshToken: input.refreshToken,
        driveFileId: input.driveFileId,
      });

    return createPdfPreview({
      fileName: input.fileName,
      bytes: pdfBytes,
    });
  }

  const convertedPdf = await exportDriveOfficeFileAsPdf({
    refreshToken: input.refreshToken,
    driveFileId: input.driveFileId,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });

  if (convertedPdf) {
    return createPdfPreview({
      fileName: `${input.fileName}.pdf`,
      bytes: convertedPdf,
    });
  }

  const bytes =
    input.fallbackBytes ??
    await downloadDriveFile({
      refreshToken: input.refreshToken,
      driveFileId: input.driveFileId,
    });

  return createDiscordPreview({
    fileName: input.fileName,
    mimeType: input.mimeType,
    bytes,
  });
}
