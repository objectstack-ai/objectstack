// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Author-time check: an L2 (`language:'js'`) ACTION body that assigns to
// `ctx.record` (#4345).
//
// `ctx.record` is a read-only pre-fetched snapshot. `buildActionSandboxContext`
// hands the body a plain copy (`unwrapProxyToPlain`) and `boundActionHandler`
// returns only `result.value` — the hook path's `applyMutationsToInput`
// write-back has no action counterpart. So `ctx.record.stage = 'won'` mutates a
// copy that dies with the VM: the action returns success and the stored record
// is unchanged.
//
// ## Why this is a rule of its own, and not a case of #4271
//
// The #4271 family (`hook-body-write-unknown-field`, and its action sibling)
// catches "an UNKNOWN column silently never lands, while declared fields land
// normally". This is the opposite shape: EVERY write is dropped, a correctly
// spelled and fully declared field included. Reporting only the unknown half
// would imply the declared half persists — manufacturing exactly the false
// completion this family exists to kill — which is why the unknown-field rule
// deliberately excludes `ctx.record` and points here instead.
//
// So this rule never consults the object's declared fields: field existence is
// irrelevant to whether the write lands, and a did-you-mean on the field name
// would aim the author at the wrong bug.
//
// ## Scope
//
//   • ACTION bodies only. A hook's `ctx` carries no `record` at all, and a
//     `target`-bound action (a registered bundle function, not a sandboxed
//     body) gets the host's real context — neither goes through this seam.
//   • The literal patterns in {@link ACTION_RECORD_WRITE_PATTERNS}, reconciled
//     against the extractor by test, so a pattern cannot be declared-but-
//     unverified (#3528's death).
//   • Everything statically opaque — computed keys (`ctx.record[k] = …`),
//     aliases (`const r = ctx.record; r.x = 1`), spreads — is skipped
//     SILENTLY, the same asymmetry the sibling rules take: a false positive
//     kills an advisory lint, a miss only leaves the gap open. Those cases are
//     not lost, though: the runtime's write-recorder proxy (#4345,
//     `quickjs-runner.ts`) catches every one of them at invocation time and
//     logs the same remedy. This rule is the shift-LEFT of that signal, not its
//     only copy.
//
// Severity: always `warning`. Unlike a `readonly` flow write — a certain no-op,
// which `validateReadonlyFlowWrites` gates on — an assignment to `ctx.record`
// may be a deliberate use of the snapshot as local scratch
// (`ctx.record.total = a + b; return { total: ctx.record.total }`), which is
// NOT a no-op and which no analysis short of data-flow can tell apart from an
// intended persist. Gating would block correct builds; the warning states what
// is true of both readings — the write does not leave the sandbox.
//
// Wired via REFERENCE_INTEGRITY_RULES so `os validate`, `os lint` and
// `os compile` all run it (see that module for the membership note).

import { createRequire } from 'node:module';
import type ts from 'typescript';

// The TypeScript compiler must NOT be imported at module top level — ~9 MB of
// CJS on the kernel boot path, while this gate only parses when an action
// actually carries an L2 JS body that mentions `ctx.record`. Same lazy-load
// contract as validate-hook-body-writes.ts / validate-react-page-props.ts
// (which see for the history); guarded by lazy-deps.test.ts.
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
      `@objectstack/lint: checking an L2 (language:'js') action body requires the "typescript" package, which could ` +
        `not be loaded (${err instanceof Error ? err.message : String(err)}). It is a declared dependency of ` +
        `@objectstack/lint — if this deployment prunes packages, keep "typescript" in the image; it is only loaded ` +
        `when an action with a JS body is validated.`,
    );
  }
  return cachedTs;
}

export type ActionRecordWriteSeverity = 'warning';

export interface ActionRecordWriteFinding {
  /** Advisory-only by contract — the type says so. */
  severity: ActionRecordWriteSeverity;
  rule: string;
  /** Human-readable location, e.g. `action "close_deal" › body`. */
  where: string;
  /** Config path, e.g. `actions[0].body.source`. */
  path: string;
  message: string;
  hint: string;
}

/** Rule id (registry entry). */
export const ACTION_BODY_RECORD_WRITE_DISCARDED = 'action-body-record-write-discarded';

// ─── The write-pattern ledger ───────────────────────────────────────────────
//
// Every syntactic shape the extractor recognizes, declared as data. The
// reconciliation test runs the extractor over each entry's example and asserts
// it yields EXACTLY the declared fields, tagged with this entry's id — so the
// answer to "which writes does this rule see?" is this list, not the
// extractor's code.

/** One syntactic write shape the extractor recognizes. */
export interface ActionRecordWritePattern {
  /** Stable pattern id, carried on every extracted write. */
  readonly id: string;
  /** Author-facing syntax summary (for docs/diagnostics, not matching). */
  readonly syntax: string;
  /** Reconciliation fixture: extracting `source` must yield exactly `fields`. */
  readonly example: {
    readonly source: string;
    readonly fields: readonly string[];
  };
}

export const ACTION_RECORD_WRITE_PATTERNS: readonly ActionRecordWritePattern[] = [
  {
    id: 'record-property-assign',
    syntax: "ctx.record.<field> = … | ctx.record['<field>'] ⟨op⟩= …",
    example: {
      // Compound (`+=`) and logical (`??=`) assignment write their LHS exactly
      // as `=` does — the example pins the whole operator range.
      source: "ctx.record.stage = 'won'; ctx.record['owner'] ??= 'u1'; ctx.record.amount += 1;",
      fields: ['stage', 'owner', 'amount'],
    },
  },
  {
    id: 'record-object-assign',
    syntax: 'Object.assign(ctx.record, { <field>: … })',
    example: {
      source: "Object.assign(ctx.record, { stage: 'won', 'amount': 1, owner });",
      fields: ['stage', 'amount', 'owner'],
    },
  },
  {
    id: 'record-property-delete',
    syntax: "delete ctx.record.<field> | delete ctx.record['<field>']",
    example: {
      source: "delete ctx.record.stage; delete ctx.record['owner'];",
      fields: ['stage', 'owner'],
    },
  },
];

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

/** One statically-extracted `ctx.record` write found in an L2 action body. */
export interface ExtractedActionRecordWrite {
  /** Which {@link ACTION_RECORD_WRITE_PATTERNS} entry matched. */
  patternId: string;
  field: string;
}

/**
 * Extract every literal `ctx.record` write an L2 action body performs.
 * Parse-only (the source is never executed), error-tolerant (a body with syntax
 * errors simply yields fewer matches), and lazy: the TypeScript compiler is not
 * loaded when no pattern can possibly match.
 */
export function extractActionRecordWrites(source: string): ExtractedActionRecordWrite[] {
  // Every recognizable pattern is rooted at `ctx.record`, so a body missing
  // either identifier cannot match and must not pay the compiler load.
  if (!/\bctx\b/.test(source) || !/\brecord\b/.test(source)) return [];

  const tsc = loadTypeScript();
  // The runtime wraps an action body as `new AsyncFunction('input', 'ctx', source)`
  // — a FUNCTION BODY, not a module. Parse it in the same context so bare
  // `return` / `await` mean what they mean at run time.
  const sf = tsc.createSourceFile(
    'action-body.ts',
    `async function __body(input, ctx) {\n${source}\n}`,
    tsc.ScriptTarget.Latest,
    /* setParentNodes */ false,
    tsc.ScriptKind.TS,
  );

  const writes: ExtractedActionRecordWrite[] = [];

  /** `node` is exactly `ctx.record`. */
  const isCtxRecord = (node: ts.Node): boolean =>
    tsc.isPropertyAccessExpression(node) &&
    tsc.isIdentifier(node.expression) &&
    node.expression.text === 'ctx' &&
    node.name.text === 'record';

  /** The literal field name of an expression rooted at `ctx.record`, if any. */
  const fieldOfRecordAccess = (expr: ts.Expression): string | undefined => {
    if (tsc.isPropertyAccessExpression(expr) && tsc.isIdentifier(expr.name) && isCtxRecord(expr.expression)) {
      return expr.name.text;
    }
    if (tsc.isElementAccessExpression(expr) && isCtxRecord(expr.expression)) {
      const arg = expr.argumentExpression;
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
    // Pattern: record-property-assign. FirstAssignment..LastAssignment spans
    // `=` and every compound/logical assignment operator (`+=`, `??=`, …).
    if (
      tsc.isBinaryExpression(node) &&
      node.operatorToken.kind >= tsc.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= tsc.SyntaxKind.LastAssignment
    ) {
      const field = fieldOfRecordAccess(node.left);
      if (field !== undefined) writes.push({ patternId: 'record-property-assign', field });
    }

    // Pattern: record-property-delete.
    if (tsc.isDeleteExpression(node)) {
      const field = fieldOfRecordAccess(node.expression);
      if (field !== undefined) writes.push({ patternId: 'record-property-delete', field });
    }

    // Pattern: record-object-assign — Object.assign(ctx.record, {…}).
    if (tsc.isCallExpression(node)) {
      const callee = node.expression;
      if (
        tsc.isPropertyAccessExpression(callee) &&
        tsc.isIdentifier(callee.expression) &&
        callee.expression.text === 'Object' &&
        callee.name.text === 'assign' &&
        node.arguments.length >= 2 &&
        isCtxRecord(node.arguments[0])
      ) {
        // Later sources overwrite earlier ones but never remove a key, so every
        // literal key is genuinely written regardless of the non-literal
        // arguments around it.
        for (const arg of node.arguments.slice(1)) {
          for (const field of literalObjectKeys(arg)) {
            writes.push({ patternId: 'record-object-assign', field });
          }
        }
      }
    }

    tsc.forEachChild(node, visit);
  };
  visit(sf);
  return writes;
}

/** An action reachable from the stack, with where it was found. */
interface WalkedAction {
  action: AnyRec;
  /** The object the action binds to, when statically known. */
  object?: string;
  path: string;
}

/**
 * Every action in the stack: top-level first, then object-embedded.
 *
 * Order matters. `defineStack`'s `mergeObjectActions` appends a top-level
 * action carrying `objectName` into that object's `actions` while KEEPING the
 * top-level entry, so one authored action is reachable twice. After a Zod parse
 * the two copies are structurally equal but not reference-identical, which is
 * why the caller dedupes by VALUE, not identity — and why walking top-level
 * first makes the surviving report land where the author actually wrote it.
 */
function walkActions(stack: AnyRec): WalkedAction[] {
  const out: WalkedAction[] = [];
  asArray(stack.actions).forEach((action, i) => {
    out.push({
      action,
      object: typeof action.objectName === 'string' ? action.objectName : undefined,
      path: `actions[${i}]`,
    });
  });
  asArray(stack.objects).forEach((obj, oi) => {
    const objectName = typeof obj.name === 'string' ? obj.name : undefined;
    asArray(obj.actions).forEach((action, ai) => {
      out.push({
        action,
        object: typeof action.objectName === 'string' ? action.objectName : objectName,
        path: `objects[${oi}].actions[${ai}]`,
      });
    });
  });
  return out;
}

/**
 * Flag `ctx.record` writes in L2 action bodies. Pure `(stack) => Finding[]`
 * (ADR-0019); safe on pre- or post-parse stacks.
 */
export function validateActionRecordWrites(stack: AnyRec): ActionRecordWriteFinding[] {
  const findings: ActionRecordWriteFinding[] = [];
  const seen = new Set<string>();

  for (const { action, object, path } of walkActions(stack)) {
    const body = action.body;
    if (!isRec(body) || body.language !== 'js') continue;
    const source = body.source;
    if (typeof source !== 'string' || source.trim() === '') continue;

    // Value-identity, not reference-identity: see walkActions.
    const name = typeof action.name === 'string' && action.name ? action.name : undefined;
    const dedupeKey = `${object ?? ''} ${name ?? path} ${source}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const writes = extractActionRecordWrites(source);
    if (writes.length === 0) continue;

    const fields: string[] = [];
    for (const w of writes) if (!fields.includes(w.field)) fields.push(w.field);

    const quoted = fields.map((f) => `'${f}'`).join(', ');
    const plural = fields.length > 1 ? 's' : '';
    findings.push({
      severity: 'warning',
      rule: ACTION_BODY_RECORD_WRITE_DISCARDED,
      where: `action "${name ?? path}" › body`,
      path: `${path}.body.source`,
      message:
        `body writes ${fields.length} field${plural} to ctx.record (${quoted}), but ctx.record is a READ-ONLY ` +
        `pre-fetched snapshot: the action path returns the script's value and never writes the record back, so ` +
        `the write${plural} ${fields.length > 1 ? 'are' : 'is'} discarded — whether or not the object declares ` +
        `${fields.length > 1 ? 'those fields' : 'that field'}. The action still reports success and the stored ` +
        `record is unchanged (#4345).`,
      hint:
        `To persist, write through the repository: ` +
        `await ctx.api.object('${object ?? '<object>'}').update({ id: ctx.recordId, ${fields[0]}: … }) — and declare ` +
        `the 'api.write' capability on the body. To compute a value for the RESPONSE instead, return it ` +
        `(\`return { ${fields[0]}: … }\`) rather than assigning to ctx.record. Only the literal patterns in ` +
        `ACTION_RECORD_WRITE_PATTERNS are checked — computed keys and aliased references are not, and the runtime ` +
        `reports those at invocation time — and this warning never blocks a build.`,
    });
  }

  return findings;
}
