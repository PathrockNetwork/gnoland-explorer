/**
 * Safe renderer for realm `Render()` markdown, as gnoweb would show it.
 *
 * Markdown → HTML with `marked`, then DOMPurify. Links are rewritten so a realm
 * render link (`/r/foo:bar`, `:bar`, `?page=2`) stays inside this explorer, while
 * gnoweb-only pages (`$help`, `$source`, `/u/name`, …) open on gno.land.
 * The page CSP blocks external images, so they become links (data: images stay).
 */
import { useMemo } from "react";
import { Marked, type Tokens } from "marked";
import DOMPurify from "dompurify";

const GNOWEB = "https://gno.land";

/** Render path → hash fragment safe for `#/realms/<pkg>:<args>`. */
export const encodeArgs = (args: string) => encodeURI(args).replace(/#/g, "%23");

/** Explorer link to a package's render (or the package page when args is empty). */
export const renderRoute = (pkg: string, args = "") => `#/realms/${pkg}${args ? `:${encodeArgs(args)}` : ""}`;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Where a link in a render of `pkg` (at render path `args`) should go.
 * Returns null for links that cannot work here (in-page anchors).
 */
export function rewriteHref(href: string, pkg: string, args: string): { href: string; external: boolean } | null {
  const h = href.trim();
  if (!h || h.startsWith("#")) return null;
  const gnoweb = h.match(/^https?:\/\/(?:www\.)?gno\.land(\/.*)?$/i);
  if (gnoweb) {
    const inner = rewriteHref(gnoweb[1] ?? "/", pkg, args);
    return inner ?? { href: h, external: true };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return { href: h, external: true };
  if (h.startsWith("//")) return { href: `https:${h}`, external: true };
  if (h.startsWith("/")) {
    if (h.includes("$")) return { href: GNOWEB + h, external: true };
    const m = h.match(/^\/([rp])\/([^:?#]+?)\/?((?:[:?#]).*)?$/);
    if (m) {
      const path = `gno.land/${m[1]}/${m[2]}`;
      let rest = m[3] ?? "";
      if (rest.startsWith("#")) rest = "";
      const a = rest.startsWith(":") ? rest.slice(1) : rest;
      return { href: renderRoute(path, a.replace(/#.*$/, "")), external: false };
    }
    return { href: GNOWEB + h, external: true };
  }
  if (h.startsWith(":")) return { href: renderRoute(pkg, h.slice(1)), external: false };
  if (h.startsWith("?")) return { href: renderRoute(pkg, args.replace(/\?.*$/, "") + h), external: false };
  if (h.startsWith("$")) return { href: `${GNOWEB}/${pkg.replace(/^gno\.land\//, "")}${h}`, external: true };
  try {
    return { href: new URL(h, `${GNOWEB}/${pkg.replace(/^gno\.land\//, "")}/`).toString(), external: true };
  } catch {
    return null;
  }
}

const md = new Marked({ gfm: true, breaks: false, async: false });
md.use({
  renderer: {
    image({ href, title, text }: Tokens.Image) {
      if (/^data:image\/(png|gif|jpe?g|webp);/i.test(href)) {
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
      }
      const label = text ? `Image: ${text}` : "Image";
      return `<a class="md-image-link" href="${escapeHtml(href)}" title="External image (not loaded)">${escapeHtml(label)}</a>`;
    },
  },
});

/** gnoweb's `<gno-columns>` extension: markdown columns separated by `<gno-columns-sep>`. */
function toHtml(src: string): string {
  const out: string[] = [];
  const re = /<gno-columns>([\s\S]*?)<\/gno-columns>/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    out.push(md.parse(src.slice(last, m.index)) as string);
    const cols = m[1]!.split(/<gno-columns-sep\s*\/?>/).map((c) => `<div class="md-col">${md.parse(c) as string}</div>`);
    out.push(`<div class="md-cols">${cols.join("")}</div>`);
    last = m.index + m[0].length;
  }
  out.push(md.parse(src.slice(last)) as string);
  return out.join("");
}

let ctx = { pkg: "", args: "" };
let hooked = false;
function ensureHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const raw = node.getAttribute("href");
      if (raw === null) return;
      const r = rewriteHref(raw, ctx.pkg, ctx.args);
      if (!r) {
        node.removeAttribute("href");
        return;
      }
      node.setAttribute("href", r.href);
      if (r.external) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      } else {
        node.removeAttribute("target");
      }
    } else if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (!/^data:image\//i.test(src)) node.removeAttribute("src");
    }
  });
}

export function renderMarkdown(src: string, pkg: string, args = ""): string {
  ensureHooks();
  ctx = { pkg, args };
  const html = toHtml(src);
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "iframe"],
    FORBID_ATTR: ["style"],
  });
}

export function Markdown({ source, pkg, args = "", className }: { source: string; pkg: string; args?: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source, pkg, args), [source, pkg, args]);
  return <div className={`md-body${className ? ` ${className}` : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
