# ObjectStack North Star

**What we are**: the ontology is the software — an executable business ontology (objects and fields, relationships, actions, permissions, flows, agent and tool definitions) that AI writes, the runtime runs, people and agents use, and you own; startup stage. Views, dashboards, apps and translations are projections of the ontology — the surfaces through which people use it, see it and verify it today.

**Who it is for**: third-party developers, AI agents first with a human accepting — the AI enters our metadata protocol and writes applications, the human looks at the result and decides. The applications' end users are the business staff in companies, who use the applications through agents and the UI.

**What gets built**: **AI-native enterprise management applications** — business objects and records, views to see the data, forms that work, permissions that really hold, approvals and automation, business reports, sign-in and identity, an API others can call, files, the customer's language, and changing the application while it runs without writing code. AI-native means: the application carries an agent that can operate it on the user's behalf — this repository (the community edition) exposes objects and actions over MCP and users connect their own agent; the enterprise edition builds the agent into the user interface, and that half lives in the cloud repository. Missing any one of these, it is not this application. This line is a definition, not a checklist; what each item must do and how it is verified is in `docs/qa/platform-checklist/`. Reference implementation: hotcrm. Two kinds of user: today, business staff through the UI and acceptors through the console; tomorrow, agents through MCP. Every step of the road must hold for both kinds of user.

**What counts as done**: an application built on the protocol is done only once it has passed verification — the checklist items its metadata maps to pass in one run, and `objectstack verify` is green on it. A delivery that has not passed verification does not count as done.

**The one measure: the road**: a new AI developer (a human accepting alongside) starts from `npm create objectstack`: write metadata → run it locally and see it → verification loudly rejects what is wrong and lets through what is right → publish and install into an environment → connect an agent (MCP in the community edition) and have it complete one real business operation in the application → iterate once on a one-sentence customer request. Walk it for real every week, and the result lands as a run record. The first step that breaks, and one that runs through but gives a wrong result, are graded by "Priority" rule 2; the road is the builder's path, so a step that breaks with no workaround is Broken × builders, p1. The four promises are each kept by a step: ① AI can write it · ②③ it executes · ④ you own it · ⑤ agents can operate it; the sixth step, ⑥, closes the loop.

**Product areas**: the work is split into six standing product areas, plus two areas that are not product; every public card carries exactly one `area:*` label. Security is an area of its own and lives only in the private security channel. An area is split by what the user feels is broken, not by whether the code sits in the frontend or the backend; which layer the code is in is what `domain:*` decides, and it only decides who changes which files. An area is a standing label and opens no issue; its core features are listed here. A sub-epic is a temporary `pm:epic` issue that the maintainer opens when the business needs one and closes when it is done; a card under a sub-epic takes its `area:*` by its content, and dispatch follows the parent link. Only AI is in development today; the others are relatively stable. The cloud repository follows these rules with its own areas and core features.

| Area | What it covers | Core features | Status |
|:--|:--|:--|:--|
| `area:ai` AI | asking for data, writing data, MCP, AI chat, product skills, evals and scenario cards | ① asking for data returns the right numbers and holds row- and field-level permissions ② answers use labels and units and never expose internal values ③ writing data (changing records, running actions, moving approvals) passes permissions and confirmation; an overstep is stopped and leaves a trace ④ what MCP exposes is what the application really can do ⑤ what the skills say matches what the platform does | in development |
| `area:build` Building | starting a project, writing and verifying metadata, building in Studio, the CLI | ① one command creates a project and runs it ② wrong metadata is loudly refused with a prescription ③ Studio builds objects, fields, views, forms and pages ④ draft to publish is atomic | stable |
| `area:data` Data and permissions | records, search, the numbers in queries and reports, query performance, files, row- and field-level permissions, sign-in and organizations, audit | ① records are created, read, updated and deleted; fields accept input and persist, a wrong value is refused on the spot, master and detail save together ② list filtering, sorting, pagination, bulk actions and search give the right results ③ queries, aggregates, reports and dashboards add up; a query runs in the database and is not truncated when the data is large ④ row- and field-level permissions are right on both the frontend and the backend, and file permissions follow the record ⑤ anonymous cannot get in; sign-in, password recovery, two-factor authentication, sessions that can be revoked ⑥ organizations, members, invitations, SSO and SCIM; the audit log can be browsed and access can be explained | stable, core |
| `area:workflow` Flows and integration | flows, approvals, notifications, printing, scheduled jobs, the API, external data and connectors | ① flows and approvals run to completion ② notifications arrive and scheduled jobs run on time ③ the API works as documented ④ external data and connectors plug in, and a sync loses nothing | stable |
| `area:ux` Experience | whether it looks right, is easy to use and gives feedback; i18n, mobile, the shell and navigation, page load | ① one design system, one consistent layout ② every write gives feedback ③ an error speaks plainly and gives the reason ④ the main operations can be done on a phone ⑤ a Chinese interface shows no stray English ⑥ common pages paint their first screen within an acceptable time (threshold to be set) | stable |
| `area:package` Packages and install | addressing by package, installing, enabling, disabling and uninstalling packages, seed data, upgrades and migrations, release notes | ① a package installs, enables, disables and uninstalls, and once disabled every surface says the same ② seed data lands exactly as written ③ an upgrade shows its plan first and loses no data ④ every release has release notes, and a breaking change has a migration guide | stable |
| Security (no label) | security cards in the private security channel | graded by the security table below; the grade is recorded only in the security channel | private |
| `area:fleet` Fleet | CI, tests, lint tools, PM tools, the fleet's internal skills, governance scripts | no core features; graded by which decision of the fleet will differ once it lands ("Instruments serve the fleet") | not product |
| `area:cloud` Hosted dependencies | work in this repository done for the cloud; problems that appear only in the hosted environment | follows the cloud cards | paused (follows the cloud lane) |

Area boundaries, one `area:*` per card:
- The result is wrong or the thing cannot be done ⇒ the area of that feature; it can be done but looks wrong, is hard to use, cannot be understood or gives no feedback ⇒ `area:ux`. i18n and mobile go to `area:ux` even when the thing cannot be done.
- Data and permissions inside the application (sign-in, organizations and search included) ⇒ `area:data`; across systems (the API, syncs, connectors) and step by step (flows, approvals, notifications, schedules) ⇒ `area:workflow`. A permission bypassed always goes to `area:data`, whether or not the door is MCP.
- Writing metadata ⇒ `area:build`; installing, upgrading and releasing packages ⇒ `area:package`.
- Slow: a slow query, a query not pushed down, data truncated because it is large ⇒ `area:data`; a slow page load ⇒ `area:ux`; any other slowness goes to the area of its feature.
- A problem that appears only in the hosted environment always goes to `area:cloud`, and is graded all the same.
- Product skills (the `skills/` shipped to users), evals and scenario cards ⇒ `area:ai`; CI, test tools, PM tools and the fleet's internal skills ⇒ `area:fleet`.
- A security hole opens no public issue and carries no `area:*`: it goes to the private security channel, and the grading line of a public card never describes a security mechanism.
- A card that fits no area: triage says so on the card and reports it to the maintainer, and never opens a new area itself.

**Features on the road**: the features the platform has to deliver, one per line, grouped by product area; each row names the step of the road it serves. The table is the feature map, not an order: grading reads the core features above, and dispatch order comes from the areas and sub-epics the maintainer names. Each row reads `step · feature (in business language) · checklist area · item ids`, and one feature is a whole strip from protocol through runtime to the frontend; every item in `docs/qa/platform-checklist/` belongs to exactly one row here (an item not yet written is marked "checklist item to be written"). An id without a prefix belongs to the checklist area before it; one from another area is written in full. The steps: ① set out: start a project with `npm create objectstack`, write metadata · ② run it locally and see it, where every capability an end user uses in the application is needed for the first time · ③ verify: loudly reject what is wrong, let through what is right · ④ publish and install into an environment · ⑤ connect an agent (MCP in the community edition) and have it complete one real business operation · ⑥ iterate once on a one-sentence customer request.

**`area:ai` AI**

- ⑤ · agent / tool / skill metadata can be written and listed, and a retired key gets a prescription · ai · agent-tool-skill-metadata-roundtrip
- ⑤ · The MCP surface switches as documented: both the HTTP and the stdio road fail closed · ai · mcp-http-surface, mcp-stdio-fail-closed
- ⑤ · What an agent can do is what the application really can do: an action is exposed first, an expression is validated on the spot · ai · mcp-run-action-exposure-gate, mcp-validate-expression
- ⑤ · Skill instructions are projected onto MCP prompts · ai · skill-instructions-mcp-prompts
- ⑤ · What the community edition lacks it honestly says it lacks, and the UI puts up no empty shell · ai · open-edition-honest-degradation, console-ai-surface-gating

**`area:build` Building**

- ① · One command starts a project: scaffolded, installed, verification passes, the console's first screen paints · cli · scaffold-first-run, scaffold-console-first-paint
- ① · The build is the author's first gate: errors carry a location, artifacts and statistics come out · cli · build-own-contract
- ① · Code snippets written into metadata have boundaries: hook and action bodies refuse out-of-bounds spellings · cli · hook-body-extraction-gates
- ① · Build objects, fields, lists, forms and record pages without writing code · studio-authoring · object-designer-roundtrip, view-authoring-live, record-page-roundtrip
- ① · Custom pages: block composition, page variables and page-level actions, three source tiers · studio-authoring · custom-page-render-and-blocks, page-variables-and-actions, custom-page-source-tiers
- ① · Draft first, then publish: publishing is atomic, and conflicts and invalid drafts are refused on the spot · studio-authoring · draft-publish-lifecycle, authoring-validation-not-persisted
- ① · Studio's judgements and boundaries: expressions agree with the engine, the permission matrix can be edited, the registry decides what can change at runtime · studio-authoring · expression-editors, permission-matrix-editor-ux, org-override-registry-gate
- ① · An administrator writes Markdown documents in the UI and adds them to the menu (books included), published as a portal by audience · studio-authoring + platform-core · doc-on-app-menu, platform-core.docs-audience-gate, platform-core.docs-portal-render
- ② · One command runs the application: health and readiness both pass, the database choice is honest, port and staleness are both said out loud · cli + platform-core · dev-boot-contract, platform-core.boot-health, platform-core.runtime-config-boot-read
- ② · The metadata registry is readable from outside, and only a writable package can be changed · platform-core · metadata-registry-serving, metadata-authoring-roundtrip
- ② · The formula engine: every standard-library function gives a known answer, and a wrong expression is stopped at build time · api-backend · formula-stdlib-matrix, formula-gates
- ③ · `objectstack verify`'s verdicts are a closed set, and only a failure exits non-zero; the quality suite runs on a real application · cli · verify-verdict-exit-mapping, qa-suite-execution
- ③ · Health check and deprecation scan: every item has an owner and can state a prescription · cli · doctor-health-report, doctor-deprecation-scan
- ③ · Lint severities are a closed set, and only an error blocks; a misused command is loud · cli · lint-severity-exit-contract, flag-command-error-ux
- ③ · Wrong metadata is refused at the author's door, with a prescription · api-backend · enforce-or-remove-authoring-gates, retired-def-refusal
- ③ · A health check of existing metadata: every non-compliance reported with its location · studio-authoring · metadata-diagnostics-sweep
- ⑥ · The first-run loop: create a package → create an object → records → an app → publish → end user, zero code and zero restarts · studio-authoring · first-run-loop

**`area:data` Data and permissions**

- ② · Platform settings change in the UI: a change really takes effect, leaves a trace, and secrets are stored only as handles · platform-core · settings-hub-roundtrip
- ② · Telemetry and lifecycle data are reclaimed by retention period, and an object declared as archived is never hot-deleted · platform-core · lifecycle-retention-sweep
- ② · A record is created, seen, changed and deleted, and another can be made from it · records-forms · crud-roundtrip, record-clone-contract
- ② · Every field type renders, accepts input and persists, and a wrong value is refused on the spot · records-forms · field-type-matrix, field-type-constraints, field-unique-enforcement, encrypted-field-behavior
- ② · Lists get work done: filter, search, sort, paginate, saved views, inline editing, export, bulk · records-forms · list-view-capabilities, view-type-gallery, adhoc-filter-sort-builder, grid-personalization, saved-view-management, bulk-select-all-matching
- ② · Kanban, calendar and Gantt can be dragged; they are not pictures · records-forms · kanban-drag-persistence, calendar-interactions, gantt-interactions
- ② · Forms work: layout, dirty-data guard, conditional visibility and required rules, cascading options · records-forms · form-view-gallery, form-dirty-guard, conditional-rules-header, conditional-rules-grid, cascading-options, cascading-multilevel-and-clear, field-group-visible-when
- ② · Master and detail save together, related lists paginate on the server, and a lookup picker creates a new record in passing · records-forms · master-detail-atomic-save, related-list-server-pagination, lookup-picker-create-new
- ② · Write rules are honoured on the server: a collision is loud, an edit can be undone, and what changed is visible · records-forms · validation-rule-type-matrix, object-hook-lifecycle, delete-behavior-matrix, concurrent-edit-conflict, record-edit-undo, field-history-tracking
- ② · Actions and collaboration on a record: buttons sit where they are declared, the parameter contract is honoured at dispatch, discussion and @-mentions · records-forms · action-location-matrix, action-param-widgets, upload-guard-blocks-confirm, record-discussion-mentions
- ② · Search finds it: across fields, scoped to a field, consistent with permissions, pinyin, fresh at once; global search and the command palette take the same road · search · cross-field-object-search, field-scoped-narrowing, rls-both-personas, pinyin-flag-both-sides, freshness-and-empty, console-global-search, command-palette-navigation
- ② · Shared option sets: several objects reuse one set of options · records-forms · picklist-shared-across-objects
- ② · Row-level and field-level permissions are right on both sides: a restricted member sees only their own, what should be read-only is read-only, and what should be invisible is not returned to the frontend · access-security · rls-both-sides, scope-depth-asymmetry, fls-mask-and-strip
- ② · Create, read, update and delete are honoured cell by cell, a permission change shows at once, and the self-check endpoint agrees with the server · access-security · crud-permission-matrix, permission-matrix-edit-loop, me-permissions-aggregation-parity
- ② · The write path holds: read-only fields are stripped, a forged or transferred owner is refused, and default visibility can only be tightened · access-security · write-path-guards, owd-save-gate
- ② · Sharing: the default baseline, rules that widen, manual sharing of a single record, suggested bindings · access-security · owd-sharing-matrix, sharing-rules-widen, record-share-grant-revoke, sharing-rule-authoring-ui, suggested-binding-loop
- ② · Anonymous cannot get in: every API family refuses uniformly, and before any resource is resolved; having no active organization is also a legal state · access-security · anonymous-deny-surfaces, no-active-org-session-semantics
- ② · The small doors opened to the outside: public forms and share links, revocable and leak-free · access-security · public-form-intake, share-link-capability-tokens, share-link-landing-page
- ② · Explainable and auditable: access explanations attributed layer by layer, an audit log browser, record views leave a trace, and the platform administrator identity itself holds · access-security · record-access-explain, audit-log-browser, record-view-read-audit, platform-owner-email-anchor
- ② · Sign-in methods switch on and off by configuration, and what is advertised really works · identity-auth · auth-method-matrix, sso-enforced-first-paint, phone-signin-surfaces
- ② · The first install has an owner: zero-user first run, the sign-up gate, email verification · identity-auth · first-run-owner-bootstrap, self-signup-gate, email-verification-loop
- ② · You can get back in and change things yourself: forgotten password, profile changes, sessions you can see and revoke · identity-auth · self-service-password-reset, self-service-profile-password, session-list-revoke
- ② · Two-factor authentication: enable, verify, backup codes, disable · identity-auth · two-factor-enrollment-reveal, two-factor-verify-to-activate, two-factor-backup-codes, two-factor-disable-lifecycle
- ② · Organizations, teams and business units, and the administrator's user operations · identity-auth · org-membership-team-management, teams-bu-membership, invitation-scope-gates, workspace-org-switch, admin-lifecycle-operations, identity-import-wizard
- ② · External identity: OAuth consent and linked social accounts · identity-auth · oauth-app-consent-loop, linked-accounts-social
- ② · Charts paint, every type is there, empty data is handled gracefully, a wrong key is loud; drill-through works and global filters refetch · dashboards · chart-first-paint, chart-type-matrix, empty-null-bucket-boundaries, strict-widget-rejects-stray-keys, drill-through-range, global-filters-rescope
- ② · Reports you build, save and own yourself, and that send themselves on schedule · dashboards · dataset-report-authoring, saved-report-ownership, report-schedule-dispatch-delivery
- ② · The business numbers add up: the system overview and the analytics cube · dashboards · system-overview-live-counts, cube-query
- ② · Upload and download work, and permissions follow the parent record · attachments-storage · presigned-upload-roundtrip, download-authz-both-sides, read-inherits-parent-rls, attach-requires-parent-edit
- ② · A file's lifetime and the file cell in a form: submit, tombstone, reap, resume; size and type are checked again on the server · attachments-storage · sys-file-status-pipeline, orphan-tombstone-reap, upload-session-abort, inline-grid-receipt-cells, field-accept-maxsize-server-enforced
- ② · The query contract: operators, parameters, aggregates and date windows all have known answers · api-backend · query-contract-matrix, aggregate-contract-matrix, date-range-preset-matrix, filter-comparand-conformance
- ⑤ · Give an agent a personal key: shown once, revocable and restorable · identity-auth · api-key-ui-lifecycle
- ⑥ · Bring the customer's existing data in: encoding, mapping, transforms, undo and cancel · records-forms · import-wizard-encoding-and-hints, named-import-mapping, import-job-undo-cancel, import-transform-matrix

**`area:workflow` Flows and integration**

- ② · An approval runs to completion: joint sign-off, quorum, dynamic approvers, timeout escalation, out-of-office delegation · approvals · per-group-signoff, quorum-m-of-n, dynamic-approver-routing, sla-escalation, ooo-delegation-reroute, approver-resolution-matrix
- ② · Approvals are done in the UI: the inbox, record-page buttons, a keyboard flow, pending counts, notifications that deep-link · approvals · inbox-metadata-actions, viewer-gating-submitter-side, record-page-decisions, inbox-keyboard-flow, pending-count-surfaces, account-app-entry, setup-nav-entry, notification-deep-link
- ② · Every approval action is backed by the server-side state machine, and the one-click email action takes the same road · approvals · decision-action-matrix, decision-only-via-service, status-mirror-field, email-action-token-door
- ② · Flows run: node types, trigger types, the run tree and logs · automation · flow-node-type-matrix, trigger-type-matrix, flow-run-step-nesting, flow-runs-page-test-trigger, trigger-status-contract
- ② · Flow errors, pauses and schedules: try/catch, screen flows, resuming after a cold restart, rollups and time-based triggers, the toggle is the brake · automation · flow-error-handling, screen-flow-roundtrip, durable-suspend-restart, rollup-summary-filter, time-relative-trigger, flow-toggle-kill-switch
- ② · Bulk and the write door answer row by row; the error envelope and the route ledger: every code is registered, and what is mounted is what really runs · api-backend · bulk-write-contract, batch-transactional-discovery, error-envelope-ledger, route-ledger-live-parity
- ② · A self-declared API endpoint mounts as a real URL and can be tried on the spot in the developer console · api-backend · declarative-endpoint-execution, api-console-discovery-execute
- ② · The REST surface's construction contract: switches decide what mounts and which verbs pass, timing opens to administrators only · api-backend · rest-crud-config-contract, rest-batch-config-contract, rest-metadata-config-contract, rest-route-generation-tombstones, api-methods-verb-gate, server-timing-admin-gated
- ② · Connect to external systems: connectors land declaratively, a broken one degrades alone, auth and command allowlists, callable from a flow · integration-system + automation · connector-declarative-boot, connector-degraded-recovery, connector-stdio-default-deny, connector-spec-path-no-escape, connector-descriptor-audit, connector-auth-kind-application, flow-connector-picker, automation.connector-dispatch-matrix
- ② · An external data source plugs in and is used as your own objects; secrets can be neither written in nor read out · integration-system + cli · external-datasource-federated-read, external-schema-introspection, external-schema-drift-gate, external-schema-browser-ui, datasource-admin-lifecycle, datasource-credential-refusal-matrix, cli.datasource-introspect-codegen
- ② · Send out, take in: webhooks, scheduled jobs, email templates, inbox delivery and subscription preferences, the bell's read state · integration-system + platform-core · webhook-lifecycle, job-scheduled-run, email-template-render, notify-inbox-delivery, notification-preference-suppression, platform-core.notification-center

**`area:ux` Experience**

- ② · You can sign in, and the shell remembers: navigation, built-in apps, favourites and recents, theme, keyboard shortcuts, the back key · platform-core · console-login, nav-surfaces-render, builtin-apps-nav-render, shell-nav-personalization, theme-mode-persistence, keyboard-shortcut-surface, url-overlay-contract, home-admin-cluster-links, console-installability-indicators, app-management-toggle
- ② · The whole application speaks the customer's language, Studio switches with it, and notifications land in the right language too · i18n · surface-matrix, studio-follows-app-locale, notification-localized-and-clears
- ③ · A wrong translation key is refused at both doors, and the build gate can go red · i18n · strict-translation-key-rejection, build-gates-hold

**`area:package` Packages and install**

- ② · Seed data lands in the database as written, and a replay adds nothing and loses nothing · platform-core · seed-integrity, seed-mode-matrix
- ④ · Pack as a plugin: the manifest is enforced at the packaging boundary · cli · plugin-manifest-build-contract
- ④ · Install it: compatibility, namespaces, enable, disable and uninstall, with the same lifecycle on the REST side · platform-core + api-backend · manifest-install-contract, package-lifecycle-enable-disable, api-backend.package-rest-lifecycle
- ④ · Install from the marketplace: it installs with or without a control plane, and the UI does not lie · platform-core · marketplace-install-local-lifecycle, marketplace-console-honesty
- ④ · Migration: see the plan before acting, an interrupted one can say the next step, and an old spelling gets a fix · cli + platform-core · migrate-plan-apply-json, migrate-meta-codemod, migrate-duplicates-inventory, platform-core.interrupted-migration-boot-report
- ④ · A packaged object can be extended but not changed, and every enable and disable is recorded on the activation ledger · platform-core + access-security · packaged-object-extend-only, activation-ledger-registration-home, activation-ledger-row-contract, access-security.activation-write-operator-gate
- ④ · Packaged flows and actions: disabling is durable, refused while depended on, cloneable, and both doors are equally strict · automation + api-backend + access-security · packaged-flow-disable-durable, packaged-flow-subflow-disable-refusal, packaged-flow-clone-contract, setup-packaged-automation-board, api-backend.packaged-action-disabled-dispatch, api-backend.action-activation-door-contract, access-security.packaged-flow-write-door-parity
- ④ · An installed package carries the capabilities and permission sets it declares, and a read-only package locks Studio · access-security + studio-authoring · capability-declaration-lifecycle, packaged-permission-set-lifecycle, readonly-package-locks-studio, studio-authoring.packaged-automation-studio-lock
- ④ · Packaged views and dashboards are the class that can be edited directly · studio-authoring · packaged-display-class-direct-edit
- ④ · You own it: the definitions are diffable in your repository, and the whole ontology can be exported and run self-hosted without us · platform-core + cli · ontology-export-roundtrip, artifact-reproducible-build, standalone-boot-no-cloud (checklist item to be written)
- ⑥ · Structural changes an iteration brings: a dev boot self-heals only the safe part, and production takes no liberties · cli · dev-automigrate-policy

**Priority**:
1. Security and data integrity always come first and do not wait for the road.
2. Grading is two steps, and a card enters the queue only once both are done. **Step one, repository, area and type**: judge the repository first (a platform root cause is fixed in this repository, wherever it shows up), then give the card its `area:*` (above) and its GitHub issue type. Bug = a capability already shipped is broken, and a wrong sentence in a shipped skill or document is a Bug too; Feature = a new capability or an extension; Task = teaching new content, tooling, CI, evals. A record card or an anchor card takes no type and no grade. A card hangs under a sub-epic only when the maintainer has opened one; otherwise its `area:*` is enough to enter the queue. **Step two, the grade**: only Bug cards and security cards are graded by the two tables below. A Feature never enters p1 (unless it blocks another repository's p1, below) and is done in its area's order; a Feature in `area:ux` defaults to p2; a Task defaults to p3, and only rises to p2 when it blocks work being dispatched. Severity has four levels:
   - **Severe**: a security overreach, or data silently wrong, lost or leaked across tenants. "Data wrong" means only that a stored value is wrong or lost; a value read back and shown wrongly is Impeded.
   - **Broken**: a core feature of the area table cannot be done, and there is no workaround.
   - **Impeded**: there is a workaround (same role, same entry point, named by the error or the documentation); a feature that is not core cannot be done; an error that cannot be understood.
   - **Cosmetic**: looks wrong, wording, consistency, small experience.

   Severity is crossed with how often the broken thing is hit (reach). Experience counts as much as function: a UX problem on a shipped core path that every user hits every time is a Bug graded through this table by what it does to that path, at the reach "end users, daily", and can be p1.

   | Severity | End users, daily | Builders, often (on the build, install and upgrade path) | Administrators, often | Rare configuration or developers only |
   |:--|:--|:--|:--|:--|
   | Severe · data wrong | p1 | p1 | p1 | p2 (still p1 when unrecoverable or cross-tenant) |
   | Broken | p1 | p1 | p2 | p2 |
   | Impeded | p2 | p2 | p2 | p3 |
   | Cosmetic | p2 | p3 | p3 | p3 |

   A security problem is not graded by reach but by who can trigger it, who gains and what they get: an attacker walks the path few people walk on purpose, so a rare path lowers no risk. When an administrator acts normally but a third party gains (a user re-enabled and a departed person gets back in with an old key), look up the party that gains. The security hole itself goes to the private security channel, and this table is used there too:

   | Who can trigger it | Gets other people's data, escalates privilege, crosses tenants | Leaks only metadata, or affects only themselves |
   |:--|:--|:--|
   | Anonymous or an outsider | p1 | p2 |
   | An ordinary member | p1 | p2 |
   | An administrator or the host developer | p2 (still p1 when escalating to platform administrator or crossing tenants) | p3 |

   Also:
   - A wrong sentence in a shipped skill or document is a Bug, with the reach "builders, often", because AI copies it into what it writes.
   - "Someone is waiting" raises no grade. A card that blocks another carries `pm:blocking` only when the blocked card is in an area being dispatched, and the grade is not inherited up the chain — except that a card blocking another repository's p1 takes that card's grade, a Feature included.
   - A p3 with no effect on users (review nits, internal comments, wording) is closed at first touch and never queued.
   - p0 is time, not severity, and only these: main or the merge queue red, a release blocker inside the release window, a security hole being exploited in production.
   - The grading comment carries one line: area · type · severity · reach · evidence (measured, or read from the code).
   - A card is not re-graded card by card: one re-grade pass when these grading rules change, none otherwise; a card in flight (dispatched or claimed) may be raised, never lowered.
3. The grade only decides whether a card jumps the queue; what is dispatched is decided by the area. A seat takes its next card in this order: ① p0, dispatched in the same round, past every concurrency cap ② p1, ahead of the next card of the area being dispatched, whatever area it belongs to, a held or paused area included ③ the next card of the area being dispatched, in the order of the areas and sub-epics the maintainer names, and inside one by its own child order and `Blocked-by:` ④ inside an area, p2 and p3 are only a reference: p2 first, p3 left for the close-out or batched; in an area with no sub-epic, p2 before p3, and at the same grade the card opened first goes first. A paused area no longer demotes its cards to p3: the grade reflects severity, not whether the area is being dispatched; an ordinary card in a paused area is not dispatched, and a real p1 in it still jumps the queue. Triage reads the open p1 cards once a week, and when there are more than ten re-checks whether they were graded too high.
4. Because AI writes it and AI uses it: the ontology must be writable by AI — what is wrong must be loudly refused with a prescription, never silently stored; and usable by people and agents — declared objects, actions and agent / tool / skill metadata are honoured at runtime, what the MCP surface exposes is what the application really can do, and an agent that oversteps is stopped by permissions and leaves a trace. The half people use has a standard too: an author who writes not one line of UI code gets a UI that looks as if a designer had handled it — one design system, one layout; looking wrong is as much a defect as failing to render, and is refused at the "see it" step. One wrong sentence in the documentation and skills written for AI is a product defect.

**Stage posture**: speed over compatibility. Few people use it: a retirement takes effect at once, with no transition window and no alias double-spelling; compatibility layers, migration windows and the like default to p3; keys declared but not honoured are retired in batches per release, not one card per key.

**Instruments serve the fleet**: a card that changes the PM protocol, a gate, a ratchet or a skill is graded by "which decision or action of the fleet will differ once it lands" — if that can be said (a dispatch that would otherwise have gone wrong, a landing that could not land, a review that let a fake through, a seat that got stuck), it is graded by the rules above and competes with product cards on the same field; if it cannot be said, it is not taken on.

**Not now**: the cloud service's journey (sign-up, control plane, hosting) has its own checklist; the enterprise edition's built-in agent belongs to the cloud repository and is not on this repository's road or checklist; billing is not built.

**The ledger**: the ledger of capabilities and verification is `docs/qa/platform-checklist/`, and this page does not copy it. This page carries no numbers; numbers come from commands.
