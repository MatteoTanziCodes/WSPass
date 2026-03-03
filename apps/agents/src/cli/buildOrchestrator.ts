import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { runBuildOrchestratorAgent } from "../orchestration/runBuildOrchestratorAgent";

loadDotenv({ path: resolve(__dirname, "../../../../.env") });

function readArg(argv: string[], name: string) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg?.startsWith(`--${name}=`)) {
      return arg.slice(name.length + 3);
    }
    if (arg === `--${name}`) {
      return argv[index + 1];
    }
  }

  return undefined;
}

async function main() {
  const runId = readArg(process.argv.slice(2), "run-id");
  if (!runId) {
    throw new Error("Usage: npm run -w @pass/agents build-orchestrator -- --run-id=<uuid>");
  }
  await runBuildOrchestratorAgent(runId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
