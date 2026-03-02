// apps/api/src/modules/brandAssets/brandAssets.routes.ts

import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { requireAgentAuth } from "../runs/auth";
import { BrandAssetTypeSchema } from "@pass/shared";
import { BrandAssetNotFoundError, BrandAssetStore } from "./brandAssetStore";

export async function registerBrandAssetRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB limit

  const store = new BrandAssetStore();

  // GET /admin/brand-assets — list all assets metadata
  app.get("/admin/brand-assets", async (_req, reply) => {
    const assets = await store.listAssets();
    return reply.send({ assets });
  });

  // POST /admin/brand-assets/upload — upload a logo or font
  app.post(
    "/admin/brand-assets/upload",
    { preHandler: requireAgentAuth },
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: "no_file", message: "No file provided." });
      }

      // Read form fields from the multipart parts that arrive before the file
      const typeRaw = (data.fields.type as any)?.value ?? "";
      const nameRaw = (data.fields.name as any)?.value ?? data.filename;
      const usageHint = (data.fields.usage_hint as any)?.value ?? undefined;
      const tagsRaw = (data.fields.tags as any)?.value ?? "";
      const tags = tagsRaw ? tagsRaw.split(",").map((t: string) => t.trim()).filter(Boolean) : [];

      const type = BrandAssetTypeSchema.parse(typeRaw);
      const buffer = await data.toBuffer();

      const asset = await store.saveAsset(
        type,
        nameRaw,
        data.filename,
        data.mimetype,
        buffer,
        usageHint,
        tags
      );

      return reply.code(201).send({ asset });
    }
  );

  // GET /admin/brand-assets/:id — download file (auth-protected)
  app.get(
    "/admin/brand-assets/:id",
    { preHandler: requireAgentAuth },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
      try {
        const asset = await store.getAsset(id);
        if (!asset) return reply.code(404).send({ error: "not_found" });
        const filePath = await store.getFilePath(id);
        return reply.sendFile(filePath); // uses fastify's sendFile
      } catch (err) {
        if (err instanceof BrandAssetNotFoundError) {
          return reply.code(404).send({ error: "not_found" });
        }
        throw err;
      }
    }
  );

  // DELETE /admin/brand-assets/:id
  app.delete(
    "/admin/brand-assets/:id",
    { preHandler: requireAgentAuth },
    async (req, reply) => {
      const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
      try {
        await store.deleteAsset(id);
        return reply.send({ id, deleted: true });
      } catch (err) {
        if (err instanceof BrandAssetNotFoundError) {
          return reply.code(404).send({ error: "not_found" });
        }
        throw err;
      }
    }
  );
}