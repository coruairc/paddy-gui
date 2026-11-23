/**
 * Pure helpers for the sidebar's agent select. OpenCode v2.3.2 `GET /api/agent`
 * returns `{ id, name, … }` per agent, where `id` ("build", "general") is the
 * identifier its session API takes and `name` ("Build", "General") is display
 * text only: `session.switchAgent`'s payload is schema `Agent.ID`, and
 * `agent.get` takes an `agentID`. Sending the display name therefore asks for an
 * agent that does not exist — `switchAgent` stores whatever string it is given,
 * so the failure only lands on the next turn ("Agent not found").
 */

export type AgentOption = {
  /** Wire identifier (`Agent.ID`). */
  id: string;
  /** Display label. */
  name: string;
};

/**
 * OpenCode's built-in default primary agent. A send with no agent runs it, so
 * the select's "" row represents this agent and the list must not repeat it.
 */
export const DEFAULT_AGENT_ID = "build";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** `/api/agent` payload → select options, keyed and deduped by id. */
export function agentOptions(payload: unknown): AgentOption[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>();
  const options: AgentOption[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const id = text((item as { id?: unknown }).id);
    // No id means no valid identifier: the agent cannot be selected by a send.
    if (!id || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, name: text((item as { name?: unknown }).name) || id });
  }
  return options;
}

/** Rows after the default "" row: everything but the agent that row already means. */
export function agentChoices(options: AgentOption[]): AgentOption[] {
  return options.filter((option) => option.id !== DEFAULT_AGENT_ID);
}

/** Label for the "" row: the payload's name for the default agent, else its built-in name. */
export function defaultAgentName(options: AgentOption[]): string {
  return options.find((option) => option.id === DEFAULT_AGENT_ID)?.name ?? "Build";
}
