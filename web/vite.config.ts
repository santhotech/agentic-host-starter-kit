import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API = `http://localhost:${process.env.HOST_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
});
