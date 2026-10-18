import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "duoxing-tests-"));
try {
  const outfiles = [];
  for (const name of ["match", "http-logging"]) {
    const outfile = join(dir, `${name}.test.cjs`);
    await build({ entryPoints: [`tests/${name}.test.ts`], outfile, platform: "node", format: "cjs", bundle: true });
    outfiles.push(outfile);
  }
  const result = spawnSync(process.execPath, ["--test", ...outfiles], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(dir, { recursive: true, force: true });
}
