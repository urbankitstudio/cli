import { homedir } from "node:os";
import { run } from "./cli.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const code = await run(process.argv.slice(2), {
  fetch: globalThis.fetch,
  env: process.env,
  stdout: (t) => process.stdout.write(t),
  stderr: (t) => process.stderr.write(t),
  readStdin,
  platform: process.platform,
  homedir: homedir(),
  now: () => new Date(),
});
process.exitCode = code;
