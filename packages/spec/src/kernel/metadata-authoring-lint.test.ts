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
  lintUnknownStackKeys,
  listLintableAuthoringCollections,
} from './metadata-authoring-lint';
import { STACK_KEY_GUIDANCE, STACK_RUNTIME_MEMBERS } from '../data/authoring-key-lint';
import { PLURAL_TO_SINGULAR } from '../shared/metadata-collection.zod';
import { ObjectSchema } from '../data/object.zod';
import { PageSchema } from '../ui/page.zod';
import { AgentSchema } from '../ai/agent.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';
import { getMetadataTypeSchema } from './metadata-type-schemas';

const lintables = listLintableAuthoringCollections();
const lintableTypes = new Set(lintables.map((l) => l.type));

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
    expect(lintables.length).toBeGreaterThanOrEqual(3);
    // `view` matters doubly: it is a UNION (container | ViewItem | overlay), so
    // its presence pins the union half of the posture logic — a regression that
    // silently dropped unions would shrink coverage without failing the count.
    for (const expected of ['dashboard', 'action', 'view']) {
      expect(lintableTypes, `expected '${expected}' to be lint-covered`).toContain(expected);
    }
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
      const findings = lintUnknownAuthoringKeys(stack);
      const hit = findings.find((f) => f.key === 'zzz_bogus_key');
      expect(hit, `${collection} (${type}) swallowed an unknown key`).toBeDefined();
      expect(hit!.surface).toBe(type);
      expect(hit!.path).toBe(`${collection}.probe_item.zzz_bogus_key`);
    }
  });

  it('a strict collection stays silent — the parse owns that failure', () => {
    const findings = lintUnknownAuthoringKeys({
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
    expect(lintUnknownAuthoringKeys(stackWith({}, {}))).toEqual([]);
  });

  it('reports a retired field key with guidance and no suggestion', () => {
    const [finding, ...rest] = lintUnknownAuthoringKeys(stackWith({}, { pii: true }));
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      path: 'objects.crm_case.fields.owner.pii',
      surface: 'field',
      key: 'pii',
    });
    expect(finding.guidance).toBeTruthy();
    expect(finding.suggestion).toBeUndefined();
  });

  it('no longer WARNS on a renamed object key — the parse rejects it now', () => {
    // `object` closed on the parse path (#4001), so a top-level unknown key is a
    // hard error rather than a warning, and warning too would double-report.
    // The rename itself did not get quieter, it got louder: the same suggestion
    // now arrives as a rejection.
    expect(lintUnknownAuthoringKeys(stackWith({ capabilities: { trackHistory: true } }, {})))
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
    // `page` and `agent` used to appear here too. They closed (#4001 batch 6a),
    // so the parse rejects those keys and the lint correctly stays quiet — the
    // hand-off this whole layer was built to make. `dashboard` keeps a
    // second collection in the walk so this still proves per-type surfacing
    // rather than degenerating into a single-collection test.
    const findings = lintUnknownAuthoringKeys({
      objects: [{ name: 'a', label: 'A', fields: { x: { type: 'text', indexed: true } } }],
      dashboards: [{ name: 'd', label: 'D', zzz: 1 }],
    });
    expect(findings.map((f) => `${f.surface}:${f.path}`).sort()).toEqual([
      'dashboard:dashboards.d.zzz',
      'field:objects.a.fields.x.indexed',
    ]);
  });

  it('hands off to the parse for the roots that closed', () => {
    // The other half of the assertion above, and the one that makes lowering
    // the coverage floor honest: these keys are not unreported, they are
    // REJECTED. A broken walk would produce the same empty lint result.
    expect(lintUnknownAuthoringKeys({
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
      expect(() => lintUnknownAuthoringKeys(junk)).not.toThrow();
    }
    expect(lintUnknownAuthoringKeys({ objects: [{ name: 'a', fields: 'nope' }] })).toEqual([]);
  });

  it('ignores the underscore-prefixed packaging channel everywhere', () => {
    const findings = lintUnknownAuthoringKeys({
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
    const [finding, ...rest] = lintUnknownAuthoringKeys({
      objects: [{ name: 'o1', userActions: { zzz_nested: 1 } }],
    });
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      path: 'objects.o1.userActions.zzz_nested',
      surface: 'object',
      key: 'zzz_nested',
    });
  });

  it('reports inside an array element, indexed by position', () => {
    // Was `pages[].regions[]` until `page` closed (#4001 batch 6a) — the parse
    // rejects that key now. `object.actions[]` is the same structural case and
    // carries a second property worth pinning: `object` itself is CLOSED, and
    // its nested strip sites still report. That is the #4522 fix — the walk
    // descends per node instead of gating a whole collection on its root's
    // posture — so this test now covers the array index and that regression at
    // once.
    const [finding] = lintUnknownAuthoringKeys({
      objects: [{ name: 'o1', actions: [{ name: 'a', zzz_nested: 1 }] }],
    });
    expect(finding).toMatchObject({ path: 'objects.o1.actions.0.zzz_nested', surface: 'object' });
  });

  it('carries the field surface through a record INTO its nested array', () => {
    // The override is keyed on the path relative to the item root, so a record's
    // author-chosen keys must not join that path — otherwise only the first
    // field would resolve as `field`. This also proves the descent continues
    // BELOW the override rather than stopping at it.
    const [finding] = lintUnknownAuthoringKeys({
      objects: [{
        name: 'o2',
        fields: { s: { type: 'select', options: [{ label: 'A', value: 'a', zzz_nested: 1 }] } },
      }],
    });
    expect(finding).toMatchObject({
      path: 'objects.o2.fields.s.options.0.zzz_nested',
      surface: 'field',
    });
  });

  it('stays silent where the nested parse is already strict', () => {
    // A dashboard widget is .strict(); reporting here would double-report what
    // the parse rejects loudly on its own.
    expect(lintUnknownAuthoringKeys({
      dashboards: [{ name: 'd1', widgets: [{ id: 'w', type: 'chart', zzz_nested: 1 }] }],
    })).toEqual([]);
  });

  it('does not guess a union branch the author never picked', () => {
    // `type: 'not_a_real_component'` matches no discriminator literal. Descending
    // into an arbitrary member would invent findings against a shape nobody wrote.
    expect(lintUnknownAuthoringKeys({
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
      expect(() => lintUnknownAuthoringKeys(junk)).not.toThrow();
    }
  });

  it('keeps ignoring the underscore channel at depth', () => {
    expect(lintUnknownAuthoringKeys({
      pages: [{ name: 'p1', regions: [{ name: 'r', _provenance: 'x' }] }],
    })).toEqual([]);
  });
});

describe('top-level stack keys (#4167)', () => {
  const lint = (raw: unknown) => lintUnknownStackKeys(raw, ObjectStackDefinitionSchema);

  it('covers ground the collection walker cannot reach', () => {
    // The complementarity proof, and the reason this is a second pass rather
    // than a tidier fold into the walker: the walker iterates COLLECTIONS, so a
    // stack whose only mistake is at the envelope level — no objects, no pages,
    // nothing to iterate — walks clean and reports nothing.
    const raw = { storage: { adapter: 's3', s3: { bucket: 'app-files' } } };
    expect(lintUnknownAuthoringKeys(raw)).toEqual([]);
    expect(lint(raw)).toHaveLength(1);
  });

  it('reports the worked example with its guidance and no suggestion', () => {
    // `storage` is 5 edits from `sharingRules`; "did you mean sharingRules?"
    // would be confident nonsense pointed at a real key. A `why` must win.
    const [finding, ...rest] = lint({ storage: { adapter: 's3' } });
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ path: 'stack.storage', surface: 'stack', key: 'storage' });
    expect(finding.suggestion).toBeUndefined();
    // The prescription has to name where the setting DOES live, or the author
    // learns only that they were wrong — the #4167 complaint in miniature.
    expect(finding.guidance).toContain('OS_STORAGE_');
  });

  it('falls back to edit distance for a near-miss on a declared key', () => {
    const [finding] = lint({ datasource: [{ name: 'db' }] });
    expect(finding).toMatchObject({ path: 'stack.datasource', suggestion: 'datasources' });
  });

  it('is silent on a clean stack, and on the packaging channel', () => {
    expect(lint({ objects: [], pages: [], manifest: { name: 'app' }, _packageId: 'p' })).toEqual([]);
  });

  it('stays silent on the runtime members the schema cannot declare', () => {
    // The regression that shipped in review: `onEnable` is a function, so the
    // schema does not declare it — but `AppPlugin` calls it off the authored
    // bundle, and `examples/app-todo` and `examples/app-showcase` both ship it.
    // The first version of this lint told both of them their working handler
    // registration was "dropped at load".
    expect(lint({ onEnable: () => {}, functions: { doThing: () => {} } })).toEqual([]);
  });

  it('still reports `onDisable`, which really does go nowhere', () => {
    // The distinction the exclusion list has to preserve: no kernel, runtime
    // or service ever called `onDisable` (the protocol declared it until
    // #4212 retired the uninvoked lifecycle family), so a value written there
    // IS lost and the author should hear about it.
    const [finding, ...rest] = lint({ onDisable: () => {} });
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ path: 'stack.onDisable', key: 'onDisable' });
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

  it('no runtime member is silently excluded for a key the schema declares', () => {
    // `functions` legitimately appears in both lists. But if a member ever
    // exists ONLY here while the schema also declares it and the runtime has
    // stopped reading it, the exclusion is dead weight hiding a real finding.
    // Pin the one that carries the exclusion's whole weight instead of trusting
    // the list's shape: `onEnable` must be excluded AND undeclared.
    expect(STACK_RUNTIME_MEMBERS).toContain('onEnable');
    expect(declared, 'onEnable became a declared key — the exclusion is now dead').not.toContain('onEnable');
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
