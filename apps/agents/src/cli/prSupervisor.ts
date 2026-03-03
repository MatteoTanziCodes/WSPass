import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { runPrSupervisorAgent } from "../implementation/runPrSupervisorAgent";

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
  const issueId = readArg(process.argv.slice(2), "issue-id");
  if (!runId || !issueId) {
    throw new Error(
      "Usage: npm run -w @pass/agents pr-supervisor -- --run-id=<uuid> --issue-id=<issue-id>"
    );
  }
  await runPrSupervisorAgent(runId, issueId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
