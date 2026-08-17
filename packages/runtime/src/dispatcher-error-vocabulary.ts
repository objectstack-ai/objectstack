// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dispatcher door's declared `error.code` vocabulary (#8087).
 *
 * ## What this file is for
 *
 * ADR-0112 makes `error.code` a closed set — `ApiErrorSchema.code` parses
 * against `ErrorCode` = `StandardErrorCode ∪ ERROR_CODE_LEDGER` — and the
 * ledger's own note says an unregistered code "fails schema parse — which fails
 * the envelope conformance suites — which fails CI. That friction is the
 * point."
 *
 * The dispatcher door did not have that friction. `HttpDispatcher.errorFromThrown`
 * puts `resolveThrownHttpError(e).declaredCode` — the producer's own string,
 * verbatim and un-narrowed — straight into `error.code`, and its conformance
 * suite parsed only the cases it happened to drive. So a producer emitting a
 * code the ledger does not know produced a body that could never satisfy the
 * schema it claims to satisfy, and nothing noticed.
 *
 * The maintainer ruling of 2026-08-12 chose **option B delivered as a gate**:
 * parse every body the door emits, then register what the gate reports —
 * rather than hand-registering the three known codes and trusting a sweep. This
 * file is the gate's declaration half. `scripts/check-dispatcher-error-vocabulary.mjs`
 * re-derives the same set from source on every CI run and fails when the two
 * disagree, in EITHER direction:
 *
 *   - a code-stamping site the table does not classify  → a new unswept
 *     producer; classify it (and register it, if it reaches a wire)
 *   - a table row whose site is gone                    → stale row; delete it
 *   - a `pending-registration` row whose code HAS been registered → the row's
 *     job is done; delete it (this is how #8846 landing ratchets the list down)
 *
 * ## Why the table is declared rather than inferred
 *
 * Whether a thrown value reaches an HTTP response envelope is a reachability
 * question, and no source scan decides it: `MEMORY_MULTI_TENANT_UNSUPPORTED` is
 * stamped exactly like `FLOW_FAILED` and one of them is a boot refusal the CLI
 * rethrows pre-HTTP. So the scan REPORTS sites and this table RECORDS the
 * verdict with its reason — the same shape `check-route-envelope`'s module
 * table uses, and for the same reason: silently applying a default to an
 * unknown site is what lets a real emitter hide.
 *
 * A site the scan finds and the table does not carry is an ERROR, never a
 * default. That is the ratchet — an unswept producer added next month reddens
 * CI instead of silently re-opening the hole.
 *
 * ## Scope — this table classifies, it does not register
 *
 * Registering a code widens the accepted set (`ApiErrorSchema.code` parses
 * against the union), which is a contract-semantics change owned by the
 * `packages/spec` lane. The first derivation's `pending-registration` rows were
 * the input to **#8846**, which registered all seven and ratcheted them out of
 * this table; a future `pending-registration` row follows the same path.
 * ⛔ Nothing here edits the ledger.
 */

/** How the code literal is written at the site — what the scanner matched. */
export type CodeStampShape =
    /** `err.code = 'X'` — stamped onto a value about to be thrown. */
    | 'assign'
    /** `readonly code = 'X'` — an error class's own identity. */
    | 'classfield'
    /** `readonly code = CONST` — the same, through a resolved constant. */
    | 'classconst'
    /** `code: 'X'` in an object literal. */
    | 'objlit';

/**
 * Where the stamped code can end up. `dispatcher` is the door this card is
 * about; `rest` is the direct-mount registrar; `none` means the value never
 * reaches an HTTP error envelope at all.
 *
 * [#9098] The `rest` door SPLIT, and the split is why this classification still
 * earns its keep. Its author-side responder (`sendDeclaredFault`,
 * `packages/rest/src/error-response.ts`) now takes `code: ErrorCode`, so a
 * refusal this repo DECIDES is narrowed by the compiler and can never be a
 * finding here. Its classification responder (`sendThrownError`, same file)
 * still takes `error: any` — deliberately, since narrowing what a CAUGHT error
 * may carry is an ADR-0112 contract decision rather than an internal typing one
 * — so a code stamped on a thrown value and passed through remains exactly the
 * reachability question this table answers. Both were spelled `sendError` until
 * #9098; that collision is what let the door's hole read as closed.
 */
export type CodeDoor = 'dispatcher' | 'rest' | 'none';

export type CodeVerdict =
    /**
     * Reaches a wire `error.code` verbatim and the ledger does not know it.
     * The body cannot parse. ⇒ #8846's registration input.
     */
    | 'pending-registration'
    /**
     * Authored OUTSIDE the platform — a metadata app's action code, carried
     * across the sandbox boundary deliberately (#7867). No ledger can enumerate
     * it; see the note on `SANDBOX_AUTHORED_LIMB` below.
     */
    | 'sandbox-authored'
    /**
     * Belongs to a different vocabulary that merely spells itself `code` — a
     * Node errno, a driver errno, an automation RESULT envelope. Not an
     * ADR-0112 `error.code` and not the ledger's business (ADR-0112 D6/D6c
     * draw the same line for field-level and diagnostic codes).
     */
    | 'foreign-vocabulary'
    /**
     * A refusal raised before any HTTP boundary exists — the CLI rethrows it
     * and aborts. The ledger's own note ratifies this class by name:
     * `MONGODB_MULTI_TENANT_UNSUPPORTED` was UNregistered by #8035 for exactly
     * this reason, and "host boot matching is not wire vocabulary".
     */
    | 'boot-refusal';

export interface UnregisteredCodeSite {
    /** The literal as it is stamped. */
    readonly code: string;
    /** Repo-relative file. No line number — line numbers rot, files do not. */
    readonly file: string;
    readonly shape: CodeStampShape;
    readonly door: CodeDoor;
    readonly verdict: CodeVerdict;
    /** Why this verdict — the evidence, not a restatement of the verdict. */
    readonly why: string;
}

/**
 * Every site where a code the ledger does not know is stamped onto a value,
 * measured over `packages/**` non-test source and classified.
 *
 * MEASURED, not chosen. Re-derive with:
 *   node scripts/check-dispatcher-error-vocabulary.mjs --report
 */
export const UNREGISTERED_CODE_SITES: readonly UnregisteredCodeSite[] = [
    // ── pending registration: none. The first derivation reported seven codes
    // (FLOW_FAILED, QUERY_OBJECT_MISMATCH, ERR_AUTONUMBER_COLLISION,
    // ERR_TRANSACTION_UNSUPPORTED, ERR_CROSS_DATASOURCE_TRANSACTION_WRITE,
    // ERR_HOOK_TARGET_REBIND, FIELD_VISIBILITY_UNRESOLVED) and #8846 registered
    // all seven in ERROR_CODE_LEDGER, so their rows ratcheted out — a
    // registered code is skipped by the scan, and a `pending-registration` row
    // whose code is registered fails the gate in the other direction. A future
    // unswept producer lands here as an `unclassified-site` finding and gets a
    // new row (then a spec-lane registration, then the row comes out again). ──

    // ── sandbox-authored: outside any ledger, by design ────────────────────
    // (no source site — the producer is tenant code; see SANDBOX_AUTHORED_LIMB)

    // ── foreign vocabularies: spelled `code`, not an ADR-0112 error.code ────
    {
        code: 'MODULE_NOT_FOUND',
        file: 'packages/types/src/node.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            "Node's own errno, synthesized so `isModuleNotFoundError` keeps answering true for a host " +
            'import failure. Every caller classifies on it in-process; it names a module resolution ' +
            'outcome, not a request refusal.',
    },
    {
        code: 'INVALID_SCREEN_INPUT',
        file: 'packages/services/service-automation/src/engine.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            'RETURNED in an automation result envelope (`{ success: false, code, error }`), never thrown. ' +
            'When a rejected run reaches the door, `action-execution.ts` converts the result into a ' +
            'throw of its own carrying FLOW_FAILED — so this string is not what lands in `error.code`.',
    },
    {
        code: 'IMPERSONATION_ROTATION_FAILED',
        file: 'packages/plugins/plugin-auth/src/impersonation-bearer-rotation.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            "better-auth's own `APIError` vocabulary, and it cannot reach this door: `domains/auth.ts` " +
            'catches everything the auth service throws and answers `deps.error(INTERNAL_ERROR_MESSAGE, 500)` ' +
            '— the message withheld UNCONDITIONALLY and the code status-derived, never `errorFromThrown` ' +
            '(#5085). better-auth answers its own failures with a `Response` rather than by throwing, and ' +
            'that body is returned untouched as `result`. So the string never lands in an ADR-0112 ' +
            '`error.code`. This is the row that shows why verdicts are DECLARED: it is written exactly ' +
            'like FLOW_FAILED and a documented catch one layer up makes it unreachable.',
    },
    {
        code: 'SQLITE_ERROR',
        file: 'packages/spec/src/migrations/entries/semantic/18.driver-sql-unresolvable-where-column-refused.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why: "A SQLite driver errno quoted in a migration entry's before/after sample. Not a producer.",
    },
    {
        code: 'SQLITE_ERROR',
        file: 'packages/spec/src/migrations/registry.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why: 'Same driver errno, same migration sample, carried in the registry index.',
    },

    // ── boot refusals: no HTTP boundary exists yet ─────────────────────────
    {
        code: 'MONGODB_MULTI_TENANT_UNSUPPORTED',
        file: 'packages/drivers/driver-mongodb/src/mongodb-tenancy-guard.ts',
        shape: 'classconst',
        door: 'none',
        verdict: 'boot-refusal',
        why:
            'The ledger note names this exact code as the class precedent: registered by #3724, ' +
            'UNregistered by #8035 because the CLI rethrows it pre-HTTP and aborts. "Host boot matching ' +
            'is not wire vocabulary." Its throw site and constant deliberately live on.',
    },
    {
        code: 'MEMORY_MULTI_TENANT_UNSUPPORTED',
        file: 'packages/drivers/driver-memory/src/memory-tenancy-guard.ts',
        shape: 'classconst',
        door: 'none',
        verdict: 'boot-refusal',
        why:
            'The driver-memory twin of the row above — same guard shape, same MULTI_TENANT_UNSUPPORTED_CODE ' +
            'constant name, same pre-HTTP abort. Ruled by the same #8035 reasoning.',
    },
];

/**
 * The codes still awaiting a ledger registration, deduped and sorted. Empty
 * since #8846 registered the first derivation's seven; a future unswept
 * producer re-populates it through its table row.
 *
 * ⚠️ This list is the OUTPUT of a measurement, not a wish: every member has a
 * live producer and a door. It shrinks only by being registered.
 */
export const PENDING_LEDGER_REGISTRATION: readonly string[] = Object.freeze(
    [...new Set(UNREGISTERED_CODE_SITES.filter((s) => s.verdict === 'pending-registration').map((s) => s.code))].sort(),
);

/** The subset that reaches the DISPATCHER door — what this card's suite drives. */
export const PENDING_AT_DISPATCHER_DOOR: readonly string[] = Object.freeze(
    [
        ...new Set(
            UNREGISTERED_CODE_SITES.filter((s) => s.verdict === 'pending-registration' && s.door === 'dispatcher').map(
                (s) => s.code,
            ),
        ),
    ].sort(),
);

/**
 * ## The limb no ledger can close, measured while building this gate
 *
 * `SandboxError` carries a user action's own `.code` across the QuickJS
 * boundary on purpose — "Author-thrown structured errors get the same
 * treatment; nothing here is objectql-specific"
 * (`sandbox/error-passthrough.test.ts`) — and `domains/actions.ts` serves that
 * error through `errorFromThrown`, so the string lands in `error.code`
 * verbatim. `domains/actions-validation-envelope.test.ts` pins exactly that,
 * end to end, with `DUPLICATE`.
 *
 * So the dispatcher's `error.code` has a limb whose vocabulary is authored by
 * TENANTS, in metadata apps, at runtime. Registration cannot close it: the
 * ledger would have to enumerate strings that do not exist when CI runs. This
 * is not an argument for option C (ruled inadmissible — the closure is
 * load-bearing for every platform producer, and the six rows above are exactly
 * what it catches); it is a bound on what "closed" can mean at THIS door, and
 * it post-dates the ruling.
 *
 * ⛔ Deliberately NOT decided here — deciding it means either narrowing the
 * sandbox boundary or declaring a second, non-ledger vocabulary for
 * author-thrown codes, and both are contract-shaped. Reported to #8087 /
 * #8846 rather than guessed at.
 *
 * `DUPLICATE` is the pinned witness, so it is named here rather than left as an
 * un-owned literal in a test — and it is deliberately NOT re-spelled to a
 * registered code, because re-spelling it would delete the only evidence in the
 * repo that this limb is open.
 */
export const SANDBOX_AUTHORED_LIMB = Object.freeze({
    witness: 'DUPLICATE',
    pinnedBy: 'packages/runtime/src/domains/actions-validation-envelope.test.ts',
    boundary: 'packages/runtime/src/sandbox/quickjs-runner.ts',
});
