import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

function compressJsonBridgePlugin() {
  const sourceFile = path.resolve(__dirname, '../compress.json')
  const routeMatchers = new Set(['/compress.json', '/workbench/compress.json'])
  const spriteSourceFile = path.resolve(__dirname, '../media/items/new.png')
  const spriteRouteMatchers = new Set(['/media/items/new.png', '/workbench/media/items/new.png'])

  return {
    name: 'wynnbuilder-compress-json-bridge',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? ''
        const pathname = rawUrl.split('?')[0]
        if (!routeMatchers.has(pathname)) {
          if (spriteRouteMatchers.has(pathname)) {
            try {
              const data = await fsp.readFile(spriteSourceFile)
              res.setHeader('Content-Type', 'image/png')
              res.statusCode = 200
              res.end(data)
            } catch (error) {
              res.statusCode = 500
              res.end(
                JSON.stringify({
                  error: 'Unable to read item sprite',
                  message: error instanceof Error ? error.message : 'unknown error',
                }),
              )
            }
            return
          }
          next()
          return
        }
        try {
          const data = await fsp.readFile(sourceFile)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.statusCode = 200
          res.end(data)
        } catch (error) {
          res.statusCode = 500
          res.end(
            JSON.stringify({
              error: 'Unable to read compress.json',
              message: error instanceof Error ? error.message : 'unknown error',
            }),
          )
        }
      })
    },
    async closeBundle() {
      const outFile = path.resolve(__dirname, '../workbench/compress.json')
      if (!fs.existsSync(sourceFile)) return
      await fsp.copyFile(sourceFile, outFile)
      if (fs.existsSync(spriteSourceFile)) {
        const spriteOutDir = path.resolve(__dirname, '../workbench/media/items')
        await fsp.mkdir(spriteOutDir, { recursive: true })
        await fsp.copyFile(spriteSourceFile, path.join(spriteOutDir, 'new.png'))
      }
      const assetsDir = path.resolve(__dirname, '../workbench/assets')
      if (fs.existsSync(assetsDir)) {
        const files = await fsp.readdir(assetsDir)
        await Promise.all(
          files
            .filter((file) => file.endsWith('.map'))
            .map((file) => fsp.unlink(path.join(assetsDir, file)).catch(() => undefined)),
        )
      }
    },
  }
}

export default defineConfig({
  base: '/workbench/',
  plugins: [react(), tailwindcss(), compressJsonBridgePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../workbench',
    emptyOutDir: true,
    sourcemap: false,
  },
})
