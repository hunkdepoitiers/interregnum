import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});
