import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adminRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: adminRoot,
  plugins: [react()],
  build: {
    outDir: path.resolve(adminRoot, "..", "dist", "admin"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});

