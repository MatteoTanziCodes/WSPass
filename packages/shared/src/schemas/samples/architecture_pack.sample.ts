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
    raw_text: "Build a PRD-to-architecture planner that also breaks implementation logic into tracked GitHub issues.",
    summary:
      "Generates one architecture, wireframe/chat refinement guidance, and an implementation rail that can be executed through issue-driven agents.",
  },

  org_constraints: {},

  clarifications: [],
  actors: ["End User", "Implementation Agent"],
  workflows: [
    {
      id: "WF-001",
      name: "Plan, Refine, and Implement",
      steps: [
        "Upload PRD",
        "Review generated architecture",
        "Refine in wireframe or chat",
        "Create implementation issues",
        "Execute implementation issues with pause-on-question behavior",
      ],
    },
  ],
  requirements: [
    {
      id: "REQ-001",
      text: "User can generate one architecture from a PRD and refine it through a wireframe and chat interface.",
      priority: "must",
      acceptance_criteria: [
        "Returns one architecture object",
        "Includes tradeoffs and rationale",
        "Provides wireframe and chat refinement guidance",
      ],
    },
    {
      id: "REQ-002",
      text: "The planner can break code logic into multiple GitHub-issue-sized units for implementation agents.",
      priority: "must",
      acceptance_criteria: [
        "Returns logic requirements",
        "Returns an ordered GitHub issue plan",
        "Defines pause behavior when clarifying questions are pending",
      ],
    },
  ],
  entities: [{ name: "Run", fields: ["id", "createdAt"], notes: "Minimal run tracking." }],
  integrations: [{ name: "GitHub Issues", purpose: "Track implementation work items", direction: "outbound" }],

  nfrs: {
    scale: "small",
    availability: "standard",
    latency: "standard",
    data_sensitivity: "none",
    auditability: "basic",
  },

  architecture: {
    name: "Monolith Web + API + Postgres",
    description:
      "A single deployable web and API stack backed by Postgres, optimized for early product delivery and easy refinement before implementation agents begin coding.",
    components: [
      { name: "Web", type: "web" },
      { name: "API", type: "api" },
      { name: "Postgres", type: "db" },
    ],
    data_flows: [
      "Users interact with the web app",
      "The web app calls the API for run creation and artifact retrieval",
      "The API persists runs and generated planning artifacts",
    ],
    data_stores: ["Postgres"],
    async_patterns: ["Background implementation jobs can be added after the architecture is finalized"],
    api_surface: ["POST /runs", "GET /runs/:runId", "POST /runs/:runId/dispatch"],
    tradeoffs: {
      pros: ["Fast to ship", "Simple deployment model", "Easy to explain and refine in a wireframe"],
      cons: ["Less independent scaling across concerns", "Future async workloads may require decomposition"],
      risks: ["Single service boundary can accumulate too many responsibilities if scope expands quickly"],
    },
    rationale:
      "Choose a simple architecture first so users can inspect, question, and iteratively refine one concrete design before automated implementation begins.",
  },

  refinement: {
    wireframe: {
      enabled: true,
      editable_components: ["Web", "API", "Postgres"],
    },
    chat: {
      enabled: true,
      suggested_questions: [
        "What breaks first if traffic spikes?",
        "How should auth be introduced later?",
        "What should be split into separate services if scope grows?",
      ],
      editable_topics: ["service boundaries", "data storage", "integration points", "operational concerns"],
    },
  },

  implementation: {
    summary:
      "After architecture refinement, implementation should proceed by generating IaC from the finalized architecture and executing code logic through GitHub issues managed by implementation agents.",
    iac_handoff: {
      summary: "Turn the finalized architecture into a single deployable infrastructure graph and IaC baseline.",
      modules: ["networking", "web-app", "api-service", "postgres", "secrets"],
    },
    logic_requirements: [
      {
        id: "LOGIC-001",
        title: "Run creation and retrieval logic",
        summary: "Implement the API and persistence logic for creating runs and reading architecture artifacts.",
        priority: "must",
        acceptance_criteria: [
          "Create run endpoint persists planner input",
          "Get run endpoint returns artifacts manifest",
        ],
        affected_components: ["API", "Postgres"],
        dependencies: [],
      },
      {
        id: "LOGIC-002",
        title: "Planner orchestration and artifact export",
        summary: "Implement workflow dispatch, execution state handling, and artifact export for planner runs.",
        priority: "must",
        acceptance_criteria: [
          "Dispatch triggers planner execution",
          "Execution state is visible",
          "Artifacts are uploaded and retrievable",
        ],
        affected_components: ["API"],
        dependencies: ["LOGIC-001"],
      },
    ],
    github_issue_plan: [
      {
        id: "ISSUE-001",
        title: "Implement run create/read API surface",
        summary: "Ship the minimal API and storage behavior needed to create and inspect planning runs.",
        body: "Implement run creation, retrieval, and artifact listing. Keep changes minimal and aligned with the finalized architecture.",
        labels: ["pass", "implementation-agent", "api", "phase-1"],
        depends_on: [],
        acceptance_criteria: [
          "POST /runs persists planner input",
          "GET /runs/:runId returns the run and artifact manifest",
        ],
      },
      {
        id: "ISSUE-002",
        title: "Implement planner execution rail",
        summary: "Add dispatch, execution state updates, and artifact upload for the planning rail.",
        body: "Use the finalized architecture as the source of truth, then implement the workflow-backed planning rail and export path.",
        labels: ["pass", "implementation-agent", "workflow", "phase-1"],
        depends_on: ["ISSUE-001"],
        acceptance_criteria: [
          "Planner workflow can be dispatched",
          "Execution transitions are durable",
          "Architecture artifacts are uploaded",
        ],
      },
    ],
    coordination: {
      pause_on_pending_questions: true,
      live_issue_updates: true,
      coordination_views: ["pending clarifications", "issue queue", "blocked work"],
      question_sources: ["coordination panel", "reviewer feedback", "agent escalation"],
    },
    observability: {
      log_traces_enabled: true,
      coordination_panel_enabled: true,
      required_signals: ["execution logs", "agent traces", "question state", "issue state", "blocking reasons"],
      dashboard_panels: ["execution health", "clarification queue", "issue progress", "blocked agents"],
    },
  },

  assumptions: ["PRD is short and clear."],
  open_questions: [],
  coverage: [
    {
      requirement_id: "REQ-001",
      status: "covered",
      notes: "The architecture plus refinement metadata covers generation and review.",
    },
    {
      requirement_id: "REQ-002",
      status: "covered",
      notes: "The implementation rail defines logic requirements, GitHub issue breakdown, and pause-on-question behavior.",
    },
  ],
  trace: [
    {
      requirement_id: "REQ-001",
      source_hint: "PRD: 'generate one architecture and refine it through wireframe/chat'",
    },
    {
      requirement_id: "REQ-002",
      source_hint: "PRD: 'break logic into GitHub issues and pause implementation while questions are pending'",
    },
  ],
} satisfies z.input<typeof ArchitecturePackSchema>;
