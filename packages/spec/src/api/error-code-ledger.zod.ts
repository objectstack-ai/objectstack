// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Error-Code Ledger (ADR-0112 D3).
 *
 * The top-level `error.code` vocabulary is two-tier:
 *
 * 1. **Standard catalog** — `StandardErrorCode` (`errors.zod.ts`): a small,
 *    closed set with platform-wide HTTP semantics. It does NOT grow when a
 *    service invents a code.
 * 2. **Registered extension codes** — THIS ledger: every service-specific code
 *    a route may put in `error.code`, registered under its owning package.
 *
 * `ErrorCode` (exported below) is the union, and is what `ApiErrorSchema.code`
 * validates against. An unregistered code fails schema parse — which fails the
 * envelope conformance suites — which fails CI. That friction is the point
 * (ADR-0112: "no silent fourth state" for error codes, per ADR-0049/0078).
 *
 * ## Scope: THIS ledger registers framework packages only (#4805)
 *
 * Every owner key below is a package published from this repository, and that
 * is a RULE — not an accident of the current list, and not something a reader
 * should have to infer by scanning the package names. A downstream product
 * repo (`objectstack-ai/cloud`, or any product built on the platform) does
 * **not** register its codes here. It maintains its OWN ledger, in its own
 * repo, and composes the validation itself:
 *
 * 1. **shape** — `envelopeViolations(body)` (`contract.zod.ts`), and
 * 2. **vocabulary** — `code ∈ StandardErrorCode ∪ <its own ledger>`, which
 *    `makeApiErrorSchema(<its own ledger>)` (`contract.zod.ts`) gives as a
 *    single parse instead of the two-step assertion.
 *
 * The deployed wire vocabulary stays closed and checkable either way — which
 * is what ADR-0112's "no silent fourth state" asks for. It never asked for
 * every entry to live physically in one file.
 *
 * Why federated rather than admitting downstream entries (maintainer ruling on
 * #4805, 2026-08-03, re-confirmed 2026-08-09; raised from cloud#930/#944):
 *
 * - **A commercial vocabulary does not belong in an Apache-2.0 spec.** The
 *   codes worth registering are precisely the product-specific ones (billing
 *   and plan-gating states, control-plane provisioning refusals), and
 *   registering them here would have the OSS spec enumerate a closed-source
 *   product's states under package names absent from this distribution.
 * - **Cadence mismatch breeds bypass.** A downstream code arrives with a
 *   downstream feature; making each one cost a cross-repo PR plus a pin bump
 *   pushes authors toward reusing a semantically wrong existing code, which is
 *   less visible than inventing one.
 *
 * The corollary for THIS file: a PR adding an owner key for a package that is
 * not published from this repository is out of scope by construction — the
 * fix for that need is a ledger in the owning repo, composed as above. The
 * one thing a downstream repo must NOT do is emit a code registered nowhere:
 * that is the silent fourth state, wherever the ledger lives.
 *
 * ## Registering a new code
 *
 * Add it to your package's entry (create the entry if your package has none —
 * a framework package; see the scope rule above if yours ships from another
 * repo), SCREAMING_SNAKE (`^[A-Z][A-Z0-9_]*$` — lint-enforced by
 * `error-code-ledger.test.ts`), with a trailing `//` comment when the name
 * alone doesn't carry the meaning. Prefer a domain prefix for anything not
 * self-evidently global (`ATTACHMENT_*`, `REPORT_*`, `SETTINGS_*`). If the
 * condition is generic (not found / permission / validation / rate limit),
 * use the standard catalog instead of registering a synonym.
 *
 * Since #8211 (adjudicated 2026-08-12, option C) that last sentence is
 * MECHANICAL, not prose: the admission gate (`error-code-ledger.test.ts`)
 * refuses a new code that {@link standardSynonymOf} maps to a standard-catalog
 * member, unless the code carries a {@link STANDARD_SYNONYM_WAIVERS} entry
 * recording why it stays and which member it shadows. Four synonyms had
 * accumulated by the time the rule got teeth precisely because nothing was
 * checking; they (plus a fifth the detector surfaced on landing) are
 * grandfathered via waivers below — their wire values are unchanged, and
 * consolidating any of them onto its standard member is a deliberate wire
 * change DEFERRED by the #8211 adjudication (option B) until a specific code
 * has a measured victim.
 *
 * One rule, two doors (#8087, completed by #9106): registration here is the
 * ADMISSION door — what the vocabulary may contain. The DISPATCHER door is
 * gated (#8087, option B-as-a-gate, maintainer 2026-08-12:
 * `check:dispatcher-error-vocabulary` sweeps its producers) and, since the
 * #9106 ruling (maintainer 2026-08-16), NARROWS exactly as the REST door
 * always has: `resolveThrownHttpError` (`@objectstack/types`) answers `code`
 * (a member of this union) for `error.code` at BOTH doors, and a producer's
 * unregistered spelling is demoted to the wire's `declaredCode` — the open,
 * author-authored channel `ApiErrorSchema` declares for it. Both doors state
 * the same rule: a code either IS the standard member for its condition, or it
 * is registered here — and if it merely re-spells a standard member, that
 * registration is a recorded waiver, never drift. A code registered NOWHERE
 * (a tenant app's own spelling) still reaches the wire, in `declaredCode`.
 *
 * A code emitted by several packages is listed once per emitting package —
 * the union dedupes; the per-package rows are provenance, not identity.
 *
 * Since #13353 that sentence has a mechanical half: the provenance gate
 * (`check:error-code-provenance`, `packages/spec/scripts/`) sweeps every
 * stamp site of a REGISTERED code in `packages/**` non-test source and fails
 * when the stamping package's own owner key does not list it. The admission
 * rules below never ask WHO emits, so before that gate an unlisted emitter was
 * invisible to every gate the repo has (three hand sweeps found the same class
 * three times: #7504, #13254, #13353). Two deliberate shapes are NOT rows and
 * are recorded in {@link PROVENANCE_WAIVERS} instead: a DOOR in another
 * package that names the wire vocabulary itself (`FLOW_DISABLED`,
 * `UPDATE_ID_MISMATCH` — see their rows' comments), and a shared constructor
 * package whose throw is served under another package's registration.
 *
 * ## Retiring a code
 *
 * A row whose last EMITTER is deleted comes out with it. The admission rules
 * below check casing, duplication and shadowing — never whether anyone still
 * throws the code — so a registered-but-unemittable row stays green forever
 * while promising a client a code no response can carry. That is ADR-0112's
 * "no silent fourth state" read backwards, and it is not hypothetical:
 * `OVERLAY_PERSISTENCE_FAILED` outlived its only producer by one PR (#5264
 * deleted `saveMetaItem`'s legacy raw-engine branch; #5783 unregistered the
 * code). Nor does a row need to LOSE its producer to be in this class — a
 * throw site whose error can never reach a response envelope was unemittable
 * from birth: `MONGODB_MULTI_TENANT_UNSUPPORTED` (registered by #3724,
 * unregistered by #8035) is a BOOT refusal — the CLI rethrows it pre-HTTP and
 * aborts, and the one request-reachable trigger sits inside a documented
 * best-effort catch that logs and continues. Its throw site and constant
 * (`MULTI_TENANT_UNSUPPORTED_CODE`, `@objectstack/driver-mongodb`) live on:
 * host boot matching is not wire vocabulary.
 * Before deleting a row, check that no producer remains repo-wide AND
 * that no consumer — including `objectui` and `cloud` — reads the literal;
 * tests that merely CONSTRUCT the code are not producers, and a test pinned to
 * a producerless code is pinning nothing (#4984's phantom-check family).
 *
 * Field-level codes (`FieldErrorSchema.code`, the `fields[]` array) are a
 * SEPARATE vocabulary and do not belong here — see #3977 (ADR-0112 D6).
 */

import { z } from 'zod';
import { StandardErrorCode, HttpStatusErrorCodeMap } from './errors.zod';

export const ERROR_CODE_LEDGER = {
  '@objectstack/rest': [
    'ALREADY_REVERTED',
    'AMBIGUOUS_MATCH',            // import row matched more than one record
    'ANALYTICS_QUERY_FAILED',
    'APPROVAL_ACTIONS_FAILED',
    // [#8885] The eight rows below are the TEMPLATE-GENERATED members of the
    // family whose literal-spelled siblings (`APPROVAL_RECALL_FAILED`,
    // `APPROVAL_ACTIONS_FAILED`, `APPROVAL_REQUEST_GET_FAILED`,
    // `APPROVAL_REQUEST_LIST_FAILED`) were already registered: the approvals
    // route factories in `rest-server.ts` spell the terminal 500 catch's code
    // as `` `APPROVAL_${action.toUpperCase()}_FAILED` `` (`decisionRoute`,
    // `flowMoveRoute`, `threadRoute`), so a literal sweep could not see them
    // and they were skipped when the family landed. Emitted whenever the
    // approvals service throws an error `handleApprovalError`'s message-prefix
    // table does not map.
    'APPROVAL_APPROVE_FAILED',
    'APPROVAL_COMMENT_FAILED',
    'APPROVAL_REASSIGN_FAILED',
    'APPROVAL_RECALL_FAILED',
    'APPROVAL_REJECT_FAILED',
    'APPROVAL_REMIND_FAILED',
    'APPROVAL_REQUEST_GET_FAILED',
    'APPROVAL_REQUEST_INFO_FAILED',
    'APPROVAL_REQUEST_LIST_FAILED',
    'APPROVAL_RESUBMIT_FAILED',
    'APPROVAL_REVISE_FAILED',
    'BATCH_NOT_ATOMIC',
    'BATCH_TOO_LARGE',
    'BATCH_UNRESOLVED_REF',
    'BLANK_MATCH_KEY',
    'CONCURRENT_UPDATE',
    // [#8111] `respondSharingError`'s 409 arm — `revoke` on a rule-materialised
    // share (`source != 'manual'`), thrown by plugin-sharing's `sharing-service`
    // and documented at `content/docs/kernel/runtime-services/sharing-service.mdx`.
    // REGISTERED, not renamed: this is the value the arm has always put on the
    // wire, and #8111 converged its POSITION only. Consolidating it onto the
    // standard catalog's `RESOURCE_CONFLICT` would change what clients read, so
    // it is a deliberate wire change for the maintainer, filed separately —
    // exactly the shape this block's existing generic synonyms (`NOT_FOUND`,
    // `FORBIDDEN`, `INTERNAL`) already carry.
    'CONFLICT',
    'CONFLICTING_MAPPING',
    'DATASET_INVALID',
    'DELEGABLE_SCOPE_FAILED',
    'DUPLICATE_REQUEST',
    'EMAIL_SEND_FAILED',
    'ERR_BULK_RESULT_MISMATCH',
    'ERR_DATASOURCE_UNAVAILABLE',
    'EXPLAIN_FAILED',
    'EXPORT_NOT_PERMITTED',
    'EXTERNAL_DATASOURCE_ERROR',     // introspection/connection-test refusal from the external-datasource service
    'EXTERNAL_IMPORT_ERROR',         // federated import refused (read-only store, missing remote table)
    // [#8846] ADR-0106 D6 tier 3: field-visibility grants for an object could
    // not be evaluated, so the schema is not served — `sendFieldVisibilityFault`
    // (`error-response.ts`) answers 503 with this code (503, not 500: the
    // condition is an unhealthy dependency and a retry is right). Reported by
    // the #8087 dispatcher-vocabulary gate; it reaches the REST door, and the
    // ledger is door-agnostic.
    'FIELD_VISIBILITY_UNRESOLVED',
    'FORBIDDEN',
    'FORM_NOT_FOUND',
    'FORM_RESOLVE_FAILED',
    'IMPORT_JOB_CREATE_FAILED',
    'IMPORT_ROW_FAILED',
    'INTERNAL',
    'INVALID_REQUEST',
    'INVALID_STATE',
    'LOOKUP_NOT_PUBLIC',
    'LOOKUP_TARGET_MISSING',
    'MAPPING_FORMAT_MISMATCH',
    'MAPPING_FORMAT_UNSUPPORTED',
    'MAPPING_NOT_FOUND',
    'MAPPING_TARGET_MISMATCH',
    'NOT_FOUND',
    'NOT_UNDOABLE',
    'NO_MATCH',                   // import upsert found no record for the match key
    'OBJECT_API_DISABLED',
    'OBJECT_API_METHOD_NOT_ALLOWED',
    'OPENAPI_UNAVAILABLE',        // no OpenAPI spec bundled with this runtime
    'PACKAGE_DELETE_FAILED',
    'PACKAGE_DELETE_PARTIAL',        // uninstall left per-item failures behind; see error.details
    'PACKAGE_MANIFEST_INVALID',
    'PACKAGE_PUBLISH_FAILED',
    'PAYLOAD_TOO_LARGE',
    'PROJECT_NOT_FOUND',
    'PROJECT_PROVISIONING',       // project exists but is still provisioning
    'PROJECT_PROVISIONING_FAILED',
    'READ_BACK_FAILED',           // approval write recorded, but its read-back is filtered by the caller's org scope — the result envelope cannot be built; the write is NOT rolled back
    'REPORTS_LIST_FAILED',
    'REPORT_DELETE_FAILED',
    'REPORT_GET_FAILED',
    'REPORT_NOT_FOUND',
    'REPORT_RUN_FAILED',
    'REPORT_SAVE_FAILED',
    'REPORT_SCHEDULE_FAILED',
    'REQUEST_NOT_FOUND',
    'RESUME_FAILED',              // decision recorded but its flow run could not be resumed
    'RESUME_TARGET_LOST',         // the flow run behind the request no longer exists
    'RULE_DEFINE_FAILED',
    'RULE_DELETE_FAILED',
    'RULE_EVALUATE_FAILED',
    'RULE_GET_FAILED',
    'RULE_LIST_FAILED',
    'RULE_NOT_FOUND',
    'SCHEDULES_LIST_FAILED',
    'SCHEDULE_DELETE_FAILED',
    'SHARES_LIST_FAILED',
    'SHARE_GRANT_FAILED',
    'SHARE_REVOKE_FAILED',
    'SUGGESTION_CONFIRM_FAILED',
    'SUGGESTION_DISMISS_FAILED',
    'SUGGESTION_LIST_FAILED',
    'SUMMARY_RECOMPUTE_FAILED',
    // [#8885] `POST /approvals/requests/:id/remind` inside the reminder
    // cool-down window — `handleApprovalError` (`rest-server.ts`) maps
    // plugin-approvals' `THROTTLED: …` throw (`approval-service.ts`,
    // `remind()`) to 429 with this code on the wire. The spec contract
    // (`contracts/approval-service.ts`) documents the rejection under this
    // name, so the value is contract vocabulary, not an incidental spelling.
    // Not a detector-flagged synonym of `RATE_LIMIT_EXCEEDED`, and kept
    // deliberately: the condition is a per-action business cool-down, not an
    // API quota.
    'THROTTLED',
    'UNAUTHORIZED',
    'UNIQUE_VIOLATION',
    'UNSUPPORTED_TRANSFORM',
    'VALIDATION_FAILED',          // record-level validation; carries `fields[]` (#3977)
  ],
  '@objectstack/runtime': [
    // [ADR-0126 §8 item 2] a packaged ACTION this installation switched off,
    // refused at dispatch — the activation-ledger consult in
    // `action-execution.ts`, answered 409 by BOTH action doors (the REST
    // `/actions/:object/:action` route and the MCP `run_action` bridge, which
    // throws it with `status`/`code` declared so `resolveThrownHttpError`
    // serves the same envelope). Never carries `status: 'failed'`: nothing
    // dispatched.
    //
    // ⛔ NOT a re-spelling of `FLOW_DISABLED`, and the distinction is the point
    // of registering it: a `script` action refused under a code naming a flow
    // sends an operator hunting a flow that does not exist. It joins the
    // `*_DISABLED` family (`OBJECT_API_DISABLED`, `OBJECT_PACKAGE_DISABLED`,
    // `FLOW_DISABLED`) — each names WHICH thing is off, which is what an
    // operator acts on, and none of them is a synonym of `RESOURCE_CONFLICT`
    // in the detector's sense or in meaning.
    'ACTION_DISABLED',
    'EXPIRED_OR_REVOKED',         // share link
    // [#9415] the trigger door refused to dispatch a flow that is switched off
    // — `respondToFlowTrigger` (`domains/automation.ts`) reads the engine's
    // own `AutomationResult.code` and answers 409. Registered HERE and not
    // under the engine's package for the same reason FLOW_FAILED is: this
    // door, not the producer, is where the wire vocabulary is named. NOT a
    // synonym of `CONFLICT` in the detector's sense and not one in meaning
    // either — it names WHICH state conflicts, which is what an operator acts
    // on. Never carries `status`: nothing dispatched (#9378 row 3).
    // [#9446] Second EMITTER of the code: `POST /api/v1/actions/:object/:action`
    // answers the same 409 through `dispatchFlowAction`
    // (`packages/runtime/src/action-execution.ts`), reading the same
    // engine `AutomationResult.code` via the shared `classifyFlowRefusal`
    // table (`flow-dispatch-status.ts`) and serving the throw through
    // `errorFromThrown` — the two doors now state the same refusal the same
    // way. Provenance, not identity (see above).
    'FLOW_DISABLED',
    // [#8846] a flow that RAN and rejected — a deliberate business rejection,
    // served as a 400 (#3962) with the semantic code kept on the wire so
    // callers can branch on it; `/actions` serves the throw through
    // `errorFromThrown` (`action-execution.ts`). Reported by the #8087
    // dispatcher-vocabulary gate.
    'FLOW_FAILED',
    // [#11504] the definition-level input-schema refusal: a node's static
    // `config` violates the `inputSchema` its own flow definition declares, so
    // the engine refused to dispatch — nothing ran, nothing was written, and
    // the result carries NO `status` (the #9378 never-dispatched class, beside
    // FLOW_DISABLED / FLOW_NO_START_NODE). The guard's verdict is a pure
    // function of the flow definition (`validateNodeInputSchemas` reads
    // `node.inputSchema` against the static `node.config`; its variables
    // parameter is deliberately unused), so re-running it cannot change the
    // answer — ruled NON-RETRYABLE by #10025 (maintainer, 2026-08-20, Option B
    // taken whole): ONE refusal row carrying this code instead of
    // 1 + maxRetries identical `status: 'failed'` rows re-deriving a
    // certainty. Answered 422 like FLOW_NO_START_NODE — understood request,
    // existing flow, unexecutable definition — and deliberately distinct from
    // it: that one says the definition has nothing to dispatch, this one says
    // a node's config contradicts the schema the definition itself declares.
    // Not a VALIDATION_ERROR synonym: the REQUEST is well-formed — what fails
    // is the stored definition. Registered ahead of its producer by design
    // (the #10413 → #10576 split shape, applied to #10025 → #11504): the
    // emitting half — `execute()`'s catch short-circuiting before
    // `retryExecution` in `@objectstack/service-automation` — is #10025's,
    // blocked on this row, and asserts this exact string by value. Registered
    // HERE and not under the engine's package for the same reason as its
    // three FLOW_* siblings: the trigger door, not the producer, is where the
    // wire vocabulary is named.
    'FLOW_INPUT_SCHEMA_INVALID',
    // [#9415] the trigger door refused a flow whose stored definition has no
    // `start` node — there is nothing to dispatch, so the run never began.
    // Answered 422 by `respondToFlowTrigger`: understood request, existing
    // flow, unexecutable definition. Deliberately distinct from
    // FLOW_DISABLED — one is reversible operational state, the other an
    // authoring defect — and from FLOW_FAILED, which means the flow ran
    // (#9378 row 4).
    // [#9446] Second EMITTER of the code: `POST /api/v1/actions/:object/:action`
    // answers the same 422 through `dispatchFlowAction`
    // (`packages/runtime/src/action-execution.ts`), reading the same
    // engine classification via the shared `classifyFlowRefusal` table
    // (`flow-dispatch-status.ts`) and serving the throw through
    // `errorFromThrown` — the two doors now state the same refusal the same
    // way. Provenance, not identity (see above).
    'FLOW_NO_START_NODE',
    'INVALID_OR_EXPIRED',         // share-link token
    'NEEDS_PASSWORD',             // share link requires a password
    // [#7557] `DELETE /packages/:id` on the DISPATCHER door — per-item failures
    // used to ride inside a 200 with a hardcoded `success: true`. Second
    // EMITTER of the code `@objectstack/rest` already registers for the
    // direct-mount door of the same route; the two doors now state the same
    // failure the same way. Provenance, not identity (see above).
    'PACKAGE_DELETE_PARTIAL',
    'PROJECT_MEMBERSHIP_REQUIRED',
    'RECORD_GONE',                // share link resolves but the record was deleted
    'ROUTE_NOT_FOUND',
    'SIGN_IN_REQUIRED',
    'UNSUPPORTED',
    'VALIDATION_FAILED',
    // [#7560] ADR-0070: the `/packages` LIFECYCLE routes (`PATCH /:id/disable`,
    // `DELETE /:id`) refuse a read-only — code- or platform-provided — package.
    // Second EMITTER of the code `@objectstack/metadata-protocol` already
    // registers for the authoring half (`saveMetaItem`); one condition, one
    // vocabulary. Per this file's header, a code emitted by several packages is
    // listed once per emitting package — provenance, not identity.
    'WRITABLE_PACKAGE_REQUIRED',
    'WRONG_PASSWORD',
  ],
  '@objectstack/service-storage': [
    'ATTACHMENT_DELETE_DENIED',
    'ATTACHMENT_DOWNLOAD_DENIED',
    'ATTACHMENT_PARENT_ACCESS',   // no access to the record the file is attached to
    'AUTH_REQUIRED',
    'ERR_FILE_CONSTRAINT',
    'ERR_FILE_REFERENCE_COPY',
    'FILE_DOWNLOAD_DENIED',
    'FILE_FIELD_BULK_WRITE_REFUSED', // a multi/predicate update wrote a file id into a file-class field (#7102)
    'FILE_NOT_FOUND',
    'INTERNAL',
    'INVALID_REQUEST',
    'INVALID_RESUME_TOKEN',
    'UPLOAD_SESSION_EXPIRED',     // chunk/complete against a session past its own expires_at (#7667)
    'UPLOAD_SESSION_NOT_FOUND',
  ],
  '@objectstack/service-i18n': [
    'INTERNAL',
    'INVALID_REQUEST',
  ],
  '@objectstack/plugin-auth': [
    'ACCOUNT_LOCKED',
    'ASYNC_NOT_SUPPORTED',
    'AUTH_CONFIG_ERROR',
    'CREATE_FAILED',
    'DOMAIN_VERIFICATION_DISABLED', // domain verification is off on this deployment
    'DOMAIN_VERIFICATION_FAILED', // pass-through from better-auth
    'EMAIL_DOMAIN_NOT_ALLOWED',   // [#11739] audience posture email_domain: the address's domain is off the allowlist
    'EMAIL_SERVICE_REQUIRED',
    'ENV_ACCESS_DENIED',
    'INVALID_EMAIL',
    'INVALID_PHONE',
    'INVITE_EMAIL_FAILED',
    'INVITE_REQUIRES_EMAIL',
    'INVALID_REQUEST',
    'INVITE_SMS_FAILED',
    'IP_NOT_ALLOWED',
    'LAST_LOCAL_CREDENTIAL',      // refusing to remove the user's only local credential
    'NO_IDENTITY',                // import row has neither email nor phone
    'NO_PENDING_VERIFICATION',    // pass-through from better-auth
    'PASSWORD_ALREADY_SET',       // pass-through from better-auth
    'PASSWORD_EXPIRED',
    'PASSWORD_POLICY_VIOLATION',
    'PASSWORD_REUSE',
    'OAUTH_REGISTER_FAILED',       // better-auth rejected the client registration
    'PHONE_NOT_ENABLED',
    'SAML_REGISTER_FAILED',
    'SELF_REGISTRATION_CLOSED',   // [#11739] audience posture invite_only: self-registration is closed (no pending invitation for this address)
    'SSO_REGISTER_FAILED',
    'SSO_REGISTER_FORBIDDEN',
    'USER_ALREADY_EXISTS',        // pass-through from better-auth
    'VALIDATION_FAILED',
  ],
  '@objectstack/plugin-sharing': [
    'AUDIENCE_NOT_ALLOWED',
    'ELIGIBILITY_UNEVALUABLE',    // [#7861] publicSharing.eligibility would not compile / faulted on the record — refused, never issued past an unanswered policy
    'EXPIRED_OR_REVOKED',
    'EXPIRY_IN_PAST',
    'EXPIRY_TOO_LONG',
    'FORBIDDEN',
    'INTERNAL',
    'INVALID_EXPIRY',
    'INVALID_OR_EXPIRED',
    'NEEDS_PASSWORD',
    'NOT_FOUND',
    'PERMISSION_NOT_ALLOWED',     // share level would grant a verb the sharer lacks
    'RECORD_GONE',
    'RECORD_NOT_ELIGIBLE',        // [#7861] publicSharing.eligibility returned false for this record
    'SHARING_NOT_ENABLED',
    'SIGN_IN_REQUIRED',
    'UNSUPPORTED',
    'VALIDATION_FAILED',
    'WRONG_PASSWORD',
  ],
  '@objectstack/metadata-protocol': [
    'AUDIT_TYPE_NOT_CANONICAL',   // [#8908] an ADR-0010 audit row was offered a non-canonical metadata `type` — the writer asserts, the caller folds
    'BATCH_ABORTED',              // sibling item in an all-or-nothing publish; it never ran
    'CLONE_DISABLED',
    'COMMIT_NOT_FOUND',
    'CONCURRENT_UPDATE',
    'DESTRUCTIVE_CHANGE',         // change would drop data; needs an explicit opt-in
    // [#9567] ADR-0078's rename guard refuses a metadata write whose `type`/
    // `name` token is already a LIVE name owned by something else in the
    // environment — persisting the un-renamed body would mint exactly the row
    // that guard exists to prevent (`saveMetaItem`, `protocol.ts`, same posture
    // as `duplicatePackage` / #4454). 409, not 422: the body may be perfectly
    // valid — the refusal comes from environment state, so resubmitting the
    // same body cannot help. Surfaced by the widened
    // `check:dispatcher-error-vocabulary` scan (#9460, half 1); NOTE the
    // producer's message prefix spells the code lowercase
    // (`[flow_conversion_conflict]`) while the wire stamp is SCREAMING_SNAKE —
    // a human-log inconsistency worth a glance, left as-is because the
    // producer is outside this ledger's surface.
    'FLOW_CONVERSION_CONFLICT',
    'INVALID_METADATA',
    'INVALID_REQUEST',
    'ITEM_LOCKED',                // _lock refuses the write/delete (ADR-0010 §3.3)
    'METADATA_CONFLICT',
    'NAMESPACE_PREFIX',           // name violates the package namespace-prefix rule
    'NO_DRAFT',
    'NOT_ATTEMPTED',              // data-batch row never ran — an earlier row's failure stopped the batch, to roll back (atomic, #4793) or because continueOnError was unset (#7539)
    'NOT_CREATABLE',
    'NOT_OVERRIDABLE',
    'OBJECT_OVERLAY_PACKAGE_MISMATCH',  // [ADR-0029 D9.9] object overlay row bound to a package that does not own the object
    'OBJECT_PACKAGE_DISABLED',    // [#7557] object is registered but its owning package is disabled — data plane refuses rather than serving rows
    // [#8846] the query body's convenience `object` key names a different
    // object than the route addresses — refused 400 (`protocol.ts`); `/meta`
    // and `/packages` serve protocol throws through `errorFromThrown`.
    // Reported by the #8087 dispatcher-vocabulary gate.
    'QUERY_OBJECT_MISMATCH',
    'REGISTRY_TYPE_NOT_CANONICAL',  // [#9111] a SchemaRegistry overlay entry was offered a non-canonical metadata `type` — the mint door asserts, the caller folds
    'ROLLED_BACK',             // atomic data-batch row was written, then undone by the batch rollback (#4793)
    'STORED_TYPE_NOT_CANONICAL',  // [#8908] a package draft is stored under a non-canonical metadata type (pre-#7894 second-namespace residue) — refused at the publish pre-flight, batch-atomic; [#9174] also refused on `revertCommit`'s restore limb, per-item on `failed[]`, NOT batch-atomic
    'TENANT_SCOPE_REQUIRED',      // [#7780] destructive call named neither an organization nor an explicit cross-tenant intent; needs an explicit opt-in
    'UNSUPPORTED_QUERY_PARAM',
    'VALIDATION_FAILED',
    'VERSION_NOT_FOUND',
    'VERSION_NOT_RESTORABLE',
    'WRITABLE_PACKAGE_REQUIRED',
  ],
  '@objectstack/metadata-core': [
    'METADATA_BRANCH',
    'METADATA_CONFLICT',
    'METADATA_NOT_FOUND',
    'METADATA_SCHEMA_INVALID',
    'OS_PROTOCOL_INCOMPATIBLE',
  ],
  '@objectstack/objectql': [
    // [#8846] single-row insert: the autonumber counter was re-seeded and the
    // value re-issued, and the driver still refused the write (`engine.ts`;
    // carries the driver's failure as `cause`). One of four unswept members of
    // this package's ERR_* family reported by the #8087 dispatcher-vocabulary
    // gate.
    'ERR_AUTONUMBER_COLLISION',
    'ERR_BULK_RESULT_MISMATCH',
    // [#8846] a transaction wrote to an object on a different datasource than
    // the one the transaction was opened on (`CrossDatasourceTransactionWriteError`,
    // `transaction-errors.ts`). Same #8087-gate family as above.
    'ERR_CROSS_DATASOURCE_TRANSACTION_WRITE',
    'ERR_DATASOURCE_UNAVAILABLE',
    'ERR_DRIVER_CONNECT',
    // [#8846] a `before*` hook moved or cleared the id the engine resolved a
    // by-id (or per-row predicate) write against — refused rather than
    // silently writing a different record (`HOOK_TARGET_REBIND_ERROR_CODE`,
    // `hook-target-rebind-errors.ts`), during a write the dispatcher is
    // serving. Same #8087-gate family.
    'ERR_HOOK_TARGET_REBIND',
    // [#5320] Third EMITTER of the code (metadata-protocol and plugin-security
    // already register it) — the registration loop's `views:` tighten refuses a
    // non-container entry, and the `viewItems:` channel refuses an entry the
    // assembled vocabulary rejects, both 422/INVALID_METADATA. Provenance, not
    // identity, per this file's header.
    'INVALID_METADATA',
    'ERR_READONLY_FIELD_REJECTED', // strictReadonlyWrites: the write would strip caller-supplied fields, so it was refused (#5126; since #6437 that covers the primary_key strip too — one code, `drops` carries the per-reason breakdown)
    'ERR_SUMMARY_RECOMPUTE',
    // [#8844] A system-context insert on a tenant-scoped application object
    // carried no organization on a MULTI-organization install (a walled
    // posture, or a `single` posture whose data holds several organizations).
    // The ruled alternative to silently filing the row under the `__global__`
    // pseudo-tenant, which forks the autonumber counter and the partitioned
    // unique index and mints duplicate business identifiers. Not a synonym of
    // any standard member: it is neither the client's bad input (the caller is
    // server-side automation) nor a missing precondition on a request.
    'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED',
    // [#8846] `transaction({ require: true })` on a driver with no
    // `beginTransaction` — thrown BEFORE the callback runs, so nothing has
    // been written (`TransactionUnsupportedError`, `transaction-errors.ts`;
    // ADR-0119 D1/D4 fail-closed posture). Same #8087-gate family.
    'ERR_TRANSACTION_UNSUPPORTED',
    // [#11142/#11230] a by-id update carried an `options.where.id` that is not
    // the bound payload `data.id` — a truthy scalar naming a DIFFERENT row
    // (#11142), or a non-scalar predicate over a row SET (#11230, which also
    // swallowed a declared `multi: true`). Either way a condition the by-id
    // path can never evaluate, refused 400 at dispatch instead of silently
    // writing the payload row (the two halves of the reversed #5748 pin; equal
    // ids — the REST path-id fold — stay honoured). ONE code for both shapes,
    // deliberately: same defect class, same caller remedy (drop one of the two
    // row-address spellings), and the difference rides the message, which is
    // where D3/D4 put it rather than growing the closed `code` vocabulary.
    // Stamped by `@objectstack/metadata-core`'s
    // `engineUpdateDispatchRejectError`, thrown in production by
    // `ObjectQL.update` (`engine.ts`), hence registered here. Not a
    // VALIDATION_ERROR synonym: the payload parses fine — the two row
    // addresses contradict each other, the same mismatch class as
    // QUERY_OBJECT_MISMATCH one layer up.
    'UPDATE_ID_MISMATCH',
    'VALIDATION_FAILED',
  ],
  '@objectstack/core': [
    'ERR_BULK_RESULT_MISMATCH',
    'FILTER_TOKEN_UNKNOWN',       // filter references an unknown context token
    'FILTER_TOKEN_UNRESOLVED',
  ],
  '@objectstack/hono': [
    'AUTH_CONFIG_ERROR',             // auth service threw while the adapter mounted it
  ],
  '@objectstack/service-messaging': [
    'DELIVERY_NEVER_SENT',           // [#8069] terminal delivery row with 0 attempts — a PARKED record of a delivery that could never be prepared, not one that failed. Redelivering it would be a FIRST send, and the row carries no HMAC signature because the secret that would have produced one is exactly what went missing, so it would go out unsigned (#7799). Distinct from DELIVERY_NOT_ELIGIBLE: that one says "wrong state, try when it settles"; this one says "never, fix the configuration instead"
    // "this delivery row's state does not permit the requested operation" —
    // ONE concept on TWO delivery surfaces of this package, deliberately
    // sharing one spelling (PR #11858's contract-review PASS ruled option B;
    // a second near-synonym code was rejected for the vocabulary sprawl
    // ADR-0112 exists to prevent). Stated per-surface because the two refuse
    // OPPOSITE halves of the state space — no single status predicate glosses
    // both, and the older "non-terminal state" wording named only the first:
    //   - `IHttpOutbox.redeliver` (`HttpRedeliverError`; the operator
    //     redeliver button) refuses a row that is NOT terminal —
    //     `redeliver` means send this AGAIN, so it wants `success`/`failed`/
    //     `dead` (`assertHttpRedeliverable`). Also raised when the producer's
    //     `RedeliverGuard` refuses, or itself throws (fail-closed on purpose:
    //     "we could not check" must never read as "allowed"), and when the
    //     terminal re-check AT THE WRITE misses because a dispatcher tick
    //     re-claimed the row mid-call — both `SqlHttpOutbox` and
    //     `MemoryHttpOutbox` report that miss instead of a false success
    //     (#11009).
    //   - `INotificationOutbox.ack` (`NotificationAckError`; #11453, #11859)
    //     refuses a row that is not `in_flight` — an unclaimed `pending` row
    //     (the ack-as-cancel trap) or an already-terminal one, because `ack`
    //     records the outcome of a delivery the caller CLAIMED — AND, since
    //     #11859, an `in_flight` row no longer held by the claim being
    //     completed: `ack` takes back the record `claim()` returned and the
    //     compare-and-set binds its (`claimed_by`, `claimed_at`) credential,
    //     so a claim lost to the `claimTtlMs` reap plus a re-claim (by ANY
    //     node, including the caller's own later claim) matches nothing and
    //     nothing is written. Also raised for a record handed back carrying
    //     no claim credential at all. BOTH backends raise every one of these
    //     refusals — `SqlNotificationOutbox` and `MemoryNotificationOutbox`,
    //     pinned on one table in
    //     `outbox-ack-claim-ownership.integration.test.ts`.
    // Distinct from DELIVERY_NEVER_SENT: this one says "wrong state for THIS
    // operation, try when it settles"; that one says "never, fix the
    // configuration instead".
    'DELIVERY_NOT_ELIGIBLE',
  ],
  '@objectstack/trigger-api': [
    'ENQUEUE_FAILED',                // queue accepted the call but publish threw
    // [#13353] The hook endpoint's malformed-body refusals — `handleRequest`
    // (`api-trigger.ts`) answers 400 with this code for a body that is not
    // valid JSON or not a JSON object, and the package's OWN plugin serves
    // that `{ status, body }` verbatim (`plugin.ts`, `c.json(out.body,
    // out.status)` on the raw-app `POST .../automation/hooks/:flowName/:hookId`
    // route). Same handler, same door as the two rows beside it — the wire
    // vocabulary is named here, not at some other package's door. Provenance
    // only: the code was already registered (six other packages), so the
    // union, casing and every other row are unchanged.
    'INVALID_REQUEST',
    'INVALID_SIGNATURE',             // hook secret did not verify the request body
  ],
  '@objectstack/cli': [
    // [#13353] The serve command's unknown-hostname guard (`commands/serve.ts`,
    // `unknown-hostname-guard`): a request whose hostname is bound to no
    // environment is answered 404 with this code by the CLI's OWN middleware
    // (`c.json`, the JSON limb beside the HTML one) on a server already
    // serving HTTP. The door is the stamping package itself. Second EMITTER of
    // the code `@objectstack/cloud-connection` already registers — one
    // condition, one vocabulary; provenance, not identity (see above).
    'ENVIRONMENT_NOT_FOUND',
  ],
  '@objectstack/cloud-connection': [
    'CLOUD_FETCH_FAILED',            // fetching the manifest/bundle from cloud failed
    'CLOUD_UNCONFIGURED',            // no cloud endpoint configured on this runtime
    'DEVICE_CODE_FAILED',            // cloud rejected the device-code exchange
    'DRIVER_UNAVAILABLE',            // no driver service — cannot purge seeded rows
    'ENVIRONMENT_BIND_FAILED',
    'ENVIRONMENT_NOT_FOUND',
    // [#13353] `requireInstallCapability`'s 403
    // (`marketplace-install-local-plugin.ts`): a caller without the
    // install-local capability is refused on all four install/uninstall/
    // reseed/purge doors, by the plugin's OWN Hono routes — the same
    // plugin-route door this package's UNIQUE_SCOPE_CONFIRMATION_REQUIRED row
    // below already records. The wire value predates the row (provenance
    // only); the spelling is the #8211-waived FORBIDDEN synonym — the waiver
    // admits the (code, shadows) pair, and this row extends its emitter list,
    // never endorses the spelling for new code.
    'FORBIDDEN',
    'INVALID_REQUEST',
    'MANIFEST_CONFLICT',             // manifest_id already defined by local code
    'MARKETPLACE_PROXY_FAILED',
    'MARKETPLACE_STORAGE_FAILED',    // install-record read/write failed
    'MARKETPLACE_UNAVAILABLE',
    'NOTHING_TO_PURGE',              // package declares no seed datasets
    'PLUGIN_INSTALL_FAILED',
    'PLUGIN_MANIFEST_INVALID',
    'PLUGIN_REGISTER_FAILED',
    'RESEED_NO_ROWS',                // reseed ran but wrote nothing
    'RESEED_SKIPPED',                // reseed declined to run; message carries why
    // [#9246] ADR-0120 D5e posture gate: the marketplace install seam stops an
    // install that declares installation-wide (`'global'`) unique constraints
    // under the `isolated` tenancy posture, 409, until the caller confirms them
    // (`marketplace-install-local-plugin.ts`; message + machine-readable
    // per-index `details.findings`). Emitted by the plugin's OWN Hono route —
    // the `plugin-route` door #9223 surfaced — and READ off the wire:
    // `packages/cli/src/commands/package/install.ts` branches on the literal to
    // print the per-index decision list. Reported by the #8087
    // dispatcher-vocabulary gate once #9223 taught the scan to see a constant
    // in an object literal (`GLOBAL_UNIQUE_CONFIRMATION_REQUIRED`,
    // `packages/types/src/unique-scope-install-gate.ts`); the ledger is
    // door-agnostic.
    'UNIQUE_SCOPE_CONFIRMATION_REQUIRED',
  ],
  '@objectstack/service-settings': [
    'INTERNAL',
    'SETTINGS_ACTION_FAILED',        // a declared action ran and reported ok:false
    'SETTINGS_CRYPTO_UNAVAILABLE',   // [#8273] fail-closed write refusal: declared-encrypted value, nothing confidential wired to encrypt it — a SERVER fault (500, deliberately not 503: no retry succeeds until an operator wires a cryptoProvider; the message carries that fix)
    'SETTINGS_ENGINE_NOT_BOUND',      // pre-bind write refusal: a write reached SettingsService before `bindEngine`, where it would have resolved successfully while nothing reached `sys_setting` (503, temporal — the identical write succeeds one lifecycle phase later; the class carries the status itself because the window closes at `kernel:ready` and no HTTP socket exists until `kernel:listening`, so no door can reach it)
    'SETTINGS_FORBIDDEN',
    'SETTINGS_LOCKED',
    'SETTINGS_UNKNOWN_KEY',
    'SETTINGS_UNKNOWN_NAMESPACE',
    'SETTINGS_VALIDATION',
    'UNKNOWN_KEY',                // wire twin of SETTINGS_UNKNOWN_KEY — candidate for batch-2 unification
    'UNKNOWN_NAMESPACE',
  ],
  '@objectstack/service-automation': [
    'AUTOMATION_UNSCOPED_RUN_DATA_ACCESS',
    'EXECUTION_ERROR',
    'INVALID_SIGNAL',             // resume signal writes engine-internal variables
    'NODE_FAILURE',
    'NO_EXECUTOR',
    'RESUME_IN_PROGRESS',         // duplicate resume refused while the first is running
    'RUN_NOT_FOUND',              // no suspension for this run id — unresumable for good
    'STORE_UNAVAILABLE',          // durable suspended-run store unreadable — existence unknown
  ],
  '@objectstack/service-analytics': [
    'CUBE_NOT_FOUND',
    'DATASET_INVALID',             // [#5367] dataset/selection refusal raised by `dataset-refusal.ts`
    'RAW_SQL_UNSUPPORTED',
    'READ_SCOPE_COMPILE_FAILED',   // [#5367] RLS read-scope lowering failed fail-closed — a SERVER fault (500), never the caller's
  ],
  '@objectstack/service-datasource': [
    'DATASOURCE_ADMIN_ERROR',      // lifecycle/validation refusal from the datasource-admin service
    'EXTERNAL_DATASOURCE_ERROR',   // introspection/connection-test refusal from the external-datasource service
  ],
  '@objectstack/plugin-audit': [
    'FEEDS_DISABLED',
    'FILES_DISABLED',
  ],
  '@objectstack/plugin-approvals': [
    'FORBIDDEN',
    'RECORD_LOCKED',
  ],
  '@objectstack/plugin-security': [
    // [#7474] `controlled_by_parent` declared with no `master_detail` relation.
    // Second EMITTER of the code — `@objectstack/metadata-protocol` already
    // registers for the metadata publish path (`saveMetaItem`); one condition,
    // one vocabulary. Per this file's header, a code emitted by several
    // packages is listed once per emitting package — provenance, not identity
    // (see above; #7504).
    'INVALID_METADATA',
    'SUGGESTION_NOT_FOUND',
    'SUGGESTION_STATE',           // suggestion exists but is not in a confirmable/dismissable state
  ],
  '@objectstack/plugin-webhooks': [
    // [#13353] The redeliver endpoint's malformed-body refusal — the plugin
    // mounts `POST /api/v1/webhooks/redeliver` DIRECTLY on the raw Hono app
    // (`webhook-outbox-plugin.ts`, `registerAdminRoutes`) and answers 400 with
    // this code when the body is not JSON. The door is the stamping package
    // itself (the same raw-app plugin-route door shape as
    // UNIQUE_SCOPE_CONFIRMATION_REQUIRED under cloud-connection); its sibling
    // refusals on the route use standard-catalog members (`UNAUTHENTICATED`,
    // `MISSING_REQUIRED_FIELD`), which need no row. Provenance only: the code
    // was already registered by six other packages.
    'INVALID_REQUEST',
  ],
  '@objectstack/driver-memory': [
    // [#13254] Provenance for the in-memory driver's uniqueness refusal, which
    // #13197 (field-level `unique`) and #13239 (declared `indexes[]` entries)
    // made real: a colliding write is REFUSED rather than landed. Stamped in
    // ONE place for both declaration surfaces — `conflictRefusal`
    // (`packages/drivers/driver-memory/src/memory-unique-constraint.ts`),
    // `code: 'UNIQUE_VIOLATION'` / `status: 409` via the package's exported
    // `UNIQUE_VIOLATION_CODE` / `UNIQUE_VIOLATION_STATUS`.
    //
    // Second EMITTER of the code `@objectstack/rest` already registers for the
    // SQL conflict; the wire identity is deliberately the SAME, so a suite that
    // swaps this driver for SQLite sees ONE envelope. Per this file's header, a
    // code emitted by several packages is listed once per emitting package —
    // provenance, not identity.
    //
    // Wire-reachable by the test the "Retiring a code" section above applies
    // (#8035): an ordinary create/update on an object with a `unique` field
    // reaches `InMemoryDriver.create` on a server already serving HTTP, and
    // `resolveThrownHttpError` puts the driver's `code`/`status` on the
    // envelope. This row adds provenance ONLY: the code was already registered,
    // so the union, its casing and every other package's rows are unchanged.
    // Registered late for exactly the reason the row is worth having — no
    // admission rule checks WHO emits, so an unlisted emitter is invisible to
    // every gate the repo has.
    'UNIQUE_VIOLATION',
  ],
  '@objectstack/driver-sql': [
    // [#11991] The #11756 ruling's refusal (maintainer, 2026-08-25, verbatim
    // 「同意」 on 「C，但 pgnative 归入 Postgres 家族」): a knex client this
    // driver recognises on the PostgreSQL WIRE — `redshift`, `cockroachdb` —
    // reached the DDL path, where emitting Postgres DDL would have built a
    // table of the wrong shape rather than failing. 501, the status
    // `HttpStatusErrorCodeMap` already names for "this server does not do
    // that": the request is well-formed and nothing faulted.
    //
    // Registered — not left driver-local like `MULTI_TENANT_UNSUPPORTED_CODE`
    // — because it IS wire-reachable: publishing a drafted object calls
    // `engine.syncObjectSchema` → `SqlDriver.syncSchema` → the DDL gate, on a
    // server already serving HTTP. That is the exact test #8035 applied when
    // it UNregistered `MONGODB_MULTI_TENANT_UNSUPPORTED` for failing it.
    // Producer: `packages/drivers/driver-sql/src/dialect-emission-refusal.ts`.
    'SQL_DIALECT_EMISSION_UNSUPPORTED',
  ],
  '@objectstack/spec': [
    'CONNECTOR_UPSTREAM_UNAVAILABLE',
    'EXTERNAL_SCHEMA_MISMATCH',
    'EXTERNAL_SCHEMA_MODE_VIOLATION',
    'EXTERNAL_WRITE_FORBIDDEN',
  ],
} as const satisfies Record<string, readonly string[]>;

/** A code registered by at least one package (deduped union of the ledger). */
export type RegisteredErrorCode =
  (typeof ERROR_CODE_LEDGER)[keyof typeof ERROR_CODE_LEDGER][number];

export const REGISTERED_ERROR_CODES: readonly RegisteredErrorCode[] = Object.freeze(
  [...new Set(Object.values(ERROR_CODE_LEDGER).flat())].sort()
) as readonly RegisteredErrorCode[];

/**
 * The complete top-level `error.code` vocabulary (ADR-0112 D4):
 * standard catalog ∪ registered extension codes. This is what
 * `ApiErrorSchema.code` parses against — an unregistered code is a schema
 * failure, not a new dialect.
 */
export const ErrorCode = z.enum(
  [...StandardErrorCode.options, ...REGISTERED_ERROR_CODES] as [string, ...string[]]
) as z.ZodType<StandardErrorCode | RegisteredErrorCode>;

export type ErrorCode = StandardErrorCode | RegisteredErrorCode;

// ==========================================
// Standard-synonym admission rule (#8211)
// ==========================================

/**
 * RFC 9110 / RFC 6585 HTTP reason phrases spelled as SCREAMING_SNAKE — the
 * spellings a producer reaches for when naming a condition after its status
 * line. Where the phrase was renamed across RFC editions both spellings are
 * listed (413, 422). Deliberately the FULL table, not just the statuses the
 * catalog names: whether a phrase is a synonym is decided against
 * {@link HttpStatusErrorCodeMap} at detection time, so extending that map
 * automatically extends this gate — no second list to keep in sync.
 */
const HTTP_REASON_PHRASE_STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTHENTICATION_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  CONTENT_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  MISDIRECTED_REQUEST: 421,
  UNPROCESSABLE_ENTITY: 422,
  UNPROCESSABLE_CONTENT: 422,
  LOCKED: 423,
  FAILED_DEPENDENCY: 424,
  TOO_EARLY: 425,
  UPGRADE_REQUIRED: 426,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  VARIANT_ALSO_NEGOTIATES: 506,
  INSUFFICIENT_STORAGE: 507,
  LOOP_DETECTED: 508,
  NOT_EXTENDED: 510,
  NETWORK_AUTHENTICATION_REQUIRED: 511,
};

/**
 * The standard-catalog member a registered code is a SEMANTIC SYNONYM of, or
 * `undefined` when it is not one (#8211).
 *
 * A CLOSED, mechanical criterion — two prongs, no distance metrics, no
 * wordlists, so every verdict is reproducible from this file alone:
 *
 * 1. **Reason-phrase alias.** The code is the SCREAMING_SNAKE spelling of an
 *    HTTP reason phrase whose status {@link HttpStatusErrorCodeMap} maps to a
 *    standard member: `FORBIDDEN` → 403 → `PERMISSION_DENIED`. Deliberately
 *    judged against the explicit map only, never the
 *    `standardErrorCodeForHttpStatus` bucket fallback — a phrase for a status
 *    the catalog does not name (`PAYLOAD_TOO_LARGE`, 413) is NOT a synonym,
 *    because no member covers its condition.
 * 2. **Token subset.** Every `_`-token of the code appears in one standard
 *    member's name (`CONFLICT` ⊆ `RESOURCE_CONFLICT`, `INTERNAL` ⊆
 *    `INTERNAL_ERROR`): the code says nothing the member's own name does not
 *    already say. First match in catalog order wins — the generic member leads
 *    each status block by construction. A domain-prefixed code
 *    (`FORM_NOT_FOUND`) carries a token no member has, and is exactly the
 *    shape the registration instructions endorse.
 *
 * Under-matching is the accepted cost of a closed criterion: a synonym neither
 * prong catches (`CONCURRENT_UPDATE` beside `CONCURRENT_MODIFICATION`) is
 * admitted. Extend a prong deliberately when a new class is measured — never
 * with fuzz. A detector that only passes on today's tree would be this card's
 * own failure mode; the admission gate pins rejection of a newly-introduced
 * synonym for both prongs.
 */
export function standardSynonymOf(code: string): StandardErrorCode | undefined {
  const status = HTTP_REASON_PHRASE_STATUS[code];
  if (status !== undefined) {
    const member = HttpStatusErrorCodeMap[status];
    if (member !== undefined && member !== code) return member;
  }
  const tokens = code.split('_');
  for (const member of StandardErrorCode.options) {
    if (member === code) continue;
    const memberTokens = new Set<string>(member.split('_'));
    if (tokens.every((token) => memberTokens.has(token))) return member;
  }
  return undefined;
}

/**
 * A recorded admission waiver: why a registered code that
 * {@link standardSynonymOf} flags as a semantic synonym of a standard-catalog
 * member stays registered anyway (#8211). A waiver names the member it
 * shadows and carries a reviewable reason — admission is a decision on the
 * record, never drift. It keeps a WIRE VALUE registered; it does not endorse
 * the spelling for new code.
 */
export const StandardSynonymWaiverSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/)
    .describe('The registered extension code the waiver keeps admissible'),
  shadows: StandardErrorCode
    .describe('The standard-catalog member whose condition the code re-spells'),
  reason: z.string().min(1)
    .describe('Why the synonym stays registered — recorded so admission is a decision, not drift'),
});

export type StandardSynonymWaiver = z.input<typeof StandardSynonymWaiverSchema>;

/**
 * The grandfathered pre-gate synonyms (#8211, adjudicated 2026-08-12, option
 * C). Every entry is on the wire today; consolidating any onto the member it
 * shadows would change what clients read (`@objectstack/client` surfaces
 * `error.code` verbatim) and is DEFERRED — option B — until a specific code
 * has a measured victim. The admission gate holds each waiver live: a waiver
 * whose code is no longer registered, or that the detector no longer flags as
 * a synonym of exactly the member it names, fails the suite and comes out.
 */
export const STANDARD_SYNONYM_WAIVERS: readonly StandardSynonymWaiver[] = [
  {
    code: 'CONFLICT',
    shadows: 'RESOURCE_CONFLICT',
    reason: 'Pre-gate synonym on the wire (respondSharingError 409 arm; registered by #8111). ' +
      'Wire value kept; consolidation deferred per #8211.',
  },
  {
    code: 'FORBIDDEN',
    shadows: 'PERMISSION_DENIED',
    reason: 'Pre-gate synonym on the wire from @objectstack/rest, plugin-sharing and ' +
      'plugin-approvals; #13353 added the cloud-connection provenance row for the same ' +
      'pre-existing wire value (its marketplace-install plugin-route 403). ' +
      'Wire value kept; consolidation deferred per #8211.',
  },
  {
    code: 'INTERNAL',
    shadows: 'INTERNAL_ERROR',
    reason: 'Pre-gate synonym on the wire from five packages. Wire value kept; ' +
      'consolidation deferred per #8211.',
  },
  {
    code: 'NOT_FOUND',
    shadows: 'RESOURCE_NOT_FOUND',
    reason: 'Pre-gate synonym on the wire from @objectstack/rest and plugin-sharing. ' +
      'Wire value kept; consolidation deferred per #8211.',
  },
  {
    code: 'UNAUTHORIZED',
    shadows: 'UNAUTHENTICATED',
    reason: 'Pre-gate synonym (401 reason phrase) on the wire from @objectstack/rest — ' +
      'surfaced by the detector when the #8211 gate landed, beyond the four the card named; ' +
      'same class, same grandfather rationale. Wire value kept; consolidation deferred per #8211.',
  },
];

/** One unwaived semantic-synonym registration, as reported by {@link standardSynonymViolations}. */
export interface StandardSynonymViolation {
  /** The ledger owner key registering the offending code. */
  package: string;
  /** The registered code that re-spells a standard member's condition. */
  code: string;
  /** The standard-catalog member the code is a synonym of. */
  shadows: StandardErrorCode;
}

/**
 * Every ledger row whose code {@link standardSynonymOf} flags as a semantic
 * synonym of a standard-catalog member without a matching
 * {@link STANDARD_SYNONYM_WAIVERS} entry (#8211). Empty on an admissible
 * ledger — the admission gate in `error-code-ledger.test.ts` asserts exactly
 * that, and pins that this same function goes red when a new synonym lands.
 * A waiver admits only the exact `(code, shadows)` pair it records.
 */
export function standardSynonymViolations(
  ledger: Record<string, readonly string[]> = ERROR_CODE_LEDGER,
  waivers: readonly StandardSynonymWaiver[] = STANDARD_SYNONYM_WAIVERS,
): StandardSynonymViolation[] {
  const waived = new Map(waivers.map((waiver) => [waiver.code, waiver.shadows]));
  const violations: StandardSynonymViolation[] = [];
  for (const [pkg, codes] of Object.entries(ledger)) {
    for (const code of codes) {
      const shadows = standardSynonymOf(code);
      if (shadows === undefined) continue;
      if (waived.get(code) === shadows) continue;
      violations.push({ package: pkg, code, shadows });
    }
  }
  return violations;
}

// ==========================================
// Provenance waivers (#13353)
// ==========================================

/**
 * A recorded provenance waiver: why a package whose non-test source stamps a
 * REGISTERED code deliberately carries no owner-key row for it (#13353).
 *
 * The provenance gate (`check:error-code-provenance`,
 * `packages/spec/scripts/`) fails any stamp site of a registered code that the
 * stamping package's own owner key does not list — the drift three hand
 * sweeps (#7504, #13254, #13353) each re-found. But "stamps the string" and
 * "owns the wire emission" are different facts, and the ledger already records
 * decisions where they diverge. A waiver keeps that divergence a decision on
 * the record, in the same file the rows live in, exactly as
 * {@link STANDARD_SYNONYM_WAIVERS} does for the synonym rule. Three recorded
 * shapes:
 *
 * - **The door, not the producer, names the wire vocabulary.** The stamped
 *   value is read by a door in ANOTHER package, which owns — and registers —
 *   the wire emission (`FLOW_DISABLED` et al. under `@objectstack/runtime`;
 *   `EXTERNAL_IMPORT_ERROR` under `@objectstack/rest`, whose import route's
 *   catch stamps the code itself for every `importObject` throw).
 * - **A shared constructor one package over from its registered emitter.**
 *   The helper that spells the string lives in a dependency-light package by
 *   design (#8016), and the package whose production path throws/serves it is
 *   the one registered (`UPDATE_ID_MISMATCH` under `@objectstack/objectql`,
 *   stamped by metadata-core's helper).
 * - **Client-side synthesis.** The SDK mirrors a code the SERVER registers so
 *   caller branches fire identically; the ledger's scope prose is about the
 *   serving side (`UPLOAD_SESSION_EXPIRED`).
 *
 * A waiver admits exactly the `(package, code)` pair it records, and the gate
 * holds each one live in three directions: the named `registeredUnder` key
 * must still list the code, the waived package must still NOT list it (a row
 * plus a waiver is dead weight), and the scan must still find a stamp site for
 * the pair (a waiver whose site is gone comes out with it).
 */
export const ProvenanceWaiverSchema = z.object({
  package: z.string().regex(/^@objectstack\/[a-z0-9-]+$/)
    .describe('The package whose source stamps the code without an owner-key row'),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/)
    .describe('The registered code the package stamps'),
  registeredUnder: z.string().regex(/^@objectstack\/[a-z0-9-]+$/)
    .describe('The owner key that deliberately carries the row instead'),
  reason: z.string().min(1)
    .describe('Why the stamping package carries no row — recorded so provenance is a decision, not drift'),
});

export type ProvenanceWaiver = z.input<typeof ProvenanceWaiverSchema>;

/**
 * The recorded provenance waivers. Every entry is a decision with its evidence
 * — most were written down in the rows' own comments long before the gate
 * existed and are transcribed here so a machine can hold them; the
 * `EXTERNAL_IMPORT_ERROR` and `UPLOAD_SESSION_EXPIRED` entries were
 * adjudicated on #13353 itself.
 */
export const PROVENANCE_WAIVERS: readonly ProvenanceWaiver[] = [
  {
    package: '@objectstack/metadata-core',
    code: 'UPDATE_ID_MISMATCH',
    registeredUnder: '@objectstack/objectql',
    reason: 'Shared constructor one package over: metadata-core\'s ' +
      '`engineUpdateDispatchRejectError` spells the string, but the throw ships in ' +
      'production from `ObjectQL.update` (engine.ts) — the objectql row\'s own comment ' +
      'records "hence registered here" (#11142/#11230).',
  },
  {
    package: '@objectstack/service-automation',
    code: 'FLOW_DISABLED',
    registeredUnder: '@objectstack/runtime',
    reason: 'The trigger door, not the producer, names the wire vocabulary: the engine ' +
      'returns `AutomationResult.code` and runtime\'s doors read it and answer 409 ' +
      '(#9415/#9446; the runtime row\'s comment records the decision).',
  },
  {
    package: '@objectstack/service-automation',
    code: 'FLOW_NO_START_NODE',
    registeredUnder: '@objectstack/runtime',
    reason: 'Same decision as FLOW_DISABLED, 422 arm (#9415/#9446): the trigger door ' +
      'names the wire vocabulary; the engine result carries the classification.',
  },
  {
    package: '@objectstack/service-automation',
    code: 'FLOW_INPUT_SCHEMA_INVALID',
    registeredUnder: '@objectstack/runtime',
    reason: 'Registered ahead of its producer by design (#10025 → #11504, the #10413 → ' +
      '#10576 split shape): the engine\'s `execute()` catch classifies the refusal, the ' +
      'trigger door serves it — the runtime row\'s comment records "registered HERE and ' +
      'not under the engine\'s package" with its three FLOW_* siblings.',
  },
  {
    package: '@objectstack/service-datasource',
    code: 'EXTERNAL_IMPORT_ERROR',
    registeredUnder: '@objectstack/rest',
    reason: 'Adjudicated on #13353: the only door for `importObject` is rest\'s ' +
      '`POST …/tables/:remote/import` (external-datasource-routes.ts), whose catch stamps ' +
      'this code itself for EVERY importObject throw and never reads the producer\'s ' +
      'declaration — the door names the wire vocabulary. The producer\'s `err.code` ' +
      '(`importNameRefusedError`) is the #8016 declaration shape, agreeing with the door ' +
      'by construction, not a second wire emitter.',
  },
  {
    package: '@objectstack/client',
    code: 'UPLOAD_SESSION_EXPIRED',
    registeredUnder: '@objectstack/service-storage',
    reason: 'Client-side synthesis (#7870): `resumeUpload` mirrors the server\'s 410 pair ' +
      'when the progress poll reports `expired`, so caller branches fire identically. The ' +
      'ledger\'s scope prose covers the SERVING side; whether a client-synthesised code ' +
      'belongs in the ledger at all is the open scope question #13353 recorded — ' +
      'deliberately a waiver, not a row, until that question is ruled.',
  },
  {
    package: '@objectstack/spec',
    code: 'ITEM_LOCKED',
    registeredUnder: '@objectstack/metadata-protocol',
    reason: 'Shared evaluator one package over: `evaluateLockForWrite`/`…ForDelete` ' +
      '(kernel/metadata-protection.zod.ts) construct the structured refusal, and the ' +
      'protocol layer — the registered emitter — turns it into the 403 the wire carries ' +
      '(ADR-0010 §3.3). Spec ships schemas and pure helpers, never an HTTP door.',
  },
  {
    package: '@objectstack/types',
    code: 'VALIDATION_FAILED',
    registeredUnder: '@objectstack/runtime',
    reason: 'Shared constructor by design (#8016/#3918): `validationFailure()` lives in ' +
      'the dependency-light package so BOTH doors recognise one shape; the throws are ' +
      'served under the emitting doors\' own registrations (runtime\'s dispatcher exits, ' +
      'rest\'s `mapDataError` — both packages list the code).',
  },
];
