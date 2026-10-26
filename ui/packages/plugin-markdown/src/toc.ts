/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import GithubSlugger from "github-slugger"

export interface TocItem {
  /** Heading level (1–6). */
  depth: number
  /** Visible heading text, inline markdown stripped. */
  text: string
  /** Slug id, identical to what `rehype-slug` puts on the rendered heading. */
  id: string
}

/**
 * A code span's slot while the other inline rules run: private-use sentinels
 * around its index in `codeSpans`.
 *
 * Inert to the emphasis and raw-HTML rules (it carries no `*`, `_` or angle
 * bracket), but still ORDINARY TEXT to the image and link rules — which is
 * what keeps ``[`getData`](/api)`` collapsing to its label, exactly as the
 * renderer does.
 */
const SLOT_OPEN = "\uE000"
const SLOT_CLOSE = "\uE001"
const SLOT_RE = /\uE000(\d+)\uE001/g
const SENTINEL_RE = /[\uE000\uE001]/g

/**
 * A matched pair of `_` delimiter runs, under CommonMark's FLANKING rule.
 *
 * `*` and `_` used to share one regex, and that is the bug: `*` opens emphasis
 * anywhere, including inside a word, but a `_` run INSIDE a word opens nothing.
 * It is both left- and right-flanking with no adjacent punctuation, and
 * CommonMark lets such a run neither open nor close. The renderer obeys that
 * and keeps the underscores, so `### NON_GRID_ROW_CEILING` is slugged
 * `non_grid_row_ceiling`; the shared rule paired the first two underscores and
 * ate `GRID`, then resumed and ate `ROW`, yielding `nongridrow_ceiling` — a
 * `#id` naming an anchor the page does not carry (`a472b0716`).
 *
 * Specialised to `_`, CommonMark's can-open / can-close conditions each reduce
 * to one boundary test on either side of the whole RUN:
 *
 *   open  ⟺ preceded by start-of-text, whitespace or punctuation
 *            AND followed by a non-whitespace character
 *   close ⟺ followed by end-of-text, whitespace or punctuation
 *            AND preceded by a non-whitespace character
 *
 * so `[^\s\p{P}\p{S}]` — neither Unicode whitespace nor CommonMark's Unicode
 * punctuation (categories P and S) — is the character class both lookarounds
 * negate. `(?<!_)` / `(?!_)` anchor each match to a WHOLE run, which is what
 * keeps `x__init__y` literal instead of pairing that run's inner underscores.
 * A run is consumed at whatever length it has, because a matched pair
 * contributes no characters to the rendered text however it nests
 * (`___x___` → `<em><strong>x</strong></em>` → `x`).
 *
 * Only the underscore form is flanking-aware: the asterisk rules above it are
 * unchanged, since giving `*` the same exemption would break `a*b*c`, which
 * the renderer really does emphasise.
 */
const UNDERSCORE_EMPHASIS_RE =
  /(?<![^\s\p{P}\p{S}])(?<!_)(_+)(?!\s)(.+?)(?<!\s)(_+)(?!_)(?![^\s\p{P}\p{S}])/gu

/**
 * Strip the inline-markdown wrappers so the text matches `rehype-slug`'s.
 *
 * Code spans are lifted out BEFORE any other rule and put back verbatim at the
 * end, because markdown inside a code span is not markdown: `rehype-slug` slugs
 * the rendered heading's flattened text, and a code span contributes its content
 * as a literal text value inside `<code>`. Rules run over already-unwrapped
 * code-span text therefore delete characters the anchor is built from — the
 * raw-HTML rule ate `<type>` out of `` `objectui generate <type> <name>` `` and
 * the emphasis rules ate the underscores out of `` `a_b_c` `` — so the TOC's
 * `#id` named a heading anchor that does not exist (`90c6d090d`).
 *
 * The raw-HTML rule itself stays: `remark-rehype` runs without
 * `allowDangerousHtml`, so it drops raw html nodes and keeps the text they
 * wrapped, which is what removing the tags reproduces. Sentinels present in the
 * source are dropped first, so no input can forge a slot.
 */
function stripInline(s: string): string {
  const codeSpans: string[] = []
  return s
    .replace(SENTINEL_RE, "") // no input can forge a slot
    .replace(/`([^`]+)`/g, (_match, content: string) => {
      codeSpans.push(content)
      return `${SLOT_OPEN}${codeSpans.length - 1}${SLOT_CLOSE}`
    }) // inline code → an opaque slot
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/\*\*(.*?)\*\*/g, "$1") // bold, asterisk form
    .replace(/\*(.*?)\*/g, "$1") // italic, asterisk form
    .replace(UNDERSCORE_EMPHASIS_RE, "$2") // emphasis, underscore form
    .replace(/<[^>]+>/g, "") // raw html
    .replace(SLOT_RE, (_match, index: string) => codeSpans[Number(index)]) // code spans, verbatim
    .trim()
}

/**
 * Build a table of contents from Markdown source.
 *
 * Slugs are generated with the SAME `github-slugger` that `rehype-slug` uses,
 * walking every heading in document order so duplicate-heading `-1/-2` suffixes
 * line up — that is what makes a `#id` TOC link resolve to the rendered
 * heading's anchor. Headings inside fenced code blocks are ignored. Only
 * `minDepth..maxDepth` (default h2–h3) are returned, but all headings still
 * advance the slugger so ids stay in sync.
 */
export function extractToc(
  markdown: string,
  opts?: { minDepth?: number; maxDepth?: number },
): TocItem[] {
  const minDepth = opts?.minDepth ?? 2
  const maxDepth = opts?.maxDepth ?? 3
  const slugger = new GithubSlugger()
  const items: TocItem[] = []
  let fence: string | null = null

  for (const line of (markdown ?? "").split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence === null) fence = marker
      else if (marker === fence) fence = null
      continue
    }
    if (fence !== null) continue

    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (!m) continue
    const depth = m[1].length
    const text = stripInline(m[2])
    if (!text) continue
    const id = slugger.slug(text) // advance the slugger for EVERY heading
    if (depth >= minDepth && depth <= maxDepth) items.push({ depth, text, id })
  }
  return items
}
