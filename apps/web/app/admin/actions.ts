"use server";

import { readServerEnv } from "../lib/env";

function apiBase() {
  return readServerEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
}

function authHeaders() {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${readServerEnv("PASS_API_TOKEN")}`,
    "Content-Type": "application/json",
  };
}

export async function connectIntegration(provider: string, token: string) {
  const res = await fetch(`${apiBase()}/admin/integrations/${provider}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to connect ${provider}: ${res.status} ${text}`);
  }
  return res.json();
}

export async function disconnectIntegration(provider: string) {
  const res = await fetch(`${apiBase()}/admin/integrations/${provider}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to disconnect ${provider}: ${res.status} ${text}`);
  }
  return res.json();
}

export async function revalidateIntegration(provider: string) {
  const res = await fetch(`${apiBase()}/admin/integrations/${provider}/validate`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to revalidate ${provider}: ${res.status} ${text}`);
  }
  return res.json();
}

export async function deleteBrandAsset(id: string) {
  const res = await fetch(`${apiBase()}/admin/brand-assets/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete asset ${id}: ${res.status} ${text}`);
  }
  return res.json();
}