import { readServerEnv } from "../../../../../lib/env";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      runId: string;
      artifactName: string;
    }>;
  }
) {
  const { runId, artifactName } = await context.params;
  const baseUrl = readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
  const token = readServerEnv("PASS_API_TOKEN");

  const response = await fetch(
    `${baseUrl}/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactName)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const text = await response.text();
    return new Response(text || response.statusText, { status: response.status });
  }

  const { artifact, payload } = (await response.json()) as {
    artifact: {
      filename: string;
      content_type: string;
    };
    payload: unknown;
  };

  const body =
    typeof payload === "string"
      ? payload
      : JSON.stringify(payload, null, 2);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": artifact.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
    },
  });
}
