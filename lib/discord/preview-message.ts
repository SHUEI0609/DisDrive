import { formatBytes } from "@/lib/files/format";
import { env } from "@/lib/env";

type BuildPreviewMessageInput = {
  fileId: string;
  fileName: string;
  sizeBytes: number;
  discordUserId: string;
  driveFileId: string;
  page: number;
  totalPages: number;
  note?: string;
  imageUrl?: string;
};

export function buildDocumentPreviewMessage(input: BuildPreviewMessageInput) {
  const page = Math.min(Math.max(input.page, 1), input.totalPages);
  const previewUrl = input.imageUrl ?? "attachment://preview.jpg";
  const contentLines = [
    "ファイルを保存しました",
    `ファイル名: ${input.fileName}`,
    `サイズ: ${formatBytes(input.sizeBytes)}`,
    `投稿者: <@${input.discordUserId}>`,
    `プレビュー: ${page}/${input.totalPages}ページ`,
  ];

  if (input.note) {
    contentLines.push(input.note);
  }

  return {
    content: contentLines.join("\n"),
    embeds: [
      {
        image: {
          url: previewUrl,
        },
      },
    ],
    attachments: previewUrl.startsWith("attachment://")
      ? [
          {
            id: "0",
            filename: "preview.jpg",
          },
        ]
      : [],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "前へ",
            custom_id: `preview:${input.fileId}:${page - 1}:${input.totalPages}`,
            disabled: page <= 1,
          },
          {
            type: 2,
            style: 2,
            label: "次へ",
            custom_id: `preview:${input.fileId}:${page + 1}:${input.totalPages}`,
            disabled: page >= input.totalPages,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "詳細",
            url: `${env.APP_URL}/files/${input.fileId}`,
          },
          {
            type: 2,
            style: 5,
            label: "Driveで開く",
            url: `https://drive.google.com/file/d/${input.driveFileId}/view`,
          },
        ],
      },
    ],
  };
}
