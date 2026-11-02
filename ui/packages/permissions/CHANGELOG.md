# @object-ui/permissions

## 18.3.0

### Patch Changes

- 4daad78: docs: the README's Contributing Guide and Roadmap links point at the ObjectStack repository (objectstack#26080)
  
  Every package README linked its "Contributing Guide" and "Roadmap" to `CONTRIBUTING.md` and `ROADMAP.md` in the archived `objectstack-ai/objectui` repository. Those documents now live at the root of `objectstack-ai/objectstack`, which is where the links point; the `@object-ui/console` README's roadmap links move there too. No code, export or behaviour changes.
  
  Clause-②: no
  Metadata-protocol: none
- 6866e2e: feat(permissions): `RecordFieldAccessScope` answers one record's field locks from the server's record-scoped projection
  
  Clause-②: yes (widening)
  Metadata-protocol: none
  
  Below `RecordFieldAccessScope`, `checkField(object, field, 'write')` for the scoped record answers from the server's projection of that record wherever `/auth/me/permissions` reports a field-level lock. That reader holds no row, so it reports a lock that applies only from a stage onward (a field permission `when`) on every row; the scope replaces that one input with the write gate's verdict for the stored row. The object-grant fallback, the owner-transfer rule, `read` and `create`, and every other object keep the enclosing provider's answer. Until the answer arrives, and when there is none, the row-blind lock stands. When its `revision` prop moves (the row was saved or re-read), it asks again and the lock stands until the new answer lands. The client never evaluates `when`. A nested scope for the same record asks once.
- b5e4ce6: fix(plugin-form): the record edit dialog draws a record the caller may read but not write as read-only, says why, and offers no Save
  
  Clause-②: no
  Metadata-protocol: none
  
  On a record shared to the caller for reading only (sharing, ownership or row-level security), or held by a pending approval that locks it, the console's edit dialog used to open with every field live; the user filled it in and the server refused the save as a whole. The dialog now asks the server about the row itself:
  
  - **The row's verdict.** `RecordFieldAccess` (`@object-ui/types`) carries the record projection's `writable`, which `DataSource.getRecordFieldAccess` already passes through. Below `RecordFieldAccessScope` (`@object-ui/permissions`), `writable: false` refuses `write` on every field of the record and `check(object, 'update')` with the reason `record-not-writable`; `read`, `create`, other objects and other records keep the enclosing answer, and an object grant the provider already refuses keeps its own reason. `writable: true` and an absent `writable` (an older server) change nothing.
  - **The approval lock.** The projection leaves out the approvals record lock, which the server judges on the values a save sends. `RecordFieldAccessScope` takes `lockedBy: 'approval'` for a lock the host reads, answered the same way with the reason `record-locked-by-approval`, and `ModalForm` takes the same `lockedBy` prop. The console's edit dialog passes it from the approvals read and rule the record page uses.
  - **What the form draws.** Every field gate (`gateFormFields`, the outbound write gate, the record page's inline edit) reads the scoped answer with no call-site change. `closedFormAffordance` reports `record` or `approval` for such a row, the form's notice says "You don't have permission to edit this record. The fields are read-only." (new key `form.noPermissionToEditRecord` in every pack) or the record page's approval-lock sentence, and `ModalForm` and `DrawerForm` offer no Save on it.
- 7587fd4: docs(ui): package homepages and README links point at objectstack.ai/docs; objectui.org is retired
  
  Clause-②: no
  Metadata-protocol: none
  
  The ObjectUI documentation site at objectui.org is retired. Its pages now live in the ObjectStack docs, mostly under [User Interface](https://objectstack.ai/docs/frontend). Every `@object-ui/*` package's `homepage` and README links now go to the matching page there, and the old objectui.org addresses answer with a permanent redirect to the same page. The `description` fields spell the product name "ObjectUI". The `@objectstack/skills` bundle's ObjectUI skill links to the same pages. Nothing else changes in what these packages ship.
- 4d278c9: feat(spec): a strict response contract for `GET /auth/me/permissions`, and `hasAnyQueue` on the ownership-queue contract
  
  Clause-②: yes (widening)
  Metadata-protocol: added
  
  `GET /auth/me/permissions` is the payload the console reads once per session for its whole permission layer. Until now nothing in `@objectstack/spec` declared its body. It is now declared, strictly:
  
  - **`MePermissionsResponseSchema`** (`@objectstack/spec/api`), discriminated by `authenticated`:
    - `MePermissionsAnonymousResponseSchema`: `{ authenticated: false }` and nothing else.
    - `MePermissionsAuthenticatedResponseSchema`: `userId`, `tenantId` (nullable), `positions`, `permissionSets`, `objects` (effective object permissions), `fields` (`{ readable, editable }` per `object.field`), `systemPermissions` and `tabPermissions` (optional: absent only on the body a server without SecurityPlugin answers, where absent means unknown), and `hasAnyQueue: boolean`.
    - Both branches are strict: an undeclared key is refused, not dropped. A key the server starts sending is declared here first.
    - Types `MePermissionsResponse`, `MePermissionsAnonymousResponse`, `MePermissionsAuthenticatedResponse`.
  - **`IOwnershipQueueService.hasAnyQueue?(organizationId)`** (`@objectstack/spec/contracts`): does the organization have at least one ownership queue, `true` exactly when some name would resolve through `resolveQueue`. Optional, like `declaredQueueNamed?`, so an implementation written before it still satisfies the contract; the route answers `false` without it. `@objectstack/plugin-sharing`'s `OwnershipQueueService` implements it.
  - **`@objectstack/plugin-hono-server`** types the route's body builder against `MePermissionsAuthenticatedResponse`, and reads `hasAnyQueue` through the contract. The wire is unchanged.
  - **`@object-ui/permissions`**: `MePermissionsResponse` is now the spec's type, re-exported from `@objectstack/spec/api` (with `MePermissionsAuthenticatedResponse` beside it), in place of a hand-written interface that had drifted from the wire. The interface read a `roles` key the server never sends; the server's key is `positions`, so `usePermissions().roles` under `MePermissionsProvider` was always empty and now carries the caller's positions. A fixture typed as the response migrates `roles: [...]` → `positions: [...]` and adds `hasAnyQueue`; the anonymous body is `{ authenticated: false }` and nothing else.
- Updated dependencies [0ea90c7]
- Updated dependencies [dbf7e04]
- Updated dependencies [a9f654e]
- Updated dependencies [b49b752]
- Updated dependencies [f486e9c]
- Updated dependencies [c59b1bf]
- Updated dependencies [8a12a17]
- Updated dependencies [d8a9cc5]
- Updated dependencies [b53d9f3]
- Updated dependencies [a260556]
- Updated dependencies [8eeb3b3]
- Updated dependencies [607d3bb]
- Updated dependencies [4daad78]
- Updated dependencies [4f05de4]
- Updated dependencies [95f818d]
- Updated dependencies [b3f7344]
- Updated dependencies [d90657b]
- Updated dependencies [ff26bc4]
- Updated dependencies [21a13f1]
- Updated dependencies [c68869c]
- Updated dependencies [162f668]
- Updated dependencies [43714ca]
- Updated dependencies [63e3873]
- Updated dependencies [9bf6598]
- Updated dependencies [d9bf777]
- Updated dependencies [bb91ae8]
- Updated dependencies [d434481]
- Updated dependencies [f9f27a0]
- Updated dependencies [6866e2e]
- Updated dependencies [02b1392]
- Updated dependencies [c26d643]
- Updated dependencies [13e85be]
- Updated dependencies [13dc413]
- Updated dependencies [eab4bba]
- Updated dependencies [e438a55]
- Updated dependencies [2205863]
- Updated dependencies [a122269]
- Updated dependencies [9fab076]
- Updated dependencies [74801d1]
- Updated dependencies [17b5152]
- Updated dependencies [031d97a]
- Updated dependencies [0c47e87]
- Updated dependencies [e01edb2]
- Updated dependencies [f79fa74]
- Updated dependencies [b358e79]
- Updated dependencies [5374967]
- Updated dependencies [8a218fc]
- Updated dependencies [1539aad]
- Updated dependencies [cdd9f0a]
- Updated dependencies [3fe9d25]
- Updated dependencies [2ecf6a7]
- Updated dependencies [fbe344b]
- Updated dependencies [354dfcd]
- Updated dependencies [d887aa9]
- Updated dependencies [39fd5fb]
- Updated dependencies [81b4599]
- Updated dependencies [c13ef04]
- Updated dependencies [6eaf404]
- Updated dependencies [79ed6f7]
- Updated dependencies [40320f1]
- Updated dependencies [49d652e]
- Updated dependencies [0fb0dda]
- Updated dependencies [e3470ed]
- Updated dependencies [9ac5ae5]
- Updated dependencies [c082af6]
- Updated dependencies [6dbff8e]
- Updated dependencies [c63ce2a]
- Updated dependencies [12b5aec]
- Updated dependencies [8b1740a]
- Updated dependencies [b88519e]
- Updated dependencies [e5b5c5b]
- Updated dependencies [10f27b6]
- Updated dependencies [fe9e856]
- Updated dependencies [d4ff1a0]
- Updated dependencies [ae16687]
- Updated dependencies [b5e4ce6]
- Updated dependencies [7587fd4]
- Updated dependencies [efdf11a]
- Updated dependencies [2655ebd]
- Updated dependencies [14e9685]
- Updated dependencies [0cd578f]
- Updated dependencies [a33fce2]
- Updated dependencies [385aa12]
- Updated dependencies [8bb2c31]
- Updated dependencies [8d79bbd]
- Updated dependencies [b8f4acc]
- Updated dependencies [4145210]
- Updated dependencies [194e66c]
- Updated dependencies [57c51aa]
- Updated dependencies [3604371]
- Updated dependencies [73b7270]
- Updated dependencies [6762dd9]
- Updated dependencies [556f323]
- Updated dependencies [b445807]
- Updated dependencies [6abcb72]
- Updated dependencies [7735d1d]
- Updated dependencies [9c51314]
- Updated dependencies [86edcaf]
- Updated dependencies [10755db]
- Updated dependencies [ad3a640]
- Updated dependencies [fbaacfe]
- Updated dependencies [dbf576b]
- Updated dependencies [ad2c286]
- Updated dependencies [9462d8a]
- Updated dependencies [4fa4f2c]
- Updated dependencies [76b4ae4]
- Updated dependencies [0368504]
- Updated dependencies [6663a66]
- Updated dependencies [fbb8bec]
- Updated dependencies [aad9ad5]
- Updated dependencies [9ab75ee]
- Updated dependencies [e0aed00]
- Updated dependencies [0ac6dab]
- Updated dependencies [72b08ee]
- Updated dependencies [bf658d1]
- Updated dependencies [bf658d1]
- Updated dependencies [3702be4]
- Updated dependencies [4a5396b]
- Updated dependencies [9d29223]
- Updated dependencies [7538f27]
- Updated dependencies [21c4bdd]
- Updated dependencies [2c683cf]
- Updated dependencies [86c9d53]
- Updated dependencies [bfdaba4]
- Updated dependencies [8441a01]
- Updated dependencies [0027c4a]
- Updated dependencies [0027c4a]
- Updated dependencies [684f2f6]
- Updated dependencies [869fa76]
- Updated dependencies [74aae1e]
- Updated dependencies [2b4b970]
- Updated dependencies [e063a87]
- Updated dependencies [7811c3f]
- Updated dependencies [755e285]
- Updated dependencies [07585bf]
- Updated dependencies [2695de7]
- Updated dependencies [0a4b0fb]
- Updated dependencies [b373263]
- Updated dependencies [d3b0a40]
- Updated dependencies [a68430a]
- Updated dependencies [6da8c3c]
- Updated dependencies [2e20454]
- Updated dependencies [1ea3fe9]
- Updated dependencies [3e0fd7a]
- Updated dependencies [f552fa8]
- Updated dependencies [dc4755c]
- Updated dependencies [4793aa4]
- Updated dependencies [3a054cb]
- Updated dependencies [f934a41]
- Updated dependencies [a7bdac4]
- Updated dependencies [c3842ac]
- Updated dependencies [916531a]
- Updated dependencies [7e3822c]
- Updated dependencies [3cc45cc]
- Updated dependencies [3a2f4c0]
- Updated dependencies [5b7dbb8]
- Updated dependencies [8d36669]
- Updated dependencies [e26cf9a]
- Updated dependencies [6e0b16a]
- Updated dependencies [7c3cc88]
- Updated dependencies [9b1dc99]
- Updated dependencies [f3fe660]
- Updated dependencies [3739d8d]
- Updated dependencies [f4a8eed]
- Updated dependencies [8f36f6b]
- Updated dependencies [80a9f99]
- Updated dependencies [11a7f96]
- Updated dependencies [b357250]
- Updated dependencies [75c2658]
- Updated dependencies [35f2055]
- Updated dependencies [fb4e0bb]
- Updated dependencies [7d846b5]
- Updated dependencies [fc5d509]
- Updated dependencies [71de060]
- Updated dependencies [6fd87b7]
- Updated dependencies [d359857]
- Updated dependencies [3238750]
- Updated dependencies [f23e051]
- Updated dependencies [bed8306]
- Updated dependencies [04c8930]
- Updated dependencies [001c04b]
- Updated dependencies [2d3aa8c]
- Updated dependencies [85a1b9d]
- Updated dependencies [361ea24]
- Updated dependencies [ea1751b]
- Updated dependencies [3fd4d6b]
- Updated dependencies [a00f335]
- Updated dependencies [700ec85]
- Updated dependencies [8bceb6a]
- Updated dependencies [8771726]
- Updated dependencies [ef0f6a1]
- Updated dependencies [9eaa209]
- Updated dependencies [ba0084e]
- Updated dependencies [462935d]
- Updated dependencies [0ecc2c4]
- Updated dependencies [d6e0967]
- Updated dependencies [519089e]
- Updated dependencies [16e7a80]
- Updated dependencies [bede9de]
- Updated dependencies [044d201]
- Updated dependencies [12333ba]
- Updated dependencies [82b29fe]
- Updated dependencies [4d278c9]
- Updated dependencies [5114b0e]
- Updated dependencies [e62dcc5]
- Updated dependencies [0c1829a]
- Updated dependencies [36fa4ff]
- Updated dependencies [e170d42]
- Updated dependencies [f5a400a]
- Updated dependencies [a9782b3]
- Updated dependencies [8196881]
- Updated dependencies [5493b88]
- Updated dependencies [663b7c0]
- Updated dependencies [50df124]
- Updated dependencies [3cb8553]
- Updated dependencies [70943dd]
- Updated dependencies [2081a5e]
- Updated dependencies [892eb66]
- Updated dependencies [2cba2eb]
- Updated dependencies [99a6a78]
- Updated dependencies [672bda0]
- Updated dependencies [3e54f99]
- Updated dependencies [710c2da]
- Updated dependencies [5d759b1]
  - @objectstack/spec@18.3.0
  - @object-ui/types@18.3.0

## 18.2.0

### Minor Changes

- 9a0af4e: **BREAKING** Object UI's changes from its 18.1.0 release to the day it moved into this repository, released here as one entry. They are objectui commits `a3c0da9`..`9e1fe03`, the release commit to the freeze. Their 65 changesets came across with the code under `ui/.changeset/`, which `changeset version` does not read, so this entry carries them into the release. Each of those 65 files stays in `ui/.changeset/` unchanged, as the full record of its change. Five of the changes are breaking retirements; each has a paragraph below and points at the file that holds its migration table.
  
  <!-- adr-0087: not-required (no-migration-prescription) The five retirements below shipped in objectui before it merged into this repository, and each one is an `@object-ui/*` surface: a renderer node type and its schema (`html`), a widget source member (`module`), exports nothing read, three providers that duplicated `@object-ui/react` and `@object-ui/app-shell` names, and nine `@object-ui/types` schema keys. None is an `@objectstack/spec` key, object definition or stored shape, so the ADR-0087 registries in `packages/spec` have no entry to write and `objectstack migrate meta` has nothing to rewrite. objectui had no conversion registry; each old spelling is refused by name, at validation or by the compiler, and each change ships its own migration in the original changeset this entry points to, which is why this entry does not restate them (maintainer ruling 28 = B on objectstack#25831). -->
  
  ### The raw-HTML `html` node type is retired (objectui#13449, PR #13475)
  
  `@object-ui/components` no longer registers `html` or `ui:html`, `@object-ui/core` drops it from the public blocks, and `@object-ui/types` no longer exports `HtmlSchema`. Its renderer wrote the authored string into the page with no sanitiser. A page that still names the node draws the unknown-component panel, and `objectui validate` refuses `type: "html"` by name. The `html` field type is a different layer and stays. Migration: `ui/.changeset/13449-retire-html-renderer.md`.
  
  ### The `module` widget source is retired (objectui#13450, PR #13473)
  
  `WidgetRegistry` no longer loads a widget's code from a URL at runtime, and `@object-ui/types` no longer exports `WidgetSourceModule`. That loader was a runtime dynamic import and needed `unsafe-eval` under a strict content security policy. A manifest that still declares the `module` source is refused before anything is fetched, with a message that names both replacement sources. Migration: `ui/.changeset/13450-retire-widget-module-source.md`.
  
  ### Nine zero-consumer modules are retired and the runner is private (objectui#13453 part 1, PR #13506)
  
  `@object-ui/core` drops the fluent schema builders and the drag-and-drop, keyboard and sharing protocol bridges. `@object-ui/react` drops `useFocusTrap`, `useFocusReturn`, `useRovingFocus`, `usePageTransition`, `useSchemaPersistence` and `createLocalStorageAdapter`. `@object-ui/collaboration` drops `LiveCursors`. The test-only reset helpers are no longer on the package roots of `@object-ui/core`, `@object-ui/app-shell`, `@object-ui/types` and `@object-ui/plugin-detail`. Nothing in ObjectUI read any of them. `@object-ui/runner` is now private. Details: `ui/.changeset/13453-core-retire-dead-modules.md`, `13453-react-retire-dead-hooks.md`, `13453-collaboration-retire-live-cursors.md` and `13453-test-helpers-off-barrels.md`.
  
  ### The providers trio is retired (objectui#13453 part 2, PR #13507)
  
  `@object-ui/providers` no longer exports `DataSourceProvider` / `useDataSource`, `MetadataProvider` / `useMetadata` or `ThemeProvider` / `useTheme`. They duplicated names that `@object-ui/react` and `@object-ui/app-shell` publish with different implementations. `UploadProvider` and the upload adapters are unchanged. Migration: `ui/.changeset/13453-providers-retire-trio.md`.
  
  ### Nine duration keys carry their unit in their name (objectstack#25762, PR #13515)
  
  Nine keys on `carousel`, the three chatbot nodes, `ActionSchema`, `ActionSchema.retry`, `toast`, `tooltip`, `hover-card` and `report` now end in `Ms` or `Seconds`. The value and its unit do not change. An old key is refused at its own path with a message that names the new key, and its TypeScript member is `never`. Migration table: `ui/.changeset/25762-duration-keys-carry-unit.md`.
  
  ### Also in this range
  
  - Every package's `react` / `react-dom` peer range is `^19.0.0` (was `^18.0.0 || ^19.0.0`): a React 18 host is no longer supported (objectui#13465, PR #13481).
  - The `react-pages` capability (`kind: 'react'` pages) now defaults to off in `@object-ui/core`; a host turns it on. The Console sets zod's `jitless` before any module runs, so zod no longer probes for `eval` (PR #13526).
  - An invalid `gantt` block is refused with each schema issue named, instead of drawn (objectui#13459, PR #13490). An action's `confirmText` or `successMessage` with no template hole is shown exactly as written (objectui#13476, PR #13482).
  - A record section whose fields are all empty folds into one "Show N empty fields" row (objectui#13386, PR #13483). The list, gallery, map and timeline record preview mounts `RecordDetailPanel` (PR #13486).
  - Bulk actions keep each failed record's id and reason, and refresh the bound list once per run (objectui#13442, PR #13474). The AI build chat's plan card says how the build will land (objectui#12724, PR #13508). Assistant answers render text and charts in stream order (objectui#13492, PR #13500).
  - Inline locale-map labels and descriptions on reports and pages show in the viewer's language (objectui#13470, #13488; PRs #13487, #13501). Positions show by label in a permission set's assigned users (objectui#13477, PR #13493). The translation preview draws the `positions` and `permissions` groups (objectui#13478, PR #13485). Calendar events with a lookup `titleField` show the record's display name (PR #13480). Unlabeled datasource enum selects get readable option labels (objectui#13353, PR #13499).
  - More console pages are translated (objectui#13460, PRs #13489, #13503). Icon-only buttons have accessible names and clickable controls are keyboard-reachable (objectui#13461, PR #13494).
  - Every published package declares `sideEffects` (objectui#13464, PR #13495). One `react` 19.3.0 line and one `zod` `^4.6.5` range across the packages, and single-copy pins for `@ai-sdk/react`, `ai` and `better-auth` (objectstack#25685, #25727; PRs #13472, #13496, #13512).
  - Tooling and test-only changes for the merge, which publish nothing: workspace-root readers and test assumptions (objectstack#25723, #25733; PRs #13484, #13498) and warm test imports (objectstack#25763, PR #13513).
  
  Clause-②: yes (narrowing)
  Metadata-protocol: narrowed

### Patch Changes

- b727956: fix(permissions)!: the console stops offering New, Edit and Delete to a user whose `/me/permissions` row omits the Create, Edit or Delete bit, such as an auditor or a read-only finance user
  
  Clause-②: yes (narrowing) — the console no longer offers Create / Edit / Delete when `/me/permissions` serves an object row that omits the bit. That is exactly when the server refuses it, because the spec grants only on `=== true` (permission.zod.ts:196, :218). The anonymous default and the no-provider fail-open are unchanged.
  Metadata-protocol: none
  
  <!-- adr-0087: not-required (no-migration-prescription) A console permission verdict: no key of any metadata schema is added, removed, renamed or re-shaped, and no export, type or error code changes. The client now reads a served row with the spec's own objectPermissionGrants, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. -->
  
  **BREAKING** (a narrowing of what the console offers) in `MePermissionsProvider` (`@object-ui/permissions`).
  
  - **Before.** `check` (behind `usePermissions().can`) and `checkField`'s object-level fallback read a served object row with `bit !== false`, so a bit the row left out counted as granted. The server serves only the bits a set grants: a read-only set `'*': { allowRead: true }` is served as `{ allowRead: true }` on each object it covers, and an auditor's row as `{ allowRead: true, viewAllRecords: true }`. Those users were offered New on object lists, and Edit and Delete on records. They filled in the form, and the server refused the save with `403`.
  - **Now.** A served row grants an operation only through `objectPermissionGrants` from `@objectstack/spec/security`, the fold the server's permission evaluator decides from. A bit grants only when it is `true`. Modify All Records also grants edit, delete and transfer, and View All Records also grants read. Nothing grants create but `allowCreate: true`. `check` also matches the object key case-insensitively, as `checkField` already did.
  - **Unchanged.** An anonymous session (`authenticated` not `true`) keeps its permissive default. A tree with no permission provider keeps the fail-open `can`. An object the response does not mention is still denied for a signed-in user. A row that carries the bit as `true` grants exactly as before.
  - **Who sees it.** A user whose permission sets grant read but not Create, Edit or Delete on an object. The console now hides or disables those actions, matching the server's answer. A user whose sets grant the bit sees no change.
- Updated dependencies [384bb7b]
- Updated dependencies [fc4ac58]
- Updated dependencies [a0fac02]
- Updated dependencies [ab0bc89]
- Updated dependencies [42d9fe8]
- Updated dependencies [2af790f]
- Updated dependencies [cc10e74]
- Updated dependencies [8654435]
- Updated dependencies [888d686]
- Updated dependencies [f6ba134]
- Updated dependencies [b77bb37]
- Updated dependencies [f1ddace]
- Updated dependencies [9993165]
- Updated dependencies [557973d]
- Updated dependencies [49653f9]
- Updated dependencies [6021b5e]
- Updated dependencies [7cd2ebf]
- Updated dependencies [4bcc4df]
- Updated dependencies [47af3dd]
- Updated dependencies [07586f5]
- Updated dependencies [fa44dd2]
- Updated dependencies [0c81694]
- Updated dependencies [4034f47]
- Updated dependencies [52f3f51]
- Updated dependencies [d727348]
- Updated dependencies [5e113b3]
- Updated dependencies [493a6c4]
- Updated dependencies [d65cbb6]
- Updated dependencies [f00e8d5]
- Updated dependencies [d1663ba]
- Updated dependencies [2163e80]
- Updated dependencies [b00fc55]
- Updated dependencies [dd5e355]
- Updated dependencies [e2a4b6a]
- Updated dependencies [3446d43]
- Updated dependencies [436d284]
- Updated dependencies [dc71845]
- Updated dependencies [6d9d3ef]
- Updated dependencies [be531f6]
- Updated dependencies [f0b33ee]
- Updated dependencies [9ca36b1]
- Updated dependencies [39a78b1]
- Updated dependencies [9a0af4e]
- Updated dependencies [c8cb510]
- Updated dependencies [1bbb7bf]
- Updated dependencies [e843b5b]
- Updated dependencies [0b76a1f]
- Updated dependencies [9494dd8]
- Updated dependencies [8061f33]
- Updated dependencies [617f27e]
- Updated dependencies [b029c90]
- Updated dependencies [495fa07]
- Updated dependencies [3b480e0]
- Updated dependencies [af13616]
- Updated dependencies [6ea429d]
- Updated dependencies [4548ba3]
- Updated dependencies [6a2866a]
- Updated dependencies [3a2d38c]
- Updated dependencies [17f8217]
- Updated dependencies [5e7cf63]
- Updated dependencies [6e47e16]
  - @objectstack/spec@18.2.0
  - @object-ui/types@18.2.0

## 18.1.0

### Minor Changes

- 0d12e95: An approver who is not an administrator sees the whole approval request page again: its fields, its decision panel with the decisions they may take, and its Timeline (objectui#13324).
  
  The console reads a request, and its timeline, through the approvals routes, which serve a request to each party to it. The record page then gated what it drew on the permissions answer for the data API, which names neither approval object for a member, because the platform keeps that door closed to them. So the page folded the request down to its id, drew no decision, and dropped the Timeline. Opening a request from the Approvals inbox showed a blank page.
  
  `@object-ui/permissions` adds `ServerReadScope`. Below it, the read verdicts for the objects it names (`check(object, 'read')` and `checkField(object, field, 'read')`) answer "allowed": whatever the server serves is what the viewer may read. Every other action, the field write and create verdicts, and every other object keep the enclosing provider's answer. The console mounts it for the two approval objects over every app. No read grant on either object is added: the data API stays closed to members.

### Patch Changes

- Updated dependencies [8556295]
- Updated dependencies [cd14d8e]
- Updated dependencies [f1a4b08]
- Updated dependencies [1d178e0]
- Updated dependencies [6fb31dc]
  - @object-ui/types@18.1.0

## 18.0.0

### Major Changes

- 6f3299f: objectui moves to major 18, following `@objectstack/*` from 17 to 18 (objectui#12334). objectui's major is not a count of its own breaking changes: it tracks the major of the `@objectstack/spec` its packages depend on, so that the same major means compatible across the two projects. These packages already declare `@objectstack/*` on the 18 line (objectui#12030), so every package in the fixed release group crosses to 18 together. It is the one `major` that rule admits: objectui's own breaking changes ship as `minor`, described in their entries.
  
  The 18 line is released from Changesets pre mode on the `next` tag (`.changeset/pre.json`), as `@objectstack/*` 18 is: these releases are `18.0.0-next.N` on the npm `next` dist-tag, and they do not move `latest`. The first `18.0.0` on `latest` comes when `@objectstack` 18 is generally available and this repository leaves pre mode.
  
  What a consumer must do to take it is in the `@objectstack/*` 18 entry of this release (objectui#12030): move its own `@objectstack/*` packages to the 18 line at the same time.

### Minor Changes

- c5406c2: Depend on the `@objectstack/*` 18 prerelease line (objectui#12030).
  
  Every `@objectstack/*` range these packages declare in `dependencies` or `peerDependencies` moves from `^17.x` to `^18.0.0-next.0`, the `next` prerelease of `@objectstack/*` 18 (raised to `^18.0.0-next.1` by objectui#12370 before release).
  
  **Breaking for consumers:** an install that resolves `@objectstack/spec` (or `@objectstack/client`, `@objectstack/formula`, `@objectstack/lint`) 17.x no longer satisfies these ranges. A consumer must move its own `@objectstack/*` packages to the 18 line, starting with `18.0.0-next.1` (objectui#12370), at the same time as it takes this release.
  
  **objectui's own surface moves with it:**
  
  - `element:record_picker`'s registration stops publishing the `object`, `filter`, `sort` and `limit` inputs, which spec 18 retires; a JSX page that writes one now gets `unknown-prop`.
  - The `CapabilityMultiSelectField` widget's curated capability set (`@object-ui/fields`) follows spec 18: `manage_mailboxes` in, `manage_org_presentation` out.
  - `element:number` and `element:repeater` nodes that bind no object are accepted, as spec 18's row and `PageComponentSchema` accept them; the two `ELEMENT_*_OBJECT_REQUIRED` refusals are gone.
  
  **Retired with the spec:** `@objectstack/spec` 18 tombstones `object-grid`'s `defaultFilters` and refuses it by name, and `ObjectGrid` and `ObjectView` stop reading it (`table.defaultFilters` on an `object-view` included). A view that still carries it renders unfiltered: rename the key to `filter`, whose value is the same rule array.
- 023f00d: A create form asks its fields the create question, so a role that may create
  records but not edit them can fill and submit the form (objectui#12082). Every
  console affordance that offers a write now reads the grant it exercises from
  one map.
  
  **The defect.** A create form gated each field on `checkField(object, field,
  'write')`, whose fallback for a field the permission set does not mention is
  the object's `allowEdit`. Under a grant of `allowCreate: true, allowEdit: false`
  every field of the create form rendered disabled, the outbound filter stripped
  every field from the body, and the save posted an empty record that the server
  refused for its required fields — while the server accepts the same create.
  
  **The server's insert rule, which the create question follows.** The server's
  field-level write step refuses a write that names a field whose explicit
  field-level entry has `editable: false`; a field with no entry passes it, and
  object admission decides the operation (`allowCreate` for an insert,
  `allowEdit` for an update). So a create-form field now reads its explicit entry
  when there is one and the object's create grant when there is none. A field the
  permission set marks `editable: false` stays disabled and out of the body.
  
  **Clause-②: yes (widening)**
  
  - `@object-ui/core` exports the affordance-to-grant map: `AFFORDANCE_GRANTS`
    (one row per affordance: the CRUD-affordance bit it needs, the object grant it
    exercises and, for an affordance that offers fields, the field question it
    asks), `resolveAffordance` (managed-object policy ∧ the server's effective API
    operation set ∧ the caller's grant, with the row's `userActions` predicates
    surfaced only when all three allow it), `resolveFieldAffordance`,
    `formFieldsAffordance`, and their types (`ConsoleAffordance`,
    `FieldAffordance`, `AffordanceGrant`, `FieldAffordanceGrant`,
    `AffordanceGrantRow`, `AffordanceGrantPrincipal`, `FieldAffordancePrincipal`,
    `AffordanceSource`, `AffordanceVerdict`).
  - `@object-ui/permissions`: `checkField`'s action accepts `'create'` beside
    `'read'` and `'write'`. `MePermissionsProvider` answers it from the explicit
    field entry when there is one and from `allowCreate` otherwise; the
    role-based `PermissionProvider` answers it as it answers `'write'`.
  
  **Behaviour, by package.** With no permission provider mounted every grant
  still reads open, as before.
  
  - `@object-ui/plugin-form`: every `ObjectForm` layout's fields and outbound
    filter ask the question of the form's mode (create or edit). The form-wide
    lock, with its "You don't have permission to …" notice, also engages when the
    caller's object grant for the form's mode is denied, not only when the
    managed-object policy or the effective API operation set closes it. A
    create-mode `MasterDetailForm`'s line cells ask the create question of the
    child object, since every line there is a new record.
  - `@object-ui/app-shell`: the record page's Edit and Delete (and the record
    body's in-place editing) read the caller's update / delete grant; they read
    none before. The import wizard's write targets ask the create question, so a
    caller offered Import keeps every field the insert accepts. List New / Import,
    the related lists and the Attachments panel read the map with the verdicts
    they had.
  - `@object-ui/fields`: a lookup's "Create new" reads the create grant (and the
    managed-object policy and operation set) of the object the field references;
    it read no grant before.
  - `@object-ui/plugin-grid`: row Edit / Delete, in-place editing, the template
    download and the add-record row read the map; the add-record row now also
    honours the object's managed-object policy and effective `create` operation.
  - `@object-ui/plugin-detail`: `record:details` in-place editing reads the
    caller's update grant; the detail header's object gate adds the effective
    operation set.
  - `@object-ui/plugin-list` and `@object-ui/console`: bulk Delete, the
    inline-edit toggle and the profile page's language field read the map with
    the verdicts they had.
- 5f75cfa: In-place edit on the record page and a list's in-cell edit honour the caller's field write grant, and the owner field honours the transfer grant (objectui#12103).
  
  **What a caller saw.** A caller whose permission set marks a field `{ readable: true, editable: false }` was offered an editor for it in the record page's details body, in its highlights strip and in a list's grid cells, and Save answered 403 ("Field write denied"). The owner field was offered the same way to a caller without the transfer grant, and Save answered 403 ("requires the transfer grant"). Edit forms already refused both fields through `fieldWriteGate`.
  
  **What changed.**
  
  - **The map (`@object-ui/core`).** The `recordEdit` and `listInlineEdit` rows of `AFFORDANCE_GRANTS` gain `field: 'write'`, so the record page's in-place edit and a list's in-cell edit each ask every field the same update question an edit form asks, through `resolveFieldAffordance`. `FieldAffordance` therefore includes both rows.
  - **The details body and the highlights strip (`@object-ui/plugin-detail`).** `DetailSection` and `HeaderHighlight` ask that question of each field. A refused field shows no pencil, does not enter the edit session on double-click, and stays a read display in edit mode. The strip and the body share one session and one Save, so they answer alike.
  - **The grid (`@object-ui/plugin-grid`).** `ObjectGrid` marks a refused field's column not editable, so its cell keeps the read display while the rest of the row edits. Whether the grid is editable at all is still the object-level `listInlineEdit` verdict.
  - **The owner field (`@object-ui/permissions`).** The server refuses an update that writes the record's owner (the field the `@objectstack/spec` constant `SystemFieldName` names `OWNER_ID`) unless the caller holds `allowTransfer` or `modifyAllRecords`. `MePermissionsProvider`'s `checkField(object, owner, 'write')` now answers with that grant, read with the spec's `objectPermissionGrants`. The `write` question is the server's update rule for a field, so every surface that asks it (edit forms, in-place edit, in-cell edit) offers the owner field only to a caller who may transfer the record. `checkField(object, owner, 'create')` is unchanged, because on insert the server stamps an empty owner to the caller and accepts the caller's own id. `MePermissionsResponse` declares the `allowTransfer` bit the endpoint already serves, and `@object-ui/permissions` now depends on `@objectstack/spec` directly.
  
  **Unchanged.** With no permission provider mounted no field question is asked, so a standalone embed and the designer preview behave as before. The server still enforces every grant; this only stops the console from offering a write it would refuse.
  
  **Clause-②: yes (widening).** `AFFORDANCE_GRANTS.recordEdit` and `AFFORDANCE_GRANTS.listInlineEdit` gain a `field: 'write'` member, which widens the `FieldAffordance` type by those two rows. `MePermissionsResponse`'s object entry declares an optional `allowTransfer?: boolean`. `checkField`'s action union is unchanged; its `write` answer narrows for the owner field only. No export, prop or language-pack key is added or removed.
- ff9df88: Depend on `@objectstack/*` `18.0.0-next.1` (objectui#12370).
  
  Every `@objectstack/*` range these packages declare moves from `^18.0.0-next.0` to `^18.0.0-next.1`; the console and the runner bundle `18.0.0-next.1`. A consumer moves its own `@objectstack/*` packages to `18.0.0-next.1` with this release.
  
  **Accept sets that narrow with it.** `@object-ui/types` validates page action rows and view data bindings through the spec's own rows, so its faces (`safeValidateSchema` and `StrictAnyComponentSchema`) now refuse what `18.0.0-next.1` refuses. Each was accepted on `18.0.0-next.0`:
  
  - `onSuccess` on an `action:button` / `action:icon` row, or an `action:group` / `action:menu` member, whose executor is the `url`, `navigation`, `modal`, `flow` or `form` built-in, or that has no executor at all. Write the hop on an `api` or `script` action (or a host handler name), or drop it.
  - `onSuccess` beside `operation: 'update'`, and an `onSuccess` block carrying a key outside `{ navigate, openIn }`.
  - `actionType: 'navigation'` on a row (and `type: 'navigation'` on a container member): write `'url'`.
  - A `url` executor's `target` that is not openable, judged on the executor the runner runs, including a row whose `name` selects it.
  - A view `data` binding with `provider: 'api'`: bind the object or static rows; an API call is the page element's binding.

### Patch Changes

- Updated dependencies [18d7b48]
- Updated dependencies [172acc3]
- Updated dependencies [f0496bd]
- Updated dependencies [c4c506b]
- Updated dependencies [9db9ff3]
- Updated dependencies [b10c68e]
- Updated dependencies [bdc9049]
- Updated dependencies [2e818d0]
- Updated dependencies [8b14aec]
- Updated dependencies [2abec3a]
- Updated dependencies [9dfaca6]
- Updated dependencies [96fcf30]
- Updated dependencies [89cc738]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [c0862c1]
- Updated dependencies [4c0de52]
- Updated dependencies [a80fef7]
- Updated dependencies [f34e877]
- Updated dependencies [aaba865]
- Updated dependencies [45d5853]
- Updated dependencies [2312bd9]
- Updated dependencies [c5406c2]
- Updated dependencies [2a48bd4]
- Updated dependencies [c7b30bd]
- Updated dependencies [69bca0a]
- Updated dependencies [c0c2f79]
- Updated dependencies [0665c3b]
- Updated dependencies [d2500d8]
- Updated dependencies [b231607]
- Updated dependencies [466a219]
- Updated dependencies [6fb281d]
- Updated dependencies [c08c933]
- Updated dependencies [c4dd707]
- Updated dependencies [923504f]
- Updated dependencies [10aba37]
- Updated dependencies [5d3f437]
- Updated dependencies [7af0ab3]
- Updated dependencies [fd4872f]
- Updated dependencies [f0532d8]
- Updated dependencies [3092aca]
- Updated dependencies [82e5f53]
- Updated dependencies [d81e460]
- Updated dependencies [8106db1]
- Updated dependencies [093d55b]
- Updated dependencies [a8051d6]
- Updated dependencies [524136e]
- Updated dependencies [6f3299f]
- Updated dependencies [f2b17c6]
- Updated dependencies [52d6194]
- Updated dependencies [23bf859]
- Updated dependencies [1c72d77]
- Updated dependencies [2b4d3f1]
- Updated dependencies [d75f212]
- Updated dependencies [ff9df88]
- Updated dependencies [a2225f9]
- Updated dependencies [21f9577]
- Updated dependencies [3eb3ec1]
- Updated dependencies [619e3f7]
- Updated dependencies [f62b6ff]
- Updated dependencies [d66d7e8]
- Updated dependencies [15d8ca6]
- Updated dependencies [378896d]
- Updated dependencies [4839f5c]
- Updated dependencies [c999d4c]
- Updated dependencies [26323c4]
- Updated dependencies [c219165]
- Updated dependencies [30083da]
- Updated dependencies [8aa8e3e]
- Updated dependencies [a928aaa]
- Updated dependencies [1b94d50]
- Updated dependencies [fb85637]
- Updated dependencies [df71568]
- Updated dependencies [cbac9d7]
- Updated dependencies [daeb77f]
- Updated dependencies [eb4552e]
- Updated dependencies [55e90fd]
- Updated dependencies [9b75509]
- Updated dependencies [b13ea3c]
- Updated dependencies [d7e9e9a]
- Updated dependencies [cf62edf]
- Updated dependencies [0253416]
- Updated dependencies [5d77c09]
- Updated dependencies [3fd8625]
- Updated dependencies [1473757]
- Updated dependencies [d73d987]
- Updated dependencies [12ff256]
- Updated dependencies [26b0bd2]
- Updated dependencies [d328698]
- Updated dependencies [b4e0787]
- Updated dependencies [088e0f7]
- Updated dependencies [b403bb3]
  - @object-ui/types@18.0.0

## 17.7.0

### Minor Changes

- 9cebfca: feat: an action's `visible` / `disabled` predicate can ask `current_user.can(object, verb)` — the caller's object permissions, from the payload the built-in Edit / Delete buttons are already gated by
  
  A custom action that replaces a built-in CRUD button — a logical delete that archives
  instead of deleting, say — can now carry the same gate the built-in button had:
  
  ```yaml
  visible: current_user.can('account', 'delete')
  ```
  
  It answers from the signed-in user's `/auth/me/permissions` payload once that payload
  has loaded, on the record header and the row menu alike. Until then it gives no answer:
  the predicate faults, and a surface that evaluates `visible` fail-closed does not render
  the action. The `user` / `ctx.user` / `os.user` aliases are the same call.
  
  This is client-side UI gating only. It decides whether the button is shown; the server
  still enforces object permissions on the request the action sends and answers 403 when
  they are not held.
  
  - `@object-ui/permissions`: the permission context carries `effectiveObjects`, the
    response's `objects` map verbatim (`undefined` when the provider holds no such
    response — the role-based `PermissionProvider`, or no provider at all).
  - `@object-ui/core`: `evalFieldPredicate` hands the acting subject's permissions to the
    CEL engine as `EvalContext.permissions`; `bindSubjectPermissions` /
    `subjectPermissionsOf` are the carrier. `@objectstack/formula` is now required at
    `^17.5.0`, the first release that answers `can`.
  - `@object-ui/app-shell`: `ExpressionProvider` binds the map into the predicate scope it
    publishes only while `usePermissions().isLoaded` is true, and the record-form field
    evaluators take the same input, so one predicate answers the same everywhere.
- 8cd8eb5: **BREAKING — removes a published export from two packages.** Retire the
  `PermissionGuardConfig` type (objectui#8024, ADR-0049 enforce-or-remove). The
  name is deleted from `@object-ui/types`, which declared it, and from
  `@object-ui/permissions`, which re-exported it — after this release
  `import type { PermissionGuardConfig }` from either package is a compile error,
  not a deprecation warning.
  
  The shape the shipped guard reads is **`PermissionGuardProps`**, exported from
  `@object-ui/permissions` beside the `PermissionGuard` component. It was never
  `PermissionGuardConfig`: the component did not accept the retired type, and the
  two disagreed on the key names — `action` there, `permission` here;
  `fallbackContent` (a React node) there, `fallbackComponent` (a type-name string)
  here; `object` required there, optional here.
  
  **`fallback: 'redirect'` and `redirectPath` never existed as a capability.** They
  were declared on the retired type and honoured nowhere: `'redirect'` was never a
  member of the `fallback` union `PermissionGuard` switches on, and no code ever
  read `redirectPath`. No guard in these packages redirects a denied user, so
  removing the two keys takes away no behaviour.
  
  Measured before anything was deleted: the type was a declaration plus the two
  barrel re-exports and nothing else — nothing in this repository, the example
  apps or the `objectstack` sibling checkout constructed, accepted, annotated or
  read one, and `@objectstack/spec` declares no guard-config shape for it to
  mirror. Removed outright rather than kept as a `?: never` tombstone, on the
  retire-vs-remove discriminator `@object-ui/types` states on `ChatbotSchema` —
  cited here, not restated: a whole exported type name has no surviving member to
  carry a tombstone. The module has no Zod twin, so the compiler was the only
  channel this name ever had, and the refusal now lives there.
  
  ## Upgrading
  
  **No runtime behaviour changes.** A value typed against `PermissionGuardConfig`
  was never passed to anything that read it.
  
  - **You imported the type only** (the only thing that was possible): delete the
    import, and drop the annotation from any local object that carried it.
  - **You guard UI by permission:** use `PermissionGuard` with
    `PermissionGuardProps` — `object`, `action`, and optionally
    `fallback: 'hide' | 'disable' | 'custom'` with `fallbackContent`.
  - **You declared `fallback: 'redirect'` or a `redirectPath`:** nothing ever acted
    on either. If a denied user must be sent elsewhere, do it in your own routing
    code; no guard in these packages performs a redirect.
- 3c9fca3: Create forms pre-fill the `current_user` defaultValue token with the acting user (#5683). `PermissionContextValue` gains `userId` (from `/me/permissions`; `null` = unknown), and the create-form seeding resolves `defaultValue: 'current_user'` on `user` / `lookup→sys_user` fields to that id — the same value the engine stamps at insert, so the pre-fill is a preview of the server's own resolution, not a second default contract. Unknown user (no provider / anonymous / role-based provider) seeds nothing and keeps the omit-and-let-the-engine-resolve behavior. `NOW()` and CEL defaults stay server-owned.
- 2609812: `evaluateCondition` now **denies** a record when a row-level condition names something that is not the record's own data. It used to **admit** it — silently, on a permission boundary.
  
  The guard it replaces refused three field names by list (`__proto__`, `constructor`, `prototype`) and read every other name with `hasOwnProperty`. `hasOwnProperty` collapses *inherited* into *absent*, and on a negative operator absent ADMITS, so every prototype member outside those three spellings passed every record through the rule that existed to hide it. Measured against the record `{ id: 1, tenant: 'acme' }`: `{ field: 'toString', operator: 'neq' }` returned `true`, as did `valueOf`, `hasOwnProperty` and `isPrototypeOf`, on both `neq` and `not_in`. A longer list does not close this — a list enumerates spellings, and `Object.prototype` has more of them than any list will hold.
  
  **The second reach path needs no crafted condition.** The same read widened for records whose value is *inherited*: on `Object.create({ tenant: 'acme' })`, `{ field: 'tenant', operator: 'neq', value: 'acme' }` returned `true` — the record's tenant *is* `acme`, and the rule that hides `acme` rows admitted it. A class instance with a prototype accessor is enough to reach it.
  
  **The field a condition names is now read in three cases instead of two.** A name in the refused list denies. An own member is read as before, including a record whose own key happens to be spelled `toString`. A name that is not an own member but still resolves on the record's prototype chain denies, because the value exists but is not this record's data. A name that resolves nowhere is a genuinely absent field and still reads as `undefined`, so the ordinary "this record has no `status`" rules keep every verdict they have always had.
  
  That last case is load-bearing rather than a detail: refusing *every* non-own read would deny records this evaluator should admit, which on a permission boundary is a worse defect than the fail-open being closed.
  
  This is the shape `readField` in `@object-ui/core`'s `DataScopeManager` adopted at objectui#7751, ported back to the evaluator that was #7751's reference — and which, it turned out, carried the defect it was being used as the standard for. The two evaluators now give the same answer for a prototype-named field and for an inherited value; operator SPELLING (`neq` / `not_in` here, `ne` / `nin` there) is untouched and remains objectui#7750's question.
  
  **The narrowing, named plainly for anyone upgrading with conditions already stored.** A condition loses records in exactly two shapes: one that names a prototype member (`toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf`, …), and one that reads a field records inherit from a shared prototype rather than own — for the second, the fix is to give the record the field as its own data. Measured over a 3696-case differential matrix of field names, record shapes, operators and values, replaying every case through both the previous release's read and this one: **234 verdicts narrowed, zero widened**, and zero change across the 924 genuinely-absent-field cases.
  
  Graded `minor` because a release reader can observe the narrowing on stored conditions; no declared type changed and the set of inputs the evaluator accepts has not widened.

### Patch Changes

- 45ac2cb: `usePermissions()` now returns an identity React cannot discard (objectui#6724).
  
  The hook cached its return in a `useMemo` keyed on `[ctx]`, and both branches build a
  fresh object — an object literal when no provider is mounted, a spread of `ctx` when one
  is. `useMemo` carries no semantic guarantee: React may throw the cache away and recompute
  even when `[ctx]` compares equal, and that hands the caller a new identity while every
  permission it carries is unchanged.
  
  That matters because consumers name this value in dependency arrays — 13 arrays across 6
  files: `ListView`'s data-fetch effect (`perms`), `DetailView`'s `gatedSchema`,
  `ObjectForm`, `ModalForm`, `ObjectGrid`, `RelatedList`. A discard alone re-ran the fetch
  effect and re-issued `dataSource.find` with nothing an author or a caller controls having
  changed. Same family as objectui#6018 / #5976 / #6591 / #6592 / #6697.
  
  The by-identity dependency at the consumers is the correct shape and stays: what they read
  off this object is the verdict FUNCTIONS (`checkField(object, field, 'read')`,
  `can(object, 'update')`) over an open set of field names, which flatten to no fixed list of
  primitives the way objectui#6592's `dataConfig` members did. So the fix is at the hook,
  where the identity can be made trustworthy:
  
  - the decoration becomes a plain function of `ctx` — the same context value always yields
    the same object, because the mapping lives in a module-level `WeakMap` React has no say
    over, keyed weakly so it dies with the provider's value. That is strictly stronger than
    the memo it replaces: the identity is now stable across every component reading the same
    provider, not just across one component's re-renders. It also costs no hook, so there is
    no render-phase ref write and no state adjustment to reason about.
  - the no-provider answer becomes one shared frozen module constant. Every member is a pure
    constant function, so there was never anything per-instance to keep, and a single frozen
    object cannot churn in any component for any reason.
  
  A new context value still produces a new identity, on purpose: that is a real permission
  change and every consumer must see it.
  
  No permission value moves: the returned object still spreads `ctx` by identity and derives
  `can`/`cannot` from `ctx.check`, and the documented no-provider fallbacks (`isLoaded:
  false`, `userId: null`, `systemPermissions: undefined` with `hasCapabilities` fail-open —
  objectui#5683 / #4656) answer exactly as before.
  
  Measured while fixing, and worth recording: on React 19.2.8 this repo has no reproduction —
  51 re-renders with no provider, 51 with one and 42 under `StrictMode` each returned ONE
  identity, and there is no `Activity`/Offscreen subtree here. This closes a latent hazard,
  not an observed re-fetch. The providers' own context-value memos are the remaining link in
  the same chain (objectui#6813).
- 4dc80d0: `MePermissionsProvider` no longer keys its permissions-fetch effect on a memoised
  driver's identity. The driver was a `useCallback` over
  `[endpoint, fetcher, maxRetries, retryBaseDelayMs]` and the effect named that
  callback as its dependency; React is permitted to discard a `useCallback` cache
  and rebuild even when the dependency list compares equal, and the rebuilt
  function is a new identity, so a discard tore the effect down and re-ran it —
  costing a redundant `/api/v1/auth/me/permissions` round trip with none of the
  four inputs changed. The driver is now a module-level function and the effect
  keys on the four values directly. The trigger set is unchanged, so every
  legitimate refetch (a new endpoint, a swapped fetcher, either retry knob) still
  happens exactly once.
- 30266cf: Both permission providers now build their context value where React cannot discard it
  
  `PermissionProvider` built its context value in a `useMemo` over four
  `useCallback`s, and `MePermissionsProvider` in a `useMemo` over six. Neither
  carries a semantic guarantee: React is permitted to discard the cache and
  recompute even when the dependency list compares equal, and every one of those
  factories builds a fresh object. A discard would therefore hand
  `PermCtx.Provider` a NEW context value with every permission it carries
  unchanged — which moves the key `usePermissions()` caches on, and re-runs the
  consumer chain that names it: `ListView`'s data-fetch effect (an extra
  `dataSource.find`), `DetailView`'s gatedSchema, `ObjectForm`, `ModalForm`,
  `ObjectGrid` and `RelatedList`.
  
  ⚠️ This is **hardening, not a repair**. Nothing misbehaves today: on this
  repo's pinned React 19.2.8 the cache is not discarded spontaneously — 51
  re-renders with no provider, 51 with one and 42 under `StrictMode` each
  returned one identity — and there is no `Activity`/Offscreen subtree here,
  which is the documented case where React does throw memo caches away. What is
  removed is the dependency on React continuing not to exercise a licence it
  holds.
  
  Each cached member and each context value is now keyed on the identities of the
  inputs it is derived from, in a module-level `WeakMap` React has no say over —
  the same technique that made `usePermissions()`'s own return discard-proof one
  link down the chain. The dependency sets are unchanged, so nothing churns more
  often than it did, and a genuine permission change still publishes a new
  context value to every consumer. Two providers given the same inputs now share
  one context value, which is stricter than the per-instance memo it replaces.
  
  No published export changes, and the context carries exactly what it carried
  before.
- Updated dependencies [b46c58f]
- Updated dependencies [6f96fca]
- Updated dependencies [5f00ff4]
- Updated dependencies [c9e073a]
- Updated dependencies [7b395d8]
- Updated dependencies [0879812]
- Updated dependencies [2dd4d3f]
- Updated dependencies [e3ea4f9]
- Updated dependencies [8b1f066]
- Updated dependencies [af243c1]
- Updated dependencies [f3f4e4c]
- Updated dependencies [a05c350]
- Updated dependencies [8c10f4f]
- Updated dependencies [90dac98]
- Updated dependencies [6096f20]
- Updated dependencies [ea02938]
- Updated dependencies [a14fb23]
- Updated dependencies [ae98f1d]
- Updated dependencies [f98eddf]
- Updated dependencies [ce6bd99]
- Updated dependencies [a5b08c9]
- Updated dependencies [9b28151]
- Updated dependencies [1a5003f]
- Updated dependencies [d22b37b]
- Updated dependencies [1daf477]
- Updated dependencies [fb13e85]
- Updated dependencies [c2d8659]
- Updated dependencies [e0f8202]
- Updated dependencies [c3a26cc]
- Updated dependencies [a66e58e]
- Updated dependencies [d89492c]
- Updated dependencies [9327397]
- Updated dependencies [17cc3a3]
- Updated dependencies [9c78ebe]
- Updated dependencies [12809a5]
- Updated dependencies [f9c06ef]
- Updated dependencies [5ad3b88]
- Updated dependencies [f9d772b]
- Updated dependencies [97b6c21]
- Updated dependencies [29b45f6]
- Updated dependencies [b956e69]
- Updated dependencies [fec3b1a]
- Updated dependencies [b8e0941]
- Updated dependencies [0c50f18]
- Updated dependencies [1dae95a]
- Updated dependencies [e32dae1]
- Updated dependencies [4aebea0]
- Updated dependencies [f976774]
- Updated dependencies [25cb364]
- Updated dependencies [c6678b1]
- Updated dependencies [0638322]
- Updated dependencies [e3782d2]
- Updated dependencies [db0beb2]
- Updated dependencies [997ce38]
- Updated dependencies [ae0b9d3]
- Updated dependencies [3b469c8]
- Updated dependencies [6650259]
- Updated dependencies [4f8b7f8]
- Updated dependencies [f6ae5e2]
- Updated dependencies [7343376]
- Updated dependencies [b2683a2]
- Updated dependencies [dded788]
- Updated dependencies [b45d463]
- Updated dependencies [54a7830]
- Updated dependencies [f3135a4]
- Updated dependencies [b5696d3]
- Updated dependencies [3f9d926]
- Updated dependencies [e978ed5]
- Updated dependencies [6a7f24e]
- Updated dependencies [b3c96d6]
- Updated dependencies [8d0ca91]
- Updated dependencies [c30c8dd]
- Updated dependencies [24d3e65]
- Updated dependencies [95a7c8d]
- Updated dependencies [cc4e476]
- Updated dependencies [92970c4]
- Updated dependencies [d570eaa]
- Updated dependencies [42687ba]
- Updated dependencies [24a0f14]
- Updated dependencies [797a30f]
- Updated dependencies [b4075c0]
- Updated dependencies [9b85600]
- Updated dependencies [99878d8]
- Updated dependencies [3c13675]
- Updated dependencies [0eb9f36]
- Updated dependencies [ae582b7]
- Updated dependencies [db11afd]
- Updated dependencies [154075a]
- Updated dependencies [582edef]
- Updated dependencies [19f484f]
- Updated dependencies [0a78a20]
- Updated dependencies [615346d]
- Updated dependencies [75dcc81]
- Updated dependencies [55a12a8]
- Updated dependencies [edfcf5a]
- Updated dependencies [0a3e540]
- Updated dependencies [f61dab1]
- Updated dependencies [b0a05dd]
- Updated dependencies [dd5ff19]
- Updated dependencies [81f8498]
- Updated dependencies [c27b575]
- Updated dependencies [0e6e76b]
- Updated dependencies [cd5b19a]
- Updated dependencies [17dc167]
- Updated dependencies [20d23be]
- Updated dependencies [20d23be]
- Updated dependencies [e6bc087]
- Updated dependencies [a7557a7]
- Updated dependencies [7d074ba]
- Updated dependencies [6158e4c]
- Updated dependencies [6158e4c]
- Updated dependencies [52aad5c]
- Updated dependencies [58da8ae]
- Updated dependencies [138ad45]
- Updated dependencies [5262f7d]
- Updated dependencies [6aa029b]
- Updated dependencies [770cc5b]
- Updated dependencies [1a88ce2]
- Updated dependencies [a1a44d6]
- Updated dependencies [e0a9c67]
- Updated dependencies [5638529]
- Updated dependencies [c476be0]
- Updated dependencies [c82ff39]
- Updated dependencies [6c3da53]
- Updated dependencies [31987bd]
- Updated dependencies [3c3ce15]
- Updated dependencies [e100589]
- Updated dependencies [304f611]
- Updated dependencies [e46ee77]
- Updated dependencies [6e9c8d2]
- Updated dependencies [9547063]
- Updated dependencies [3f6efd6]
- Updated dependencies [c4ab6d0]
- Updated dependencies [0e9058b]
- Updated dependencies [5988b6b]
- Updated dependencies [00ccdf7]
- Updated dependencies [9d9ed54]
- Updated dependencies [ca3de72]
- Updated dependencies [83e3f83]
- Updated dependencies [401611b]
- Updated dependencies [2c0ddf2]
- Updated dependencies [4abc0aa]
- Updated dependencies [2b188fa]
- Updated dependencies [f68e0a0]
- Updated dependencies [aea682a]
- Updated dependencies [fcdc8ec]
- Updated dependencies [2d576e4]
- Updated dependencies [8366acc]
- Updated dependencies [95e58a3]
- Updated dependencies [9d7419b]
- Updated dependencies [fc7db05]
- Updated dependencies [9ed8d0f]
- Updated dependencies [c73cdb5]
- Updated dependencies [6f5719e]
- Updated dependencies [06a8af5]
- Updated dependencies [6a91586]
- Updated dependencies [a04d7c6]
- Updated dependencies [f3c2bb0]
- Updated dependencies [460575f]
- Updated dependencies [d88e20f]
- Updated dependencies [2d7304d]
- Updated dependencies [636b236]
- Updated dependencies [d6d8fb9]
- Updated dependencies [64d624d]
- Updated dependencies [95bad12]
- Updated dependencies [d2fb6ef]
- Updated dependencies [fda49e5]
- Updated dependencies [fc62bb4]
- Updated dependencies [41df893]
- Updated dependencies [0cba1b7]
- Updated dependencies [00f3eb5]
- Updated dependencies [1ec291c]
- Updated dependencies [453dbaa]
- Updated dependencies [69a2163]
- Updated dependencies [24e027e]
- Updated dependencies [2c3cd1b]
- Updated dependencies [90665e0]
- Updated dependencies [7e19d03]
- Updated dependencies [1e946c9]
- Updated dependencies [864154e]
- Updated dependencies [b023625]
- Updated dependencies [75bd83d]
- Updated dependencies [40c479a]
- Updated dependencies [971d387]
- Updated dependencies [ee851c3]
- Updated dependencies [6414dfd]
- Updated dependencies [a8d5c71]
- Updated dependencies [905b21f]
- Updated dependencies [88e9109]
- Updated dependencies [2c45966]
- Updated dependencies [db3a600]
- Updated dependencies [3a3db76]
- Updated dependencies [0d723a3]
- Updated dependencies [0c95d3d]
- Updated dependencies [3e4fa2c]
- Updated dependencies [b5b928a]
- Updated dependencies [52a43de]
- Updated dependencies [195052f]
- Updated dependencies [e4559d1]
- Updated dependencies [2c71482]
- Updated dependencies [5ef9c4f]
- Updated dependencies [46f0bb4]
- Updated dependencies [6f81384]
- Updated dependencies [8f1d995]
- Updated dependencies [dddb942]
- Updated dependencies [29754cf]
- Updated dependencies [b84dc18]
- Updated dependencies [ac8abb0]
- Updated dependencies [9d86e1d]
- Updated dependencies [3a5817f]
- Updated dependencies [99a3c2d]
- Updated dependencies [c8ea8af]
- Updated dependencies [3190414]
- Updated dependencies [4e480f5]
- Updated dependencies [38a123c]
- Updated dependencies [d7acad6]
- Updated dependencies [45a9aeb]
- Updated dependencies [713db46]
- Updated dependencies [bf3a03c]
- Updated dependencies [cb55718]
- Updated dependencies [29cb85b]
- Updated dependencies [3e028c8]
- Updated dependencies [ce503e5]
- Updated dependencies [f20dcf0]
- Updated dependencies [4ca30d0]
- Updated dependencies [7a5da14]
- Updated dependencies [2c1c967]
- Updated dependencies [d6ceb8d]
- Updated dependencies [2acd8e1]
- Updated dependencies [adb2a86]
- Updated dependencies [3561bd2]
- Updated dependencies [bf97b98]
- Updated dependencies [b0d308d]
- Updated dependencies [40f34b4]
- Updated dependencies [8063bcb]
- Updated dependencies [b74a859]
- Updated dependencies [d4493fd]
- Updated dependencies [240b80f]
- Updated dependencies [77cb489]
- Updated dependencies [bfaa158]
- Updated dependencies [777e5c6]
- Updated dependencies [0c386dd]
- Updated dependencies [9e37d9b]
- Updated dependencies [5ad86dd]
- Updated dependencies [16a725f]
- Updated dependencies [4dfdcc3]
- Updated dependencies [446d93d]
- Updated dependencies [ecd9cb2]
- Updated dependencies [98d4108]
- Updated dependencies [0e3b3be]
- Updated dependencies [a29ae2d]
- Updated dependencies [4388f71]
- Updated dependencies [0b1ac58]
- Updated dependencies [c93b4d5]
- Updated dependencies [c1fe272]
- Updated dependencies [8ad218d]
- Updated dependencies [3e41187]
- Updated dependencies [5f78953]
- Updated dependencies [639114c]
- Updated dependencies [1f31d3a]
- Updated dependencies [351eb31]
- Updated dependencies [20c04b2]
- Updated dependencies [b652514]
- Updated dependencies [adbda1b]
- Updated dependencies [e2b3826]
- Updated dependencies [2e32ed4]
- Updated dependencies [1bee5d0]
- Updated dependencies [858cd72]
- Updated dependencies [554f2b6]
- Updated dependencies [669d71b]
- Updated dependencies [ed27d7c]
- Updated dependencies [52c8cf7]
- Updated dependencies [2ceb43a]
- Updated dependencies [7cdd2b9]
- Updated dependencies [52c8cf7]
- Updated dependencies [caa0cd3]
- Updated dependencies [25c7d58]
- Updated dependencies [c6198c2]
- Updated dependencies [51eb515]
- Updated dependencies [c354ce5]
- Updated dependencies [8fe8e5c]
- Updated dependencies [feac439]
- Updated dependencies [efbd566]
- Updated dependencies [9587fc9]
- Updated dependencies [e62c44e]
- Updated dependencies [5d0876c]
- Updated dependencies [544ecba]
- Updated dependencies [bc640ec]
- Updated dependencies [3e377c9]
- Updated dependencies [a3eb5d0]
- Updated dependencies [4ce14f1]
- Updated dependencies [2af1fa7]
- Updated dependencies [a137d0c]
- Updated dependencies [caf477f]
- Updated dependencies [f6375da]
- Updated dependencies [967e5d8]
- Updated dependencies [a4611b3]
- Updated dependencies [20316ba]
- Updated dependencies [d3499b3]
- Updated dependencies [309c75e]
- Updated dependencies [c9f9bae]
- Updated dependencies [18897a4]
- Updated dependencies [8b7ea39]
- Updated dependencies [dcbf0b2]
- Updated dependencies [1422a92]
- Updated dependencies [d05fe17]
- Updated dependencies [a480f79]
- Updated dependencies [f08d1a8]
- Updated dependencies [64a252d]
- Updated dependencies [786bc91]
- Updated dependencies [75fca96]
- Updated dependencies [7ca6ddd]
- Updated dependencies [f1cd290]
- Updated dependencies [5a41ce7]
- Updated dependencies [8d50bc2]
- Updated dependencies [604476d]
- Updated dependencies [335abea]
- Updated dependencies [0f5cadf]
- Updated dependencies [4f9f1ee]
- Updated dependencies [66e8b2a]
- Updated dependencies [aa083cd]
- Updated dependencies [12b5992]
- Updated dependencies [b93e245]
- Updated dependencies [c842594]
- Updated dependencies [290de37]
- Updated dependencies [8c8da45]
- Updated dependencies [8cd8eb5]
- Updated dependencies [cf1d29e]
- Updated dependencies [af9e957]
- Updated dependencies [c974edf]
- Updated dependencies [ad852b6]
- Updated dependencies [ee4d19f]
- Updated dependencies [496d31d]
- Updated dependencies [9a853f2]
- Updated dependencies [cb847fd]
- Updated dependencies [ee70287]
- Updated dependencies [3e98e13]
- Updated dependencies [4eaa835]
- Updated dependencies [b1777ae]
- Updated dependencies [24845c4]
- Updated dependencies [6f864cf]
- Updated dependencies [24d1edd]
- Updated dependencies [645087c]
- Updated dependencies [33f4a19]
- Updated dependencies [5323168]
- Updated dependencies [841dd2b]
- Updated dependencies [3014fc0]
- Updated dependencies [dacb402]
- Updated dependencies [474797d]
- Updated dependencies [704e695]
- Updated dependencies [a407bd6]
- Updated dependencies [3a43a15]
- Updated dependencies [421544b]
- Updated dependencies [fb01022]
- Updated dependencies [e9d9212]
- Updated dependencies [ecfb693]
- Updated dependencies [81a51db]
- Updated dependencies [67749c7]
- Updated dependencies [507b61b]
- Updated dependencies [512c84b]
- Updated dependencies [d4733f2]
- Updated dependencies [8b532cb]
- Updated dependencies [c42554e]
- Updated dependencies [555b4ec]
- Updated dependencies [1ccfc23]
- Updated dependencies [542718f]
- Updated dependencies [7f27bc5]
- Updated dependencies [f95b140]
- Updated dependencies [541ce4e]
- Updated dependencies [6479086]
- Updated dependencies [d79f525]
- Updated dependencies [f1190b0]
- Updated dependencies [6a4680b]
- Updated dependencies [c3a4273]
- Updated dependencies [093af32]
- Updated dependencies [1bd1be7]
- Updated dependencies [d234fa9]
- Updated dependencies [adf5812]
- Updated dependencies [5058336]
- Updated dependencies [2f6b2bf]
- Updated dependencies [2028b31]
- Updated dependencies [63601ab]
- Updated dependencies [8693b85]
- Updated dependencies [58b7b3d]
- Updated dependencies [681d3f1]
- Updated dependencies [f3bc481]
- Updated dependencies [93fc0e7]
- Updated dependencies [a4b723f]
- Updated dependencies [2b10ca0]
- Updated dependencies [7db4a81]
- Updated dependencies [526fc11]
- Updated dependencies [6732df4]
- Updated dependencies [fe9e0d0]
- Updated dependencies [63fb72c]
- Updated dependencies [279e48e]
- Updated dependencies [8700d6d]
- Updated dependencies [8db2a0f]
- Updated dependencies [30443fb]
- Updated dependencies [96919a4]
- Updated dependencies [2e471dc]
- Updated dependencies [be50942]
- Updated dependencies [775e079]
- Updated dependencies [7e8b3c0]
- Updated dependencies [53374dc]
- Updated dependencies [f6fb83f]
- Updated dependencies [2049b03]
- Updated dependencies [7cbc724]
- Updated dependencies [fb91ac9]
- Updated dependencies [8524372]
- Updated dependencies [7cbefa5]
- Updated dependencies [72d6587]
- Updated dependencies [a272a4f]
- Updated dependencies [55f39ee]
- Updated dependencies [0970a0e]
- Updated dependencies [e427e9c]
- Updated dependencies [bbc9dc3]
- Updated dependencies [02f1813]
- Updated dependencies [ac716ff]
- Updated dependencies [f0f3cd5]
- Updated dependencies [20f3e65]
- Updated dependencies [bbba098]
- Updated dependencies [87af769]
- Updated dependencies [3be720e]
- Updated dependencies [c3df43a]
- Updated dependencies [d16d0e9]
- Updated dependencies [bbe57fd]
- Updated dependencies [272a530]
- Updated dependencies [1779e8d]
- Updated dependencies [4128188]
- Updated dependencies [b253c4e]
- Updated dependencies [78a9c67]
- Updated dependencies [4a7ef0d]
- Updated dependencies [dea17b4]
- Updated dependencies [89bb77a]
- Updated dependencies [06611e4]
- Updated dependencies [dc3893d]
- Updated dependencies [1bbaa16]
- Updated dependencies [6ee259a]
- Updated dependencies [e708426]
- Updated dependencies [3b6d53b]
- Updated dependencies [a8198de]
- Updated dependencies [a78cd37]
- Updated dependencies [5ea623e]
- Updated dependencies [ca5d671]
- Updated dependencies [32bf2d6]
- Updated dependencies [af4fb29]
- Updated dependencies [9a97800]
- Updated dependencies [6bca0e4]
- Updated dependencies [2fcefb9]
- Updated dependencies [b55a346]
- Updated dependencies [065bba7]
- Updated dependencies [100547e]
- Updated dependencies [6d1c155]
- Updated dependencies [d7573b3]
- Updated dependencies [0e05aac]
- Updated dependencies [18a8e7d]
- Updated dependencies [e7957ab]
- Updated dependencies [f7e34ca]
- Updated dependencies [f9e4f91]
- Updated dependencies [6ef48b1]
- Updated dependencies [fa429cf]
- Updated dependencies [ed8df3e]
- Updated dependencies [8b446f5]
- Updated dependencies [7357447]
- Updated dependencies [199d31b]
- Updated dependencies [3e01cb5]
- Updated dependencies [4e8622b]
- Updated dependencies [dffd752]
- Updated dependencies [105f3c5]
- Updated dependencies [3ccd9e8]
- Updated dependencies [689b979]
- Updated dependencies [e546222]
- Updated dependencies [fd13f52]
- Updated dependencies [fb336df]
- Updated dependencies [0fce2ef]
- Updated dependencies [0e2ddd4]
- Updated dependencies [b7479ab]
- Updated dependencies [b2ea297]
- Updated dependencies [5b5a5c3]
- Updated dependencies [14582b8]
- Updated dependencies [51e144e]
- Updated dependencies [a691c0b]
- Updated dependencies [515f171]
- Updated dependencies [258d264]
- Updated dependencies [93127bd]
- Updated dependencies [51f3d8d]
- Updated dependencies [78cbdb5]
- Updated dependencies [b7543a9]
- Updated dependencies [ca39427]
- Updated dependencies [c9327c9]
- Updated dependencies [920165d]
- Updated dependencies [968dc1e]
- Updated dependencies [3c73d99]
- Updated dependencies [1170ed1]
- Updated dependencies [4d73b07]
  - @object-ui/types@17.7.0

## 17.6.0

### Patch Changes

- 5458414: Publish relative import specifiers with explicit `.js` extensions so these six packages load under plain Node ESM.
  
  Node's ESM resolver does not extension-search relative specifiers and `tsc` never rewrites them, so an extensionless `./Foo` in the source shipped as an extensionless `./Foo` in `dist` and importing the package entry outside a bundler failed with `ERR_MODULE_NOT_FOUND`. Bundled consumers were unaffected. Unbundled consumers — plain Node ESM, an SSR host importing the package directly, anyone running the published tarball without a build step — can now import these entries, and so can the downstream `@object-ui/plugin-*` packages that evaluate through `mobile`, `permissions` and `providers`.
- d8b9259: `MePermissionsProvider` distinguishes an unreported `systemPermissions` (a
  backend predating ADR-0066, which omits the field from `/me/permissions`
  entirely) from a genuinely empty one (a real answer: "this session holds zero
  system capabilities").
  
  Both used to collapse into the same `[]`, so `hasCapabilities` consumers could
  not gate strictly on a real empty answer without also stripping
  capability-gated UI from every user on a non-reporting deployment
  (objectstack#8270) — the only way around it was a per-call-site "empty ⇒
  treat as unreported" heuristic (`HomePage.tsx`'s `useCanAuthorMetadata`).
  
  `systemPermissions` on `PermissionContextValue` is now `string[] | undefined`
  (same shape `@object-ui/react`'s `useCapabilityGate` already uses for the
  ADR-0066 D4 action gate), and `hasCapabilities` itself fails OPEN when it is
  `undefined` and gates strictly on a reported empty array. The call-site
  heuristic in `HomePage.tsx` retires in favor of the centralized signal.
  
  Two more call sites that fed `systemPermissions` into the ADR-0066 D4 action
  gate (`RecordDetailView`'s `resolveActionUser`, and the shell-level
  `useConsoleActionRuntime`) used to default a loaded-but-`undefined` answer to
  `[]` before forwarding it, which silently re-collapsed the same distinction
  one layer down and gated every `requiredPermissions` action closed on a
  non-reporting deployment instead of open. Both now forward the value as-is.
- 61556dc: Permission reads no longer throw on a config that omits the required `roles`
  member. `ObjectPermissionConfig.roles` is declared required, but a config
  arriving from plain JS or from metadata loaded at runtime can omit it, and
  `objectConfig.roles[roleName]` then threw a `TypeError` out of `check()` and
  took the whole render down — the failure mode the evaluator's own note already
  forbids (`a permission check must never be able to crash a render`).
  
  `evaluatePermission` now treats a missing `roles` as granting nothing: no role
  resolves, and the call returns the ordinary `allowed: false` denial. The
  `publicAccess` channel is evaluated before this and is unchanged. The three
  matching reads in `PermissionProvider` (`checkField`, `getFieldPermissions`,
  `getRowFilter`) are guarded the same way and keep their own documented
  defaults — the guard removes the crash, not the semantics.
- Updated dependencies [88085e3]
- Updated dependencies [279fb13]
- Updated dependencies [1184192]
- Updated dependencies [a2a9747]
- Updated dependencies [af5e292]
- Updated dependencies [7f96b10]
- Updated dependencies [f1d4748]
- Updated dependencies [578e025]
- Updated dependencies [598c89a]
- Updated dependencies [b8b9af4]
- Updated dependencies [97abb24]
- Updated dependencies [deb157a]
- Updated dependencies [d2ce342]
- Updated dependencies [9695da7]
- Updated dependencies [58b8346]
- Updated dependencies [3cf4de0]
- Updated dependencies [c9dc811]
- Updated dependencies [a0b9e91]
- Updated dependencies [99bd015]
  - @object-ui/types@17.6.0

## 17.5.0

### Minor Changes

- 2a40f69: Retire two post-retirement dead surfaces (#4364, #4368). Both were measured at this
  branch point rather than taken from their cards, and one card's premise only half held.

  Breaking for anyone who typed against the removed declaration, marked `minor` per this
  repository's version-alignment convention (the major tracks `@objectstack`, never an
  API-break count):

  - `@object-ui/types` and `@object-ui/permissions` no longer export
    `ObjectLevelPermission`. It declared a second, parallel home for object-scoped grants
    (`{ object, actions, effect?, conditions? }`) that nothing constructed, accepted or
    read once `RoleDefinition.permissions` was retired (#4288) — its only remaining
    referents were its own definition and the two barrel lines. The wired home is
    `ObjectPermissionConfig.roles`, whose inner grant shape is declared inline; that is
    what the evaluator reads, and it is unchanged. `ObjectPermissionConfig`'s doc comment
    now records the retirement so the surface is not re-declared. (#4364)

  `PermissionCondition` was proposed for retirement on the same card and is **kept**: its
  premise ("only referent is `ObjectLevelPermission.conditions`") did not hold at this
  branch point. `evaluateCondition` in `@object-ui/permissions` takes it as a parameter
  type and implements all eleven of its operators under a 26-case suite. `PermissionEffect`
  is likewise untouched — `FieldLevelPermission.effect` still reads it.

  No behaviour change, no public surface change:

  - `@object-ui/console` drops `src/utils/metadataConverters.ts` and
    `src/services/MetadataService.ts`. Both were console-local duplicates of live
    `@object-ui/app-shell` modules and lost their last importer when the bespoke
    object-detail widgets were retired (#4365). Both had already drifted behind the live
    copies they duplicate — the console converter's `referenceTo` chain never read the
    server's `reference` key, and the console service predates the view cache-invalidation
    seam (#4373) — which is precisely the imitation trap the card recorded: an author
    grepping for "the converter" could land on the unexercised copy. The app-shell copies
    and their tests are untouched. (#4368)

### Patch Changes

- Updated dependencies [f650253]
- Updated dependencies [3d9769a]
- Updated dependencies [92876f0]
- Updated dependencies [d9d3463]
- Updated dependencies [2a40f69]
- Updated dependencies [bec3e14]
- Updated dependencies [1f9b905]
- Updated dependencies [abb0f81]
- Updated dependencies [38ab505]
- Updated dependencies [7e4f0e5]
- Updated dependencies [c1d939f]
- Updated dependencies [bb68488]
- Updated dependencies [ab04728]
  - @object-ui/types@17.5.0

## 17.4.0

### Patch Changes

- Updated dependencies [d229dfa]
- Updated dependencies [c2fd122]
- Updated dependencies [48132f7]
- Updated dependencies [7e5bb5d]
- Updated dependencies [e6fdbdc]
- Updated dependencies [7e2b7e9]
- Updated dependencies [c1e1e6b]
  - @object-ui/types@17.4.0

## 17.3.0

### Patch Changes

- Updated dependencies [d915c47]
- Updated dependencies [9e9e9a9]
- Updated dependencies [23018cc]
- Updated dependencies [f44d872]
- Updated dependencies [f833d3a]
- Updated dependencies [d22ae31]
  - @object-ui/types@17.3.0

## 17.2.0

### Patch Changes

- Updated dependencies [4ae0ac4]
- Updated dependencies [696e3c1]
- Updated dependencies [4bf612c]
- Updated dependencies [cb82705]
- Updated dependencies [f572849]
- Updated dependencies [444457c]
- Updated dependencies [022e4c3]
- Updated dependencies [009e25d]
- Updated dependencies [726b89c]
  - @object-ui/types@17.2.0

## 17.1.0

### Minor Changes

- 2307b52: fix(permissions,console): `MePermissionsProvider` retries a transient `/me/permissions` failure instead of stranding the app on its loading state

  "Not now" is a real answer from this endpoint. On a multi-tenant host it is served
  by the environment kernel that owns the session, and a COLD one answers `503` +
  `Retry-After` while it warms (objectstack#4159 / cloud#927). The provider treated
  that like any other failure: it set `error` — and a consumer that passes no
  `errorFallback` renders `loadingFallback` for the error state too. The console
  does exactly that (`loadingFallback={<LoadingScreen />}`, no `errorFallback`), so
  the app sat on its spinner indefinitely, with a `retry` nobody could reach.

  The fetch now re-attempts a **transient** failure — `408`, `425`, `429`, `502`,
  `503`, `504`, or a thrown fetch (offline / DNS / aborted), which never got an
  answer at all. A server-stated `Retry-After` wins over the exponential backoff
  (both wire forms are read, and clamped to 30s so a hostile value cannot park the
  UI); otherwise the delay doubles from `retryBaseDelayMs`. `loading` stays true
  across the waits, so the fail-closed loading state holds and consumers never see
  a permissive flash mid-recovery.

  Unchanged for a real answer about the caller: `401`, `403`, `404` and `500` fail
  on the first attempt exactly as before. `500` is deliberately not retried — a
  genuine server fault neither benefits from hammering nor should be hidden behind
  a spinner.

  **New props**, both optional and defaulted so no call site needs to change:

  - `maxRetries` (default `3`) — `0` restores the previous single-attempt
    behaviour.
  - `retryBaseDelayMs` (default `500`) — base for the exponential backoff.

  Also fixes a latent race the retries made much wider: the in-flight fetch is now
  cancelled when the effect tears down, so a slow answer for a previous `endpoint`
  or `fetcher` can no longer overwrite a fast answer for the current one. The retry
  primitives (`parseRetryAfterMs`, `backoffMs`, `isTransientFailure`,
  `TRANSIENT_STATUS`, `PermissionsFetchError`) live in a new internal `./retry`
  module — not exported from the package root.

  **The console now passes an `errorFallback`.** Retrying narrows the window but
  cannot close it — a kernel build slower than the retry budget still lands in the
  error state, and rendering `loadingFallback` there is what produced the eternal
  spinner. It now renders `<LoadingScreen error={...} onRetry={retry} />`, using the
  error + retry affordance that component has carried all along, so a user is never
  left with a spinner and no way forward.

### Patch Changes

- 49e5671: fix(console): `LocalizationFetchProvider` retries a transient `/me/localization` failure instead of degrading for the whole session

  `/auth/me/localization` is served by the environment kernel that owns the session
  on a multi-tenant host, and a cold one answers `503` + `Retry-After` while it
  warms (objectstack#4159). A transient failure is therefore a normal part of a
  cold start — not an exception.

  The provider made ONE attempt and `.catch()`-ed into silence. So a single 503
  during warm-up left currency and locale unset for the **whole session**, silently
  and permanently, long after the kernel was ready. Every money field rendered a
  plain number and nothing ever tried again.

  It now re-attempts a transient failure (`408`, `425`, `429`, `502`, `503`, `504`,
  or a thrown fetch), server-stated `Retry-After` first, exponential backoff
  otherwise. `401` / `403` / `404` / `500` are real answers about the caller and
  still fail on the first attempt.

  **It keeps its posture.** This provider is cosmetic, so it renders children
  throughout — including mid-retry — and fills the value in if and when an attempt
  succeeds. That is the opposite of `MePermissionsProvider`, which is fail-closed
  and holds its loading state across the waits. Both are pinned by tests.

  The retry PRIMITIVES ("is this transient", "how long to wait", `Retry-After`
  parsing) move from `@object-ui/permissions`'s internal module to
  `@object-ui/types` — the lowest package both callers can reach — and
  `PermissionsFetchError` becomes the generic `HttpFetchError`. One definition of
  transient, two policies, rather than a second copy free to drift from the first.
  No behaviour change for `MePermissionsProvider`.

- Updated dependencies [9e7349e]
- Updated dependencies [8864971]
- Updated dependencies [b41f401]
- Updated dependencies [19e9fa0]
- Updated dependencies [38ca8be]
- Updated dependencies [4952edf]
- Updated dependencies [7f0252e]
- Updated dependencies [7639a61]
- Updated dependencies [94e63ef]
- Updated dependencies [c4db402]
- Updated dependencies [5319bf1]
- Updated dependencies [49e5671]
- Updated dependencies [b5b97e2]
- Updated dependencies [f59f2c1]
- Updated dependencies [4874117]
- Updated dependencies [ce08d55]
- Updated dependencies [2374a49]
- Updated dependencies [ea7f477]
- Updated dependencies [7f23cd0]
- Updated dependencies [24e0e0a]
- Updated dependencies [3a6cf24]
- Updated dependencies [aa35561]
- Updated dependencies [03bd53b]
- Updated dependencies [3c1f321]
- Updated dependencies [a045a32]
- Updated dependencies [912496d]
- Updated dependencies [9867281]
  - @object-ui/types@17.1.0

## 17.0.0

### Minor Changes

- 2735de6: feat: render the server's effective API operation set (#3391 PR-4)

  The frontend now consumes the per-object **effective API operation set** the
  server resolves (from `/me/permissions` `apiOperations`, framework #3391) —
  never the raw `apiMethods` — so Import/Export/New/Edit/Delete buttons match what
  the server will actually admit, and a 405 import refusal shows a dedicated
  message instead of silently falling back.

  - **core** `resolveCrudAffordances(obj, effectiveApiOperations?)` — new optional
    second argument intersects each affordance bit with its API operation
    (create/import→create/import, edit→update, delete→delete, exportCsv→export).
    Omitting it (old backend / no effective set) leaves affordances unchanged.
  - **permissions** — `/me/permissions` response carries per-object
    `apiOperations`; `PermissionContextValue.getObjectApiOperations(object)`
    exposes it (undefined when absent → callers keep current behavior); `check()`
    maps `import→allowCreate`, `export→allowRead`.
  - **app-shell** `ObjectView` intersects its toolbar affordances with the object's
    effective operations (Import); the platform-admin identity-import bypass is
    unaffected.
  - **plugin-list** `ListView` / **plugin-grid** `ObjectGrid` gate the Export
    button (and export handler) on effective `export`; `plugin-grid` gains the
    `@object-ui/permissions` workspace dependency.
  - **plugin-grid** `ImportWizard` — a 405 / `OBJECT_API_METHOD_NOT_ALLOWED`
    import refusal is detected by a new `isImportNotAllowed` predicate at every
    catch site (async, sync, dry-run) and STOPS with a dedicated
    `grid.import.notAllowed` message (10 locales + fallback dict) — it never falls
    back to the sync/legacy path (which 405s too), distinct from the 404
    route-absent fallback.

  Backward-compatible: a missing effective set (unrestricted object, older
  backend, or no permission provider) preserves the current default-allow
  behavior everywhere.

### Patch Changes

- 53642d4: fix(core,fields): a string `$orderby` is a clause, not a character array — and localize the sharing-rule widgets (objectstack#3821)

  **The recipient picker listed nothing, ever.** `QueryParams['$orderby']` was
  typed as `Record | string[] | SortObject[]`, so `queryParamsToRecord` sent any
  non-array value through `Object.entries`. Handed the clause string `'name asc'`
  — which callers do build by hand — it walked the string index by index and
  emitted `$orderby=0 n,1 a,2 m,3 e,4 ,5 a,6 s,7 c`. The server sorted by columns
  that don't exist and every row was filtered out, so
  `sys_sharing_rule.recipient_id` rendered "No matches" for every recipient type
  and no sharing rule could be created from the Console. `ObjectGrid` builds the
  same shape from a schema-level `sort` in three places, so grids with a string
  sort silently showed an empty table.

  A string `$orderby` is now passed through verbatim (the server's OData
  normalizer has always parsed `'name asc'`), and the type admits `string`.
  `RecipientPickerField` additionally switched to the structured
  `{ name: 'asc' }` form so it can't regress this way against any data source.

  **The three sharing-rule authoring widgets never had translations.**
  `ObjectRefField`, `RecipientPickerField` and `FilterConditionField` hardcoded
  their English copy — a Chinese Console showed "Select an object", "Select a
  user", "Search…", "No matches", "Edit as JSON". They now go through
  `useFieldTranslation` like every other widget, with keys added under `fields.*`
  in all ten locales.

  The recipient placeholder was the interesting one: it read
  `` `Select a ${recipientType.replace(/_/g,' ')}` ``, interpolating the enum
  value into an English sentence — a shape no locale can translate. It is now a
  per-type key (`fields.recipient.selectUser`, `…selectBusinessUnit`, …), so
  "选择业务单元" and "Select a business unit" no longer have to share a structure.

  **Editing a rule silently dropped its recipient.** The picker resets the stored
  id when `recipient_type` changes, because an id valid for a user is meaningless
  for a team. It treated the edit form's `'' → 'user'` hydration as such a change:
  opening any saved rule blanked the recipient, and saving persisted the blank.
  Only a non-empty predecessor now counts as a type switch.

  **Building a filter submitted the surrounding form.** None of `FilterBuilder`'s
  controls declared `type="button"`, and a bare `<button>` inside a `<form>`
  defaults to `type="submit"`. Adding, removing or clearing a condition therefore
  submitted the sharing-rule dialog — firing validation mid-edit, and on an
  already-valid form saving the record before the admin was done.

  **A rejected write showed the user raw server diagnostics.** The form rendered
  `error.message` verbatim, so a sharing / RLS denial reached the dialog and the
  toast as `FORBIDDEN: insufficient privileges to update showcase_private_note
pi-TgoJ4_DM55Fqz` — untranslated, and leaking the object's machine name and the
  record id to whoever hit it. Permission failures now render localized copy
  (`form.noPermissionToSave`, added in all ten locales), with the server text kept
  on the console for debugging; other failures still show the server's message,
  which is the useful part, and fall back to `form.submitFailed` when there is
  none — replacing the previously hardcoded English "An error occurred during
  submission".

  **The detail header offered "Edit" on records the user may only read.** Object
  permissions can't express "this one record is read-only" — a read-only sharing
  grant sits inside an object the user may otherwise edit — so the header showed
  the primary Edit CTA, opened the form, and let the user retype a field before
  the server rejected the save. `DetailView` now gates Edit / Delete on the
  object-level check AND on the explain engine's record-grained verdict
  (`POST /api/v1/security/explain` with a `recordId`, ADR-0090 D6 / ADR-0095 C2 —
  the same pipeline the enforcement middleware runs, so button and server cannot
  disagree). Explaining oneself needs no special permission. The probe is one
  cached request per record, skipped entirely when the object-level check already
  says no, and **fails open** on every uncertainty — an unanswered hint must never
  be the reason a permitted user cannot act; the server stays the authority
  (ADR-0057 D10).

  **A long option rendered straight past the combobox border.** `Combobox`'s
  trigger pinned itself to the component's `w-[200px]` default while the fields
  around it ran the full form column, and the selected label was a bare text child
  of a flex button — flex items need `truncate` AND `min-w-0` to clip, and it had
  neither. So "成员 (showcase_project_membership)" in the object picker overflowed
  the control and collided with the field beside it. The label now truncates, the
  trigger can shrink, the dropdown matches the trigger's width instead of a
  hardcoded 200px (a widened combobox used to clip its own options), and the two
  sharing-rule pickers ask for `w-full` so they line up with every other input.

  Hardens `evaluatePermission` while there: a role config carrying only
  `fieldPermissions` (no `actions`) made `check()` throw a TypeError that
  propagated out of the render. A permission check must not be able to crash a
  view.

  Browser-verified against the framework showcase Console in Chinese: object /
  criteria / recipient copy is fully localized, the recipient dropdown lists real
  users, business units and positions, a saved rule reopens with its recipient and
  criteria intact, editing the filter no longer submits, and a rule created
  end-to-end stores a real record id rather than free text. The criteria authored
  in the builder is honored by the evaluator: `{"pinned":true}` on an owner-private
  object granted the recipient exactly the matching records and nothing else.

- Updated dependencies [1767124]
- Updated dependencies [8ecf5a6]
- Updated dependencies [dfd3705]
- Updated dependencies [6dee2cb]
- Updated dependencies [c7cff19]
- Updated dependencies [cd09a7b]
- Updated dependencies [f1abf0e]
- Updated dependencies [f05b84e]
- Updated dependencies [662bdf9]
- Updated dependencies [059a052]
- Updated dependencies [53642d4]
- Updated dependencies [8aae006]
- Updated dependencies [d147a13]
  - @object-ui/types@17.0.0

## 16.1.0

### Patch Changes

- Updated dependencies [7cf4051]
- Updated dependencies [94d4876]
- Updated dependencies [2b17339]
- Updated dependencies [31b77d4]
- Updated dependencies [6d4fbe6]
- Updated dependencies [62b9ab5]
- Updated dependencies [29c6040]
- Updated dependencies [faebac3]
- Updated dependencies [199fa83]
  - @object-ui/types@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [210806a]
- Updated dependencies [b4ef588]
- Updated dependencies [5534535]
- Updated dependencies [9b8f978]
  - @object-ui/types@16.0.0

## 15.0.0

### Patch Changes

- @object-ui/types@15.0.0

## 14.1.0

### Minor Changes

- 2b30583: fix(permissions): close the console FLS fail-open for token-only sessions (framework#2926 ④). Two halves: `MePermissionsProvider` gains a `fetcher` prop and the console passes `createAuthenticatedFetch()` so `/me/permissions` carries the Bearer token like every other data call (the cookie-only default fetch resolved token-only sessions as anonymous); and the unknown-object default is now authentication-gated — authenticated sessions fail CLOSED when an object has no resolved perms (fields render read-only instead of inviting input the data layer strips), while anonymous sessions keep the permissive default so guest/public forms keep working. Pairing note: with an older framework whose `/me/permissions` returns sparse objects for authenticated users, unconfigured objects now render read-only.

### Patch Changes

- Updated dependencies [2ded18c]
- Updated dependencies [e628d1f]
- Updated dependencies [887062c]
- Updated dependencies [9e2d58f]
- Updated dependencies [d5b1bc0]
- Updated dependencies [f0f10f5]
  - @object-ui/types@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [86c69c3]
- Updated dependencies [6a74160]
  - @object-ui/types@14.0.0

## 13.2.0

### Patch Changes

- @object-ui/types@13.2.0

## 13.1.0

### Patch Changes

- @object-ui/types@13.1.0

## 13.0.0

### Patch Changes

- Updated dependencies [619097e]
  - @object-ui/types@13.0.0

## 12.1.0

### Patch Changes

- Updated dependencies [c31874d]
  - @object-ui/types@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [226fde9]
- Updated dependencies [e4de456]
  - @object-ui/types@12.0.0

## 11.5.0

### Patch Changes

- Updated dependencies [9255686]
- Updated dependencies [1072701]
  - @object-ui/types@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [8bf6295]
- Updated dependencies [1948c5b]
- Updated dependencies [c38d107]
  - @object-ui/types@11.4.0

## 11.3.0

### Patch Changes

- @object-ui/types@11.3.0

## 11.2.0

### Patch Changes

- @object-ui/types@11.2.0

## 11.1.0

### Patch Changes

- @object-ui/types@11.1.0

## 7.3.0

### Patch Changes

- @object-ui/types@7.3.0

## 7.2.0

### Patch Changes

- Updated dependencies [d23db5c]
  - @object-ui/types@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [677f7ed]
- Updated dependencies [a71be60]
- Updated dependencies [cb03bc3]
  - @object-ui/types@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [ddbe4a2]
- Updated dependencies [9049bbe]
- Updated dependencies [cb2fdb1]
- Updated dependencies [6cfa330]
- Updated dependencies [ad8ade6]
- Updated dependencies [3870c20]
- Updated dependencies [b88c560]
- Updated dependencies [d16566f]
- Updated dependencies [300d755]
- Updated dependencies [4eb9cb6]
- Updated dependencies [858ad94]
  - @object-ui/types@7.0.0

## 6.2.3

### Patch Changes

- @object-ui/types@6.2.3

## 6.2.2

### Patch Changes

- @object-ui/types@6.2.2

## 6.2.1

### Patch Changes

- @object-ui/types@6.2.1

## 6.2.0

### Patch Changes

- @object-ui/types@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [991b62d]
  - @object-ui/types@6.1.0

## 6.0.4

### Patch Changes

- @object-ui/types@6.0.4

## 6.0.3

### Patch Changes

- @object-ui/types@6.0.3

## 6.0.2

### Patch Changes

- @object-ui/types@6.0.2

## 6.0.1

### Patch Changes

- @object-ui/types@6.0.1

## 6.0.0

### Patch Changes

- @object-ui/types@6.0.0

## 5.4.2

### Patch Changes

- @object-ui/types@5.4.2

## 5.4.1

### Patch Changes

- @object-ui/types@5.4.1

## 5.4.0

### Patch Changes

- Updated dependencies [3a8c754]
  - @object-ui/types@5.4.0

## 5.3.2

### Patch Changes

- @object-ui/types@5.3.2

## 5.3.1

### Patch Changes

- @object-ui/types@5.3.1

## 5.3.0

### Patch Changes

- @object-ui/types@5.3.0

## 5.2.1

### Patch Changes

- @object-ui/types@5.2.1

## 5.2.0

### Patch Changes

- Updated dependencies [de0c5e6]
- Updated dependencies [9997cae]
- Updated dependencies [70b5570]
  - @object-ui/types@5.2.0

## 5.1.1

### Patch Changes

- @object-ui/types@5.1.1

## 5.1.0

### Patch Changes

- Updated dependencies [cf30cc2]
- Updated dependencies [5b80cfd]
  - @object-ui/types@5.1.0

## 5.0.2

### Patch Changes

- @object-ui/types@5.0.2

## 5.0.1

### Patch Changes

- @object-ui/types@5.0.1

## 5.0.0

### Patch Changes

- Updated dependencies [7213027]
  - @object-ui/types@5.0.0

## 4.8.0

### Patch Changes

- @object-ui/types@4.8.0

## 4.7.0

### Patch Changes

- @object-ui/types@4.7.0

## 4.6.0

### Patch Changes

- @object-ui/types@4.6.0

## 4.5.0

### Patch Changes

- Updated dependencies [ab5e281]
  - @object-ui/types@4.5.0

## 4.4.0

### Patch Changes

- @object-ui/types@4.4.0

## 4.3.1

### Patch Changes

- @object-ui/types@4.3.1

## 4.3.0

### Patch Changes

- @object-ui/types@4.3.0

## 4.2.1

### Patch Changes

- @object-ui/types@4.2.1

## 4.2.0

### Patch Changes

- @object-ui/types@4.2.0

## 4.1.0

### Patch Changes

- @object-ui/types@4.1.0

## 4.0.12

### Patch Changes

- @object-ui/types@4.0.12

## 4.0.11

### Patch Changes

- @object-ui/types@4.0.11

## 4.0.10

### Patch Changes

- @object-ui/types@4.0.10

## 4.0.9

### Patch Changes

- @object-ui/types@4.0.9

## 4.0.8

### Patch Changes

- @object-ui/types@4.0.8

## 4.0.7

### Patch Changes

- @object-ui/types@4.0.7

## 4.0.6

### Patch Changes

- @object-ui/types@4.0.6

## 4.0.5

### Patch Changes

- @object-ui/types@4.0.5

## 4.0.4

### Patch Changes

- @object-ui/types@4.0.4

## 4.0.3

### Patch Changes

- 4be43e2: **Page-mode record forms (`editMode: 'page'`).** New per-object metadata flag that opts a record's create/edit form into a dedicated full-screen route (`/apps/:appName/:objectName/new`, `/apps/:appName/:objectName/record/:recordId/edit`). Two new declarative actions `navigate_create` and `navigate_edit` open these routes from JSON action buttons. Default modal behavior is preserved for objects that do not set `editMode`.

  **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: `ComponentRegistry` singleton fix.** Both plugins' Vite configs now mark all `@object-ui/*` packages as external so each plugin no longer bundles its own private copy of `@object-ui/core`. Cross-plugin component lookups now resolve correctly from the same singleton registry. `plugin-list` dist shrank from multi-MB to 67 kB (gzip 16 kB); `plugin-detail` to 124 kB (gzip 28 kB).

  **`@object-ui/app-shell` `CreateViewDialog` churn fix.** `existingSet` is now memoised on the joined string key of `existingLabels` rather than the raw array reference, preventing the name-suggest `useEffect` from re-firing on every parent render.

  **CI fixes.** `ReportViewer` conditional-formatting test now accepts both `rgb(...)` and hex color representations. `ObjectView` i18n mocks rewritten to mirror the real hook shapes (`useObjectTranslation`, `useObjectLabel`).

- Updated dependencies [4be43e2]
  - @object-ui/types@4.0.3

## 4.0.1

### Patch Changes

- @object-ui/types@4.0.1

## 4.0.0

### Patch Changes

- Updated dependencies
  - @object-ui/types@4.0.0

## 3.4.0

### Patch Changes

- Updated dependencies [f1ca238]
- Updated dependencies [de881ef]
  - @object-ui/types@3.4.0

## 3.3.2

### Patch Changes

- @object-ui/types@3.3.2

## 3.3.1

### Patch Changes

- @object-ui/types@3.3.1

## 3.3.0

### Patch Changes

- @object-ui/types@3.3.0

## 3.2.0

### Patch Changes

- @object-ui/types@3.2.0

## 3.1.5

### Patch Changes

- @object-ui/types@3.1.5

## 3.1.4

### Patch Changes

- @object-ui/types@3.1.4

## 3.1.3

### Patch Changes

- @object-ui/types@3.1.3

## 3.1.2

### Patch Changes

- @object-ui/types@3.1.2

## 3.1.1

### Patch Changes

- Updated dependencies
  - @object-ui/types@3.1.1

## 3.0.3

### Patch Changes

- @object-ui/types@3.0.3

## 3.0.2

### Patch Changes

- @object-ui/types@3.0.2

## 3.0.1

### Patch Changes

- @object-ui/types@3.0.1

## 3.0.0

### Minor Changes

- 87979c3: Upgrade to @objectstack v3.0.0 and console bundle optimization
  - Upgraded all @objectstack/\* packages from ^2.0.7 to ^3.0.0
  - Breaking change migrations: Hub → Cloud namespace, definePlugin removed, PaginatedResult.value → .records, PaginatedResult.count → .total, client.meta.getObject() → client.meta.getItem()
  - Console bundle optimization: split monolithic 3.7 MB chunk into 17 granular cacheable chunks (95% main entry reduction)
  - Added gzip + brotli pre-compression via vite-plugin-compression2
  - Lazy MSW loading for build:server (~150 KB gzip saved)
  - Added bundle analysis with rollup-plugin-visualizer

### Patch Changes

- Updated dependencies [87979c3]
  - @object-ui/types@3.0.0

## 2.0.0

### Major Changes

- b859617: Release v1.0.0 — unify all package versions to 1.0.0

### Patch Changes

- Updated dependencies [b859617]
  - @object-ui/types@2.0.0
