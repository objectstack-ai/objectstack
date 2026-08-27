// ADR-0054 — the prove-it-runs registry.
//
// ADR-0049 closed *false compliance* (a property declared but unenforced). The
// liveness ledger (#1919) then made every authorable property declare a status
// with evidence. But "live" means only "a consumer reads it" — a static pointer.
// ADR-0054 adds the third leg: for a defined class of HIGH-RISK authorable
// properties, a `live` classification must carry a **proof** — a reference to a
// `@objectstack/dogfood` test that authors the property against the real
// in-process stack and asserts the runtime outcome.
//
// This module is the single source of truth for:
//   1. the authoritative high-risk-class list (ADR-0054 §2a), and
//   2. which ledger entries are CI-ENFORCED to carry a proof this rollout phase
//      (the ratchet lands one class at a time as its matrix is populated — §3).
//
// It is split out from check-liveness.mts so the proof contract is unit-testable
// without booting the metadata-type registry.

/** A reference to a dogfood proof: `<repo-relative-file>#<proof-id>`. */
export type ProofRef = string;

/** A ledger entry path the ratchet binds: `<type>.<path>` (one drill level). */
export interface LedgerBinding {
  type: string; // governed metadata type (e.g. 'field')
  path: string; // property path within that type (e.g. 'type', 'rowLevelSecurity.using')
}

export interface HighRiskClass {
  /** Stable class id (ADR-0054 §2a class). */
  id: string;
  /** Human label. */
  label: string;
  /** The end-to-end break this class guards — why a static consumer pointer is insufficient. */
  summary: string;
  /** Canonical `@proof:` tag id the dogfood test self-declares. */
  proofId: string;
  /** The proof reference (`file#id`), or null when the class has no runtime proof yet. */
  proofRef: ProofRef | null;
  /**
   * Whether the ratchet is CI-ENFORCED for this class THIS phase. ADR-0054 §3:
   * "CI binding lands incrementally … one class at a time as its matrix is
   * populated." A class is `bound` only once it has BOTH a runtime proof AND a
   * governed ledger entry to carry it.
   */
  bound: boolean;
  /** Ledger entries that must carry `proofRef` when their status is `live`. */
  ledgerBindings: LedgerBinding[];
  /** When `bound` is false, why — kept honest rather than faking a binding. */
  blockedReason?: string;
}

// The authoritative high-risk-class list (ADR-0054 §2a). Classes whose values
// cross the engine↔driver↔service↔HTTP boundary and have repeatedly broken in
// *integration* despite green unit tests. Two are bound this phase (their matrix
// exists AND their surface is governed); three are listed-but-blocked, honestly.
export const HIGH_RISK_CLASSES: HighRiskClass[] = [
  {
    id: 'field-type',
    label: 'Field types',
    summary:
      'persistence + read-coercion fidelity across the field-type matrix (write 4 → read 4, not "4").',
    proofId: 'field-type-roundtrip',
    proofRef: 'packages/qa/dogfood/test/field-zoo-roundtrip.dogfood.test.ts#field-type-roundtrip',
    bound: true,
    ledgerBindings: [{ type: 'field', path: 'type' }],
  },
  {
    id: 'rls-sharing',
    label: 'RLS / sharing',
    summary:
      "row-level read AND by-id-write enforcement (the #1994 can't-write-what-you-can't-read invariant).",
    proofId: 'rls-by-id-write',
    proofRef: 'packages/qa/dogfood/test/rls-fixture.dogfood.test.ts#rls-by-id-write',
    bound: true,
    // `using` is the read predicate the #1994 fix re-applies as a by-id-write
    // pre-image check — the property whose end-to-end correctness the proof guards.
    ledgerBindings: [{ type: 'permission', path: 'rowLevelSecurity.using' }],
  },
  {
    id: 'sharing-controlled-by-parent',
    label: 'Master-detail controlled-by-parent',
    summary: "a detail record's read/write access derived from its master record (ADR-0055).",
    proofId: 'cbp-controlled-by-parent',
    proofRef: 'packages/qa/dogfood/test/controlled-by-parent.dogfood.test.ts#cbp-controlled-by-parent',
    bound: true,
    ledgerBindings: [{ type: 'object', path: 'sharingModel' }],
  },
  {
    id: 'analytics',
    label: 'Analytics dimensions / measures',
    summary: 'date-dimension bucketing / aggregation under the org timezone (#1982/#2018).',
    proofId: 'analytics-tz-bucketing',
    proofRef: 'packages/qa/dogfood/test/analytics-timezone.dogfood.test.ts#analytics-tz-bucketing',
    bound: true,
    // The org-timezone shift acts on a time dimension's bucketing granularity —
    // the property whose end-to-end correctness the tz proof guards.
    ledgerBindings: [{ type: 'dataset', path: 'dimensions.dateGranularity' }],
  },
  {
    id: 'flow-node',
    label: 'Flow nodes',
    summary: 'node execution + variable wiring through the automation engine.',
    proofId: 'flow-node-execution',
    proofRef: 'packages/qa/dogfood/test/flow-node.dogfood.test.ts#flow-node-execution',
    bound: true,
    // `nodes.type` selects which executor runs — the property whose end-to-end
    // execution + variable wiring the proof guards.
    ledgerBindings: [{ type: 'flow', path: 'nodes.type' }],
  },
  {
    id: 'flow-runas',
    label: 'Flow runAs identity',
    summary: 'flow.runAs switches the data-layer execution identity — system elevates (RLS-bypass), user de-elevates to the triggering user (#1888).',
    proofId: 'flow-runas-identity',
    proofRef: 'packages/qa/dogfood/test/flow-runas.dogfood.test.ts#flow-runas-identity',
    bound: true,
    // `runAs` decides whether CRUD nodes run as an elevated system principal or
    // the triggering user — the security property the proof guards in both directions.
    ledgerBindings: [{ type: 'flow', path: 'runAs' }],
  },
  {
    id: 'delegation',
    label: 'Delegation of duty',
    summary:
      'a non-admin holder of a delegatable position may self-service a time-boxed grant that dies at valid_until (ADR-0091 D3) — the write is gated and the resolution expires, both proven end-to-end.',
    proofId: 'delegation-of-duty',
    proofRef: 'packages/qa/dogfood/test/delegation-of-duty.dogfood.test.ts#delegation-of-duty',
    bound: true,
    // `delegatable` opens the D12 self-service branch — an authority-widening
    // flag whose end-to-end enforcement (gated write + expiring resolution) a
    // static consumer pointer cannot vouch for.
    ledgerBindings: [{ type: 'position', path: 'delegatable' }],
  },
  {
    id: 'data-lifecycle',
    label: 'Data lifecycle (ADR-0057)',
    summary:
      'declared lifecycle policies actually bound growth at runtime — the Reaper deletes past-window rows, record-class/business data stays untouched, archive-declared audit ledgers are never hot-deleted unarchived.',
    proofId: 'adr0057-lifecycle-bounded-growth',
    proofRef: 'packages/qa/dogfood/test/storage-growth.dogfood.test.ts#adr0057-lifecycle-bounded-growth',
    bound: true,
    // `lifecycle` declares the retention contract the LifecycleService enforces —
    // a declaration whose sweeper stopped running is dead surface (ADR-0049).
    ledgerBindings: [{ type: 'object', path: 'lifecycle' }],
  },
  {
    id: 'readonly-static-write',
    label: 'Static readonly write enforcement',
    summary:
      'a statically `readonly: true` field cannot be forged by a non-system UPDATE — the write is stripped server-side, not merely hidden by the form (#2948/#3003: approval/status/amount columns "protected" only by readonly were one direct PATCH away from self-approval).',
    proofId: 'readonly-static-write',
    proofRef: 'packages/qa/dogfood/test/showcase-static-readonly.dogfood.test.ts#readonly-static-write',
    bound: true,
    // `readonly` was renderer-only until #2948 — declared ≠ enforced is exactly
    // the false-compliance class ADR-0049 closes. The proof pins the server-side
    // strip (forge dropped, sibling edit lands, insert exempt) over real HTTP.
    ledgerBindings: [{ type: 'field', path: 'readonly' }],
  },
  {
    id: 'webhook-materialization',
    label: 'Webhook materialization',
    summary:
      'a stack/connector-authored webhook is materialized into a dispatchable sys_webhook row on boot (#3461/#3489) — the authored value crosses manifest-decomposition → the ObjectQL registry (type `webhook`) → the bridge → engine.insert, and the bridge was first gated BEHIND the realtime/messaging dispatch guard, silently materializing nothing on a realtime-less boot despite green unit tests.',
    proofId: 'webhook-materialization',
    proofRef: 'packages/qa/dogfood/test/webhook-materialization.dogfood.test.ts#webhook-materialization',
    bound: true,
    // spec `object` → runtime `object_name` is the representative remap for the
    // whole authoring→dispatcher pipeline: its `live` status is only true
    // because the materializer runs (engine-only, independent of realtime), and
    // the proof boots WITHOUT realtime to pin exactly that.
    ledgerBindings: [{ type: 'webhook', path: 'object' }],
  },
  {
    id: 'email-template-materialization',
    label: 'Email template materialization',
    summary:
      'a stack-authored email template is materialized into the sys_email_template row sendTemplate actually reads (#4509) — the authored value crosses manifest-decomposition → the ObjectQL registry (type `email_template`) → the bridge → engine.insert → the TemplateLoader → the renderer, and THREE independent breaks sat on that path at once (the engine never registered `emailTemplates:` into the registry; built-in seeds defaulted to `managed_by: admin` and outranked declared templates; nothing materialized). An admin "fixing" the password-reset mail in Studio saved cleanly and users kept receiving the built-in copy — ADR-0078 false compliance on AUTH mail.',
    proofId: 'email-template-materialization',
    proofRef: 'packages/qa/dogfood/test/email-template-materialization.dogfood.test.ts#email-template-materialization',
    bound: true,
    // `subject` is the representative prop for the whole authoring→send
    // pipeline: its `live` status is only true because the bridge runs AND the
    // authored row outranks the built-in seed, so the proof overrides a
    // built-in auth template and asserts the authored wording reaches the wire.
    ledgerBindings: [{ type: 'email_template', path: 'subject' }],
  },
  {
    id: 'form-widget',
    label: 'Form layout / section / widget',
    summary: 'server-side form resolution.',
    proofId: 'form-widget-resolution',
    proofRef: null,
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'the form layout/section/widget surface is not yet governed and has no runtime proof (ADR-0054 Phase 2).',
  },
  {
    id: 'permission-set-projection',
    label: 'sys_permission_set pure projection',
    summary:
      'the metadata layer is the sole authoritative store for a permission-set definition; the '
      + 'sys_permission_set record is a derived projection (data-door write-through + awaited '
      + 'projection). A record that could drift from — or independently authorize against — its '
      + 'metadata is the two-store split-brain ADR-0094 retires.',
    proofId: 'permission-set-projection',
    proofRef: 'packages/qa/dogfood/test/showcase-permission-projection.dogfood.test.ts#permission-set-projection',
    // Unbound: this is a STORAGE/architecture invariant, not an authorable
    // `type.path` property the ledger ratchet can key on — there is no
    // permission-set field whose `live` status this proof gates. The proof is
    // still registered here (so the tag is not an orphan) and runs
    // unconditionally in the dogfood suite; it simply has no ledger property to
    // bind. Kept honest per ADR-0054 §3 rather than faking a binding.
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'projection is a storage invariant (ADR-0094), not an authorable spec property — no ledger '
      + 'entry to ratchet; the proof runs unconditionally in the dogfood suite instead.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Proofs that existed in the dogfood tree but were never registered here —
  // the gate reported them as 13 orphan `@proof:` tags. Registering silences
  // that warning, but silence was never the goal: each was re-read to ask "is
  // there an authorable property whose `live` status this proof actually
  // gates?" Five had one and are BOUND (the ratchet advances). Eight do not,
  // and say why rather than faking a binding.
  // ─────────────────────────────────────────────────────────────────────────

  {
    id: 'attachments-capability',
    label: 'Attachments capability gate',
    summary:
      '`enable.files` is the #2727 OPT-IN gate for attachments, enforced server-side: a sys_attachment '
      + 'targeting an object that does not declare it is refused 403 FILES_DISABLED. Proven in both '
      + 'directions over the real presigned three-step upload — declaring objects accept, the '
      + '`att_nofiles` fixture is refused — alongside the non-admin permission matrix (uploader gate, '
      + 'parent read-visibility, server-stamped uploaded_by, tenant isolation).',
    proofId: 'attachments-permission-matrix',
    proofRef: 'packages/qa/dogfood/test/attachments-permission-matrix.dogfood.test.ts#attachments-permission-matrix',
    bound: true,
    // A capability flag that only HIDES a UI panel is the false-compliance
    // shape ADR-0049 closes; the fixture carries a deliberate non-declaring
    // object so the negative direction is pinned, not assumed. The file's one
    // `describe.skipIf` covers the ENTERPRISE cross-tenant block only — the
    // FILES_DISABLED assertion this binding rests on runs unconditionally.
    ledgerBindings: [{ type: 'object', path: 'enable.files' }],
  },
  {
    id: 'rls-check-post-image',
    label: 'RLS `check` post-image validation',
    summary:
      'an RLS `check` clause validates the write POST-IMAGE (ADR-0058 D4) — a contributor who owns an '
      + 'invoice cannot reassign it to a different owner. Distinct from `using`, which filters the '
      + 'pre-image: a policy that compiled but was never applied to the resulting row would leave '
      + 'every "you may not change this away from yourself" rule decorative.',
    proofId: 'showcase-d3-d4-capabilities',
    proofRef: 'packages/qa/dogfood/test/showcase-d3-d4-capabilities.dogfood.test.ts#showcase-d3-d4-capabilities',
    bound: true,
    // The same file also pins the ADR-0058 D3 compound sharing `condition`
    // (`&&`), which silently skipped the AND before #1887 — but stack-level
    // sharing rules are not a governed metadata type, so only `check` binds.
    ledgerBindings: [{ type: 'permission', path: 'rowLevelSecurity.check' }],
  },
  {
    id: 'scope-depth-read',
    label: 'Scope-depth read grants',
    summary:
      "`readScope` widens the owner-match on an owner-scoped (private) object: `unit` → the caller's "
      + 'business-unit co-members, `unit_and_below` → that BU plus every descendant (BFS). Sharing '
      + 'still widens on top and cross-BU stays isolated (ADR-0057 D1). Hierarchy resolution is an '
      + 'enterprise capability, so the proof registers a reference resolver to pin the seam + '
      + 'contract; the open edition fails closed to owner-only.',
    proofId: 'showcase-scope-depth',
    proofRef: 'packages/qa/dogfood/test/showcase-scope-depth.dogfood.test.ts#showcase-scope-depth',
    bound: true,
    // An access-WIDENING grant: "declared but not applied" reads as a working
    // restriction, so the failure is silent in the safe-looking direction.
    ledgerBindings: [{ type: 'permission', path: 'objects.readScope' }],
  },
  {
    id: 'ownership-anchor-writes',
    label: 'Ownership anchor + bulk write scoping',
    summary:
      '`owner_id` is system-managed for non-privileged writers (#3004): a member can neither plant a '
      + 'record under another name (insert forge) nor move/disown one (update transfer) — that needs '
      + '`modifyAllRecords` (which implies transfer). Paired with #2982: bulk `update({multi:true})` '
      + '/ delete used to rebuild the driver AST AFTER the middleware chain, so owner scoping never '
      + 'reached them and a member\'s bulk write hit every matching row, peers included.',
    proofId: 'owner-anchor-and-bulk-writes',
    proofRef: 'packages/qa/dogfood/test/owner-anchor-and-bulk-writes.dogfood.test.ts#owner-anchor-and-bulk-writes',
    bound: true,
    // Bound to `modifyAllRecords` — the grant the proof actually authors and
    // exercises in BOTH directions (member denied, privileged caller allowed).
    // NOT to the sibling `allowTransfer`: the proof never authors it, and
    // binding a property a proof does not exercise is the same false comfort
    // as a preview renderer standing in for a runtime consumer.
    ledgerBindings: [{ type: 'permission', path: 'objects.modifyAllRecords' }],
  },
  {
    id: 'semantic-roles',
    label: 'Object semantic roles (ADR-0085)',
    summary:
      '`highlightFields` / `stageField` / `fieldGroups` survive the pipeline a real renderer consumes '
      + '— defineStack → artifact → registry → REST serialization — served verbatim over HTTP. Parse-'
      + 'level unit tests say nothing about that path, and it is exactly where the pre-ADR-0085 '
      + 'dialects silently died (spec-authored `defaultExpanded` never reached the form). A serializer '
      + 'whitelist or a boot-cached merge can drop a key with no static check noticing.',
    proofId: 'semantic-roles-served',
    proofRef: 'packages/qa/dogfood/test/semantic-roles.dogfood.test.ts#semantic-roles-served',
    bound: true,
    // One proof, three properties: the test asserts each is served verbatim
    // (incl. `stageField: false` surviving as a strict false, not dropped).
    ledgerBindings: [
      { type: 'object', path: 'highlightFields' },
      { type: 'object', path: 'stageField' },
      { type: 'object', path: 'fieldGroups' },
    ],
  },

  // ── Registered, honestly unbound ────────────────────────────────────────

  {
    id: 'flow-runas-userless',
    label: 'Flow runAs — the user-less run',
    summary:
      "a run with no trigger user under an effective `runAs:'user'` resolves no identity, so its CRUD "
      + 'nodes present no ObjectQL context and the security middleware SKIPS — the run would execute '
      + 'UNSCOPED. Until #3760 that is what happened, and this file pinned it. `runAs:\'user\'` is '
      + 'access-NARROWING, so failing to resolve it must never resolve to a grant: the run is refused.',
    proofId: 'flow-runas-schedule',
    proofRef: 'packages/qa/dogfood/test/flow-runas-schedule.dogfood.test.ts#flow-runas-schedule',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      "guards `flow.runAs`, which is already bound to `flow-runas-identity` — a ledger entry carries "
      + 'one `proof` ref, so the boundary-case sibling cannot also bind. It runs unconditionally in '
      + 'the dogfood suite.',
  },
  {
    id: 'scope-depth-cli-fallback',
    label: 'Scope-depth via the CLI default-profile wiring',
    summary:
      'the app declares its default profile in METADATA, the CLI passes only its NAME as '
      + '`fallbackPermissionSet`, and the SecurityPlugin resolves the full set (incl. `readScope`) '
      + 'from sys_permission_set at request time. The artifact-serve path used to drop `permissions[]` '
      + 'from the stack config, so the fallback silently degraded to the built-in owner-only '
      + '`member_default` and a grant-less user never got the declared widening.',
    proofId: 'showcase-scope-depth-fallback',
    proofRef: 'packages/qa/dogfood/test/showcase-scope-depth-fallback.dogfood.test.ts#showcase-scope-depth-fallback',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'guards the same `permission.objects.readScope` entry as `showcase-scope-depth`, over the CLI '
      + 'wiring rather than an injected bootstrap set — one entry, one `proof` ref, so it cannot also '
      + 'bind.',
  },
  {
    id: 'scope-depth-write',
    label: 'Scope-depth write grants',
    summary:
      'writeScope widens the owner-set an owner-scoped object accepts EDITS from, independently of '
      + "readScope: a co-member row can be readable yet not editable (absent writeScope defaults to 'own' "
      + "under a 'unit' read), 'unit' widens to BU co-members without descending into child BUs, and the "
      + 'hierarchy seam fails CLOSED to owner-only when the enterprise resolver is absent. Added by the '
      + '2026-07-30 #3896 security-subset re-verification: the entry was live on two confirmed readers '
      + 'but was the only scope axis with no runtime proof — its sibling readScope has carried one since '
      + 'ADR-0054 phase 1.',
    proofId: 'showcase-scope-depth-write',
    proofRef: 'packages/qa/dogfood/test/showcase-scope-depth-write.dogfood.test.ts#showcase-scope-depth-write',
    bound: true,
    ledgerBindings: [{ type: 'permission', path: 'objects.writeScope' }],
  },
  {
    id: 'app-tab-permissions',
    label: 'Tab visibility (/me/apps) + anchor-bindable baseline',
    summary:
      '/me/apps used to read `metadata.list(\'app\')` while stack apps live in the ENGINE REGISTRY, '
      + 'returning [] for every principal — leaving `tabPermissions` and `AppSchema.requiredPermissions` '
      + 'with no enforced consumer (#2752). Paired with #2753: the `member_default` baseline carried an '
      + 'anchor-forbidden `allowDelete` on `*`, so the bootstrap refused to bind it to `everyone` on '
      + 'every boot and the baseline flowed only through the fallback channel ADR-0090 D5 rejected.',
    proofId: 'me-apps-and-everyone-baseline',
    proofRef: 'packages/qa/dogfood/test/me-apps-and-everyone-baseline.dogfood.test.ts#me-apps-and-everyone-baseline',
    // Bound 2026-07-30 (the #3896 security-subset re-verification). The proof
    // originally only MENTIONED tabPermissions while exercising the route and
    // `app.requiredPermissions` — binding then would have been the
    // owner-anchor/allowTransfer mistake (a proof cited for a property it never
    // authors). It now authors the property on the PERMISSION-SET side — a set
    // whose only content is `tabPermissions: { showcase_app: 'hidden' }` drops
    // the app from /me/apps for its holder, and a second, more-visible grant
    // wins it back (the tabRank most-visible-wins merge) — which is the
    // governed surface (`permission.tabPermissions`; `app` remains ungoverned).
    bound: true,
    ledgerBindings: [{ type: 'permission', path: 'tabPermissions' }],
  },
  {
    id: 'agent-delegator-intersection',
    label: 'ADR-0090 D10 agent/delegator intersection',
    summary:
      'the reconstructed delegator context substitutes correctly into a real compiled '
      + '`owner_id = current_user.id` policy, and the intersection STRIPS an agent\'s View-All when the '
      + 'delegator lacks it — an agent may not see what the user it stands in for cannot.',
    proofId: 'showcase-agent-intersection',
    proofRef: 'packages/qa/dogfood/test/showcase-agent-intersection.dogfood.test.ts#showcase-agent-intersection',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'the intersection is a runtime principal-resolution invariant (principalKind `agent` + '
      + '`onBehalfOf`), not an authorable property — no `agent.*` field whose `live` status it gates.',
  },
  {
    id: 'agent-scope-ceiling',
    label: 'ADR-0090 D10 OAuth-scope agent ceiling',
    summary:
      'an MCP OAuth scope becomes a real data-layer boundary, not a tool-surface hint: a `data:read` '
      + 'agent acting for a user who CAN write is blocked at the data layer, while `data:write` for the '
      + 'same user is allowed — the intersection only ever narrows.',
    proofId: 'showcase-agent-scope-ceiling',
    proofRef: 'packages/qa/dogfood/test/showcase-agent-scope-ceiling.dogfood.test.ts#showcase-agent-scope-ceiling',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'the scope → ceiling-set mapping (`data:read` → mcp_agent_data_read) lives in the runtime '
      + 'execution-context resolver, not in authorable metadata — no ledger entry to ratchet.',
  },
  {
    id: 'bu-hierarchy-sharing',
    label: 'Business-unit subtree sharing',
    summary:
      "a sharing rule whose recipient is a BUSINESS UNIT widens access DOWN the tree: the unit's members "
      + 'AND every descendant unit\'s members gain access via sys_business_unit (BFS). The honest '
      + 're-homing of the broken `unit_and_subordinates` (sys_position.parent never existed) onto the '
      + 'working BU tree — the rule materialises sys_record_share rows and a non-owner in the subtree '
      + 'can then read a private record.',
    proofId: 'showcase-bu-hierarchy-sharing',
    proofRef: 'packages/qa/dogfood/test/showcase-bu-hierarchy-sharing.dogfood.test.ts#showcase-bu-hierarchy-sharing',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'sharing rules are authored at STACK level (`sharingRules`), which is not a governed metadata '
      + 'type — the ledger governs per-type property surfaces, and there is no `permission.*` entry '
      + 'for the rule\'s recipient kind.',
  },
  {
    id: 'sharing-rule-criteria-required',
    label: 'Sharing rule — criteria is required',
    summary:
      'a sharing rule with no criteria must share NOTHING. `criteria_json: null` used to evaluate as '
      + '`find(object, { filter: {} })` under the system context — every record of the object, granted '
      + 'to the recipient — reachable by a typo through three write paths that never parsed the schema '
      + '(#3896). The proof POSTs the reported body against a booted stack and asserts no '
      + '`sys_record_share` row appears, and covers the already-stored legacy row whose grants the next '
      + 'reconcile REVOKES rather than leaving materialised.',
    proofId: 'sharing-rule-criteria-required',
    proofRef:
      'packages/qa/dogfood/test/sharing-rule-criteria-required.dogfood.test.ts#sharing-rule-criteria-required',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'same shape as `showcase-bu-hierarchy-sharing`: the criteria is authored at STACK level '
      + '(`sharingRules[].condition`), not as a property of a governed metadata type, so there is no '
      + 'ledger entry to ratchet. Registered so the tag is not an orphan; it runs unconditionally in '
      + 'the dogfood suite. The invariant itself is recorded in the empty-state registry '
      + '(sharing `condition` → `closed`), which is the surface that CAN carry it.',
  },
  {
    id: 'declarative-rbac-seeding',
    label: 'Declarative RBAC seeding',
    summary:
      'stack-declared `roles` + `sharingRules` are seeded into sys_position / sys_sharing_rule at boot, '
      + 'so they stop being decorative — #2077 reported booting the showcase yielded a count of 0 for '
      + 'both. Also pins the spec→runtime translation.',
    proofId: 'showcase-declarative-rbac-seeding',
    proofRef: 'packages/qa/dogfood/test/showcase-declarative-rbac-seeding.dogfood.test.ts#showcase-declarative-rbac-seeding',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'seeding acts on STACK-level `roles`/`sharingRules` collections, not on a per-type authorable '
      + 'property — same shape as bu-hierarchy-sharing.',
  },
  {
    id: 'permission-model-zoo',
    label: 'ADR-0090 permission-model zoo',
    summary:
      'the showcase declares the FULL authoring surface (positions, CRUD/FLS/RLS sets, org-depth, VAMA, '
      + 'system permissions, everyone/guest capability, adminScope, a seeded sys_business_unit tree, '
      + 'BU-subtree sharing) and the SERVED runtime enforces it rather than merely storing it. Each '
      + 'block names the ADR-0090 decision it guards.',
    proofId: 'showcase-permission-zoo',
    proofRef: 'packages/qa/dogfood/test/showcase-permission-zoo.dogfood.test.ts#showcase-permission-zoo',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'a BREADTH guard over the whole ADR-0090 surface, not a single-property gate — binding it to any '
      + 'one entry would misrepresent both what it covers and what that entry is proven by. The '
      + 'per-property bindings above carve out the parts that do have a single owner.',
  },
  {
    id: 'field-file-collection',
    label: 'Field-file collection (ADR-0104 PR-5b)',
    summary:
      'a field file released by its ONE owning record is tombstoned, and the sweep reclaims the row AND '
      + 'the storage bytes once the declared window passes — with both vetoes intact: a tombstone that '
      + 'regained an owner is un-tombstoned rather than reaped, and a REGRESSED migration flag stops '
      + 'collection immediately (the guard re-reads the flag at sweep time instead of trusting the '
      + 'memoized read the release path uses). This is the only code on the platform that deletes a '
      + "user's bytes, and its sibling lineage — attachments — has had an end-to-end proof since #2755 "
      + 'while field files, which reach collection by a different route (exclusive ownership, released '
      + 'by the write path, gated per deployment), had none.',
    proofId: 'adr0104-field-file-collection',
    proofRef: 'packages/qa/dogfood/test/field-file-collection.dogfood.test.ts#adr0104-field-file-collection',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'the collection contract it guards is the `lifecycle` ttl declared on the SYSTEM object `sys_file` '
      + '(service-storage), not an authorable per-type property — and `object.lifecycle` is already bound '
      + 'to `data-lifecycle`, which carries one `proof` ref. The rest of the route (exclusive ownership, '
      + 'release-on-write, the per-deployment migration gate) is service code with no authorable surface '
      + 'to govern, so there is no other entry to bind instead. It runs unconditionally in the dogfood '
      + 'suite.',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2026-08-21 round — the next eleven dogfood proofs the gate reported as
  // unregistered `@proof:` tags. Same discipline as the block above: each file
  // was re-read to ask "is there an authorable property whose `live` status
  // this proof actually gates?", and NONE is bound here. Three have a fitting
  // ledger entry and are PROPOSED for binding in the PR that registered them;
  // adoption is a ledger edit and therefore a review decision, not a
  // registration side effect — binding a proof unilaterally is how a `live`
  // status acquires a citation nobody weighed. The other eight have no
  // authorable surface to bind at all, and say which instead of faking one.
  // ─────────────────────────────────────────────────────────────────────────

  {
    id: 'admin-credential-lifecycle',
    label: 'Admin credential lifecycle',
    summary:
      'the two admin credential operations a platform admin can actually drive end to end: '
      + '`/admin/create-user` mints a LOGIN-CAPABLE account (an explicit password winning over '
      + '`generatePassword: true`), and `/admin/set-user-password` ROTATES the credential so the new '
      + 'password signs in and the old one is refused. Every refusal is paired with the positive on the '
      + 'SAME account — a credential suite proving only "the old password stopped working" stays green '
      + 'when NOTHING signs in (account locked, credential row dropped, sign-in path broken).',
    proofId: 'admin-credential-lifecycle',
    proofRef:
      'packages/qa/dogfood/test/admin-credential-lifecycle.dogfood.test.ts#admin-credential-lifecycle',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'the two routes are ObjectStack service mounts gated by the ADR-0068 platform-admin resolution '
      + '(`isPlatformAdmin` / `positions[]`), not an authorable per-type property — there is no '
      + 'metadata key whose `live` status the credential lifecycle gates. It runs unconditionally in '
      + 'the dogfood suite.',
  },
  {
    id: 'admin-route-gate-sweep',
    label: 'Admin-route non-admin refusal sweep',
    summary:
      'every `/admin/` route refuses a non-admin, over a route population DERIVED from the running '
      + 'stack (the Hono raw mounts UNION the better-auth endpoint table) rather than hardcoded — a '
      + 'listed set passes forever while route N+1 ships unguarded. Payloads are load-bearing: an '
      + 'empty body draws a 400 VALIDATION_ERROR byte-identical for member and admin, so a route walk '
      + 'built on empty bodies asserts nothing about authorization while looking exactly like a '
      + 'passing security sweep.',
    proofId: 'admin-route-nonadmin-refusal',
    proofRef:
      'packages/qa/dogfood/test/admin-route-nonadmin-refusal.dogfood.test.ts#admin-route-nonadmin-refusal',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'a BREADTH guard over a derived route surface, not a single-property gate — same shape as '
      + '`permission-model-zoo`. Binding it to any one entry would misrepresent both what it covers '
      + 'and what that entry is proven by.',
  },
  {
    id: 'attachments-parent-rls-count',
    label: 'Attachment read inherits parent RLS — the COUNT',
    summary:
      "a restricted member's `sys_attachment` list excludes invisible parents in its `total` as well "
      + 'as its rows. `total` comes from `engine.count()`, not from the find path, which is why the '
      + 'visibility rule is a data MIDDLEWARE (find/findOne/count/aggregate) and not a find hook — a '
      + 'suite reading only `records` stays green with `count()` unfiltered, leaking the true row '
      + 'count of records the caller may not read. Every assertion passes a `$top` (without a page '
      + 'limit `total` is set to `records.length` and the count path never runs).',
    proofId: 'attachments-parent-rls-count-parity',
    proofRef:
      'packages/qa/dogfood/test/attachments-parent-rls-count-parity.dogfood.test.ts#attachments-parent-rls-count-parity',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'parent-RLS inheritance is an invariant of the attachments read middleware, not an authorable '
      + 'property; the two nearest entries are already spoken for — `object.enable.files` binds '
      + '`attachments-permission-matrix` and `permission.rowLevelSecurity.using` binds '
      + '`rls-by-id-write`, and a ledger entry carries one `proof` ref.',
  },
  {
    id: 'attachments-parent-rls-scan-cap',
    label: 'Attachment parent-RLS pre-scan cap',
    summary:
      'past READ_SCAN_LIMIT = 2000 candidate (parent_object, parent_id) pairs the visibility filter is '
      + 'built from a TRUNCATED candidate set, and the truncation must fall CLOSED — rows outside the '
      + 'scan window are excluded (the caller may lose rows they could see) rather than admitted '
      + 'unfiltered. The cap also logs, because a silent truncation is indistinguishable from a leak.',
    proofId: 'attachments-parent-rls-scan-cap',
    proofRef:
      'packages/qa/dogfood/test/attachments-parent-rls-scan-cap.dogfood.test.ts#attachments-parent-rls-scan-cap',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'same family as `attachments-parent-rls-count` — the bound itself is a service constant in the '
      + 'read middleware, with no authorable metadata key declaring it.',
  },
  {
    id: 'attachments-public-read-acl',
    label: 'Attachment `public_read` ACL — the OPEN side',
    summary:
      "`acl: 'public_read'` opts a gated file back out to the stable anonymous capability URL — the "
      + 'explicit declaration that exists because `<img src>` cannot carry a bearer token. The open '
      + 'side is the half that matters: a download-authz suite made only of denials stays green when '
      + 'the surface denies EVERYTHING, which is exactly what a `public_read` regression produces. '
      + 'Asserted on ONE file — closed, opened, closed again — with the TTL branch read back out of '
      + 'the minted URL so "it opened" cannot be satisfied by some other grant path answering 200.',
    proofId: 'attachments-public-read-acl',
    proofRef:
      'packages/qa/dogfood/test/attachments-public-read-acl.dogfood.test.ts#attachments-public-read-acl',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      '`acl` is a column on the `sys_attachment` RECORD, not an authorable spec property — no ledger '
      + 'file declares it. `object.publicSharing` is the share-link policy, a different mechanism this '
      + 'proof never authors, so binding there would cite a proof for a property it does not exercise.',
  },
  {
    id: 'attachments-unscoped-delete-gate',
    label: 'Attachment delete gate under an unscoped AST',
    summary:
      'an unscoped (predicate-less) multi-delete is not a way around the per-row attachment delete '
      + 'gate, and the refusal is authoritative rather than cosmetic — nothing is deleted. Both sides '
      + 'are asserted, because a delete suite showing only denials stays green on a surface that has '
      + 'stopped deleting anything at all.',
    proofId: 'attachments-unscoped-delete-gate',
    proofRef:
      'packages/qa/dogfood/test/attachments-unscoped-delete-gate.dogfood.test.ts#attachments-unscoped-delete-gate',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'the gate lives in `attachment-access-hooks.ts`, with no authorable property declaring it — and '
      + 'the file deliberately does NOT pin the C3 outright-refusal behaviour (the engine dispatches '
      + '`beforeDelete` per row, so the `where === undefined` branch is never reached: a recorded '
      + 'PRODUCT gap). There is no settled verdict for a ledger entry to anchor even if one fitted.',
  },
  {
    id: 'no-active-organization-write',
    label: 'ADR-0123 D2 — no active organization, no tenant-scoped write',
    summary:
      'an authenticated caller whose resolved context carries no organization cannot land a '
      + 'tenant-scoped row over real HTTP. Before the D2 refusal the write answered 2xx, stored '
      + '`organization_id: null`, and the read wall then hid the row from every reader including its '
      + 'own author. Three anti-vacuity pins: the wall posture in force is asserted, the caller is '
      + 're-measured to carry no `tenantId`, and the refusal is separated from a look-alike CRUD 403 '
      + 'by its message plus the decisive leg — the SAME caller on the SAME route SUCCEEDS once a '
      + '`sys_member` row exists, so exactly one fact differs between refusal and success.',
    proofId: 'no-active-organization-write-refusal',
    proofRef:
      'packages/qa/dogfood/test/no-active-organization-write-refusal.dogfood.test.ts#no-active-organization-write-refusal',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'the refusal is a posture invariant of the `tenancy` SERVICE (the proof reads the service\'s own '
      + '`posture` / `isolationActive`), not an authorable per-type property. `object.tenancy.enabled` '
      + 'is never authored or varied by this file, so binding it there would be the '
      + 'owner-anchor/allowTransfer mistake — a proof cited for a property it does not exercise.',
  },
  {
    id: 'sharing-rule-org-scoped-listing',
    label: 'Sharing-rule admin listing under an org-scoped caller',
    summary:
      'the admin sharing-rule read path admits the platform-global (org-less) seeded rows an org-bound '
      + 'admin must see. Rules seeded under SYSTEM_CTX carry `organization_id = null`, and a strict '
      + '`organization_id = <request org>` equality answered `{data: []}` over four active rules on a '
      + 'stock boot — rules that grant access but cannot be listed, inspected or deactivated. The file '
      + 'boots with `orgContext: true` and asserts the flag TOOK EFFECT first: an org-less admin here '
      + 'silently restores the #4700 constant-false vacuum the original version was deleted for.',
    proofId: 'org-scoped-sharing-rule-listing',
    proofRef:
      'packages/qa/dogfood/test/org-scoped-sharing-rule-listing.dogfood.test.ts#org-scoped-sharing-rule-listing',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'same shape as `showcase-bu-hierarchy-sharing` and `sharing-rule-criteria-required`: the rules '
      + 'are authored at STACK level (`sharingRules`), which is not a governed metadata type, and what '
      + 'this file pins is a read-scope filter inside SharingRuleService. No ledger entry to ratchet.',
  },
  {
    id: 'sharing-rule-org-less-caller',
    label: 'Sharing-rule read scope for an org-less capability holder',
    summary:
      'a `manage_sharing` holder whose session carries no ACTIVE organization does not receive the '
      + 'SYSTEM read scope. `adminOrgScope` decided on the ABSENCE of an org id (`if (!orgId) return '
      + 'where`) — a branch meant for SYSTEM_CTX but reached on CAPABILITY, so an authenticated '
      + "non-system caller got every organization's rules, resolvable by id and by name and evaluable "
      + '— which reconciles `sys_record_share`, so a cross-tenant WRITE. Taken through the real login '
      + 'path (sign-up → sign-in → `session.create.before` declining to stamp an org → '
      + '`resolveAuthzContext` → the REST route the Setup pages call), with TWO organizations: a '
      + 'single-tenant fixture would pass on the BROKEN build because there is nothing to leak.',
    proofId: 'sharing-rule-org-less-caller',
    proofRef:
      'packages/qa/dogfood/test/sharing-rule-org-less-caller.dogfood.test.ts#sharing-rule-org-less-caller',
    bound: true,
    // Bound 2026-08-23 (#10959) on the spec seat's adjudication of PR #10934,
    // whose item ③ was conditional: bind only if the entry's note turned out
    // stale. The re-verification says stale on BOTH halves, so the note was
    // corrected in the same PR and the binding follows.
    //   • The old evidence pointer (`plugin-hono-server/src/hono-plugin.ts:1222`)
    //     does not exist — that file is 717 lines and never mentions
    //     `systemPermissions`; the app-entry consumer moved to
    //     `current-user-endpoints.ts` (`/auth/me/apps`).
    //   • The old note's scoping claim ("app-entry/nav visibility only, not a
    //     general capability gate") is falsified by ADR-0111 D6:
    //     `SharingRuleService.assertCanManageRules` reads
    //     `context.systemPermissions` and refuses every sharing-rule verb
    //     unless the caller holds `manage_sharing` or the legacy
    //     `manage_platform_settings` admin override (system contexts bypass)
    //     — a data-layer gate, not nav visibility. The admit set is wider than
    //     one capability, but every member of it is read from
    //     `systemPermissions`, which is what the bound entry classifies.
    // The proof authors the key and proves the gate was CLEARED by it: the
    // refusal it asserts is the org-scope one and explicitly NOT
    // /requires the manage_sharing capability/, with the org-bound holder of
    // the same grant reading its own tenant as the entitled contrast.
    ledgerBindings: [{ type: 'permission', path: 'systemPermissions' }],
  },
  {
    id: 'crud-persona-matrix',
    label: 'Persona × CRUD-cell permission matrix',
    summary:
      "for every `showcase_*` row of the showcase's `access-matrix.json`, one fresh member holding "
      + 'exactly that permission set runs all four verbs over real HTTP and each cell is judged '
      + 'against the table — as a UNION with the everyone-baseline set, because capability is additive '
      + '(ADR-0090 D5) and judging a cell against the raw row turns 9 correctly ALLOWED cells into '
      + 'fabricated violations. The allow half is not decoration: the exact allow/deny split is '
      + 'asserted, so narrowing the sweep (or a persona silently failing to provision) breaks the '
      + 'build instead of quietly shrinking what is proven, and every denial is preceded by an admin '
      + 'control issued FROM THE SAME PAYLOAD BUILDER so a 403 cannot be a bad payload.',
    proofId: 'showcase-crud-persona-matrix',
    proofRef:
      'packages/qa/dogfood/test/showcase-crud-persona-matrix.dogfood.test.ts#showcase-crud-persona-matrix',
    bound: true,
    // Bound 2026-08-23 (#10959) — ADOPT ALL FOUR, on the spec seat's
    // adjudication of PR #10934. The scope worry the registration raised (one
    // breadth proof anchoring four properties) is answered by the file's own
    // shape: the EXACT allow/deny split is asserted (54 allow / 54 deny, one
    // verdict per set × object × verb), so a narrowing sweep — or a persona
    // silently failing to provision — breaks the build instead of quietly
    // shrinking what these four entries cite. Each verb is exercised in both
    // directions per cell and on post-state, not just on status codes.
    // Multi-entry binding has precedent in `semantic-roles`, which binds three.
    ledgerBindings: [
      { type: 'permission', path: 'objects.allowCreate' },
      { type: 'permission', path: 'objects.allowRead' },
      { type: 'permission', path: 'objects.allowEdit' },
      { type: 'permission', path: 'objects.allowDelete' },
    ],
  },
  {
    id: 'fls-read-strip',
    label: 'FLS read side — an unreadable field is STRIPPED',
    summary:
      'a field a permission set marks `readable: false` is ABSENT from the wire, not null, not empty, '
      + 'not a placeholder. The platform has TWO ways a field can fail to reach a caller — STRIPPED '
      + '(the key is deleted) and MASKED (a `maskingRule` replaces the value) — and a test asserting '
      + 'only "I did not get the real value" passes for both and pins neither, so the assertions are '
      + "about the KEY (`'budget' in record` must be false), which a `toBeUndefined()` check cannot "
      + 'distinguish. Every deny is paired with the entitled contrast on the SAME field, row and '
      + 'request: an absence-only suite stays green if the field vanished for everyone.',
    proofId: 'showcase-fls-read-mask-strip',
    proofRef:
      'packages/qa/dogfood/test/showcase-fls-read-mask-strip.dogfood.test.ts#showcase-fls-read-mask-strip',
    bound: true,
    // Bound 2026-08-23 (#10959) — the strongest of the three, on the spec
    // seat's adjudication of PR #10934. The file AUTHORS a scratch permission
    // set carrying `readable: false` and asserts the runtime outcome both ways
    // on the SAME field, row and request, so `permission.fields.readable`'s
    // `live` status is exactly what it gates.
    // NOT `fields.editable` alongside it: the file authors that key but
    // asserts its refusal as a CONSEQUENCE of unreadability rather than as the
    // write-deny axis, which `showcase-permission-zoo` already pins. Binding it
    // would repeat the owner-anchor / `allowTransfer` mistake — a proof cited
    // for a property it does not exercise.
    ledgerBindings: [{ type: 'permission', path: 'fields.readable' }],
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2026-08-26 round — ONE tag, and the reason it is worth a paragraph is that
  // it is a RECURRENCE of the block above: the 2026-08-21 round registered the
  // eleven tags that existed then, and a twelfth arrived with the next dogfood
  // proof. Registering instances one round at a time never closes the class,
  // because the drift signal was a ⚠ that nothing failed on — so the gate is
  // switched to red in the same PR (check-liveness.mts), which is the half
  // that stops a thirteenth.
  //
  // Direction of drift, decided by reading both sides rather than assuming:
  // the REGISTRY lagged. `admin-platform-admin-standing` is not a misspelling
  // of an already-registered tag — the file names itself, its tag and its
  // sibling (`admin-route-nonadmin-refusal`, registered above) distinctly, and
  // no registered id is within a typo of it.
  // ─────────────────────────────────────────────────────────────────────────

  {
    id: 'admin-platform-admin-standing',
    label: 'Platform-admin standing across the /admin/ route surface',
    summary:
      'the DUAL of `admin-route-nonadmin-refusal`, over the same derived `/admin/` route population: '
      + 'no route refuses a genuine ADR-0068 platform admin unless the refusal is a RECORDED by-design '
      + 'ruling (#9969\'s seven consumer-less vendor routes, #9968\'s `set-role`). better-auth\'s stock '
      + 'admin plugin authorizes on the legacy `user.role === \'admin\'` scalar that ADR-0068 D2 stopped '
      + 'synthesizing, so the vendor\'s own endpoints refuse a real platform admin — and this file is '
      + 'what keeps that answer a ruled outcome instead of an unread gap. Two anti-vacuity pins carry '
      + 'it: the subject\'s standing is asserted as a CONTROL before any route answer is read '
      + '(`positions[]` contains `platform_admin`, `isPlatformAdmin` true, `sys_user.role` NOT '
      + '`\'admin\'` — the fixture a real deployment has, not the `role = \'admin\'` scalar the unit '
      + 'tests write), and every route is fired with a payload valid enough to REACH the gate, because '
      + 'better-auth validates the body BEFORE the admin check and an empty-body sweep draws a '
      + '`400 VALIDATION_ERROR` byte-identical for member and admin while looking exactly like a '
      + 'passing security suite.',
    proofId: 'admin-platform-admin-standing',
    proofRef:
      'packages/qa/dogfood/test/admin-platform-admin-standing.dogfood.test.ts#admin-platform-admin-standing',
    bound: false,
    ledgerBindings: [],
    blockedReason:
      'platform-admin standing is the ADR-0068 D2 identity resolution (`positions[]` / '
      + '`isPlatformAdmin`, consolidated since #11686 as `hasPlatformAdminStanding`) evaluated inside '
      + 'the auth plugin\'s route gate — runtime principal resolution, not an authorable per-type '
      + 'property, so there is no metadata key whose `live` status it gates. It is also a BREADTH guard '
      + 'over a DERIVED route population, the `admin-route-nonadmin-refusal` / `permission-model-zoo` '
      + 'shape: binding it to any single entry would misrepresent both what it covers and what that '
      + 'entry is proven by. It runs unconditionally in the dogfood suite.',
  },
];

/** Bound ledger paths → the class that binds them. Key: `<type>/<path>`. */
export const BOUND_PROOF_PATHS: Map<string, HighRiskClass> = (() => {
  const m = new Map<string, HighRiskClass>();
  for (const cls of HIGH_RISK_CLASSES) {
    if (!cls.bound) continue;
    for (const b of cls.ledgerBindings) m.set(`${b.type}/${b.path}`, cls);
  }
  return m;
})();

/** Every proof id the registry knows about (bound + pending) — used to flag orphan tags. */
export const KNOWN_PROOF_IDS: Set<string> = new Set(HIGH_RISK_CLASSES.map((c) => c.proofId));

/** Parse a proof reference into its file + id parts, or null if malformed. */
export function parseProofRef(ref: unknown): { file: string; id: string } | null {
  if (typeof ref !== 'string') return null;
  const hash = ref.indexOf('#');
  if (hash <= 0 || hash >= ref.length - 1) return null;
  const file = ref.slice(0, hash).trim();
  const id = ref.slice(hash + 1).trim();
  if (!file || !id) return null;
  return { file, id };
}

// A proof tag a dogfood test self-declares, e.g. `// @proof: field-type-roundtrip`.
// Greppable + stable across test-title churn (field-zoo titles are generated in a
// loop), which is why we match a tag rather than a test name.
const PROOF_TAG_RE = /@proof:\s*([a-z0-9][a-z0-9-]*)/g;

/** Collect all `@proof:` tag ids declared in a file's text. */
export function extractProofTags(content: string): Set<string> {
  const out = new Set<string>();
  for (const m of content.matchAll(PROOF_TAG_RE)) out.add(m[1]);
  return out;
}

/** Minimal fs surface so validation is unit-testable without touching disk. */
export interface ProofFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, enc: 'utf8'): string;
}

export interface ProofValidation {
  ok: boolean;
  error?: string;
}

/**
 * Validate that a proof reference resolves to a real, named proof: the file
 * exists AND declares the `@proof: <id>` tag. STATIC ONLY — it never runs the
 * test (that is the dogfood gate's job); the liveness gate stays seconds-cheap.
 */
export function validateProofRef(
  ref: unknown,
  opts: { repoRoot: string; fs: ProofFs; join: (...parts: string[]) => string },
): ProofValidation {
  const parsed = parseProofRef(ref);
  if (!parsed) return { ok: false, error: `malformed proof ref (expected "<file>#<proof-id>"): ${String(ref)}` };
  const abs = opts.join(opts.repoRoot, parsed.file);
  if (!opts.fs.existsSync(abs)) return { ok: false, error: `proof file not found: ${parsed.file}` };
  const content = opts.fs.readFileSync(abs, 'utf8');
  if (!extractProofTags(content).has(parsed.id)) {
    return { ok: false, error: `proof tag "@proof: ${parsed.id}" not found in ${parsed.file}` };
  }
  return { ok: true };
}
