import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // All backend calls go through /api -> FastAPI on :8000, per the
      // architecture spec. src/lib/api.ts always fetches relative paths
      // ("/api/v1/..."), never an absolute host, so this proxy is the
      // only place the backend's location is configured.
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
