import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "duoxing-tests-"));
try {
  const outfile = join(dir, "match.test.mjs");
  await build({ entryPoints: ["tests/match.test.ts"], outfile, platform: "node", format: "esm", bundle: true });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
