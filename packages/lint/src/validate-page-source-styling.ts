// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time guardrail for SDUI source-tier page styling (ADR-0065 / ADR-0080 /
// ADR-0081). A `kind:'html'` or `kind:'react'` page's `source` is RUNTIME
// metadata — the console's build-time Tailwind only scans the renderer's own
// source, never an authored page string. So a Tailwind `className` in page
// source silently produces NO CSS (the exact ADR-0065 failure: styling that
// "works only by coincidence" when the class happens to be one objectui already
// ships). This rule flags authored `className` attributes in source-tier pages
// before render, with the actionable fix.
//
// It is the styling counterpart to the react-prop gate: a pure
// `(stack) => Finding[]` rule (ADR-0019), run from `os validate`/`compile` and
// reusable by AI authoring so the agent self-corrects.

export type SourceStyleSeverity = 'error' | 'warning';

export interface SourceStyleFinding {
  severity: SourceStyleSeverity;
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

export const PAGE_SOURCE_CLASSNAME = 'page-source-className-tailwind';

type AnyRec = Record<string, unknown>;
const asArray = (v: unknown): AnyRec[] => (Array.isArray(v) ? (v as AnyRec[]) : []);

// `className=` as a JSX attribute: name, optional ws, `=`, then `"`/`'`/`{`.
const CLASSNAME_ATTR = /\bclassName\s*=\s*["'{]/g;

export function validatePageSourceStyling(stack: AnyRec): SourceStyleFinding[] {
  const findings: SourceStyleFinding[] = [];
  const pages = asArray(stack.pages);
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    if (!page) continue;
    const kind = page.kind;
    if (kind !== 'html' && kind !== 'react' && kind !== 'jsx') continue;
    const source = page.source;
    if (typeof source !== 'string' || source.trim() === '') continue;
    const name = String(page.name ?? `#${p}`);

    CLASSNAME_ATTR.lastIndex = 0;
    let count = 0;
    while (CLASSNAME_ATTR.exec(source) !== null) count++;
    if (count === 0) continue;

    findings.push({
      severity: 'warning',
      rule: PAGE_SOURCE_CLASSNAME,
      where: `page "${name}"`,
      path: `pages[${p}].source`,
      message: `${count} \`className\` attribute${count > 1 ? 's' : ''} in ${String(kind)}-source page — Tailwind utilities in page source silently produce no CSS (the build never scans authored metadata; ADR-0065).`,
      hint:
        kind === 'react'
          ? "Style with inline style={{}} using hsl(var(--token)) theme colors (e.g. color:'hsl(var(--foreground))', background:'hsl(var(--card))'); render drawer/modal via <ObjectForm formType=\"drawer\"|\"modal\"> instead of hand-rolled overlays."
          : "Lay out with the components' structured props (<flex direction gap>, <grid columns>) and add CSS via a JSON style object style={{\"color\":\"hsl(var(--foreground))\"}}; do not use Tailwind className.",
    });
  }
  return findings;
}
