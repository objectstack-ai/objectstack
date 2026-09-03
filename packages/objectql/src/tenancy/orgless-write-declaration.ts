// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13636] The explicit per-write "this row is legitimately org-less"
 * DECLARATION — the channel that stops one `NULL` meaning two things.
 *
 * ## The ruling this implements
 *
 * Maintainer, 2026-08-31 (总监席第 7 场决裁批 #17, verbatim 「同意」), direction
 * **B** with five constraints. The two that shape this file:
 *
 *   1. 「平台获得一个显式的每写入「合法 org-less」申报通道,
 *      `resolveSystemInsertOrganization` 据此区分「有意的环境级/无租户行」与
 *      「漏 stamp 的 bug」。**同一个 NULL 不再身兼两义。**」
 *   2. 「申报必须 loud, checkable, countable ... 静默可选标记不合格 —— 那只是
 *      给旁路换名。」
 *
 * ## The defect the declaration closes
 *
 * `resolveSystemInsertOrganization` (#8844) decides PER OBJECT plus posture. An
 * object whose rows are sometimes org-stamped and sometimes legitimately
 * org-less — `sys_metadata`'s env-level write (#6190 option A),
 * `sys_audit_log`'s record-with-no-organization row — fits neither verdict the
 * #13491 ledger could express: `tenant-scoped` refuses its own ruled-legitimate
 * writes on a walled install, `global` gives up on the org-stamped majority.
 * Both specimens were therefore left `unclassified`, which is where the
 * control's two largest write populations went to die.
 *
 * The missing fact is not about the OBJECT. It is about the ROW, and only the
 * writer knows it. So the writer states it, per write.
 *
 * ## ⛔ Why this is not the per-write bypass flag `system-write-organization.ts`
 * forbids
 *
 * That module's header says, and still says, that a deliberately org-less
 * population is declared on the OBJECT (`tenancy: { enabled: false }`,
 * ADR-0066) and "never a per-write bypass flag, which is exactly the
 * lenient-consumer accommodation Prime Directive #12 forbids". That sentence is
 * about a BYPASS — an optional marker whose presence widens what is allowed and
 * whose absence costs nothing. This is its opposite on all three counts, which
 * is the whole of why the 2026-08-31 ruling could order it:
 *
 *  - **It narrows, it does not widen.** A `conditional` classification ADMITS
 *    an object into #8844's machinery that was excluded before. Every org-less
 *    write on it is refused on a walled posture unless declared. The object
 *    gets STRICTER; the declaration is the ruled way back through, not a way
 *    around.
 *  - **Misuse is a refusal, not a no-op.** A declaration naming an object the
 *    ledger has not admitted, a reason that object does not admit, or an object
 *    other than the one being written, throws
 *    {@link OrgLessWriteDeclarationRefusedError}. There is no spelling of this
 *    option that is silently ignored — which is the precise property that
 *    separates a declaration from a renamed bypass, and the reason the check
 *    runs BEFORE every early return in the resolver rather than after them.
 *  - **It cannot travel.** The declaration names its own object and is checked
 *    against the write's object. A sudo `ExecutionContext` threaded through
 *    twenty writes cannot carry one object's declaration onto another's row.
 *
 * ## loud · checkable · countable — where each word is discharged
 *
 *  - **loud** — the option is spelled at the call site in the writer's own
 *    source, next to the row it describes, and every misuse throws. A reviewer
 *    reading the writer sees the claim; a writer that gets it wrong stops.
 *  - **checkable** — the claim is validated against
 *    `PLATFORM_OBJECT_TENANCY`'s `conditional` entries, each of which carries a
 *    citable writer fact. The admission bar is the ledger's, not this file's.
 *  - **countable** — `scripts/check-orgless-write-declarations.mjs` enumerates
 *    every declaration in the monorepo, holds each to the ledger, and prints
 *    the count. That gate is why the option is a PLAIN LITERAL KEY rather than
 *    a factory call: `@objectstack/metadata-protocol` writes `sys_metadata` and
 *    **cannot import from `@objectstack/objectql`** — objectql depends on IT,
 *    so the edge would be a cycle. One spelling that every package can write is
 *    countable by `git grep` from anywhere in the tree; a factory would be
 *    countable only in the packages that happen to sit downstream of objectql.
 *    The type-safety a factory would have bought is bought instead by the
 *    runtime refusal above and by that gate, which rejects a non-literal
 *    argument outright.
 */

/**
 * Why a row on a `conditional` object is legitimately org-less.
 *
 * A CLOSED vocabulary, deliberately: an open string would let a writer invent a
 * justification at the call site, which is the unwritten-rule shape this
 * channel exists to remove. Each member cites the adjudication that makes its
 * population legitimate, and `PLATFORM_OBJECT_TENANCY` decides which objects
 * may use which member — a reason is never admissible everywhere.
 */
export type OrgLessWriteReason =
  /**
   * The #6190 ruling (option A): a non-overridable metadata type's write lands
   * ENV-WIDE, belonging to the installation rather than to any organization.
   * A deliberately org-less row by adjudication.
   */
  | 'env-level-metadata'
  /**
   * An audit record whose SUBJECT resolves NO organization column at all, so
   * there is no organization for the audit row to inherit: a record on an
   * object with no tenant field (single-tenant stacks, ADR-0066 platform-global
   * objects, the better-auth identity tables), or an installation-level subject
   * that behaves the same way — a `global`-scope setting, an import run. That
   * is case 1 of the audit writer's own enumeration
   * (`plugin-audit/src/audit-writers.ts`); this names it, and names ONLY it.
   *
   * ⛔ Case 2 — the subject HAS an organization column and its value is NULL —
   * is deliberately OUTSIDE this reason. At the writing call site it is
   * indistinguishable from the missing-stamp defect the control exists to find,
   * so no writer declares it: `audit-writers.ts` declares only when
   * `organizationFieldFor(subject) === null`, `read-audit.ts` only when every
   * subject in the batch does, and the three fixed-subject writers only because
   * their one subject does. Those rows keep meeting the refusal.
   *
   * ⚠️ This text is not commentary — the vocabulary and the ledger `evidence`
   * beside it are runtime strings that reach operators, so a reason describing
   * a population no writer produces would read as a claim the platform makes.
   * If a writer is ever taught to declare case 2, that is a ruling, and this
   * paragraph is what has to change with it.
   */
  | 'audit-of-untenanted-record';

/** Every member of {@link OrgLessWriteReason}, for the gate and the tests. */
export const ORG_LESS_WRITE_REASONS: readonly OrgLessWriteReason[] = [
  'env-level-metadata',
  'audit-of-untenanted-record',
];

/**
 * One write's claim that the rows it carries are legitimately org-less.
 *
 * `object` is REDUNDANT with the write's own object and that is the point: it
 * is what stops a declaration riding a shared context or a spread options bag
 * onto a different object's row. The resolver compares the two and refuses a
 * mismatch.
 */
export interface OrgLessWriteDeclaration {
  /** The object this declaration is about. Must equal the object being written. */
  readonly object: string;
  /** Which adjudicated population the rows belong to. */
  readonly reason: OrgLessWriteReason;
}

/**
 * The write-option surface the declaration travels on.
 *
 * Intersected into `ObjectQL.insert` / `insertMany` in `engine.ts` rather than
 * declared on `DataEngineInsertOptionsSchema`: `packages/spec` is a
 * single-owner surface, and the option is an objectql-side control knob rather
 * than part of the published data-engine contract. Every member optional, so an
 * options bag that satisfies the spec contract still satisfies this one.
 */
export interface OrgLessWriteDeclarationOptions {
  /** [#13636] See {@link OrgLessWriteDeclaration}. */
  orgLessWrite?: OrgLessWriteDeclaration;
}

/**
 * Read a declaration off an options bag without trusting its shape.
 *
 * Returns `undefined` for an absent option and for a present one that is not an
 * object — the latter reaches {@link assertOrgLessWriteDeclarationAdmitted} as
 * a malformed declaration only if it is object-shaped. A non-object value
 * (`true`, a string) is refused by the caller rather than silently accepted,
 * which is why this returns the raw value's presence separately.
 */
export function readOrgLessWriteDeclaration(options: unknown): unknown {
  if (options == null || typeof options !== 'object') return undefined;
  return (options as { orgLessWrite?: unknown }).orgLessWrite;
}

/**
 * The refusal for a declaration the ledger does not admit.
 *
 * Identified by `code` rather than `instanceof`, the convention every engine
 * error in this area follows so the check survives crossing a package boundary
 * where two copies of this module can exist. `status` is 500 for the same
 * reason `SystemWriteOrganizationRequiredError` is: the fault is in SERVER-side
 * code that made a claim it is not entitled to make, and blaming a 4xx at the
 * HTTP client that happened to trigger it would both accuse the wrong party and
 * mark the fault `isExpectedDataStatus`, which stops it being logged at all.
 */
export class OrgLessWriteDeclarationRefusedError extends Error {
  readonly code = 'ERR_ORGLESS_WRITE_DECLARATION_REFUSED' as const;
  readonly status = 500;

  constructor(
    public readonly object: string,
    public readonly detail: string,
  ) {
    // [#13636] The message below is a RUNTIME string — it reaches operators
    // and generated surfaces, where a tracker id resolves to nothing
    // (maintainer ruling 2026-08-12). The date stays; the id anchors here
    // instead, for the reader who can resolve it and is already looking at
    // the source.
    super(
      `Insert on '${object}' was REFUSED: its 'orgLessWrite' declaration is not admitted — ${detail}. ` +
        `A declaration asserts that the rows of this write belong to an ADJUDICATED org-less population ` +
        `(maintainer ruling 2026-08-31), so it is checked against the platform tenancy ledger ` +
        `(PLATFORM_OBJECT_TENANCY, 'platform-object-tenancy.ts') and never taken on trust. Nothing was ` +
        `written. Fix it by declaring the object this write targets with a reason that object admits, or ` +
        `— if this object really does hold a ruled org-less population — by admitting it in the ledger ` +
        `as 'conditional' with the citable writer fact the admission bar requires. ⛔ Do not reach for ` +
        `this option to silence a refusal: a write that simply forgot to thread an organization is the ` +
        `defect the refusal exists to report.`,
    );
    this.name = 'OrgLessWriteDeclarationRefusedError';
  }
}
