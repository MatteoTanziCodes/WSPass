"use client";

import { useMemo, useState } from "react";

type DeploymentBinding = {
  provider?: string;
  target?: string;
  runtime?: string;
  service_label?: string;
  artifact_label?: string;
};

type ComponentNode = {
  name: string;
  type: string;
  responsibility?: string;
  display_role?: string;
  deployment?: DeploymentBinding;
};

type Relationship = {
  from: string;
  to: string;
  kind: string;
  label: string;
};

type ArchitecturePackLike = {
  org_constraints?: {
    cloud?: {
      provider?: string;
    };
  };
  architecture: {
    name: string;
    description: string;
    components: ComponentNode[];
    data_flows: string[];
    relationships?: Relationship[];
  };
};

type DiagramMode = "neutral" | "aws";
type LayerKey =
  | "presentation"
  | "build"
  | "execution"
  | "data"
  | "identity"
  | "integrations";

type LayerConfig = {
  key: LayerKey;
  title: string;
  column: number;
  row: number;
};

type PositionedLayer = LayerConfig & {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PositionedNode = {
  id: string;
  title: string;
  responsibility: string;
  providerLabel?: string;
  targetLabel: string;
  runtimeLabel: string;
  layer: LayerKey;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  serviceLabel?: string;
  iconPath?: string;
};

const SVG_WIDTH = 1040;
const OUTER_PADDING = 24;
const HEADER_HEIGHT = 84;
const LAYER_WIDTH = 304;
const LAYER_GAP_X = 20;
const LAYER_GAP_Y = 24;
const LAYER_HEADER_HEIGHT = 32;
const NODE_WIDTH = 128;
const NODE_HEIGHT = 132;
const NODE_GAP_X = 14;
const NODE_GAP_Y = 16;
const MIN_LAYER_HEIGHT = 188;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.2;

const layerOrder: LayerConfig[] = [
  { key: "presentation", title: "Presentation", column: 0, row: 0 },
  { key: "build", title: "Build / Delivery", column: 1, row: 0 },
  { key: "execution", title: "Execution", column: 2, row: 0 },
  { key: "data", title: "Data", column: 0, row: 1 },
  { key: "identity", title: "Identity", column: 1, row: 1 },
  { key: "integrations", title: "Integrations / Observability", column: 2, row: 1 },
];

const layerPalette: Record<LayerKey, { fill: string; stroke: string; accent: string }> = {
  presentation: {
    fill: "rgba(118, 74, 188, 0.14)",
    stroke: "rgba(153, 109, 228, 0.45)",
    accent: "#9b73f5",
  },
  build: {
    fill: "rgba(48, 128, 108, 0.14)",
    stroke: "rgba(96, 184, 156, 0.45)",
    accent: "#58c4a6",
  },
  execution: {
    fill: "rgba(212, 123, 43, 0.14)",
    stroke: "rgba(233, 156, 77, 0.45)",
    accent: "#ef9d4f",
  },
  data: {
    fill: "rgba(79, 116, 179, 0.14)",
    stroke: "rgba(115, 153, 219, 0.45)",
    accent: "#79a0f2",
  },
  identity: {
    fill: "rgba(181, 74, 103, 0.14)",
    stroke: "rgba(216, 113, 143, 0.45)",
    accent: "#db6f93",
  },
  integrations: {
    fill: "rgba(93, 140, 91, 0.14)",
    stroke: "rgba(136, 191, 132, 0.45)",
    accent: "#8fd27b",
  },
};

const awsServiceIconMap: Record<string, { service: string; iconPath: string }> = {
  web: { service: "Amazon CloudFront", iconPath: "/aws-icons/cloudfront.svg" },
  api: { service: "Amazon API Gateway", iconPath: "/aws-icons/api-gateway.svg" },
  worker: { service: "AWS Lambda", iconPath: "/aws-icons/lambda.svg" },
  db: { service: "Amazon DynamoDB", iconPath: "/aws-icons/dynamodb.svg" },
  queue: { service: "Amazon SQS", iconPath: "/aws-icons/sqs.svg" },
  cache: { service: "Amazon ElastiCache", iconPath: "/aws-icons/elasticache.svg" },
  object_storage: { service: "Amazon S3", iconPath: "/aws-icons/s3.svg" },
  auth_provider: { service: "Amazon Cognito", iconPath: "/aws-icons/cognito.svg" },
  external_integration: { service: "Amazon EventBridge", iconPath: "/aws-icons/eventbridge.svg" },
};

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

function toId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]+/g, " ");
}

function shorten(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 2)}..` : value;
}

function titleCaseLabel(value?: string) {
  return value ? value.replaceAll("_", " ") : "n/a";
}

function inferLayer(component: ComponentNode): LayerKey {
  if (component.display_role === "presentation") {
    return "presentation";
  }
  if (component.display_role === "build") {
    return "build";
  }
  if (component.display_role === "execution") {
    return "execution";
  }
  if (component.display_role === "data") {
    return "data";
  }
  if (component.display_role === "identity") {
    return "identity";
  }
  if (component.display_role === "integration" || component.display_role === "observability") {
    return "integrations";
  }

  switch (component.type) {
    case "web":
      return "presentation";
    case "api":
    case "worker":
      return "execution";
    case "db":
    case "queue":
    case "cache":
    case "object_storage":
      return "data";
    case "auth_provider":
      return "identity";
    default:
      return "integrations";
  }
}

function inferAwsEligibility(pack: ArchitecturePackLike) {
  const explicitProviders = pack.architecture.components
    .map((component) => component.deployment?.provider)
    .filter(Boolean)
    .map((provider) => provider!.toLowerCase());

  if (
    explicitProviders.some(
      (provider) =>
        !["aws", "generic", "none", "other"].includes(provider)
    )
  ) {
    return false;
  }

  const orgProvider = pack.org_constraints?.cloud?.provider?.toLowerCase();
  if (
    orgProvider &&
    !["aws", "generic", "none"].includes(orgProvider)
  ) {
    return false;
  }

  return true;
}

function measureLayerHeight(nodeCount: number) {
  const columns = nodeCount > 1 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(nodeCount / columns));
  return Math.max(
    MIN_LAYER_HEIGHT,
    LAYER_HEADER_HEIGHT + 18 + rows * NODE_HEIGHT + (rows - 1) * NODE_GAP_Y + 18
  );
}

function inferNeutralResponsibility(component: ComponentNode) {
  switch (component.type) {
    case "web":
      return `Deliver ${component.name} to end users.`;
    case "api":
      return `Handle application requests for ${component.name}.`;
    case "worker":
      return `Run background execution for ${component.name}.`;
    case "db":
      return `Persist system data for ${component.name}.`;
    case "queue":
      return `Sequence asynchronous work for ${component.name}.`;
    case "cache":
      return `Provide fast temporary state for ${component.name}.`;
    case "object_storage":
      return `Store content and assets for ${component.name}.`;
    case "auth_provider":
      return `Manage identity and authentication for ${component.name}.`;
    default:
      return `Connect ${component.name} to external or supporting systems.`;
  }
}

function inferTarget(component: ComponentNode) {
  if (component.deployment?.target) {
    return component.deployment.target;
  }

  switch (component.type) {
    case "web":
      return "edge_cdn";
    case "api":
      return "app_server";
    case "worker":
      return "serverless_function";
    case "db":
      return "managed_database";
    case "queue":
      return "queue_service";
    case "cache":
      return "cache_service";
    case "object_storage":
      return "static_host";
    case "auth_provider":
      return "auth_service";
    default:
      return "third_party_api";
  }
}

function inferRuntime(component: ComponentNode, target: string) {
  if (component.deployment?.runtime) {
    return component.deployment.runtime;
  }

  if (target === "browser") {
    return "browser_js";
  }
  if (target === "edge_cdn" && component.type === "web") {
    return "static_bundle";
  }
  if (target === "build_pipeline") {
    return "none";
  }
  if (target === "app_server") {
    return "node";
  }
  if (target === "serverless_function") {
    return "worker_runtime";
  }
  return "managed";
}

function resolveAwsService(component: ComponentNode) {
  if (component.deployment?.service_label) {
    const fallback = awsServiceIconMap[component.type] ?? awsServiceIconMap.external_integration;
    return {
      service: component.deployment.service_label,
      iconPath: fallback.iconPath,
    };
  }

  const normalizedName = component.name.toLowerCase();
  if (component.type === "external_integration") {
    if (
      normalizedName.includes("log") ||
      normalizedName.includes("metric") ||
      normalizedName.includes("alarm") ||
      normalizedName.includes("trace") ||
      normalizedName.includes("monitor")
    ) {
      return { service: "Amazon CloudWatch", iconPath: "/aws-icons/cloudwatch.svg" };
    }
    if (normalizedName.includes("notify") || normalizedName.includes("alert")) {
      return { service: "Amazon SNS", iconPath: "/aws-icons/sns.svg" };
    }
  }

  return awsServiceIconMap[component.type] ?? awsServiceIconMap.external_integration;
}

function buildNodes(pack: ArchitecturePackLike, mode: DiagramMode) {
  return pack.architecture.components.map((component) => {
    const layer = inferLayer(component);
    const target = inferTarget(component);
    const runtime = inferRuntime(component, target);
    const provider =
      component.deployment?.provider &&
      !["generic", "none"].includes(component.deployment.provider)
        ? component.deployment.provider
        : undefined;

    const baseNode: Omit<PositionedNode, "x" | "y" | "width" | "height"> = {
      id: toId(component.name),
      title: component.name,
      responsibility: component.responsibility ?? inferNeutralResponsibility(component),
      providerLabel: provider,
      targetLabel: titleCaseLabel(target),
      runtimeLabel: titleCaseLabel(runtime),
      layer,
      type: component.type,
      serviceLabel: undefined,
      iconPath: undefined,
    };

    if (mode === "aws") {
      const awsService = resolveAwsService(component);
      return {
        ...baseNode,
        targetLabel: component.deployment?.target
          ? titleCaseLabel(component.deployment.target)
          : baseNode.targetLabel,
        runtimeLabel: component.deployment?.runtime
          ? titleCaseLabel(component.deployment.runtime)
          : baseNode.runtimeLabel,
        serviceLabel: awsService.service,
        iconPath: awsService.iconPath,
      };
    }

    return baseNode;
  });
}

function buildLayout(nodes: Omit<PositionedNode, "x" | "y" | "width" | "height">[]) {
  const grouped = new Map<LayerKey, Omit<PositionedNode, "x" | "y" | "width" | "height">[]>();
  for (const layer of layerOrder) {
    grouped.set(layer.key, []);
  }

  for (const node of nodes) {
    grouped.get(node.layer)?.push(node);
  }

  const layerHeights = new Map<LayerKey, number>();
  for (const layer of layerOrder) {
    layerHeights.set(layer.key, measureLayerHeight((grouped.get(layer.key) ?? []).length));
  }

  const topRowHeight = Math.max(
    ...layerOrder
      .filter((layer) => layer.row === 0)
      .map((layer) => layerHeights.get(layer.key) ?? MIN_LAYER_HEIGHT)
  );
  const bottomRowHeight = Math.max(
    ...layerOrder
      .filter((layer) => layer.row === 1)
      .map((layer) => layerHeights.get(layer.key) ?? MIN_LAYER_HEIGHT)
  );

  const rowY = new Map<number, number>([
    [0, HEADER_HEIGHT],
    [1, HEADER_HEIGHT + topRowHeight + LAYER_GAP_Y],
  ]);

  const layers: PositionedLayer[] = layerOrder.map((layer) => ({
    ...layer,
    x: OUTER_PADDING + layer.column * (LAYER_WIDTH + LAYER_GAP_X),
    y: rowY.get(layer.row) ?? HEADER_HEIGHT,
    width: LAYER_WIDTH,
    height: layer.row === 0 ? topRowHeight : bottomRowHeight,
  }));

  const positionedNodes: PositionedNode[] = [];
  for (const layer of layers) {
    const components = grouped.get(layer.key) ?? [];
    const columns = components.length > 1 ? 2 : 1;
    const startX =
      columns === 1
        ? layer.x + Math.round((layer.width - NODE_WIDTH) / 2)
        : layer.x + 16;

    components.forEach((component, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      positionedNodes.push({
        ...component,
        x: startX + column * (NODE_WIDTH + NODE_GAP_X),
        y: layer.y + LAYER_HEADER_HEIGHT + 14 + row * (NODE_HEIGHT + NODE_GAP_Y),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }

  return {
    layers,
    nodes: positionedNodes,
    svgHeight: HEADER_HEIGHT + topRowHeight + LAYER_GAP_Y + bottomRowHeight + OUTER_PADDING,
  };
}

function buildEdges(
  pack: ArchitecturePackLike,
  nodes: PositionedNode[]
) {
  const byName = new Map(nodes.map((node) => [node.title, node]));
  const relationships = pack.architecture.relationships ?? [];

  if (relationships.length > 0) {
    return relationships
      .map((relationship) => {
        const from = byName.get(relationship.from);
        const to = byName.get(relationship.to);

        if (!from || !to) {
          return null;
        }

        return { from, to, label: relationship.label };
      })
      .filter(Boolean)
      .slice(0, 12) as Array<{ from: PositionedNode; to: PositionedNode; label: string }>;
  }

  const inferred: Array<{ from: PositionedNode; to: PositionedNode; label: string }> = [];
  for (const flow of pack.architecture.data_flows) {
    const matched = nodes.filter((node) =>
      normalizeText(flow).includes(normalizeText(node.title))
    );
    if (matched.length >= 2) {
      inferred.push({ from: matched[0], to: matched[1], label: flow });
    }
  }

  if (inferred.length > 0) {
    return inferred.slice(0, 12);
  }

  const firstNode = (layer: LayerKey) => nodes.find((node) => node.layer === layer);
  const fallbackPairs: Array<[LayerKey, LayerKey, string]> = [
    ["build", "presentation", "Builds bundle"],
    ["presentation", "execution", "Requests runtime behavior"],
    ["execution", "data", "Reads or writes state"],
    ["presentation", "identity", "Authenticates users"],
    ["execution", "integrations", "Emits events or telemetry"],
  ];

  return fallbackPairs
    .map(([fromLayer, toLayer, label]) => {
      const from = firstNode(fromLayer);
      const to = firstNode(toLayer);
      if (!from || !to) {
        return null;
      }
      return { from, to, label };
    })
    .filter(Boolean) as Array<{ from: PositionedNode; to: PositionedNode; label: string }>;
}

function edgePath(from: PositionedNode, to: PositionedNode) {
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const toCenterX = to.x + to.width / 2;
  const toCenterY = to.y + to.height / 2;

  const horizontal = Math.abs(toCenterX - fromCenterX) >= Math.abs(toCenterY - fromCenterY);
  const startX = horizontal ? from.x + from.width : fromCenterX;
  const startY = horizontal ? fromCenterY : from.y + from.height;
  const endX = horizontal ? to.x : toCenterX;
  const endY = horizontal ? toCenterY : to.y;
  const bend = horizontal
    ? Math.max(26, Math.abs(endX - startX) * 0.28)
    : Math.max(26, Math.abs(endY - startY) * 0.28);

  return horizontal
    ? `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`
    : `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
}

export function ArchitectureDiagram(props: { pack: ArchitecturePackLike }) {
  const { pack } = props;
  const awsEligible = inferAwsEligibility(pack);
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<DiagramMode>(awsEligible ? "aws" : "neutral");

  const { layers, nodes, svgHeight } = useMemo(() => {
    const builtNodes = buildNodes(pack, mode);
    return buildLayout(builtNodes);
  }, [pack, mode]);

  const edges = useMemo(() => buildEdges(pack, nodes), [pack, nodes]);

  const viewWidth = SVG_WIDTH / zoom;
  const viewHeight = svgHeight / zoom;
  const viewX = Math.max(0, (SVG_WIDTH - viewWidth) / 2);
  const viewY = Math.max(0, (svgHeight - viewHeight) / 2);

  return (
    <div className="overflow-hidden border border-[color:var(--line)] bg-[color:var(--bg-elevated)] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
            Zoom {Math.round(zoom * 100)}%
          </p>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
            Diagram mode {mode}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {awsEligible ? (
            <div className="mr-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode("neutral")}
                className={`border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                  mode === "neutral"
                    ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-white"
                    : "border-[color:var(--line)] bg-[color:var(--panel-soft)] text-[color:var(--ink-strong)]"
                }`}
              >
                Neutral
              </button>
              <button
                type="button"
                onClick={() => setMode("aws")}
                className={`border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition ${
                  mode === "aws"
                    ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-white"
                    : "border-[color:var(--line)] bg-[color:var(--panel-soft)] text-[color:var(--ink-strong)]"
                }`}
              >
                AWS
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
            className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3 py-1.5 text-sm font-semibold text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)]"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)]"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
            className="border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3 py-1.5 text-sm font-semibold text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)]"
          >
            +
          </button>
        </div>
      </div>

      <svg
        viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-auto w-full"
      >
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#8d8477" />
          </marker>
        </defs>

        <text x="24" y="28" fill="#8a7d6c" fontSize="12" fontWeight="700" letterSpacing="0.16em">
          ARCHITECTURE DIAGRAM
        </text>
        <text x="24" y="47" fill="#b09f8a" fontSize="11">
          {pack.architecture.name}
        </text>
        <text x="24" y="66" fill="#8a7d6c" fontSize="11">
          {mode === "aws" ? "AWS systems view" : "Neutral systems map"}
        </text>

        {layers.map((layer) => (
          <g key={layer.key}>
            <rect
              x={layer.x}
              y={layer.y}
              width={layer.width}
              height={layer.height}
              fill={layerPalette[layer.key].fill}
              stroke={layerPalette[layer.key].stroke}
              strokeWidth="1.1"
            />
            <rect
              x={layer.x}
              y={layer.y}
              width={layer.width}
              height={2}
              fill={layerPalette[layer.key].accent}
            />
            <text
              x={layer.x + 14}
              y={layer.y + 22}
              fill={layerPalette[layer.key].accent}
              fontSize="11"
              fontWeight="700"
              letterSpacing="0.04em"
            >
              {layer.title}
            </text>
          </g>
        ))}

        {edges.map((edge, index) => (
          <g key={`${edge.from.id}-${edge.to.id}-${index}`}>
            <path
              d={edgePath(edge.from, edge.to)}
              fill="none"
              stroke="#8d8477"
              strokeWidth="2"
              markerEnd="url(#arrow)"
              opacity="0.82"
            />
          </g>
        ))}

        {nodes.map((node) => {
          const layerColor = layerPalette[node.layer];
          return (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                fill="rgba(17,13,11,0.94)"
                stroke={layerColor.stroke}
                strokeWidth="1.1"
              />
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={3}
                fill={layerColor.accent}
              />
              {mode === "aws" && node.iconPath ? (
                <>
                  <image href={node.iconPath} x={node.x + 40} y={node.y + 10} width="48" height="48" />
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + 74}
                    fill="#f5f2eb"
                    fontSize="10"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {shorten(node.title, 18)}
                  </text>
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + 90}
                    fill="#d0c4b2"
                    fontSize="8.5"
                    textAnchor="middle"
                  >
                    {shorten(node.serviceLabel ?? "AWS service", 22)}
                  </text>
                  <text
                    x={node.x + node.width / 2}
                    y={node.y + 106}
                    fill="#8a7d6c"
                    fontSize="8.5"
                    textAnchor="middle"
                  >
                    {shorten(node.runtimeLabel, 20)}
                  </text>
                </>
              ) : (
                <>
                  <rect
                    x={node.x + 14}
                    y={node.y + 14}
                    width="34"
                    height="34"
                    fill={layerColor.accent}
                    opacity="0.24"
                    stroke={layerColor.accent}
                  />
                  <text
                    x={node.x + 31}
                    y={node.y + 36}
                    fill={layerColor.accent}
                    fontSize="16"
                    fontWeight="700"
                    textAnchor="middle"
                  >
                    {node.layer.slice(0, 1).toUpperCase()}
                  </text>
                  <text
                    x={node.x + 14}
                    y={node.y + 62}
                    fill="#f5f2eb"
                    fontSize="10"
                    fontWeight="700"
                  >
                    {shorten(node.title, 20)}
                  </text>
                  <text
                    x={node.x + 14}
                    y={node.y + 78}
                    fill="#d0c4b2"
                    fontSize="8.5"
                  >
                    {shorten(node.responsibility, 26)}
                  </text>
                  <text
                    x={node.x + 14}
                    y={node.y + 95}
                    fill="#b8ad9d"
                    fontSize="8.5"
                  >
                    {shorten(titleCaseLabel(node.targetLabel), 22)}
                  </text>
                  <text
                    x={node.x + 14}
                    y={node.y + 111}
                    fill="#8a7d6c"
                    fontSize="8.5"
                  >
                    {shorten(titleCaseLabel(node.runtimeLabel), 20)}
                  </text>
                  {node.providerLabel ? (
                    <text
                      x={node.x + 14}
                      y={node.y + 126}
                      fill={layerColor.accent}
                      fontSize="8.5"
                    >
                      {shorten(node.providerLabel.toUpperCase(), 18)}
                    </text>
                  ) : null}
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
