import { NextRequest, NextResponse } from "next/server";
import { listImages } from "@/lib/repo/images";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json({ images: listImages(projectId) });
}
