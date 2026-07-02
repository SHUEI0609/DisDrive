import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { env } from "@/lib/env";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { hashUploadToken } from "@/lib/security/token";
import { createDriveClient } from "@/lib/storage/google-drive";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

const requestSchema = z.object({
  fileId: z.string().uuid(),
});

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.discordUserId) {
      throw new AppError("Discordログインが必要です。", 401, "AUTH_REQUIRED");
    }

    const input = requestSchema.parse(await request.json());
    const { token } = await context.params;
    const tokenHash = hashUploadToken(token);
    const supabase = createAdminClient();

    const { data: uploadSession, error: sessionError } = await supabase
      .from("upload_sessions")
      .select(`
        id,
        file_id,
        requester_id,
        requester:users!upload_sessions_requester_id_fkey(discord_user_id),
        file:files(id, display_name, mime_type, size_bytes)
      `)
      .eq("token_hash", tokenHash)
      .single();

    if (sessionError || !uploadSession || uploadSession.file_id !== input.fileId) {
      throw new AppError("アップロードセッションが見つかりません。", 404, "TOKEN_INVALID");
    }

    const requester = Array.isArray(uploadSession.requester)
      ? uploadSession.requester[0]
      : uploadSession.requester;

    if (requester?.discord_user_id !== session.discordUserId) {
      throw new AppError("このアップロードURLは別のユーザー用です。", 403, "USER_MISMATCH");
    }

    const file = Array.isArray(uploadSession.file)
      ? uploadSession.file[0]
      : uploadSession.file;

    if (!file) {
      throw new AppError("復旧対象のファイル情報が見つかりません。", 404, "FILE_NOT_FOUND");
    }

    const refreshToken = await getGoogleRefreshTokenForUser(uploadSession.requester_id);
    const drive = createDriveClient(refreshToken);
    const baseQuery = [
      `name = '${escapeDriveQueryValue(file.display_name)}'`,
      "trashed = false",
    ];
    const folderQuery = [
      ...baseQuery,
      ...(env.GOOGLE_DRIVE_ROOT_FOLDER_ID
        ? [`'${escapeDriveQueryValue(env.GOOGLE_DRIVE_ROOT_FOLDER_ID)}' in parents`]
        : []),
    ].join(" and ");

    async function findRecoveredFile(query: string) {
      const response = await drive.files.list({
        q: query,
        orderBy: "createdTime desc",
        pageSize: 10,
        fields: "files(id,name,mimeType,size,createdTime)",
      });

      const expectedSize = Number(file.size_bytes);
      return response.data.files?.find((candidate) => {
        return Number(candidate.size ?? -1) === expectedSize;
      });
    }

    const recoveredFile =
      (await findRecoveredFile(folderQuery)) ??
      (env.GOOGLE_DRIVE_ROOT_FOLDER_ID
        ? await findRecoveredFile(baseQuery.join(" and "))
        : null);

    if (!recoveredFile?.id) {
      throw new AppError(
        "Google Drive上に同じファイルを確認できませんでした。続きから再開してください。",
        404,
        "DRIVE_FILE_NOT_RECOVERED",
      );
    }

    return Response.json({
      driveFileId: recoveredFile.id,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
