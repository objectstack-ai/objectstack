// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Build-time prop check for `kind:'react'` pages (ADR-0081 Phase 2). The syntax
// gate (validate-react-pages) confirms the source parses; this confirms the
// AUTHOR USED THE COMPONENT CONTRACT correctly — it parses the real JSX with the
// TypeScript compiler, finds usages of the injected blocks (<ObjectForm>,
// <ListView>, …), and checks each against the react-tier contract
// (REACT_BLOCKS in @objectstack/spec):
//
//   - missing a required binding prop (e.g. <ObjectForm> with no objectName)
//     → error. (Only the React-enforceable overlay props are required-checked;
//      a spread `{...props}` escapes the check since props may come from it.)
//   - a prop that is a near-miss (edit distance ≤ 2) of a known prop
//     (e.g. `onSucces` → `onSuccess`) → warning. We do NOT flag arbitrary
//     unknown props (the contract's data props are a curated subset) — only the
//     likely typos, to keep false positives near zero.

import { createRequire } from 'node:module';
import type ts from 'typescript';
import { REACT_BLOCKS } from '@objectstack/spec/ui';

// The TypeScript compiler must NOT be imported at module top level: it is
// ~9 MB of CJS (~70 ms+ to parse, worse on container cold starts), and
// @objectstack/lint sits on the kernel boot path — while this gate only runs
// when a `kind:'react'` page is actually validated (rare, trusted tier). An
// eager import also hard-crashes boot in deployments that prune the package
// from the image (cloud's Docker pruner did exactly that). So the compiler is
// loaded lazily, on first use, and stays a regular dependency in package.json.
// Guarded by lazy-typescript.test.ts.
//
// `node:module` is a Node builtin, untouched by esbuild/tsup, so the static
// `createRequire` import survives bundling; the `createRequire(...)` call is
// deferred because `import.meta.url` is rewritten to an empty stub in the CJS
// build (same pattern as driver-sqlite-wasm's knex-wasm-dialect).
let cachedTs: typeof ts | null = null;
function loadTypeScript(): typeof ts {
  if (cachedTs) return cachedTs;
  const anchor =
    typeof import.meta !== 'undefined' && import.meta.url
      ? import.meta.url
      : typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/';
  try {
    cachedTs = createRequire(anchor)('typescript') as typeof ts;
  } catch (err) {
    throw new Error(
      `@objectstack/lint: validating a kind:'react' page requires the "typescript" package, which could not be loaded ` +
        `(${err instanceof Error ? err.message : String(err)}). It is a declared dependency of @objectstack/lint — ` +
        `if this deployment prunes packages, keep "typescript" in the image; it is only loaded when a react-source page is validated.`,
    );
  }
  return cachedTs;
}

export type ReactPropSeverity = 'error' | 'warning';

export interface ReactPropFinding {
  severity: ReactPropSeverity;
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;
const asArray = (v: unknown): AnyRec[] => (Array.isArray(v) ? (v as AnyRec[]) : []);

interface BlockSpec {
  requiredBindings: string[];
  knownProps: Set<string>;
}
const BLOCKS: Map<string, BlockSpec> = new Map(
  (REACT_BLOCKS as Array<{ tag: string; interactions: Array<{ name: string; required?: boolean }> }>).map((b) => [
    b.tag,
    {
      requiredBindings: b.interactions.filter((i) => i.required).map((i) => i.name),
      knownProps: new Set(b.interactions.map((i) => i.name)),
    },
  ]),
);

function editDistance(a: string, b: string, cap = 2): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}

function nearestKnown(prop: string, known: Set<string>): string | null {
  if (known.has(prop)) return null;
  let best: string | null = null;
  let bestD = 3;
  for (const k of known) {
    const d = editDistance(prop, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= 2 ? best : null;
}

export function validateReactPageProps(stack: AnyRec): ReactPropFinding[] {
  const findings: ReactPropFinding[] = [];
  const pages = asArray(stack.pages);
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    if (!page || page.kind !== 'react') continue;
    const source = page.source;
    if (typeof source !== 'string' || source.trim() === '') continue;
    const name = String(page.name ?? `#${p}`);

    // Outside the try below on purpose: a missing compiler must surface as an
    // error, not be swallowed as "unparseable source".
    const tsc = loadTypeScript();

    let sf: ts.SourceFile;
    try {
      sf = tsc.createSourceFile('page.tsx', source, tsc.ScriptTarget.Latest, true, tsc.ScriptKind.TSX);
    } catch {
      continue; // the syntax gate reports unparseable sources
    }

    const visit = (node: ts.Node): void => {
      if (tsc.isJsxOpeningElement(node) || tsc.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sf);
        const block = BLOCKS.get(tag);
        if (block) {
          let hasSpread = false;
          const used = new Set<string>();
          for (const a of node.attributes.properties) {
            if (tsc.isJsxSpreadAttribute(a)) { hasSpread = true; continue; }
            if (tsc.isJsxAttribute(a)) used.add(a.name.getText(sf));
          }
          const where = `page "${name}" › <${tag}>`;
          const path = `pages[${p}].source`;
          if (!hasSpread) {
            for (const req of block.requiredBindings) {
              if (!used.has(req)) {
                findings.push({
                  severity: 'error',
                  rule: 'react-prop-missing-required',
                  where, path,
                  message: `<${tag}> is missing the required prop "${req}".`,
                  hint: `Pass ${req}={…}. See the react-tier component contract.`,
                });
              }
            }
          }
          for (const u of used) {
            const near = nearestKnown(u, block.knownProps);
            if (near) {
              findings.push({
                severity: 'warning',
                rule: 'react-prop-typo',
                where, path,
                message: `<${tag}> has prop "${u}" — did you mean "${near}"?`,
                hint: 'Likely a typo of a contract prop. Fix it or remove it.',
              });
            }
          }
        }
      }
      tsc.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}
