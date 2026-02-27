// packages/shared/src/schemas/samples/architecture_pack.sample.ts
import { z } from "zod";
import { ArchitecturePackSchema } from "../pass2a";
import { PACK_VERSION } from "../../constants";

export const architecturePackSample = {
  pack_version: PACK_VERSION,
  run_id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-02-26T00:00:00Z",

  tool: { name: "PASS-2A", version: "0.1.0" },

  prd: {
    title: "Sample PRD",
    raw_text: "Build a tiny PRD-to-architecture pack generator for demo purposes.",
    summary: "Generates architecture options and exports a validated pack.",
  },

  // defaults handled by schema
  org_constraints: {},

  clarifications: [],
  actors: ["End User"],
  workflows: [
    {
      id: "WF-001",
      name: "Create Run",
      steps: ["Upload PRD", "Answer clarifications", "Pick option"],
    },
  ],
  requirements: [
    {
      id: "REQ-001",
      text: "User can generate 2–3 architecture options.",
      priority: "must",
      acceptance_criteria: ["Returns A/B/C options"],
    },
  ],
  entities: [{ name: "Run", fields: ["id", "createdAt"], notes: "Minimal run tracking." }],
  integrations: [],

  // include explicit values to avoid any Zod default/input nuance
  nfrs: {
    scale: "small",
    availability: "standard",
    latency: "standard",
    data_sensitivity: "none",
    auditability: "basic",
  },

  // Must be ordered A then B, unique, 2–3 items
  architecture_options: [
    {
      option_id: "A",
      name: "Monolith (Web + API + Postgres)",
      components: [
        { name: "Web", type: "web" },
        { name: "API", type: "api" },
        { name: "Postgres", type: "db" },
      ],
      data_stores: ["Postgres"],
      async_patterns: [],
      api_surface: ["POST /runs", "GET /runs/:id"],
      tradeoffs: { pros: ["Fast to ship"], cons: ["Less flexible scaling"], risks: [] },
      when_to_choose: "Choose when speed and simplicity matter most for MVP.",
    },
    {
      option_id: "B",
      name: "API + Worker (Queue + Postgres)",
      components: [
        { name: "API", type: "api" },
        { name: "Worker", type: "worker" },
        { name: "Queue", type: "queue" },
        { name: "Postgres", type: "db" },
      ],
      data_stores: ["Postgres"],
      async_patterns: ["Queue background export"],
      api_surface: ["POST /runs", "POST /runs/:id/export"],
      tradeoffs: { pros: ["Better async handling"], cons: ["More moving parts"], risks: ["Queue misconfig"] },
      when_to_choose: "Choose when background jobs must not block requests.",
    },
  ],

  selection: {
    selected_option_id: "A",
    selected_by: "human",
    reason: "Simplest for demo.",
    timestamp: "2026-02-26T00:00:10Z",
  },

  assumptions: ["PRD is short and clear."],
  open_questions: [],
  coverage: [{ requirement_id: "REQ-001", status: "covered", notes: "Options generation covers this." }],
  trace: [{ requirement_id: "REQ-001", source_hint: "PRD: 'generate 2–3 options'" }],
} satisfies z.input<typeof ArchitecturePackSchema>;