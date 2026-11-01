/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28472 — the delete confirmation names the objects the delete
 * cascades into, from labels the host resolved off the served
 * `cascadeDeleteObjects`; and the carried-key pair that brings that list from
 * the adapter to the host.
 *
 * The translator echoes the key plus its variables, so each assertion names
 * the copy it expects without depending on a pack.
 */

import { describe, it, expect } from 'vitest';
import { recordDelete } from '../recordDelete';
import {
  attachCascadeDeleteObjects,
  readCascadeDeleteObjects,
  CASCADE_DELETE_OBJECTS_KEY,
} from '../../utils/cascade-delete-objects';

const t = (key: string, options?: Record<string, unknown>) => {
  const vars = { ...(options ?? {}) };
  delete vars.defaultValue;
  const suffix = Object.keys(vars).length ? ` ${JSON.stringify(vars)}` : '';
  return `${key}${suffix}`;
};

const deps = { objectName: 'crm_lead', t, label: 'Lead' };
const ROW = { id: 'l1', name: 'Ada' };

describe('recordDelete.confirmCopy names the cascade (objectstack#28472)', () => {
  it('one record: the body gains one line naming each cascade label', () => {
    const copy = recordDelete.confirmCopy(
      { ...deps, cascadeLabels: ['Campaign Member'] },
      { record: ROW },
    );
    expect(copy.message).toBe(
      'objectActions.deleteConfirm objectActions.deleteCascade {"objects":"Campaign Member"}',
    );
  });

  it('several labels are listed in the served order', () => {
    const copy = recordDelete.confirmCopy(
      { ...deps, cascadeLabels: ['Campaign Member', 'Lead Score'] },
      { record: ROW },
    );
    expect(copy.message).toContain('{"objects":"Campaign Member, Lead Score"}');
  });

  it('a batch gains the same line after the batch question', () => {
    const copy = recordDelete.confirmCopy(
      { ...deps, cascadeLabels: ['Campaign Member'] },
      { count: 2 },
    );
    expect(copy.message).toBe(
      'console.objectView.bulkDeleteConfirm {"count":2} objectActions.deleteCascade {"objects":"Campaign Member"}',
    );
  });

  it('an empty list adds nothing: the body is the plain question', () => {
    const copy = recordDelete.confirmCopy({ ...deps, cascadeLabels: [] }, { record: ROW });
    expect(copy.message).toBe('objectActions.deleteConfirm');
  });

  it('no list adds nothing and keeps the copy exactly as before', () => {
    const withKey = recordDelete.confirmCopy({ ...deps, cascadeLabels: undefined }, { record: ROW });
    const without = recordDelete.confirmCopy(deps, { record: ROW });
    expect(withKey).toEqual(without);
    expect(without.message).toBe('objectActions.deleteConfirm');
  });
});

describe('attachCascadeDeleteObjects / readCascadeDeleteObjects (objectstack#28472)', () => {
  it('carries the served list under a non-enumerable symbol', () => {
    const schema = attachCascadeDeleteObjects({ name: 'crm_lead' }, ['crm_campaign_member']);
    expect(readCascadeDeleteObjects(schema)).toEqual(['crm_campaign_member']);
    expect(Object.keys(schema)).toEqual(['name']);
    expect(JSON.stringify(schema)).toBe('{"name":"crm_lead"}');
    expect({ ...schema }).not.toHaveProperty(String(CASCADE_DELETE_OBJECTS_KEY));
  });

  it('keeps an empty list as empty, distinct from absent', () => {
    expect(readCascadeDeleteObjects(attachCascadeDeleteObjects({}, []))).toEqual([]);
    expect(readCascadeDeleteObjects(attachCascadeDeleteObjects({}, undefined))).toBeUndefined();
    expect(readCascadeDeleteObjects({})).toBeUndefined();
    expect(readCascadeDeleteObjects(null)).toBeUndefined();
  });

  it('drops entries that are not object names and refuses a non-list', () => {
    expect(readCascadeDeleteObjects(attachCascadeDeleteObjects({}, ['a', 3, '', null, 'b']))).toEqual(['a', 'b']);
    expect(readCascadeDeleteObjects(attachCascadeDeleteObjects({}, 'a'))).toBeUndefined();
  });
});
