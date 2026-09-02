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
 * the regex rejects (top-level `import`, `require(` / esbuild's `__require(`,
 * `fetch(`, `process.*`, `globalThis.*`, `eval`, `new Function`, `.sudo(`) makes
 * extraction **throw**.
 *
 * ⚠️ What that throw costs the BUILD depends on the flag, and the two outcomes
 * are not the same one. This header used to claim only the second (#10678):
 *
 *   default `os build`  {@link lowerCallables} catches the throw, records it in
 *                       `bodyExtractionWarnings`, and ships the callable through
 *                       the back-compat `.mjs` bundle instead. No forbidden body
 *                       is ever emitted as `body.source` — but the build exits
 *                       **0**. `compile.ts` prints the recorded warnings, so
 *                       warn-and-bundle is at least not silent; it was silent
 *                       until #10678, which is the whole defect that card names.
 *   `--strict-body`     the same recorded warnings become a hard failure (exit 1)
 *                       with a per-callable diagnostic, and nothing is bundled.
 *   `os lint`           (#13651) reads the REFUSAL KIND, not the exit code, and
 *                       gives the two classes different verdicts: an accidental
 *                       scope leak (`free-identifiers`) is a lint `error`, so a
 *                       gate can fail on it; a structural one (`forbidden-token`)
 *                       stays a warning, because bundling is its designed answer.
 *                       `os lint` calls THIS function, so its verdict cannot
 *                       drift from what `os build` would do to the same handler.
 *
 * So the allow-list gates what may become `body.source`; it does not (yet) gate
 * what may build. Closing the L3 `.mjs` path is `--strict-body`'s job today and
 * Phase 3's later — not this list's. Docs `hook-bodies.mdx` describe the same
 * outcomes; when this header and that page disagree, they are both wrong
 * until one of them is measured over a real `os build`.
 *
 * Capability inference: we scan the body for known `ctx.api.*`, `ctx.log.*`,
 * `ctx.crypto.*` access patterns and add the matching capability tokens to
 * `body.capabilities` automatically.
 *
 * ⛔ RETIRED — the `// @capabilities api.read api.write` hook-body directive was
 * removed in @objectstack/cli 17.1 (#10917, ADR-0049 enforce-or-remove). It was
 * read off `String(fn)`, and `loadConfig` runs every config through
 * `bundle-require` -> esbuild, which strips `//` line comments before the
 * handler is ever a runtime function. Measured on all four ordinary authoring
 * shapes (#10678) — `objectstack.config.ts`, `.js`, `.mjs`, and a handler
 * imported from a local module — the directive reached this code from NONE of
 * them: the build shipped the inferred capabilities alone, at exit 0, with no
 * error and no warning, and the mismatch surfaced far from its cause as a
 * sandbox refusal at runtime. Declare the tokens as DATA instead —
 * `body: { language: 'js', source, capabilities: [...] }` on the hook or action
 * — which is measured to survive the build.
 *
 * ⛔ Do not re-add a comment-borne override. A directive every ordinary
 * authoring path strips cannot be typed wrongly-but-visibly, so it can only
 * teach a wrong convention silently; that is why it was retired rather than
 * re-documented. `test/hook-body-build-reach.e2e.test.ts` pins both halves —
 * the directive contributing nothing, and `body.capabilities` surviving — over
 * a real spawned `os build`.
 *
 * Self-containment (#1876): a handler that references a module-scope identifier
 * (helper, import, top-level const) cannot be shipped body-only — the reference
 * would `ReferenceError` at runtime. {@link detectFreeIdentifiers} finds those;
 * extraction throws so the caller falls back to bundling the real closure.
 *
 * Sandbox-missing HOST globals (#14301) arrive through that same gate and for
 * the same reason, once the ambient allowlist stopped conflating "Node has it"
 * with "the sandbox has it". `Intl` was allowlisted next to `JSON`, so a handler
 * calling `Intl.DateTimeFormat` had no free identifier at all: it lowered, every
 * local gate stayed green, and the body threw `ReferenceError` in production —
 * under a hook's default `onError: 'abort'`, refusing every write to the object.
 * Those names are now REPORTED (`FreeIdentifierResult.nodeOnly`) and refused
 * with prose that names the identifier and the remedy, which is NOT the
 * module-scope one: a host global cannot be inlined.
 */

import { detectFreeIdentifiers } from './detect-free-identifiers.js';

/**
 * WHY a refusal carries a machine-readable kind (#13651).
 *
 * Every refusal below already KNOWS which rule refused — the rule is what
 * produced the sentence. Until this type existed, that knowledge was flattened
 * into the message string at the `throw` and never recovered: `lowerCallables`
 * caught the error, kept `err.message`, and every consumer downstream had a
 * paragraph of English where it needed a category. So the two refusals that
 * mean OPPOSITE things to an author shared one undifferentiated fate:
 *
 *   `free-identifiers`   the handler names something the lowered body's world
 *                        does not bind, so the deployment shape silently
 *                        changed from metadata to bundled closure — against
 *                        what the author wrote. Two sub-cases, told apart by
 *                        `nodeOnlyIdentifiers`: a module-scope helper/import/
 *                        const, whose remedy is local and mechanical (inline
 *                        the value), and a global the NODE HOST has that the
 *                        sandbox does not (#14301), which cannot be inlined at
 *                        all — that one keeps the check in a string handler ref
 *                        or moves it to a validation rule.
 *   `forbidden-token`    the handler is NOT expressible as a metadata-only body
 *                        at ALL. `fetch`/`require`/`process`/… are capabilities
 *                        the QuickJS sandbox does not have, so writing one IS
 *                        choosing a bundled closure. Falling back to the bundle
 *                        is the designed answer, not a degradation to report as
 *                        an error.
 *   `unparseable`        the extractor could not find a body to peel. An
 *                        instrument limit, not an author verdict.
 *
 * ⛔ The kind is NOT a license to change what `os build` accepts. Both classes
 * still fall back to bundling and still exit 0 — see `lowerCallables`, whose
 * catch is deliberately kept. What the kind buys is that a consumer can now
 * treat the accidental class differently from the structural one; `os lint` is
 * the first to do so.
 */
export type HookBodyRefusalKind = 'unparseable' | 'forbidden-token' | 'free-identifiers';

/**
 * A refusal from {@link extractHookBody}, carrying the classification the
 * refusing rule already had.
 *
 * The `message` is deliberately byte-identical to what this function threw
 * before the class existed: `os build`'s warn-and-bundle line, `--strict-body`'s
 * per-callable diagnostic and `content/docs/automation/hook-bodies.mdx` all
 * quote those sentences, and a refusal that reads differently would be a
 * documentation break wearing a refactor's clothes. The class ADDS structure
 * beside the prose; it does not restate it.
 */
export class HookBodyExtractionError extends Error {
  readonly kind: HookBodyRefusalKind;
  readonly originLabel: string;
  /** Names the handler referenced but does not bind — `free-identifiers` only. */
  readonly freeIdentifiers: readonly string[];
  /**
   * The subset of {@link freeIdentifiers} the NODE HOST provides and the QuickJS
   * sandbox does not (#14301) — `Intl` the reported one.
   *
   * Same discipline as `kind` above, one level finer: the refusing rule already
   * knows which half of the free list it is looking at, and a consumer that has
   * to re-derive it from the message prose is back where #13651 started. The
   * two halves have OPPOSITE remedies — a module-scope name is inlined into the
   * handler, a host-only global cannot be inlined at all — so a consumer that
   * prints one remedy for both prints a wrong one half the time.
   */
  readonly nodeOnlyIdentifiers: readonly string[];

  constructor(
    kind: HookBodyRefusalKind,
    originLabel: string,
    message: string,
    freeIdentifiers: readonly string[] = [],
    nodeOnlyIdentifiers: readonly string[] = [],
  ) {
    super(message);
    this.name = 'HookBodyExtractionError';
    this.kind = kind;
    this.originLabel = originLabel;
    this.freeIdentifiers = freeIdentifiers;
    this.nodeOnlyIdentifiers = nodeOnlyIdentifiers;
  }
}

const FORBIDDEN_PATTERNS: Array<{ rx: RegExp; reason: string }> = [
  { rx: /\bimport\s*[\(\*\{]/, reason: 'dynamic `import()` and ES imports are not allowed in hook/action bodies — declare a Connector recipe instead' },
  // Both spellings, one reason (#10678). A TypeScript config is loaded through
  // `bundle-require` -> esbuild, whose ESM interop shim rewrites a CommonJS
  // `require('node:os')` into `__require("node:os")` BEFORE `String(fn)` ever
  // runs. Matching only the source spelling made this reason UNREACHABLE from
  // the real authoring path: the refusal still fired, but through the #1876
  // free-identifier gate, naming `__require` — an identifier the author never
  // typed and cannot act on. Accept behaviour is unchanged either way (the body
  // was already refused); what changes is that the reason now names what was
  // written. `\b(?:__)?` cannot widen to `myrequire(` — no word boundary there.
  { rx: /\b(?:__)?require\s*\(/, reason: '`require()` is not allowed in hook/action bodies (esbuild rewrites it to `__require()` when the config is TypeScript; both spellings are refused)' },
  { rx: /\bfetch\s*\(/, reason: '`fetch()` is not allowed in hook/action bodies — declare a Connector recipe instead' },
  { rx: /\bprocess\s*\./, reason: '`process` access is not allowed in hook/action bodies' },
  { rx: /\bglobalThis\s*\./, reason: '`globalThis` access is not allowed in hook/action bodies' },
  { rx: /\beval\s*\(/, reason: '`eval()` is not allowed in hook/action bodies' },
  { rx: /\bnew\s+Function\s*\(/, reason: '`new Function()` is not allowed in hook/action bodies' },
  // [#14010] `sudo()` exists on the HOST `ScopedContext` and is NOT marshalled
  // into the VM, so lowering a handler that calls it turns working in-process
  // code into a `TypeError` that only production sees. Refusing here is what
  // makes the two runtimes agree: the callable is still registered in
  // `functions` and still shipped through the `.mjs` bundle by `lowerCallables`,
  // so the handler keeps running in-process where `sudo()` is real — the build
  // just declines to ALSO emit it as a body that cannot run.
  //
  // Same family as the `crypto.hash` retirement three lines into
  // CAPABILITY_PATTERNS below (#4391): a member advertised ahead of its
  // implementation, where the build-time inference was the amplifier rather
  // than the safety net. The difference is the remedy — `crypto.hash` had no
  // working channel to fall back to, this one does.
  //
  // Receiver-loose, like the `.object(...)` / `.title(...)` capability patterns:
  // a local alias (`const api = ctx.api; api.sudo()`) must not slip through,
  // and over-refusal is the SAFE direction here (the handler is bundled and
  // works; it is only `--strict-body`, which demands a body for every callable,
  // that turns this into a hard failure — correctly, since a body needing
  // elevation genuinely cannot be one).
  {
    rx: /\.\s*sudo\s*\(/,
    reason:
      '`sudo()` is not reachable from a sandboxed body — the VM\'s `ctx.api` carries only `object()` '
      + 'and `transaction()`, so the call is a TypeError at run time (and under a hook\'s default '
      + '`onError: \'abort\'` that aborts the triggering write). Stamp the value from the record\'s own '
      + 'before-hook (`ctx.input.<field> = ...`), or leave this handler bundled so it runs in-process '
      + 'where `sudo()` exists',
  },
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
  // [#11293] `ctx.title(field)` — the RELATED-record form, and only that form.
  // `ctx.title()` resolves this record's title (formula included) from the
  // state the hook is already firing on and performs no read at all, so it
  // needs no capability and inferring one for it would tax the majority case
  // with a grant it never exercises. The argument form costs exactly one
  // `findOne` through the body's own read channel, which is the same read
  // `ctx.api.object(...).findOne()` would do and gets the same token.
  //
  // `[^)\s]` after the paren is what distinguishes the two: `ctx.title()` and
  // `ctx.title( )` do not match, `ctx.title('account_id')` does. Receiver-loose
  // like the `.object(...)` patterns above, for the same reason — a local alias
  // (`const t = ctx.title`) must not silently UNDER-infer, since that failure
  // arrives as a sandbox refusal at run time, far from its cause. Over-inferring
  // grants a token the body may not use, which the sandbox simply never checks.
  { rx: /\.\s*title\s*\(\s*[^)\s]/, cap: 'api.read' },
];

export interface ExtractedBody {
  /** Pure function-body source (without the surrounding `(ctx) => {...}`). */
  source: string;
  /**
   * Capability tokens INFERRED from the body source (see CAPABILITY_PATTERNS).
   * Inference is the only thing that fills this in: the comment-borne override
   * is retired (see this file's header). An author whose needs differ from what
   * inference derives writes `body.capabilities` on the hook instead.
   */
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
    throw new HookBodyExtractionError(
      'unparseable',
      originLabel,
      `[hook-body-extract] could not parse the body of ${originLabel}; ` +
        `please rewrite the handler as a single arrow function or named function expression`,
    );
  }

  // Reject any forbidden token before we ship the source as metadata.
  for (const { rx, reason } of FORBIDDEN_PATTERNS) {
    if (rx.test(block.source)) {
      throw new HookBodyExtractionError(
        'forbidden-token',
        originLabel,
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
  const { free, nodeOnly, unparsed } = detectFreeIdentifiers(raw);
  if (!unparsed && free.length > 0) {
    throw new HookBodyExtractionError(
      'free-identifiers',
      originLabel,
      freeIdentifierRefusal(originLabel, free, nodeOnly),
      free,
      nodeOnly,
    );
  }

  // Infer capabilities from API surface usage.
  const inferred = new Set<ExtractedBody['capabilities'][number]>();
  for (const { rx, cap } of CAPABILITY_PATTERNS) {
    if (rx.test(block.source)) inferred.add(cap);
  }

  return {
    source: block.source,
    capabilities: [...inferred].sort(),
    isExpression: block.isExpression,
  };
}

/**
 * The closed set of host names the sandbox answers with a FIRST-CLASS
 * replacement, so the refusal can name it.
 *
 * Deliberately one entry, not a mechanism. `console` is the host-only name an
 * ordinary handler is most likely to reach for, and "keep it in a string
 * handler ref" is poor advice for a log line when the platform's own answer is
 * one capability away. Every other member of `NODE_ONLY_GLOBALS` has no
 * in-sandbox equivalent to point at, and inventing one per name would be a
 * second, unmeasured contract growing beside the measured set.
 */
const SANDBOX_REPLACEMENTS: Readonly<Record<string, string>> = {
  console: 'For logging specifically the sandbox has `ctx.log` — declare the `log` capability and '
    + 'call `ctx.log.info(...)`.',
};

/**
 * The prose for a `free-identifiers` refusal.
 *
 * ⛔ The module-scope-only sentence is BYTE-IDENTICAL to what this function
 * threw before #14301 — `os build`'s warn-and-bundle line, `--strict-body`'s
 * per-callable diagnostic and `content/docs/automation/hook-bodies.mdx` all
 * quote it, and a refusal that reads differently would be a documentation break
 * wearing a refactor's clothes. The host-only branch is ADDITIONAL prose for a
 * case that could not previously arrive here at all (the names were allowlisted
 * away), so it breaks no quotation.
 *
 * The two branches exist because the remedies are opposite and a wrong remedy
 * is worse than none: "inline the helper" is impossible for `Intl`, and an
 * author (or a code-writing model) who tries it lands on a second broken shape.
 */
function freeIdentifierRefusal(
  originLabel: string,
  free: readonly string[],
  nodeOnly: readonly string[],
): string {
  const head =
    `[hook-body-extract] ${originLabel}: handler references identifier(s) not in scope at runtime: ` +
    `${free.join(', ')}. `;

  if (nodeOnly.length === 0) {
    return (
      head +
      `Module-scope helpers/imports aren't shipped with a metadata-only body, so ` +
      `this handler will be BUNDLED instead (no behavior change). To make it body-only, inline the ` +
      `helper(s) into the handler or move the logic behind \`ctx\` (e.g. \`ctx.api\`).`
    );
  }

  const names = nodeOnly.join(', ');
  const isAre = nodeOnly.length === 1 ? 'is' : 'are';
  const itThem = nodeOnly.length === 1 ? 'it' : 'them';
  const moduleScope = free.filter((n) => !nodeOnly.includes(n));
  const tail =
    moduleScope.length > 0
      ? ` The remaining name(s) — ${moduleScope.join(', ')} — are module-scope helpers/imports: ` +
        `inline them into the handler or move the logic behind \`ctx\` (e.g. \`ctx.api\`).`
      : '';
  const hint = nodeOnly.map((n) => SANDBOX_REPLACEMENTS[n]).filter(Boolean).join(' ');

  return (
    head +
    `${names} ${isAre} not available in the hook sandbox — the QuickJS build the runtime evaluates a ` +
    `lowered body in does not provide ${itThem}, so the body would throw ReferenceError in production ` +
    `while validate, typecheck, test and build all stay green (they run the raw function in Node, ` +
    `where ${itThem} exist${nodeOnly.length === 1 ? 's' : ''}). This handler will be BUNDLED instead ` +
    `(no behavior change). To keep it as metadata, keep the check in a string handler ref — put the ` +
    `function in the top-level \`functions:\` map and write \`handler: 'fn_name'\` — or move it to a ` +
    `validation rule.${hint ? ' ' + hint : ''}` +
    tail
  );
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
