import { z } from "zod";

export const BrandAssetTypeSchema = z.enum(["logo", "font"]);
export type BrandAssetType = z.infer<typeof BrandAssetTypeSchema>;

export const BrandAssetSchema = z
  .object({
    id: z.string().min(1),
    type: BrandAssetTypeSchema,
    name: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
    file_name: z.string().min(1),
    mime_type: z.string().min(1),
    sha256: z.string().min(1),
    usage_hint: z.string().min(1).optional(), // e.g. "primary logo", "headline font"
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type BrandAsset = z.infer<typeof BrandAssetSchema>;

export const BrandAssetsIndexSchema = z
  .object({
    version: z.literal(1),
    assets: z.array(BrandAssetSchema).default([]),
  })
  .strict();
export type BrandAssetsIndex = z.infer<typeof BrandAssetsIndexSchema>;