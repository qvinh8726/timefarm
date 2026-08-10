import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Electron loads the production renderer from file://. Relative asset URLs
  // are required there; an absolute /assets path resolves to the drive root
  // and produces a blank window in the packaged app.
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
