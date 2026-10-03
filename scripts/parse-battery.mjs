// Battery stream parser — reads a raw UIMessage stream file, extracts tool
// calls, citations, and the concatenated text answer. Usage:
//   node scripts/parse-battery.mjs battery-q1.raw
import { readFileSync } from "node:fs";

const file = process.argv[2];
const raw = readFileSync(file, "utf8");

const tools = [...new Set([...raw.matchAll(/"toolName":"([a-zA-Z]+)"/g)].map((m) => m[1]))];
const citations = [
  ...new Set([...raw.matchAll(/\((LOTM1|COI) Ch\.(\d+)\)/g)].map((m) => `(${m[1]} Ch.${m[2]})`)),
];
// v5 UIMessage stream: text deltas arrive as {"type":"text-delta","delta":"..."}.
const texts = [
  ...raw.matchAll(/"type":"text-delta","id":"[^"]*","delta":"((?:[^"\\]|\\.)*)"/g),
].map((m) => JSON.parse(`"${m[1]}"`));
// Legacy 0:"..." line protocol fallback.
for (const m of raw.matchAll(/^0:"((?:[^"\\]|\\.)*)"/gm)) {
  texts.push(JSON.parse(`"${m[1]}"`));
}
const full = texts.join("");
const toolErrors = [...raw.matchAll(/"type":"tool-output-error"/g)].length;

console.log(`tools: ${tools.join(", ") || "(none)"}`);
console.log(`citations: ${citations.slice(0, 10).join(" ") || "(none)"}`);
console.log(`answer length: ${full.length}`);
if (toolErrors) console.log(`TOOL ERRORS: ${toolErrors}`);
console.log("--- answer head ---");
console.log(full.slice(0, 600));
