import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isErrorResponse } from "@/lib/api-auth";
import { apiHandler } from "@/lib/api-errors";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export const POST = apiHandler(async (req: NextRequest) => {
  const auth = await requireAuth();
  if (isErrorResponse(auth)) return auth;

  const formData = await req.formData();
  const file = formData.get("file") as File;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const storagePath = process.env.LOCAL_STORAGE_PATH || "./data";
  const uploadDir = join(storagePath, "uploads", auth.user.id);
  await mkdir(uploadDir, { recursive: true });

  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filepath = join(uploadDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const url = `/data/uploads/${auth.user.id}/${filename}`;

  return NextResponse.json({ url, filename }, { status: 201 });
});
