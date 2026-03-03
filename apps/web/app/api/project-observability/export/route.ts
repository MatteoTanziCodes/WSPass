import { readServerEnv } from "../../../lib/env";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectKey = searchParams.get("project_key")?.trim();

  if (!projectKey) {
    return new Response("project_key is required", { status: 400 });
  }

  const baseUrl = readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
  const token = readServerEnv("PASS_API_TOKEN");

  const response = await fetch(
    `${baseUrl}/project-observability/export?project_key=${encodeURIComponent(projectKey)}`,
    {
      headers: {
        Accept: "application/zip",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    return new Response(text || response.statusText, { status: response.status });
  }

  const contentDisposition = response.headers.get("content-disposition");
  const contentType = response.headers.get("content-type") ?? "application/zip";
  const buffer = await response.arrayBuffer();

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      ...(contentDisposition ? { "Content-Disposition": contentDisposition } : {}),
    },
  });
}
