// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_webhook — Outbound HTTP integration configuration (runtime).
 *
 * Persists a single {@link Webhook} envelope per row so administrators
 * can author, enable/disable, and edit webhook subscriptions from the
 * Studio UI without code changes. The canonical Zod schema for the
 * `definition_json` envelope lives at `@objectstack/spec/automation/webhook`.
 *
 * ## Two authoring doors, one row
 * Rows land here two ways, distinguished by the `managed_by` provenance column:
 *   - **admin** — created/edited directly through this object's CRUD UI.
 *   - **package** — declared in code (`defineStack({ webhooks })` /
 *     `defineWebhook()`) and materialized on boot by
 *     `bootstrapDeclaredWebhooks` (#3461). Re-seeded every boot, but an admin
 *     edit stamps `customized: true` and freezes the row (seed-not-clobber,
 *     mirrors `sys_sharing_rule` #2909).
 *
 * One row per `name`. This plugin's {@link AutoEnqueuer} loads active rows on
 * boot + on `sys_webhook:changed` events, and turns matching `data.record.*`
 * events into deliveries on the shared `service-messaging` HTTP outbox
 * (ADR-0018 M3 — `sys_http_delivery`, drained by the messaging dispatcher).
 *
 * Ownership (ADR-0029 K2.a): this object is **owned by
 * `@objectstack/plugin-webhooks`** — the plugin that consumes these rows. It
 * used to live in the `@objectstack/platform-objects` monolith and be imported
 * here; the definition now lives with its owner so the plugin ships both data
 * and behavior as one unit.
 *
 * Platform-wide on purpose: every project (standalone, single-tenant,
 * cloud) can integrate with external systems (Slack, Stripe, internal
 * services) the same way.
 *
 * @namespace sys
 */
export const SysWebhook = ObjectSchema.create({
  name: 'sys_webhook',
  label: 'Webhook',
  pluralLabel: 'Webhooks',
  icon: 'webhook',
  isSystem: true,
  managedBy: 'config',
  // Authoring a webhook from the UI requires a structured form for the
  // headers / auth / retry / payload blocks — the generic JSON textarea
  // is acceptable as a v1 until a dedicated builder lands. Re-enable
  // create/edit/delete so admins can at least toggle `active` and edit
  // simple URL/method fields without round-tripping through code.
  userActions: { create: true, edit: true, delete: true, import: false },
  description: 'Outbound HTTP webhook subscription. Declared in code via defineStack({ webhooks }) / defineWebhook() (materialized into rows on boot) or authored directly in the Studio editor; dispatched by the webhook auto-enqueuer onto the shared HTTP outbox.',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{label}',
  highlightFields: ['name', 'object_name', 'url', 'active', 'updated_at'],

  listViews: {
    active: {
      type: 'grid',
      name: 'active',
      label: 'Active',
      data: { provider: 'object', object: 'sys_webhook' },
      columns: ['label', 'object_name', 'url', 'method', 'active', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: true }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    inactive: {
      type: 'grid',
      name: 'inactive',
      label: 'Inactive',
      data: { provider: 'object', object: 'sys_webhook' },
      columns: ['label', 'object_name', 'url', 'method', 'active', 'updated_at'],
      filter: [{ field: 'active', operator: 'equals', value: false }],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
    by_object: {
      type: 'grid',
      name: 'by_object',
      label: 'By Object',
      data: { provider: 'object', object: 'sys_webhook' },
      columns: ['object_name', 'label', 'url', 'active', 'updated_at'],
      sort: [{ field: 'object_name', order: 'asc' }, { field: 'label', order: 'asc' }],
      grouping: { fields: [{ field: 'object_name', order: 'asc', collapsed: false }] },
      pagination: { pageSize: 100 },
    },
    all_webhooks: {
      type: 'grid',
      name: 'all_webhooks',
      label: 'All',
      data: { provider: 'object', object: 'sys_webhook' },
      columns: ['label', 'object_name', 'url', 'method', 'active', 'updated_at'],
      sort: [{ field: 'label', order: 'asc' }],
      pagination: { pageSize: 50 },
    },
  },

  fields: {
    id: Field.text({ label: 'Webhook ID', required: true, readonly: true, group: 'System' }),

    name: Field.text({
      label: 'Name',
      required: true,
      maxLength: 100,
      // [#8554] "unique per organization", not bare "unique" — the bare wording
      // described the installation-wide index this card removed.
      description: 'snake_case name, unique per organization — referenced in logs and audit',
      group: 'Definition',
    }),

    label: Field.text({
      label: 'Display Label',
      required: false,
      maxLength: 200,
      group: 'Definition',
    }),

    object_name: Field.text({
      label: 'Object',
      required: false,
      maxLength: 100,
      // Object picker (same widget as sys_sharing_rule) instead of a free-text
      // machine name. Falls back to a text input when the widget is unavailable.
      widget: 'object-ref',
      description: 'Short object name whose record events (create/update/delete) fire this webhook',
      group: 'Definition',
    }),

    triggers: Field.select(
      ['create', 'update', 'delete', 'bulk_update', 'bulk_delete'],
      {
        label: 'Triggers',
        required: false,
        // Multi-select instead of a hand-typed comma-separated string. Stored as
        // an array; the auto-enqueuer parser also tolerates the legacy
        // comma-separated / JSON-string forms so existing rows keep working.
        multiple: true,
        // [#4639] `bulk_*` fire on predicate writes (`multi: true`), whose
        // delivery carries `matched` instead of a record — opt-in precisely
        // because that body is a different shape. Kept in step with
        // `WebhookTriggerType` (`@objectstack/spec/automation`), which is the
        // contract the auto-enqueuer validates against.
        description: 'Record events that fire this webhook (bulk_* deliver a count, not a record)',
        group: 'Definition',
      },
    ),

    url: Field.text({
      label: 'Target URL',
      required: true,
      maxLength: 2048,
      description: 'External endpoint that receives the POST',
      group: 'Definition',
    }),

    method: Field.select(
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      {
        label: 'HTTP Method',
        required: true,
        // Select instead of free text. Option values are lowercased by the
        // Field.select helper (get/post/…); the auto-enqueuer upper-cases the
        // resolved method before delivery, so existing 'POST' rows and the
        // lowercase option values both normalise correctly.
        defaultValue: 'post',
        description: 'HTTP method used for the callback request',
        group: 'Definition',
      },
    ),

    description: Field.textarea({ label: 'Description', required: false, group: 'Definition' }),

    active: Field.boolean({
      label: 'Active',
      required: true,
      defaultValue: true,
      description: 'Inactive webhooks are skipped by the dispatcher',
      group: 'Definition',
    }),

    definition_json: Field.textarea({
      label: 'Definition',
      required: true,
      description: 'Serialised Webhook JSON (see @objectstack/spec/automation/webhook) — timeout and the rest of the authored envelope. Credentials are NOT stored here: the signing secret lives in the encrypted `signing_secret` field and the custom headers in the encrypted `headers_secret` field.',
      group: 'Definition',
    }),

    /**
     * [#7986] Custom HTTP headers, in the engine's ENCRYPTED credential channel.
     *
     * The sibling passenger #7799 left on the blob it emptied. That card was
     * framed as "the signing secret is in cleartext" and was fixed exactly as
     * framed — but the COLUMN was the problem, and `headers` is the ordinary
     * place an `Authorization: Bearer …` goes. `definition_json` is an ordinary
     * textarea on an admin-authorable object with no restrictive
     * `enable.apiMethods` at all, so `GET /api/v1/data/sys_webhook` returned the
     * header map to every persona that can read the object, with none of the
     * retention bound that eventually ages out `sys_http_delivery`'s copies.
     *
     * The WHOLE map moves rather than the credential-looking entries, because
     * only some entries are credentials and the platform cannot tell which:
     * guessing from the header name is fail-OPEN on exactly the custom spellings
     * (`X-Acme-Token`) most likely to be one, and letting the author declare
     * which are sensitive is a change to the authoring envelope
     * (`webhook.zod.ts`) that belongs to the spec seat. See
     * `webhook-headers.ts` for the full comparison.
     *
     * Stored as the SERIALIZED map (the encrypted channel carries a string);
     * the enqueuer recovers and re-parses it server-side through
     * `engine.resolveSecretField()` when it refreshes its subscription cache,
     * on the same refresh that recovers the signing secret.
     *
     * Fail-closed by construction, the same way `signing_secret` is: with no
     * CryptoProvider the engine REFUSES the write rather than falling back to
     * cleartext, and a stored map that cannot be decrypted DROPS the
     * subscription rather than delivering it with its headers silently missing.
     */
    headers_secret: Field.secret({
      label: 'Custom Headers',
      required: false,
      description:
        'Custom HTTP headers sent with each delivery, as a JSON object ({"Authorization": "Bearer …"}). '
        + 'Encrypted at rest into sys_secret; reads return a mask, never the headers. Leave the mask '
        + 'untouched to keep the current value.',
      group: 'Definition',
    }),

    /**
     * [#7799] HMAC signing key, in the engine's ENCRYPTED credential channel.
     *
     * It used to ride inside `definition_json` as cleartext, because that column
     * is where the seeder parked the whole authored envelope. `definition_json`
     * is an ordinary textarea on an admin-authorable object with no restrictive
     * `enable.apiMethods`, so `GET /api/v1/data/sys_webhook` handed the key back
     * to every persona that can read the object — and that key is the receiver's
     * ONLY proof a delivery came from us. Same exposure class as #7722's
     * per-attempt copies, minus the retention window that eventually aged those
     * out.
     *
     * `type: 'secret'` moves it onto the channel built for this: the engine
     * encrypts on write via the registered `ICryptoProvider`, stores the
     * ciphertext as a `sys_secret` row, keeps only an opaque `secret:<id>` ref
     * on this column, and returns the mask on every read path. The enqueuer
     * recovers the plaintext server-side through `engine.resolveSecretField()`
     * when it refreshes its subscription cache.
     *
     * Fail-closed by construction: with no CryptoProvider wired the engine
     * REFUSES the write rather than falling back to cleartext, so the seeder
     * skips that webhook loudly instead of re-opening the hole in a new column.
     */
    signing_secret: Field.secret({
      label: 'Signing Secret',
      required: false,
      description:
        'HMAC-SHA256 key used to sign deliveries (X-Objectstack-Signature). Encrypted at rest into '
        + 'sys_secret; reads return a mask, never the key. Leave the mask untouched to keep the current value.',
      group: 'Definition',
    }),

    // ── Provenance (#3461 — record-authoritative seed-not-clobber) ──
    // Mirrors sys_sharing_rule (#2909). Both columns are `readonly`: the
    // engine strips them from non-system payloads (forge/clear-proof), while
    // bootstrapDeclaredWebhooks and the provenance stamp hook write with
    // isSystem. Deliberately NOT a write gate: webhooks are a first-class admin
    // authoring/tuning surface — admins may edit or deactivate a package row;
    // the seeder simply stops overwriting it once `customized` is stamped.
    managed_by: Field.select(
      ['platform', 'package', 'admin'],
      {
        label: 'Managed By',
        required: false,
        readonly: true,
        defaultValue: 'admin',
        description:
          'Record provenance: platform = framework built-in / package = app/package-declared ' +
          '(boot-seeded from defineStack webhooks) / admin = created in Setup.',
        group: 'System',
      },
    ),

    customized: Field.boolean({
      label: 'Customized',
      required: false,
      readonly: true,
      defaultValue: false,
      description:
        'Set when an admin edits a package-declared webhook; boot seeding will no longer ' +
        'overwrite the row (a deactivated noisy webhook survives redeploys). Meaningless on admin rows.',
      group: 'System',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    // [#8554] Scope spelled EXPLICITLY (ADR-0120 D1). On a DECLARED index bare
    // `unique: true` is the positional spelling of `'global'` — the listed
    // columns verbatim — so this was an installation-wide key on a tenant-scoped
    // object. Measured live before the fix: org_jia 201 / org_yi 409
    // UNIQUE_VIOLATION on the same name / org_yi unused name 201 / org_yi's own
    // GET on the colliding name 0 rows. Webhooks are named by admins from the
    // UI, so two organizations both wanting `order_created_hook` is ordinary.
    { fields: ['name'], unique: 'organization' },
    { fields: ['object_name'] },
    { fields: ['active', 'object_name'] },
  ],

  /**
   * [#9756] The data-API exposure of this object, declared EXPLICITLY.
   *
   * ## Why the block exists
   *
   * Three cards observed that `sys_webhook` declared no `enable` block at all
   * and each named narrowing its read surface as the next step — #7799 (the
   * signing secret), #7986 (the custom headers) and #8025 option 2 (the URL) —
   * and each assumed a later one would write the line. None did. The condition
   * held not because anyone judged the full default API correct here, but
   * because the omission was never anybody's deliverable. That is the standard
   * #8025 set and #9756 quotes back: *an omission is not a decision unless
   * someone wrote it down.* This block is that decision, written down.
   *
   * ## The census the set is derived from (#9756, measured before writing)
   *
   * | consumer | reaches this object through | needs |
   * |:---|:---|:---|
   * | Setup/Studio console — `nav_webhooks` (`webhook-outbox-plugin.ts`), the four list views above, `userActions` create/edit/delete | REST `/api/v1/data/sys_webhook` — the gated data API | `get` `list` `create` `update` `delete` |
   * | Operator predicate write — "deactivate every webhook on an object" (#4639, for which `AutoEnqueuer.handleSelfHealEvent` carries a `data.records.*` branch built expressly for this gesture) | REST `updateMany` / `deleteMany`, both gated on the `bulk` primitive | `bulk` |
   * | `AutoEnqueuer` cache refresh, `bootstrapDeclaredWebhooks`, `stampWebhookProvenance`, `redeliver-guard`, `migrateLegacyWebhookSecrets`, the `headers_secret` write gate | `engine.find/findOne/insert/update` and lifecycle hooks — ObjectQL directly, which never consults `enable.apiMethods` | ungated: unaffected by anything declared here |
   *
   * ⇒ every primitive is required by a real, measured consumer, so the set is
   * all six. No consumer outside the admin/operator surface was found.
   *
   * ## ⛔ This narrows NOTHING — do not read it as if it did
   *
   * `resolveEffectiveApiMethods` (`@objectstack/spec/data`) seeds the
   * `unrestricted` branch with the very same `API_PRIMITIVES` set, so the six
   * primitives resolve to the operation closure the *absent* block already
   * produced. The serialized effective set (`/me/permissions`, the 405
   * `allowed` array) is byte-identical, and no route or `callData` action
   * reaches an operation whose answer differs. Only `mode` changes,
   * `unrestricted` → `restricted`.
   *
   * So the presence of this block is NOT evidence that the reachable cleartext
   * on this object was reduced. It was not, and `apiMethods` is the wrong
   * instrument for it: `url` (#8025 — won't-fix on masking, because the URL is
   * the routing key an operator must be able to see, search, sort and edit) and
   * a legacy row's un-migrated `definition_json.headers` (#7986 —
   * `readLegacyHeaders` in `auto-enqueuer.ts` still reads them and warns) are
   * both served by `get`/`list`, which is exactly what the console requires.
   * Any set that removes them removes the admin surface with them. A survey
   * that greps this file for `enable:` and stops is measuring the wrong thing;
   * #9756's report carries the census that says so.
   *
   * Contrast the sibling `sys_http_delivery` (`['get','list']`,
   * `service-messaging`), whose narrowing is real: that table is engine-owned —
   * written only by `SqlHttpOutbox` through context-less raw-engine writes,
   * never authored — so closing its write surface costs nothing. `sys_webhook`
   * is a first-class admin authoring surface. That is the whole difference, and
   * it is why the sibling's shape could not simply be copied here.
   *
   * Pinned — the census, the no-narrowing equality, and the registration-time
   * survival of every write verb — in `sys-webhook-api-exposure.test.ts`.
   */
  enable: {
    apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'],
  },
});
