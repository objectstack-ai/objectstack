// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Extract a metadata-only `HookBody` from an inline JS function.
 *
 * The CLI's `lowerCallables` pass already has direct access to every
 * `handler: (ctx) => {...}` value the user wrote in their `defineStack({...})`
 * config. After tsx/esbuild has loaded the config, those callables are real
 * runtime functions whose `.toString()` returns the compiled source — that
 * source is exactly what we want to ship as `body.source` so the runtime can
 * re-evaluate it inside the QuickJS sandbox without needing the .mjs side
 * channel.
 *
 * For v1 we apply a deliberately simple **regex allow-list** over the
 * extracted body — full TypeScript AST analysis is deferred to v2. Anything
 * the regex rejects (top-level `import`, `require(`, `fetch(`, `process.*`,
 * `globalThis.*`, `eval`, `new Function`) makes the build **fail**. There is
 * no silent fallback to the L3 .mjs path because that path is being closed.
 *
 * Capability inference: we scan the body for known `ctx.api.*`, `ctx.log.*`,
 * `ctx.crypto.*` access patterns and add the matching capability tokens to
 * `body.capabilities` automatically. Authors can still override by setting
 * `// @capabilities api.read api.write` as the first line of the function.
 *
 * Self-containment (#1876): a handler that references a module-scope identifier
 * (helper, import, top-level const) cannot be shipped body-only — the reference
 * would `ReferenceError` at runtime. {@link detectFreeIdentifiers} finds those;
 * extraction throws so the caller falls back to bundling the real closure.
 */

import { detectFreeIdentifiers } from './detect-free-identifiers.js';

const FORBIDDEN_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\bimport\s*[\(\*\{]/, reason: 'dynamic `import()` and ES imports are not allowed in hook/action bodies — declare a Connector recipe instead' },
  { rx: /\brequire\s*\(/, reason: '`require()` is not allowed in hook/action bodies' },
  { rx: /\bfetch\s*\(/, reason: '`fetch()` is not allowed in hook/action bodies — declare a Connector recipe instead' },
  { rx: /\bprocess\s*\./, reason: '`process` access is not allowed in hook/action bodies' },
  { rx: /\bglobalThis\s*\./, reason: '`globalThis` access is not allowed in hook/action bodies' },
  { rx: /\beval\s*\(/, reason: '`eval()` is not allowed in hook/action bodies' },
  { rx: /\bnew\s+Function\s*\(/, reason: '`new Function()` is not allowed in hook/action bodies' },
];

const CAPABILITY_PATTERNS: Array<{ rx: RegExp; cap: 'api.read' | 'api.write' | 'crypto.uuid' | 'log' }> = [
  // Match `ctx.api.object(...)` directly OR a local alias like
  // `const api = ctx.api;` then `api.object(...)`. We accept any
  // identifier (or chain) ending in `.object(...)` followed by a known
  // read/write method — over-inclusive but safe (false-positive caps
  // get rejected at the runtime by the sandbox if not actually granted).
  { rx: /\.object\s*\([^)]+\)\s*\.\s*(?:find|findOne|count|aggregate|get|list)\b/, cap: 'api.read' },
  { rx: /\.object\s*\([^)]+\)\s*\.\s*(?:insert|update|upsert|delete|patch|remove|create)\b/, cap: 'api.write' },
  { rx: /ctx\.crypto\.randomUUID\b/, cap: 'crypto.uuid' },
  // NO `ctx.crypto.hash` pattern: the `crypto.hash` token was removed in spec 17
  // (#4391) because the sandbox never installed the function. Inferring a
  // capability from a call that always threw is what let `os build` bless a
  // dead body — the inference was the amplifier, not the safety net.
  { rx: /ctx\.log\.(?:info|warn|error|debug)\b/, cap: 'log' },
];

export interface ExtractedBody {
  /** Pure function-body source (without the surrounding `(ctx) => {...}`). */
  source: string;
  /** Inferred capability tokens — may be merged with explicit `// @capabilities` line. */
  capabilities: Array<'api.read' | 'api.write' | 'crypto.uuid' | 'log'>;
  /** True when source is a single expression (arrow with implicit return). */
  isExpression: boolean;
}

/**
 * Extract the body source from a callable. Throws on forbidden patterns.
 */
export function extractHookBody(fn: (...a: unknown[]) => unknown, originLabel: string): ExtractedBody {
  const raw = String(fn);

  // Strip leading function/arrow header and trailing closing brace so the
  // result is a pure block body suitable for `new Function('ctx', body)`.
  const block = peelToBlockBody(raw);
  if (!block) {
    throw new Error(
      `[hook-body-extract] could not parse the body of ${originLabel}; ` +
        `please rewrite the handler as a single arrow function or named function expression`,
    );
  }

  // Reject any forbidden token before we ship the source as metadata.
  for (const { rx, reason } of FORBIDDEN_PATTERNS) {
    if (rx.test(block.source)) {
      throw new Error(
        `[hook-body-extract] ${originLabel}: ${reason}\n` +
          `--- offending body source ---\n${block.source.slice(0, 400)}${block.source.length > 400 ? '…' : ''}`,
      );
    }
  }

  // #1876 — a handler that references a MODULE-SCOPE identifier (a helper, an
  // imported binding, a top-level const) is NOT self-contained: shipping it as
  // a metadata-only `body` would throw `ReferenceError` at runtime (the
  // reference ships without its definition). Detect those free identifiers and
  // throw — the caller catches this and keeps the handler in the BUNDLED form,
  // where esbuild carries the real closure along. The whole `fn` source (params
  // included) is analyzed so parameters are correctly in scope.
  const { free, unparsed } = detectFreeIdentifiers(raw);
  if (!unparsed && free.length > 0) {
    throw new Error(
      `[hook-body-extract] ${originLabel}: handler references identifier(s) not in scope at runtime: ` +
        `${free.join(', ')}. Module-scope helpers/imports aren't shipped with a metadata-only body, so ` +
        `this handler will be BUNDLED instead (no behavior change). To make it body-only, inline the ` +
        `helper(s) into the handler or move the logic behind \`ctx\` (e.g. \`ctx.api\`).`,
    );
  }

  // Infer capabilities from API surface usage.
  const inferred = new Set<ExtractedBody['capabilities'][number]>();
  for (const { rx, cap } of CAPABILITY_PATTERNS) {
    if (rx.test(block.source)) inferred.add(cap);
  }

  // Honour an explicit override: `// @capabilities api.read api.write`.
  const overrideMatch = block.source.match(/^[\s\n]*\/\/\s*@capabilities\s+([a-z.\s]+)/m);
  if (overrideMatch) {
    const tokens = overrideMatch[1].split(/\s+/).filter(Boolean);
    for (const t of tokens) {
      if (
        t === 'api.read' ||
        t === 'api.write' ||
        t === 'crypto.uuid' ||
        t === 'log'
      ) {
        inferred.add(t);
      }
    }
  }

  return {
    source: block.source,
    capabilities: [...inferred].sort(),
    isExpression: block.isExpression,
  };
}

interface PeeledBody {
  source: string;
  isExpression: boolean;
}

/**
 * Remove the parameter list and outermost braces from a function string,
 * yielding the bare statements (or expression for shorthand arrows).
 */
function peelToBlockBody(raw: string): PeeledBody | null {
  // Try arrow forms first since they're the dominant authoring style.
  // Match the parameter list followed by `=>` and either `{...}` or expr.
  // We rely on a manual brace scan rather than a single regex so braces
  // inside string/template literals don't confuse us.
  const arrowIdx = findTopLevelArrow(raw);
  if (arrowIdx >= 0) {
    const after = raw.slice(arrowIdx + 2).trimStart();
    if (after.startsWith('{')) {
      const body = sliceBalanced(after, '{', '}');
      if (body) return { source: body.inner, isExpression: false };
    } else {
      // Implicit-return arrow — wrap as `return ...;`
      const expr = after.replace(/[;\s]+$/g, '');
      return { source: `return (${expr});`, isExpression: true };
    }
  }

  // function () { ... } / async function () { ... }
  const fnIdx = raw.search(/\bfunction\b/);
  if (fnIdx >= 0) {
    const braceIdx = raw.indexOf('{', fnIdx);
    if (braceIdx > 0) {
      const body = sliceBalanced(raw.slice(braceIdx), '{', '}');
      if (body) return { source: body.inner, isExpression: false };
    }
  }

  // Method shorthand inside an object literal: `name(ctx) { ... }`.
  const braceIdx = raw.indexOf('{');
  if (braceIdx > 0) {
    const body = sliceBalanced(raw.slice(braceIdx), '{', '}');
    if (body) return { source: body.inner, isExpression: false };
  }
  return null;
}

function findTopLevelArrow(s: string): number {
  // Skip past balanced parameter list `(...)` then expect `=>`.
  // We scan looking for `(` not preceded by an identifier char and
  // immediately matched by a balanced `)` then optional whitespace then `=>`.
  let i = 0;
  const len = s.length;
  while (i < len) {
    if (s[i] === '(') {
      const closing = matchBalancedIndex(s, i, '(', ')');
      if (closing < 0) return -1;
      let j = closing + 1;
      while (j < len && /\s/.test(s[j])) j++;
      if (s[j] === '=' && s[j + 1] === '>') return j;
      i = closing + 1;
      continue;
    }
    i++;
  }
  return -1;
}

function matchBalancedIndex(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function sliceBalanced(s: string, open: string, close: string): { inner: string } | null {
  const end = matchBalancedIndex(s, 0, open, close);
  if (end < 0) return null;
  return { inner: s.slice(1, end) };
}
