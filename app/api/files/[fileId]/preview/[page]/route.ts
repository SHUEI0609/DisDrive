import { NextResponse } from "next/server";
import { readPreviewPage } from "@/lib/preview/store";

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
    const bytes = await readPreviewPage(fileId, pageNumber);

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
