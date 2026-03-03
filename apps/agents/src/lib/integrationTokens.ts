import type { IntegrationProvider } from "@pass/shared";

const tokenCache = new Map<IntegrationProvider, string | null>();

function normalizeBaseUrl(value: string | undefined) {
  return value?.replace(/\/+$/, "") ?? null;
}

async function fetchStoredIntegrationToken(provider: IntegrationProvider): Promise<string | null> {
  const baseUrl = normalizeBaseUrl(process.env.PASS_API_BASE_URL);
  const apiToken = process.env.PASS_API_TOKEN;

  if (!baseUrl || !apiToken) {
    return null;
  }

  try {
    const response = await fetch(`${baseUrl}/integrations/${provider}/token`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { token?: string };
    return payload.token?.trim() || null;
  } catch {
    return null;
  }
}

function readFallbackEnvToken(names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export async function resolveIntegrationToken(
  provider: IntegrationProvider,
  fallbackEnvNames: string[],
  requiredMessage: string
) {
  if (tokenCache.has(provider)) {
    const cached = tokenCache.get(provider);
    if (cached) {
      return cached;
    }
  }

  const token =
    (await fetchStoredIntegrationToken(provider)) ??
    readFallbackEnvToken(fallbackEnvNames);

  tokenCache.set(provider, token ?? null);

  if (!token) {
    throw new Error(requiredMessage);
  }

  return token;
}

