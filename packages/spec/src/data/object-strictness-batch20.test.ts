// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4001 批 20 — `data/object.zod.ts` inner-block strictness.
 *
 * The object's TOP level has been closed since #1535 (`create()`'s bespoke
 * guard) and #4519/#4522 (the schema itself). Its inner blocks were not, and
 * strictness does not recurse — so until this batch every one of them silently
 * discarded whatever the author wrote that it did not declare, behind a root
 * that rejects the same mistake one level up. That asymmetry is the reason this
 * file mattered: `object` carries the highest author volume in the repo, and an
 * author who has SEEN the top level reject a typo has every reason to read a
 * clean parse of `lifecycle: { maxAge: '30d' }` as acceptance.
 *
 * 13 of the 14 open sites are closed here. The fourteenth — `IndexSchema` — is
 * deliberately still open, and section 4 pins that decision with the evidence,
 * because a deliberately-open shape explained only in prose is indistinguishable
 * from one nobody got to, which is how the next sweep "finishes the job" and
 * breaks something.
 *
 * This file is the third of the three places each verdict is recorded (the
 * others: the JSDoc on the shape itself, and the `data/` row in
 * `docs/audits/2026-07-unknown-key-strictness-ledger.md`).
 *
 * What is pinned, and why each needs its own assertion:
 *
 *   1. THE DOOR. `.strict()` is a property of a PARSE — a strict schema nobody
 *      parses gates nothing (#4583). Asserted directly, not inferred from posture.
 *   2. EVERY closed site at its OWN path, reached through the real carrier key
 *      rather than standalone: strictness does not recurse, so a closed parent
 *      proves nothing about a nested block.
 *   3. The CURATION. Every alias/guidance entry is a CLAIM about the schema
 *      (ledger finding 18 — this campaign shipped four false ones), so each is
 *      anchored here to the sibling contract that makes it true.
 *   4. The one shape left OPEN, with the measurement that says why.
 */

import { describe, it, expect } from 'vitest';

import {
  ObjectSchema,
  ObjectAccessConfigSchema,
  LifecycleSchema,
  ObjectFieldGroupSchema,
  ObjectExternalBindingSchema,
  ObjectExtensionSchema,
  IndexSchema,
  defineObjectExtension,
} from './object.zod';
import { resolveInjectedSystemColumns } from './injected-system-columns';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

/** Reject `value` through `schema` and return its issues as a searchable string. */
function reject(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  value: unknown,
): string {
  const r = schema.safeParse(value);
  expect(r.success, `expected REJECTION, got a successful parse of ${JSON.stringify(value)}`).toBe(false);
  return JSON.stringify((r.error as { issues?: unknown })?.issues ?? r.error ?? []);
}

/** Parse `value` and fail loudly (with the issues) if it does not succeed. */
function accept(
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown; data?: unknown } },
  value: unknown,
): unknown {
  const r = schema.safeParse(value);
  expect(r.success, `expected ACCEPTANCE, got ${JSON.stringify((r.error as { issues?: unknown })?.issues ?? '')}`).toBe(true);
  return r.data;
}

/** A minimal object body that parses — every nested probe is layered onto this. */
const OBJ = {
  name: 'batch20_probe',
  label: 'Batch 20 Probe',
  fields: { name: { type: 'text', label: 'Name' } },
} as const;

/** Reject `patch` merged onto a valid object, THROUGH the object root. */
const rejectOnObject = (patch: Record<string, unknown>): string => reject(ObjectSchema, { ...OBJ, ...patch });

// ===========================================================================
// 1. The doors — a parse must exist, or none of the rest means anything
// ===========================================================================
describe('#4001 批 20 — the doors these shapes are reachable through', () => {
  it('the `object` metadata type resolves to a registered schema (the save-time 422 door)', () => {
    expect(getMetadataTypeSchema('object')).toBeDefined();
  });

  it('`ObjectSchema.create()` is a real parse door — it throws on a malformed config', () => {
    expect(() =>
      ObjectSchema.create({ name: 'batch20_probe', fields: { name: { type: 'text', label: 'N' } }, notAnObjectKey: 1 } as never),
    ).toThrow();
  });

  it('`defineObjectExtension()` is a real parse door — it throws on a malformed config', () => {
    expect(() => defineObjectExtension({ extend: 'contact', notAnExtensionKey: 1 } as never)).toThrow();
  });

  it('controls parse — these tests fail closed, they do not reject everything', () => {
    accept(ObjectSchema, OBJ);
    accept(ObjectSchema, {
      ...OBJ,
      access: { default: 'private' },
      lifecycle: { class: 'audit', retention: { maxAge: '7y' } },
      fieldGroups: [{ key: 'contact_info', label: 'Contact' }],
      external: { remoteName: 'remote_contacts', writable: true },
      userActions: { create: false, exportCsv: true },
      systemFields: { tenant: false, audit: true },
      activityMilestones: [{ field: 'stage', value: 'won', summary: 'Deal won: {name}' }],
      publicSharing: { enabled: true, allowedAudiences: ['link_only'] },
    });
    accept(ObjectExtensionSchema, { extend: 'contact', fields: {} });
  });

  it('the root itself was already closed — this batch is the level BELOW it (#1535/#4519/#4522)', () => {
    expect(rejectOnObject({ notAnObjectKey: 1 })).toContain('notAnObjectKey');
  });
});

// ===========================================================================
// 2. Every closed site, at its own path, through its real carrier
// ===========================================================================
describe('#4001 批 20 — closed sites reject unknown keys where they live', () => {
  it('`access` — the ADR-0066 D2 exposure posture', () => {
    accept(ObjectAccessConfigSchema, { default: 'private' });
    expect(reject(ObjectAccessConfigSchema, { default: 'private', notAnAccessKey: 1 })).toContain('notAnAccessKey');
    // Through the carrier, because strictness does not recurse.
    expect(rejectOnObject({ access: { default: 'private', notAnAccessKey: 1 } })).toContain('notAnAccessKey');
  });

  it('`lifecycle` — the ADR-0057 block itself', () => {
    expect(rejectOnObject({ lifecycle: { class: 'record', notALifecycleKey: 1 } })).toContain('notALifecycleKey');
  });

  it.each([
    ['retention', { class: 'audit', retention: { maxAge: '7y', notARetentionKey: 1 } }, 'notARetentionKey'],
    ['ttl', { class: 'transient', ttl: { field: 'expires_at', expireAfter: '1d', notATtlKey: 1 } }, 'notATtlKey'],
    ['storage', { class: 'telemetry', storage: { strategy: 'rotation', shards: 7, unit: 'day', notAStorageKey: 1 } }, 'notAStorageKey'],
    [
      'archive',
      { class: 'audit', retention: { maxAge: '7y' }, archive: { after: '7y', to: 'cold', notAnArchiveKey: 1 } },
      'notAnArchiveKey',
    ],
  ])('`lifecycle.%s` — the sub-block, one level below an already-closed parent', (_name, lifecycle, key) => {
    expect(rejectOnObject({ lifecycle })).toContain(key);
  });

  it('`fieldGroups[]` — the ADR-0085 group entry, inside an array', () => {
    accept(ObjectFieldGroupSchema, { key: 'billing', label: 'Billing', collapse: 'collapsed' });
    expect(rejectOnObject({ fieldGroups: [{ key: 'billing', label: 'Billing', notAGroupKey: 1 }] })).toContain('notAGroupKey');
  });

  it('`fieldGroups[]` still accepts its three DEPRECATED collapse aliases — they are declared, not tombstoned', () => {
    // ADR-0085 kept `defaultExpanded`/`collapsible`/`collapsed` as parse-time
    // aliases. Closing the shape must not turn a documented deprecation into a
    // rejection; that would be finding 18 (a schema making a false claim).
    accept(ObjectFieldGroupSchema, { key: 'g', label: 'G', defaultExpanded: false });
    accept(ObjectFieldGroupSchema, { key: 'g', label: 'G', collapsible: true, collapsed: true });
  });

  it('`external` — the ADR-0015 federated binding', () => {
    accept(ObjectExternalBindingSchema, { remoteName: 'remote_contacts', writable: true });
    expect(rejectOnObject({ external: { remoteName: 'r', notABindingKey: 1 } })).toContain('notABindingKey');
  });

  it('`userActions` — the CRUD affordance overrides', () => {
    expect(rejectOnObject({ userActions: { create: true, notAUserActionKey: 1 } })).toContain('notAUserActionKey');
  });

  it('`systemFields` — the OBJECT arm of the `false | {…}` union', () => {
    // The literal arm must keep working: closing the object arm must not make
    // the documented opt-out spelling unparseable.
    accept(ObjectSchema, { ...OBJ, systemFields: false });
    accept(ObjectSchema, { ...OBJ, systemFields: { tenant: false } });
    expect(rejectOnObject({ systemFields: { tenant: true, notASystemFieldKey: 1 } })).toContain('notASystemFieldKey');
  });

  it('⚠️ `systemFields` is the batch\'s ONE #5014 flattening — pinned honestly, including the part that does not reach the author', () => {
    // This site is a union (`z.literal(false) | {…}`), so its rejection is an
    // `invalid_union` whose OWN message is the bare "Invalid input" — the
    // curated prescription is real, but it sits one level down in
    // `issue.errors[1][0].message`, and #5014 measured renderers flattening
    // exactly that away. Every other site in this batch is a plain object and
    // surfaces its message directly (see the sibling assertions above).
    //
    // 批 18 fixed the equivalent on `submitBehavior` by converting to
    // `z.discriminatedUnion`, which is NOT available here: one arm is the
    // literal `false`, so there is no discriminant property to key on. Rather
    // than invent a mechanism inside a strictness batch, the behaviour is
    // recorded — a caveat written down is worth more than one silently carried.
    const r = ObjectSchema.safeParse({ ...OBJ, systemFields: { tenant: true, owner: false } });
    expect(r.success).toBe(false);
    const issues = (r as { error: { issues: Array<Record<string, unknown>> } }).error.issues;
    expect(issues[0].code).toBe('invalid_union');
    expect(issues[0].message, 'the top-level message the author is most likely to be shown').toBe('Invalid input');
    // The prescription IS there, nested — so the fix is a rendering/union
    // concern (#5014), not a missing curation.
    expect(JSON.stringify(issues)).toContain('ownership');
  });

  it('`activityMilestones[]` — the ADR-0052 §5b.2 milestone entry', () => {
    expect(
      rejectOnObject({ activityMilestones: [{ field: 'stage', value: 'won', summary: 'Won', notAMilestoneKey: 1 }] }),
    ).toContain('notAMilestoneKey');
  });

  it('`publicSharing` — the share-link policy, where a dropped key fails OPEN', () => {
    expect(rejectOnObject({ publicSharing: { enabled: true, notASharingKey: 1 } })).toContain('notASharingKey');
  });

  it('`ObjectExtensionSchema` — the `objectExtensions[]` entry', () => {
    accept(ObjectExtensionSchema, { extend: 'contact', priority: 300 });
    expect(reject(ObjectExtensionSchema, { extend: 'contact', notAnExtensionKey: 1 })).toContain('notAnExtensionKey');
  });
});

// ===========================================================================
// 3. The curation — every alias and guidance entry is a CLAIM (finding 18)
// ===========================================================================
describe('#4001 批 20 — curation is anchored to the sibling contract that makes it true', () => {
  it('the bare rejection already names the surface and echoes the key — curation is an upgrade, not a precondition', () => {
    const msg = rejectOnObject({ publicSharing: { enabled: true, notASharingKey: 1 } });
    expect(msg).toContain('publicSharing');
    expect(msg).toContain('notASharingKey');
  });

  describe('wrong-LAYER pointers — the key is spelled correctly, just written one level off', () => {
    it('`lifecycle.maxAge` points DOWN into `retention`, where the key really lives', () => {
      const msg = rejectOnObject({ lifecycle: { class: 'audit', maxAge: '7y' } });
      expect(msg).toContain('retention');
      // And the pointed-at spelling really does parse — a prescription that
      // does not work is worse than none (finding 18).
      accept(ObjectSchema, { ...OBJ, lifecycle: { class: 'audit', retention: { maxAge: '7y' } } });
    });

    it('`lifecycle.expireAfter` / `.field` point DOWN into `ttl`', () => {
      expect(rejectOnObject({ lifecycle: { class: 'transient', expireAfter: '1d' } })).toContain('ttl');
      expect(rejectOnObject({ lifecycle: { class: 'transient', field: 'expires_at' } })).toContain('ttl');
      accept(ObjectSchema, { ...OBJ, lifecycle: { class: 'transient', ttl: { field: 'expires_at', expireAfter: '1d' } } });
    });

    it('`lifecycle.shards`/`unit`/`strategy` point DOWN into `storage`', () => {
      for (const patch of [{ shards: 7 }, { unit: 'day' }, { strategy: 'rotation' }]) {
        expect(rejectOnObject({ lifecycle: { class: 'telemetry', ...patch } })).toContain('storage');
      }
    });

    it('`lifecycle.ttl.maxAge` points SIDEWAYS at `retention`, and says which axis each measures', () => {
      const msg = rejectOnObject({ lifecycle: { class: 'transient', ttl: { field: 'f', expireAfter: '1d', maxAge: '7d' } } });
      expect(msg).toContain('retention');
    });

    // #6631 — `lifecycle.storage.maxAge` is the third sideways pointer, and the
    // mechanism it contrasted was true on exactly one dialect. Physical rotation
    // is SQLite-only: `driver-sql` gates it behind
    // `get supportsRotation() { return this.isSqlite }` and `rotateShards` throws
    // on every other dialect (`packages/drivers/driver-sql/src/sql-driver.ts`).
    // The LifecycleService then takes its `'rotation-fallback'` leg —
    // `reap(…, 'rotation-fallback', 'created_at', windowMs, …)` in
    // `packages/objectql/src/lifecycle/lifecycle-service.ts` — which is a reap BY
    // AGE from `created_at`, precisely the mechanism the old guidance told the
    // author rotation does not use. What the author most needs to keep believing
    // still holds: the retained WINDOW is identical on every dialect. Only the
    // reclamation is not — which is what the driver's own note directly above
    // `supportsRotation` already says, and what these two surfaces now say too.
    //
    // ⛔ Scope: the qualifier, not the wording. Matched by idiom — does the text
    // name the split at all? — so a rewrite is free and dropping the caveat is
    // not. Nothing here asserts anything about what `LifecycleSchema` ACCEPTS,
    // which is unchanged (the `onlyWhen`-vs-rotation `superRefine` carries the
    // same dialect-specific reason and is deliberately left alone).
    it('`lifecycle.storage.maxAge` points SIDEWAYS at `retention` — and qualifies the mechanism it contrasts, which is SQLite-only (#6631)', () => {
      const rotating = { strategy: 'rotation', shards: 7, unit: 'day' } as const;
      const msg = rejectOnObject({ lifecycle: { class: 'telemetry', storage: { ...rotating, maxAge: '7d' } } });

      // Anti-vacuity. `strictObject` rejects an unknown key with or WITHOUT a
      // `guidance` entry, so every assertion below would pass on a deleted entry.
      // Anchor on the routing advice — the half of this message that was correct
      // all along and must survive any rewording of the other half.
      expect(msg, 'the `maxAge` guidance bullet is not being produced at all').toContain(
        'Set the window with `shards`/`unit`, or use `retention` instead of rotation.',
      );
      // …and it really is THIS key's guidance rather than something the surface
      // says to every unknown key: a sibling unknown key gets the bare rejection.
      expect(rejectOnObject({ lifecycle: { class: 'telemetry', storage: { ...rotating, notAStorageKey: 1 } } }))
        .not.toMatch(/SQLite/i);

      // The pointed-at spelling really does parse (finding 18 — a prescription
      // that does not work is worse than none).
      accept(ObjectSchema, { ...OBJ, lifecycle: { class: 'telemetry', storage: rotating, retention: { maxAge: '7d' } } });

      // The claim under test: both legs of the split are named.
      expect(msg, 'the shard DROP must be attributed to SQLite').toMatch(/SQLite/);
      expect(msg, 'and the other dialects must be told what they get instead').toMatch(/age-based reap|reaps? [^.]{0,32}by age/i);

      // The retired unconditional claim, pinned by name so it cannot come back
      // as a paraphrase of the same idea — it is false on Postgres/MySQL, where
      // the fallback leg reaps from `created_at` exactly by age.
      expect(msg).not.toContain('does not reap by age');
    });

    it("`lifecycle.storage.strategy`'s description carries the same qualifier — `(O(1) reclaim)` is a property of SQLite, not of the strategy (#6631)", () => {
      const doc = LifecycleSchema.shape.storage.unwrap().shape.strategy.description ?? '';

      // Anti-vacuity: an empty description satisfies every negative assertion
      // below, and is exactly how a pin like this rots into decoration.
      expect(doc.length, '`storage.strategy` lost its `.describe()`').toBeGreaterThan(0);
      expect(doc, 'the description no longer describes the rotation mechanism at all').toMatch(/shard/i);

      expect(doc, 'the O(1) shard DROP must be attributed to SQLite').toMatch(/SQLite/);
      expect(doc, 'and the other dialects must be told what they get instead').toMatch(/age-based|by age/i);
      expect(doc).not.toContain('rotate by DROPping the oldest shard (O(1) reclaim)');
    });

    it('`access.sharingModel` points UP — it is a real TOP-LEVEL key, so distance would never find it', () => {
      const msg = rejectOnObject({ access: { default: 'private', sharingModel: 'private' } });
      expect(msg).toContain('TOP-LEVEL');
      // The claim: `sharingModel` really is accepted one level up.
      accept(ObjectSchema, { ...OBJ, sharingModel: 'private' });
    });

    it('`publicSharing.sharingModel` distinguishes LINK sharing from PRINCIPAL sharing', () => {
      const msg = rejectOnObject({ publicSharing: { enabled: true, sharingModel: 'private' } });
      expect(msg).toContain('PRINCIPAL');
    });

    it('`systemFields.owner` points at `ownership` — the field doc above the block names a key the shape never had', () => {
      const msg = rejectOnObject({ systemFields: { tenant: true, owner: false } });
      expect(msg).toContain('ownership');
      // The claim: `ownership` is the real, enforced lever, one level up.
      accept(ObjectSchema, { ...OBJ, ownership: 'none' });
    });

    // #6365 — the wrong-key rescue used to hand out a SECOND wrong answer. It
    // said `'user'`/`'org'` "choose the principal", so an author who wanted an
    // org-owned record was sent to `ownership: 'org'` — which injects no
    // `owner_id` at all, and nothing rejects it, so every owner-keyed feature
    // (owner-scoped RLS, "My" views, owner reports, the first-admin bootstrap
    // handoff) quietly does nothing. The assertions below are anchored to the
    // injection authority rather than to the sentence, so the prescription can
    // only stay green while it still describes what really happens.
    it("`systemFields.owner`'s prescription matches the injection authority — `'org'` SKIPS `owner_id`, it does not pick a different principal (#6365)", () => {
      // The authority `applySystemFields` consumes (`resolveInjectedSystemColumns`).
      // `'org'` sits with `'none'` on the withheld side, not opposite it.
      expect(resolveInjectedSystemColumns({ ...OBJ, ownership: 'org' }).owner).toBe(false);
      expect(resolveInjectedSystemColumns({ ...OBJ, ownership: 'none' }).owner).toBe(false);
      expect(resolveInjectedSystemColumns({ ...OBJ, ownership: 'user' }).owner).toBe(true);
      expect(resolveInjectedSystemColumns(OBJ).owner, 'omitted behaves as `user`').toBe(true);

      const msg = rejectOnObject({ systemFields: { tenant: true, owner: false } });
      // …and the message says exactly that: the two skipping values are named
      // TOGETHER, and the absence is stated as an absence.
      expect(msg).toContain("`'org'` and `'none'` BOTH skip it");
      expect(msg).toContain('no `owner_id` is injected at all');
      // The retired claim, pinned by name so it cannot come back by paraphrase
      // of the same idea — `'org'` as a second *principal*.
      expect(msg).not.toContain('choose the principal');
      expect(msg).not.toContain('principal');
      // …while `'org'` and `'none'` stay visibly DISTINCT in intent, which is
      // the reason the enum carries both (the `ownership` JSDoc's own split:
      // Dataverse-style catalog vs junction table).
      expect(msg).toContain('org-wide catalog');
      expect(msg).toContain('junction/link');
      // Since #5678 a THIRD value skips `owner_id`, for a different reason than
      // the other two — the prescription has to say so, or an author reading
      // "`'org'` and `'none'` BOTH skip it" concludes those are the only two.
      expect(resolveInjectedSystemColumns({ ...OBJ, ownership: 'business_unit' }).owner).toBe(false);
      expect(msg).toContain('business_unit');
    });

    it('`systemFields.ownership` names BOTH ownership anchors — since #5677 the property governs `owning_business_unit_id` too (#6365)', () => {
      const msg = rejectOnObject({ systemFields: { tenant: true, ownership: 'none' } });
      expect(msg).toContain('TOP-LEVEL');
      expect(msg).toContain('owner_id');
      expect(msg).toContain('owning_business_unit_id');

      // The claim, against the authority: on three of the four tiers the two
      // anchors move together — injected under `'user'`/omitted, withheld under
      // `'org'`/`'none'`.
      for (const ownership of [undefined, 'user', 'org', 'none'] as const) {
        const plan = resolveInjectedSystemColumns({ ...OBJ, ownership });
        expect(plan.owningBusinessUnit, `ownership: ${String(ownership)}`).toBe(plan.owner);
      }

      // …and ADR-0117 D1's fourth tier is the one case that SPLITS them. Since
      // #5678 that split is a shape an author can actually reach, not a latent
      // engine row — which is precisely why the guidance above has to name BOTH
      // anchors rather than treating them as one lever.
      accept(ObjectSchema, { ...OBJ, ownership: 'business_unit' });
      const unitOwned = resolveInjectedSystemColumns({ ...OBJ, ownership: 'business_unit' });
      expect(unitOwned.owner).toBe(false);
      expect(unitOwned.owningBusinessUnit).toBe(true);
    });

    it('`external.allowWrites` names the DOUBLE opt-in — the datasource half and the object half', () => {
      const msg = rejectOnObject({ external: { remoteName: 'r', allowWrites: true } });
      expect(msg).toContain('writable');
      expect(msg).toContain('datasource');
      accept(ObjectExternalBindingSchema, { remoteName: 'r', writable: true });
    });

    it('`userActions.sort` names the VIEW block it belongs to — same key NAME, disjoint vocabulary', () => {
      // `ui/view.zod.ts`'s UserActionsConfigSchema declares sort/search/filter/
      // refresh/rowHeight/addRecordForm/editInline/buttons; the object block
      // declares create/import/edit/delete/exportCsv. Nothing overlaps, which
      // is exactly why an author who learned one writes it on the other.
      const msg = rejectOnObject({ userActions: { sort: false } });
      expect(msg).toContain('VIEW');
    });

    it('`userActions.clone` points at the `enable` capability block, which really does declare it', () => {
      const msg = rejectOnObject({ userActions: { clone: false } });
      expect(msg).toContain('enable');
      accept(ObjectSchema, { ...OBJ, enable: { clone: false } });
    });

    it('`fieldGroups[].fields` states the direction of the membership edge', () => {
      const msg = rejectOnObject({ fieldGroups: [{ key: 'g', label: 'G', fields: ['name'] }] });
      expect(msg).toContain('group');
      // The claim: membership really is declared on the FIELD.
      accept(ObjectSchema, {
        ...OBJ,
        fields: { name: { type: 'text', label: 'Name', group: 'g' } },
        fieldGroups: [{ key: 'g', label: 'G' }],
      });
    });

    it('`objectExtensions[].actions` says the merge has no slot for it, and names the route that does', () => {
      // `objectql/src/engine.ts` copies exactly extend/fields/label/pluralLabel/
      // description/validations/indexes/priority onto the extension def, so
      // `actions` is not "unsupported yet" — there is nowhere for it to arrive.
      const msg = reject(ObjectExtensionSchema, { extend: 'contact', actions: [] });
      expect(msg).toContain('objectName');
    });
  });

  describe('tombstones — a retired key\'s rejection carries its upgrade', () => {
    it('`fieldGroups[].visibleWhen` says it was REMOVED, not misspelled', () => {
      const msg = rejectOnObject({ fieldGroups: [{ key: 'g', label: 'G', visibleWhen: 'true' }] });
      expect(msg).toContain('ADR-0085');
    });
  });

  describe('aliases — semantic near-misses edit distance cannot reach', () => {
    it.each([
      ['userActions.export → exportCsv', { userActions: { export: true } }, 'exportCsv'],
      ['publicSharing.audiences → allowedAudiences', { publicSharing: { enabled: true, audiences: [] } }, 'allowedAudiences'],
      ['publicSharing.redact → redactFields', { publicSharing: { enabled: true, redact: [] } }, 'redactFields'],
      ['external.table → remoteName', { external: { table: 't' } }, 'remoteName'],
      ['fieldGroups[].title → label', { fieldGroups: [{ key: 'g', label: 'G', title: 'T' }] }, 'label'],
    ])('%s', (_name, patch, expected) => {
      expect(rejectOnObject(patch)).toContain(expected);
    });

    it('`objectExtensions[].object → extend` — `object` is real on a NEIGHBOURING surface, which is what makes it an alias', () => {
      expect(reject(ObjectExtensionSchema, { extend: 'contact', object: 'contact' })).toContain('extend');
    });
  });
});

// ===========================================================================
// 4. The one shape left OPEN — and the measurement that says why
// ===========================================================================
describe('#4001 批 20 — `IndexSchema` is deliberately NOT closed', () => {
  it('still strips, on purpose — do not "finish the job" without reading the JSDoc', () => {
    const parsed = accept(ObjectSchema, { ...OBJ, indexes: [{ fields: ['name'], where: "status = 'open'" }] }) as {
      indexes: Array<Record<string, unknown>>;
    };
    // The key rides in and is dropped. That IS the defect — it is pinned here
    // so the day it changes, it changes deliberately.
    expect(parsed.indexes[0].where).toBeUndefined();
    expect(parsed.indexes[0].fields).toEqual(['name']);
  });

  it('the console drift outlived BOTH spellings: `where` strips, `partial` is now retired', () => {
    // objectui `metadata-admin/EmbeddedItemEditor.tsx` → FALLBACK_SCHEMAS.index
    // publishes `where` for the partial-index predicate. The spec's key WAS
    // `partial` — until #5248 / #4943 retired it (no driver ever emitted the
    // predicate). So the editor now renders a control for a key that does not
    // exist under either spelling, which is #5247's job to delete.
    //
    // The two halves fail DIFFERENTLY, and that difference is the point:
    //   - `where` was never declared here, and the shape still `.strip()`s, so
    //     it is discarded in silence — the held-open defect above;
    //   - `partial` IS declared, as a tombstone, so it is rejected loudly with
    //     the migration prescription rather than stripped (the whole reason a
    //     non-strict schema gets a tombstone instead of a plain delete).
    const parsedWhere = accept(IndexSchema, { fields: ['name'], where: "status = 'open'" }) as Record<string, unknown>;
    expect(parsedWhere.where, 'the console spelling is silently discarded today').toBeUndefined();

    const retired = IndexSchema.safeParse({ fields: ['name'], partial: "status = 'open'" });
    expect(retired.success, '`partial` is retired, not stripped').toBe(false);
    expect(retired.error!.issues[0]!.message).toMatch(/`indexes\[\]\.partial` was removed.*Delete the key/s);
  });

  it('its SIBLINGS in the same file are closed — this is a held site, not an unwalked file', () => {
    // The distinction the ledger's Class column exists to carry: a row parked
    // at a deliberate floor looks exactly like a row nobody finished.
    expect(rejectOnObject({ lifecycle: { class: 'record', notALifecycleKey: 1 } })).toContain('notALifecycleKey');
    expect(rejectOnObject({ fieldGroups: [{ key: 'g', label: 'G', notAGroupKey: 1 }] })).toContain('notAGroupKey');
  });
});
