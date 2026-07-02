import { NextResponse } from "next/server";
import { getGoogleRefreshTokenForUser } from "@/lib/google/accounts";
import { readPreviewPage } from "@/lib/preview/store";
import { createAdminClient } from "@/lib/supabase/admin";

type RouteContext = {
  params: Promise<{
    fileId: string;
    page: string;
  }>;
};

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { fileId, page } = await context.params;
    const pageNumber = Number(page.replace(/\.jpe?g$/i, ""));
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
    const bytes = await readPreviewPage(fileId, pageNumber, refreshToken);

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="preview-${pageNumber}.jpg"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("Preview not found", { status: 404 });
  }
}
