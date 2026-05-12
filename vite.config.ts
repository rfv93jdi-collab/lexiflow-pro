import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const raw = (env.VITE_BASE_URL || '/').trim();
  const base = raw === '' || raw === '/' ? '/' : raw.endsWith('/') ? raw : `${raw}/`;
  return {
    base,
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // Ключ LLMost не подставляем в бандл — запросы идут через /api/llmost на server.ts
      'process.env.LLMOST_MODEL': JSON.stringify(
        env.LLMOST_MODEL || 'openai/gpt-4o-mini'
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify — file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
