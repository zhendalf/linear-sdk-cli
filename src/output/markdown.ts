/**
 * A small, dependency-free Markdown renderer for terminal output.
 *
 * This intentionally implements the Markdown constructs that occur in Linear
 * bodies rather than pretending to be a CommonMark parser. The important
 * properties for the CLI are deterministic readable text, optional ANSI, and
 * sanitizing API-controlled bytes *before* adding any of our own escapes.
 */

import pc from "picocolors";
import { sanitizeForTerminal } from "./sanitize.js";

export interface MarkdownRenderOptions {
  color?: boolean;
  /** Used for horizontal rules. Wrapping itself is left to the terminal. */
  width?: number;
}

/** Render the useful subset of Markdown used by issue/document/project bodies. */
export function renderMarkdown(markdown: string, options: MarkdownRenderOptions = {}): string {
  const colors = pc.createColors(options.color === true);
  const width = Math.max(10, options.width ?? 80);
  // CR and terminal controls disappear here. JSON paths never call this and
  // therefore retain the exact API bytes (escaped by JSON.stringify).
  const source = sanitizeForTerminal(markdown);
  const lines = source.split("\n");
  const rendered: string[] = [];
  let fence: "```" | "~~~" | undefined;

  for (const original of lines) {
    const fenceMatch = original.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      const marker = fenceMatch[1] as "```" | "~~~";
      if (!fence) fence = marker;
      else if (fence === marker) fence = undefined;
      // Fence markers and their language labels are presentation syntax.
      continue;
    }

    if (fence) {
      rendered.push(`    ${colors.cyan(original)}`.trimEnd());
      continue;
    }

    const heading = original.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const text = inline(heading[2] ?? "", options.color === true);
      rendered.push(
        heading[1]?.length === 1 ? colors.underline(colors.bold(text)) : colors.bold(text),
      );
      continue;
    }

    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(original)) {
      rendered.push(colors.dim("─".repeat(Math.min(width, 72))));
      continue;
    }

    const quote = original.match(/^(\s*)>\s?(.*)$/);
    if (quote) {
      rendered.push(
        `${quote[1] ?? ""}${colors.dim("│")} ${colors.dim(inline(quote[2] ?? "", options.color === true))}`,
      );
      continue;
    }

    const task = original.match(/^(\s*)[-+*]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      rendered.push(
        `${task[1] ?? ""}${task[2]?.toLowerCase() === "x" ? "☑" : "☐"} ${inline(task[3] ?? "", options.color === true)}`,
      );
      continue;
    }

    const bullet = original.match(/^(\s*)[-+*]\s+(.*)$/);
    if (bullet) {
      rendered.push(`${bullet[1] ?? ""}• ${inline(bullet[2] ?? "", options.color === true)}`);
      continue;
    }

    const ordered = original.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (ordered) {
      rendered.push(
        `${ordered[1] ?? ""}${ordered[2]}. ${inline(ordered[3] ?? "", options.color === true)}`,
      );
      continue;
    }

    rendered.push(inline(original, options.color === true));
  }

  // Opening a malformed/unclosed fence must not make content disappear; its
  // body has already been emitted as code. Trim only trailing blank lines so
  // Output can own the single final newline consistently.
  while (rendered.at(-1) === "") rendered.pop();
  return rendered.join("\n");
}

/** Inline Markdown, with code spans shielded from emphasis/link processing. */
function inline(value: string, color: boolean): string {
  const colors = pc.createColors(color);
  const pieces = value.split(/(`+[^`]*`+)/g);
  return pieces
    .map((piece) => {
      if (/^`+[^`]*`+$/.test(piece)) {
        const ticks = piece.match(/^`+/)?.[0].length ?? 1;
        return colors.cyan(piece.slice(ticks, -ticks));
      }

      return piece
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_all, alt: string, url: string) => {
          const label = alt.trim() ? `image: ${alt.trim()}` : "image";
          return `${colors.dim(`[${label}]`)} (${url})`;
        })
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_all, label: string, url: string) => {
          return `${colors.underline(label)} (${url})`;
        })
        .replace(/<((?:https?|mailto):[^>]+)>/g, "$1")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/?[A-Za-z][^>]*>/g, "")
        .replace(/\*\*([^*]+)\*\*/g, (_all, text: string) => colors.bold(text))
        .replace(/__([^_]+)__/g, (_all, text: string) => colors.bold(text))
        .replace(/~~([^~]+)~~/g, (_all, text: string) => colors.strikethrough(text))
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_all, before: string, text: string) => {
          return `${before}${colors.italic(text)}`;
        })
        .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, (_all, before: string, text: string) => {
          return `${before}${colors.italic(text)}`;
        })
        .replace(/\\([\\`*_[\]{}()#+.!|>~-])/g, "$1");
    })
    .join("");
}
