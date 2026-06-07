# @objectstack/plugin-approvals

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/formula@8.0.0
  - @objectstack/metadata-core@8.0.0
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/metadata-core@7.9.0
- @objectstack/formula@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [f01f9fa]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/formula@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/metadata-core@7.8.0
  - @objectstack/platform-objects@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [825ab06]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/formula@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/metadata-core@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/formula@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0
  - @objectstack/metadata-core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/metadata-core@7.5.0
- @objectstack/formula@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/metadata-core@7.4.1
- @objectstack/formula@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Minor Changes

- 4cc2ced: ADR-0029 K2.b — approvals domain ownership + Setup nav contribution.

  Moves `sys_approval_request` / `sys_approval_action` out of the
  `@objectstack/platform-objects` monolith into `@objectstack/plugin-approvals`,
  which already registers and operates them — so the plugin now owns its data
  model, behavior, and admin menu as one unit.

  - The object definitions move to `plugin-approvals`; `platform-objects` no
    longer exports them from `/audit`. Runtime is unchanged (the plugin already
    registered them at runtime).
  - **D7 navigation** — the Setup app's `group_approvals` entries (`Requests`,
    `Action History`) move out of `platform-objects`' `SETUP_NAV_CONTRIBUTIONS`
    into `plugin-approvals`' `navigationContributions`. The plugin fills the slot
    it owns; when the plugin is absent the slot stays empty.
  - **i18n (D8)** — the objects are removed from the `platform-objects` i18n
    extract config; their existing generated translation bundles keep working at
    runtime (object-name keyed). Migrating the i18n extraction/bundles to the
    plugin remains the tracked cross-cutting follow-up (best done with the
    `os i18n extract` tooling, not hand-edited generated files).

### Patch Changes

- 4404572: ADR-0029 D8 — migrate i18n ownership for the moved domains to their plugins.

  The object translations for the domains decomposed in K2.a/K2.b/K2 previously
  lived in the `@objectstack/platform-objects` generated bundles even though the
  objects now live in their capability plugins. This moves each domain's i18n
  extraction + bundles to the owning plugin, preserving every hand-translated
  string (zh-CN / ja-JP / es-ES):

  - Each plugin gains a build-time `scripts/i18n-extract.config.ts` and a
    `src/translations/` bundle (`{locale}.objects.generated.ts` + an `index.ts`
    barrel), generated with `os i18n extract` and self-baselined so re-runs
    preserve translations.
  - Each plugin loads its bundle at runtime on `kernel:ready` via
    `i18n.loadTranslations` (the i18n service is optional — load is best-effort).
    - `plugin-webhooks` ← `sys_webhook`, `sys_webhook_delivery`
    - `plugin-approvals` ← `sys_approval_request`, `sys_approval_action`
    - `plugin-security` ← `sys_role`, `sys_permission_set`,
      `sys_user_permission_set`, `sys_role_permission_set`
    - `plugin-sharing` ← `sys_record_share`, `sys_sharing_rule`, `sys_share_link`
  - `@objectstack/platform-objects` translation bundles are regenerated to drop
    those objects' keys (its extract config already excluded them); all other
    objects' translations and the metadata-form bundles are preserved.

  Net runtime effect is unchanged (same translations load, now contributed by the
  package that owns each object) — closing the D8 follow-up tracked since K2.a.

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0
  - @objectstack/formula@7.4.0
  - @objectstack/metadata-core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/formula@7.3.0
  - @objectstack/platform-objects@7.3.0
  - @objectstack/metadata-core@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/metadata-core@7.2.1
- @objectstack/formula@7.2.1
- @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/metadata-core@7.2.0
- @objectstack/formula@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0
  - @objectstack/formula@7.1.0
  - @objectstack/metadata-core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0
  - @objectstack/formula@7.0.0
  - @objectstack/metadata-core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/metadata-core@6.9.0
- @objectstack/formula@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/metadata-core@6.8.1
- @objectstack/formula@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0
  - @objectstack/formula@6.8.0
  - @objectstack/metadata-core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/metadata-core@6.7.1
- @objectstack/formula@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0
  - @objectstack/formula@6.7.0
  - @objectstack/metadata-core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/formula@6.6.0
  - @objectstack/platform-objects@6.6.0
  - @objectstack/metadata-core@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/metadata-core@6.5.1
- @objectstack/formula@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/metadata-core@6.5.0
- @objectstack/formula@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/formula@6.4.0
  - @objectstack/platform-objects@6.4.0
  - @objectstack/metadata-core@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/metadata-core@6.3.0
- @objectstack/formula@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/formula@6.2.0
  - @objectstack/platform-objects@6.2.0
  - @objectstack/metadata-core@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/metadata-core@6.1.1
- @objectstack/formula@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/formula@6.1.0
  - @objectstack/platform-objects@6.1.0
  - @objectstack/metadata-core@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0
  - @objectstack/formula@6.0.0
  - @objectstack/metadata-core@6.0.0

## 5.2.0

### Minor Changes

- bab2b20: feat(approvals): execution-pinned approval processes (ADR-0009)

  When an approval request is submitted, the engine now records a `process_hash`
  on `sys_approval_request` — the sha256 of the approval process body resolved
  through `MetadataRepository`. While the request is in flight, `approve` /
  `reject` / `recall` resolve the pinned process body via
  `MetadataRepository.getByHash`. Upgrading the approval process definition
  mid-flight therefore no longer affects requests that already started against
  the previous version.

  Behavior:

  - `sys_approval_request` gains a `process_hash` column (text, nullable,
    read-only). Existing rows keep working — the engine falls back to the
    current `sys_approval_process` projection when the column is empty.
  - `ApprovalServiceOptions` accepts an optional `metadataRepo`. When omitted
    (e.g. defining processes purely through the runtime API or in unit tests),
    pinning is silently disabled and the service behaves as before.
  - `ApprovalsServicePlugin` looks up the metadata service from the kernel
    and wires its repository automatically.
  - The metadata-core local `MetadataTypeSchema` enum was realigned with the
    canonical `@objectstack/spec/kernel` enum (drift fix: `approval`, `field`,
    `function`, `service`, …).

  This is the first user-visible consumer of the `executionPinned` capability
  introduced in ADR-0009.

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/metadata-core@5.2.0
  - @objectstack/core@5.2.0
  - @objectstack/formula@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0
  - @objectstack/formula@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0
  - @objectstack/formula@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/formula@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/formula@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.0.1

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/formula@4.1.0
  - @objectstack/platform-objects@4.1.0
