import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { runImplementationAgent } from "../implementation/runImplementationAgent";

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

  throw new Error("Usage: npm run -w @pass/agents implementation -- --run-id=<uuid>");
}

async function main() {
  const runId = readRunId(process.argv.slice(2));
  await runImplementationAgent(runId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
