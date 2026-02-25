import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import electron from 'vite-plugin-electron';

export default defineConfig({
  plugins: [
    react(),
    vue(),
    electron([
      {
        entry: 'electron/main.js',
        vite: {
          build: {
            rollupOptions: {
              external: ['chokidar', 'mime-types']
            }
          }
        }
      },
      {
        entry: 'electron/preload.js',
        onstart({ reload }) {
          reload();
        }
      }
    ])
  ]
});
