// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The first-run checklist's host profile (objectstack#34251): which profile the
 * served flag selects, and the two added rows' reads, as pure functions. The
 * rendered rows are pinned in `FirstRunChecklist.test.tsx`.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  MANAGED_PROFILE,
  SELF_HOSTED_PROFILE,
  appObjectNames,
  checklistProfileFor,
  hasOwnApp,
  isProfileOptionalRow,
  profileDrawsRow,
  readFirstRecordCreated,
} from '../firstRunChecklistProfile';
import { checklistCompletion } from '../firstRunChecklistLogic';

describe('the served flag selects the profile', () => {
  it('only `cloudManaged: true` is managed', () => {
    expect(checklistProfileFor({ cloudManaged: true })).toBe(MANAGED_PROFILE);
    for (const features of [{ cloudManaged: false }, { cloudManaged: 'true' }, {}, null, undefined]) {
      expect(checklistProfileFor(features)).toBe(SELF_HOSTED_PROFILE);
    }
  });

  it('the self-hosted profile changes nothing', () => {
    expect(SELF_HOSTED_PROFILE.addedRows).toEqual([]);
    expect(SELF_HOSTED_PROFILE.hiddenUntilDone).toEqual([]);
    expect(SELF_HOSTED_PROFILE.optionalRows).toEqual([]);
    expect(profileDrawsRow(SELF_HOSTED_PROFILE, 'mail', false)).toBe(true);
    expect(isProfileOptionalRow(SELF_HOSTED_PROFILE, 'mail')).toBe(true);
    expect(isProfileOptionalRow(SELF_HOSTED_PROFILE, 'first_record')).toBe(false);
  });

  it('managed: adds the two rows, hides mail until done, leaves the record row optional', () => {
    expect(MANAGED_PROFILE.addedRows).toEqual(['first_app', 'first_record']);
    expect(profileDrawsRow(MANAGED_PROFILE, 'mail', false)).toBe(false);
    expect(profileDrawsRow(MANAGED_PROFILE, 'mail', true)).toBe(true);
    expect(profileDrawsRow(MANAGED_PROFILE, 'invite', false)).toBe(true);
    expect(isProfileOptionalRow(MANAGED_PROFILE, 'first_record')).toBe(true);
    expect(isProfileOptionalRow(MANAGED_PROFILE, 'first_app')).toBe(false);
  });

  it("completion counts only the profile's required rows", () => {
    const rows = [
      { id: 'organization_name', done: true },
      { id: 'first_app', done: true },
      { id: 'first_record', done: false },
    ];
    expect(checklistCompletion(rows, (id) => isProfileOptionalRow(MANAGED_PROFILE, id))).toEqual({
      done: 2,
      total: 2,
      complete: true,
    });
    // CONTROL: without the profile the record row is required.
    expect(checklistCompletion(rows).complete).toBe(false);
  });
});

describe('the first-app read', () => {
  it('done once the launcher lists an app that is not a platform built-in', () => {
    const setup = { name: 'setup', _packageId: 'com.objectstack.setup' };
    expect(hasOwnApp([setup, { name: 'studio', _packageId: 'com.objectstack.studio' }])).toBe(false);
    expect(hasOwnApp([])).toBe(false);
    expect(hasOwnApp([setup, { name: 'crm', _packageId: 'app.crm' }])).toBe(true);
    expect(hasOwnApp([{ name: 'showcase_app' }])).toBe(true);
  });

  it('the objects an app lists, at any depth and in every area, sorted once each', () => {
    expect(
      appObjectNames([
        {
          navigation: [
            { type: 'group', children: [{ type: 'object', objectName: 'deal' }, { type: 'page', pageName: 'p' }] },
            { type: 'object', objectName: 'account' },
          ],
          areas: [{ navigation: [{ type: 'object', objectName: 'account' }, { type: 'object', objectName: 'case' }] }],
        },
      ]),
    ).toEqual(['account', 'case', 'deal']);
  });
});

describe('the first-record read', () => {
  it('no object to ask about: "no", without a request', async () => {
    const find = vi.fn();
    expect(await readFirstRecordCreated({ find }, [])).toBe(false);
    expect(find).not.toHaveBeenCalled();
  });

  it('one read for a person-created row; a row is "yes", none is "no"', async () => {
    const find = vi.fn().mockResolvedValueOnce({ data: [{ id: 'act_1' }] }).mockResolvedValueOnce({ data: [] });
    expect(await readFirstRecordCreated({ find }, ['account'])).toBe(true);
    expect(await readFirstRecordCreated({ find }, ['account'])).toBe(false);
    expect(find).toHaveBeenNthCalledWith(1, 'sys_activity', {
      $filter: { type: 'created', actor_id: { $ne: null }, object_name: { $in: ['account'] } },
      $top: 1,
    });
  });

  it('a read that fails rejects, so the row is left out rather than shown not done', async () => {
    const find = vi.fn().mockRejectedValue(new Error('403'));
    await expect(readFirstRecordCreated({ find }, ['account'])).rejects.toThrow('403');
  });
});
