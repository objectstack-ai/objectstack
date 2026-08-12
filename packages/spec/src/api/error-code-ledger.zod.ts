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
 * A code emitted by several packages is listed once per emitting package —
 * the union dedupes; the per-package rows are provenance, not identity.
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
 * code). Before deleting a row, check that no producer remains repo-wide AND
 * that no consumer — including `objectui` and `cloud` — reads the literal;
 * tests that merely CONSTRUCT the code are not producers, and a test pinned to
 * a producerless code is pinning nothing (#4984's phantom-check family).
 *
 * Field-level codes (`FieldErrorSchema.code`, the `fields[]` array) are a
 * SEPARATE vocabulary and do not belong here — see #3977 (ADR-0112 D6).
 */

import { z } from 'zod';
import { StandardErrorCode } from './errors.zod';

export const ERROR_CODE_LEDGER = {
  '@objectstack/rest': [
    'ALREADY_REVERTED',
    'AMBIGUOUS_MATCH',            // import row matched more than one record
    'ANALYTICS_QUERY_FAILED',
    'APPROVAL_ACTIONS_FAILED',
    'APPROVAL_RECALL_FAILED',
    'APPROVAL_REQUEST_GET_FAILED',
    'APPROVAL_REQUEST_LIST_FAILED',
    'BATCH_NOT_ATOMIC',
    'BATCH_TOO_LARGE',
    'BATCH_UNRESOLVED_REF',
    'BLANK_MATCH_KEY',
    'CONCURRENT_UPDATE',
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
    'UNAUTHORIZED',
    'UNIQUE_VIOLATION',
    'UNSUPPORTED_TRANSFORM',
    'VALIDATION_FAILED',          // record-level validation; carries `fields[]` (#3977)
  ],
  '@objectstack/runtime': [
    'EXPIRED_OR_REVOKED',         // share link
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
    'SSO_REGISTER_FAILED',
    'SSO_REGISTER_FORBIDDEN',
    'USER_ALREADY_EXISTS',        // pass-through from better-auth
    'VALIDATION_FAILED',
  ],
  '@objectstack/plugin-sharing': [
    'AUDIENCE_NOT_ALLOWED',
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
    'SHARING_NOT_ENABLED',
    'SIGN_IN_REQUIRED',
    'UNSUPPORTED',
    'VALIDATION_FAILED',
    'WRONG_PASSWORD',
  ],
  '@objectstack/metadata-protocol': [
    'BATCH_ABORTED',              // sibling item in an all-or-nothing publish; it never ran
    'CLONE_DISABLED',
    'COMMIT_NOT_FOUND',
    'CONCURRENT_UPDATE',
    'DESTRUCTIVE_CHANGE',         // change would drop data; needs an explicit opt-in
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
    'ROLLED_BACK',             // atomic data-batch row was written, then undone by the batch rollback (#4793)
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
    'ERR_BULK_RESULT_MISMATCH',
    'ERR_DATASOURCE_UNAVAILABLE',
    'ERR_DRIVER_CONNECT',
    'ERR_READONLY_FIELD_REJECTED', // strictReadonlyWrites: the write would strip caller-supplied fields, so it was refused (#5126; since #6437 that covers the primary_key strip too — one code, `drops` carries the per-reason breakdown)
    'ERR_SUMMARY_RECOMPUTE',
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
    'DELIVERY_NOT_ELIGIBLE',         // delivery row is in a non-terminal state
  ],
  '@objectstack/trigger-api': [
    'ENQUEUE_FAILED',                // queue accepted the call but publish threw
    'INVALID_SIGNATURE',             // hook secret did not verify the request body
  ],
  '@objectstack/cloud-connection': [
    'CLOUD_FETCH_FAILED',            // fetching the manifest/bundle from cloud failed
    'CLOUD_UNCONFIGURED',            // no cloud endpoint configured on this runtime
    'DEVICE_CODE_FAILED',            // cloud rejected the device-code exchange
    'DRIVER_UNAVAILABLE',            // no driver service — cannot purge seeded rows
    'ENVIRONMENT_BIND_FAILED',
    'ENVIRONMENT_NOT_FOUND',
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
  ],
  '@objectstack/service-settings': [
    'INTERNAL',
    'SETTINGS_ACTION_FAILED',        // a declared action ran and reported ok:false
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
  '@objectstack/spec': [
    'CONNECTOR_UPSTREAM_UNAVAILABLE',
    'EXTERNAL_SCHEMA_MISMATCH',
    'EXTERNAL_SCHEMA_MODE_VIOLATION',
    'EXTERNAL_WRITE_FORBIDDEN',
  ],
  '@objectstack/driver-mongodb': [
    'MONGODB_MULTI_TENANT_UNSUPPORTED',
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
