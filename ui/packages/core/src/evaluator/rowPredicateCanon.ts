/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The row-predicate spelling CANON: on a runtime record surface the row is bound
 * as `record.*` and nothing else (objectui#5330, maintainer ruling 2026-08-20,
 * option B; Phase 2 executed by `83fe6e741`).
 *
 * ## The canon
 *
 * A row predicate — `visible` / `disabled` / `enabled` on an action renderer, a
 * row scope, a `record:alert`, a conditional-formatting `condition` — used to
 * bind the row THREE ways: canonical `record.status`, bare shorthand `status`,
 * and legacy `data.status` (objectui#4075 / PR #4079 bound all four action
 * renderers all three ways to restore consistency, deliberately without
 * deciding which of them was CONTRACT). The ruling decided it, in two phases:
 *
 * > **The canon is `record.*`.** Phase 1 (`d1ab06f0f`) declared it and warned
 * > once, in dev, on the two other spellings. Phase 2 (`83fe6e741`, ruled
 * > 2026-09-02 and amended 2026-09-05) retired them: the bare shorthand and
 * > `data.*` are no longer bound on runtime record surfaces, and the Phase-1
 * > warning went with them. No stored-metadata survey was run (「不考虑存量」);
 * > the Phase-1 warning period was the notice.
 *
 * ## What a retired spelling does now: it FAULTS, as it always did on the server
 *
 * The canon states the SERVER's accept set. Measured against
 * `@objectstack/formula@17.1.0` — the engine the server evaluates with, and the
 * one `fieldRules.ts` delegates to:
 *
 * | spelling | server runtime (`buildScope` + `celEngine`) | server authoring oracle |
 * |---|---|---|
 * | `record.status` | ✅ `{ ok: true, value: true }` | ✅ accepted |
 * | bare `status`   | ❌ `Unknown variable: status` | ❌ refused (`'status'`) |
 * | `data.status`   | ❌ `Unknown variable: data`   | ⚠️ silently accepted |
 *
 * `buildScope({ record })` mounts exactly `['record']`. Since Phase 2 the client
 * binds the same set (`listConditional.ts`' scope bag and `@object-ui/react`'s
 * `usePredicateRecordContext`), so both retired spellings fault on the client
 * with the server's verdict, and each surface applies its EXISTING fault policy:
 * fail-closed `visible` on the throwing `useCondition` legs, the caller's
 * `fallback` on `evalRowPredicate` / `partitionRowsByPredicate`, fail-soft on
 * the non-throwing `useCondition` legs. There is no runtime detector, no
 * "treat as absent" special case and no uniform override — a retired spelling
 * is not a recognised-and-rejected thing, it is an unknown variable like any
 * other, and the existing fault warnings are what name it.
 *
 * One consequence, stated so it is not read back as a bug: a host scope may
 * legitimately carry its OWN `data` (a rowless dialog's, or app-shell's ambient
 * `data: {}`), and it is left standing. `data.*` on a record surface then reads
 * the host's object rather than the row — which is exactly what "no longer bound
 * to the row" means, and, against an ambient `data: {}`, the constant-false
 * signature the Phase-1 warning text already described for the server.
 *
 * ## `data.*` is retired HERE, not everywhere — the canon is layer-scoped
 *
 * `data` is the CANONICAL root one layer over, in a metadata-editing form (the
 * row under edit): objectstack's `CANONICAL_ROOT_BY_LAYER` reads
 * `{ runtime: 'record', metadata: 'data' }` (ADR-0089 D3), and objectui's own
 * `app-shell` metadata-admin `SchemaForm` binds `{ data: row }` on purpose,
 * through its own evaluator (`views/metadata-admin/predicate.ts`) — never
 * through `evalRowPredicate` or `usePredicateRecordContext`. So `data.*` is not
 * retired platform-wide: it is a WRONG-LAYER spelling on a runtime record
 * surface, and that is the only thing the detector below reports.
 *
 * ## What is left in this module, and why
 *
 * {@link detectNonCanonicalRowSpelling} is the OFFLINE instrument: it classifies
 * an authored predicate's spelling against a row without evaluating it, so a
 * sweep over stored or in-repo metadata (the `702c48a62` corpus sweep's
 * recipe) can find the documents that still need rewriting. It is
 * exported for that purpose and nothing on the hot path calls it — the runtime
 * warning half Phase 1 built on it (`warnNonCanonicalRowSpelling`,
 * `resetRowPredicateCanonWarnings`) was removed with the bindings.
 *
 * ## Why the detection reuses the server's oracle instead of a regex
 *
 * `collectCelRootIdentifiers` and `firstUndeclaredReference` are
 * `@objectstack/formula` exports — the same two oracles objectstack's
 * `visibility-bare-identifier` gate uses. Reading roots off the canonical AST
 * rather than pattern-matching the source is what keeps this from inventing a
 * second dialect judgement client-side: a string this module cannot parse is
 * NOT this module's verdict to give (syntax belongs to the gates that own it),
 * and it stands down rather than guessing.
 */

import { collectCelRootIdentifiers, firstUndeclaredReference } from '@objectstack/formula';

/** The one canonical row-predicate root. */
export const ROW_PREDICATE_CANONICAL_ROOT = 'record';

/**
 * The metadata-editing-form root (ADR-0089 D3). Canonical on THAT layer, and a
 * wrong-layer paste on a runtime record surface — see the module note.
 */
const METADATA_LAYER_ROOT = 'data';

/** A non-canonical row-predicate spelling, and the edit that fixes it. */
export type NonCanonicalRowSpelling =
  | {
      /** Bare shorthand: `status == 'active'` — a field of THIS row, unrooted. */
      kind: 'bare-shorthand';
      /** The offending identifier (`status`). */
      identifier: string;
      /** What the author should write instead (`record.status`). */
      canonical: string;
    }
  | {
      /** Wrong-layer root: `data.status == 'active'` on a runtime record surface. */
      kind: 'metadata-layer-root';
      identifier: string;
      canonical: string;
    };

/**
 * Detect a non-canonical spelling in ONE row predicate, or `null` when the
 * predicate is already canonical (or is not this module's verdict to give).
 *
 * Deliberately conservative in both arms — every condition below can only
 * REMOVE a finding, never invent one, because a false finding sends an author
 * to rewrite a predicate that was correct:
 *
 * - **Unparseable source** → `null`. Syntax is another gate's verdict.
 * - **Bare shorthand** is reported only when the undeclared identifier is an own
 *   key of THIS row. That is what makes it unambiguously the #4075 shorthand
 *   rather than a host-scope global this module cannot see (a deployment key
 *   that is simply not in `SCOPE_ROOTS` would otherwise read as a bare field).
 * - **`data.*`** is reported only when the caller confirms `data` names the row
 *   (`dataNamesRow`). A surface whose `data` is the host scope's own — a
 *   `rowless` dialog, a metadata-editing form — is a legitimate `data.*` site
 *   and is left alone.
 *
 * Only the FIRST finding is returned, and the bare-shorthand arm is checked
 * first: it is the arm the server refuses outright (`visibility-bare-identifier`
 * is an `error` there, while a mis-layered root is a `warning`), so when a
 * predicate manages both it is the one the author must fix to have anything
 * evaluate at all.
 *
 * @param source       The predicate's CEL text. A legacy `${…}`-dialect string
 *                     is not CEL and returns `null` here (unparseable); classify
 *                     it by its own dialect's rules — on a runtime record surface
 *                     it retired with the CEL spellings (`83fe6e741`), while on
 *                     the schema/widget tier `data` is a different scope entirely.
 * @param row          The row the predicate is bound against.
 * @param dataNamesRow Whether `data` is bound to that same row on this surface.
 */
export function detectNonCanonicalRowSpelling(
  source: string,
  row: Record<string, unknown> | null | undefined,
  dataNamesRow: boolean,
): NonCanonicalRowSpelling | null {
  if (typeof source !== 'string' || !source.trim()) return null;

  const roots = collectCelRootIdentifiers(source);
  // Not parseable through the canonical front end — not our verdict.
  if (!roots || roots.ok !== true) return null;

  // (1) Bare shorthand — the arm the server refuses outright.
  const bare = firstUndeclaredReference(source);
  if (
    typeof bare === 'string' &&
    row != null &&
    typeof row === 'object' &&
    Object.prototype.hasOwnProperty.call(row, bare)
  ) {
    return {
      kind: 'bare-shorthand',
      identifier: bare,
      canonical: `${ROW_PREDICATE_CANONICAL_ROOT}.${bare}`,
    };
  }

  // (2) Wrong-layer `data.*` root — silent at runtime on the server.
  if (dataNamesRow && Array.isArray(roots.roots) && roots.roots.includes(METADATA_LAYER_ROOT)) {
    return {
      kind: 'metadata-layer-root',
      identifier: METADATA_LAYER_ROOT,
      canonical: ROW_PREDICATE_CANONICAL_ROOT,
    };
  }

  return null;
}
