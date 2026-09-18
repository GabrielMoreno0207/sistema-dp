import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/** O HMR do Vite precisa de ws://localhost no CSP; o app instalado não. */
function stripDevCsp(): Plugin {
  return {
    name: 'strip-dev-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace(' ws://localhost:*', ''),
  };
}

export default defineConfig({
  main: {},
  preload: {
    build: {
      // Preloads com sandbox não podem compartilhar chunks: por isso index.ts e popup.ts
      // não importam nenhum módulo em comum (ver shared/popup-channels.ts)
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          popup: resolve(__dirname, 'src/preload/popup.ts'),
        },
      },
    },
  },
  renderer: {
    plugins: [react(), stripDevCsp()],
    build: {
      minify: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          popup: resolve(__dirname, 'src/renderer/popup.html'),
        },
      },
    },
  },
});
