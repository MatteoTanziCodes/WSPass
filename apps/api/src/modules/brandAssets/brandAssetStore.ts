import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  BrandAssetSchema,
  BrandAssetsIndexSchema,
  BrandAssetTypeSchema,
  type BrandAsset,
  type BrandAssetType,
} from "@pass/shared";
import { ensureDir, readJson, writeJsonAtomic } from "../runs/jsonFileStorage";

const DATA_DIR = path.resolve(process.cwd(), "data/brand-assets");
const FILES_DIR = path.join(DATA_DIR, "files");
const INDEX_PATH = path.join(DATA_DIR, "index.json");
const EMPTY_INDEX = { version: 1 as const, assets: [] };

export class BrandAssetNotFoundError extends Error {
  constructor(id: string) {
    super(`Brand asset not found: ${id}`);
    this.name = "BrandAssetNotFoundError";
  }
}

export class BrandAssetStore {
  private async readIndex() {
    await ensureDir(DATA_DIR);
    try {
      return await readJson(INDEX_PATH, BrandAssetsIndexSchema);
    } catch {
      return EMPTY_INDEX;
    }
  }

  private async writeIndex(index: z.infer<typeof BrandAssetsIndexSchema>) {
    await ensureDir(DATA_DIR);
    await writeJsonAtomic(INDEX_PATH, index);
  }

  async listAssets(): Promise<BrandAsset[]> {
    const index = await this.readIndex();
    return index.assets;
  }

  async listAssetsByType(type: BrandAssetType): Promise<BrandAsset[]> {
    const assets = await this.listAssets();
    return assets.filter((a) => a.type === type);
  }

  async getAsset(id: string): Promise<BrandAsset | null> {
    const index = await this.readIndex();
    return index.assets.find((a) => a.id === id) ?? null;
  }

  async saveAsset(
    type: BrandAssetType,
    name: string,
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    usageHint?: string,
    tags: string[] = []
  ): Promise<BrandAsset> {
    await ensureDir(FILES_DIR);

    const id = randomUUID();
    const ext = path.extname(fileName) || "";
    const storedFileName = `${id}${ext}`;
    const filePath = path.join(FILES_DIR, storedFileName);

    const sha256 = createHash("sha256").update(buffer).digest("hex");

    // Write file atomically
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, buffer);
    try {
      await fs.rename(tmp, filePath);
    } catch (err: any) {
      if (err?.code === "EEXIST" || err?.code === "EPERM") {
        await fs.unlink(filePath).catch(() => undefined);
        await fs.rename(tmp, filePath);
      } else throw err;
    }

    const now = new Date().toISOString();
    const asset: BrandAsset = {
      id,
      type,
      name,
      tags,
      file_name: storedFileName,
      mime_type: mimeType,
      sha256,
      usage_hint: usageHint,
      created_at: now,
      updated_at: now,
    };

    const index = await this.readIndex();
    index.assets.push(asset);
    await this.writeIndex(index);

    return asset;
  }

  async deleteAsset(id: string): Promise<void> {
    const index = await this.readIndex();
    const asset = index.assets.find((a) => a.id === id);
    if (!asset) throw new BrandAssetNotFoundError(id);

    // Remove file
    const filePath = path.join(FILES_DIR, asset.file_name);
    await fs.unlink(filePath).catch(() => undefined);

    // Remove from index
    index.assets = index.assets.filter((a) => a.id !== id);
    await this.writeIndex(index);
  }

  async getFilePath(id: string): Promise<string> {
    const asset = await this.getAsset(id);
    if (!asset) throw new BrandAssetNotFoundError(id);
    return path.join(FILES_DIR, asset.file_name);
  }
}