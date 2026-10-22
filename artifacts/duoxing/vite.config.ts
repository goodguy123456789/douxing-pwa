import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

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
  } = webDevelopmentOptions(environment, 5173);
  return {
    base: basePath,
    plugins: [
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
            await import('@replit/vite-plugin-dev-banner').then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      proxy,
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
