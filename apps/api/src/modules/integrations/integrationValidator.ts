import type { IntegrationProvider } from "@pass/shared";

export type ValidationResult =
  | { ok: true; displayName: string }
  | { ok: false; error: string };

export async function validateToken(
  provider: IntegrationProvider,
  token: string
): Promise<ValidationResult> {
  try {
    switch (provider) {
      case "github":
        return await validateGitHub(token);
      case "vercel":
        return await validateVercel(token);
      case "stripe":
        return await validateStripe(token);
      case "anthropic":
        // Anthropic validation costs tokens — we accept and trust it
        return { ok: true, displayName: "Anthropic (stored, not validated)" };
      default:
        return { ok: false, error: `Unknown provider: ${provider}` };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Validation failed" };
  }
}

async function validateGitHub(token: string): Promise<ValidationResult> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) return { ok: false, error: `GitHub returned ${res.status}` };
  const data = (await res.json()) as { login?: string };
  return { ok: true, displayName: data.login ?? "GitHub user" };
}

async function validateVercel(token: string): Promise<ValidationResult> {
  const res = await fetch("https://api.vercel.com/v2/user", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, error: `Vercel returned ${res.status}` };
  const data = (await res.json()) as { user?: { username?: string; name?: string } };
  const name = data.user?.username ?? data.user?.name ?? "Vercel user";
  return { ok: true, displayName: name };
}

async function validateStripe(token: string): Promise<ValidationResult> {
  const res = await fetch("https://api.stripe.com/v1/account", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, error: `Stripe returned ${res.status}` };
  const data = (await res.json()) as { id?: string; email?: string };
  return { ok: true, displayName: data.email ?? data.id ?? "Stripe account" };
}