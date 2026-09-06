// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time diagnostics for AI-authored HTML-source pages (ADR-0080).
//
// Applies to `kind:'html'` (and its deprecated alias `kind:'jsx'`) — the tier
// whose `source` is constrained JSX/HTML parsed (never executed) to the tree.
// `kind:'react'` (ADR-0081) is intentionally NOT linted here: its source is
// real JavaScript, not constrained JSX, so the constrained parser would
// false-error on hooks / expressions.
//
// A pure `(stack) => Finding[]` rule (ADR-0019), run from `os validate` / `os
// build`. An html page's `source` is a constrained JSX/Tailwind string
// compiled (parsed, never executed) to the SDUI tree at save time. This gate
// parses it at author time so malformed source fails loudly (ADR-0078) instead
// of being stored and breaking only at render.
//
// Scope: parse-level — syntax, tag matching, and forbidden constructs (event
// handlers, dangerouslySetInnerHTML). Full component/prop whitelist validation
// needs the registry manifest (a cross-repo artifact); when that is wired,
// thread it through `compile()` here. Until then this catches the structural
// class of error an AI author is most likely to emit.

import { parseJsx, compile, type Manifest } from '@objectstack/sdui-parser';
import { collectionEntries } from './collection-entries.js';

export type JsxPageSeverity = 'error' | 'warning';

export interface JsxPageFinding {
  severity: JsxPageSeverity;
  rule: string;
  /** Human-readable location, e.g. `page "command_center" › <flex>`. */
  where: string;
  /** Config path, e.g. `pages[3].source`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

export function validateJsxPages(stack: AnyRec, opts: { manifest?: Manifest } = {}): JsxPageFinding[] {
  const findings: JsxPageFinding[] = [];
  for (const { rec: page, path: pagePath } of collectionEntries(stack.pages, 'pages')) {
    // html tier (+ deprecated 'jsx' alias). react pages are not constrained JSX.
    if (!page || (page.kind !== 'html' && page.kind !== 'jsx')) continue;
    const name = String(page.name ?? pagePath);
    const source = page.source;
    if (typeof source !== 'string' || source.trim() === '') {
      // (PageSchema's superRefine also covers this; keep it for the build path.)
      findings.push({
        severity: 'error',
        rule: 'jsx-page-empty-source',
        where: `page "${name}"`,
        path: `${pagePath}.source`,
        message: `kind:'${page.kind}' page has no \`source\`.`,
        hint: 'Author the page as a constrained JSX/Tailwind string in `source`.',
      });
      continue;
    }
    // With a component manifest, do full validation (unknown component, missing/
    // wrong prop, bad enum, bindings); without it, parse-level (syntax/structure).
    const { diagnostics } = opts.manifest ? compile(source, opts.manifest) : parseJsx(source);
    for (const d of diagnostics) {
      findings.push({
        severity: d.severity,
        rule: `jsx-${d.code}`,
        where: d.tag ? `page "${name}" › <${d.tag}>` : `page "${name}"`,
        path: `${pagePath}.source`,
        message: d.message,
        hint: 'The source is parsed (never executed) and compiled to the SDUI tree at save time — fix the JSX.',
      });
    }
  }
  return findings;
}
