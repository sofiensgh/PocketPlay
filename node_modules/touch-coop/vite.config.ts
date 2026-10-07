import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "TouchCoop",
      fileName: (format) => {
        if (format === "es") return "index.mjs";
        if (format === "cjs") return "index.cjs";
        if (format === "iife") return "index.global.js";
        return `index.${format}.js`;
      },
      formats: ["es", "cjs", "iife"],
    },
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      external: (id) => {
        if (/qrcode/.test(id)) {
          const format = process.env.BUILD_FORMAT;
          return format === "es" || format === "cjs";
        }
        return false;
      },
      output: {
        globals: {},
      },
    },
  },
});
