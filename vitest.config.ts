import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // Match Next's JSX runtime for component rendering regression tests.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
