import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const sslEnabled = env.SSL_ENABLED === "true";
  const httpsOptions = sslEnabled
    ? {
        key: fs.readFileSync(path.resolve(env.SSL_KEY_PATH ?? "ssl/key.pem")),
        cert: fs.readFileSync(
          path.resolve(env.SSL_CERT_PATH ?? "ssl/cert.pem"),
        ),
      }
    : undefined;

  return {
    root: "src/client",
    build: {
      outDir: "../../public",
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        "~": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    plugins: [react()],
    server: {
      https: httpsOptions,
      proxy: {
        // Proxied at /api/v1 specifically, not the bare /api prefix both
        // reference apps use — that would collide with this client's own
        // src/client/api/ directory served at the same relative URL (see
        // wake-on-lan's CLAUDE.md for the documented routing collision).
        "/api/v1": {
          target: sslEnabled
            ? "https://localhost:3001"
            : "http://localhost:3001",
          secure: false, // allow self-signed cert on the backend
          // Rewrite the Host header to the backend's so req.get("host") on
          // the server reflects localhost:3001 (where /callback lives),
          // not the Vite dev server's own port.
          changeOrigin: true,
        },
      },
    },
  };
});
