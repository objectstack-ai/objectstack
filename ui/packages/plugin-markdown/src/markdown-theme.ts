/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Theme for the markdown enrichments (ADR-0046): highlight.js token colors,
 * GitHub-style alert callouts, and heading anchor affordance.
 *
 * Injected once as a trusted `<style>` from our own code — this is NOT
 * publisher content, so the "no style elements in markdown" rule (which
 * targets author-supplied HTML) does not apply. Colors derive from the
 * shadcn CSS variables already present in the console, with a `.dark`
 * override block so the syntax palette adapts to dark mode.
 *
 * No SVG: the alert plugin's icon is stripped by rehype-sanitize (svg is
 * not whitelisted); callout icons here are pure CSS pseudo-elements, so
 * there is zero SVG surface in the sanitize schema.
 */
const STYLE_ID = "os-markdown-styles"

const CSS = `
.os-markdown .md-anchor {
  margin-left: 0.4ch;
  color: var(--muted-foreground);
  text-decoration: none;
  opacity: 0;
  transition: opacity 0.12s ease-in-out;
}
.os-markdown :is(h1,h2,h3,h4,h5,h6):hover .md-anchor { opacity: 0.6; }
.os-markdown .md-anchor:hover { opacity: 1; }

/* highlight.js tokens — light */
.os-markdown .hljs-comment,
.os-markdown .hljs-quote { color: var(--muted-foreground); font-style: italic; }
.os-markdown .hljs-keyword,
.os-markdown .hljs-selector-tag,
.os-markdown .hljs-literal,
.os-markdown .hljs-doctag { color: #8250df; }
.os-markdown .hljs-string,
.os-markdown .hljs-regexp,
.os-markdown .hljs-addition { color: #0a7d33; }
.os-markdown .hljs-number,
.os-markdown .hljs-symbol,
.os-markdown .hljs-bullet { color: #0550ae; }
.os-markdown .hljs-title,
.os-markdown .hljs-section,
.os-markdown .hljs-name,
.os-markdown .hljs-built_in { color: #6639ba; }
.os-markdown .hljs-attr,
.os-markdown .hljs-attribute,
.os-markdown .hljs-variable,
.os-markdown .hljs-template-variable { color: #953800; }
.os-markdown .hljs-type,
.os-markdown .hljs-class .hljs-title { color: #0550ae; }
.os-markdown .hljs-meta { color: var(--muted-foreground); }
.os-markdown .hljs-deletion { color: #b35900; }
.os-markdown .hljs-emphasis { font-style: italic; }
.os-markdown .hljs-strong { font-weight: 600; }

/* highlight.js tokens — dark */
.dark .os-markdown .hljs-keyword,
.dark .os-markdown .hljs-selector-tag,
.dark .os-markdown .hljs-literal,
.dark .os-markdown .hljs-doctag { color: #d2a8ff; }
.dark .os-markdown .hljs-string,
.dark .os-markdown .hljs-regexp,
.dark .os-markdown .hljs-addition { color: #7ee787; }
.dark .os-markdown .hljs-number,
.dark .os-markdown .hljs-symbol,
.dark .os-markdown .hljs-bullet { color: #79c0ff; }
.dark .os-markdown .hljs-title,
.dark .os-markdown .hljs-section,
.dark .os-markdown .hljs-name,
.dark .os-markdown .hljs-built_in { color: #d2a8ff; }
.dark .os-markdown .hljs-attr,
.dark .os-markdown .hljs-attribute,
.dark .os-markdown .hljs-variable,
.dark .os-markdown .hljs-template-variable { color: #ffa657; }
.dark .os-markdown .hljs-type,
.dark .os-markdown .hljs-class .hljs-title { color: #79c0ff; }
.dark .os-markdown .hljs-deletion { color: #ffa198; }

/* GitHub-style alert callouts (icon = CSS pseudo-element, no SVG) */
.os-markdown .markdown-alert {
  margin: 1em 0;
  padding: 0.6em 1em;
  border-left: 0.25em solid var(--border);
  border-radius: 0.375rem;
  background: color-mix(in srgb, var(--muted) 40%, transparent);
}
.os-markdown .markdown-alert > :first-child { margin-top: 0; }
.os-markdown .markdown-alert > :last-child { margin-bottom: 0; }
.os-markdown .markdown-alert-title {
  display: flex;
  align-items: center;
  font-weight: 600;
  line-height: 1;
  text-transform: capitalize;
}
.os-markdown .markdown-alert-title::before {
  margin-right: 0.5ch;
  font-weight: 700;
}
.os-markdown .markdown-alert-note { border-left-color: #0969da; }
.os-markdown .markdown-alert-note .markdown-alert-title { color: #0969da; }
.os-markdown .markdown-alert-note .markdown-alert-title::before { content: "ⓘ"; }
.os-markdown .markdown-alert-tip { border-left-color: #1a7f37; }
.os-markdown .markdown-alert-tip .markdown-alert-title { color: #1a7f37; }
.os-markdown .markdown-alert-tip .markdown-alert-title::before { content: "💡"; }
.os-markdown .markdown-alert-important { border-left-color: #8250df; }
.os-markdown .markdown-alert-important .markdown-alert-title { color: #8250df; }
.os-markdown .markdown-alert-important .markdown-alert-title::before { content: "❖"; }
.os-markdown .markdown-alert-warning { border-left-color: #9a6700; }
.os-markdown .markdown-alert-warning .markdown-alert-title { color: #9a6700; }
.os-markdown .markdown-alert-warning .markdown-alert-title::before { content: "⚠"; }
.os-markdown .markdown-alert-caution { border-left-color: var(--destructive); }
.os-markdown .markdown-alert-caution .markdown-alert-title { color: var(--destructive); }
.os-markdown .markdown-alert-caution .markdown-alert-title::before { content: "⛔"; }
.dark .os-markdown .markdown-alert-note { border-left-color: #4493f8; }
.dark .os-markdown .markdown-alert-note .markdown-alert-title { color: #4493f8; }
.dark .os-markdown .markdown-alert-tip { border-left-color: #3fb950; }
.dark .os-markdown .markdown-alert-tip .markdown-alert-title { color: #3fb950; }
.dark .os-markdown .markdown-alert-important { border-left-color: #ab7df8; }
.dark .os-markdown .markdown-alert-important .markdown-alert-title { color: #ab7df8; }
.dark .os-markdown .markdown-alert-warning { border-left-color: #d29922; }
.dark .os-markdown .markdown-alert-warning .markdown-alert-title { color: #d29922; }

/* Bordered tables: @tailwindcss/typography zeroes padding on each row's
   first (inline-start) and last (inline-end) cell because it assumes
   borderless tables. We add cell borders (prose-th/td:border), so restore
   symmetric horizontal padding — otherwise the first column's text sits
   flush against the left border, misaligned with every other column. The
   0.6666667em matches prose-sm's inner-cell padding. The .os-markdown
   class selector outranks typography's zero-specificity :where() rules. */
.os-markdown table th:first-child,
.os-markdown table td:first-child { padding-inline-start: 0.6666667em; }
.os-markdown table th:last-child,
.os-markdown table td:last-child { padding-inline-end: 0.6666667em; }
`

/**
 * Inject the markdown enrichment styles once. No-op on the server (no
 * `document`) and idempotent across many rendered markdown instances.
 */
export function ensureMarkdownStyles(): void {
  if (typeof document === "undefined") return
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
