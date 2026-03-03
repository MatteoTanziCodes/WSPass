import { z } from "zod";
import {
  ProjectBuildConfigSchema,
  type ProjectBuildConfig,
  ProjectSecretRequirementSchema,
} from "@pass/shared";

const ProjectSecretMetadataSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["integration", "project_secret", "project_variable"]),
  provider: z.enum(["github", "anthropic", "stripe", "sentry", "other"]).optional(),
  updated_at: z.string().datetime(),
  hint: z.string().min(1).optional(),
});

type ProjectSecretMetadata = z.infer<typeof ProjectSecretMetadataSchema>;

function readRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export class ProjectBuildClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor() {
    this.baseUrl = readRequiredEnv("PASS_API_BASE_URL").replace(/\/+$/, "");
    this.token = readRequiredEnv("PASS_API_TOKEN");
  }

  async getConfig(projectKey: string): Promise<ProjectBuildConfig> {
    const json = await this.request(
      "GET",
      `/project-build/config?project_key=${encodeURIComponent(projectKey)}`
    );
    return z.object({ config: ProjectBuildConfigSchema }).parse(json).config;
  }

  async updateConfig(
    projectKey: string,
    patch: {
      quality_commands?: Partial<ProjectBuildConfig["quality_commands"]>;
      warning_defaults?: string[];
      critical_defaults?: string[];
    }
  ): Promise<ProjectBuildConfig> {
    const json = await this.request(
      "PATCH",
      `/project-build/config?project_key=${encodeURIComponent(projectKey)}`,
      patch
    );
    return z.object({ config: ProjectBuildConfigSchema }).parse(json).config;
  }

  async listSecrets(projectKey: string): Promise<ProjectSecretMetadata[]> {
    const json = await this.request(
      "GET",
      `/project-build/secrets?project_key=${encodeURIComponent(projectKey)}`
    );
    return z.object({ secrets: z.array(ProjectSecretMetadataSchema) }).parse(json).secrets;
  }

  async getSecretValue(projectKey: string, name: string): Promise<string | null> {
    try {
      const json = await this.request(
        "GET",
        `/project-build/secrets/value?project_key=${encodeURIComponent(projectKey)}&name=${encodeURIComponent(name)}`
      );
      return z.object({ name: z.string(), value: z.string() }).parse(json).value;
    } catch (error) {
      if (error instanceof Error && error.message.includes(" 404:")) {
        return null;
      }
      throw error;
    }
  }

  async putSecret(projectKey: string, input: {
    name: string;
    value: string;
    kind: "integration" | "project_secret" | "project_variable";
    provider?: "github" | "anthropic" | "stripe" | "sentry" | "other";
  }) {
    await this.request(
      "PUT",
      `/project-build/secrets?project_key=${encodeURIComponent(projectKey)}`,
      input
    );
  }

  async deleteSecret(projectKey: string, name: string) {
    await this.request(
      "DELETE",
      `/project-build/secrets?project_key=${encodeURIComponent(projectKey)}&name=${encodeURIComponent(name)}`
    );
  }

  async resolveRequirements(
    runId: string,
    issueId: string,
    requirements: Array<{
      id: string;
      status: z.infer<typeof ProjectSecretRequirementSchema>["status"];
      resolved_at?: string;
    }>
  ) {
    await this.request("PATCH", `/runs/${runId}/issues/${issueId}/requirements`, {
      requirements,
    });
  }

  async answerContextQuestions(
    runId: string,
    issueId: string,
    questions: Array<{
      id: string;
      status: "open" | "answered" | "resolved";
      answer?: string;
      answered_at?: string;
    }>
  ) {
    await this.request("PATCH", `/runs/${runId}/issues/${issueId}/context-questions`, {
      questions,
    });
  }

  private async request(method: string, path: string, body?: unknown) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : undefined;

    if (!response.ok) {
      throw new Error(
        `PASS API ${method} ${path} failed with ${response.status}: ${text || response.statusText}`
      );
    }

    return json;
  }
}
