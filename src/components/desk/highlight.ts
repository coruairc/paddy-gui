/**
 * Lazy Monokai syntax highlighting for diffs. Nothing here loads until a diff
 * is expanded: shiki's core, the JavaScript regex engine (no WASM), the
 * Monokai theme and each grammar are separate dynamic chunks. Output is
 * plain token data rendered as React text nodes — no HTML strings.
 */
import type { HighlighterCore, ThemedToken } from "shiki/core";

export type Token = { content: string; color?: string; fontStyle?: number };

export const MONOKAI = {
  bg: "#272822",
  fg: "#F8F8F2",
  muted: "#75715E",
  green: "#A6E22E",
  pink: "#F92672",
  addBg: "rgba(166, 226, 46, 0.16)",
  delBg: "rgba(249, 38, 114, 0.18)",
  gutter: "#1e1f1c",
} as const;

// Explicit table so the bundler emits one chunk per grammar (never the full set).
const LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  make: () => import("shiki/langs/make.mjs"),
};

/** Beyond this many lines a file is shown as plain (still Monokai-coloured) text. */
export const MAX_HIGHLIGHT_LINES = 3000;

let core: Promise<HighlighterCore> | null = null;
const loaded = new Map<string, Promise<boolean>>();

function highlighter(): Promise<HighlighterCore> {
  core ??= Promise.all([import("shiki/core"), import("shiki/engine/javascript"), import("shiki/themes/monokai.mjs")]).then(
    ([{ createHighlighterCore }, { createJavaScriptRegexEngine }, monokai]) =>
      createHighlighterCore({ themes: [monokai.default], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }),
  );
  core.catch(() => {
    core = null;
  });
  return core;
}

function ensureLanguage(instance: HighlighterCore, lang: string): Promise<boolean> {
  let ready = loaded.get(lang);
  if (!ready) {
    const loader = LOADERS[lang];
    ready = loader
      ? loader()
          .then((mod) => instance.loadLanguage((mod as { default: Parameters<HighlighterCore["loadLanguage"]>[0] }).default))
          .then(() => true)
          .catch(() => {
            loaded.delete(lang);
            return false;
          })
      : Promise.resolve(false);
    loaded.set(lang, ready);
  }
  return ready;
}

/**
 * Tokenize consecutive lines of one side of a hunk. Returns one token array per
 * input line, or null when the language is unknown or loading failed (callers
 * fall back to plain text — highlighting is never required to read a diff).
 */
export async function tokenizeLines(lines: string[], lang: string | null): Promise<Token[][] | null> {
  if (!lang || !lines.length || lines.length > MAX_HIGHLIGHT_LINES) return null;
  try {
    const instance = await highlighter();
    if (!(await ensureLanguage(instance, lang))) return null;
    const result: ThemedToken[][] = instance.codeToTokensBase(lines.join("\n"), { lang, theme: "monokai" });
    if (result.length !== lines.length) return null;
    return result.map((line) => line.map((token) => ({ content: token.content, color: token.color, fontStyle: token.fontStyle })));
  } catch {
    return null;
  }
}
