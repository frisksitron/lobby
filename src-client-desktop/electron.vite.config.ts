import { resolve } from "node:path"
import { defineConfig } from "electron-vite"
import solid from "vite-plugin-solid"
import pkg from "./package.json"

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        output: {
          format: "es"
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src")
      }
    },
    plugins: [solid()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
})
