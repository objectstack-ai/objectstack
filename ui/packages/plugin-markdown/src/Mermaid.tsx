/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"

/**
 * Mermaid diagram renderer for ```mermaid fenced code blocks (ADR-0046).
 *
 * Mermaid is text → SVG, so it sidesteps the v1 image/binary ban while still
 * giving docs flow / state-machine / sequence diagrams. The library is heavy,
 * so it is dynamically imported the first time a diagram actually mounts —
 * docs with no diagrams pay nothing.
 *
 * Security: rendered with `securityLevel: 'strict'` (labels sanitized, no raw
 * HTML, no click handlers). The SVG is injected by this trusted component
 * AFTER react-markdown's `rehype-sanitize` gate (which only sees the source
 * text, never this output), so the two sanitizers do not fight. A render
 * failure degrades to the raw source in a <pre>, never a thrown error.
 */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import("mermaid").then((m) => m.default)
  return mermaidPromise
}

// Module-scoped monotonic id — mermaid.render needs a unique DOM id per call.
let renderSeq = 0

function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark")
}

export function Mermaid({ chart }: { chart: string }) {
  const [svg, setSvg] = React.useState<string>("")
  const [error, setError] = React.useState<string | null>(null)
  // Re-render when the app theme toggles so the diagram matches light/dark.
  const [dark, setDark] = React.useState<boolean>(isDark)

  React.useEffect(() => {
    if (typeof document === "undefined") return
    const target = document.documentElement
    const obs = new MutationObserver(() => setDark(isDark()))
    obs.observe(target, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])

  React.useEffect(() => {
    let cancelled = false
    const source = chart.trim()
    if (!source) {
      setSvg("")
      setError(null)
      return
    }
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
        })
        const id = `os-mermaid-${(renderSeq += 1)}`
        const { svg } = await mermaid.render(id, source)
        if (!cancelled) {
          setSvg(svg)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [chart, dark])

  if (error) {
    return (
      <pre data-mermaid data-mermaid-error className="my-4 overflow-auto rounded border border-destructive/40 bg-muted p-3 text-xs">
        <code>{chart}</code>
      </pre>
    )
  }

  if (!svg) {
    // Pre-render placeholder: keep the source reachable to assistive tech
    // and to tests while the (async) diagram is still being drawn.
    return (
      <div data-mermaid data-mermaid-pending className="my-4 text-sm text-muted-foreground">
        <pre className="sr-only">{chart}</pre>
      </div>
    )
  }

  return (
    <div
      data-mermaid
      role="img"
      className="my-4 flex justify-center overflow-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // mermaid strict-mode SVG, rendered post-sanitize by our own trusted component
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
