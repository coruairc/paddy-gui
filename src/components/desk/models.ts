/**
 * Pure helpers for the model picker. Everything here is framework-free so it
 * runs under `node:test` — the project has no component-render tooling.
 */

export type ModelLike = {
  key: string;
  id: string;
  providerID: string;
  name: string;
};

/** Canonical key: `providerID/<entry id>` (first-slash split, id may contain slashes). */
export function modelKey(entry: { providerID: string; id: string }): string {
  return `${entry.providerID}/${entry.id}`;
}

export function parseModelKey(key: string): { providerID: string; id: string } | null {
  const index = key.indexOf("/");
  if (index <= 0 || index === key.length - 1) return null;
  return { providerID: key.slice(0, index), id: key.slice(index + 1) };
}

/** DOM-id-safe slug for element ids (model ids may contain `/`). */
export function modelSlug(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function filterModels<T extends { name: string; id: string; providerID: string }>(
  models: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...models];
  return models.filter((model) =>
    `${model.name} ${model.id} ${model.providerID}`.toLowerCase().includes(needle),
  );
}

const PROVIDER_BRANDS: Record<string, string> = {
  openai: "OpenAI",
  "github-copilot": "GitHub Copilot",
  "opencode-go": "OpenCode Go",
  "alibaba-token-plan": "Alibaba Token Plan",
  "ollama-cloud": "Ollama Cloud",
  deepseek: "DeepSeek",
  xai: "xAI",
  google: "Google",
  opencode: "OpenCode",
  poolside: "Poolside",
};

export function humanizeProviderID(providerID: string): string {
  const known = PROVIDER_BRANDS[providerID];
  if (known) return known;
  return providerID
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type ModelGroup<T> = { providerID: string; label: string; models: T[] };

/** Flatten grouped output into the visible order the keyboard walks. */
export function flattenGroups<T>(groups: readonly ModelGroup<T>[]): T[] {
  return groups.flatMap((group) => group.models);
}

/** Clamped navigation: no wrap-around; `-1` enters from either end. */
export function nextActiveIndex(
  current: number,
  length: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): number {
  if (length <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : Math.min(current + 1, length - 1);
  return current < 0 ? length - 1 : Math.max(current - 1, 0);
}

export function groupModelsByProvider<T extends ModelLike>(
  models: readonly T[],
): ModelGroup<T>[] {
  const byProvider = new Map<string, T[]>();
  for (const model of models) {
    const list = byProvider.get(model.providerID) ?? [];
    list.push(model);
    byProvider.set(model.providerID, list);
  }
  const groups: ModelGroup<T>[] = [];
  for (const [providerID, items] of byProvider) {
    groups.push({
      providerID,
      label: humanizeProviderID(providerID),
      models: items.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    });
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

function labelFor(models: readonly ModelLike[], key: string): string {
  const match = models.find((model) => model.key === key);
  return match ? match.name || match.id : key;
}

export type ActiveModel = {
  key: string;
  label: string;
  isStale: boolean;
  persistedKey: string;
};

/**
 * Resolve what the header shows. An unfetched catalog is never treated as a
 * miss — only a loaded catalog can prove the persisted key stale.
 */
export function resolveActiveModel(
  persistedKey: string,
  models: readonly ModelLike[],
  defaultKey: string,
  catalogLoaded: boolean,
): ActiveModel {
  if (!catalogLoaded) {
    return {
      key: persistedKey,
      label: persistedKey,
      isStale: false,
      persistedKey,
    };
  }
  if (!persistedKey) return { key: "", label: "", isStale: false, persistedKey: "" };
  if (models.some((model) => model.key === persistedKey)) {
    return {
      key: persistedKey,
      label: labelFor(models, persistedKey),
      isStale: false,
      persistedKey,
    };
  }
  const fallbackExists = defaultKey !== "" && models.some((model) => model.key === defaultKey);
  const key = fallbackExists ? defaultKey : "";
  return { key, label: key ? labelFor(models, key) : "", isStale: true, persistedKey };
}

/**
 * The single decision point for what gets sent. A stale persisted key must
 * never be POSTed once the loaded catalog proves it absent.
 */
export function modelForSend(persistedKey: string, active: ActiveModel): string {
  return active.isStale ? active.key : persistedKey;
}
