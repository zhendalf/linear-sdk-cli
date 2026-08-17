import { describe, it, expect } from "bun:test";
import { renderTable, renderDetail, type Column } from "../../src/output/table.js";
import { sanitizeForTerminal, displayWidth } from "../../src/output/sanitize.js";

interface Row {
  id: string;
  title: string;
}

const ESC = "\u001b";
const BEL = "\u0007";
/** The live repro (TES-616 / TES-646): colour, an OSC-8 fake hyperlink, back to normal. */
const evil = `clitest-esc ${ESC}[31mRED${ESC}[0m ${ESC}]8;;https://evil.example${ESC}\\link${ESC}]8;;${ESC}\\ end`;

/**
 * TES-623: API data reached the terminal byte-for-byte. Anyone who can create
 * an issue can put `\e[31m`, an OSC-8 fake hyperlink, a window-title rewrite
 * or a `\r` overwrite into a title, and every teammate's `issue list` ran it.
 * Verified live on a `clitest-esc` issue. Every string that reaches a human
 * table or detail passes through `cell()`, which is where they die.
 */
describe("sanitizeForTerminal", () => {
  it("strips whole escape sequences — no `[31m` residue", () => {
    expect(sanitizeForTerminal(evil)).toBe("clitest-esc RED link end");
  });

  it("strips CSI cursor/erase, OSC title (BEL- or ST-terminated), DCS, and lone ESC sequences", () => {
    expect(sanitizeForTerminal(`a${ESC}[2J${ESC}[Hb`)).toBe("ab");
    expect(sanitizeForTerminal(`x${ESC}]0;pwned${BEL}y`)).toBe("xy");
    expect(sanitizeForTerminal(`x${ESC}]0;pwned${ESC}\\y`)).toBe("xy");
    expect(sanitizeForTerminal(`x${ESC}Pq…${ESC}\\y`)).toBe("xy");
    expect(sanitizeForTerminal(`x${ESC}(By${ESC}7z`)).toBe("xyz");
  });

  it("strips the 8-bit C1 spellings of CSI and OSC as sequences too", () => {
    expect(sanitizeForTerminal("x\u009b31my\u009d0;t\u009cz")).toBe("xyz");
  });

  it("strips \\r, BEL, DEL, stray C1 and bidi overrides, but keeps \\n and \\t", () => {
    expect(sanitizeForTerminal("over\rwrite")).toBe("overwrite");
    expect(sanitizeForTerminal(`a${BEL}b\u007fc\u0085d`)).toBe("abcd");
    expect(sanitizeForTerminal("a \u202eb\u202c c\u200f")).toBe("a b c");
    expect(sanitizeForTerminal("line1\nline2\tcol")).toBe("line1\nline2\tcol");
  });

  it("leaves ordinary text, accents, CJK and emoji alone", () => {
    for (const s of ["plain", "café", "日本語のタイトル", "ship it 🚀", "a → b", ""]) {
      expect(sanitizeForTerminal(s)).toBe(s);
    }
  });

  it("the table strips escapes from every cell", () => {
    const cols: Column<Row>[] = [{ key: "title", value: (r) => r.title }];
    const out = renderTable([{ id: "X", title: evil }], cols);
    expect(out).not.toContain(ESC);
    expect(out).toContain("clitest-esc RED link end");
  });

  it("the detail block strips escapes from every value, arrays included", () => {
    const out = renderDetail([
      ["Title", evil],
      ["Labels", [`a${ESC}[1m`, "b"]],
    ]);
    expect(out).not.toContain(ESC);
    expect(out).toContain("Title:  clitest-esc RED link end");
    expect(out).toContain("Labels: a, b");
  });
});

/**
 * Column widths were `s.length`: a CJK title or one emoji pushed every column
 * after it out of line, and truncation could cut an emoji in half.
 */
describe("Unicode-aware widths", () => {
  it("measures CJK and emoji as two columns, a combining accent as none, our own SGR as none", () => {
    expect(displayWidth("日本語")).toBe(6);
    expect(displayWidth("🚀")).toBe(2);
    expect(displayWidth("é")).toBe(1);
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth(`${ESC}[1mabc${ESC}[0m`)).toBe(3);
  });

  it("aligns a column after a wide cell", () => {
    const cols: Column<Row>[] = [
      { key: "title", value: (r) => r.title },
      { key: "id", value: (r) => r.id },
    ];
    const out = renderTable(
      [
        { id: "A", title: "日本語" },
        { id: "B", title: "abcdef" },
      ],
      cols,
    );
    const [, l1, l2] = out.split("\n");
    // Both ids start in the same terminal column: 6 wide + 2 gap.
    expect(l1).toBe("日本語  A");
    expect(l2).toBe("abcdef  B");
  });

  it("truncates by terminal width and never splits a grapheme", () => {
    const cols: Column<Row>[] = [{ key: "title", value: (r) => r.title, max: 5 }];
    expect(renderTable([{ id: "X", title: "日本語です" }], cols).split("\n")[1]).toBe("日本…");
    expect(renderTable([{ id: "X", title: "🚀🚀🚀🚀" }], cols).split("\n")[1]).toBe("🚀🚀…");
    // The ASCII case is unchanged.
    expect(renderTable([{ id: "X", title: "abcdefgh" }], cols).split("\n")[1]).toBe("abcd…");
  });
});
