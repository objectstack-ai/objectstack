// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform baseline seam's rules, one refusal each (`platform-baseline-sets.ts`).
 *
 * A contribution reaches the member baseline only when it is made during boot,
 * by the package that registers every object it names, with read and create
 * bits alone, and no row policy or other key. Each case below changes one
 * thing from an admitted contribution and expects the refusal that names it,
 * with nothing registered and nothing joined. The real-kernel half (who the
 * set reaches, the explainer, the anchor, the closed window on a booted
 * kernel) is `platform-baseline-sets.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';

import { PlatformBaselineSets, type PlatformBaselineHost, type PlatformBaselineRegistry } from './platform-baseline-sets.js';

const CONTRIBUTOR = 'com.example.service.notes';
const OWN = 'pbs_note';
const OTHERS = 'pbs_ledger';

/** An admitted contribution: one own object, read and create. */
const SET = Object.freeze({
  name: 'pbs_notes_member',
  label: 'Notes',
  objects: { [OWN]: { allowRead: true, allowCreate: true } },
});

interface Rig {
  host: PlatformBaselineHost;
  registered: Array<{ type: string; item: Record<string, unknown>; keyField: string; packageId?: string }>;
}

function rig(opts: { baseline?: string[]; registerItem?: PlatformBaselineRegistry['registerItem']; registry?: null } = {}): Rig {
  const registered: Rig['registered'] = [];
  const owners: Record<string, string> = { [OWN]: CONTRIBUTOR, pbs_draft: CONTRIBUTOR, [OTHERS]: 'com.example.other' };
  const registry: PlatformBaselineRegistry = {
    getObjectOwner: (name) => (owners[name] ? { packageId: owners[name] } : undefined),
    registerItem:
      opts.registerItem ??
      ((type, item, keyField, packageId) => {
        registered.push({ type, item, keyField, packageId });
      }),
  };
  return {
    registered,
    host: {
      baseline: opts.baseline ?? ['app_member', 'member_default'],
      shipped: [PermissionSetSchema.parse({ name: 'member_default', objects: {} })],
      registry: opts.registry === null ? undefined : registry,
    },
  };
}

/** Contribute `raw` and answer the refusal's text, asserting nothing was registered or joined. */
function refusalOf(raw: unknown, opts: Parameters<typeof rig>[0] & { seams?: PlatformBaselineSets; contributor?: unknown } = {}): string {
  const r = rig(opts);
  const before = [...r.host.baseline];
  const seams = opts.seams ?? new PlatformBaselineSets();
  let message = '';
  try {
    seams.contribute('contributor' in opts ? opts.contributor : CONTRIBUTOR, raw, r.host);
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message, 'the contribution was refused').not.toBe('');
  expect(r.registered, 'a refused set is not registered').toEqual([]);
  expect(r.host.baseline, 'a refused set joins nothing').toEqual(before);
  return message;
}

describe('an admitted contribution', () => {
  it('is registered under the contributor, and its name joins the composed baseline in place', () => {
    const r = rig();
    const baseline = r.host.baseline;
    const admitted = new PlatformBaselineSets().contribute(CONTRIBUTOR, SET, r.host);
    expect(admitted).toMatchObject({ contributor: CONTRIBUTOR, joined: true });
    expect(admitted.set.name).toBe(SET.name);
    expect(admitted.set.objects[OWN]).toMatchObject({ allowRead: true, allowCreate: true, allowEdit: false, allowDelete: false });
    expect(r.registered).toHaveLength(1);
    expect(r.registered[0]).toMatchObject({ type: 'permission', keyField: 'name', packageId: CONTRIBUTOR });
    expect(r.registered[0].item.name).toBe(SET.name);
    // The same array every reader holds, grown in place.
    expect(r.host.baseline).toBe(baseline);
    expect(baseline).toEqual(['app_member', 'member_default', SET.name]);
  });

  it('joins nothing where the deployment declares no member baseline (fallbackPermissionSet: null)', () => {
    const r = rig({ baseline: [] });
    const admitted = new PlatformBaselineSets().contribute(CONTRIBUTOR, SET, r.host);
    expect(admitted.joined).toBe(false);
    expect(r.host.baseline).toEqual([]);
    expect(r.registered).toHaveLength(1);
  });

  it('the same contributor contributing the same name again replaces it and joins it once', () => {
    const r = rig();
    const seams = new PlatformBaselineSets();
    seams.contribute(CONTRIBUTOR, SET, r.host);
    seams.contribute(CONTRIBUTOR, { ...SET, objects: { [OWN]: { allowRead: true } } }, r.host);
    expect(r.host.baseline.filter((n) => n === SET.name)).toHaveLength(1);
    expect(seams.body(SET.name)?.objects[OWN]?.allowCreate).toBe(false);
  });

  it('a set that joined after the anchor was derived owes a re-derivation at close, and only then', () => {
    const before = new PlatformBaselineSets();
    before.contribute(CONTRIBUTOR, SET, rig().host);
    before.noteAnchorDerived();
    expect(before.close(), 'joined before the derivation: the derivation named it').toBe(false);

    const after = new PlatformBaselineSets();
    after.noteAnchorDerived();
    after.contribute(CONTRIBUTOR, SET, rig().host);
    expect(after.close(), 'joined after the derivation began').toBe(true);

    const nothingJoined = new PlatformBaselineSets();
    nothingJoined.noteAnchorDerived();
    nothingJoined.contribute(CONTRIBUTOR, SET, rig({ baseline: [] }).host);
    expect(nothingJoined.close(), 'a set that joined nothing owes nothing').toBe(false);
  });
});

describe('a refused contribution changes nothing', () => {
  it('the contributor is not named', () => {
    expect(refusalOf(SET, { contributor: '' })).toMatch(/contributing package is not named/);
  });

  it('the boot window has closed', () => {
    const seams = new PlatformBaselineSets();
    seams.close();
    expect(refusalOf(SET, { seams })).toMatch(/boot window is closed/);
  });

  it('it is not a permission-set object', () => {
    expect(refusalOf(['pbs_notes_member'])).toMatch(/not a permission-set object/);
  });

  it('it carries a row policy', () => {
    const raw = { ...SET, rowLevelSecurity: [{ name: 'pbs_own', object: OWN, operation: 'select', using: 'owner_id == current_user.id' }] };
    expect(refusalOf(raw)).toMatch(/row policy \(rowLevelSecurity\)/);
  });

  it.each(['systemPermissions', 'fields', 'tabPermissions', 'isDefault', 'packageId'])('it carries the key %s', (key) => {
    expect(refusalOf({ ...SET, [key]: key === 'isDefault' ? true : [] })).toMatch(new RegExp(`key '${key}' is not one`));
  });

  it('it names no set', () => {
    expect(refusalOf({ objects: SET.objects })).toMatch(/names no set/);
  });

  it('the contributor already contributed another set', () => {
    const r = rig();
    const seams = new PlatformBaselineSets();
    seams.contribute(CONTRIBUTOR, SET, r.host);
    expect(refusalOf({ ...SET, name: 'pbs_second' }, { seams })).toMatch(/already contributed the set 'pbs_notes_member'/);
  });

  it('another contributor already holds the name', () => {
    const seams = new PlatformBaselineSets();
    seams.contribute(CONTRIBUTOR, SET, rig().host);
    let message = '';
    try {
      seams.contribute('com.example.other', { ...SET, objects: { [OTHERS]: { allowRead: true } } }, rig().host);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/is the set 'com\.example\.service\.notes' contributed/);
  });

  it('the name is a shipped set', () => {
    expect(refusalOf({ ...SET, name: 'member_default' })).toMatch(/a set this plugin ships/);
  });

  it('the engine exposes no registry', () => {
    expect(refusalOf(SET, { registry: null })).toMatch(/exposes no registry/);
  });

  it('it names no object', () => {
    expect(refusalOf({ ...SET, objects: {} })).toMatch(/names no object/);
  });

  it("it names '*'", () => {
    expect(refusalOf({ ...SET, objects: { '*': { allowRead: true } } })).toMatch(/object '\*' is every object/);
  });

  it("it names another package's object", () => {
    expect(refusalOf({ ...SET, objects: { [OTHERS]: { allowRead: true } } })).toMatch(
      /'pbs_ledger' is registered by 'com\.example\.other', not by 'com\.example\.service\.notes'/,
    );
  });

  it('it names an object nobody registered', () => {
    expect(refusalOf({ ...SET, objects: { pbs_ghost: { allowRead: true } } })).toMatch(/'pbs_ghost' is registered by no package/);
  });

  it.each([
    ['allowEdit', true],
    ['allowDelete', true],
    ['allowTransfer', true],
    ['allowRestore', true],
    ['allowExport', true],
    ['viewAllRecords', true],
    ['modifyAllRecords', true],
    ['readScope', 'org'],
    ['allowEdit', false],
  ])('an object entry carries %s: %s', (bit, value) => {
    expect(refusalOf({ ...SET, objects: { [OWN]: { allowRead: true, [bit]: value } } })).toMatch(
      new RegExp(`carries '${bit}'\\. A platform baseline set grants read and create only`),
    );
  });

  it('a bit is not true or false', () => {
    expect(refusalOf({ ...SET, objects: { [OWN]: { allowRead: 'yes' } } })).toMatch(/'pbs_note\.allowRead' is not true or false/);
  });

  it('an object entry grants nothing', () => {
    expect(refusalOf({ ...SET, objects: { [OWN]: { allowRead: false, allowCreate: false } } })).toMatch(/grants nothing/);
  });

  it('it is not a well-formed permission set', () => {
    expect(refusalOf({ ...SET, name: 'Not Snake' })).toMatch(/not a well-formed permission set/);
  });

  it('the registry refuses it (another holder of the name)', () => {
    const message = refusalOf(SET, {
      registerItem: () => {
        throw new Error("permission 'pbs_notes_member' is held by package 'com.example.other'");
      },
    });
    expect(message).toMatch(/the registry refused the set: permission 'pbs_notes_member' is held/);
  });
});
