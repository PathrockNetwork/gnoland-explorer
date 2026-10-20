/**
 * Read-only code viewer with line numbers and light Gno/Go highlighting.
 * Highlighting is a small tokenizer (comments, strings, numbers, keywords,
 * builtin types) — enough to scan a realm, not a full parser.
 */
import { useMemo, type ReactNode } from "react";

const KEYWORDS = new Set(
  "break case chan const continue crossing default defer else fallthrough for func go goto if import interface map package range return select struct switch type var".split(" "),
);
const BUILTINS = new Set(
  "bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr realm any nil true false iota append cap close copy delete len make new panic print println recover cross".split(" "),
);

type Tok = { cls: string | null; text: string };

const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\.)*"?|`[^`]*`?|'(?:[^'\\\n]|\\.)*'?|\b\d[\w.]*\b|\b[A-Za-z_]\w*\b)/g;

function tokenizeGo(src: string): Tok[] {
  const toks: Tok[] = [];
  let last = 0;
  for (let m = TOKEN_RE.exec(src); m; m = TOKEN_RE.exec(src)) {
    if (m.index > last) toks.push({ cls: null, text: src.slice(last, m.index) });
    const t = m[0];
    const c = t[0]!;
    let cls: string | null = null;
    if (t.startsWith("//") || t.startsWith("/*")) cls = "sv-com";
    else if (c === '"' || c === "`" || c === "'") cls = "sv-str";
    else if (/\d/.test(c)) cls = "sv-num";
    else if (KEYWORDS.has(t)) cls = "sv-kw";
    else if (BUILTINS.has(t)) cls = "sv-bi";
    else if (/^[A-Z]/.test(t)) cls = "sv-exp";
    toks.push({ cls, text: t });
    last = m.index + t.length;
    if (t.length === 0) TOKEN_RE.lastIndex++;
  }
  if (last < src.length) toks.push({ cls: null, text: src.slice(last) });
  return toks;
}

function tokenizeToml(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /(#[^\n]*|"(?:[^"\\\n]|\\.)*"|\[[^\]\n]*\]|^\s*[\w.-]+(?=\s*=))/gm;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) toks.push({ cls: null, text: src.slice(last, m.index) });
    const t = m[0];
    toks.push({ cls: t.startsWith("#") ? "sv-com" : t.startsWith('"') ? "sv-str" : t.trimStart().startsWith("[") ? "sv-kw" : "sv-exp", text: t });
    last = m.index + t.length;
  }
  if (last < src.length) toks.push({ cls: null, text: src.slice(last) });
  return toks;
}

/** Splits tokens into per-line React nodes. */
function toLines(toks: Tok[]): ReactNode[][] {
  const lines: ReactNode[][] = [[]];
  let k = 0;
  for (const tok of toks) {
    const parts = tok.text.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1]!.push(tok.cls ? <span key={k++} className={tok.cls}>{p}</span> : p);
    });
  }
  return lines;
}

export function SourceView({ text, name, maxHeight = 720 }: { text: string; name: string; maxHeight?: number | string }) {
  const lines = useMemo(() => {
    const src = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (src.length > 400_000) return src.split("\n").map((l) => [l] as ReactNode[]);
    if (/\.gno$|\.go$/.test(name)) return toLines(tokenizeGo(src));
    if (/\.toml$/.test(name)) return toLines(tokenizeToml(src));
    return src.split("\n").map((l) => [l] as ReactNode[]);
  }, [text, name]);
  const gutter = String(lines.length).length;
  return (
    <div className="sv-scroll" style={{ maxHeight }} tabIndex={0} role="region" aria-label={`Source of ${name}`}>
      <table className="sv-table" style={{ ["--sv-gutter" as string]: `${gutter + 1}ch` }}>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} id={`L${i + 1}`}>
              <td className="sv-ln" data-ln={i + 1} aria-hidden="true" />
              <td className="sv-code">{l.length ? l : "​"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
