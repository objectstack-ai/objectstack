#!/usr/bin/env node
/**
 * An action renderer must forward every authored key the runtime will read —
 * and must write those keys somewhere the compiler will still check them.
 *
 * Two halves, two different failures. The first is a key DROPPED from a forward
 * whitelist (below). The second is a key INVENTED at a forward site and absorbed
 * in silence, because the literal it was written into is one TypeScript does not
 * excess-property check — objectui#4281, see section 4. A surface can pass the
 * first and fail the second: two of the four action renderers did.
 *
 * The failure class (objectui#4050, carried from objectstack#6975): each action
 * renderer hands the `ActionRunner` an explicit key WHITELIST rather than the
 * action itself. That is deliberate — a key no renderer honours must not look
 * wired — but its cost is that a NEW key stays invisible until five separate
 * lists are edited, and **nothing fails while they are not**. The key parses,
 * publishes, and reads as honoured:
 *
 *   bodyExtra    objectstack#6837, objectui PR #3924 — payload dropped one hop
 *                before the runner; the action POSTed nothing.
 *   bodyShape    objectstack#6938, objectui PR #3932 — a declared
 *                `{ wrap: 'data' }` sent a flat body.
 *   resultDialog objectui#3646 — the one-shot reveal (2FA code, fresh OAuth
 *                secret) fell back to a toast and the value was lost.
 *   openIn / locations / undoable — each carries an in-comment note at its
 *                forward site recording its own instance.
 *   label / description  objectui#4192 — `action:menu`'s param dialog titled
 *                itself "Action parameters" instead of naming the action. THIS
 *                gate found the same omission on `action:icon` and
 *                `action:group`, which #4192 had not measured.
 *
 * Six of the seven were found by a human reading the lists side by side. This
 * is the gate that reads them instead (maintainer ruling, objectui#4050,
 * 2026-08-10: "Diff each action renderer's forward whitelist against the keys
 * the runtime actually reads … A new spec action key missing from a whitelist
 * must be a red check, not a silent drop; extraction failure is red, never a
 * silent pass").
 *
 * ── Why this is derivable, when objectstack#6975 argued it was not ───────────
 * #6975 stalled on one half of the diff: "the keys the runtime reads" is not
 * mechanically derivable, because `git grep 'action\.'` over the runner and the
 * console handlers returns `action.name` / `action.api` / `action.method` hits
 * with no way to separate "body-path key a renderer must forward" from
 * "mechanic the runner resolves itself". That is true OF GREP. Two changes make
 * it derivable:
 *
 *   1. Read the sites with the compiler API, not with grep — property accesses
 *      and destructurings bound to the ActionDef parameter, per file. `grep`
 *      cannot tell `action.locations` (read off the AUTHORED list, to decide
 *      which actions render) from `action.target` (read off the FORWARDED def,
 *      at execute time); binding-scoped AST extraction can, because they are
 *      different bindings in different functions.
 *   2. INTERSECT that with what the surface may be AUTHORED with. A key the
 *      runtime reads but no author can write is a runner mechanic (`api`,
 *      `chain`, `actionType`, `navigate`) and is nobody's to forward. A key the
 *      author can write AND the runtime reads is exactly the forwardable set.
 *
 *   owed(surface) = authorable(surface) ∩ runtime-read − retired
 *
 * Both inputs come from their real declarations, so neither can be a stale hand
 * copy: `authorable` from `@objectstack/spec`'s own zod shapes plus (for
 * declared surfaces) `@object-ui/types`' renderer VIEW of an action, and
 * `runtime-read` from the consumers' ASTs.
 *
 * The surface-class split #6975 flagged — `element:button` deliberately omits
 * `bodyShape` because its contract is spec's `InlineActionSchema` pick list,
 * not `ActionSchema` — is therefore DERIVED here rather than registered: an
 * inline surface gets an inline owed set, so it is green without an exemption.
 * That is one fewer hand-maintained list than #6975 feared this gate would need.
 *
 * ── The justified-omission registry ──────────────────────────────────────────
 * What is left over is real: some omissions are load-bearing and CORRECT, and
 * #6975's objection to a mechanical diff was precisely that it would report
 * them. Two things cannot be read off an AST:
 *
 *   - REACHABILITY UNDER A GUARD. `recordIdParam`, `recordIdField` and
 *     `undoable` are each read only inside `if (rowRecord && …)`, and
 *     `rowRecord` is `params._rowRecord` — written ONLY by the spread-based
 *     hosts, never by these five renderers. The keys are unreachable here, not
 *     dropped.
 *   - CONSUMPTION AT THE RENDERER. `disabled` is evaluated by each renderer to
 *     grey its own control, and `onClick` is invoked by each declared renderer
 *     directly.
 *     A key the renderer itself honours is not one it owes the runner.
 *
 * So {@link JUSTIFIED} is the declared table for those, one entry per
 * (surface, key), each carrying the evidence that made the call — the same
 * governance as `check-spec-symbol-derivation.mjs`'s ALLOW: declared, reasoned,
 * and RATCHETED. An entry that excuses nothing (the key became owed-and-
 * forwarded, or stopped being owed) fails this guard, so the table cannot
 * outlive the code it excuses — which is the answer to #6975's "the registry is
 * itself the drift-prone list, one level up".
 *
 * {@link KNOWN_GAPS} is the other half, and the distinction matters: a
 * JUSTIFIED entry says "correctly omitted", a KNOWN_GAPS entry says "really
 * dropped, filed, not fixed here". Same ratchet, same shrink-only rule as
 * `check-spec-symbol-derivation.mjs`'s DEBT map, and for the same reason — this
 * gate exists to stop the BLEEDING (a new key missing from a whitelist fails on
 * the PR that adds it), not to retro-fix every pre-existing drop at once.
 *
 * ── Direction ────────────────────────────────────────────────────────────────
 * One-way, deliberately: `owed − forwarded − excused = ∅`. Forwarding a key
 * nothing reads is not an error here. It is harmless at runtime (the runner
 * ignores it), and the opposite rule would fail every renderer that forwards a
 * key defensively — `locations`, for one, which is read only off the AUTHORED
 * action by the hosts that decide placement, never off the forwarded def.
 *
 * ── Shape ────────────────────────────────────────────────────────────────────
 * Exported pure functions over an injectable `root`, with the CLI half behind
 * `invokedDirectly` — the same shape as `check-control-bytes.mjs` and
 * `check-changeset-presence.mjs`, and for the same reason: a gate whose failure
 * paths nothing exercises is the objectui#4690 anti-pattern one level up. Every
 * red below is driven from a synthetic repo in
 * `scripts/__tests__/check-action-forward-parity.test.ts`.
 *
 * Extraction failures THROW {@link ExtractionError} rather than returning a
 * verdict: a gate that cannot read its inputs has no verdict to give, and
 * returning "no errors" there would be the silent pass the ruling forbids.
 *
 * Run:  node scripts/check-action-forward-parity.mjs
 * Exit: 0 = every surface forwards what it owes, into a literal the compiler
 *       checks; 1 = a key is dropped, a forward literal is unchecked, an entry
 *       is stale, or extraction failed.
 */

import ts from "typescript";
import { createRequire } from "module";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { isEntrypoint } from "./invoked-as.mjs";

/**
 * The wrapper-key vocabulary, shared with the TypeScript readers that walk the
 * same Zod internals (objectui#6923, ruled 2026-08-31 — objectui#5872 class (3)).
 *
 * A bare-node gate cannot import `@object-ui/test-support` itself: that entry is
 * TypeScript source with no build artefact. `/zod-wrapper-keys` is the subpath
 * the ruling gave the DATA — build-free JSON — so both language sides read the
 * same bytes. The WALK stays local on purpose: sharing a FUNCTION across this
 * boundary is explicitly outside that ruling.
 *
 * `createRequire` rather than `import ... with { type: "json" }`, and the
 * difference is load-bearing: this module is imported BOTH by `node` (the gate
 * run) and by Vite's SSR transform (its pin tests in `scripts/__tests__/`).
 * Measured — under the SSR transform the attributed JSON import yields no
 * default export, and the walk fails with "__vite_ssr_import_N__.default is not
 * iterable" instead of reading the list. `createRequire` is the same idiom
 * `loadSpecSchemas` below already uses, and behaves identically in both.
 */
const ZOD_WRAPPER_KEYS = createRequire(import.meta.url)(
  "@object-ui/test-support/zod-wrapper-keys"
);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** A gate that cannot read its inputs. Never a pass — see the header. */
export class ExtractionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExtractionError";
  }
}

const fail = (message) => {
  throw new ExtractionError(message);
};

const readFile = (root, rel) => readFileSync(resolve(root, rel), "utf8");
const parse = (root, rel) =>
  ts.createSourceFile(rel, readFile(root, rel), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// ── The surfaces ─────────────────────────────────────────────────────────────
// Every renderer that composes an explicit ActionDef payload and hands it to
// `execute(...)`. `contract` picks the authorable half of the owed set:
//
//   declared — the renderer receives a full action (spec `ActionSchema`, seen
//              through `@object-ui/types`' renderer VIEW of it).
//   inline   — the renderer receives spec's `InlineActionSchema` pick list, a
//              deliberately narrower vocabulary (objectstack#6837's PR pinned
//              this: `element:button`'s list mirrors that pick list field for
//              field).
//
// Hosts that spread the whole action (`{...action}`) are NOT surfaces: they
// cannot drop a key by construction, which is the entire failure being gated.
// `DeclaredActionsBar`, `RelatedRecordActionsBridge`, `ObjectGrid` and
// `page:header`'s `dispatchHeaderAction` are all that shape.
export const SURFACES = [
  { id: "action:button", contract: "declared", file: "packages/components/src/renderers/action/action-button.tsx" },
  { id: "action:icon", contract: "declared", file: "packages/components/src/renderers/action/action-icon.tsx" },
  { id: "action:group", contract: "declared", file: "packages/components/src/renderers/action/action-group.tsx" },
  { id: "action:menu", contract: "declared", file: "packages/components/src/renderers/action/action-menu.tsx" },
  { id: "element:button", contract: "inline", file: "packages/components/src/renderers/basic/elements.tsx" },
];

// ── The runtime consumers ────────────────────────────────────────────────────
// Where a forwarded ActionDef is actually read. `binding` is the parameter the
// def arrives as; reads are collected for that identifier only, which is what
// keeps `objectDef.actions.filter(a => a.locations…)` — a read off the AUTHORED
// list, in the same files — out of the set.
//
// A read that moves BEHIND A HELPER moves out of this extractor's sight — the
// call site passes the whole def (`resolveRecordIdParamSeed(action, rowRecord)`)
// and no longer names the key, so the key silently leaves the owed set and the
// entries excusing it go stale. That is a re-point, not a deletion: the helper is
// where the forwarded def is read now, so it is listed here (objectstack#8018).
// The tell that this is the right direction: deleting the stale entries instead
// would have recorded "no surface owes `recordIdField`" while the runtime still
// reads it off every forwarded def it is handed.
export const RUNTIME_CONSUMERS = [
  { file: "packages/core/src/actions/ActionRunner.ts", binding: "action" },
  { file: "packages/core/src/actions/recordIdParam.ts", binding: "action" },
  { file: "packages/app-shell/src/hooks/useConsoleActionRuntime.tsx", binding: "action" },
  { file: "packages/app-shell/src/views/RecordDetailView.tsx", binding: "action" },
];

// ── Justified omissions ──────────────────────────────────────────────────────
// Key format: "<surface>:<key>". Every entry states WHY the omission is correct
// and cites the evidence, because an entry without one is indistinguishable
// from the drift this gate exists to catch. Ratcheted: an entry that no longer
// excuses a real omission fails below.
export const JUSTIFIED = {
  // ── Unreachable: read only under `rowRecord` ────────────────────────────────
  // `rowRecord` is `params._rowRecord`, and the ONLY writers are the four
  // spread-based hosts — DeclaredActionsBar.tsx:215,
  // RelatedRecordActionsBridge.tsx:164, ObjectGrid.tsx:1721 and :2034, and
  // page:header's dispatchHeaderAction (containers.tsx:1287-1289). None of them
  // dispatch THROUGH these renderers; they compose their own payload and call
  // `execute` directly. DeclaredActionsBar.tsx:100 says so in prose: it "injects
  // the record under `params._rowRecord` — which `action:button` does NOT do".
  //
  // These renderers forward `params: schema.params`, i.e. the AUTHORED params,
  // and `_rowRecord` is a host stash — `isAuthoredParamKey` excludes it by its
  // `_` prefix (packages/core/src/actions/actionKeys.ts:326-327). So the guard
  // cannot hold on this path and the key is unreachable, not dropped.
  //
  // One exception since objectui#11168 (ruling B on objectui#11754):
  // `action:button` itself writes the stash, for an `undoable`
  // `operation: 'update'` of the record in scope only. That action dispatches
  // to the `script` route, never to the console `api` handler that seeds
  // `recordIdParam`, so `action:button:recordIdParam` below stays unreachable;
  // `undoable` and `recordIdField` are forwarded by `action:button` and need no
  // entry for it.
  ...Object.fromEntries(
    [
      ["recordIdParam", "action:button", "action:icon", "action:group", "action:menu"],
      ["recordIdField", "action:icon", "action:group", "action:menu"],
      ["undoable", "action:icon", "action:group", "action:menu"],
    ].flatMap(([key, ...surfaces]) =>
      surfaces.map((surface) => [
        `${surface}:${key}`,
        {
          reason:
            `Unreachable on this surface, not dropped. \`${key}\` is read only under a ` +
            "`rowRecord` guard — useConsoleActionRuntime.tsx seeds `recordIdParam` from the " +
            "row (`resolveRecordIdParamSeed(action, rowRecord)`, which is where " +
            "`recordIdField` is read since objectstack#8018), and reads " +
            "`action.undoable && obj && recId && rowRecord && …` — and `rowRecord` is " +
            "`params._rowRecord`, written by the spread-based hosts listed above, none of " +
            "which dispatch through this renderer, and by `action:button` for an `undoable` " +
            "`operation: 'update'` alone (objectui#11168), a path that never reaches the " +
            "console `api` handler. objectstack#6938 made the same " +
            "reachability call for `recordIdParam`; this gate's own measurement extended it " +
            "to the two siblings behind the same guard (objectui#4192 had read the omission " +
            "as a live Undo loss — it is not on these surfaces, and `action:button` forwards " +
            "both).",
          issue: 4192,
        },
      ])
    )
  ),

  // ── Consumed at the renderer ───────────────────────────────────────────────
  ...Object.fromEntries(
    ["action:button", "action:icon", "action:group", "action:menu"].map((surface) => [
      `${surface}:disabled`,
      {
        reason:
          "Consumed HERE, not owed to the runner. Every one of these renderers evaluates " +
          "`disabled` itself (through `hasDeclaredVisibilityGate` + `useCondition`) and greys " +
          "its own control, so the click the runner's own gate would refuse " +
          "(ActionRunner.ts:774) cannot be made in the first place. Forwarding it would put " +
          "the same predicate through a second evaluator on a path that is already closed " +
          "(objectui#3842 ruling on the declared-gate definition, applied by #3849).",
        issue: 4050,
      },
    ])
  ),
  ...Object.fromEntries(
    ["action:button", "action:icon", "action:group", "action:menu"].map((surface) => [
      `${surface}:onClick`,
      {
        reason:
          "Consumed HERE. The surface's execute path opens with the `UI-local escape hatch` " +
          "branch — `typeof ….onClick === 'function'` → call it and return before reaching " +
          "`execute` — the documented escape hatch that bypasses the ActionEngine and takes " +
          "precedence over `type` / `target`. Forwarding it could not honour that precedence: " +
          "the runner reads `onClick` only as a last fallback, after a registered handler or " +
          "builtin executor for the declared type has run. `action:menu` carried the branch " +
          "first (recorded here by objectui#4050); objectui#4202 gave it to the other three, " +
          "where a code-composed `onClick` had been silently inert.",
        issue: 4202,
      },
    ])
  ),

  // ── Read off the declaration, never off the node ───────────────────────────
  ...Object.fromEntries(
    ["action:button", "action:icon", "action:group", "action:menu"].map((surface) => [
      `${surface}:patch`,
      {
        reason:
          "Correctly omitted (objectui#13022). The platform action route writes the `patch` of the " +
          "DECLARATION the action's `name` names, never a node's own, and @objectstack/spec 18 " +
          "retires a page action row's `patch` on these four surfaces. The runner reads that " +
          "declaration by name from the `objectActions` its host publishes " +
          "(`declaredUpdatePatch` in ActionRunner.ts), which also covers a declaration `action:bar` " +
          "draws through these renderers; it reads `action.patch` only off a def that IS the " +
          "declaration, which the spread-based hosts dispatch whole. The request carries no " +
          "`patch` since objectui#12941, so the omission moves no request byte.",
        issue: 13022,
      },
    ])
  ),

  // ── Read only to improve a diagnostic ──────────────────────────────────────
  ...Object.fromEntries(
    ["action:button", "action:icon", "action:group", "action:menu"].map((surface) => [
      `${surface}:body`,
      {
        reason:
          "Forwarding it could not change an outcome. The client runner cannot execute a spec " +
          "`body` AT ALL — it reads the key at ActionRunner.ts:1038 for one purpose, to replace " +
          '"no script provided" with the error naming the real cause ("Action body must be ' +
          'executed server-side … register a `script` handler"). So the omission costs a better ' +
          "message on an action that fails either way, never a behaviour. Forwarded by none of " +
          "the five surfaces; revisit if a client-side body executor ever lands.",
        issue: 4050,
      },
    ])
  ),
};

// ── Known gaps ───────────────────────────────────────────────────────────────
// Real drops, filed, deliberately NOT fixed here — same shrink-only governance
// as check-spec-symbol-derivation.mjs's DEBT map. Ratcheted below: a gap that
// has been closed must be deleted from this table, or it silently re-reserves
// the key for the next drop.
export const KNOWN_GAPS = {};

// ── Opaque spreads ───────────────────────────────────────────────────────────
// A spread this gate cannot resolve to a literal key set is EXTRACTION FAILURE
// and fails — a spread could carry anything, so treating it as empty would be
// the silent pass the ruling forbids. An entry here declares a spread whose
// source is known not to carry authored action keys.
export const OPAQUE_SPREADS = {
  "action:button:localContext": {
    reason:
      "The renderer's own `context` PROP (`{ schema, className, context: localContext, … }`), a " +
      "host-supplied runtime context bag spread last — not the authored action, so it cannot " +
      "carry an authored spec key and cannot satisfy or violate the owed-set diff.",
  },
  "action:icon:localContext": {
    reason: "Same `context` prop as action:button — see that entry.",
  },
};

// ── 1. authorable(surface) ───────────────────────────────────────────────────
/**
 * A spec zod schema's own shape keys.
 *
 * `ActionSchema` is exported as a lazy proxy that does not forward `.shape`, so
 * this walks zod internals to reach the object shape — the same walk
 * `packages/core/src/actions/__tests__/actionKeys.pin.test.ts` does, and
 * acceptable for the same reason: a gate pins a fact, shipped code must not.
 */
export function specShapeKeys(schema, label) {
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 8 || seen.has(node)) return null;
    seen.add(node);
    const s = node;
    const shapeOf = (v) => (v && typeof v === "object" ? Object.keys(v) : null);
    if (s.shape) return shapeOf(s.shape);
    const def = s._def ?? s.def;
    if (!def) return null;
    if (def.shape) return shapeOf(def.shape);
    for (const key of ZOD_WRAPPER_KEYS) {
      const found = def[key] ? walk(def[key], depth + 1) : null;
      if (found) return found;
    }
    return null;
  };
  const keys = walk(schema);
  if (!keys || keys.length === 0) {
    fail(
      `could not resolve \`${label}\`'s shape from @objectstack/spec/ui.\n` +
        "    The schema's internal representation changed. Fix the walk — falling back to a\n" +
        "    hardcoded key list would make this gate the stale copy it exists to prevent."
    );
  }
  return keys;
}

/** `{ declared, inline }` — the two authorable vocabularies, from the spec itself. */
export function loadSpecSchemas(require = createRequire(import.meta.url)) {
  let ui;
  try {
    ui = require("@objectstack/spec/ui");
  } catch {
    fail(
      "cannot resolve @objectstack/spec/ui — run `pnpm install` first.\n" +
        "    This gate reads the spec's own schemas; it has no hardcoded fallback by design."
    );
  }
  for (const name of ["ActionSchema", "InlineActionSchema"]) {
    if (!ui[name]) fail(`@objectstack/spec/ui no longer exports \`${name}\` — the owed set cannot be derived.`);
  }
  return {
    declared: specShapeKeys(ui.ActionSchema, "ActionSchema"),
    inline: specShapeKeys(ui.InlineActionSchema, "InlineActionSchema"),
  };
}

/**
 * `@object-ui/types`' renderer VIEW of an action — `interface UIActionSchema`.
 *
 * ⚠️ It was `interface ActionSchema` until objectui#6349, a second authority for
 * a name `packages/types/src/crud.ts` also declares. The declaration now spells
 * the name the package always PUBLISHED it under (`UIActionSchema`); the type
 * and the file are unchanged.
 *
 * Declared surfaces are typed against this, not against the spec schema
 * directly — it carries renderer-only fields the spec does not model
 * (`description`, `enabled`, `size`, …) while importing the spec-owned parts it
 * shares. Unioned into the declared owed set because a key an author can write
 * on THIS type and the runtime reads is just as forwardable as a spec one:
 * `description` is exactly that, and is half of objectui#4192.
 */
export const UI_ACTION_VIEW = "packages/types/src/ui-action.ts";
export function uiActionViewKeys(root, file = UI_ACTION_VIEW) {
  if (!existsSync(resolve(root, file))) {
    fail(`the renderer action view ${file} does not exist — re-point this gate at it.`);
  }
  const sf = parse(root, file);
  for (const stmt of sf.statements) {
    if (!ts.isInterfaceDeclaration(stmt) || stmt.name.text !== "UIActionSchema") continue;
    const keys = stmt.members
      .filter(ts.isPropertySignature)
      .map((m) => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : null))
      .filter((n) => n !== null);
    if (keys.length === 0) fail(`\`UIActionSchema\` in ${file} declares no properties — extraction failed.`);
    return keys;
  }
  fail(
    `\`interface UIActionSchema\` not found in ${file}.\n` +
      "    The renderer view moved or was renamed; re-point this gate at it."
  );
}

/**
 * Keys the spec keeps as TOMBSTONES so the parser can reject them by name.
 * Read off `RETIRED_ACTION_KEYS` rather than listed here — a second copy would
 * drift, and a tombstone is never owed (authoring it is a parse rejection).
 */
export const ACTION_KEYS_MODULE = "packages/core/src/actions/actionKeys.ts";
export function retiredKeys(root, file = ACTION_KEYS_MODULE) {
  if (!existsSync(resolve(root, file))) {
    fail(`${file} does not exist — without it a tombstoned key would be reported as owed.`);
  }
  const sf = parse(root, file);
  let found = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "RETIRED_ACTION_KEYS" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found = node.initializer.properties
        .map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null))
        .filter((n) => n !== null);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!found || found.length === 0) {
    fail(
      `\`RETIRED_ACTION_KEYS\` not found (or empty) in ${file}.\n` +
        "    Without it a tombstoned key would be reported as owed."
    );
  }
  return found;
}

// ── 2. runtime-read ──────────────────────────────────────────────────────────
/**
 * Property names read off the ActionDef binding in each consumer.
 *
 * Binding-scoped on purpose: `RecordDetailView.tsx` reads `a.locations` off the
 * AUTHORED action list a few hundred lines from where it reads `action.target`
 * off the forwarded def, and only the second is a forwarding contract. Grep
 * cannot tell them apart, which is what objectstack#6975 measured and called
 * non-derivable.
 */
export function runtimeReadKeys(root, consumers = RUNTIME_CONSUMERS) {
  const perFile = new Map();
  for (const consumer of consumers) {
    if (!existsSync(resolve(root, consumer.file))) {
      fail(
        `runtime consumer ${consumer.file} does not exist.\n` +
          "    A consumer that moved silently shrinks the owed set — re-point this gate at it."
      );
    }
    const sf = parse(root, consumer.file);
    const keys = new Set();
    const visit = (node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === consumer.binding
      ) {
        keys.add(node.name.text);
      }
      // `action!.label`
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isNonNullExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === consumer.binding
      ) {
        keys.add(node.name.text);
      }
      // `const { target, method } = action`
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        node.initializer.text === consumer.binding &&
        node.name &&
        ts.isObjectBindingPattern(node.name)
      ) {
        for (const el of node.name.elements) {
          const p = el.propertyName ?? el.name;
          if (ts.isIdentifier(p)) keys.add(p.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (keys.size === 0) {
      fail(
        `no reads of \`${consumer.binding}.*\` found in ${consumer.file}.\n` +
          "    Either the binding was renamed or the consumer changed shape. An empty read set\n" +
          "    would make every owed set empty and this whole gate vacuously green — which is\n" +
          "    the #4690 anti-pattern the ruling names."
      );
    }
    perFile.set(consumer.file, keys);
  }
  const union = new Set();
  for (const keys of perFile.values()) for (const k of keys) union.add(k);
  return { union, perFile };
}

// ── 3. forwarded(surface) ────────────────────────────────────────────────────
/**
 * The keys of the object literal a surface passes to `execute(...)`.
 *
 * Conditional payload fragments are resolved and UNIONED: `action:button` and
 * `element:button` both route params through
 * `const paramsPayload = Array.isArray(…) ? { actionParams } : { params }` and
 * spread it, so both branches count as forwarded — the runner accepts either as
 * the param-collection definition (ActionRunner.ts:816).
 */
export function forwardedKeys(root, surface, opaqueSpreads = OPAQUE_SPREADS) {
  if (!existsSync(resolve(root, surface.file))) {
    fail(`surface ${surface.id}: ${surface.file} does not exist — re-point this gate at the renderer.`);
  }
  const sf = parse(root, surface.file);

  // Local `const X = …` initializers, for resolving spreads.
  const locals = new Map();
  const collectLocals = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      locals.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectLocals);
  };
  collectLocals(sf);

  const unwrap = (node) => {
    let n = node;
    while (n && (ts.isAsExpression(n) || ts.isParenthesizedExpression(n) || ts.isSatisfiesExpression?.(n))) {
      n = n.expression;
    }
    return n;
  };

  const calls = [];
  const findCalls = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "execute") {
      const arg = node.arguments.length === 1 ? unwrap(node.arguments[0]) : null;
      if (arg && ts.isObjectLiteralExpression(arg)) calls.push(arg);
    }
    ts.forEachChild(node, findCalls);
  };
  findCalls(sf);

  if (calls.length !== 1) {
    fail(
      `surface ${surface.id}: expected exactly one \`execute({…})\` call in ${surface.file}, found ${calls.length}.\n` +
        "    Zero means the forward site moved or the payload stopped being a literal; more than one\n" +
        "    means the surface has split and each payload needs its own entry in SURFACES. Either way\n" +
        "    the forwarded key set cannot be read, and a gate that cannot read it must not pass."
    );
  }

  const keys = new Set();
  const absorb = (objLiteral, depth = 0) => {
    if (depth > 4) fail(`surface ${surface.id}: spread nesting too deep to resolve in ${surface.file}.`);
    for (const prop of objLiteral.properties) {
      if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
        const name = prop.name;
        if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) keys.add(name.text);
        continue;
      }
      if (ts.isSpreadAssignment(prop)) {
        const expr = unwrap(prop.expression);
        if (ts.isObjectLiteralExpression(expr)) {
          absorb(expr, depth + 1);
          continue;
        }
        if (ts.isIdentifier(expr)) {
          const declared = locals.get(expr.text);
          const resolved = declared ? unwrap(declared) : null;
          const branches = [];
          if (resolved && ts.isConditionalExpression(resolved)) {
            branches.push(unwrap(resolved.whenTrue), unwrap(resolved.whenFalse));
          } else if (resolved && ts.isObjectLiteralExpression(resolved)) {
            branches.push(resolved);
          }
          if (branches.length > 0 && branches.every((b) => ts.isObjectLiteralExpression(b))) {
            for (const b of branches) absorb(b, depth + 1);
            continue;
          }
          if (opaqueSpreads[`${surface.id}:${expr.text}`]) continue;
          fail(
            `surface ${surface.id}: cannot resolve the spread \`...${expr.text}\` in ${surface.file}.\n` +
              "    A spread may carry any key, so treating it as empty would be the silent pass the\n" +
              "    ruling forbids. Either it resolves to object literals this gate can read, or it\n" +
              `    needs an OPAQUE_SPREADS entry keyed "${surface.id}:${expr.text}" saying why its\n` +
              "    source cannot carry authored action keys."
          );
        }
        fail(
          `surface ${surface.id}: unreadable spread in the \`execute({…})\` payload in ${surface.file}.\n` +
            "    The forwarded key set cannot be determined; extraction failure is red by ruling."
        );
      }
    }
  };
  absorb(calls[0]);

  if (keys.size === 0) {
    fail(`surface ${surface.id}: extracted zero forwarded keys from ${surface.file} — extraction failed.`);
  }
  return keys;
}

// ── 4. Is the forward literal CHECKED at all? ────────────────────────────────
// Parity is only half the guarantee. The other half is objectui#4046, which
// closed `ActionDef` so that an invented or misspelled key at a forward site is
// a `TS2353` — the objectstack#2169 "Mark Done does nothing" shape, caught by
// the compiler instead of by a user. objectui#4281 measured that the guarantee
// held at only two of the four action renderers: `action:group` and
// `action:menu` rejected an invented key, `action:button` and `action:icon`
// absorbed it in silence, and NOTHING said so. A reader who knows `ActionDef` is
// closed would reasonably assume it is closed everywhere.
//
// The cause is not the type. TypeScript runs the excess-property ("freshness")
// check only on an object literal it can see whole, and several ordinary shapes
// switch it off. Measured on TypeScript 6.0.3, against `packages/components`
// itself and against a minimal reproduction (objectui#4281):
//
//   spread of an `any`-typed value    → check OFF   ← the live defect
//   `expr as T` (any T, incl. `any`)  → check OFF
//   a spread SOURCE's own keys        → check OFF   ← probe Q, the second hole
//   plain `const x = {…}`, unannotated→ check OFF
//   `const x: ActionDef = {…}`        → check ON
//   `{…} satisfies ActionDef`         → check ON
//   spread of `Record<string, any>`   → check ON
//   spread of a resolvable literal    → check ON
//
// The two broken renderers were the two that spread `localContext`, and that
// binding is `any` — `PropsWithoutRef` collapses a props interface carrying
// `[key: string]: any` to a pure index-signature type, so every destructured
// prop arrives as `any`. Note what this means: `...paramsPayload`, which
// objectui#4281's own table named as `action:button`'s culprit, is NOT one —
// narrowing only the `localContext` spread restored the check with
// `...paramsPayload` untouched.
//
// ── Why this gate states a STRICTER rule than TypeScript's ───────────────────
// Every row above turns on a TYPE, and this gate has no type checker: it parses
// source files, deliberately (see the header — a program-wide check here would
// be slower than the compile it duplicates). So the rule below is a SUFFICIENT
// STRUCTURAL CONDITION, not a restatement of the compiler's:
//
//   Every object literal contributing an explicit key to a forward payload must
//   be (a) contextually typed — the direct `execute(…)` argument, or a binding
//   annotated `ActionDef` / `satisfies ActionDef` — and (b) free of any spread
//   this gate cannot resolve to object literals.
//
// (b) is where it is stricter: a `Record<string, any>` spread would keep the
// check, but an AST cannot tell one from an `any`. The escape is not an
// exemption — it is the one-line fix the ruling prescribes, hoisting the
// explicit keys into an annotated binding, which is checked whatever the
// composed spreads turn out to be. That the rule is conservative in this exact
// direction is the point: a future renderer written in the broken shape goes red
// on the PR that adds it, which is what turns objectui#4046's guarantee from
// "true today, by luck" into "enforced".
//
// Resolvable spreads are transparent for (b) — but their SOURCE literal is
// judged by the same rule, because a spread source's keys are not checked
// through the spread either (probe Q above: `const p = cond ? {actionParams} :
// {zzBogus}` is absorbed whole; annotating `p` rejects it).
// EMPTY, and that is the finished state: every surface in SURFACES writes its
// forward payload into a literal the compiler excess-property checks.
//
// It held one entry, `element:button` — the last unchecked forward literal,
// whose payload closed with `as any`. objectui#4321 measured what that entry
// assumed could not be done: dropping the cast type-checks clean as-is, because
// every key the literal writes is already declared on `ActionDef`. The entry's
// stated reason ("the cast is load-bearing for more than the forward literal")
// was therefore wrong on the point that mattered — the `Record<string, any>`
// PROP type is a separate contract question, and the forward literal never
// needed the cast to compile. Removed by the ratchet immediately below, exactly
// as designed: the fix made the entry excuse nothing, and the entry failed.
//
// Adding one back is a real decision, not a formality — it re-opens a surface to
// the objectstack#2169 shape. Prefer the one-line fix the rule above prescribes.
export const UNCHECKED_FORWARDS = {};

/** Is this type node a reference to `ActionDef`? */
const isActionDefType = (typeNode) =>
  !!typeNode &&
  ts.isTypeReferenceNode(typeNode) &&
  ts.isIdentifier(typeNode.typeName) &&
  typeNode.typeName.text === "ActionDef";

/**
 * The forward literals a surface writes explicit keys into that TypeScript does
 * not excess-property check.
 *
 * Returns `[]` for a compliant surface. Each violation names the literal, the
 * keys riding in it unchecked, and which clause failed — a message a reader can
 * act on without knowing the freshness rules, since not knowing them is how
 * objectui#4281 happened.
 */
export function uncheckedForwardLiterals(root, surface, opaqueSpreads = OPAQUE_SPREADS) {
  if (!existsSync(resolve(root, surface.file))) {
    fail(`surface ${surface.id}: ${surface.file} does not exist — re-point this gate at the renderer.`);
  }
  const sf = parse(root, surface.file);

  // `name -> { init, type }`. The TYPE is what `forwardedKeys`' own local map
  // does not need and this one cannot work without.
  const locals = new Map();
  const collectLocals = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      locals.set(node.name.text, { init: node.initializer, type: node.type ?? null });
    }
    ts.forEachChild(node, collectLocals);
  };
  collectLocals(sf);

  /**
   * Strip parens, `as` assertions and `satisfies` down to the payload node,
   * recording which were crossed. `as` and `satisfies` are opposites here and
   * the difference is measured, not assumed: `{…} as ActionDef` turns the check
   * OFF (an assertion asks only for comparability), `{…} satisfies ActionDef`
   * leaves it ON.
   */
  const strip = (node) => {
    let n = node;
    let asserted = false;
    let satisfied = false;
    for (;;) {
      if (!n) break;
      if (ts.isParenthesizedExpression(n)) {
        n = n.expression;
        continue;
      }
      if (ts.isAsExpression(n) || (ts.isTypeAssertionExpression?.(n) ?? false)) {
        asserted = true;
        n = n.expression;
        continue;
      }
      if (ts.isSatisfiesExpression?.(n)) {
        satisfied = satisfied || isActionDefType(n.type);
        n = n.expression;
        continue;
      }
      break;
    }
    return { node: n, asserted, satisfied };
  };

  const explicitKeysOf = (obj) =>
    obj.properties
      .filter((p) => !ts.isSpreadAssignment(p))
      .map((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : "<computed>"));

  const violations = [];
  const seen = new Set();

  /**
   * @param obj     an object literal contributing to the payload
   * @param checked is it contextually typed AND not behind a type assertion?
   * @param origin  how a reader finds it
   */
  const walk = (obj, checked, origin, depth) => {
    if (depth > 4) fail(`surface ${surface.id}: spread nesting too deep to resolve in ${surface.file}.`);
    if (seen.has(obj)) return;
    seen.add(obj);

    const opaque = [];
    for (const prop of obj.properties) {
      if (!ts.isSpreadAssignment(prop)) continue;
      const spread = strip(prop.expression);

      // An inline `...{ … }` is part of THIS literal's check, either way.
      if (ts.isObjectLiteralExpression(spread.node) && !spread.asserted) {
        walk(spread.node, checked, origin, depth + 1);
        continue;
      }

      if (ts.isIdentifier(spread.node) && !spread.asserted) {
        const local = locals.get(spread.node.text);
        const resolved = local ? strip(local.init) : null;
        const branches = [];
        if (resolved && !resolved.asserted) {
          if (ts.isConditionalExpression(resolved.node)) {
            const whenTrue = strip(resolved.node.whenTrue);
            const whenFalse = strip(resolved.node.whenFalse);
            if (
              ts.isObjectLiteralExpression(whenTrue.node) &&
              ts.isObjectLiteralExpression(whenFalse.node) &&
              !whenTrue.asserted &&
              !whenFalse.asserted
            ) {
              branches.push(whenTrue.node, whenFalse.node);
            }
          } else if (ts.isObjectLiteralExpression(resolved.node)) {
            branches.push(resolved.node);
          }
        }
        if (branches.length > 0) {
          // Resolvable: transparent for THIS literal, judged on its own terms.
          const sourceChecked = isActionDefType(local.type) || resolved.satisfied;
          for (const branch of branches) {
            walk(branch, sourceChecked, `\`const ${spread.node.text}\` in ${surface.file}`, depth + 1);
          }
          continue;
        }
      }

      opaque.push(
        ts.isIdentifier(spread.node) && !spread.asserted ? `...${spread.node.text}` : "...<unresolvable expression>"
      );
    }

    const explicit = explicitKeysOf(obj);
    if (explicit.length === 0) return; // Only spreads — nothing for freshness to check.

    if (!checked) {
      violations.push({
        origin,
        cause: "it is neither the `execute({…})` argument nor a binding annotated `ActionDef`, or it sits behind an `as` assertion",
        keys: explicit,
      });
      return;
    }
    if (opaque.length > 0) {
      const declared = opaque.filter((s) => opaqueSpreads[`${surface.id}:${s.replace(/^\.\.\./, "")}`]);
      violations.push({
        origin,
        cause:
          `it spreads ${opaque.join(", ")}, which this gate cannot resolve to object literals` +
          (declared.length > 0
            ? " (an OPAQUE_SPREADS entry declares it for the PARITY diff — that says the spread carries no authored key, " +
              "which is a different question from whether it switches the compiler's check off; the measured live case, " +
              "`localContext`, is typed `any` and does)"
            : ""),
        keys: explicit,
      });
    }
  };

  const calls = [];
  const findCalls = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "execute") {
      if (node.arguments.length === 1) calls.push(node.arguments[0]);
    }
    ts.forEachChild(node, findCalls);
  };
  findCalls(sf);
  // Arity/shape failures are `forwardedKeys`' red to raise, with its own message.
  if (calls.length !== 1) return [];

  const argument = strip(calls[0]);
  if (!ts.isObjectLiteralExpression(argument.node)) return [];
  walk(argument.node, !argument.asserted, `the \`execute({…})\` payload in ${surface.file}`, 0);

  return violations;
}

// ── 5. Diff ──────────────────────────────────────────────────────────────────
/**
 * `owed − forwarded − excused = ∅`, per surface.
 *
 * Returns `{ errors, report, runtimeRead, perFile }`; `errors` is empty when
 * every surface is clean. Anything that stops the inputs being READABLE throws
 * {@link ExtractionError} instead — see the header.
 */
export function analyze(root = REPO_ROOT, options = {}) {
  const {
    surfaces = SURFACES,
    consumers = RUNTIME_CONSUMERS,
    justified = JUSTIFIED,
    knownGaps = KNOWN_GAPS,
    opaqueSpreads = OPAQUE_SPREADS,
    uncheckedForwards = UNCHECKED_FORWARDS,
    spec = null,
    uiActionView = UI_ACTION_VIEW,
    actionKeysModule = ACTION_KEYS_MODULE,
  } = options;

  const specKeys = spec ?? loadSpecSchemas();
  const uiView = uiActionViewKeys(root, uiActionView);
  const retired = new Set(retiredKeys(root, actionKeysModule));
  const { union: runtimeRead, perFile } = runtimeReadKeys(root, consumers);

  const authorable = {
    declared: new Set([...specKeys.declared, ...uiView]),
    inline: new Set(specKeys.inline),
  };

  const errors = [];
  const matchedJustified = new Set();
  const matchedGaps = new Set();
  const matchedUnchecked = new Set();
  const report = [];

  for (const surface of surfaces) {
    const vocabulary = authorable[surface.contract];
    if (!vocabulary) {
      fail(`surface ${surface.id}: unknown contract \`${surface.contract}\` — expected "declared" or "inline".`);
    }
    const owed = [...vocabulary].filter((k) => runtimeRead.has(k) && !retired.has(k)).sort();
    if (owed.length === 0) {
      fail(
        `surface ${surface.id}: owed set is empty.\n` +
          "    Nothing would ever be checked for it — a vacuously green surface is the #4690\n" +
          "    anti-pattern, so this is red."
      );
    }
    const forwarded = forwardedKeys(root, surface, opaqueSpreads);
    const dropped = owed.filter((k) => !forwarded.has(k));

    const unexcused = [];
    const excusedJustified = [];
    const excusedGaps = [];
    for (const key of dropped) {
      const entry = `${surface.id}:${key}`;
      if (justified[entry]) {
        matchedJustified.add(entry);
        excusedJustified.push(key);
      } else if (knownGaps[entry]) {
        matchedGaps.add(entry);
        excusedGaps.push(key);
      } else unexcused.push(key);
    }

    // Is the payload even excess-property checked? A surface can forward every
    // key it owes (green above) and still absorb an invented one in silence —
    // objectui#4281, where two of the four action renderers did exactly that.
    const unchecked = uncheckedForwardLiterals(root, surface, opaqueSpreads);
    if (unchecked.length > 0 && uncheckedForwards[surface.id]) {
      matchedUnchecked.add(surface.id);
    } else if (unchecked.length > 0) {
      for (const violation of unchecked) {
        errors.push(
          `${surface.id} writes ${violation.keys.length} forward key` +
            `${violation.keys.length === 1 ? "" : "s"} into a literal TypeScript does NOT excess-property check.\n` +
            `      Literal: ${violation.origin}\n` +
            `      Cause:   ${violation.cause}\n` +
            `      Keys:    \`${violation.keys.join("`, `")}\`\n` +
            "      So `ActionDef` being closed (objectui#4046) buys this surface nothing: an invented or\n" +
            "      misspelled key here compiles, publishes, and reaches a runner that silently does\n" +
            "      nothing — objectstack#2169's shape, which #4046 exists to make a compile error.\n" +
            "      FIX: hoist the explicit keys into an annotated binding and compose the spreads around\n" +
            "      it — `const forwarded: ActionDef = { … }; execute({ ...forwarded, ...rest })`. The\n" +
            "      annotation is what restores the check; hoisting alone does not (an unannotated\n" +
            "      `const base = {…}` is not checked either). See objectui#4281 for the measurements."
        );
      }
    }

    report.push({
      surface,
      owed,
      forwarded: [...forwarded].sort(),
      dropped,
      justified: excusedJustified,
      gaps: excusedGaps,
      unexcused,
      unchecked,
    });

    if (unexcused.length > 0) {
      errors.push(
        `${surface.id} (${surface.file}) does not forward ${unexcused.length} key` +
          `${unexcused.length === 1 ? "" : "s"} the runtime reads: \`${unexcused.join("`, `")}\`.\n` +
          `      Each is authorable on this surface's ${surface.contract === "inline" ? "`InlineActionSchema`" : "`ActionSchema`"} ` +
          "contract AND read off the forwarded def at execute time, so it is silently dropped\n" +
          "      one hop before the runner — the objectstack#6837 / #6938 shape. Add it to the\n" +
          "      `execute({…})` payload, or — if the omission is CORRECT — add a JUSTIFIED entry\n" +
          "      naming the guard that makes it unreachable or the renderer that consumes it,\n" +
          "      with the file:line evidence."
      );
    }
  }

  // Ratchet — an entry that excuses nothing must go, or it reserves the key for
  // a future drop under an exemption nobody re-examined.
  for (const [entry, meta] of Object.entries(justified)) {
    if (matchedJustified.has(entry)) continue;
    errors.push(
      `JUSTIFIED entry \`${entry}\` excuses nothing — the key is now forwarded, is no longer\n` +
        "      owed on that surface, or the surface is gone. Delete it: a stale exemption is how\n" +
        "      the next silent drop inherits a reason that was never about it.\n" +
        `      (reason on file: ${meta.reason.slice(0, 90)}…)`
    );
  }
  // ⛔ Neither stale-entry message below may put a GitHub closing keyword
  // (`close`/`fix`/`resolve`, any tense) immediately in front of the anchor it
  // interpolates. These messages exist to be QUOTED: the discipline around a
  // KNOWN_GAPS or UNCHECKED_FORWARDS entry is to take the INTERMEDIATE reading —
  // the gap fixed, the entry not yet deleted — and paste the gate's own output
  // into the pull request as proof the work landed. A keyword in front of the
  // number makes every such quote a card-ending trigger in the merge path, from
  // a body whose author was being careful. GitHub's parser does no sentence
  // parsing, so hedging the sentence around it buys nothing. Keep the
  // instruction, lose the keyword, and spell the anchor `objectui#` rather than
  // a bare `#` so the reference cannot match the closing grammar at all.
  //
  // ⚠️ Whether KNOWN_GAPS holds entries at a given moment is not a defence: the
  // first message below renders the moment any entry stops excusing anything —
  // which is exactly the workflow that produces the quote — so it is always one
  // entry away from being reachable. The landed precedent is the
  // rule-2 stale-entry message in scripts/check-spec-symbol-derivation.mjs and
  // the DEBT ratchet in scripts/check-lint-coverage.mjs. Pinned by
  // scripts/__tests__/check-action-forward-parity-closing-keyword.test.ts, which
  // RENDERS both messages through a seeded ledger rather than trusting this
  // comment or reading the template.
  for (const [entry, meta] of Object.entries(knownGaps)) {
    if (matchedGaps.has(entry)) continue;
    errors.push(
      `KNOWN_GAPS entry \`${entry}\` is no longer a gap — delete it (and objectui#${meta.issue} can be\n` +
        "      ended once its last entry is gone). Left in, it re-reserves the key for a future drop."
    );
  }
  for (const [surfaceId, meta] of Object.entries(uncheckedForwards)) {
    if (matchedUnchecked.has(surfaceId)) continue;
    errors.push(
      `UNCHECKED_FORWARDS entry \`${surfaceId}\` excuses nothing — the surface's forward literal is\n` +
        `      excess-property checked now, or the surface is gone. Delete it (and objectui#${meta.issue}\n` +
        "      can be ended once its last entry is gone): left in, it re-reserves the surface for a\n" +
        "      future unchecked literal under a reason nobody re-examined."
    );
  }
  for (const entry of Object.keys(opaqueSpreads)) {
    const surfaceId = entry.slice(0, entry.lastIndexOf(":"));
    const ident = entry.slice(entry.lastIndexOf(":") + 1);
    const surface = surfaces.find((s) => s.id === surfaceId);
    if (!surface || !readFile(root, surface.file).includes(`...${ident}`)) {
      errors.push(
        `OPAQUE_SPREADS entry \`${entry}\` matches no spread in the surface's file — delete it,\n` +
          "      so an unreadable spread cannot inherit an exemption written for a different one."
      );
    }
  }

  return { errors, report, runtimeRead, perFile, authorable };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  let result;
  try {
    result = analyze(REPO_ROOT);
  } catch (error) {
    if (!(error instanceof ExtractionError)) throw error;
    console.error(`❌  action forward parity: ${error.message}`);
    process.exit(1);
  }

  const { errors, report, runtimeRead, perFile } = result;

  if (errors.length === 0) {
    const gaps = Object.keys(KNOWN_GAPS).length;
    const justifiedCount = Object.keys(JUSTIFIED).length;
    const exempt = Object.keys(UNCHECKED_FORWARDS).length;
    console.log(
      `✅  action forward parity: ${SURFACES.length} surfaces checked against ${runtimeRead.size} runtime-read keys ` +
        `from ${perFile.size} consumers; ${justifiedCount} justified omission` +
        `${justifiedCount === 1 ? "" : "s"}, ${gaps} known gap${gaps === 1 ? "" : "s"}, ` +
        `${exempt} payload${exempt === 1 ? "" : "s"} exempt from the freshness rule.`
    );
    for (const r of report) {
      console.log(
        `    ${r.surface.id.padEnd(14)} owes ${String(r.owed.length).padStart(2)}, ` +
          `forwards ${String(r.forwarded.length).padStart(2)}, ` +
          `payload ${r.unchecked.length === 0 ? "excess-property CHECKED" : "unchecked (declared)"}`
      );
    }
    process.exit(0);
  }

  console.error("❌  an action renderer drops a key the runtime reads, or writes one into an unchecked literal:\n");
  for (const message of errors) console.error(`    • ${message}\n`);
  console.error(
    "Every instance of this class shipped green: the key parses, publishes, and reads as\n" +
      "honoured while the payload is dropped one hop before the runner. See\n" +
      "https://github.com/objectstack-ai/objectui/issues/4050 for the six that were found by\n" +
      "hand before this gate existed."
  );
  process.exit(1);
}
