import { createHash } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { ProjectBuildConfigSchema, type ProjectBuildConfig } from "@pass/shared";
import { decrypt, encrypt, tokenHint } from "../integrations/encryptedSecretStore";
import { ensureDir, readJson, writeJsonAtomic } from "../runs/jsonFileStorage";
import {
  ProjectBuildConfigIndexSchema,
  ProjectSecretMetadataSchema,
} from "./projectBuild.schemas";

type ProjectSecretMetadata = import("zod").infer<typeof ProjectSecretMetadataSchema>;

type StoredProjectSecret = {
  metadata: ProjectSecretMetadata;
  ciphertext: string;
  iv: string;
  tag: string;
};

function safeProjectDir(projectKey: string) {
  return createHash("sha256").update(projectKey).digest("hex");
}

function buildDefaultConfig(projectKey: string): ProjectBuildConfig {
  return ProjectBuildConfigSchema.parse({
    project_key: projectKey,
    quality_commands: {},
    warning_defaults: [],
    critical_defaults: [],
    updated_at: new Date().toISOString(),
  });
}

export class ProjectBuildStore {
  private readonly configDir = path.resolve(process.cwd(), "data/project-build/config");
  private readonly configPath = path.join(this.configDir, "index.json");
  private readonly secretsRoot = path.resolve(process.cwd(), "data/project-secrets");

  private async readConfigIndex() {
    try {
      return await readJson(this.configPath, ProjectBuildConfigIndexSchema);
    } catch {
      await ensureDir(this.configDir);
      const fresh = ProjectBuildConfigIndexSchema.parse({});
      await writeJsonAtomic(this.configPath, fresh);
      return fresh;
    }
  }

  async getConfig(projectKey: string) {
    const index = await this.readConfigIndex();
    return index[projectKey] ?? buildDefaultConfig(projectKey);
  }

  async updateConfig(
    projectKey: string,
    patch: {
      quality_commands?: Partial<ProjectBuildConfig["quality_commands"]>;
      warning_defaults?: string[];
      critical_defaults?: string[];
    }
  ) {
    const index = await this.readConfigIndex();
    const existing = index[projectKey] ?? buildDefaultConfig(projectKey);
    const next = ProjectBuildConfigSchema.parse({
      ...existing,
      quality_commands: {
        ...existing.quality_commands,
        ...(patch.quality_commands ?? {}),
      },
      warning_defaults: patch.warning_defaults ?? existing.warning_defaults,
      critical_defaults: patch.critical_defaults ?? existing.critical_defaults,
      updated_at: new Date().toISOString(),
    });

    await writeJsonAtomic(
      this.configPath,
      ProjectBuildConfigIndexSchema.parse({
        ...index,
        [projectKey]: next,
      })
    );

    return next;
  }

  private async getProjectSecretsDir(projectKey: string) {
    const dir = path.join(this.secretsRoot, safeProjectDir(projectKey));
    await ensureDir(dir);
    return dir;
  }

  async listSecrets(projectKey: string) {
    const dir = await this.getProjectSecretsDir(projectKey);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const secrets = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".enc.json"))
        .map(async (entry) => {
          const raw = await fs.readFile(path.join(dir, entry.name), "utf8");
          const payload = JSON.parse(raw) as StoredProjectSecret;
          return ProjectSecretMetadataSchema.parse(payload.metadata);
        })
    );

    return secrets.sort((left, right) => left.name.localeCompare(right.name));
  }

  async putSecret(input: {
    projectKey: string;
    name: string;
    value: string;
    kind: "integration" | "project_secret" | "project_variable";
    provider?: "github" | "anthropic" | "stripe" | "sentry" | "other";
  }) {
    const dir = await this.getProjectSecretsDir(input.projectKey);
    const encrypted = encrypt(input.value);
    const metadata = ProjectSecretMetadataSchema.parse({
      name: input.name,
      kind: input.kind,
      provider: input.provider,
      updated_at: new Date().toISOString(),
      hint: tokenHint(input.value),
    });
    const filePath = path.join(
      dir,
      `${input.name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_")}.enc.json`
    );

    await writeJsonAtomic(filePath, {
      metadata,
      ...encrypted,
    } satisfies StoredProjectSecret);

    return metadata;
  }

  async getSecretValue(projectKey: string, name: string) {
    const secrets = await this.listSecrets(projectKey);
    const target = secrets.find((secret) => secret.name === name);
    if (!target) {
      return null;
    }

    const dir = await this.getProjectSecretsDir(projectKey);
    const filePath = path.join(
      dir,
      `${name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_")}.enc.json`
    );
    const raw = await fs.readFile(filePath, "utf8");
    const payload = JSON.parse(raw) as StoredProjectSecret;
    return decrypt(payload);
  }

  async deleteSecret(projectKey: string, name: string) {
    const dir = await this.getProjectSecretsDir(projectKey);
    const filePath = path.join(
      dir,
      `${name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_")}.enc.json`
    );
    await fs.unlink(filePath).catch(() => undefined);
  }
}
