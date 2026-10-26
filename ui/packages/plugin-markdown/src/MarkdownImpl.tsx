/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { remarkAlert } from "remark-github-blockquote-alert"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import rehypeSlug from "rehype-slug"
import rehypeHighlight from "rehype-highlight"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import { ComponentRegistry } from "@object-ui/core"
import { ensureMarkdownStyles } from "./markdown-theme"
import { Mermaid } from "./Mermaid"

/**
 * Props for the Markdown component implementation.
 *
 * This component renders markdown content using react-markdown with GitHub
 * Flavored Markdown support. All content is sanitized to prevent XSS attacks.
 */
export interface MarkdownImplProps {
  /**
   * The markdown content to render.
   */
  content: string

  /**
   * Optional CSS class name to apply custom styling to the markdown container.
   */
  className?: string
}

// ─── Sanitize schema (ADR-0046 §3.3) ────────────────────────────────────
//
// rehype-sanitize runs LAST in the rehype chain, so it is the final gate:
// anything the enrichment plugins (slug / highlight / autolink / alert)
// emit that is not whitelisted here is stripped. We widen the default
// schema by exactly the code-free surfaces those plugins need:
//
//   • `id` on `*`               — already global; rehype-slug uses it so
//                                 intra-doc `#anchor` links resolve.
//   • `className` on `*`        — highlight token spans + alert callouts.
//   • `span`/`div` tags         — highlight wraps tokens in <span>; alerts
//                                 are a <div> callout.
//   • the autolink `<a>`        — heading anchor click target.
//
// Class names and ids cannot execute code; the dangerous vectors (script,
// style, event handlers, `javascript:` href, iframe/object/embed) stay
// blocked by the default schema and the `disallowedElements` belt below.
// `clobberPrefix: ''` keeps slug ids verbatim so author `#section` links
// match (a low DOM-clobbering risk on semi-trusted publisher content,
// accepted so anchors work). The default schema value-restricts className
// on a few tags (`a → data-footnote-backref`), and a per-tag restriction
// overrides the global allow — so we drop the restriction from `a`.
const dropClassNameRestriction = (entries: unknown[] | undefined): unknown[] =>
  (entries ?? []).filter((e) => !(Array.isArray(e) && e[0] === "className"))

const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), "span", "div"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    a: [...dropClassNameRestriction(defaultSchema.attributes?.a), "ariaHidden", "tabIndex"],
  },
} as typeof defaultSchema

// remark-github-blockquote-alert emits the callout class under the raw
// HTML property name `class` (a space-joined string), not hast's canonical
// `className`. rehype-sanitize whitelists `className`, so a raw `class`
// property is dropped wholesale. Canonicalize `class` → `className` (and
// any string `className`) into a token array before sanitize runs, so the
// alert classes survive the `*` allow. hast element nodes only.
function rehypeNormalizeClassName() {
  const toTokens = (v: unknown): string[] =>
    typeof v === "string" ? v.split(/\s+/).filter(Boolean) : Array.isArray(v) ? (v as string[]) : []
  const visit = (node: { type?: string; properties?: Record<string, unknown>; children?: unknown[] }) => {
    if (!node || typeof node !== "object") return
    const props = node.properties
    if (props && (typeof props.class === "string" || typeof props.className === "string")) {
      props.className = [...toTokens(props.className), ...toTokens(props.class)]
      delete props.class
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child as typeof node)
    }
  }
  return (tree: unknown) => visit(tree as { children?: unknown[] })
}

const remarkPlugins = [remarkGfm, remarkAlert]
const rehypePlugins = [
  rehypeSlug,
  rehypeNormalizeClassName,
  // Skip code blocks tagged with an unknown language instead of throwing;
  // highlight only what it recognises.
  [rehypeHighlight, { detect: true, ignoreMissing: true, plainText: ["mermaid", "metadata"] }],
  [rehypeAutolinkHeadings, { behavior: "append", properties: { className: ["md-anchor"], ariaHidden: true, tabIndex: -1 }, content: { type: "text", value: "#" } }],
  [rehypeSanitize, sanitizeSchema],
] as React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]

// Flatten a react-markdown code child down to its raw text. mermaid blocks are
// emitted as a plain text node (rehype-highlight is told to skip "mermaid"), so
// this yields the diagram source verbatim.
function nodeText(node: React.ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join("")
  if (React.isValidElement(node)) return nodeText((node.props as { children?: React.ReactNode }).children)
  return ""
}

// ── ```metadata fence (ADR-0051) ─────────────────────────────────────────
// A ```metadata block is a declarative reference to a metadata item that is
// lifted into the live, read-only `element:metadata_viewer` SDUI component —
// the same component an `element:metadata_viewer` node renders on a page, so
// docs and pages share one runtime. The body is a flat `key: value` block
// (data, not code: type / name / object / mode / detail), parsed here. Like
// mermaid, the language is excluded from rehype-highlight (plainText above) so
// nodeText yields the body verbatim.
export function parseMetadataFence(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of src.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const i = line.indexOf(":")
    if (i < 1) continue
    const key = line.slice(0, i).trim()
    let value = line.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

function MetadataFence({ source }: { source: string }) {
  const properties = React.useMemo(() => parseMetadataFence(source), [source])
  const Comp = ComponentRegistry.get("element:metadata_viewer") as
    | React.ComponentType<{ schema: unknown }>
    | undefined
  // Degrade gracefully when the SDUI component isn't registered (e.g. a
  // consumer that renders Markdown without @object-ui/components loaded):
  // show the raw reference rather than throwing.
  if (!Comp) {
    return (
      <pre>
        <code>{source}</code>
      </pre>
    )
  }
  return (
    <div className="not-prose my-4">
      <Comp schema={{ type: "element:metadata_viewer", properties }} />
    </div>
  )
}

// Intercept fenced ```mermaid / ```metadata blocks at the <pre> level (so no
// <pre> wrapper is emitted) and render them as live views; every other block
// renders normally.
const mdComponents: Components = {
  pre({ node: _node, children, ...rest }) {
    const child = React.Children.toArray(children)[0]
    const className =
      React.isValidElement(child) && typeof (child.props as { className?: unknown }).className === "string"
        ? ((child.props as { className?: string }).className as string)
        : ""
    if (/\blanguage-mermaid\b/.test(className)) {
      const source = nodeText((child as React.ReactElement<{ children?: React.ReactNode }>).props.children)
      return <Mermaid chart={source} />
    }
    if (/\blanguage-metadata\b/.test(className)) {
      const source = nodeText((child as React.ReactElement<{ children?: React.ReactNode }>).props.children)
      return <MetadataFence source={source} />
    }
    return <pre {...rest}>{children}</pre>
  },
}

/**
 * Internal Markdown implementation component.
 * This contains the actual react-markdown import (heavy ~100-200 KB).
 */
export default function MarkdownImpl({ content, className }: MarkdownImplProps) {
  // Inject the highlight/alert/anchor stylesheet once (trusted, our own CSS).
  ensureMarkdownStyles()

  // Utility function to merge class names (inline to avoid external dependency)
  const cn = (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' ')

  return (
    <div
      data-slot="markdown"
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl",
        "prose-p:leading-relaxed prose-p:text-foreground",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-code:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-muted prose-pre:text-foreground prose-pre:border",
        "prose-blockquote:border-l-primary prose-blockquote:text-muted-foreground",
        "prose-strong:text-foreground prose-strong:font-semibold",
        "prose-ul:list-disc prose-ol:list-decimal",
        "prose-li:text-foreground prose-li:marker:text-muted-foreground",
        "prose-table:border prose-th:border prose-th:bg-muted prose-td:border",
        "prose-img:rounded-md prose-img:border",
        "os-markdown",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={mdComponents}
        // Defense-in-depth beyond rehype-sanitize: these never reach the DOM.
        disallowedElements={['script', 'style', 'iframe', 'object', 'embed']}
        unwrapDisallowed={true}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
