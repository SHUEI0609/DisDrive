import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as canvas from "@napi-rs/canvas";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

export type PreviewResult = {
  textPreview?: string;
  files: Array<{
    name: string;
    contentType: string;
    bytes: Buffer;
  }>;
  pages?: Array<{
    name: string;
    contentType: string;
    bytes: Buffer;
  }>;
  note?: string;
};

const maxDiscordPreviewBytes = 8 * 1024 * 1024;
function isLikelyText(mimeType: string, fileName: string) {
  const lowerName = fileName.toLowerCase();

  return (
    mimeType.startsWith("text/") ||
    [
      ".txt",
      ".md",
      ".csv",
      ".json",
      ".log",
      ".yaml",
      ".yml",
      ".xml",
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".css",
      ".html",
    ].some((extension) => lowerName.endsWith(extension))
  );
}

function fileExtension(fileName: string) {
  return path.extname(fileName).toLowerCase();
}

async function commandExists(command: string) {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

function isDocumentPreviewTarget(mimeType: string, fileName: string) {
  const extension = fileExtension(fileName);

  return (
    mimeType === "application/pdf" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType === "application/vnd.ms-powerpoint" ||
    [".pdf", ".doc", ".docx", ".ppt", ".pptx"].includes(extension)
  );
}

function textExcerpt(bytes: Buffer) {
  const content = bytes.toString("utf8").replace(/\u0000/g, "");
  const excerpt = content.slice(0, 1600);

  if (content.length > excerpt.length) {
    return `${excerpt}\n...`;
  }

  return excerpt;
}

async function createImagePreview(bytes: Buffer): Promise<PreviewResult> {
  const image = await sharp(bytes)
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 78,
      mozjpeg: true,
    })
    .toBuffer();

  if (image.byteLength > maxDiscordPreviewBytes) {
    const smaller = await sharp(image)
      .resize({
        width: 1000,
        height: 1000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 68,
        mozjpeg: true,
      })
      .toBuffer();

    return {
      files: [
        {
          name: "preview.jpg",
          contentType: "image/jpeg",
          bytes: smaller,
        },
      ],
    };
  }

  return {
    files: [
      {
        name: "preview.jpg",
        contentType: "image/jpeg",
        bytes: image,
      },
    ],
  };
}

async function createVideoPreview(
  bytes: Buffer,
  mimeType: string,
  fileName: string,
): Promise<PreviewResult> {
  const extension = path.extname(fileName).toLowerCase();

  if ((mimeType === "video/mp4" || extension === ".mp4") && bytes.byteLength <= maxDiscordPreviewBytes) {
    return {
      files: [
        {
          name: fileName,
          contentType: "video/mp4",
          bytes,
        },
      ],
    };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "cloudbot-preview-"));
  const inputExtension = extension || ".mp4";
  const inputPath = path.join(workDir, `input${inputExtension}`);
  const clipPath = path.join(workDir, "preview.mp4");
  const imagePath = path.join(workDir, "preview.jpg");

  try {
    await writeFile(inputPath, bytes);

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "scale='min(1280,iw)':-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "36",
      "-an",
      "-movflags",
      "+faststart",
      clipPath,
    ]);

    const clip = await readFile(clipPath);

    if (clip.byteLength <= maxDiscordPreviewBytes) {
      return {
        files: [
          {
            name: "preview.mp4",
            contentType: "video/mp4",
            bytes: clip,
          },
        ],
        note: "動画全体をDiscord用に圧縮して表示しています。",
      };
    }

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-t",
      "8",
      "-vf",
      "scale='min(1280,iw)':-2",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "34",
      "-an",
      "-movflags",
      "+faststart",
      clipPath,
    ]);

    const shortClip = await readFile(clipPath);

    if (shortClip.byteLength <= maxDiscordPreviewBytes) {
      return {
        files: [
          {
            name: "preview.mp4",
            contentType: "video/mp4",
            bytes: shortClip,
          },
        ],
        note: "Discord添付上限を超えたため、短いプレビューを表示しています。全編は「動画を再生」から見られます。",
      };
    }

    await execFileAsync("ffmpeg", [
      "-y",
      "-ss",
      "1",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      "scale='min(1280,iw)':-2",
      imagePath,
    ]);

    const image = await readFile(imagePath);

    return {
      files: [
        {
          name: "preview.jpg",
          contentType: "image/jpeg",
          bytes: image,
        },
      ],
      note: "Discord添付上限を超えたため、サムネイルを表示しています。全編は「動画を再生」から見られます。",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function createQuickLookPreview(input: {
  fileName: string;
  bytes: Buffer;
}): Promise<PreviewResult> {
  if (!(await commandExists("qlmanage"))) {
    return {
      files: [],
      note: "この環境ではこのファイル形式のプレビューを生成できませんでした。",
    };
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "cloudbot-ql-"));
  const inputPath = path.join(workDir, input.fileName);
  const outputDir = path.join(workDir, "out");

  try {
    await writeFile(inputPath, input.bytes);
    await mkdir(outputDir, { recursive: true });

    await execFileAsync("qlmanage", [
      "-t",
      "-s",
      "1400",
      "-o",
      outputDir,
      inputPath,
    ], {
      timeout: 45_000,
    });

    const outputs = await readdir(outputDir);
    const previewName = outputs.find((name) => /\.(png|jpe?g)$/i.test(name));

    if (!previewName) {
      return {
        files: [],
        note: "このファイル形式のサムネイルを生成できませんでした。",
      };
    }

    const rawPreview = await readFile(path.join(outputDir, previewName));
    const jpegPreview = await sharp(rawPreview)
      .resize({
        width: 1400,
        height: 1800,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 78,
        mozjpeg: true,
      })
      .toBuffer();

    return {
      files: [],
      pages: [
        {
          name: "document-preview.jpg",
          contentType: "image/jpeg",
          bytes: jpegPreview,
        },
      ],
      note: "先頭ページ/スライドのプレビューを表示しています。",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function readPreviewImages(
  outputDir: string,
): Promise<NonNullable<PreviewResult["pages"]>> {
  const outputs = await readdir(outputDir);
  const previewNames = outputs
    .filter((name) => /\.(png|jpe?g)$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  return Promise.all(
    previewNames.map(async (previewName, index) => {
      const rawPreview = await readFile(path.join(outputDir, previewName));
      const jpegPreview = await sharp(rawPreview)
        .resize({
          width: 1400,
          height: 1800,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({
          quality: 78,
          mozjpeg: true,
        })
        .toBuffer();

      return {
        name: `document-preview-${index + 1}.jpg`,
        contentType: "image/jpeg",
        bytes: jpegPreview,
      };
    }),
  );
}

export async function createPdfPreview(input: {
  fileName: string;
  bytes: Buffer;
}): Promise<PreviewResult> {
  if (!(await commandExists("pdftoppm"))) {
    return createPdfPreviewWithPdfJs(input);
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "cloudbot-pdf-"));
  const inputPath = path.join(workDir, input.fileName);
  const outputPrefix = path.join(workDir, "page");

  try {
    await writeFile(inputPath, input.bytes);
    await execFileAsync("pdftoppm", [
      "-jpeg",
      "-r",
      "120",
      "-f",
      "1",
      inputPath,
      outputPrefix,
    ], {
      timeout: 180_000,
    });

    const pages = await readPreviewImages(workDir);

    if (!pages.length) {
      return createQuickLookPreview(input);
    }

    return {
      files: [],
      pages,
      note: `${pages.length}ページすべてをプレビューできます。`,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function createPdfPreviewWithPdfJs(input: {
  fileName: string;
  bytes: Buffer;
}): Promise<PreviewResult> {
  const globalScope = globalThis as Record<string, unknown>;

  globalScope.DOMMatrix ??= canvas.DOMMatrix;
  globalScope.ImageData ??= canvas.ImageData;
  globalScope.Path2D ??= canvas.Path2D;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(input.bytes),
    disableWorker: true,
  } as never).promise;
  const pages: NonNullable<PreviewResult["pages"]> = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1400 / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const pageCanvas = canvas.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = pageCanvas.getContext("2d");

    await page.render({
      canvasContext: context as never,
      viewport,
    } as never).promise;

    const pngBytes = await pageCanvas.encode("png");
    const jpegPreview = await sharp(Buffer.from(pngBytes))
      .jpeg({
        quality: 78,
        mozjpeg: true,
      })
      .toBuffer();

    pages.push({
      name: `document-preview-${pageNumber}.jpg`,
      contentType: "image/jpeg",
      bytes: jpegPreview,
    });
  }

  return {
    files: [],
    pages,
    note: `${pages.length}ページすべてをプレビューできます。`,
  };
}

async function createOfficeDocumentPreview(input: {
  fileName: string;
  bytes: Buffer;
}): Promise<PreviewResult> {
  const officeCommand = (await commandExists("soffice"))
    ? "soffice"
    : (await commandExists("libreoffice"))
      ? "libreoffice"
      : null;

  if (!officeCommand || !(await commandExists("pdftoppm"))) {
    return createQuickLookPreview(input);
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "cloudbot-office-"));
  const inputPath = path.join(workDir, input.fileName);
  const pdfDir = path.join(workDir, "pdf");

  try {
    await writeFile(inputPath, input.bytes);
    await mkdir(pdfDir, { recursive: true });
    await execFileAsync(officeCommand, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      pdfDir,
      inputPath,
    ], {
      timeout: 180_000,
    });

    const outputs = await readdir(pdfDir);
    const pdfName = outputs.find((name) => name.toLowerCase().endsWith(".pdf"));

    if (!pdfName) {
      return createQuickLookPreview(input);
    }

    const pdfBytes = await readFile(path.join(pdfDir, pdfName));
    return createPdfPreview({
      fileName: pdfName,
      bytes: pdfBytes,
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function createDiscordPreview(input: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<PreviewResult> {
  if (isLikelyText(input.mimeType, input.fileName)) {
    return {
      textPreview: textExcerpt(input.bytes),
      files: [],
    };
  }

  if (input.mimeType.startsWith("image/")) {
    return createImagePreview(input.bytes);
  }

  if (input.mimeType.startsWith("video/")) {
    return createVideoPreview(input.bytes, input.mimeType, input.fileName);
  }

  if (isDocumentPreviewTarget(input.mimeType, input.fileName)) {
    if (fileExtension(input.fileName) === ".pdf" || input.mimeType === "application/pdf") {
      return createPdfPreview({
        fileName: input.fileName,
        bytes: input.bytes,
      });
    }

    return createOfficeDocumentPreview({
      fileName: input.fileName,
      bytes: input.bytes,
    });
  }

  return {
    files: [],
  };
}
