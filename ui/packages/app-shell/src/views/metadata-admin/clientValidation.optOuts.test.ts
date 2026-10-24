// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sharing_rule` / `translation` / `connector` — the three client-validation
 * opt-outs objectui#3561 retired, and the pins that keep them retired.
 *
 * Each of the three used to sit on `clientValidation.ts`'s "server-only" list
 * with a stated reason. Re-verified against the RESOLVED `@objectstack/spec`
 * (`17.0.0-rc.5`, what pnpm installs for the `^17.0.0-rc.5` pin), none of the
 * three reasons held:
 *
 *  - `sharing_rule` — "declared but has empty shape". It is
 *    `CriteriaSharingRuleSchema`: a `.strict()` object of nine keys.
 *  - `translation` — judged by `TranslationBundleSchema`, which is not this
 *    kind's schema. It is also not the "accepts anything" the note claimed:
 *    it is `z.record(LocaleSchema, TranslationDataSchema)` and it REJECTS a
 *    valid translation item.
 *  - `connector` — "requires an `id` field". There is no `id` key in
 *    `ConnectorSchema` at all; and the authoring shape is
 *    `DeclarativeConnectorEntrySchema`, which carries the ADR-0097 rules.
 *
 * Two kinds of test live here.
 *
 * 1. RED/GREEN per type — a draft the newly wired schema provably rejects, and
 *    a valid draft that passes. The red cases are chosen so that reverting the
 *    wiring (or naming the schema the stale note named) turns them green-in-
 *    the-wrong-way: for `connector` every red case is one `ConnectorSchema`
 *    ACCEPTS, so pointing the loader at the base schema fails these and nothing
 *    else would have noticed.
 *
 * 2. BINDING PARITY — the structural safeguard against the wrong-schema class
 *    this file has already paid for twice (`email_template`, then these three).
 *    See the block comment above those tests for why parity is asserted
 *    structurally rather than by object identity: it is a measured property of
 *    how the spec package is bundled, not a preference.
 */

import { describe, it, expect } from 'vitest';
import { arrayElementSchema } from '@object-ui/test-support';
import { validateMetadataDraft, hasClientValidator } from './clientValidation';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A sharing rule that parses clean on the resolved spec. */
const SHARING_RULE: Record<string, unknown> = {
  name: 'west_accounts',
  label: 'West accounts',
  object: 'account',
  active: true,
  accessLevel: 'read',
  sharedWith: { type: 'position', value: 'sales_west' },
  type: 'criteria',
  condition: 'region == "west"',
};

/** A translation item that parses clean on the resolved spec. */
const TRANSLATION: Record<string, unknown> = {
  name: 'zh_CN',
  locale: 'zh-CN',
  label: '简体中文',
  objects: {},
};

/** A connector catalog descriptor — no `provider`, so no ADR-0097 rule fires. */
const CONNECTOR: Record<string, unknown> = {
  name: 'stripe_api',
  label: 'Stripe',
  type: 'saas',
};

// ── sharing_rule ────────────────────────────────────────────────────────────

describe('validateMetadataDraft("sharing_rule") — objectui#3561', () => {
  it('accepts a valid rule (the stale note claimed an empty shape)', async () => {
    const res = await validateMetadataDraft('sharing_rule', SHARING_RULE);
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('rejects an unknown key — the shape is strict, so a typo is caught now', async () => {
    const res = await validateMetadataDraft('sharing_rule', {
      ...SHARING_RULE,
      critera: 'region == "west"',
    });
    expect(res.ok).toBe(false);
    // The spec ships a curated unknown-key message for this shape; assert the
    // offending key is named rather than pinning the whole sentence.
    expect(JSON.stringify(res.issues)).toContain('critera');
  });

  it('rejects an accessLevel outside the declared enum', async () => {
    const res = await validateMetadataDraft('sharing_rule', {
      ...SHARING_RULE,
      accessLevel: 'superuser',
    });
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toContain('accessLevel');
  });

  /**
   * The author-shape-only boundary (`AUTHOR_SHAPE_ONLY_TYPES`).
   *
   * `SharingRuleSchema` is `.strict()`, so it may judge an AUTHORED draft and
   * must not judge a STORED one — doing so would make this client stricter than
   * the server (objectstack#5316).
   *
   * ⚠️ The REASON moved, and the pins below moved with it (objectui#6982). The
   * boundary was originally justified by the seven ADR-0010 envelope keys going
   * undeclared on this schema. That repair LANDED: on the resolved spec 17.2.0
   * all seven are declared. The key that keeps the boundary load-bearing is a
   * different one — `_diagnostics`, the READ DECORATION the metadata read path
   * stamps on every served item, which the spec deliberately does NOT allowlist
   * the way it allowlists the envelope (`kernel/metadata-read-decorations.ts`:
   * a served body "is therefore NOT a valid input to the schema that produced
   * it until these are removed").
   *
   * ⛔ An envelope-only pin is TOOTHLESS now — a `_packageId`-stamped body is
   * accepted by this schema on both doors, so it cannot tell "the opt-out is
   * in place" from "the opt-out was deleted". Measured: with `sharing_rule`
   * removed from the set, that pin stays GREEN. Two assertions here do go red,
   * and they answer different questions — `hasClientValidator(..., 'edit')`
   * catches the deletion, while the decoration pin below is the one that says
   * WHY the door must stay shut. Keep both; do not simplify either back to
   * `_packageId`.
   */
  it('does not gate the edit door — a stored body may carry `_packageId`', async () => {
    const stored = { ...SHARING_RULE, _packageId: 'crm_pkg' };

    // AUTHORING DOOR — INVERTED on the @objectstack/spec 17.0.0-rc.6 bump, and
    // the inversion is upstream convergence rather than a regression here.
    //
    // This assertion used to read `expect(create.ok).toBe(false)`, on the stated
    // premise that `SharingRuleSchema` "declares NONE of the seven ADR-0010
    // envelope keys" — so a stamped `_packageId` reached the strict object as an
    // unrecognized key. rc.6 made the schema declare all seven (`_lock`,
    // `_lockDocsUrl`, `_lockReason`, `_lockSource`, `_packageId`,
    // `_packageVersion`, `_provenance`), the way `ActionSchema` has since rc.2.
    // A stamped body is therefore legal input now, and the create door accepts
    // it — which is the behaviour the envelope was always supposed to have.
    //
    // Pinned as accept, with the strictness it does NOT cost asserted right
    // below: the boundary this file guards is "does the client stay no stricter
    // than the server", and that still holds.
    const create = await validateMetadataDraft('sharing_rule', stored, undefined, {
      mode: 'create',
    });
    expect(create.ok).toBe(true);

    // …and the door is still a door. A genuinely unknown key is still refused,
    // so the assertion above pins "the envelope became legal", not "the schema
    // stopped being strict" — without this, reverting the schema to a permissive
    // object would leave the pin above green.
    const bogus = await validateMetadataDraft(
      'sharing_rule',
      { ...SHARING_RULE, notAKeyAnySchemaDeclares: 1 },
      undefined,
      { mode: 'create' },
    );
    expect(bogus.ok).toBe(false);

    // Edit door: no client gate, so the server stays authoritative and the
    // client cannot report a stored body as broken. Unchanged by rc.6.
    //
    // ⚠️ Green on this body alone proves nothing about the opt-out — see the
    // decoration pin below, which is the assertion that actually fails if
    // `sharing_rule` leaves `AUTHOR_SHAPE_ONLY_TYPES`.
    const edit = await validateMetadataDraft('sharing_rule', stored, undefined, { mode: 'edit' });
    expect(edit.ok).toBe(true);
    expect(edit.issues).toEqual([]);
  });

  /**
   * THE LOAD-BEARING PIN (objectui#6982). Deleting `sharing_rule` from
   * `AUTHOR_SHAPE_ONLY_TYPES` turns this red.
   *
   * `_diagnostics` is not a hypothetical key. Measured on the real read path
   * (objectstack protocol over a real engine: save a rule, then read it back),
   * every served body carries it, and `ResourceEditPage` assembles its edit
   * draft as `{...layered.effective, ...client.getDraft().item}` — the second
   * of which is decorated — and strips nothing. So a sharing rule with a
   * PENDING DRAFT reaches this gate carrying `_diagnostics`.
   *
   *   with the opt-out  → no gate runs, the server stays authoritative  (here)
   *   without it        → `unrecognized_keys` at the ROOT, on a body the
   *                       server accepts and re-persists byte-identical
   *
   * The root path matters: `validateMetadataDraft`'s `serverSchema.required`
   * root-cure only suppresses ABSENT top-level fields (`path.length === 1`), so
   * it cannot take this back out. That is why the boundary is the remedy and a
   * tolerant fallback is not.
   */
  it('does not gate the edit door — a served body carries `_diagnostics`', async () => {
    // The shape `decorateMetadataItem` attaches (a clean verdict is still a
    // verdict: the key is present either way).
    const served = {
      ...SHARING_RULE,
      _packageId: 'crm_pkg',
      _diagnostics: { valid: true, errors: [], warnings: [] },
    };

    const edit = await validateMetadataDraft('sharing_rule', served, undefined, { mode: 'edit' });
    expect(edit.issues, JSON.stringify(edit.issues)).toEqual([]);
    expect(edit.ok).toBe(true);

    // …and the counter-measurement that makes the line above load-bearing:
    // the SAME body on the door that does gate is refused, for exactly the key
    // this pin is about. Without this, a schema that had quietly stopped being
    // strict would leave the assertion above green and say nothing.
    const create = await validateMetadataDraft('sharing_rule', served, undefined, {
      mode: 'create',
    });
    expect(create.ok).toBe(false);
    expect(create.issues.map((i) => i.message).join(' ')).toContain('_diagnostics');
  });

  it('reports the edit door as having NO client validator', () => {
    // Load-bearing: `ResourceEditPage` reads this to decide whether the banner's
    // errors come from live client issues or from the server's `_diagnostics`.
    // If this answered `true` for the edit door, an item whose client gate never
    // runs would render as clean and the server's errors would be suppressed.
    expect(hasClientValidator('sharing_rule', 'create')).toBe(true);
    expect(hasClientValidator('sharing_rule', 'edit')).toBe(false);
    // Every other wired type gates both doors.
    expect(hasClientValidator('translation', 'edit')).toBe(true);
    expect(hasClientValidator('connector', 'edit')).toBe(true);
    expect(hasClientValidator('webhook', 'edit')).toBe(true);
  });
});

// ── translation ─────────────────────────────────────────────────────────────

describe('validateMetadataDraft("translation") — objectui#3561', () => {
  it('accepts a valid translation item', async () => {
    const res = await validateMetadataDraft('translation', TRANSLATION);
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('rejects an unknown key with the spec-authored suggestion', async () => {
    const res = await validateMetadataDraft('translation', { ...TRANSLATION, objectz: {} });
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res.issues)).toContain('objectz');
  });

  it('rejects a mistyped translation-data block', async () => {
    const res = await validateMetadataDraft('translation', { ...TRANSLATION, objects: 'nope' });
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toContain('objects');
  });

  it('rejects a nested translation-data block of the wrong type', async () => {
    const res = await validateMetadataDraft('translation', {
      ...TRANSLATION,
      objects: { account: { fields: 'nope' } },
    });
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toContain('objects.account.fields');
  });

  /**
   * The WRONG-SCHEMA pin. `TranslationBundleSchema` — the schema the retired
   * note named — is `z.record(LocaleSchema, TranslationDataSchema)`, a map keyed
   * by locale. It does not merely fail to catch mistakes: it rejects the valid
   * item above, reporting `expected object, received string` on the item's own
   * scalar keys. Had the loader been pointed at it on the strength of the stale
   * note, every valid translation draft would have been flagged.
   *
   * This asserts the CURRENT wiring does not behave that way, so swapping the
   * loader to the bundle schema turns this red.
   */
  it('is not judged by the bundle schema — a valid item is not flagged', async () => {
    const res = await validateMetadataDraft('translation', TRANSLATION);
    expect(res.issues.map((i) => i.path)).not.toContain('locale');
    expect(res.issues.map((i) => i.path)).not.toContain('label');
    expect(res.ok).toBe(true);
  });

  it('accepts a stored body carrying the ADR-0010 envelope on the edit door', async () => {
    // Unlike `sharing_rule`, this shape declares all seven envelope keys, which
    // is why it gates both doors.
    const res = await validateMetadataDraft(
      'translation',
      { ...TRANSLATION, _packageId: 'crm_pkg', _lock: 'no-delete' },
      undefined,
      { mode: 'edit' },
    );
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });
});

// ── connector ───────────────────────────────────────────────────────────────

describe('validateMetadataDraft("connector") — objectui#3561', () => {
  it('accepts a catalog descriptor (no `id` is required — the stale blocker)', async () => {
    const res = await validateMetadataDraft('connector', CONNECTOR);
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('accepts a provider-bound instance that references its credentials', async () => {
    const res = await validateMetadataDraft('connector', {
      ...CONNECTOR,
      provider: 'stripe',
      auth: { type: 'bearer', credentialRef: 'stripe_token' },
    });
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  /**
   * ── The ADR-0097 rules, i.e. why `ConnectorSchema` is the wrong target ──
   *
   * Every draft below is ACCEPTED by the bare `ConnectorSchema` and REJECTED by
   * `DeclarativeConnectorEntrySchema`. That asymmetry is the entire reason the
   * loader names the entry schema, and these four cases are the only thing that
   * can detect a swap back to the base: the base's shape check passes them all,
   * so no other assertion in this repo would go red.
   *
   * The inline-credential case is the security-shaped one — ADR-0097 §3 requires
   * credentials to be REFERENCES on a provider-bound instance, never authored
   * literals. Before this wiring the author learned that only from a save
   * round-trip, having already typed the secret into the editor.
   */
  it('rejects `providerConfig` without a `provider`', async () => {
    const res = await validateMetadataDraft('connector', {
      ...CONNECTOR,
      providerConfig: { model: 'gpt-4' },
    });
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toContain('providerConfig');
  });

  it('rejects `auth` without a `provider`', async () => {
    const res = await validateMetadataDraft('connector', {
      ...CONNECTOR,
      auth: { type: 'none' },
    });
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toContain('auth');
  });

  it('rejects a provider-bound instance that inlines a secret (ADR-0097 §3)', async () => {
    const res = await validateMetadataDraft('connector', {
      ...CONNECTOR,
      provider: 'stripe',
      authentication: { type: 'bearer', token: 'sk_live_NOT_A_REFERENCE' },
    });
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toContain('authentication');
    expect(JSON.stringify(res.issues)).toContain('credentialRef');
  });

  it('rejects a provider-bound instance that authors `actions` (ADR-0097 §5)', async () => {
    const res = await validateMetadataDraft('connector', {
      ...CONNECTOR,
      provider: 'stripe',
      actions: [{ key: 'charge', label: 'Charge' }],
    });
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toContain('actions');
  });
});

// ── Binding parity ──────────────────────────────────────────────────────────

/**
 * ── The structural safeguard against the wrong-schema class ──
 *
 * `email_template` was checked against a schema the platform does not bind, and
 * so were all three types above. The kill for that class is to assert, from the
 * resolved spec itself, that each loader names the schema the platform binds for
 * that kind — so a spec-side move shows up as a red test rather than as
 * validation that silently judges the wrong contract.
 *
 * WHY STRUCTURAL AND NOT IDENTITY. Object identity is unusable here, and that is
 * measured rather than assumed: `@objectstack/spec` publishes each subpath as
 * its own bundle, so a schema reachable from two subpaths is two distinct
 * instances. `ObjectStackSchema.shape.webhooks`'s element — the already-wired
 * `webhook` precedent, whose binding nobody disputes — is `!==` the
 * `WebhookSchema` exported from `@objectstack/spec/automation`. An identity
 * assertion would therefore fail for every type including the correct ones, which
 * is why parity is asserted over the shape key set and the strictness flag.
 *
 * WHICH AUTHORITY, PER TYPE — the resolved version decides, not framework main:
 *
 *  - `translation` is a registered metadata KIND, so the kernel registry answers
 *    directly: `getMetadataTypeSchema('translation')`.
 *  - `sharing_rule` and `connector` are NOT kinds on the resolved version —
 *    `getMetadataTypeSchema` answers `undefined` for both, and the
 *    `UNREGISTERED_KIND_SCHEMAS` map that binds them on framework `origin/main`
 *    (#6245) is not in `17.0.0-rc.5`. On the resolved version the authority is
 *    the stack schema, which is where these two are declared: `sharingRules:
 *    z.array(SharingRuleSchema)` and `connectors:
 *    z.array(DeclarativeConnectorEntrySchema)`. When a later spec release brings
 *    the registry binding, these assertions keep holding — #6245 binds each entry
 *    to "the SAME schema its stack collection is validated against".
 */
describe('binding parity — the wired schema is the one the platform binds', () => {
  type ZodInternals = {
    shape?: Record<string, unknown>;
    _zod?: { def?: { type?: string; catchall?: { _zod?: { def?: { type?: string } } } } };
  };

  const shapeKeys = (s: unknown): string[] => Object.keys((s as ZodInternals)?.shape ?? {}).sort();
  type ZodLikeSafeParse = {
    safeParse: (v: unknown) => {
      success: boolean;
      error?: { issues: Array<{ code: string; path: PropertyKey[] }> };
    };
  };
  const isStrict = (s: unknown): boolean =>
    (s as ZodInternals)?._zod?.def?.catchall?._zod?.def?.type === 'never';

  /**
   * The element schema of a `z.array(X)` collection on the stack schema —
   * `@object-ui/test-support`'s reader, not a fourth local copy of the walk
   * (objectui#5872 class (2)). This file carried the strictest of the three
   * censused spellings, and the strictness is what the shared reader adopted:
   * `undefined` for a node that is not an array, so the
   * `expect(element, '… must be an array collection').toBeDefined()` assertions
   * below stay discriminating instead of passing for every input.
   *
   * The one limb NOT carried over is this copy's second unwrap of the element
   * itself. Measured on the installed pin: of the 35 array members of
   * `ObjectStackSchema`, ZERO have a wrapped element, so the limb never fired;
   * and it cannot be added safely, because `zod@4.4.3` puts `unwrap()` on
   * `ZodArray` itself, so "unwrap the element too" would descend into an
   * array-of-arrays and answer with the wrong entry shape. A wrapped element
   * now fails loudly at the `shapeKeys` comparison instead.
   */

  it('translation → the schema the kernel metadata-type registry binds', async () => {
    const { getMetadataTypeSchema } = await import('@objectstack/spec/kernel');
    const { TranslationItemSchema } = await import('@objectstack/spec/system');
    const bound = getMetadataTypeSchema('translation');
    expect(bound, 'translation must be a registered metadata kind').toBeDefined();
    expect(shapeKeys(bound)).toEqual(shapeKeys(TranslationItemSchema));
    expect(isStrict(bound)).toBe(isStrict(TranslationItemSchema));
    // And it is emphatically NOT the bundle shape the retired note named.
    const { TranslationBundleSchema } = await import('@objectstack/spec/system');
    expect(shapeKeys(bound)).not.toEqual(shapeKeys(TranslationBundleSchema));
  });

  it('sharing_rule → the schema `ObjectStackSchema.sharingRules` binds', async () => {
    const { ObjectStackSchema } = await import('@objectstack/spec');
    const { SharingRuleSchema } = await import('@objectstack/spec/security');
    const element = arrayElementSchema(ObjectStackSchema.shape.sharingRules);
    expect(element, 'sharingRules must be an array collection').toBeDefined();
    expect(shapeKeys(element)).toEqual(shapeKeys(SharingRuleSchema));
    expect(isStrict(element)).toBe(isStrict(SharingRuleSchema));
    // The retired note's premise, pinned so it cannot quietly become true again.
    expect(shapeKeys(SharingRuleSchema).length).toBeGreaterThan(0);
    expect(isStrict(SharingRuleSchema)).toBe(true);
  });

  it('connector → the schema `ObjectStackSchema.connectors` binds', async () => {
    const { ObjectStackSchema } = await import('@objectstack/spec');
    const { DeclarativeConnectorEntrySchema, ConnectorSchema } = await import(
      '@objectstack/spec/integration'
    );
    const element = arrayElementSchema(ObjectStackSchema.shape.connectors);
    expect(element, 'connectors must be an array collection').toBeDefined();
    expect(shapeKeys(element)).toEqual(shapeKeys(DeclarativeConnectorEntrySchema));

    // The two connector schemas share a shape, so shape parity alone cannot tell
    // them apart — the ADR-0097 rules are a REFINEMENT, not keys. So assert the
    // refinement by what it DOES: a draft the base accepts, the entry schema and
    // the stack element both refuse, on the refined path. This is what makes the
    // parity assertion above meaningful rather than vacuous.
    //
    // Behavioural on purpose, not a count of `_zod.def.checks`: that probe reads
    // HOW the refinement is attached, and it reads 0 the moment the carrier is
    // wrapped in a `z.preprocess` pipe (whose def has no `checks`) even though
    // the refusals still run inside it — at which point the element-vs-entry
    // comparison degrades to 0 === 0 (objectui#10211).
    const descriptorWithProviderConfig = { ...CONNECTOR, providerConfig: { model: 'gpt-4' } };
    const refusedPaths = (s: unknown): string[] => {
      const res = (s as ZodLikeSafeParse).safeParse(descriptorWithProviderConfig);
      expect(res.success, 'the refinement must refuse this draft').toBe(false);
      return (res.error?.issues ?? [])
        .filter((i) => i.code === 'custom')
        .map((i) => i.path.map(String).join('.'));
    };
    expect(shapeKeys(ConnectorSchema)).toEqual(shapeKeys(DeclarativeConnectorEntrySchema));
    expect(
      (ConnectorSchema as unknown as ZodLikeSafeParse).safeParse(descriptorWithProviderConfig).success,
      'the base must accept the draft, or the refusal below proves nothing about the refinement',
    ).toBe(true);
    expect(refusedPaths(DeclarativeConnectorEntrySchema)).toContain('providerConfig');
    expect(refusedPaths(element)).toContain('providerConfig');

    // And the retired note's premise: there is no required `id` key.
    expect(shapeKeys(ConnectorSchema)).not.toContain('id');
  });
});
