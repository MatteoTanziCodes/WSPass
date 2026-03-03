import "server-only";
import type { IntegrationProvider } from "@pass/shared";
import { readServerEnv } from "./env";

const tokenCache = new Map<IntegrationProvider, string | null>();

function apiBase() {
  return readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
}

async function fetchStoredIntegrationToken(provider: IntegrationProvider): Promise<string | null> {
  try {
    const response = await fetch(`${apiBase()}/integrations/${provider}/token`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${readServerEnv("PASS_API_TOKEN")}`,
      },
      cache: "no-store",
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

export async function resolveIntegrationToken(provider: IntegrationProvider, fallbackEnvNames: string[]) {
  if (tokenCache.has(provider)) {
    return tokenCache.get(provider) ?? null;
  }

  const token =
    (await fetchStoredIntegrationToken(provider)) ??
    readFallbackEnvToken(fallbackEnvNames);

  tokenCache.set(provider, token ?? null);
  return token ?? null;
}

