import { z } from "zod";
import { ArchitecturePackSchema } from "../pass2a";
import { PACK_VERSION } from "../../constants";

export const architecturePackSample = {
  pack_version: PACK_VERSION,
  run_id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-03-02T00:00:00Z",

  tool: { name: "PASS-2A", version: "0.1.0" },

  prd: {
    title: "Static presentation app",
    raw_text:
      "Fully static Next.js presentation app deployed to Vercel CDN edge. All slide content is ingested from local JSON/MDX at build time, compiled into a static bundle, and served with zero server-side runtime. Navigation is driven by a client-side state machine. Media assets are served from the Next.js public directory.",
    summary:
      "Generate one architecture for a fully static Next.js presentation app deployed to Vercel edge, then allow refinement through a wireframe and chat.",
  },

  org_constraints: {
    cloud: {
      provider: "vercel",
      allowed_services: ["vercel edge network", "next.js static export", "public assets"],
    },
  },
  design_guidelines: {
    visual_direction: ["Terminal-inspired dark presentation console", "No rounded corners", "Dense system-map style copy"],
    color_guidance: ["Warm dark neutrals with restrained amber accent", "Use status colors only for pipeline state"],
    typography_guidance: ["Strong sans headlines", "Monospace labels for system metadata"],
    engineering_guidance: ["Prefer static generation over runtime services", "Keep architecture easy to explain to non-cloud audiences"],
    linting_guidance: ["Preserve strict TypeScript and deterministic naming"],
  },

  clarifications: [],
  actors: ["Presenter", "Viewer", "Content Editor"],
  workflows: [
    {
      id: "wf_static_present",
      name: "Build and present a static deck",
      steps: [
        "Compile local JSON and MDX content at build time",
        "Publish a static Next.js bundle to Vercel edge",
        "Serve media assets from the public bundle",
        "Navigate slides using a client-side state machine",
      ],
    },
  ],
  requirements: [
    {
      id: "req_static_1",
      text: "The app must deploy as a fully static Next.js presentation site with zero server-side runtime.",
      priority: "must",
      acceptance_criteria: [
        "All content is compiled at build time",
        "No server-side API or worker runtime is required",
        "The site is delivered through Vercel CDN edge",
      ],
    },
    {
      id: "req_static_2",
      text: "Slide navigation must be handled entirely on the client through a local state machine.",
      priority: "must",
      acceptance_criteria: [
        "Navigation state is stored in browser memory",
        "Slides can move forward and backward without a network request",
      ],
    },
  ],
  entities: [
    {
      name: "SlideDocument",
      fields: ["slug", "title", "sections", "assetRefs"],
      notes: "Loaded from local JSON or MDX at build time.",
    },
  ],
  integrations: [
    {
      name: "Vercel Build",
      purpose: "Compile local slide content and publish a static bundle",
      direction: "outbound",
      criticality: "high",
    },
  ],

  nfrs: {
    scale: "small",
    availability: "standard",
    latency: "low",
    data_sensitivity: "none",
    auditability: "basic",
  },

  architecture: {
    name: "Static Next.js + Vercel Edge",
    description:
      "A fully static presentation application built from local JSON and MDX, deployed to Vercel edge, and navigated entirely in the browser with no server runtime.",
    components: [
      {
        name: "pass-web",
        type: "web",
        responsibility: "Serve the static presentation shell and slide routes.",
        display_role: "presentation",
        deployment: {
          provider: "vercel",
          target: "edge_cdn",
          runtime: "static_bundle",
          service_label: "Vercel Edge Network",
          artifact_label: "Next.js static bundle",
        },
      },
      {
        name: "pass-router",
        type: "web",
        responsibility: "Handle client-side slide navigation and local presentation state.",
        display_role: "presentation",
        deployment: {
          provider: "generic",
          target: "browser",
          runtime: "browser_js",
          artifact_label: "Client-side state machine",
        },
      },
      {
        name: "pass-slide-content",
        type: "object_storage",
        responsibility: "Provide local JSON and MDX slide content to the build pipeline.",
        display_role: "build",
        deployment: {
          provider: "generic",
          target: "build_pipeline",
          runtime: "none",
          artifact_label: "Local JSON/MDX source",
        },
      },
      {
        name: "pass-media-assets",
        type: "object_storage",
        responsibility: "Serve public images, video, and supporting presentation assets.",
        display_role: "presentation",
        deployment: {
          provider: "vercel",
          target: "static_host",
          runtime: "managed",
          service_label: "Public asset bundle",
        },
      },
    ],
    data_flows: [
      "Local slide content is compiled into the Next.js static bundle at build time.",
      "Viewers request the static presentation shell from Vercel edge.",
      "The browser state machine drives slide navigation without a server round-trip.",
      "Media assets are served from the published public bundle.",
    ],
    relationships: [
      {
        from: "pass-slide-content",
        to: "pass-web",
        kind: "build",
        label: "Compiles local JSON/MDX into the static site bundle",
      },
      {
        from: "pass-web",
        to: "pass-router",
        kind: "serve",
        label: "Hydrates client-side slide navigation state",
      },
      {
        from: "pass-router",
        to: "pass-media-assets",
        kind: "read",
        label: "Loads public media assets referenced by slides",
      },
    ],
    data_stores: ["Local JSON/MDX slide source", "Static public media bundle"],
    async_patterns: ["Build-time compilation only; no runtime background processing"],
    api_surface: ["Static route delivery only; no runtime API surface"],
    tradeoffs: {
      pros: [
        "Zero server runtime keeps hosting simple and inexpensive",
        "Local content sources make the presentation highly portable",
        "Client-side navigation feels immediate once the bundle is loaded",
      ],
      cons: [
        "All content changes require a rebuild and redeploy",
        "No server runtime means dynamic personalization is out of scope",
      ],
      risks: [
        "Large media assets can increase initial bundle weight if not curated carefully",
      ],
    },
    rationale:
      "The product is a presentation experience rather than a transactional application, so the architecture optimizes for static delivery, portability, and a clear non-AWS deployment story.",
  },

  refinement: {
    wireframe: {
      enabled: true,
      editable_components: ["pass-web", "pass-router", "pass-slide-content", "pass-media-assets"],
    },
    chat: {
      enabled: true,
      suggested_questions: [
        "Should content remain fully local or move to a CMS later?",
        "Do we need analytics or observability for audience interactions?",
        "Should media be optimized through a separate asset pipeline?",
      ],
      editable_topics: ["deployment target", "build pipeline", "client navigation", "asset delivery"],
    },
  },

  implementation: {
    summary:
      "After architecture refinement, implementation should scaffold the static Next.js app, content compilation flow, and deployment pipeline while preserving a fully static delivery model.",
    iac_handoff: {
      summary: "Provision the static hosting and deployment workflow needed for a Vercel-hosted presentation app.",
      modules: ["presentation-app", "build-content", "asset-pipeline"],
    },
    logic_requirements: [
      {
        id: "logic_static_1",
        title: "Build the static slide ingestion pipeline",
        summary: "Compile local JSON and MDX into typed slide routes at build time.",
        priority: "must",
        acceptance_criteria: [
          "Slide content is loaded from local files at build time",
          "Typed slide documents are available to the Next.js presentation shell",
        ],
        affected_components: ["pass-slide-content", "pass-web"],
        dependencies: [],
      },
      {
        id: "logic_static_2",
        title: "Implement client-side slide navigation",
        summary: "Create the browser-only state machine that moves between slides with no runtime API dependency.",
        priority: "must",
        acceptance_criteria: [
          "Slide navigation is immediate and client-side",
          "Navigation state survives intra-session movement",
        ],
        affected_components: ["pass-router", "pass-web"],
        dependencies: ["logic_static_1"],
      },
    ],
    github_issue_plan: [
      {
        id: "issue_static_1",
        title: "Implement build-time slide compilation",
        summary: "Create the content ingestion layer that transforms local JSON and MDX into presentation-ready static data.",
        body: "Implement local content ingestion, validation, and Next.js build integration for slide generation.",
        labels: ["pass", "frontend", "static-app"],
        depends_on: [],
        acceptance_criteria: [
          "Local JSON/MDX slide content is compiled during build",
          "The generated presentation routes are static",
        ],
      },
      {
        id: "issue_static_2",
        title: "Implement browser navigation state machine",
        summary: "Build the client-side navigation controls for the presentation deck.",
        body: "Add the client-side state machine, keyboard controls, and route-aware slide navigation.",
        labels: ["pass", "frontend", "interaction"],
        depends_on: ["issue_static_1"],
        acceptance_criteria: [
          "Navigation works without a runtime API",
          "Forward/back slide transitions are handled in the browser",
        ],
      },
    ],
    coordination: {
      pause_on_pending_questions: true,
      live_issue_updates: true,
      coordination_views: ["architecture decisions", "content pipeline readiness", "issue execution state"],
      question_sources: ["architecture refinement chat", "decomposition review", "implementation escalation"],
    },
    observability: {
      log_traces_enabled: true,
      coordination_panel_enabled: true,
      required_signals: ["build failures", "deployment state", "refinement decisions", "issue progress"],
      dashboard_panels: ["build health", "architecture status", "issue queue"],
    },
  },

  assumptions: ["The presentation content is local and version-controlled."],
  open_questions: [],
  coverage: [
    {
      requirement_id: "req_static_1",
      status: "covered",
      notes: "Static hosting and build-time compilation are represented directly in the architecture bindings.",
    },
    {
      requirement_id: "req_static_2",
      status: "covered",
      notes: "Client-side navigation is modeled as a browser runtime component.",
    },
  ],
  trace: [
    {
      requirement_id: "req_static_1",
      source_hint: "PRD: fully static Next.js app deployed to Vercel edge",
    },
    {
      requirement_id: "req_static_2",
      source_hint: "PRD: navigation driven by a client-side state machine",
    },
  ],
} satisfies z.input<typeof ArchitecturePackSchema>;

ArchitecturePackSchema.parse(architecturePackSample);
