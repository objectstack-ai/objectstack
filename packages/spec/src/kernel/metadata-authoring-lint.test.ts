// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the generalized unknown-authoring-key walker (#3786).
 *
 * Three jobs: prove the walk still fires on the drifts that motivated #4148
 * (object/field), prove the NEW coverage really spans the non-strict metadata
 * population instead of sampling it, and prove the lint's posture agrees with
 * each schema's own — silent where the parse is loud (strict) or lenient
 * (passthrough), loud only where the parse is silent (strip).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  lintUnknownAuthoringKeys,
  lintUnknownKeysAgainstSchema,
  lintUnknownStackKeys,
  listLintableAuthoringCollections,
} from './metadata-authoring-lint';
import { STACK_KEY_GUIDANCE, STACK_RUNTIME_MEMBERS } from '../data/authoring-key-lint';
import { PLURAL_TO_SINGULAR } from '../shared/metadata-collection.zod';
import { ObjectSchema } from '../data/object.zod';
import { PageSchema } from '../ui/page.zod';
import { FieldSchema, SelectOptionSchema } from '../data/field.zod';
import { AgentSchema } from '../ai/agent.zod';
import { ObjectStackDefinitionSchema, defineStack } from '../stack.zod';
import { getMetadataTypeSchema } from './metadata-type-schemas';

const lintables = listLintableAuthoringCollections(ObjectStackDefinitionSchema);
const lintableTypes = new Set(lintables.map((l) => l.type));

/**
 * The walker reads every collection's posture from the schema the PARSE applies
 * to a collection entry, which only `ObjectStackDefinitionSchema` knows — so it
 * is injected, exactly like `lintUnknownStackKeys` below (#10039). Bound once
 * here; the injection contract itself is pinned by the type, and by the
 * `defineStack` fixture in the `#10039` block at the end of this file.
 */
const lintAuthoring = (raw: unknown) => lintUnknownAuthoringKeys(raw, ObjectStackDefinitionSchema);

/**
 * The #10039 repro entry, kept in the shape the card measured it in: an
 * otherwise VALID view container (it has `list`, so nothing else is wrong with
 * the fixture) carrying one undeclared key. Shared by the posture test above
 * and the one-voice block at the end of the file, so both are talking about the
 * same authored key.
 */
const VIEW_ENTRY = { name: 'v1', object: 'task', list: { columns: ['title'] }, bogusViewKey: 1 };

describe('coverage derivation (#3786 — no third hand-written list)', () => {
  it('spans the non-strict population, not a sample', () => {
    // #4148 covered object+field: 2 surfaces. The point of this walker is the
    // rest. If the derivation regresses to a handful, the "evidence base" for
    // the #4001 strict tiers quietly becomes a sample again.
    //
    // This floor RATCHETS DOWN as #4001 advances — every graduation moves a type
    // from "lint warns" to "parse rejects", which is the campaign succeeding, not
    // coverage rotting. Lower it only after confirming the shrink against the
    // list below; that confirmation is the whole point of pinning a number here.
    // 15 → 13 when `seed` + `doc` graduated (#4001 registered-types batch);
    // 13 → 12 when `object` closed on the parse path; 12 → 6 when the seven
    // small registered types closed in one batch; 6 → 3 when `mapping`, `agent`
    // and `page` closed. Note what did NOT shrink with `object`: its 71 NESTED
    // strip sites still report, because the walk no longer gates a whole
    // collection on its root's posture — so this number tracks ROOTS that
    // graduated, not coverage lost.
    //
    // Lowering this number is only honest if each departed root is now REJECTED
    // by the parse rather than merely unwatched. That was checked directly for
    // this shrink — `agent.zzz`, `page.zzz`, and the nested
    // `page.regions[0].zzz` all `safeParse` to failure — and the check is worth
    // repeating on the next one, because a broken walk and a successful
    // graduation shrink this count identically.
    // 3 → 2 when `dashboard` closed, 2 → 1 when `action` did; in each case the
    // departed root was confirmed rejected by the parse before the number moved.
    //
    // #10039 is the one shrink on this list that was NOT a graduation: `view`
    // had already been rejected by the parse all along, and the count was wrong
    // rather than the campaign advancing. See the block below — `view` moves
    // into the excluded list, `connectors` is the honest remainder, and the
    // count stays 1 because the number was never counting what it claimed to.
    expect(lintables.length).toBeGreaterThanOrEqual(1);
    // `connectors` is the LAST open root. When it closes, this layer has
    // nothing left to warn about at a ROOT. That is the campaign finishing, not
    // the lint breaking. At that point change the floor to 0 and assert the
    // empty set DELIBERATELY — do not delete this test, because an empty result
    // that nobody chose is indistinguishable from a derivation that broke.
    for (const expected of ['connector']) {
      expect(lintableTypes, `expected '${expected}' to be lint-covered`).toContain(expected);
    }
  });

  it('reads posture from the schema the PARSE applies, not the type registry (#10039)', () => {
    // `view` was counted as lint-covered because the posture came from
    // `getMetadataTypeSchema('view')` — `ViewMetadataSchema`, the strip-mode
    // UNION over persisted view BODIES. What `defineStack` actually applies to
    // a `views:` entry is `ObjectStackDefinitionSchema.shape.views`'s element:
    // `ViewSchema`, the `.strict()` defineView CONTAINER. Two different schemas
    // for two different questions, and the lint was asking the wrong one — so
    // it promised "dropped at load" for a key the parse then REFUSED.
    //
    // Both halves are asserted, because "not covered" alone would also be
    // produced by a walker that simply broke.
    expect(lintableTypes, 'the strict view CONTAINER is what a stack entry is parsed by')
      .not.toContain('view');
    const registrySchema = getMetadataTypeSchema('view');
    expect(registrySchema, 'the registry entry itself must still exist — only the lint stopped reading it')
      .toBeDefined();
    // The registry schema is still STRIP-mode, which is what makes reading it
    // wrong rather than merely redundant: run the walk against it explicitly
    // and the old contradicting finding comes straight back. This keeps the
    // card's evidence alive — if `ViewMetadataSchema` ever goes strict, this
    // assertion fails and the exclusion above needs restating, rather than
    // quietly becoming true for a second, unrelated reason.
    expect(
      lintUnknownKeysAgainstSchema(registrySchema, VIEW_ENTRY, 'view', 'views.v1').map((f) => f.path),
      'ViewMetadataSchema still strips — the divergence this card fixed is real, not stale',
    ).toEqual(['views.v1.bogusViewKey']);
  });

  it('excludes the strict types — the parse is already loud there', () => {
    // This list GROWS as the #4001 tier programme hardens schemas, and each
    // graduation shrinks the lint's coverage by design — the parse takes over.
    // `app` graduated mid-flight (#4165) while this very test was in review:
    // the derivation adapted on its own, and the pinned expectation above is
    // what forced a human to confirm the shrink was a graduation, not a bug.
    // It did that job again for `hook` + `datasource` (#4001 data step): the
    // count fell 16 → 14 and the pin above failed until both were confirmed
    // graduations and moved into this list. `hook` also had to leave the
    // pinned-coverage list above, where it had been an expected lint target.
    // It did it a third time for `seed` + `doc`, the first two conversions built
    // on `strictObject` — which also proved the posture derivation reads a
    // helper-built `.strict()` exactly like a hand-wired one.
    for (const strict of [
      'flow', 'permission', 'position', 'tool', 'app', 'hook', 'datasource', 'seed', 'doc',
      'report', 'dataset', 'email_template', 'skill', 'job', 'book',
      // `object` graduated by closing its PARSE path — #1535 had only ever
      // guarded `create()`. Its nested strip sites still report; only the root
      // moved from warn to reject.
      'object',
      // `view` belongs here for a DIFFERENT reason than the rest, and the
      // difference is the whole of #10039: the type registry's `view` schema
      // (`ViewMetadataSchema`, persisted bodies) is still a strip-mode union.
      // What is strict is `ViewSchema`, the defineView container that
      // `ObjectStackDefinitionSchema.shape.views` holds — the schema a stack
      // entry is actually parsed by. `view` was never a graduation waiting to
      // happen; it was a posture read off the wrong schema.
      'view',
    ]) {
      expect(lintableTypes, `'${strict}' is .strict(); the lint must not double-report`).not.toContain(strict);
    }
  });

  it('every lintable entry is a real collection with a real schema', () => {
    for (const { collection, type } of lintables) {
      expect(PLURAL_TO_SINGULAR[collection]).toBe(type);
      expect(getMetadataTypeSchema(type), `no schema for '${type}'`).toBeDefined();
    }
  });

  it('every lintable collection actually produces a finding for a bogus key', () => {
    // The derivation says these are covered; this proves the walk agrees, per
    // collection — the assertion that keeps "covered" from becoming a claim.
    for (const { collection, type } of lintables) {
      const stack = { [collection]: [{ name: 'probe_item', zzz_bogus_key: 1 }] };
      const findings = lintAuthoring(stack);
      const hit = findings.find((f) => f.key === 'zzz_bogus_key');
      expect(hit, `${collection} (${type}) swallowed an unknown key`).toBeDefined();
      expect(hit!.surface).toBe(type);
      expect(hit!.path).toBe(`${collection}.probe_item.zzz_bogus_key`);
    }
  });

  it('a strict collection stays silent — the parse owns that failure', () => {
    const findings = lintAuthoring({
      flows: [{ name: 'f1', zzz_bogus_key: 1 }],
    });
    expect(findings).toEqual([]);
  });
});

describe('the #4148 behaviours survive the generalization', () => {
  const stackWith = (obj: Record<string, unknown>, field: Record<string, unknown>) => ({
    objects: [
      { name: 'crm_case', label: 'Case', fields: { owner: { label: 'Owner', type: 'text', ...field } }, ...obj },
    ],
  });

  it('is silent on a clean stack', () => {
    expect(lintAuthoring(stackWith({}, {}))).toEqual([]);
  });

  it('hands the retired field keys to the parse, guidance and suppression intact', () => {
    // `field` closed in #4001 batch 6b, so the lint no longer reaches it and
    // `FieldSchema` carries `FIELD_KEY_GUIDANCE` directly. What this test has
    // always really been protecting is the SUPPRESSION: `pii` is three edits
    // from `min`, so a bare edit-distance suggester answers a
    // personally-identifiable-information key with "did you mean `min`?" —
    // confident, wrong, about an unrelated concept. Closing the shape without
    // reusing the table reintroduced exactly that, which is how the schema came
    // to derive from it. Assert the property, wherever it now lives.
    expect(lintAuthoring(stackWith({}, { pii: true }))).toEqual([]);

    const parsed = FieldSchema.safeParse({ type: 'text', pii: true });
    expect(parsed.success).toBe(false);
    const message = parsed.success ? '' : parsed.error.issues.map((i) => i.message).join(' ');
    expect(message).toContain('pruned in 2026-06');
    expect(message).not.toContain('Did you mean');
  });

  it('no longer WARNS on a renamed object key — the parse rejects it now', () => {
    // `object` closed on the parse path (#4001), so a top-level unknown key is a
    // hard error rather than a warning, and warning too would double-report.
    // The rename itself did not get quieter, it got louder: the same suggestion
    // now arrives as a rejection.
    expect(lintAuthoring(stackWith({ capabilities: { trackHistory: true } }, {})))
      .toEqual([]);

    const parsed = ObjectSchema.safeParse({
      name: 'crm_case', label: 'Case', fields: {}, capabilities: { trackHistory: true },
    });
    expect(parsed.success).toBe(false);
    const message = parsed.success ? '' : parsed.error.issues[0].message;
    expect(message).toContain('`capabilities`');
    expect(message).toContain('`enable`');
  });

  it('reports across collections in one walk, with per-type surfaces', () => {
    // `page`/`agent` (6a), `field` (6b) and `dashboard` (6c) used to appear
    // here; each closed, so the parse rejects and the lint correctly stays
    // quiet — the hand-off this whole layer was built to make.
    //
    // The object-side fixture was `userActions` until #4001 批 20 closed it,
    // then `indexes[]` — the batch's deliberately-held site — until the hold's
    // evidence was spent (objectui#4772) and it closed too, finishing the file
    // at 14 of 14. `object` therefore no longer reports ANYWHERE: the walk
    // still visits the collection (which is what this fixture keeps proving —
    // a closed collection must not contaminate an open one's findings), and
    // the index key is REJECTED at the parse instead (asserted below, so a
    // broken walk cannot hide behind the same empty result).
    //
    // The open-collection fixture was `views` until #10039 established that the
    // parse had been REFUSING those keys all along; `connectors` is the honest
    // remainder, and it is carried here alongside two closed collections so the
    // "must not contaminate" property still has something to be true about.
    const findings = lintAuthoring({
      objects: [{ name: 'a', label: 'A', indexes: [{ fields: ['a'], zzz: 1 }] }],
      views: [{ name: 'v', object: 'a', zzz: 1 }],
      connectors: [{ name: 'c', zzz: 1 }],
    });
    // NOT deduped. This assertion used to run through a `new Set(...)` because
    // the walk emitted every union-root finding twice (#10039) — a mask over a
    // defect, inside the test that would otherwise have caught it. The raw list
    // is asserted now, so a re-introduced duplicate fails here rather than
    // being absorbed on the way to the assertion.
    expect(findings.map((f) => `${f.surface}:${f.path}`).sort()).toEqual([
      'connector:connectors.c.zzz',
    ]);
    // The hand-off half for the view fixture: not unreported — rejected, by the
    // strict container that made the old warning a contradiction.
    expect(ObjectStackDefinitionSchema.safeParse({
      manifest: { id: 'com.example.t', version: '1.0.0', type: 'app', name: 'T' },
      views: [{ name: 'v', object: 'a', list: { columns: ['title'] }, zzz: 1 }],
    }).success).toBe(false);
    // The hand-off half for the object fixture: not unreported — rejected.
    expect(ObjectSchema.safeParse({
      name: 'a', label: 'A', fields: { x: { type: 'text', label: 'X' } },
      indexes: [{ fields: ['a'], zzz: 1 }],
    }).success).toBe(false);
  });

  it('hands off to the parse for the roots that closed', () => {
    // The other half of the assertion above, and the one that makes lowering
    // the coverage floor honest: these keys are not unreported, they are
    // REJECTED. A broken walk would produce the same empty lint result.
    expect(lintAuthoring({
      pages: [{ name: 'p', label: 'P', zzz: 1 }],
      agents: [{ name: 'ag', zzz: 1 }],
    })).toEqual([]);
    expect(PageSchema.safeParse({ name: 'p', label: 'P', zzz: 1 }).success).toBe(false);
    expect(AgentSchema.safeParse({
      name: 'ag', label: 'A', role: 'r', instructions: 'i', zzz: 1,
    }).success).toBe(false);
  });

  it('survives malformed input rather than throwing', () => {
    for (const junk of [undefined, null, 42, 'x', {}, { objects: 'nope' }, { pages: [null, 7] }]) {
      expect(() => lintAuthoring(junk)).not.toThrow();
    }
    expect(lintAuthoring({ objects: [{ name: 'a', fields: 'nope' }] })).toEqual([]);
  });

  it('ignores the underscore-prefixed packaging channel everywhere', () => {
    const findings = lintAuthoring({
      objects: [{ name: 'a', _packageId: 'p', fields: { x: { type: 'text', _provenance: 'x' } } }],
      pages: [{ name: 'p', _lock: true }],
    });
    expect(findings).toEqual([]);
  });
});

describe('nested descent (#4001 evidence phase)', () => {
  // Before this the walk stopped at each item's top level plus a hard-coded
  // hop into `object.fields`, leaving 227 strip-mode objects below those roots
  // reporting nothing. These pin the four structural moves the descent makes
  // and — just as importantly — the two cases where it must stay quiet.

  it('reports inside a nested object', () => {
    // This one has now run out of subject too, and — unlike the array case
    // below — it has not got it back. `userActions` was the last strip-mode
    // nested object-valued PROPERTY reachable under any registered root;
    // #4001 批 20 closed it together with `lifecycle` (+ its four sub-blocks),
    // `fieldGroups`, `external`, `access`, `systemFields`, `activityMilestones`,
    // `publicSharing` and the object-extension entry. Measured, not assumed:
    // every one of those fixtures now lints CLEAN and PARSES FALSE.
    //
    // So assert the hand-off, which is the outcome this layer exists to reach —
    // the key is not unreported, it is REJECTED — and keep the descent itself
    // under test one shape over.
    expect(lintAuthoring({
      objects: [{ name: 'o1', userActions: { zzz_nested: 1 } }],
    })).toEqual([]);
    expect(ObjectSchema.safeParse({
      name: 'o1',
      label: 'O',
      fields: { a: { type: 'text', label: 'A' } },
      userActions: { zzz_nested: 1 },
    }).success).toBe(false);

    // The per-node descent under a CLOSED root — the #4522 behaviour — was
    // last exercised here on `indexes[]`, the one nested shape 批 20
    // deliberately held open. That site closed once objectui#4772 spent the
    // hold's evidence, so — per this block's own standing sentence ("when that
    // closes, this describe block is genuinely finished") — the object side is
    // finished: the fixture flips to the hand-off, and the descent mechanics
    // stay covered by the union walk — which #10039 moved out of the `view`
    // collection (whose parse had been refusing all along) and onto injected
    // schemas in the `single report per record` block at the end of this file,
    // where the mechanics can be exercised without a live strip-mode root.
    expect(lintAuthoring({
      objects: [{ name: 'o1', indexes: [{ fields: ['a'], zzz_nested: 1 }] }],
    })).toEqual([]);
    expect(ObjectSchema.safeParse({
      name: 'o1',
      label: 'O',
      fields: { a: { type: 'text', label: 'A' } },
      indexes: [{ fields: ['a'], zzz_nested: 1 }],
    }).success).toBe(false);
  });

  it('reports inside an array element, indexed by position', () => {
    // RESTORED at #4001 批 20 on `object.indexes[]` — the batch's deliberately
    // held site — under the standing instruction this test left for itself
    // when it ran out of subject at 6d. That hold's evidence was spent
    // (objectui#4772 converged the console's drifted index editor) and the
    // site CLOSED, so the subject has run out a second time: the fixture flips
    // to the hand-off, per key and per position, so a broken walk cannot hide
    // behind the same empty result.
    //
    // Standing instruction, renewed verbatim: if a new strip surface with a
    // nested array ever appears, restore the indexed assertion here; do not
    // let it go untested a second time.
    expect(lintAuthoring({
      objects: [{ name: 'o1', indexes: [{ fields: ['a'] }, { fields: ['b'], zzz_nested: 1 }] }],
    })).toEqual([]);
    // Element 1 rejected AT ITS POSITION — the path carries the index.
    const parsed = ObjectSchema.safeParse({
      name: 'o1',
      label: 'O',
      fields: { a: { type: 'text', label: 'A' } },
      indexes: [{ fields: ['a'] }, { fields: ['b'], zzz_nested: 1 }],
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.success ? [] : parsed.error.issues)).toContain('zzz_nested');

    // The hand-off half: `actions[]` closed at 6d, so the walk stays quiet
    // there. A broken walk would produce the same empty result, which is why
    // the parse assertions above have to exist alongside it.
    expect(lintAuthoring({
      objects: [{ name: 'o1', actions: [{ name: 'a', zzz_nested: 1 }] }],
    })).toEqual([]);
  });

  it('hands the field record and its nested array to the parse', () => {
    // Was `objects[].fields{}.options[]` reporting as surface `field`, which
    // proved the record-override survived a descent into a nested array.
    // `field` and `SelectOptionSchema` both closed in #4001 batch 6b, so the
    // parse rejects there now and the lint is correctly silent. The
    // record-override path itself is still exercised — every remaining
    // `object`-surface descent runs through the same code — and the graduation
    // is asserted rather than assumed, because a broken walk looks identical.
    expect(lintAuthoring({
      objects: [{
        name: 'o2',
        fields: { s: { type: 'select', options: [{ label: 'A', value: 'a', zzz_nested: 1 }] } },
      }],
    })).toEqual([]);

    expect(FieldSchema.safeParse({ type: 'text', zzz_nested: 1 }).success).toBe(false);
    expect(SelectOptionSchema.safeParse({ label: 'A', value: 'a', zzz_nested: 1 }).success).toBe(false);
  });

  it('stays silent where the nested parse is already strict', () => {
    // A dashboard widget is .strict(); reporting here would double-report what
    // the parse rejects loudly on its own.
    expect(lintAuthoring({
      dashboards: [{ name: 'd1', widgets: [{ id: 'w', type: 'chart', zzz_nested: 1 }] }],
    })).toEqual([]);
  });

  it('does not guess a union branch the author never picked', () => {
    // `type: 'not_a_real_component'` matches no discriminator literal. Descending
    // into an arbitrary member would invent findings against a shape nobody wrote.
    expect(lintAuthoring({
      pages: [{ name: 'p1', regions: [{ name: 'r', components: [{ type: 'not_a_real_component', zzz_nested: 1 }] }] }],
    })).toEqual([]);
  });

  it('still survives malformed nested input rather than throwing', () => {
    for (const junk of [
      { objects: [{ name: 'o', userActions: 'nope' }] },
      { pages: [{ name: 'p', regions: 'nope' }] },
      { pages: [{ name: 'p', regions: [null, 7, { name: 'r' }] }] },
      { objects: [{ name: 'o', fields: { f: { type: 'select', options: 'nope' } } }] },
    ]) {
      expect(() => lintAuthoring(junk)).not.toThrow();
    }
  });

  it('keeps ignoring the underscore channel at depth', () => {
    expect(lintAuthoring({
      pages: [{ name: 'p1', regions: [{ name: 'r', _provenance: 'x' }] }],
    })).toEqual([]);
  });
});

describe('top-level stack keys (#4167 → #8687)', () => {
  const lint = (raw: unknown) => lintUnknownStackKeys(raw, ObjectStackDefinitionSchema);

  // GRADUATION (#8687): `ObjectStackDefinitionSchema` is now `.strict()`, so
  // against the REAL schema this lint is deliberately silent — the parse
  // rejects loudly on its own, with the same did-you-mean/guidance riding the
  // refusal message (`stack-top-level-strict.test.ts` pins that side). What
  // this suite used to pin against the real schema — the `storage` guidance,
  // the `datasource` → `datasources` edit-distance fallback, the `onDisable`
  // report — moved to the refusal path; what remains HERE is the posture
  // agreement (silence on strict) and the strip-mode behaviour against
  // injected schemas, which is still the lint's living surface for any future
  // strip-mode envelope.

  it('goes quiet against the now-strict stack schema — one voice, not two', () => {
    for (const raw of [
      { storage: { adapter: 's3', s3: { bucket: 'app-files' } } },
      { datasource: [{ name: 'db' }] },
      { onDisable: () => {} },
      { objectz: [] },
    ]) {
      expect(lint(raw)).toEqual([]);
    }
  });

  it('is silent on a clean stack, and on the packaging channel', () => {
    expect(lint({ objects: [], pages: [], manifest: { name: 'app' }, _packageId: 'p' })).toEqual([]);
  });

  it('stays silent on the runtime members (now declared by the schema)', () => {
    // `onEnable` was undeclared-but-honoured until #8687 declared it as part
    // of the strict close; `functions` was always declared. Either way the
    // lint must never call a working handler registration "dropped at load".
    expect(lint({ onEnable: () => {}, functions: { doThing: () => {} } })).toEqual([]);
  });

  it('still reports strip-mode findings against an injected strip schema', () => {
    // The lint's own machinery — guidance table, edit-distance fallback, the
    // underscore channel — is unchanged; only the real stack schema's posture
    // graduated. Pin the machinery against a synthetic strip-mode envelope so
    // it cannot rot silently while the real surface is strict.
    const declared = z.object({ datasources: z.array(z.unknown()).optional() });
    const [finding, ...rest] = lintUnknownStackKeys({ datasource: [] }, declared);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ path: 'stack.datasource', suggestion: 'datasources' });
    const [storageFinding] = lintUnknownStackKeys({ storage: {} }, declared);
    expect(storageFinding).toMatchObject({ path: 'stack.storage', key: 'storage' });
    expect(storageFinding!.suggestion).toBeUndefined();
    expect(storageFinding!.guidance).toContain('OS_STORAGE_');
  });

  it('agrees with the injected schema posture instead of asserting its own', () => {
    // Guarding the day `ObjectStackDefinitionSchema` graduates to `.strict()`
    // (ADR-0049 / #4001): the parse becomes loud, and this lint must go quiet
    // rather than become a second, possibly disagreeing voice.
    const declared = { objects: z.array(z.unknown()).optional() };
    expect(lintUnknownStackKeys({ storage: {} }, z.strictObject(declared))).toEqual([]);
    expect(lintUnknownStackKeys({ storage: {} }, z.looseObject(declared))).toEqual([]);
    expect(lintUnknownStackKeys({ storage: {} }, z.object(declared))).toHaveLength(1);
  });

  it('survives malformed input rather than throwing', () => {
    for (const junk of [undefined, null, 42, 'x', [], {}]) {
      expect(() => lint(junk)).not.toThrow();
      expect(lint(junk)).toEqual([]);
    }
    expect(lintUnknownStackKeys({ storage: {} }, z.string())).toEqual([]);
    expect(lintUnknownStackKeys({ storage: {} }, undefined)).toEqual([]);
  });
});

describe('STACK_KEY_GUIDANCE does not rot', () => {
  const declared = new Set(Object.keys(ObjectStackDefinitionSchema.shape));

  it('names no key the stack schema declares itself', () => {
    // If a "not a stack key" key were ever added to the schema, the entry would
    // be actively wrong — telling an author to delete something that now works.
    for (const key of Object.keys(STACK_KEY_GUIDANCE)) {
      expect(declared, `STACK_KEY_GUIDANCE has an entry for the LIVE key '${key}'`).not.toContain(key);
    }
  });

  it('every runtime member is a key the schema now declares (#8687)', () => {
    // Until #8687 this pin ran the other way: `onEnable` had to be excluded
    // AND undeclared, because the exclusion list was what kept the lint from
    // calling an honoured-but-undeclared member "dropped at load". The strict
    // close resolved that split honestly — a strict schema cannot leave an
    // honoured member undeclared without refusing it, so BOTH members are now
    // declared (`declared = honoured`) and each self-excludes the way
    // `functions` always did. The list itself must stay: the CLI's graft
    // (`GRAFTABLE_RUNTIME_MEMBERS`) derives from it.
    expect(STACK_RUNTIME_MEMBERS).toContain('onEnable');
    for (const member of STACK_RUNTIME_MEMBERS) {
      expect(declared, `runtime member '${member}' must be declared by the strict schema`).toContain(member);
    }
    expect(STACK_RUNTIME_MEMBERS, 'onDisable is honoured nowhere; excluding it would hide a real drop')
      .not.toContain('onDisable');
  });

  it('every entry carries a rename target that exists, or a reason', () => {
    expect(Object.keys(STACK_KEY_GUIDANCE).length).toBeGreaterThan(0);
    for (const [key, hint] of Object.entries(STACK_KEY_GUIDANCE)) {
      expect(hint.to ?? hint.why, `STACK_KEY_GUIDANCE.${key} needs a 'to' or a 'why'`).toBeTruthy();
      if (hint.to) expect(declared, `STACK_KEY_GUIDANCE.${key} → '${hint.to}'`).toContain(hint.to);
      if (hint.why) expect(hint.why.length, `STACK_KEY_GUIDANCE.${key} reason too short`).toBeGreaterThan(30);
    }
  });
});

describe('one voice, and a single report per record (#10039)', () => {
  // The card's measured repro, kept in the shape it was filed in. An otherwise
  // VALID view container (it has `list`, so nothing else is wrong with it) plus
  // one undeclared key used to produce BOTH:
  //
  //   WARN:  views.v1.bogusViewKey: … so its value is dropped at load.
  //   THREW: views.0: Unrecognized key(s) on this view container: `bogusViewKey`
  //
  // — a warning promising a silent drop, and a refusal one step later saying
  // nothing loads at all. An author who reads the warning and stops concludes
  // the view loads minus one key. The truth was the opposite.
  const MANIFEST = { id: 'com.example.views', version: '1.0.0', type: 'app' as const, name: 'App' };
  const viewStack = { manifest: MANIFEST, views: [VIEW_ENTRY] };

  it('lets the strict container refusal be the only voice on an undeclared view key', () => {
    // Half one: the lint is silent. On its own this would also pass for a
    // walker that broke, which is why half two asserts the refusal directly.
    expect(lintAuthoring(viewStack)).toEqual([]);

    // Half two: the key is not unreported, it is REFUSED — and the refusal
    // still names the key, so the author loses no information by the warning
    // going away. Asserted on the `code`/message the parse produces rather than
    // on `toThrow()` alone, which would pass for any throw at all.
    const parsed = ObjectStackDefinitionSchema.safeParse(viewStack);
    expect(parsed.success).toBe(false);
    const issues = parsed.success ? [] : parsed.error.issues;
    expect(issues.some((i) => i.path.join('.') === 'views.0')).toBe(true);
    expect(JSON.stringify(issues)).toContain('bogusViewKey');
  });

  it('warns exactly once through defineStack, without the warn-once set doing the work', () => {
    // `warnUnknownAuthoringKeys` dedupes by path through a module-level set, so
    // a duplicate finding is INVISIBLE at this door — which is exactly how the
    // double emission survived. Assert the finding list itself (the surface
    // every other consumer of the exported walker sees), then assert the door
    // agrees, so neither half can drift alone.
    //
    // The key is unique to this test: `warnedUnknownAuthoringKeys` is a
    // MODULE-level set, so a path any other test already warned on would make
    // this one read zero warnings and pass vacuously.
    const connectorStack = {
      manifest: { ...MANIFEST, id: 'com.example.connectors' },
      connectors: [{ name: 'c1', zzz_once_probe_key: 1 }],
    };
    const findings = lintAuthoring(connectorStack);
    expect(findings.map((f) => `${f.surface}:${f.path}`)).toEqual([
      'connector:connectors.c1.zzz_once_probe_key',
    ]);

    const warned: string[] = [];
    const realWarn = console.warn;
    console.warn = (...args: unknown[]) => { warned.push(args.map(String).join(' ')); };
    try {
      // `strict: false` skips the parse; the pre-parse warning pass runs either
      // way, which is the door under test here.
      defineStack({ ...viewStack, ...connectorStack } as never, { strict: false });
    } finally {
      console.warn = realWarn;
    }
    expect(warned.filter((w) => w.includes('zzz_once_probe_key'))).toHaveLength(1);
    // The view key reaches the same door in the same call and is now silent
    // there — its only voice is the parse, which `strict: false` skips.
    expect(warned.some((w) => w.includes('bogusViewKey'))).toBe(false);
  });

  it('reports a union root once — the merged set, or the branch the author picked', () => {
    // The duplication's mechanism, pinned on injected schemas rather than on a
    // live collection: `lintUnknownKeysAgainstSchema` reported the root itself
    // AND handed the same record to the walk, whose union arm — unlike its
    // object arm — had no "the caller already did this" guard. `view` was the
    // only union root in the wild, so removing it from the lintable set would
    // otherwise have retired the coverage along with the bug.
    const plainUnion = z.union([
      z.object({ a: z.string().optional(), shared: z.string().optional() }),
      z.object({ b: z.string().optional(), shared: z.string().optional() }),
    ]);
    expect(
      lintUnknownKeysAgainstSchema(plainUnion, { shared: 'x', zzz: 1 }, 'probe', 'probe')
        .map((f) => f.path),
    ).toEqual(['probe.zzz']);

    // A discriminated union whose branch the author DID pick is judged by that
    // branch, once. Before the fix this emitted three findings: the merged
    // report from the caller, then the branch's own two.
    const discUnion = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('one'), a: z.string().optional() }),
      z.object({ kind: z.literal('two'), b: z.string().optional() }),
    ]);
    expect(
      lintUnknownKeysAgainstSchema(discUnion, { kind: 'one', b: 'x', zzz: 1 }, 'probe', 'probe')
        .map((f) => f.path).sort(),
    ).toEqual(['probe.b', 'probe.zzz']);

    // Controls, unchanged by the fix — an object root still reports once, and
    // the descent below it still reports. Without these, a walker that had
    // simply stopped reporting would pass the two assertions above.
    expect(
      lintUnknownKeysAgainstSchema(z.object({ a: z.string().optional() }), { a: 'x', zzz: 1 }, 'probe', 'probe')
        .map((f) => f.path),
    ).toEqual(['probe.zzz']);
    const nested = z.object({
      a: z.string().optional(),
      inner: z.object({ q: z.string().optional() }).optional(),
    });
    expect(
      lintUnknownKeysAgainstSchema(nested, { a: 'x', inner: { q: 'y', zzz: 1 } }, 'probe', 'probe')
        .map((f) => f.path),
    ).toEqual(['probe.inner.zzz']);
  });
});
