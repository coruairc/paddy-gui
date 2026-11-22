import test from "node:test";
import assert from "node:assert/strict";
import {
  filterModels,
  groupModelsByProvider,
  humanizeProviderID,
  modelForSend,
  modelKey,
  modelSlug,
  parseModelKey,
  resolveActiveModel,
  type ModelLike,
} from "./models.ts";

function entry(overrides: Partial<ModelLike> & { providerID: string; id: string }): ModelLike {
  return {
    key: modelKey(overrides),
    name: overrides.id,
    ...overrides,
  } as ModelLike;
}

const catalog: ModelLike[] = [
  entry({ providerID: "openai", id: "gpt-6.2-astra", name: "GPT-6.2 Astra" }),
  entry({ providerID: "openai", id: "gpt-6.2-astra-fast", name: "GPT-6.2 Astra Fast" }),
  entry({ providerID: "google", id: "gemini-3", name: "Gemini 3" }),
  entry({ providerID: "poolside", id: "poolside/laguna-s-2.1", name: "Laguna S 2.1" }),
  entry({ providerID: "alibaba-token-plan", id: "qwen4-max", name: "Qwen4 Max" }),
];

test("modelKey joins provider and entry id", () => {
  assert.equal(modelKey({ providerID: "openai", id: "gpt" }), "openai/gpt");
});

test("parseModelKey splits on the first slash only", () => {
  assert.deepEqual(parseModelKey("poolside/poolside/laguna-s-2.1"), {
    providerID: "poolside",
    id: "poolside/laguna-s-2.1",
  });
  assert.equal(parseModelKey(""), null);
  assert.equal(parseModelKey("/x"), null);
  assert.equal(parseModelKey("x/"), null);
});

test("duplicate modelID speed tiers stay distinct rows", () => {
  const keys = catalog.map((model) => model.key);
  assert.equal(new Set(keys).size, catalog.length);
  const openai = catalog.filter((model) => model.providerID === "openai");
  assert.equal(openai.length, 2);
});

test("filterModels matches name, id and providerID case-insensitively", () => {
  assert.deepEqual(filterModels(catalog, ""), catalog);
  assert.equal(filterModels(catalog, "astra").length, 2);
  assert.equal(filterModels(catalog, "POOLSIDE").length, 1);
  assert.equal(filterModels(catalog, "laguna").length, 1);
  assert.equal(filterModels(catalog, "nothing-here").length, 0);
});

test("humanizeProviderID uses the brand map and a title-case fallback", () => {
  assert.equal(humanizeProviderID("openai"), "OpenAI");
  assert.equal(humanizeProviderID("github-copilot"), "GitHub Copilot");
  assert.equal(humanizeProviderID("opencode-go"), "OpenCode Go");
  assert.equal(humanizeProviderID("alibaba-token-plan"), "Alibaba Token Plan");
  assert.equal(humanizeProviderID("ollama-cloud"), "Ollama Cloud");
  assert.equal(humanizeProviderID("deepseek"), "DeepSeek");
  assert.equal(humanizeProviderID("xai"), "xAI");
  assert.equal(humanizeProviderID("google"), "Google");
  assert.equal(humanizeProviderID("opencode"), "OpenCode");
  assert.equal(humanizeProviderID("poolside"), "Poolside");
  assert.equal(humanizeProviderID("some_new-provider"), "Some New Provider");
});

test("groupModelsByProvider is alphabetical by label and name, with counts", () => {
  const groups = groupModelsByProvider(catalog);
  assert.deepEqual(
    groups.map((group) => group.providerID),
    ["alibaba-token-plan", "google", "openai", "poolside"],
  );
  const openai = groups.find((group) => group.providerID === "openai");
  assert.deepEqual(
    openai?.models.map((model) => model.name),
    ["GPT-6.2 Astra", "GPT-6.2 Astra Fast"],
  );
  assert.equal(groups.find((group) => group.providerID === "google")?.label, "Google");
});

test("grouping survives a 272-entry catalog without duplicates", () => {
  const many: ModelLike[] = Array.from({ length: 272 }, (_, index) =>
    entry({
      providerID: index % 2 ? "openai" : "google",
      id: `model-${index}`,
      name: `Model ${String(index).padStart(3, "0")}`,
    }),
  );
  const groups = groupModelsByProvider(many);
  const total = groups.reduce((sum, group) => sum + group.models.length, 0);
  assert.equal(total, 272);
  assert.equal(new Set(groups.flatMap((group) => group.models.map((model) => model.key))).size, 272);
});

test("modelSlug replaces every unsafe id character", () => {
  assert.equal(modelSlug("poolside/poolside/laguna-s-2.1"), "poolside_poolside_laguna-s-2.1");
});

test("resolveActiveModel never treats an unfetched catalog as a miss", () => {
  const active = resolveActiveModel("openai/gpt-x", catalog, "google/gemini-3", false);
  assert.deepEqual(active, {
    key: "openai/gpt-x",
    label: "openai/gpt-x",
    isStale: false,
    persistedKey: "openai/gpt-x",
  });
});

test("resolveActiveModel resolves a present persisted key to its catalog name", () => {
  const active = resolveActiveModel("openai/gpt-6.2-astra", catalog, "google/gemini-3", true);
  assert.equal(active.key, "openai/gpt-6.2-astra");
  assert.equal(active.label, "GPT-6.2 Astra");
  assert.equal(active.isStale, false);
});

test("resolveActiveModel falls back to the default and flags stale", () => {
  const active = resolveActiveModel("openai/gpt-x", catalog, "google/gemini-3", true);
  assert.deepEqual(active, {
    key: "google/gemini-3",
    label: "Gemini 3",
    isStale: true,
    persistedKey: "openai/gpt-x",
  });
});

test("resolveActiveModel returns empty when nothing is chosen", () => {
  assert.deepEqual(resolveActiveModel("", catalog, "google/gemini-3", true), {
    key: "",
    label: "",
    isStale: false,
    persistedKey: "",
  });
});

test("modelForSend sends the effective key only when stale", () => {
  const loaded = resolveActiveModel("openai/gpt-x", catalog, "google/gemini-3", true);
  assert.equal(modelForSend("openai/gpt-x", loaded), "google/gemini-3");
  const unloaded = resolveActiveModel("openai/gpt-x", catalog, "google/gemini-3", false);
  assert.equal(modelForSend("openai/gpt-x", unloaded), "openai/gpt-x");
});
