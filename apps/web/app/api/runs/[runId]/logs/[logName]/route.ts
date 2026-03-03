import { readServerEnv } from "../../../../../lib/env";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      runId: string;
      logName: string;
    }>;
  }
) {
  const { runId, logName } = await context.params;
  const baseUrl = readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
  const token = readServerEnv("PASS_API_TOKEN");

  const response = await fetch(
    `${baseUrl}/runs/${encodeURIComponent(runId)}/logs/${encodeURIComponent(logName)}`,
    {
      headers: {
        Accept: "text/plain",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    return new Response(text || response.statusText, { status: response.status });
  }

  return new Response(await response.text(), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
