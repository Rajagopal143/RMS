import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the built app loads from file:// inside Electron.
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@workspace/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  css: {
    postcss: path.resolve(__dirname, "./postcss.config.mjs"),
  },
  server: { port: 5173, strictPort: true },
});
