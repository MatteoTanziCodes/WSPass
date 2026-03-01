"use client";

import { useState } from "react";

type ComponentNode = {
  name: string;
  type: string;
};

type ArchitecturePackLike = {
  architecture: {
    name: string;
    description: string;
    components: ComponentNode[];
    data_flows: string[];
  };
};

type LayerKey = "frontend" | "api" | "compute" | "data" | "identity" | "integrations";

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
  name: string;
  type: string;
  awsService: string;
  iconPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: LayerKey;
};

const SVG_WIDTH = 980;
const OUTER_PADDING = 22;
const HEADER_HEIGHT = 64;
const LAYER_WIDTH = 286;
const LAYER_GAP_X = 18;
const LAYER_GAP_Y = 22;
const LAYER_HEADER_HEIGHT = 32;
const LAYER_PADDING_X = 16;
const LAYER_PADDING_BOTTOM = 16;
const NODE_WIDTH = 120;
const NODE_HEIGHT = 104;
const NODE_GAP_X = 12;
const NODE_GAP_Y = 14;
const MIN_LAYER_HEIGHT = 172;
const MIN_ZOOM = 0.8;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.2;

const layerOrder: LayerConfig[] = [
  { key: "frontend", title: "Frontend / Presentation", column: 0, row: 0 },
  { key: "api", title: "API Layer", column: 1, row: 0 },
  { key: "data", title: "Data Layer", column: 2, row: 0 },
  { key: "identity", title: "Authentication", column: 0, row: 1 },
  { key: "compute", title: "Execution Layer", column: 1, row: 1 },
  { key: "integrations", title: "Observability / Integrations", column: 2, row: 1 },
];

const serviceIconMap: Record<string, { service: string; iconPath: string }> = {
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

function toId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function inferLayer(component: ComponentNode): LayerKey {
  if (component.type === "web") {
    return "frontend";
  }
  if (component.type === "api") {
    return "api";
  }
  if (component.type === "worker") {
    return "compute";
  }
  if (component.type === "db" || component.type === "cache" || component.type === "queue" || component.type === "object_storage") {
    return "data";
  }
  if (component.type === "auth_provider") {
    return "identity";
  }
  return "integrations";
}

function inferAwsService(component: ComponentNode) {
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

  return serviceIconMap[component.type] ?? { service: "Amazon EventBridge", iconPath: "/aws-icons/eventbridge.svg" };
}

function measureLayerHeight(nodeCount: number) {
  const columns = nodeCount > 1 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(nodeCount / columns));
  return Math.max(
    MIN_LAYER_HEIGHT,
    LAYER_HEADER_HEIGHT + LAYER_PADDING_BOTTOM + rows * NODE_HEIGHT + (rows - 1) * NODE_GAP_Y + 18
  );
}

function buildLayout(pack: ArchitecturePackLike) {
  const grouped = new Map<LayerKey, ComponentNode[]>();
  for (const layer of layerOrder) {
    grouped.set(layer.key, []);
  }

  for (const component of pack.architecture.components) {
    grouped.get(inferLayer(component))?.push(component);
  }

  const layerHeights = new Map<LayerKey, number>();
  for (const layer of layerOrder) {
    layerHeights.set(layer.key, measureLayerHeight((grouped.get(layer.key) ?? []).length));
  }

  const topRowHeight = Math.max(...layerOrder.filter((layer) => layer.row === 0).map((layer) => layerHeights.get(layer.key) ?? MIN_LAYER_HEIGHT));
  const bottomRowHeight = Math.max(...layerOrder.filter((layer) => layer.row === 1).map((layer) => layerHeights.get(layer.key) ?? MIN_LAYER_HEIGHT));

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

  const nodes: PositionedNode[] = [];
  for (const layer of layers) {
    const components = grouped.get(layer.key) ?? [];
    const columns = components.length > 1 ? 2 : 1;
    const leftInset = layer.x + LAYER_PADDING_X;
    const startX =
      columns === 1
        ? layer.x + Math.round((layer.width - NODE_WIDTH) / 2)
        : leftInset;

    components.forEach((component, index) => {
      const service = inferAwsService(component);
      const row = Math.floor(index / columns);
      const column = index % columns;
      nodes.push({
        id: toId(component.name),
        name: component.name,
        type: component.type,
        awsService: service.service,
        iconPath: service.iconPath,
        x: startX + column * (NODE_WIDTH + NODE_GAP_X),
        y: layer.y + LAYER_HEADER_HEIGHT + 10 + row * (NODE_HEIGHT + NODE_GAP_Y),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        layer: layer.key,
      });
    });
  }

  return {
    layers,
    nodes,
    svgHeight: HEADER_HEIGHT + topRowHeight + LAYER_GAP_Y + bottomRowHeight + OUTER_PADDING,
  };
}

function inferEdges(pack: ArchitecturePackLike, nodes: PositionedNode[]) {
  const edges: Array<{ from: PositionedNode; to: PositionedNode }> = [];

  for (const flow of pack.architecture.data_flows) {
    const matched = nodes.filter((node) => flow.toLowerCase().includes(node.name.toLowerCase()));
    if (matched.length >= 2) {
      edges.push({ from: matched[0], to: matched[1] });
    }
  }

  if (edges.length > 0) {
    return edges.slice(0, 12);
  }

  const firstNodeInLayer = (layer: LayerKey) => nodes.find((node) => node.layer === layer);
  const fallbackPairs: Array<[LayerKey, LayerKey]> = [
    ["frontend", "api"],
    ["api", "compute"],
    ["compute", "data"],
    ["api", "identity"],
    ["compute", "integrations"],
  ];

  for (const [fromLayer, toLayer] of fallbackPairs) {
    const from = firstNodeInLayer(fromLayer);
    const to = firstNodeInLayer(toLayer);
    if (from && to) {
      edges.push({ from, to });
    }
  }

  return edges;
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
  const bend = horizontal ? Math.max(24, Math.abs(endX - startX) * 0.3) : Math.max(24, Math.abs(endY - startY) * 0.3);

  return horizontal
    ? `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`
    : `M ${startX} ${startY} C ${startX} ${startY + bend}, ${endX} ${endY - bend}, ${endX} ${endY}`;
}

function labelFor(name: string) {
  return name.length > 16 ? `${name.slice(0, 14)}..` : name;
}

function serviceLabelFor(name: string) {
  return name.replace("Amazon ", "").replace("AWS ", "");
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))));
}

export function ArchitectureDiagram(props: { pack: ArchitecturePackLike }) {
  const { pack } = props;
  const [zoom, setZoom] = useState(1);
  const { layers, nodes, svgHeight } = buildLayout(pack);
  const edges = inferEdges(pack, nodes);

  const viewWidth = SVG_WIDTH / zoom;
  const viewHeight = svgHeight / zoom;
  const viewX = Math.max(0, (SVG_WIDTH - viewWidth) / 2);
  const viewY = Math.max(0, (svgHeight - viewHeight) / 2);

  return (
    <div className="overflow-hidden rounded-[30px] border border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(245,246,248,0.95),rgba(234,236,239,0.92))] p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
          Zoom {Math.round(zoom * 100)}%
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
            className="rounded-full border border-[color:var(--line)] bg-white/75 px-3 py-1.5 text-sm font-semibold text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)]"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="rounded-full border border-[color:var(--line)] bg-white/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)]"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
            className="rounded-full border border-[color:var(--line)] bg-white/75 px-3 py-1.5 text-sm font-semibold text-[color:var(--ink-strong)] transition hover:border-[color:var(--accent)]"
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
            <path d="M0,0 L10,5 L0,10 z" fill="#7f7f86" />
          </marker>
        </defs>

        <text x="22" y="28" fill="#4e5361" fontSize="12" fontWeight="700" letterSpacing="0.16em">
          ARCHITECTURE WIREFRAME
        </text>
        <text x="22" y="47" fill="#6d7484" fontSize="11">
          {pack.architecture.name}
        </text>

        {layers.map((layer) => (
          <g key={layer.key}>
            <rect
              x={layer.x}
              y={layer.y}
              rx="18"
              ry="18"
              width={layer.width}
              height={layer.height}
              fill="rgba(201, 219, 231, 0.58)"
              stroke="rgba(120, 138, 158, 0.45)"
              strokeWidth="1.2"
            />
            <text x={layer.x + 14} y={layer.y + 22} fill="#536171" fontSize="11" fontWeight="600">
              {layer.title}
            </text>
          </g>
        ))}

        {edges.map((edge, index) => (
          <path
            key={`${edge.from.id}-${edge.to.id}-${index}`}
            d={edgePath(edge.from, edge.to)}
            fill="none"
            stroke="#7f7f86"
            strokeWidth="2"
            markerEnd="url(#arrow)"
            opacity="0.78"
          />
        ))}

        {nodes.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              rx="16"
              ry="16"
              width={node.width}
              height={node.height}
              fill="rgba(255,255,255,0.94)"
              stroke="rgba(120, 138, 158, 0.35)"
              strokeWidth="1.1"
            />
            <image href={node.iconPath} x={node.x + 36} y={node.y + 10} width="48" height="48" />
            <text
              x={node.x + node.width / 2}
              y={node.y + 76}
              fill="#223144"
              fontSize="10"
              fontWeight="700"
              textAnchor="middle"
            >
              {labelFor(node.name)}
            </text>
            <text
              x={node.x + node.width / 2}
              y={node.y + 92}
              fill="#5c6674"
              fontSize="8.5"
              textAnchor="middle"
            >
              {serviceLabelFor(node.awsService)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
