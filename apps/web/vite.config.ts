/// <reference types="vitest/config" />
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// `vite --mode https`: LAN dev server over HTTPS (self-signed) so phones and
// tablets can open the camera (getUserMedia needs a secure context).
export default defineConfig(({ mode }) => ({
  server: mode === "https" ? { host: true } : undefined,
  plugins: [
    ...(mode === "https" ? [basicSsl()] : []),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "AI Gym",
        short_name: "AI Gym",
        lang: "tr",
        display: "standalone",
        background_color: "#0e1012",
        theme_color: "#0e1012",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
    }),
  ],
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
}));
