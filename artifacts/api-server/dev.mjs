import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareApiEnvironment } from '../../scripts/development-env.mjs';

let env;
try {
  env = prepareApiEnvironment(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const cwd = fileURLToPath(new URL('.', import.meta.url));
for (const args of [
  [fileURLToPath(new URL('./build.mjs', import.meta.url))],
  [
    '--enable-source-maps',
    fileURLToPath(new URL('./dist/index.mjs', import.meta.url)),
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    stdio: 'inherit',
  });
  if (result.error) {
    console.error('无法启动开发进程，请检查 Node.js 和项目依赖。');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
