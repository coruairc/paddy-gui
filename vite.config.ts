import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// @ts-expect-error JS plugin alongside the TS vite config
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";

/**
 * Local controller. The browser only talks to /api on this process.
 * OpenCode itself stays on 127.0.0.1 and is never exposed by this plugin.
 */
function opencodeControllerPlugin(): Plugin {
  const mount = (middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void) => void }) => {
    middlewares.use(async (req, res, next) => {
      const path = (req.url ?? "").split("?", 1)[0] ?? "";
      if (!path.startsWith("/api")) {
        next();
        return;
      }
      try {
        const { handleNode } = (await import("./src/server/http.ts")) as {
          handleNode: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
        };
        await handleNode(req, res);
      } catch (err) {
        console.error("[paddy] controller failed:", err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "Controller error" }));
        }
      }
    });
  };
  return {
    name: "paddy-controller",
    configureServer(server) {
      mount(server.middlewares);
      void (async () => {
        const { getRuntime } = await import("./src/server/runtime.ts");
        const runtime = getRuntime();
        const shutdown = () => {
          void runtime.disconnect().finally(() => process.exit(0));
        };
        for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
          process.once(sig, shutdown);
        }
        process.once("beforeExit", () => {
          void runtime.disconnect();
        });
      })();
    },
    configurePreviewServer(server) {
      mount(server.middlewares);
      void (async () => {
        const { getRuntime } = await import("./src/server/runtime.ts");
        const runtime = getRuntime();
        const shutdown = () => {
          void runtime.disconnect().finally(() => process.exit(0));
        };
        for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
          process.once(sig, shutdown);
        }
        process.once("beforeExit", () => {
          void runtime.disconnect();
        });
      })();
    },
  };
}

function bindHost(): string {
  const requested = process.env.OPENCODE_WEB_HOST?.trim() || "127.0.0.1";
  const loopback = requested === "127.0.0.1" || requested === "localhost" || requested === "::1";
  if (!loopback && !process.env.OPENCODE_WEB_TOKEN?.trim()) {
    console.error("[paddy] refusing non-loopback bind without OPENCODE_WEB_TOKEN; using 127.0.0.1");
    return "127.0.0.1";
  }
  return requested;
}

// Dev server stays on port 8080. Host defaults to loopback; set OPENCODE_WEB_HOST and OPENCODE_WEB_TOKEN to opt into remote bind.
// The dev server starts once `src/router.tsx` and `src/routes/` exist — see
// AGENTS.md § "First scaffold".
export default defineConfig({
  server: {
    host: bindHost(),
    port: 8080,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  resolve: { tsconfigPaths: true },
    plugins: [
    opencodeControllerPlugin(),
    appEnvPlugin(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});