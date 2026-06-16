import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function copySceneAssets() {
  return {
    name: "copy-scene-assets",
    closeBundle() {
      const source = resolve(__dirname, "assets/environments");
      if (!existsSync(source)) return;

      const destination = resolve(__dirname, "dist/assets/environments");
      mkdirSync(destination, { recursive: true });
      cpSync(source, destination, {
        recursive: true,
        filter: (path) => !path.endsWith(".DS_Store"),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), copySceneAssets()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
