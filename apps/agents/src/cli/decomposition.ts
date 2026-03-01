import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { runDecompositionAgent } from "../decomposition/runDecompositionAgent";

loadDotenv({ path: resolve(__dirname, "../../../../.env") });

function readRunId(argv: string[]) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg?.startsWith("--run-id=")) {
      return arg.slice("--run-id=".length);
    }
    if (arg === "--run-id") {
      return argv[index + 1];
    }
  }

  throw new Error("Usage: npm run -w @pass/agents decomposition -- --run-id=<uuid>");
}

async function main() {
  const runId = readRunId(process.argv.slice(2));
  await runDecompositionAgent(runId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
