import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version?: string }
const appBuildChannel =
  process.env.RACKPAD_BUILD_CHANNEL ?? process.env.GITHUB_REF_NAME ?? ''
const manualChunkPackages: Record<string, string[]> = {
  react: ['react', 'react-dom', 'react-router-dom'],
  ui: [
    'lucide-react',
    'motion',
    '@radix-ui/react-dialog',
    '@radix-ui/react-popover',
    '@radix-ui/react-separator',
    '@radix-ui/react-slot',
    '@radix-ui/react-tabs',
    '@radix-ui/react-tooltip',
  ],
  charts: ['recharts'],
}

function manualChunks(id: string) {
  const normalizedId = id.split(path.sep).join('/')
  for (const [chunkName, packageNames] of Object.entries(manualChunkPackages)) {
    if (
      packageNames.some((packageName) =>
        normalizedId.includes(`/node_modules/${packageName}/`),
      )
    ) {
      return chunkName
    }
  }
  return undefined
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version ?? '0.0.0'),
    __APP_BUILD_CHANNEL__: JSON.stringify(appBuildChannel),
  },
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
