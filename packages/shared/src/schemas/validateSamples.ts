import { z } from "zod";
import { ArchitecturePackSchema } from "./pass2a";
import { architecturePackSample } from "./samples/architecture_pack.sample";

function main() {
  try {
    ArchitecturePackSchema.parse(architecturePackSample);
    console.log("[shared] ✅ schema samples valid");
  } catch (err) {
    console.error("[shared] ❌ schema sample validation failed");

    if (err instanceof z.ZodError) {
      console.error(err.issues);
    } else {
      console.error(err);
    }

    process.exit(1);
  }
}

main();