// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Author-time write-set check for L2 (`language:'js'`) hook bodies (#4271).
//
// An L2 body that writes a field the target object never declares —
// `ctx.input.amout = 0`, `ctx.api.object('deal').update({ stag: 'won' })` —
// runs clean in the QuickJS sandbox, reports success, and the unknown column
// simply never lands in the stored record. No diagnostic anywhere: the exact
// "silent no-op manufactures false completion" failure mode of #4001, at the
// runtime-expression layer. The read side (`hook.condition`, ADR-0032) and the
// capability surface are statically checked; until this rule, the write side
// was the one blind face (the gap `hook-body.zod.ts` used to carry as
// "accepted").
//
// Scope — the literal write patterns in {@link HOOK_BODY_WRITE_PATTERNS}, and
// nothing else. The body is PARSED (TypeScript parser, never executed, never
// type-checked); each declared pattern is reconciliation-tested against the
// extractor, so a pattern cannot be declared-but-unverified (#3528's death).
// Everything statically unknowable is skipped SILENTLY, asymmetrically
// favouring missed findings over false ones — a false positive kills an
// advisory lint, a miss just leaves the gap open a little longer:
//
//   • computed keys (`ctx.input[k] = …`), spreads, non-literal payloads;
//   • dynamic object names (`ctx.api.object(name)`);
//   • `object:'*'` wildcard hooks' `ctx.input` writes (no single target);
//   • multi-target hooks where the field exists on SOME target — the body may
//     legitimately branch per object (`if (ctx.object === '…')`), so only a
//     field missing on EVERY named target is flagged;
//   • targets declared by another package (not in this stack);
//   • one-level aliasing (`const doc = ctx.input; doc.x = 1`) — known miss,
//     deliberately: v1 does no data-flow analysis.
//
// Severity: always `warning` (advisory, never gates). Same posture as
// `lintUnknownAuthoringKeys` (#3786) — ratchet only with field data.
//
// Wired via REFERENCE_INTEGRITY_RULES (it resolves field NAMES written in
// metadata against what the stack declares — the suite's exact membership
// test), so it runs on `os validate`, `os lint` and `os compile` at once.
// Deliberately NOT in the `defineStack` runtime path: the TypeScript parser
// has no place on kernel boot (see the lazy-load contract below).

import { createRequire } from 'node:module';
import type ts from 'typescript';
import { findClosestMatches, formatSuggestion } from '@objectstack/spec/shared';

// The TypeScript compiler must NOT be imported at module top level: it is
// ~9 MB of CJS, and @objectstack/lint sits on the kernel boot path — while
// this gate only parses when a hook actually carries an L2 JS body. Same
// lazy-load contract as validate-react-page-props.ts (which see for the
// history, including production images pruning the package). Guarded by
// lazy-deps.test.ts.
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
      `@objectstack/lint: checking an L2 (language:'js') hook body requires the "typescript" package, which could not ` +
        `be loaded (${err instanceof Error ? err.message : String(err)}). It is a declared dependency of ` +
        `@objectstack/lint — if this deployment prunes packages, keep "typescript" in the image; it is only loaded ` +
        `when a hook with a JS body is validated.`,
    );
  }
  return cachedTs;
}

export type HookBodyWriteSeverity = 'warning';

export interface HookBodyWriteFinding {
  /** v1 is advisory-only by contract — the type says so. */
  severity: HookBodyWriteSeverity;
  rule: string;
  /** Human-readable location, e.g. `hook "normalize_lead" › body`. */
  where: string;
  /** Config path, e.g. `hooks[0].body.source`. */
  path: string;
  message: string;
  hint: string;
}

// Rule id (registry entry).
export const HOOK_BODY_WRITE_UNKNOWN_FIELD = 'hook-body-write-unknown-field';

// ─── The write-pattern ledger ───────────────────────────────────────────────
//
// Every syntactic write shape the extractor recognizes, declared as data. The
// reconciliation test (validate-hook-body-writes.test.ts) runs the extractor
// over each entry's example and asserts it yields EXACTLY the declared writes,
// each tagged with this entry's id — so "the docs say this pattern is covered
// but nothing extracts it" cannot happen (#3528), and the answer to "which
// writes does the lint see?" is this list, not the extractor's code.

/** One syntactic write shape the extractor recognizes. */
export interface HookBodyWritePattern {
  /** Stable pattern id, carried on every extracted write. */
  readonly id: string;
  /** Author-facing syntax summary (for docs/diagnostics, not matching). */
  readonly syntax: string;
  /** Reconciliation fixture: extracting `source` must yield exactly `writes`. */
  readonly example: {
    readonly source: string;
    readonly writes: ReadonlyArray<{ field: string; object?: string }>;
  };
}

export const HOOK_BODY_WRITE_PATTERNS: readonly HookBodyWritePattern[] = [
  {
    id: 'input-property-assign',
    syntax: "ctx.input.<field> = … | ctx.input['<field>'] ⟨op⟩= …",
    example: {
      // Compound (`+=`) and logical (`??=`) assignment operators write their
      // LHS exactly like `=` does — the example pins the whole operator range.
      source: "ctx.input.total = 0; ctx.input['status'] ??= 'open'; ctx.input.retries += 1;",
      writes: [{ field: 'total' }, { field: 'status' }, { field: 'retries' }],
    },
  },
  {
    id: 'input-object-assign',
    syntax: 'Object.assign(ctx.input, { <field>: … })',
    example: {
      source: "Object.assign(ctx.input, { total: 5, 'status': 'open', discount });",
      writes: [{ field: 'total' }, { field: 'status' }, { field: 'discount' }],
    },
  },
  {
    id: 'api-crud-literal',
    syntax:
      "ctx.api.object('<object>').insert({…}) | .create({…}) | .update({…}) | .updateById(id, {…})",
    example: {
      // Real ObjectRepository signatures: the record payload is argument 0 for
      // insert/create/update and argument 1 for updateById. (`update(data)` —
      // NOT `update(id, data)`; the id travels inside the payload/options.)
      source:
        "await ctx.api.object('audit_log').insert({ event: 'won' }); " +
        "await ctx.api.object('crm_deal').updateById(id, { stage: 'won' });",
      writes: [
        { field: 'event', object: 'audit_log' },
        { field: 'stage', object: 'crm_deal' },
      ],
    },
  },
];

/**
 * `ctx.api.object(name)` write methods → index of the record-payload argument.
 * Mirrors `ObjectRepository` in packages/objectql (the surface hooks actually
 * receive): `upsert` exists only on the last-resort engine facade actions may
 * fall back to, never on the hook path, so it is deliberately absent.
 */
const API_WRITE_METHODS: ReadonlyMap<string, number> = new Map([
  ['insert', 0],
  ['create', 0],
  ['update', 0],
  ['updateById', 1],
]);

/**
 * Wrapper keys of the flat-input proxy (`installFlatInput` in
 * packages/objectql/src/hook-wrappers.ts). `ctx.input.data = …` replaces the
 * whole record payload and `id`/`options`/`ast` address the operation
 * envelope — none is a record-FIELD write, so none is ever flagged.
 */
const INPUT_ENVELOPE_KEYS: ReadonlySet<string> = new Set(['id', 'options', 'ast', 'data']);

/**
 * Registry-injected columns present on (almost) every object but absent from
 * `object.fields` — always legitimately writable by automation. The UNION of
 * the sets the other field-resolving rules carry, because the cost asymmetry
 * is the same everywhere: over-inclusion is at worst a missed finding,
 * under-inclusion is a false one.
 */
const SYSTEM_FIELDS: ReadonlySet<string> = new Set([
  'id', '_id', 'name', 'space',
  'owner', 'owner_id', 'user_id',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'organization_id', 'tenant_id',
  'is_deleted', 'deleted_at', 'record_type',
]);

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter((x): x is AnyRec => isRec(x));
  if (isRec(v)) {
    return Object.entries(v).map(([name, def]) => ({
      name,
      ...(isRec(def) ? def : {}),
    }));
  }
  return [];
}

/** object name → its declared field names (both `fields` authoring shapes). */
function indexObjectFields(stack: AnyRec): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const obj of asArray(stack.objects)) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const names = new Set<string>();
    for (const f of asArray(obj.fields)) {
      if (typeof f.name === 'string' && f.name) names.add(f.name);
    }
    out.set(name, names);
  }
  return out;
}

/** One statically-extracted field write found in an L2 body. */
export interface ExtractedHookBodyWrite {
  /** Which {@link HOOK_BODY_WRITE_PATTERNS} entry matched. */
  patternId: string;
  /** Target object name; `undefined` = the hook's own target object(s). */
  object?: string;
  /** The `ctx.api` method for diagnostics (`insert`/`create`/`update`/`updateById`). */
  method?: string;
  field: string;
}

/**
 * Extract every literal field write the pattern ledger declares from an L2
 * body's source. Parse-only (the source is never executed), error-tolerant
 * (a body with syntax errors simply yields fewer matches), and lazy: the
 * TypeScript compiler is not loaded when no pattern can possibly match.
 */
export function extractHookBodyWrites(source: string): ExtractedHookBodyWrite[] {
  // Every recognizable pattern begins at a `ctx` or `Object` identifier — a
  // body containing neither cannot match, and must not pay the compiler load.
  if (!/\bctx\b/.test(source) && !/\bObject\b/.test(source)) return [];

  const tsc = loadTypeScript();
  // The runtime wraps a hook body as `new AsyncFunction('ctx', source)` — a
  // FUNCTION BODY, not a module. Parse it in the same context so bare
  // `return` / `await` mean what they mean at run time.
  const sf = tsc.createSourceFile(
    'hook-body.ts',
    `async function __body(ctx) {\n${source}\n}`,
    tsc.ScriptTarget.Latest,
    /* setParentNodes */ false,
    tsc.ScriptKind.TS,
  );

  const writes: ExtractedHookBodyWrite[] = [];

  /** `node` is exactly `ctx.<prop>`. */
  const isCtxDot = (node: ts.Node, prop: string): boolean =>
    tsc.isPropertyAccessExpression(node) &&
    tsc.isIdentifier(node.expression) &&
    node.expression.text === 'ctx' &&
    node.name.text === prop;

  /** The literal record-field name of an LHS rooted at `ctx.input`, if any. */
  const fieldOfInputLhs = (lhs: ts.Expression): string | undefined => {
    if (tsc.isPropertyAccessExpression(lhs) && tsc.isIdentifier(lhs.name) && isCtxDot(lhs.expression, 'input')) {
      return lhs.name.text;
    }
    if (tsc.isElementAccessExpression(lhs) && isCtxDot(lhs.expression, 'input')) {
      const arg = lhs.argumentExpression;
      if (tsc.isStringLiteral(arg) || tsc.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
    }
    return undefined; // computed key / nested path — statically opaque
  };

  /** Literal keys of an object-literal expression (spreads/computed skipped). */
  const literalObjectKeys = (node: ts.Expression): string[] => {
    if (!tsc.isObjectLiteralExpression(node)) return [];
    const keys: string[] = [];
    for (const p of node.properties) {
      if (tsc.isPropertyAssignment(p)) {
        if (tsc.isIdentifier(p.name) || tsc.isStringLiteral(p.name)) keys.push(p.name.text);
      } else if (tsc.isShorthandPropertyAssignment(p)) {
        keys.push(p.name.text);
      }
      // spread / computed / method members are statically opaque — skipped
    }
    return keys;
  };

  const visit = (node: ts.Node): void => {
    // Pattern: input-property-assign. FirstAssignment..LastAssignment spans
    // `=` and every compound/logical assignment operator (`+=`, `??=`, …) —
    // each writes its LHS.
    if (
      tsc.isBinaryExpression(node) &&
      node.operatorToken.kind >= tsc.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= tsc.SyntaxKind.LastAssignment
    ) {
      const field = fieldOfInputLhs(node.left);
      if (field !== undefined && !INPUT_ENVELOPE_KEYS.has(field)) {
        writes.push({ patternId: 'input-property-assign', field });
      }
    }

    if (tsc.isCallExpression(node)) {
      const callee = node.expression;

      // Pattern: input-object-assign.
      if (
        tsc.isPropertyAccessExpression(callee) &&
        tsc.isIdentifier(callee.expression) &&
        callee.expression.text === 'Object' &&
        callee.name.text === 'assign' &&
        node.arguments.length >= 2 &&
        isCtxDot(node.arguments[0], 'input')
      ) {
        // Later Object.assign sources overwrite earlier ones but never remove
        // a key, so every literal key is genuinely written regardless of the
        // non-literal arguments around it.
        for (const arg of node.arguments.slice(1)) {
          for (const field of literalObjectKeys(arg)) {
            if (!INPUT_ENVELOPE_KEYS.has(field)) {
              writes.push({ patternId: 'input-object-assign', field });
            }
          }
        }
      }

      // Pattern: api-crud-literal — ctx.api.object('<lit>').<method>(payload…).
      if (tsc.isPropertyAccessExpression(callee) && tsc.isIdentifier(callee.name)) {
        const payloadIndex = API_WRITE_METHODS.get(callee.name.text);
        const recv = callee.expression;
        if (
          payloadIndex !== undefined &&
          tsc.isCallExpression(recv) &&
          tsc.isPropertyAccessExpression(recv.expression) &&
          recv.expression.name.text === 'object' &&
          isCtxDot(recv.expression.expression, 'api') &&
          recv.arguments.length === 1
        ) {
          const objArg = recv.arguments[0];
          const objectName =
            tsc.isStringLiteral(objArg) || tsc.isNoSubstitutionTemplateLiteral(objArg)
              ? objArg.text
              : undefined; // dynamic object name — statically opaque
          const payload = node.arguments[payloadIndex];
          if (objectName && payload !== undefined) {
            for (const field of literalObjectKeys(payload)) {
              writes.push({
                patternId: 'api-crud-literal',
                object: objectName,
                method: callee.name.text,
                field,
              });
            }
          }
        }
      }
    }

    tsc.forEachChild(node, visit);
  };
  visit(sf);
  return writes;
}

/**
 * Validate L2 hook-body writes against target-object field declarations.
 * Pure `(stack) => Finding[]` (ADR-0019); safe on pre- or post-parse stacks.
 */
export function validateHookBodyWrites(stack: AnyRec): HookBodyWriteFinding[] {
  const findings: HookBodyWriteFinding[] = [];
  const hooks = asArray(stack.hooks);
  if (hooks.length === 0) return findings;

  // Built lazily: a stack whose hooks are all L1/handler-based never pays it.
  let objectFields: Map<string, Set<string>> | null = null;

  hooks.forEach((hook, hookIndex) => {
    const body = hook.body;
    if (!isRec(body) || body.language !== 'js') return;
    const source = body.source;
    if (typeof source !== 'string' || source.trim() === '') return;

    const writes = extractHookBodyWrites(source);
    if (writes.length === 0) return;

    objectFields ??= indexObjectFields(stack);
    const hookName = typeof hook.name === 'string' && hook.name ? hook.name : `#${hookIndex}`;

    // The hook's own target set, for `ctx.input` writes. A wildcard target has
    // no single object to check against; an unknown (cross-package) target
    // cannot be judged — either way `ctx.input` writes are skipped, not guessed.
    const targets = (Array.isArray(hook.object) ? hook.object : [hook.object]).filter(
      (o): o is string => typeof o === 'string' && o.trim() !== '',
    );
    const targetSets = targets.map((t) => objectFields!.get(t));
    const inputJudgeable =
      targets.length > 0 && !targets.includes('*') && targetSets.every((s) => s !== undefined);

    const where = `hook "${hookName}" › body`;
    const path = `hooks[${hookIndex}].body.source`;
    const reported = new Set<string>();

    for (const w of writes) {
      const dedupeKey = `${w.object ?? ''}\u0000${w.field}`;
      if (reported.has(dedupeKey)) continue;

      if (w.object === undefined) {
        // ctx.input write → the hook's own object(s). Flag only a field
        // missing on EVERY named target (a multi-target body may branch per
        // object, so a partial miss is not statically wrong).
        if (!inputJudgeable) continue;
        if (SYSTEM_FIELDS.has(w.field)) continue;
        if (targetSets.some((s) => s!.has(w.field))) continue;

        reported.add(dedupeKey);
        const objDesc =
          targets.length === 1
            ? `object '${targets[0]}'`
            : `none of its target objects (${targets.join(', ')})`;
        const declares = targets.length === 1 ? 'declares no such field' : 'declare that field';
        findings.push({
          severity: 'warning',
          rule: HOOK_BODY_WRITE_UNKNOWN_FIELD,
          where,
          path,
          message:
            `body writes '${w.field}' to its input, but ${objDesc} ${declares}. The sandboxed script runs ` +
            `clean and the value is copied back onto the record payload — then the unknown column silently ` +
            `never lands in the stored record (#4271).`,
          hint: fixHint(w.field, unionCandidates(targetSets)),
        });
      } else {
        // ctx.api write → the named object.
        const known = objectFields!.get(w.object);
        if (!known) continue; // object declared by another package — cannot judge
        if (SYSTEM_FIELDS.has(w.field) || known.has(w.field)) continue;

        reported.add(dedupeKey);
        findings.push({
          severity: 'warning',
          rule: HOOK_BODY_WRITE_UNKNOWN_FIELD,
          where,
          path,
          message:
            `body calls ctx.api.object('${w.object}').${w.method ?? 'update'}(…) writing '${w.field}', but ` +
            `object '${w.object}' declares no such field. The call succeeds while the unknown column silently ` +
            `never lands (#4271).`,
          hint: fixHint(w.field, [...known]),
        });
      }
    }
  });

  return findings;
}

/** Every field name declared across the (all-known) target sets, deduplicated. */
function unionCandidates(targetSets: ReadonlyArray<Set<string> | undefined>): string[] {
  const out = new Set<string>();
  for (const s of targetSets) for (const f of s ?? []) out.add(f);
  return [...out];
}

/** Did-you-mean (declared + system columns as candidates) plus the fix. */
function fixHint(field: string, declared: string[]): string {
  const suggestion = formatSuggestion(findClosestMatches(field, [...declared, ...SYSTEM_FIELDS]));
  return (
    (suggestion ? `${suggestion} ` : '') +
    `Fix the field name, or declare '${field}' on the object. Only the literal write patterns in ` +
    `HOOK_BODY_WRITE_PATTERNS are checked — computed keys, spreads and aliased input are not — and this ` +
    `warning never blocks a build.`
  );
}
