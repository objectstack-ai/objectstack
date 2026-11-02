# ObjectStack North Star

**What we are**: the ontology is the software — an executable business ontology (objects and fields, relationships, actions, permissions, flows, agent and tool definitions) that AI writes, the runtime runs, people and agents use, and you own; startup stage. Views, dashboards, apps and translations are projections of the ontology — the surfaces through which people use it, see it and verify it today.

**Who it is for**: third-party developers, AI agents first with a human accepting — the AI enters our metadata protocol and writes applications, the human looks at the result and decides. The applications' end users are the business staff in companies, who use the applications through agents and the UI.

**What gets built**: **AI-native enterprise management applications** — business objects and records, views to see the data, forms that work, permissions that really hold, approvals and automation, business reports, sign-in and identity, an API others can call, files, the customer's language, and changing the application while it runs without writing code. AI-native means: the application carries an agent that can operate it on the user's behalf — this repository (the community edition) exposes objects and actions over MCP and users connect their own agent; the enterprise edition builds the agent into the user interface, and that half lives in the cloud repository. Missing any one of these, it is not this application. This line is a definition, not a checklist; what each item must do and how it is verified is in `docs/qa/platform-checklist/`. Reference implementation: hotcrm. Two kinds of user: today, business staff through the UI and acceptors through the console; tomorrow, agents through MCP. Every step of the road must hold for both kinds of user.

**What counts as done**: an application built on the protocol is done only once it has passed verification — the checklist items its metadata maps to pass in one run, and `objectstack verify` is green on it. A delivery that has not passed verification does not count as done.

**The one measure: the road**: a new AI developer (a human accepting alongside) starts from `npm create objectstack`: write metadata → run it locally and see it → verification loudly rejects what is wrong and lets through what is right → publish and install into an environment → connect an agent (MCP in the community edition) and have it complete one real business operation in the application → iterate once on a one-sentence customer request. Walk it for real every week, and the result lands as a run record. The first step that breaks is the current P0; one that runs through but gives a wrong result is P2. The four promises are each kept by a step: ① AI can write it · ②③ it executes · ④ you own it · ⑤ agents can operate it · ⑥ it closes the loop.

**Features on the road**: the features the platform has to deliver, one per line, arranged by the steps of that road; top to bottom is the order — this table is the roadmap, and editing it is editing priority. Each row reads `axis · feature (in business language) · checklist area · item ids`, and one feature is a whole strip from protocol through runtime to the frontend; every item in `docs/qa/platform-checklist/` belongs to exactly one row here (an item not yet written is marked "checklist item to be written"). An id without a prefix belongs to the checklist area before it; one from another area is written in full.

**① Set out: start a project with `npm create objectstack`, write metadata**

- devpath · One command starts a project: scaffolded, installed, verification passes, the console's first screen paints · cli · scaffold-first-run, scaffold-console-first-paint
- devpath · The build is the author's first gate: errors carry a location, artifacts and statistics come out · cli · build-own-contract
- devpath · Code snippets written into metadata have boundaries: hook and action bodies refuse out-of-bounds spellings · cli · hook-body-extraction-gates
- studio · Build objects, fields, lists, forms and record pages without writing code · studio-authoring · object-designer-roundtrip, view-authoring-live, record-page-roundtrip
- studio · Custom pages: block composition, page variables and page-level actions, three source tiers · studio-authoring · custom-page-render-and-blocks, page-variables-and-actions, custom-page-source-tiers
- studio · Draft first, then publish: publishing is atomic, and conflicts and invalid drafts are refused on the spot · studio-authoring · draft-publish-lifecycle, authoring-validation-not-persisted
- studio · Studio's judgements and boundaries: expressions agree with the engine, the permission matrix can be edited, the registry decides what can change at runtime · studio-authoring · expression-editors, permission-matrix-editor-ux, org-override-registry-gate
- studio · An administrator writes Markdown documents in the UI and adds them to the menu (books included), published as a portal by audience · studio-authoring + platform-core · doc-on-app-menu, platform-core.docs-audience-gate, platform-core.docs-portal-render

**② Run it locally and see it — every capability an end user uses in the application is needed for the first time at this step**

- devpath · One command runs the application: health and readiness both pass, the database choice is honest, port and staleness are both said out loud · cli + platform-core · dev-boot-contract, platform-core.boot-health, platform-core.runtime-config-boot-read
- devpath · Seed data lands in the database as written, and a replay adds nothing and loses nothing · platform-core · seed-integrity, seed-mode-matrix
- devpath · You can sign in, and the shell remembers: navigation, built-in apps, favourites and recents, theme, keyboard shortcuts, the back key · platform-core · console-login, nav-surfaces-render, builtin-apps-nav-render, shell-nav-personalization, theme-mode-persistence, keyboard-shortcut-surface, url-overlay-contract, home-admin-cluster-links, console-installability-indicators, app-management-toggle
- devpath · Platform settings change in the UI: a change really takes effect, leaves a trace, and secrets are stored only as handles · platform-core · settings-hub-roundtrip
- devpath · Telemetry and lifecycle data are reclaimed by retention period, and an object declared as archived is never hot-deleted · platform-core · lifecycle-retention-sweep
- devpath · The metadata registry is readable from outside, and only a writable package can be changed · platform-core · metadata-registry-serving, metadata-authoring-roundtrip
- records · A record is created, seen, changed and deleted, and another can be made from it · records-forms · crud-roundtrip, record-clone-contract
- records · Every field type renders, accepts input and persists, and a wrong value is refused on the spot · records-forms · field-type-matrix, field-type-constraints, field-unique-enforcement, encrypted-field-behavior
- records · Lists get work done: filter, search, sort, paginate, saved views, inline editing, export, bulk · records-forms · list-view-capabilities, view-type-gallery, adhoc-filter-sort-builder, grid-personalization, saved-view-management, bulk-select-all-matching
- records · Kanban, calendar and Gantt can be dragged; they are not pictures · records-forms · kanban-drag-persistence, calendar-interactions, gantt-interactions
- records · Forms work: layout, dirty-data guard, conditional visibility and required rules, cascading options · records-forms · form-view-gallery, form-dirty-guard, conditional-rules-header, conditional-rules-grid, cascading-options, cascading-multilevel-and-clear, field-group-visible-when
- records · Master and detail save together, related lists paginate on the server, and a lookup picker creates a new record in passing · records-forms · master-detail-atomic-save, related-list-server-pagination, lookup-picker-create-new
- records · Write rules are honoured on the server: a collision is loud, an edit can be undone, and what changed is visible · records-forms · validation-rule-type-matrix, object-hook-lifecycle, delete-behavior-matrix, concurrent-edit-conflict, record-edit-undo, field-history-tracking
- records · Actions and collaboration on a record: buttons sit where they are declared, the parameter contract is honoured at dispatch, discussion and @-mentions · records-forms · action-location-matrix, action-param-widgets, upload-guard-blocks-confirm, record-discussion-mentions
- records · Search finds it: across fields, scoped to a field, consistent with permissions, pinyin, fresh at once; global search and the command palette take the same road · search · cross-field-object-search, field-scoped-narrowing, rls-both-personas, pinyin-flag-both-sides, freshness-and-empty, console-global-search, command-palette-navigation
- records · Shared option sets: several objects reuse one set of options · records-forms · picklist-shared-across-objects
- access · Row-level and field-level permissions are right on both sides: a restricted member sees only their own, what should be read-only is read-only, and what should be invisible is not returned to the frontend · access-security · rls-both-sides, scope-depth-asymmetry, fls-mask-and-strip
- access · Create, read, update and delete are honoured cell by cell, a permission change shows at once, and the self-check endpoint agrees with the server · access-security · crud-permission-matrix, permission-matrix-edit-loop, me-permissions-aggregation-parity
- access · The write path holds: read-only fields are stripped, a forged or transferred owner is refused, and default visibility can only be tightened · access-security · write-path-guards, owd-save-gate
- access · Sharing: the default baseline, rules that widen, manual sharing of a single record, suggested bindings · access-security · owd-sharing-matrix, sharing-rules-widen, record-share-grant-revoke, sharing-rule-authoring-ui, suggested-binding-loop
- access · Anonymous cannot get in: every API family refuses uniformly, and before any resource is resolved; having no active organization is also a legal state · access-security · anonymous-deny-surfaces, no-active-org-session-semantics
- access · The small doors opened to the outside: public forms and share links, revocable and leak-free · access-security · public-form-intake, share-link-capability-tokens, share-link-landing-page
- access · Explainable and auditable: access explanations attributed layer by layer, an audit log browser, record views leave a trace, and the platform administrator identity itself holds · access-security · record-access-explain, audit-log-browser, record-view-read-audit, platform-owner-email-anchor
- identity · Sign-in methods switch on and off by configuration, and what is advertised really works · identity-auth · auth-method-matrix, sso-enforced-first-paint, phone-signin-surfaces
- identity · The first install has an owner: zero-user first run, the sign-up gate, email verification · identity-auth · first-run-owner-bootstrap, self-signup-gate, email-verification-loop
- identity · You can get back in and change things yourself: forgotten password, profile changes, sessions you can see and revoke · identity-auth · self-service-password-reset, self-service-profile-password, session-list-revoke
- identity · Two-factor authentication: enable, verify, backup codes, disable · identity-auth · two-factor-enrollment-reveal, two-factor-verify-to-activate, two-factor-backup-codes, two-factor-disable-lifecycle
- identity · Organizations, teams and business units, and the administrator's user operations · identity-auth · org-membership-team-management, teams-bu-membership, invitation-scope-gates, workspace-org-switch, admin-lifecycle-operations, identity-import-wizard
- identity · External identity: OAuth consent and linked social accounts · identity-auth · oauth-app-consent-loop, linked-accounts-social
- workflow · An approval runs to completion: joint sign-off, quorum, dynamic approvers, timeout escalation, out-of-office delegation · approvals · per-group-signoff, quorum-m-of-n, dynamic-approver-routing, sla-escalation, ooo-delegation-reroute, approver-resolution-matrix
- workflow · Approvals are done in the UI: the inbox, record-page buttons, a keyboard flow, pending counts, notifications that deep-link · approvals · inbox-metadata-actions, viewer-gating-submitter-side, record-page-decisions, inbox-keyboard-flow, pending-count-surfaces, account-app-entry, setup-nav-entry, notification-deep-link
- workflow · Every approval action is backed by the server-side state machine, and the one-click email action takes the same road · approvals · decision-action-matrix, decision-only-via-service, status-mirror-field, email-action-token-door
- workflow · Flows run: node types, trigger types, the run tree and logs · automation · flow-node-type-matrix, trigger-type-matrix, flow-run-step-nesting, flow-runs-page-test-trigger, trigger-status-contract
- workflow · Flow errors, pauses and schedules: try/catch, screen flows, resuming after a cold restart, rollups and time-based triggers, the toggle is the brake · automation · flow-error-handling, screen-flow-roundtrip, durable-suspend-restart, rollup-summary-filter, time-relative-trigger, flow-toggle-kill-switch
- reports · Charts paint, every type is there, empty data is handled gracefully, a wrong key is loud; drill-through works and global filters refetch · dashboards · chart-first-paint, chart-type-matrix, empty-null-bucket-boundaries, strict-widget-rejects-stray-keys, drill-through-range, global-filters-rescope
- reports · Reports you build, save and own yourself, and that send themselves on schedule · dashboards · dataset-report-authoring, saved-report-ownership, report-schedule-dispatch-delivery
- reports · The business numbers add up: the system overview and the analytics cube · dashboards · system-overview-live-counts, cube-query
- files · Upload and download work, and permissions follow the parent record · attachments-storage · presigned-upload-roundtrip, download-authz-both-sides, read-inherits-parent-rls, attach-requires-parent-edit
- files · A file's lifetime and the file cell in a form: submit, tombstone, reap, resume; size and type are checked again on the server · attachments-storage · sys-file-status-pipeline, orphan-tombstone-reap, upload-session-abort, inline-grid-receipt-cells, field-accept-maxsize-server-enforced
- i18n · The whole application speaks the customer's language, Studio switches with it, and notifications land in the right language too · i18n · surface-matrix, studio-follows-app-locale, notification-localized-and-clears
- api · The query contract: operators, parameters, aggregates and date windows all have known answers · api-backend · query-contract-matrix, aggregate-contract-matrix, date-range-preset-matrix, filter-comparand-conformance
- api · Bulk and the write door answer row by row; the error envelope and the route ledger: every code is registered, and what is mounted is what really runs · api-backend · bulk-write-contract, batch-transactional-discovery, error-envelope-ledger, route-ledger-live-parity
- api · A self-declared API endpoint mounts as a real URL and can be tried on the spot in the developer console · api-backend · declarative-endpoint-execution, api-console-discovery-execute
- api · The REST surface's construction contract: switches decide what mounts and which verbs pass, timing opens to administrators only · api-backend · rest-crud-config-contract, rest-batch-config-contract, rest-metadata-config-contract, rest-route-generation-tombstones, api-methods-verb-gate, server-timing-admin-gated
- api · The formula engine: every standard-library function gives a known answer, and a wrong expression is stopped at build time · api-backend · formula-stdlib-matrix, formula-gates
- api · Connect to external systems: connectors land declaratively, a broken one degrades alone, auth and command allowlists, callable from a flow · integration-system + automation · connector-declarative-boot, connector-degraded-recovery, connector-stdio-default-deny, connector-spec-path-no-escape, connector-descriptor-audit, connector-auth-kind-application, flow-connector-picker, automation.connector-dispatch-matrix
- api · An external data source plugs in and is used as your own objects; secrets can be neither written in nor read out · integration-system + cli · external-datasource-federated-read, external-schema-introspection, external-schema-drift-gate, external-schema-browser-ui, datasource-admin-lifecycle, datasource-credential-refusal-matrix, cli.datasource-introspect-codegen
- api · Send out, take in: webhooks, scheduled jobs, email templates, inbox delivery and subscription preferences, the bell's read state · integration-system + platform-core · webhook-lifecycle, job-scheduled-run, email-template-render, notify-inbox-delivery, notification-preference-suppression, platform-core.notification-center

**③ Verify: loudly reject what is wrong, let through what is right**

- devpath · `objectstack verify`'s verdicts are a closed set, and only a failure exits non-zero; the quality suite runs on a real application · cli · verify-verdict-exit-mapping, qa-suite-execution
- devpath · Health check and deprecation scan: every item has an owner and can state a prescription · cli · doctor-health-report, doctor-deprecation-scan
- devpath · Lint severities are a closed set, and only an error blocks; a misused command is loud · cli · lint-severity-exit-contract, flag-command-error-ux
- api · Wrong metadata is refused at the author's door, with a prescription · api-backend · enforce-or-remove-authoring-gates, retired-def-refusal
- i18n · A wrong translation key is refused at both doors, and the build gate can go red · i18n · strict-translation-key-rejection, build-gates-hold
- studio · A health check of existing metadata: every non-compliance reported with its location · studio-authoring · metadata-diagnostics-sweep

**④ Publish and install into an environment**

- devpath · Pack as a plugin: the manifest is enforced at the packaging boundary · cli · plugin-manifest-build-contract
- devpath · Install it: compatibility, namespaces, enable, disable and uninstall, with the same lifecycle on the REST side · platform-core + api-backend · manifest-install-contract, package-lifecycle-enable-disable, api-backend.package-rest-lifecycle
- devpath · Install from the marketplace: it installs with or without a control plane, and the UI does not lie · platform-core · marketplace-install-local-lifecycle, marketplace-console-honesty
- devpath · Migration: see the plan before acting, an interrupted one can say the next step, and an old spelling gets a fix · cli + platform-core · migrate-plan-apply-json, migrate-meta-codemod, migrate-duplicates-inventory, platform-core.interrupted-migration-boot-report
- devpath · A packaged object can be extended but not changed, and every enable and disable is recorded on the activation ledger · platform-core + access-security · packaged-object-extend-only, activation-ledger-registration-home, activation-ledger-row-contract, access-security.activation-write-operator-gate
- workflow · Packaged flows and actions: disabling is durable, refused while depended on, cloneable, and both doors are equally strict · automation + api-backend + access-security · packaged-flow-disable-durable, packaged-flow-subflow-disable-refusal, packaged-flow-clone-contract, setup-packaged-automation-board, api-backend.packaged-action-disabled-dispatch, api-backend.action-activation-door-contract, access-security.packaged-flow-write-door-parity
- access · An installed package carries the capabilities and permission sets it declares, and a read-only package locks Studio · access-security + studio-authoring · capability-declaration-lifecycle, packaged-permission-set-lifecycle, readonly-package-locks-studio, studio-authoring.packaged-automation-studio-lock
- studio · Packaged views and dashboards are the class that can be edited directly · studio-authoring · packaged-display-class-direct-edit
- devpath · You own it: the definitions are diffable in your repository, and the whole ontology can be exported and run self-hosted without us · platform-core + cli · ontology-export-roundtrip, artifact-reproducible-build, standalone-boot-no-cloud (checklist item to be written)

**⑤ Connect an agent (MCP in the community edition) and have it complete one real business operation**

- ai · agent / tool / skill metadata can be written and listed, and a retired key gets a prescription · ai · agent-tool-skill-metadata-roundtrip
- ai · The MCP surface switches as documented: both the HTTP and the stdio road fail closed · ai · mcp-http-surface, mcp-stdio-fail-closed
- ai · What an agent can do is what the application really can do: an action is exposed first, an expression is validated on the spot · ai · mcp-run-action-exposure-gate, mcp-validate-expression
- ai · Skill instructions are projected onto MCP prompts · ai · skill-instructions-mcp-prompts
- ai · What the community edition lacks it honestly says it lacks, and the UI puts up no empty shell · ai · open-edition-honest-degradation, console-ai-surface-gating
- identity · Give an agent a personal key: shown once, revocable and restorable · identity-auth · api-key-ui-lifecycle

**⑥ Iterate once on a one-sentence customer request**

- studio · The first-run loop: create a package → create an object → records → an app → publish → end user, zero code and zero restarts · studio-authoring · first-run-loop
- records · Bring the customer's existing data in: encoding, mapping, transforms, undo and cancel · records-forms · import-wizard-encoding-and-hints, named-import-mapping, import-job-undo-cancel, import-transform-matrix
- devpath · Structural changes an iteration brings: a dev boot self-heals only the safe part, and production takes no liberties · cli · dev-automigrate-policy

**Priority**:
1. Security and data integrity always come first and do not wait for the road.
2. The road broken, or a capability on the checklist broken ⇒ P0/P1; runs but goes wrong ⇒ P2; neither on the road nor on the checklist ⇒ p3 or not taken on. Grading reads "Features on the road": change that table to change priority, ⛔ never re-grade card by card.
3. While a lane's queue still holds an open P0/P1, that lane dispatches no p2/p3 tooling card or contract-hygiene card; an instrument card that unblocks a product P0/P1 inherits its priority along the chain.
4. Because AI writes it and AI uses it: the ontology must be writable by AI — what is wrong must be loudly refused with a prescription, never silently stored; and usable by people and agents — declared objects, actions and agent / tool / skill metadata are honoured at runtime, what the MCP surface exposes is what the application really can do, and an agent that oversteps is stopped by permissions and leaves a trace. The half people use has a standard too: an author who writes not one line of UI code gets a UI that looks as if a designer had handled it — one design system, one layout; looking wrong is as much a defect as failing to render, and is refused at the "see it" step. One wrong sentence in the documentation and skills written for AI is a product defect.

**Stage posture**: speed over compatibility. Few people use it: a retirement takes effect at once, with no transition window and no alias double-spelling; compatibility layers, migration windows and the like default to p3; keys declared but not honoured are retired in batches per release, not one card per key.

**Instruments serve the fleet**: a card that changes the PM protocol, a gate, a ratchet or a skill is graded by "which decision or action of the fleet will differ once it lands" — if that can be said (a dispatch that would otherwise have gone wrong, a landing that could not land, a review that let a fake through, a seat that got stuck), it is graded by the rules above and competes with product cards on the same field; if it cannot be said, it is not taken on.

**Not now**: the cloud service's journey (sign-up, control plane, hosting) has its own checklist; the enterprise edition's built-in agent belongs to the cloud repository and is not on this repository's road or checklist; billing is not built.

**The ledger**: the ledger of capabilities and verification is `docs/qa/platform-checklist/`, and this page does not copy it. This page carries no numbers; numbers come from commands.
