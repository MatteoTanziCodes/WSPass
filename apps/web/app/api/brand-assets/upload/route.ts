// apps/web/app/api/brand-assets/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { readServerEnv } from "../../../lib/env";

export async function POST(req: NextRequest) {
  const base = readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
  const token = readServerEnv("PASS_API_TOKEN");

  const formData = await req.formData();

  const res = await fetch(`${base}/admin/brand-assets/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}