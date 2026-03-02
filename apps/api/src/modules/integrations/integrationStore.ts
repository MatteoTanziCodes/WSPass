import path from "node:path";
import { z } from "zod";
import {
  IntegrationConnectionSchema,
  IntegrationProviderSchema,
  IntegrationsIndexSchema,
  type IntegrationConnection,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@pass/shared";
import { ensureDir, readJson, writeJsonAtomic } from "../runs/jsonFileStorage";

const DATA_DIR = path.resolve(process.cwd(), "data/integrations");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

const EMPTY_INDEX = { version: 1 as const, connections: [] };

export class IntegrationNotFoundError extends Error {
  constructor(provider: string) {
    super(`Integration not found: ${provider}`);
    this.name = "IntegrationNotFoundError";
  }
}

export class IntegrationStore {
  private async readIndex() {
    await ensureDir(DATA_DIR);
    try {
      return await readJson(INDEX_PATH, IntegrationsIndexSchema);
    } catch {
      return EMPTY_INDEX;
    }
  }

  private async writeIndex(index: z.infer<typeof IntegrationsIndexSchema>) {
    await ensureDir(DATA_DIR);
    await writeJsonAtomic(INDEX_PATH, index);
  }

  async listConnections(): Promise<IntegrationConnection[]> {
    // Always return all 4 providers so the UI always has a row for each
    const allProviders: IntegrationProvider[] = ["github", "anthropic", "vercel", "stripe"];
    const index = await this.readIndex();
    return allProviders.map((provider) => {
      const existing = index.connections.find((c) => c.provider === provider);
      return existing ?? { provider, status: "disconnected" as IntegrationStatus };
    });
  }

  async upsertConnection(connection: IntegrationConnection): Promise<void> {
    const index = await this.readIndex();
    const existing = index.connections.findIndex((c) => c.provider === connection.provider);
    if (existing >= 0) {
      index.connections[existing] = connection;
    } else {
      index.connections.push(connection);
    }
    await this.writeIndex(index);
  }

  async getConnection(provider: IntegrationProvider): Promise<IntegrationConnection | null> {
    const index = await this.readIndex();
    return index.connections.find((c) => c.provider === provider) ?? null;
  }

  async removeConnection(provider: IntegrationProvider): Promise<void> {
    const index = await this.readIndex();
    index.connections = index.connections.filter((c) => c.provider !== provider);
    await this.writeIndex(index);
  }
}