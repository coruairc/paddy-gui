import { createFileRoute } from "@tanstack/react-router";
import { channelsPausedWebhookResponse, isBridgeChannel } from "@/lib/harness/channels";
import { handleInboundFromVerifiedWebhook } from "@/lib/harness/cli-api";
import { discordPing, slackUrlVerification, toCliInboundBody } from "@/lib/harness/inbound";
import { verifyChannelWebhook } from "@/lib/harness/webhook-verify";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handlePost(request: Request, channel: string) {
  // openclaw.runtime=openclaw: OpenClaw owns channels — refuse before touching the body.
  const paused = channelsPausedWebhookResponse();
  if (paused) return paused;
  if (!isBridgeChannel(channel)) return json({ ok: false, error: "Unknown channel." }, 404);

  const rawBody = await request.text();
  let body: unknown = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return json({ ok: false, error: "Invalid JSON." }, 400);
  }

  // Slack URL verification + Discord PING must still pass signature checks when secrets exist.
  // Discord ping without DISCORD_PUBLIC_KEY remains rejected by verify (bridge uses Gateway WS).
  const verified = verifyChannelWebhook(channel, rawBody, request.headers);
  if (!verified.ok) return json({ ok: false, error: verified.error }, verified.status);

  const challenge = slackUrlVerification(body);
  if (challenge) return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  if (channel === "discord" && discordPing(body)) {
    return json({ type: 1 });
  }

  const inbound = toCliInboundBody(channel, body);
  if (!inbound) return json({ ok: true, ignored: true });

  // Verified provider traffic — call inbound directly. Never mint PADDY_CLI_TOKEN here.
  return handleInboundFromVerifiedWebhook(inbound as unknown as Record<string, unknown>);
}

export const Route = createFileRoute("/api/hooks/$channel")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handlePost(request, String(params.channel || "")),
    },
  },
});
