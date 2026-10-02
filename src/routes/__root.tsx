import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "Paddy";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Paddy is a local coworker for the project on this computer. OpenCode does the work; this is the desk.",
      },
      { name: "theme-color", content: "#0a0a0b" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg?v=mascot" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;1,400&family=Instrument+Serif:ital@0;1&display=swap",
      },
    ],
  }),
  component: () => (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-fg font-sans">
        <PreviewHostBridge />
        <Outlet />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "#18181b",
              border: "1px solid #2a2a30",
              color: "#f2f1ec",
            },
          }}
        />
        <Scripts />
      </body>
    </html>
  ),
});
