import { NextResponse } from "next/server";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { readPreviewPage, readPreviewPageByDriveFileId } from "@/lib/preview/store";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    fileId: string;
    page: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext) {
  try {
    const { fileId, page } = await context.params;
    const pageNumber = Number(page.replace(/\.jpe?g$/i, ""));
    const previewDriveFileId = new URL(request.url).searchParams.get("pid");
    const supabase = createAdminClient();
    const { data: file, error } = await supabase
      .from("files")
      .select("uploader_id")
      .eq("id", fileId)
      .is("deleted_at", null)
      .single();

    if (error || !file) {
      return new NextResponse("Preview not found", { status: 404 });
    }

    const refreshToken = await getGoogleRefreshTokenForUser(file.uploader_id);
    const bytes = previewDriveFileId
      ? await readPreviewPageByDriveFileId(previewDriveFileId, refreshToken)
      : await readPreviewPage(fileId, pageNumber, refreshToken);

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="preview-${pageNumber}.jpg"`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Preview not found", { status: 404 });
  }
}
