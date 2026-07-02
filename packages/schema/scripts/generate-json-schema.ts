import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { moduleSchema } from "../src/schema.js";

const out = zodToJsonSchema(moduleSchema, "Module");
const outPath = fileURLToPath(new URL("../module.schema.json", import.meta.url));
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`written: ${outPath}`);
