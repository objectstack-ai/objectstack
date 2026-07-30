// #3896 follow-up — the empty-state semantics registry.
//
// WHY THIS EXISTS
//
// `sys_sharing_rule.criteria_json` was optional, and its absence evaluated as
// `find(object, { filter: {} })` — every record of the object, granted to the
// recipient. The field description said so out loud: *"leave empty to share
// every record."* That sentence was not documenting a feature; it was naming a
// bug, and it sat in the spec for anyone — human or model — to read as the
// contract. #3929 closed the three write paths and made the evaluator
// fail-closed.
//
// The instance is fixed. The CLASS is what this registry governs.
//
// Across the spec, the same syntactic shape — an optional list or predicate that
// "restricts" something — carries opposite meanings when it is empty:
//
//   object.apiMethods       `undefined` = unrestricted, `[]` = deny-all   (closed on empty)
//   allowedSources          "(empty = all allowed)"  — REMOVED with its schema (#3896 follow-up)
//   sharing criteria        was match-all, now matches nothing            (closed on empty)
//
// Nothing in the metadata distinguishes them. A maintainer knows by memory which
// is which; a model authoring metadata cannot, and guessing wrong is silent and
// permissive. So: a permissive empty state may still be declared, but never
// *silently* — it must be classified here, with a reason.
//
// This module is the single source of truth and is deliberately split from the
// scanner so the classification is unit-testable without touching the filesystem
// (same rationale as `proof-registry.mts`).

/**
 * What the empty/absent state of a restriction-shaped property MEANS.
 *
 * The distinction that matters is not list-vs-predicate, it is **does this
 * property gate access**. A scope selector may safely mean "all" when empty; an
 * access gate may not, unless someone decided so on purpose and said why.
 */
export type EmptyStateSemantics =
  /**
   * Selects a range of work — which objects to replicate, which events to
   * replay, which types an action applies to. Empty = all is correct and often
   * the safe direction. Not an access decision.
   */
  | 'scope'
  /**
   * An access gate whose empty state DENIES. The required posture for any new
   * gate: the most likely authoring error (omission) must land on the least
   * privilege.
   */
  | 'closed'
  /**
   * An access gate that is default-OPEN on purpose. Legitimate — an object with
   * no API whitelist is exposed, because exposure is the CRUD default — but it
   * is the shape that produced #3896, so it carries a mandatory rationale and
   * must state its full contract (what absent means AND what empty means).
   */
  | 'open'
  /**
   * Not authorable: a computed projection the engine emits (an explain trace, a
   * server-resolved effective set). Its empty-state prose describes a RESULT,
   * not a policy anyone writes. Registered so the scanner stays quiet without
   * pretending these are gates.
   */
  | 'output';

export interface EmptyStateEntry {
  /** Repo-relative path of the schema file (`packages/spec/src/...`). */
  file: string;
  /** The property the permissive-empty statement describes. */
  property: string;
  /** What the empty state means, and therefore how careless authoring fails. */
  semantics: EmptyStateSemantics;
  /** Why this classification is right. Mandatory — the whole point is that it was decided, not defaulted. */
  rationale: string;
  /**
   * For `closed` / `open`: where the posture actually lives. Repo-rooted paths
   * are resolved by the gate (same rules as the liveness ledger's `evidence`),
   * so a pointer that rots is reported rather than trusted.
   */
  evidence?: string;
}

/**
 * Every permissive-empty declaration in the spec surface, classified.
 *
 * Adding a new one is intentionally a little annoying: that friction is the
 * feature. If a property's empty state means "everything", someone has to write
 * down why that is safe.
 */
export const EMPTY_STATE_REGISTRY: EmptyStateEntry[] = [
  // ---- Access gates ------------------------------------------------------

  {
    file: 'packages/spec/src/data/object.zod.ts',
    property: 'apiMethods',
    semantics: 'open',
    rationale:
      'Deliberate default-open, and the reference example of stating it fully: `undefined` = unrestricted (an object is API-exposed unless it opts into a whitelist — exposure is the CRUD default), `[]` = deny-all, a subset = the derived closure (#3391/#3543). The empty ARRAY is closed; only ABSENCE is open. That two-part contract is what makes it safe to author against, and object.zod.ts additionally emits a ⚠ in its describe text when stripping leaves the whitelist empty.',
    evidence: 'packages/spec/src/data/api-derivation.ts',
  },
  {
    file: 'packages/spec/src/security/sharing.zod.ts',
    property: 'condition',
    semantics: 'closed',
    rationale:
      "The #3896 outcome, recorded so the answer is findable: a sharing rule's criteria is REQUIRED, and a rule that reaches storage without one grants nothing. There is no 'share every record' rule — object-wide read is the object's organization-wide default (`sharingModel`); the match-all shape only ever existed as a failure mode. Since ADR-0113 the requirement is DECLARATIVE too: `sys_sharing_rule.criteria_json` carries `required: true` (write contract — legacy null rows rest, no NOT NULL migration), with the hook guard narrowed to the non-null match-all shapes `required` cannot express. Carries no permissive statement to scan (that is what being closed means), so it is exempt from the staleness check and exists purely as the catalogue answer to 'what does an empty criteria do?'.",
    evidence: 'packages/spec/src/security/sharing.zod.ts; packages/plugins/plugin-sharing/src/objects/sys-sharing-rule.object.ts (criteria_json required: true, ADR-0113); packages/plugins/plugin-sharing/src/rule-hooks.ts (shape guard)',
  },

  {
    file: 'packages/plugins/plugin-security/src/objects/sys-user-permission-set.object.ts',
    property: 'organization_id',
    semantics: 'open',
    rationale:
      "A NULL organization scope on a user↔permission-set grant means the grant is UNSCOPED — it applies in every org context. Deliberate and load-bearing rather than an oversight: ADR-0095 D3 / ADR-0068 D2 DERIVE the platform_admin posture from an unscoped `admin_full_access` user grant specifically, and an org-SCOPED grant of the same set must not confer it. So the empty state is not merely wider, it is the distinguishing input to the highest privilege in the system — which is exactly why it belongs on this list rather than being left to memory. `explain-engine.ts` recomputes the identical predicate on purpose so the explain panel's posture cannot sit higher than enforcement's.",
    evidence:
      'packages/core/src/security/resolve-authz-context.ts (resolveAuthzContext.hasPlatformAdminGrant — the single source of truth) and packages/plugins/plugin-security/src/explain-engine.ts (the identical predicate, replicated so the panel cannot overstate)',
  },

  // ---- Scope selectors ---------------------------------------------------

  {
    file: 'packages/spec/src/system/disaster-recovery.zod.ts',
    property: 'includeObjects',
    semantics: 'scope',
    rationale:
      'Which objects a DR replica covers. Empty = all is both correct and the safe direction: an under-specified DR config replicates more than needed, never less.',
  },
  {
    file: 'packages/spec/src/kernel/events/queue.zod.ts',
    property: 'eventTypes',
    semantics: 'scope',
    rationale: 'Replay filter for a dead-letter/replay operation. Selects work to redo; grants nothing.',
  },
  {
    file: 'packages/spec/src/kernel/events/queue.zod.ts',
    property: 'targetHandlers',
    semantics: 'scope',
    rationale: 'Replay filter for a dead-letter/replay operation. Selects work to redo; grants nothing.',
  },
  {
    file: 'packages/spec/src/api/rest-server.zod.ts',
    property: 'includeObjects',
    semantics: 'scope',
    rationale:
      'Which objects get generated REST routes. Route existence is not authorization — the generated routes still run the full permission stack, so a wider set is not a wider grant.',
  },
  {
    file: 'packages/spec/src/data/object.zod.ts',
    property: 'stageField',
    semantics: 'scope',
    rationale:
      '[ADR-0085] Absence permits stage heuristics to infer the lifecycle field; `false` suppresses them. It selects how the renderer guesses, not who may read anything.',
  },
  {
    file: 'packages/spec/src/ui/page.zod.ts',
    property: 'columns',
    semantics: 'scope',
    rationale:
      'Blank shows every object field on the page. Presentation breadth, not authorization: field-level security is enforced downstream, so a page that lists all fields still renders only the ones the viewer may read. (It is the "empty = everything" shape though — if FLS ever stops being the gate here, this becomes a `closed` question, not a `scope` one.)',
  },
  {
    file: 'packages/spec/src/studio/plugin.zod.ts',
    property: 'metadataTypes',
    semantics: 'scope',
    rationale: 'Which metadata types a Studio action offers itself for. An authoring-surface affordance, not an access decision.',
  },
  {
    file: 'packages/spec/src/automation/flow.zod.ts',
    property: 'errorCode',
    semantics: 'scope',
    rationale:
      'Which error a catch node handles; empty catches all of them. Catching broadly is the safe direction for an error handler — the failure mode of the opposite default is an unhandled fault, not an over-grant.',
  },
  {
    file: 'packages/spec/src/ai/knowledge-source.zod.ts',
    property: 'mimeTypes',
    semantics: 'scope',
    rationale:
      'Which files under a storage prefix get indexed into a knowledge source. Ingestion scope, not read authorization — retrieval is gated separately. NOTE the shape though: it is a vacuous-allow-list ("allow-list" whose empty value admits everything), the same shape as #3896. `storage.zod.ts` models the identical concept the better way — an explicit `mode: "whitelist"` discriminator plus `.min(1)`, so an empty whitelist cannot be expressed at all. Prefer that form for new allow-lists; changing this one is a breaking change to an authorable field and is not in scope here.',
  },

  // ---- Engine output, not authorable -------------------------------------

  {
    file: 'packages/spec/src/security/explain.zod.ts',
    property: 'predicate',
    semantics: 'output',
    rationale:
      'The row predicate a rule contributed, as reported by the explain engine. `null` = unrestricted describes what the engine COMPUTED, not a policy an author writes — and the same schema spells out the opposite pole (`__deny_all__` = zero rows), so the trace is unambiguous to read.',
  },
  {
    file: 'packages/spec/src/security/explain.zod.ts',
    property: 'rowFilter',
    semantics: 'output',
    rationale:
      'The effective row predicate a layer contributed. Same as `predicate`: a computed diagnostic projection, paired with an explicit `__deny_all__` sentinel for the closed pole.',
  },
  {
    file: 'packages/spec/src/security/explain.zod.ts',
    property: 'readFilter',
    semantics: 'output',
    rationale:
      'The machine artifact behind the human-readable explain prose. Same computed-projection reasoning as `predicate` / `rowFilter`.',
  },
  {
    file: 'packages/spec/src/security/permission.zod.ts',
    property: 'apiOperations',
    semantics: 'output',
    rationale:
      'The server-resolved EFFECTIVE operation set, present only when the object tightens exposure via `apiMethods`. Absent = default-allow mirrors the authorable `apiMethods` contract it is derived from; the frontend renders this set and never the raw whitelist.',
  },
];
