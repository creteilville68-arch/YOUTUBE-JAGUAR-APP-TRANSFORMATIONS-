import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    hmr: false,
    proxy: {
      // Route Convex API + WebSocket traffic through the app origin so the
      // app works from outside the sandbox (phones, other devices).
      "/convx": {
        target: "http://127.0.0.1:3210",
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/convx/, ""),
      },
    },
  },
});
