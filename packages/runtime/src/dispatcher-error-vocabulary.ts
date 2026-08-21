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
 * put `resolveThrownHttpError(e).declaredCode` — the producer's own string,
 * verbatim and un-narrowed — straight into `error.code`, and its conformance
 * suite parsed only the cases it happened to drive. So a producer emitting a
 * code the ledger does not know produced a body that could never satisfy the
 * schema it claims to satisfy, and nothing noticed. (Since #9106 the door
 * NARROWS — `error.code` takes the resolver's closed `code`, the unregistered
 * spelling rides the wire's `declaredCode` — so such a body now parses; what
 * an unswept producer loses instead is its semantic code, silently demoted
 * off `error.code` until registered. The sweep below is what notices.)
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
    | 'objlit'
    /**
     * [#9223] `code: CONST` in an object literal — the same indirection
     * `classconst` follows, in the shape that stamps most of this repo's codes.
     * Missing from the scan until #9223, which is why the rows carrying it were
     * all added at once: `objlit` demanded a quoted literal, so a constant in an
     * object literal matched NOTHING and was not even reported as unresolved.
     */
    | 'objlitconst'
    /**
     * [#9223] `` code: `A_${x}_B` `` — a code built by interpolation. No source
     * scan can evaluate one, so the gate reports it under its FAMILY identity
     * (`${…}` → `*`, e.g. `APPROVAL_*_FAILED`) and a row must classify it. The
     * only verdict that can honestly cover a family is `runtime-pinned`.
     */
    | 'objlittemplate'
    /**
     * [#9460] `err.code = CONST` — the assign position's constant sibling, and
     * the last of the four stamp positions to get one. #9223 closed exactly
     * this gap for object literals; the assign position kept it, so
     * `err.code = DENY_CODE` matched NOTHING and was not reported as
     * unresolved either.
     */
    | 'assignconst'
    /**
     * [#9460] The stamp inside a CODE-CARRYING HELPER: a file declares one
     * factory — `postureError(code, message)`, `makeError(status, code,
     * message)`, a `constructor(code, message)` — and throws through it
     * everywhere. The stamp `(err as any).code = code` knows the token `code`
     * but not the value; the CALL SITE knows the value and never writes the
     * token. Every pattern in `check:dispatcher-error-vocabulary` AND in
     * `check:error-code-casing` anchors on that token, so both gates read such
     * a file and both reported nothing, each leaving it to the other — which is
     * how `plugin-security`'s live 403 sat unswept through two ADR-0112
     * batches. The scan joins the two halves through the PARAMETER, whose index
     * names the argument to read at each call site.
     */
    | 'codehelper';

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
 *
 * [#9223] `plugin-route` is a THIRD door, surfaced by the widened scan: a plugin
 * that mounts its own Hono routes answers refusals with its own `c.json({
 * success: false, error: { code, message } })` and passes through neither the
 * dispatcher's `errorFromThrown` nor `packages/rest`'s doors. The envelope is
 * still an ADR-0112 `error.code` on a wire with a live reader, so a code that
 * reaches it is a registration question exactly like the other two.
 */
export type CodeDoor = 'dispatcher' | 'rest' | 'plugin-route' | 'none';

export type CodeVerdict =
    /**
     * Reaches a wire and the ledger does not know it. Since #9106 the door
     * narrows — the unregistered spelling rides the wire's `declaredCode`
     * instead of `error.code`, so the body now parses; the producer's
     * semantic code is silently demoted off `error.code` until registered.
     * ⇒ #8846's registration input.
     */
    | 'pending-registration'
    /**
     * Authored OUTSIDE the platform — a metadata app's action code, carried
     * across the sandbox boundary deliberately (#7867). No ledger can enumerate
     * it; since #9106 it is demoted to the wire's `declaredCode` at the door
     * rather than reaching `error.code`. See `SANDBOX_AUTHORED_LIMB` below.
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
    | 'boot-refusal'
    /**
     * [#9223] The site builds its code by INTERPOLATION, so no source scan can
     * say which codes it produces or whether they are registered — and a named
     * test does that job at runtime instead, by enumerating the family and
     * parsing each member against the closed union.
     *
     * This is the one verdict that does not decide reachability; it records a
     * DIVISION OF LABOUR, and it is deliberately hard to misuse:
     * `check-dispatcher-error-vocabulary` refuses it on any shape other than
     * `objlittemplate` (on a literal it would be an exemption from the registry
     * check — the very hole this gate exists to close) and fails when the
     * {@link UnregisteredCodeSite.pin} file does not exist.
     *
     * ⛔ Not a place to park a template nobody checks. If no runtime pin covers
     * the family, the fix is to stamp a LITERAL code per branch — then the scan
     * checks it like any other and the door can narrow it.
     */
    | 'runtime-pinned';

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
    /**
     * [#9223] Required by `runtime-pinned`, meaningless otherwise: the
     * repo-relative test that does at runtime what the scan cannot do
     * statically. The gate checks that this file EXISTS — a deleted pin would
     * otherwise leave the row asserting a guarantee nothing provides.
     */
    readonly pin?: string;
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
    // whose code is registered fails the gate in the other direction. The loop
    // has since run a second full cycle: #9223's widened scan reported
    // UNIQUE_SCOPE_CONFIRMATION_REQUIRED at the marketplace install seam's
    // `plugin-route` door (stamped through a constant in an object literal, the
    // shape `objlit` could not see), and #9246 registered it under
    // `@objectstack/cloud-connection`, ratcheting that row out the same way.
    // #9460's further-widened scan then reported two sites at once —
    // `FLOW_CONVERSION_CONFLICT` and `owd_widening_forbidden` — and #9567
    // registered the former under `@objectstack/metadata-protocol`, ratcheting
    // only that row out; `owd_widening_forbidden`'s lowercase spelling is a
    // naming decision, not a plain admission, so it stays pending below. A
    // future unswept producer lands here as an `unclassified-site` finding and
    // gets a new row (then a spec-lane registration, then the row comes out
    // again). ──

    // ── runtime-pinned: an interpolated family, checked where it can be ─────
    {
        code: 'APPROVAL_*_FAILED',
        file: 'packages/rest/src/rest-server.ts',
        shape: 'objlittemplate',
        door: 'rest',
        verdict: 'runtime-pinned',
        pin: 'packages/rest/src/rest-approvals-wire-codes.test.ts',
        why:
            "Three approvals route factories (`decisionRoute`, `flowMoveRoute`, `threadRoute`) spell the " +
            'terminal 500 catch\'s code as a template — `` `APPROVAL_${action.toUpperCase()}_FAILED` `` and ' +
            'two siblings — so the family, not a literal, is what exists in source. #8885 registered all ' +
            'nine codes the family produces, and its pin is what keeps that true: it enumerates the ' +
            'registered `POST /approvals/requests/:id/<action>` routes and asserts the code each catch arm ' +
            "would generate parses against ApiErrorSchema's closed union, mirroring the production " +
            "template exactly (single-occurrence `.replace('-', '_')` included). So a tenth action route " +
            'whose generated code nobody registers fails THERE, mechanically. This row records that ' +
            'division of labour instead of letting the scan imply it checked something it cannot: #9223 ' +
            'widened the scan enough to SEE the template, and seeing it is what makes the pin an ' +
            'accounted-for half rather than a local habit in one package.',
    },

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
        code: 'YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER',
        file: 'packages/plugins/plugin-auth/src/auth-manager.ts',
        shape: 'objlitconst',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            "better-auth's own APIError vocabulary — the vendor's `YOU_ARE_NOT_ALLOWED_TO_*` family, " +
            'thrown as `new APIError(\'FORBIDDEN\', { message, code })` so the remove-member guard\'s ' +
            'refusal SET stays byte-for-byte the vendor\'s (see the contract note in ' +
            '`remove-member-permission-guard.ts`; only the envelope differs). It cannot reach this door, ' +
            'by the same route the IMPERSONATION_ROTATION_FAILED row documents and re-verified here: ' +
            '`domains/auth.ts` catches everything the auth service throws and answers ' +
            '`deps.error(INTERNAL_ERROR_MESSAGE, 500)` — unconditionally, never `errorFromThrown` (#5085). ' +
            'So the string never lands in an ADR-0112 `error.code`.',
    },
    // ── [#10352] better-auth's OWN vocabulary, now restamped in-repo ───────
    //
    // These four became visible to this scan for the same reason the success
    // body became visible to `check-route-envelope`: #9968 reimplements the
    // vendor's `/admin/impersonate-user` handler in this repo — in place, on
    // the `admin` plugin's own `endpoints` record — so ObjectStack's ADR-0068
    // platform admin can pass it. Codes that were previously RELAYED from
    // inside `node_modules` are now stamped by a literal this repo builds. The
    // refusal SET did not change: three of the four are read at runtime off
    // `plugin.$ERROR_CODES` and the quoted literal beside each is only the
    // fallback spelling for a vendor bump that drops the key.
    //
    // Why they cannot reach an ADR-0112 `error.code`, verified rather than
    // inherited: they are thrown as better-auth's `APIError` from inside a
    // better-auth ENDPOINT, and better-auth answers its own failures with a
    // `Response` instead of throwing. `AuthManager.handleRequest` returns that
    // `Response` untouched (it only LOGS `status >= 500`) and
    // `domains/auth.ts` passes it on as `{ handled: true, result: response }`,
    // so `errorFromThrown` is never reached. The other direction is closed by
    // that same file: anything the auth service DOES throw is answered
    // `deps.error(INTERNAL_ERROR_MESSAGE, 500)` with a status-derived code,
    // unconditionally (#5085). Same route the IMPERSONATION_ROTATION_FAILED
    // and YOU_ARE_NOT_ALLOWED_TO_DELETE_THIS_MEMBER rows already document.
    //
    // ⚠️ `door: 'none'` here records `none of the three ADR-0112 doors`, NOT
    // `invisible`: each refusal IS served to the client, in the vendor's flat
    // `{ message, code }` shape. That this endpoint's bodies are the vendor's
    // wire rather than this repo's envelope is not inferred here — it is the
    // 2026-08-21 maintainer ruling (#10554), carried in `check-route-envelope`
    // as the `vendorWire` entry for this same file.
    //
    // ⛔ `pending-registration` would be FALSE for all four. That verdict says
    // the code belongs in #8846's ledger batch, i.e. that ObjectStack owns it.
    // These are better-auth's constants; registering them would promote a
    // vendor spelling into the platform vocabulary every consumer branches on
    // — what the SANDBOX_AUTHORED_LIMB note refuses for `DUPLICATE`, for the
    // same reason — and a vendor rename would leave the ledger member
    // outliving its only producer.
    {
        code: 'YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS',
        file: 'packages/plugins/plugin-auth/src/admin-impersonate-endpoint.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            "better-auth 1.7.1's own admin-plugin vocabulary — verified in the installed vendor at " +
            '`dist/plugins/admin/error-codes`, spelled there exactly as it is here — and read at runtime ' +
            'off `plugin.$ERROR_CODES`, never retyped. The caller-side refusal, raised ' +
            "`APIError.from('FORBIDDEN', notAllowed)` inside a better-auth endpoint, so it leaves as the " +
            "vendor's own `Response` and never as a throw this repo classifies. See the section note " +
            'above for the measured path and for why registering a vendor constant would be false.',
    },
    {
        code: 'YOU_CANNOT_IMPERSONATE_ADMINS',
        file: 'packages/plugins/plugin-auth/src/admin-impersonate-endpoint.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            'The target-side twin of the row above, from the same better-auth 1.7.1 file ' +
            "(`dist/plugins/admin/error-codes`), likewise read off `plugin.$ERROR_CODES` and raised " +
            "`APIError.from('FORBIDDEN', cannotImpersonateAdmins)`. #9968 makes it reachable for the " +
            "first time — the vendor gated it on the legacy `user.role` scalar nothing writes post " +
            "ADR-0068 D2, so the vendor's own promise was inert — but reachable in the vendor's wire " +
            "shape under the vendor's spelling, which changes nothing about whose vocabulary it is.",
    },
    {
        code: 'FAILED_TO_CREATE_USER',
        file: 'packages/plugins/plugin-auth/src/admin-impersonate-endpoint.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            "better-auth 1.7.1's BASE_ERROR_CODES member, surfaced through the `admin` plugin's " +
            "`$ERROR_CODES` and raised `APIError.from('INTERNAL_SERVER_ERROR', failedToCreate)` when the " +
            'impersonation session cannot be minted. Same vendor, same endpoint and same wire as the two ' +
            'rows above.',
    },
    {
        code: 'USER_NOT_FOUND',
        file: 'packages/plugins/plugin-auth/src/admin-impersonate-endpoint.ts',
        shape: 'objlit',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            "better-auth 1.7.1's BASE_ERROR_CODES member, raised `APIError.from('NOT_FOUND', " +
            'USER_NOT_FOUND)`. The one of the four NOT read off `$ERROR_CODES`, for a reason written at ' +
            'its declaration site: it lives on the ROOT `better-auth` entry, and importing that entry ' +
            'makes admin-plugin CONSTRUCTION depend on a module several suites in this package ' +
            "`vi.mock`, where vitest throws on a missing export and `addOptionalPlugin`'s catch then " +
            'swallows the whole `admin` plugin — measured. So it is restated as a local constant and ' +
            "`admin-impersonate-endpoint.test.ts` pins it equal to the vendor's own " +
            '`BASE_ERROR_CODES.USER_NOT_FOUND`. That pin is what keeps the restatement from drifting ' +
            "into a code this repo owns by accident: it is still the vendor's string on the vendor's " +
            'wire, and a vendor rename turns the pin red rather than silently minting a local code.',
    },

    {
        code: 'OS_METADATA_CONVERTED',
        file: 'packages/spec/src/conversions/apply.ts',
        shape: 'objlitconst',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            'The ADR-0087 D4 conversion-notice vocabulary, not an error vocabulary at all: ' +
            '`applyConversions` PASSES this code to an `onNotice` callback in a structured ' +
            'ConversionNotice, and the loader, `validate` and the MCP deprecations surface consume that ' +
            'shape. Nothing is thrown and no envelope is built. Same class as the INVALID_SCREEN_INPUT ' +
            'row — a result envelope that merely spells itself `code`.',
    },
    {
        code: 'OS_METADATA_CONVERSION_CONFLICT',
        file: 'packages/spec/src/conversions/apply.ts',
        shape: 'objlitconst',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            'The conflict twin of the OS_METADATA_CONVERTED row: handed to `onConflict` when a rename ' +
            "target is a live name owned by something else, so the conversion refuses to rewrite it and " +
            'surfaces a loud diagnostic instead (ADR-0078: never silent). A callback payload, not a ' +
            'thrown error and not a response body.',
    },
    {
        code: 'ERR_BULK_PER_ROW_HOOK_LIMIT',
        file: 'packages/spec/src/data/bulk-write-hook-conformance.ts',
        shape: 'objlitconst',
        door: 'none',
        verdict: 'foreign-vocabulary',
        why:
            'The declaring source rules on this itself, in the doc comment on the constant: ' +
            '"Deliberately an `ERR_`-prefixed operational code on the thrown error\'s own property bag, ' +
            'NOT an ADR-0112 wire code … minting a member of it by side effect is the exact ' +
            '`declared != enforced` shape that vocabulary exists to prevent." It is RETURNED in a ' +
            '`BulkPerRowHookBudgetVerdict` by a function documented pure and total (no throw); the engine ' +
            'raises, the contract decides.',
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

    // ── pending registration [#9460]: found by the widened scan ────────────
    // This row is the deliverable of #9460, not a regression: the scan could
    // not SEE the site before it learned the stamp shape below (a
    // code-carrying helper), so "no finding" meant "not looked at", which is
    // the failure this gate exists to prevent. Its sibling from the same
    // #9460 batch, `FLOW_CONVERSION_CONFLICT`, ratcheted out via #9567 (see
    // the running log above); this one stays pending because admitting it AS
    // SPELLED is what ADR-0112 D1 forbids — the rename-or-keep-the-#9106-demote
    // call is the spec lane's and is not resolved here.
    {
        code: 'owd_widening_forbidden',
        file: 'packages/plugins/plugin-security/src/object-posture-gate.ts',
        shape: 'codehelper',
        door: 'rest',
        verdict: 'pending-registration',
        why:
            'The ADR-0090 D7 / ADR-0086 D1 refusal: an environment overlay may only TIGHTEN a packaged ' +
            "object's OWD. The token reaches the wire verbatim but NOT in `code` — it rides the wire in " +
            'TWO fields since #9232 narrowed the flat REST door like every other: the 403 body carries the ' +
            'closed member the status derives in `code` (`PERMISSION_DENIED`) and this string, unchanged, ' +
            'in the open `declaredCode` sibling beside it. `packages/rest/src/meta-object-owd-gate.test.ts` ' +
            'drives `PUT /api/v1/meta/object/:name` and asserts BOTH fields on the refusal body. So the ' +
            'body PARSES (`ApiErrorSchema.declaredCode` is an open `z.string()`), and a consumer keying on ' +
            '`code` alone reads a generic `PERMISSION_DENIED` and cannot tell this refusal from any other ' +
            '403. ⚠️ That demote is not an escape from this table — it is the shape this file\'s header ' +
            'already names: the body parses, and what an unswept producer loses instead is its semantic ' +
            'code, silently demoted off `error.code` until registered. Which is exactly what a ' +
            '`pending-registration` row records, and registering the code is still what ratchets it out. ' +
            '[#9460] Invisible to BOTH vocabulary gates until now, and not for its casing: the file throws ' +
            'through a code-carrying helper (`postureError(code, message)`), so the stamp `(err as any).code ' +
            '= code` knows the token `code` but not the value, while the call site knows the value and never ' +
            'writes the token. Every pattern in this gate and in `check:error-code-casing` anchors on that ' +
            'token, so both read the file and both reported nothing. ⚠️ The spelling is LOWERCASE, so ' +
            'ADR-0112 D1 forbids registering it as spelled — the rename-or-keep-the-#9106-demote call is ' +
            "the `packages/spec` lane's, tracked as #9460 half (2) and NOT decided here. The row records " +
            'that a live wire code is outside the vocabulary; it does not prescribe the remedy.',
    },

    // ── boot refusals: no HTTP boundary exists yet ─────────────────────────
    // [#9460] The four `MigrationJournalRefusal` codes below arrive through the
    // same code-carrying-helper shape as `owd_widening_forbidden` — a class
    // constructor `(code, message)` whose `this.code = code` names the token but
    // not the value — and land on the OTHER side of the reachability question.
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
    {
        code: 'NO_SUCH_RUN',
        file: 'packages/core/src/utils/migration-journal.ts',
        shape: 'codehelper',
        door: 'none',
        verdict: 'boot-refusal',
        why:
            'Raised by `MigrationJournalRefusal` when no journal rows exist for the requested run id. ' +
            'Its only consumers are `packages/cli/src/commands/migrate/resume.ts` and `recorded-by.ts`, ' +
            'which catch it with `instanceof` and print a message — no HTTP boundary exists on that path, ' +
            'and grep finds no other consumer in `packages/`. Same class as the two rows above and ruled ' +
            'by the same #8035 reasoning: a runner refusal the CLI rethrows is not wire vocabulary.',
    },
    {
        code: 'NOT_COMPENSABLE',
        file: 'packages/core/src/utils/migration-journal.ts',
        shape: 'codehelper',
        door: 'none',
        verdict: 'boot-refusal',
        why:
            'Raised by `MigrationJournalRefusal` when a chunk cannot be compensated, so the runner refuses to resume. ' +
            'Its only consumers are `packages/cli/src/commands/migrate/resume.ts` and `recorded-by.ts`, ' +
            'which catch it with `instanceof` and print a message — no HTTP boundary exists on that path, ' +
            'and grep finds no other consumer in `packages/`. Same class as the two rows above and ruled ' +
            'by the same #8035 reasoning: a runner refusal the CLI rethrows is not wire vocabulary.',
    },
    {
        code: 'PLAN_CHANGED',
        file: 'packages/core/src/utils/migration-journal.ts',
        shape: 'codehelper',
        door: 'none',
        verdict: 'boot-refusal',
        why:
            'Raised by `MigrationJournalRefusal` when the plan hash moved under a recorded run. ' +
            'Its only consumers are `packages/cli/src/commands/migrate/resume.ts` and `recorded-by.ts`, ' +
            'which catch it with `instanceof` and print a message — no HTTP boundary exists on that path, ' +
            'and grep finds no other consumer in `packages/`. Same class as the two rows above and ruled ' +
            'by the same #8035 reasoning: a runner refusal the CLI rethrows is not wire vocabulary.',
    },
    {
        code: 'PREFLIGHT_FAILED',
        file: 'packages/core/src/utils/migration-journal.ts',
        shape: 'codehelper',
        door: 'none',
        verdict: 'boot-refusal',
        why:
            'Raised by `MigrationJournalRefusal` when the pre-resume checks refuse to start. ' +
            'Its only consumers are `packages/cli/src/commands/migrate/resume.ts` and `recorded-by.ts`, ' +
            'which catch it with `instanceof` and print a message — no HTTP boundary exists on that path, ' +
            'and grep finds no other consumer in `packages/`. Same class as the two rows above and ruled ' +
            'by the same #8035 reasoning: a runner refusal the CLI rethrows is not wire vocabulary.',
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
 * ## The limb no ledger can close — measured while building this gate, RULED
 * ## by #9106
 *
 * `SandboxError` carries a user action's own `.code` across the QuickJS
 * boundary on purpose — "Author-thrown structured errors get the same
 * treatment; nothing here is objectql-specific"
 * (`sandbox/error-passthrough.test.ts`) — and `domains/actions.ts` serves that
 * error through `errorFromThrown`. So the dispatcher door's vocabulary has a
 * limb authored by TENANTS, in metadata apps, at runtime. Registration cannot
 * close it: the ledger would have to enumerate strings that do not exist when
 * CI runs.
 *
 * The maintainer ruling (#9106, 2026-08-16) closed it the way the REST door
 * always was: `error.code` is a closed vocabulary at every door, and an
 * author-thrown code that is not an `ErrorCode` member is DEMOTED to the
 * wire's `declaredCode` at the door. The #7867 capability is preserved — the
 * author's code still crosses the sandbox and still reaches the wire, in the
 * open, author-authored channel `ApiErrorSchema.declaredCode` declares.
 * `domains/actions-validation-envelope.test.ts` pins the demote end to end,
 * with `DUPLICATE`.
 *
 * `DUPLICATE` is the pinned witness, so it is named here rather than left as
 * an un-owned literal in a test — re-homed under the demote rule by the #9106
 * ruling, and deliberately NOT registered (fenced off from #8846):
 * registering it would close nothing, since the next app picks a different
 * string, and it would falsely promote one tenant spelling into the platform
 * vocabulary every consumer branches on.
 */
export const SANDBOX_AUTHORED_LIMB = Object.freeze({
    witness: 'DUPLICATE',
    pinnedBy: 'packages/runtime/src/domains/actions-validation-envelope.test.ts',
    boundary: 'packages/runtime/src/sandbox/quickjs-runner.ts',
});
