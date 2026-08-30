# ADR-0007: Settings — Manifest + K/V Store + Resolver (Apple-style)

**Status**: Accepted — backend implemented; UI pending (objectui) (proposed 2026-05-20 · calibrated 2026-06-12)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0005](./0005-metadata-customization-overlay.md) (Metadata Customization Overlay), [ADR-0006 v4](./0006-project-environment-split.v4.md) (Project/Environment Split — this record was originally built on v3, superseded by v4)
**Consumers**: `@objectstack/spec`, `@objectstack/platform-objects`, new `@objectstack/service-settings`, `@objectstack/plugin-auth` (Setup app), `objectui` (Settings renderer)

---

## Context

The platform needs a uniform way for plugins and the runtime to expose **configurable settings** (Mail delivery, Branding, Feature flags, Storage, AI providers, SSO, etc.) without each plugin reinventing:

- a custom object/table,
- a hand-written admin form in `objectui`,
- its own encryption / audit / "test connection" plumbing,
- a bespoke nav entry under the Setup app.

Today the only related infrastructure is:

| Component | Status |
|---|---|
| `sys_user_preference` (per-user K/V) | ✅ exists |
| `sys_environment_credential` (rotatable encrypted creds) | ✅ exists (`managedBy: 'config'`) |
| Setup app shell with grouped nav | ✅ exists (`platform-objects/src/apps/setup.app.ts`) |
| `password` field type in spec | ✅ exists |
| Documented config-resolution hierarchy (Runtime > User > Tenant > Env) | ⚠️ documented in `sys-user-preference.object.ts` header but **no resolver service implements it** |
| Tenant-level config object | ❌ missing |
| Generic `SettingsService.get(ns, key)` | ❌ missing |
| Env-override semantics surfaced to UI | ❌ missing |
| Standard "test connection" action contract | ❌ missing |
| Singleton-form rendering mode in `objectui` | ❌ missing |

Without an opinionated answer, every new plugin will either (a) author a one-off `sys_*_config` object plus a custom UI page, or (b) abuse `sys_user_preference` for tenant-global state. Both break Setup-app consistency, audit, and Studio export.

## Survey of prior art

| Platform | Schema | Storage | UI | Notable |
|---|---|---|---|---|
| **Apple iOS/macOS** | `Settings.bundle/Root.plist` with ~9 `Specifier` types | `NSUserDefaults` (per-app plist K/V) | System-owned renderer; app never draws | Preference Pane = escape hatch; MDM = forced override |
| **Salesforce** | Custom Settings / Custom Metadata Types | Strongly-typed objects (Hierarchy/List) | Per-page metadata-generated | Org/Profile/User hierarchy baked into the object |
| **ServiceNow** | none (just K/V rows) | `sys_properties` table | Category-grouped pages | Wide but weakly typed; UX regularly criticised |
| **SAP / Oracle Fusion** | Configuration Object + Profile Options | Object + K/V (dual-track) | Domain pages | Business-semantic → object; tunables → K/V |
| **Atlassian (Jira/Confluence)** | `admin-page` plugin descriptor | Plugin-owned (mostly K/V w/ namespace) | Descriptor-rendered | Schema and storage decoupled |
| **Odoo / Dynamics** | Transient `res.config.settings` model + field defs | Mixed: real model fields + K/V params | Engine-rendered | One file = one settings page |
| **Shopify / Stripe** | Per-page hand-tuned strongly-typed forms | Few "big" objects + K/V for plugins | Category-hub homepage | Premium UX, hand-crafted top pages |
| **Notion / Linear / Slack** | None | Edit fields on the Workspace object | Standard object detail | "Settings" is just editing `workspace` |
| **AWS / Azure / GCP** | Resource definitions | Each setting = a resource | Resource pages | "Mail setting" = an SES Identity resource |

### Cross-platform invariants

1. **No-one uses a single mode.** All ship 2-3 storage shapes (typed object, generic K/V, business-object fields).
2. **Schema-driven rendering wins** wherever the surface is admin-facing and high-churn (Apple, Salesforce, Atlassian, Odoo).
3. **Escape hatch is mandatory.** Apple Preference Pane, Salesforce VF page, Atlassian custom servlet — all leave a door for OAuth dances, device pairing, visualisations.
4. **Override layer is universal.** MDM, Hierarchy Custom Settings, profile-level overrides, env vars in cloud consoles.
5. **Storage tends to be K/V.** Even Salesforce Hierarchy Custom Settings are conceptually `(scope_id, key) → value`.

### Apple model is the closest fit

ObjectStack's protocol-first DNA matches Apple's: a small set of declarative specifiers + a uniform K/V store + a system-owned renderer + an escape hatch. Adopt it.


## Decision

**Four layers, one source of truth per layer. No per-setting tables.**

```
 DECLARATION
   plugin code ──exports──► SettingsManifest                 (TS object, in-memory; bundled)
   manifests registered with MetadataService at boot

 STORAGE
   sys_setting K/V row    (namespace, key, scope, value, encrypted, source, updated_by, ...)
   one physical table; scope ∈ { 'env', 'tenant', 'user', 'runtime' }

 RESOLUTION   SettingsService.get(ns, key, ctx)
   1. process.env override         (source='env',     locked=true)        ← highest
   2. sys_setting WHERE scope='tenant'                                    ← tenant
   3. sys_setting WHERE scope='user' AND user_id=ctx.user_id              ← user
   4. manifest specifier.default                                          ← default
   returns: { value, source, locked }

 RUNTIME WRITE  SettingsService.set(ns, key, value, scope, ctx)
   - upsert sys_setting row (encrypt via KMS if specifier.encrypted)
   - audit row in sys_audit_log
   - reject if effective source='env' (env wins, UI shows locked)

 RENDER (UI)   SettingsView({ namespace })
   GET /api/settings/:namespace         → { manifest, values: { key: { value, source, locked } } }
   PUT /api/settings/:namespace         → { key: value, ... }
   POST /api/settings/:namespace/test   → { ok, message, details }    (optional, manifest-declared)
```

### Design principles (binding)

1. **One manifest, many namespaces.** Each plugin exports any number of `SettingsManifest`s. A manifest is a declarative tree of `Specifier`s — never a React component, never a SQL DDL.
2. **One storage table.** All settings persist into `sys_setting`. No per-namespace tables, no `sys_mail_config` / `sys_sso_config` / etc. unless the **escape hatch** clause applies (see §Escape hatch).
3. **One resolver.** All reads must go through `SettingsService.get()`. Plugins must not query `sys_setting` directly. This is what makes Env > Tenant > User layering a guarantee, not a convention.
4. **Schema lives with code, values live in DB.** Manifests are part of the plugin bundle (versioned with code). Values are runtime state. Never serialise manifest into `sys_setting`.
5. **Encryption is a manifest concern, not caller's.** `specifier.encrypted: true` ⇒ `SettingsService` calls KMS on write/read transparently. Callers see plaintext (subject to permission).
6. **Env override is first-class.** Whenever `process.env[NS_KEY_UPPER]` is set, the resolver returns it with `source='env', locked=true`. Writes from UI are rejected with HTTP 409 + reason `"locked-by-env"`. The UI surfaces this as a badge — never silently overwritten.
7. **UI is system-owned.** Plugins must not ship custom React for normal settings. They get the standard `<SettingsView>` for free. Custom UI requires invoking the escape hatch.
8. **Test actions are declarative.** Manifests declare `actions` with an HTTP handler descriptor. The UI renders standard buttons + toast. No bespoke component code.

## Specifier set

A small, **closed** set of specifier types. Borrowed from Apple's PreferenceSpecifiers and trimmed to what enterprise settings actually need. New types require an ADR amendment.

| Specifier | Renders as | Persists | Notes |
|---|---|---|---|
| `group` | section header + divider | — | `visible` expression supported for conditional sections |
| `text` | `<input type=text>` | string | `pattern`, `minLength`, `maxLength` |
| `textarea` | `<textarea>` | string | `rows` |
| `password` | masked input | string (encrypted) | implicit `encrypted: true`; write="" means "don't change" |
| `email` / `url` / `phone` | typed input | string | format validation |
| `number` | `<input type=number>` | number | `min`, `max`, `step` |
| `toggle` | switch | boolean | |
| `select` | dropdown | string \| number | `options: [{value,label}]` |
| `radio` | radio group | string \| number | for ≤5 options |
| `multiselect` | checkbox list / tag picker | array | |
| `slider` | range slider | number | `min`, `max`, `step` |
| `color` | colour picker | hex string | |
| `json` | code editor | object | for advanced/raw config |
| `title-value` | read-only label | — | display computed/derived values |
| `child-pane` | nav row → sub-page | — | references another manifest namespace |
| `action-button` | button | — | triggers `handler` (HTTP / built-in) |
| `info-banner` | callout | — | static guidance, supports markdown |

Common specifier fields:

```ts
interface Specifier {
  type: SpecifierType;
  key?: string;                          // required for value-bearing specifiers
  label: string;
  description?: string;
  default?: unknown;
  visible?: string;                      // expression: "${data.provider === 'smtp'}"
  required?: boolean;
  encrypted?: boolean;                   // forced true for password
  scope?: 'tenant' | 'user';             // default 'tenant'
  permission?: string;                   // e.g. 'setup.write'
  // type-specific:
  options?: Array<{ value: unknown; label: string }>;
  min?: number; max?: number; step?: number;
  pattern?: string;
  rows?: number;
  handler?: ActionHandler;               // action-button only
  href?: string;                         // child-pane only
}
```

## Manifest examples

### Example 1 — Mail Delivery (typical: provider switch + encrypted creds + test action)

```ts
// packages/plugin-mail/src/mail.settings-manifest.ts
export const MailSettingsManifest: SettingsManifest = {
  namespace: 'mail',
  label: 'Mail Delivery',
  icon: 'mail',
  description: 'Configure outbound email transport.',
  permission: 'setup.write',
  scope: 'tenant',
  specifiers: [
    { type: 'group', label: 'Provider' },
    { type: 'select', key: 'provider', label: 'Provider', default: 'smtp',
      options: [
        { value: 'smtp',     label: 'SMTP' },
        { value: 'sendgrid', label: 'SendGrid' },
        { value: 'ses',      label: 'Amazon SES' },
        { value: 'resend',   label: 'Resend' },
      ] },

    { type: 'group', label: 'SMTP', visible: "${data.provider === 'smtp'}" },
    { type: 'text',     key: 'smtp_host', label: 'Host',
      visible: "${data.provider === 'smtp'}", required: true },
    { type: 'number',   key: 'smtp_port', label: 'Port', default: 587,
      visible: "${data.provider === 'smtp'}" },
    { type: 'text',     key: 'smtp_username', label: 'Username',
      visible: "${data.provider === 'smtp'}" },
    { type: 'password', key: 'smtp_password', label: 'Password',
      visible: "${data.provider === 'smtp'}" },
    { type: 'toggle',   key: 'smtp_secure', label: 'Use TLS', default: true,
      visible: "${data.provider === 'smtp'}" },

    { type: 'group', label: 'API Credentials',
      visible: "${data.provider !== 'smtp'}" },
    { type: 'password', key: 'api_key', label: 'API Key',
      visible: "${data.provider !== 'smtp'}", required: true },

    { type: 'group', label: 'Identity' },
    { type: 'email', key: 'from_email', label: 'From Address', required: true },
    { type: 'text',  key: 'from_name',  label: 'From Name' },
    { type: 'email', key: 'reply_to',   label: 'Reply-To' },

    { type: 'group', label: 'Test' },
    { type: 'action-button', label: 'Send Test Email', icon: 'send',
      handler: { kind: 'http', method: 'POST',
                 url: '/api/settings/mail/test',
                 body: { to: '${ctx.user.email}' } } },
  ],
};
```

### Example 2 — Branding (simple)

```ts
export const BrandingSettingsManifest: SettingsManifest = {
  namespace: 'branding',
  label: 'Branding',
  icon: 'palette',
  scope: 'tenant',
  specifiers: [
    { type: 'text',  key: 'product_name', label: 'Product Name' },
    { type: 'text',  key: 'tagline',      label: 'Tagline' },
    { type: 'color', key: 'accent_color', label: 'Accent Colour', default: '#7c3aed' },
    { type: 'text',  key: 'logo_url',     label: 'Logo URL' },
    { type: 'select', key: 'theme', label: 'Default Theme', default: 'system',
      options: [{value:'light',label:'Light'},{value:'dark',label:'Dark'},{value:'system',label:'System'}] },
  ],
};
```

### Example 3 — Feature flags (long-tail booleans)

```ts
export const FeatureFlagsManifest: SettingsManifest = {
  namespace: 'feature_flags',
  label: 'Feature Flags',
  icon: 'flag',
  scope: 'tenant',
  specifiers: [
    { type: 'group', label: 'AI' },
    { type: 'toggle', key: 'ai_enabled',          label: 'Enable AI features',     default: false },
    { type: 'toggle', key: 'ai_auto_summarize',   label: 'Auto-summarise records', default: false,
      visible: "${data.ai_enabled}" },
    { type: 'group', label: 'Beta' },
    { type: 'toggle', key: 'beta_kanban_v2',      label: 'New Kanban (Beta)',      default: false },
    { type: 'toggle', key: 'beta_inline_editing', label: 'Inline editing (Beta)',  default: false },
  ],
};
```

### When NOT to use a manifest — escape hatch

Use a strongly-typed `sys_*_config` ObjectSchema + the existing object pipeline only if **all four** apply:

1. The settings have **lifecycle state** (active/inactive/pending) beyond what `value` can express.
2. Multiple records make sense (e.g. multiple SSO providers, multiple SMTP backups).
3. The UI needs **interactive flows** the specifier set can't express (OAuth callback dance, device pairing, visual editor).
4. The settings have **first-class actions** beyond test/save (rotate key, run migration, re-sync).

In that case, the manifest mechanism is not used; the plugin contributes a normal `sys_*_config` object + Setup nav entry pointing at it. Today this applies to **at most**: SSO, OAuth Applications (already exists), Webhooks (already exists). Mail / Branding / Feature flags / Storage / AI providers — **all manifest**.

## Storage schema

```ts
// packages/platform-objects/src/system/sys-setting.object.ts
export const SysSetting = ObjectSchema.create({
  name: 'sys_setting',
  label: 'Setting',
  pluralLabel: 'Settings',
  icon: 'sliders',
  isSystem: true,
  managedBy: 'system',
  description: 'Generic K/V store backing the SettingsManifest contract.',
  fields: [
    { name: 'namespace', type: 'text',     required: true, indexed: true },
    { name: 'key',       type: 'text',     required: true },
    { name: 'scope',     type: 'select',   required: true,
      options: ['tenant','user','runtime'], default: 'tenant' },
    { name: 'user_id',   type: 'lookup',   refersTo: 'sys_user' },     // when scope=user
    { name: 'value',     type: 'json' },                                // JSON-encoded
    { name: 'encrypted', type: 'boolean',  default: false },           // payload at rest
    { name: 'value_enc', type: 'text' },                                // ciphertext when encrypted=true; value is null
    { name: 'updated_by',type: 'lookup',   refersTo: 'sys_user' },
    { name: 'updated_at',type: 'datetime' },
  ],
  uniqueConstraints: [['namespace', 'key', 'scope', 'user_id']],
  // managedBy:system → admin list page is diagnostic-only; writes flow through SettingsService
});
```

`source='env'` is **not stored** — it is computed at resolve time. Env values never round-trip into the table.

## Service surface

```ts
// packages/services/service-settings/src/settings.service.ts
export interface ResolvedValue<T = unknown> {
  value: T;
  source: 'env' | 'tenant' | 'user' | 'default';
  locked: boolean;             // true ⇔ source === 'env'
}

export interface SettingsService {
  // Resolution
  get<T = unknown>(ns: string, key: string, ctx: RequestContext): Promise<ResolvedValue<T>>;
  getNamespace(ns: string, ctx: RequestContext): Promise<Record<string, ResolvedValue>>;

  // Write (rejected if effective source='env')
  set(ns: string, key: string, value: unknown, scope: 'tenant'|'user', ctx: RequestContext): Promise<void>;
  setMany(ns: string, values: Record<string, unknown>, scope: 'tenant'|'user', ctx: RequestContext): Promise<void>;

  // Manifest registry
  registerManifest(manifest: SettingsManifest): void;
  listManifests(): SettingsManifest[];
  getManifest(ns: string): SettingsManifest | undefined;

  // Test actions (declared in manifest)
  runAction(ns: string, actionId: string, input: unknown, ctx: RequestContext): Promise<ActionResult>;
}
```

### REST surface

| Method | Path | Body | Returns |
|---|---|---|---|
| GET  | `/api/settings`                       | — | `SettingsManifest[]` (filtered by permission) |
| GET  | `/api/settings/:namespace`            | — | `{ manifest, values: Record<key, ResolvedValue> }` |
| PUT  | `/api/settings/:namespace`            | `{ key: value, ... }` | `{ values }` (409 if any key locked-by-env) |
| POST | `/api/settings/:namespace/:actionId`  | action input | `ActionResult` |

### Env override convention

`process.env[NS_KEY]` (uppercased, dot → underscore) takes precedence. Examples:

| Manifest key | Env var |
|---|---|
| `mail.smtp_host`     | `MAIL_SMTP_HOST` |
| `mail.smtp_password` | `MAIL_SMTP_PASSWORD` |
| `feature_flags.ai_enabled` | `FEATURE_FLAGS_AI_ENABLED` |

A `settings.env-overrides.json` allow-list MAY restrict which keys are eligible — by default all are.

## Audit & history

Every `set()` writes:
- a row to `sys_audit_log` (`{ object: 'sys_setting', action: 'update', namespace, key, scope, actor, before, after }`)
- a history snapshot if the parent `sys_setting` row has `trackHistory: true` (off by default; opt-in per namespace)

Plaintext values for `encrypted: true` fields are **never** written to audit/history — only `'<encrypted>'` placeholder + checksum.

## Permissions

- Reading a namespace requires `manifest.permission.read` (default: `setup.access`)
- Writing requires `manifest.permission.write` (default: `setup.write`)
- `scope: 'user'` specifiers are always readable/writable by the owning user (overrides the above for that scope)

## UI contract (`objectui`)

### New components

- `@object-ui/types`: `SettingsManifestSchema`, `SpecifierSchema` (mirrors server zod)
- `@object-ui/views`: `<SettingsView namespace="mail" />` — fetches `/api/settings/:ns`, renders specifiers
- `@object-ui/components`: `<EnvLockBadge source="env" />` — small chip "Locked by environment"
- `@object-ui/views`: `<SettingsHub />` — category-card landing page listing all manifests

### Render rules

1. Each `specifier.key` reuses the existing field widget keyed by `type` (no new widgets needed; `password` widget already exists).
2. `visible` expression evaluated against the in-memory namespace value map (live, reactive).
3. If `ResolvedValue.locked === true` → field is read-only + `<EnvLockBadge>`.
4. Dirty fields surface a sticky "Save changes" bar at the bottom of the page (reuse existing dirty-bar component).
5. `action-button` specifiers render as buttons in their containing group; clicking POSTs to the manifest's action endpoint and shows toast + inline status.
6. `child-pane` specifiers render as nav rows that route to `<SettingsView namespace="${child.namespace}" />`.

### Setup app integration

A new nav node type joins the existing `'object' | 'dashboard' | 'group'`:

```ts
{ id: 'nav_mail', type: 'settings', label: 'Mail Delivery',
  namespace: 'mail', icon: 'mail' }
```

`setup.app.ts` will be reorganised so the **primary nav** is settings-namespace-based (Mail, Branding, Feature flags, …) and the existing object-list entries (sys_user, sys_role, …) move under a "People & Access" group as today.

### Search & deep-linking

Because manifests are declarative metadata served from `/api/settings`, the Settings Hub indexes every `(namespace, key, label, description)` tuple. The system-wide ⌘K palette gets a "Settings" provider that links directly to `/console/setup/:ns#key`.

## Migration plan

### Phase 0 — Infrastructure (this RFC, 3-4 days)

1. **spec**: add `SettingsManifestSchema` zod + `SpecifierSchema` zod
2. **platform-objects**: add `sys_setting` object
3. **service-settings**: new package with `SettingsService` impl + REST routes + env override resolver + KMS hook
4. **service-settings**: hook into existing audit log
5. **objectui**: `<SettingsView>`, `<SettingsHub>`, `<EnvLockBadge>`, `'settings'` nav type
6. **objectui**: add settings widgets to ⌘K palette
7. **plugin-auth (Setup app)**: rewire nav to lead with settings namespaces

### Phase 1 — First three manifests (0.5-1 day each)

8. `plugin-mail` (new or under existing transport package) — `MailSettingsManifest` + `POST /test` impl with nodemailer
9. `plugin-auth` — `BrandingSettingsManifest` (logo / colours / product name)
10. `plugin-core` — `FeatureFlagsManifest` (ai_enabled, beta_*)

### Phase 2 — Long-tail (as-needed)

- `storage` (S3/OSS endpoint/bucket/key)
- `ai` (provider/api-key/model/temperature)
- `notifications` (per-channel toggles, scope=user)

### Phase 3 — Escape-hatch consolidation

Review existing `sys_oauth_application`, `sys_webhook`, `sys_two_factor` — keep as objects (they meet the escape-hatch criteria). Document the criteria in `CONTRIBUTING.md` so future plugins know when to choose manifest vs object.

## Consequences

### Positive

- **Adding a new setting type = a few lines of TS in one file.** No new table, no migration, no UI, no nav surgery, no audit wiring.
- **Uniform UX.** Every settings page looks and behaves identically — visual, keyboard, accessibility, search, dark mode, mobile.
- **Single audit funnel.** Compliance review only needs to inspect one service, not N plugin-specific code paths.
- **Env override is enforced, not advisory.** Plugins cannot bypass it because they don't query `sys_setting` directly.
- **Studio-friendly.** Manifests are pure JSON-able metadata → editable from Studio in a future iteration.
- **Plugin-friendly.** Third-party plugins get the entire settings UI for free by exporting one TS constant.
- **K/V scales horizontally.** Adding 1000 feature flags is 1000 rows, not 1000 columns.

### Negative

- **Two ways to express "settings"** (manifest vs `sys_*_config` object). Mitigation: documented escape-hatch criteria + linter that warns when a new `sys_*_config` object is added without ADR amendment.
- **Loss of relational queries on settings.** `JOIN sys_setting ON setting.key = ...` is awkward. Mitigation: most settings are read by key, not queried in bulk; the few that need it (per-user prefs already accessed by scope+user_id index) are fine via composite index.
- **Encrypted field UX is asymmetric** (write="" means "don't change"). Documented in `SettingsView`; matches `sys_environment_credential` existing behaviour.
- **Manifest evolution requires versioning thinking.** Renaming a key is a breaking change. Mitigation: `Specifier.deprecated: boolean` + `Specifier.replacedBy: string` flags planned for v2.

### Neutral

- `sys_user_preference` continues to exist for now but its semantics overlap with `sys_setting` (scope=user). A follow-up RFC will fold it into `sys_setting` after one release cycle.
- The Setup app navigation will change shape (settings-first instead of object-first). Communicated via release notes.

## Open questions (resolve before implementation)

1. **Where do manifests live?** Each plugin exports its own (preferred) — or a central `settings-registry` package (one place to find them all)? Recommendation: per-plugin, with the registry auto-discovering via plugin manifest entries.
2. **KMS provider abstraction.** Reuse `sys_environment_credential`'s existing encryption path? Likely yes — extract to shared `CryptoService`.
3. **`scope: 'project'` vs `'tenant'`** in a multi-project tenant (per ADR-0006)? Recommendation: `'tenant'` actually means "project" in project-kernel mode, "tenant" in control-plane mode — wrap behind the resolver, keep the manifest API as `tenant`.
4. **Manifest hot-reload.** Studio editing a manifest at runtime — out of scope for Phase 0, revisit after the K/V infrastructure is stable.
5. **i18n.** `label` / `description` accept `{ en: '…', zh: '…' }` map vs t() key? Match how the rest of the platform handles object labels — defer to whatever spec already chose.

## References

- `packages/platform-objects/src/identity/sys-user-preference.object.ts` — original config-resolution comment
- `packages/services/service-tenant/src/objects/sys-environment-credential.object.ts` — encrypted-creds reference impl
- `packages/spec/src/data/field.zod.ts` — existing field type catalogue
- `packages/platform-objects/src/apps/setup.app.ts` — Setup app shell
- Apple "Implementing an iOS Settings Bundle" — https://developer.apple.com/documentation/foundation/userdefaults/implementing_an_ios_settings_bundle
- Salesforce Custom Settings — https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/cs_about.htm
- ADR-0005 (Metadata Overlay) — pattern for "schema in code, deltas in DB"
