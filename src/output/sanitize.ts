/**
 * Terminal hygiene for human output.
 *
 * Everything the CLI prints for a human is, at some point, text that came from
 * Linear — and anyone who can create an issue in a workspace can put terminal
 * escape sequences in a title. Written raw, those drive every teammate's
 * terminal: colour and cursor movement are the harmless end; an OSC-8 sequence
 * makes a fake hyperlink, an OSC-0 rewrites the window title, and a `\r` lets
 * later text overwrite what a reader thought they had already seen. Verified
 * live (TES-623): a title created as `\e[31mRED\e[0m \e]8;;https://evil…`
 * reached `issue list`, `issue view` and `issue title` byte-for-byte.
 *
 * `--json` output is untouched — JSON escapes control characters, and a script
 * is owed the exact bytes. This is for the table, the detail block, the bare
 * scalar lines, and the status/error lines: whatever a person reads.
 */

/**
 * Whole escape sequences first, so `\e[31m` disappears rather than leaving a
 * literal `[31m` behind:
 *
 *   - CSI  `ESC [` params intermediates final   (colour, cursor, erase)
 *   - OSC  `ESC ]` … BEL | ST                    (hyperlinks, window title)
 *   - DCS/SOS/PM/APC  `ESC P|X|^|_` … ST
 *   - any other two/three-byte `ESC` sequence
 *   - the 8-bit C1 spellings of CSI (0x9B) and OSC (0x9D)
 *
 * Spelled as `\uXXXX` escapes so no literal control byte lives in this source.
 */
const ESCAPE_SEQUENCES = new RegExp(
  [
    "\\u001B\\[[0-?]*[ -/]*[@-~]",
    "\\u009B[0-?]*[ -/]*[@-~]",
    "\\u001B\\][^\\u0007\\u001B\\u009C]*(?:\\u0007|\\u001B\\\\|\\u009C)?",
    "\\u009D[^\\u0007\\u001B\\u009C]*(?:\\u0007|\\u001B\\\\|\\u009C)?",
    "\\u001B[PX^_][^\\u001B\\u009C]*(?:\\u001B\\\\|\\u009C)?",
    "\\u001B[ -/]*[0-~]",
  ].join("|"),
  "g",
);

/**
 * Then whatever control characters remain: C0 except `\t` and `\n` (a
 * description is multi-line and that is the point of it), DEL, C1, and the
 * bidi embedding/override characters, which can make `a → b` read as `b → a`.
 * Same set as `config.ts` uses for TOML errors, minus the two whitespace
 * characters human output needs.
 */
const CONTROL_CHARS = new RegExp(
  // oxlint-disable-next-line no-control-regex
  "[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
  "g",
);

/** Strip anything in `text` that could drive a terminal rather than be read on it. */
export function sanitizeForTerminal(text: string): string {
  return text.replace(ESCAPE_SEQUENCES, "").replace(CONTROL_CHARS, "");
}

// Built via fromCharCode to avoid a control char in a regex literal (no-control-regex).
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

/**
 * The number of terminal columns `s` occupies. Our own SGR colour is
 * zero-width; a CJK character or an emoji is two. `s.length` counted UTF-16
 * code units, so a table with a Japanese title, or one emoji, mis-aligned every
 * column after it. Bun's `stringWidth` knows East Asian width and grapheme
 * clusters; the fallback (a non-Bun runtime, which the package does not
 * support) is the old count.
 */
export function displayWidth(s: string): number {
  const bun = (globalThis as { Bun?: { stringWidth?: (s: string) => number } }).Bun;
  if (bun?.stringWidth) return bun.stringWidth(s);
  return stripAnsi(s).length;
}
