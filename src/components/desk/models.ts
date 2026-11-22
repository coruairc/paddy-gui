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
