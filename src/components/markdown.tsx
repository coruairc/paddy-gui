import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function inline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-elevated px-1 py-px font-mono text-[0.85em] text-fg">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-medium text-fg">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function highlight(code: string): ReactNode[] {
  const token = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/.*$|#.*$)|(\b(?:const|let|var|function|return|if|else|for|while|import|from|export|class|async|await|def|fn|true|false|null|undefined)\b)|(\b\d+(?:\.\d+)?\b)/gm;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = token.exec(code))) {
    if (match.index > last) nodes.push(code.slice(last, match.index));
    const [full, str, comment, keyword, num] = match;
    const className = str
      ? "text-ok"
      : comment
        ? "text-subtle"
        : keyword
          ? "text-accent"
          : num
            ? "text-warn"
            : "";
    nodes.push(
      <span key={key++} className={className}>
        {full}
      </span>,
    );
    last = match.index + full.length;
  }
  if (last < code.length) nodes.push(code.slice(last));
  return nodes;
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-subtle">
        <span className="font-mono">{lang || "code"}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted hover:bg-elevated hover:text-fg"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-fg">
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const pattern = /```([\w-]*)\n?([\s\S]*?)```/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(...renderProse(text.slice(last, match.index), `p${index}`));
    nodes.push(<CodeBlock key={`c${index}`} lang={match[1]} code={match[2].replace(/\n$/, "")} />);
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(...renderProse(text.slice(last), `p${index}`));
  return <div className={cn("text-sm", className)}>{nodes}</div>;
}

function renderProse(chunk: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = chunk.split("\n");
  let list: string[] = [];
  const flush = (key: string) => {
    if (!list.length) return;
    nodes.push(
      <ul key={key} className="my-2 space-y-1 pl-4 text-sm text-fg/90">
        {list.map((item, idx) => (
          <li key={idx} className="list-disc leading-relaxed">
            {inline(item)}
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((line, idx) => {
    const key = `${prefix}-${idx}`;
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      return;
    }
    flush(key);
    if (!line.trim()) return;
    if (/^#{1,3}\s/.test(line)) {
      nodes.push(
        <p key={key} className="mt-3 mb-1 font-medium text-fg">
          {inline(line.replace(/^#{1,3}\s/, ""))}
        </p>,
      );
      return;
    }
    nodes.push(
      <p key={key} className="my-1.5 leading-relaxed text-fg/90">
        {inline(line)}
      </p>,
    );
  });
  flush(`${prefix}-end`);
  return nodes;
}
