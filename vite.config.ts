import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function copyAssets() {
  return {
    name: "copy-assets",
    closeBundle() {
      for (const assetPath of ["assets/environments", "assets/characters", "assets/config.json"]) {
        const source = resolve(__dirname, assetPath);
        if (!existsSync(source)) continue;

        const destination = resolve(__dirname, "dist", assetPath);
        mkdirSync(resolve(destination, ".."), { recursive: true });
        cpSync(source, destination, {
          recursive: true,
          filter: (path) => !path.endsWith(".DS_Store"),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyAssets()],
  optimizeDeps: {
    exclude: ["@sparkjsdev/spark"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
