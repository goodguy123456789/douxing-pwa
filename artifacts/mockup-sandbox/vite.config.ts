import { defineConfig, loadEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import { mockupPreviewPlugin } from './mockupPreviewPlugin';

import { webDevelopmentOptions } from '../../scripts/development-env.mjs';

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
  const environment = {
    ...loadEnv(mode, path.resolve(import.meta.dirname, '../..'), ''),
    ...process.env,
  };
  const {
    port,
    base: basePath,
    host,
    proxy,
  } = webDevelopmentOptions(environment, 5174);
  return {
    base: basePath,
    plugins: [
      mockupPreviewPlugin(),
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(environment.NODE_ENV !== 'production' &&
      environment.REPL_ID !== undefined
        ? [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist'),
      emptyOutDir: true,
    },
    server: {
      port,
      host,
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host,
      allowedHosts: true,
    },
  };
});
