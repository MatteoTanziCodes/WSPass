"use client";

import { useRef, useState } from "react";
import { deleteBrandAsset } from "./actions";

type BrandAsset = {
  id: string;
  type: "logo" | "font";
  name: string;
  tags: string[];
  usage_hint?: string;
  created_at: string;
};

function AssetRow({ asset, onDelete }: { asset: BrandAsset; onDelete: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteBrandAsset(asset.id);
      onDelete(asset.id);
    } finally {
      setDeleting(false);
    }
  }

  const ref = `brand:${asset.type}:${asset.name}`;

  return (
    <tr className="border-b border-[color:var(--line)] last:border-0">
      <td className="py-3 pr-4 font-mono text-xs text-[color:var(--ink-strong)]">{asset.name}</td>
      <td className="py-3 pr-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--accent)]">{asset.type}</td>
      <td className="py-3 pr-4 font-mono text-[10px] text-[color:var(--muted)]">{asset.usage_hint ?? "—"}</td>
      <td className="py-3 pr-4 font-mono text-[10px] text-[color:var(--muted)]">
        {asset.tags.length > 0 ? asset.tags.join(", ") : "—"}
      </td>
      <td className="py-3 pr-4">
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(ref)}
          className="font-mono text-[10px] text-[color:var(--muted)] underline underline-offset-2 transition hover:text-[color:var(--ink)]"
        >
          {ref}
        </button>
      </td>
      <td className="py-3 text-right">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--muted)] transition hover:text-red-500 disabled:opacity-40"
        >
          {deleting ? "…" : "Delete"}
        </button>
      </td>
    </tr>
  );
}

export function BrandAssetsPanel({ assets: initialAssets }: { assets: BrandAsset[] }) {
  const [assets, setAssets] = useState<BrandAsset[]>(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formState, setFormState] = useState({
    type: "logo" as "logo" | "font",
    name: "",
    usageHint: "",
    tags: "",
  });

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !formState.name.trim()) return;

    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", formState.type);
      fd.append("name", formState.name.trim());
      if (formState.usageHint.trim()) fd.append("usage_hint", formState.usageHint.trim());
      if (formState.tags.trim()) fd.append("tags", formState.tags.trim());

      const res = await fetch("/api/brand-assets/upload", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      setAssets((prev) => [...prev, data.asset]);
      setFormState({ type: "logo", name: "", usageHint: "", tags: "" });
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function handleDelete(id: string) {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <section className="border border-[color:var(--line)] bg-[color:var(--panel)] p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)]">
        Brand Assets
      </p>
      <p className="mt-2 font-mono text-xs text-[color:var(--muted)]">
        Upload logos and fonts. Agents will reference stored assets when PRDs mention them.
      </p>

      {/* Upload form */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select
          value={formState.type}
          onChange={(e) => setFormState((s) => ({ ...s, type: e.target.value as "logo" | "font" }))}
          className="border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2 font-mono text-xs text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
        >
          <option value="logo">Logo</option>
          <option value="font">Font</option>
        </select>
        <input
          type="text"
          placeholder="Name (e.g. Primary Logo)"
          value={formState.name}
          onChange={(e) => setFormState((s) => ({ ...s, name: e.target.value }))}
          className="border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2 font-mono text-xs text-[color:var(--ink)] placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:outline-none"
        />
        <input
          type="text"
          placeholder="Usage hint (optional)"
          value={formState.usageHint}
          onChange={(e) => setFormState((s) => ({ ...s, usageHint: e.target.value }))}
          className="border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2 font-mono text-xs text-[color:var(--ink)] placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:outline-none"
        />
        <input
          type="text"
          placeholder="Tags (comma-separated)"
          value={formState.tags}
          onChange={(e) => setFormState((s) => ({ ...s, tags: e.target.value }))}
          className="border border-[color:var(--line)] bg-[color:var(--bg)] px-3 py-2 font-mono text-xs text-[color:var(--ink)] placeholder:text-[color:var(--muted)] focus:border-[color:var(--accent)] focus:outline-none"
        />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <input ref={fileInputRef} type="file" className="font-mono text-xs text-[color:var(--ink)]" />
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading || !formState.name.trim()}
          className="border border-[color:var(--line-strong)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
      {uploadError && <p className="mt-2 font-mono text-[10px] text-red-500">{uploadError}</p>}

      {/* Asset table */}
      {assets.length === 0 ? (
        <p className="mt-8 font-mono text-xs text-[color:var(--muted)]">No assets uploaded yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[color:var(--line)]">
                {["Name", "Type", "Usage hint", "Tags", "Reference", ""].map((h) => (
                  <th key={h} className="pb-2 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--muted)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <AssetRow key={a.id} asset={a} onDelete={handleDelete} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}