import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

function compressJsonBridgePlugin() {
  const sourceFile = path.resolve(__dirname, '../compress.json')
  const routeMatchers = new Set(['/compress.json'])
  const spriteSourceFile = path.resolve(__dirname, '../media/items/new.png')
  const spriteRouteMatchers = new Set(['/media/items/new.png'])
  const latestAtreeVersion = '2.1.6.0'
  const atreeRoutePattern = /^\/data\/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\/atree\.json$/

  async function serveJsonFile(res: import('node:http').ServerResponse, filePath: string, kind: string) {
    try {
      const data = await fsp.readFile(filePath)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.statusCode = 200
      res.end(data)
    } catch (error) {
      res.statusCode = 500
      res.end(
        JSON.stringify({
          error: `Unable to read ${kind}`,
          message: error instanceof Error ? error.message : 'unknown error',
        }),
      )
    }
  }

  return {
    name: 'wynnbuilder-compress-json-bridge',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url ?? ''
        const pathname = rawUrl.split('?')[0]
        const atreeMatch = pathname.match(atreeRoutePattern)
        if (atreeMatch) {
          const version = atreeMatch[1]
          const atreeSourceFile = path.resolve(__dirname, `../data/${version}/atree.json`)
          await serveJsonFile(res, atreeSourceFile, `ability tree data (${version})`)
          return
        }
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
        await serveJsonFile(res, sourceFile, 'compress.json')
      })
    },
    async closeBundle() {
      const outDir = path.resolve(__dirname, '../dist')
      const outFile = path.join(outDir, 'compress.json')
      if (!fs.existsSync(sourceFile)) return
      await fsp.copyFile(sourceFile, outFile)
      if (fs.existsSync(spriteSourceFile)) {
        const spriteOutDir = path.join(outDir, 'media/items')
        await fsp.mkdir(spriteOutDir, { recursive: true })
        await fsp.copyFile(spriteSourceFile, path.join(spriteOutDir, 'new.png'))
      }
      const atreeSourceFile = path.resolve(__dirname, `../data/${latestAtreeVersion}/atree.json`)
      if (fs.existsSync(atreeSourceFile)) {
        const atreeOutDir = path.join(outDir, `data/${latestAtreeVersion}`)
        await fsp.mkdir(atreeOutDir, { recursive: true })
        await fsp.copyFile(atreeSourceFile, path.join(atreeOutDir, 'atree.json'))
      }
      const assetsDir = path.join(outDir, 'assets')
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

export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react(), tailwindcss(), compressJsonBridgePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
  },
}))
