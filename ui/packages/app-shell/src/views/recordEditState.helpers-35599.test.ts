/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page edit state's pure pieces (objectstack#35599): the item-5
 * decision (can one batch carry the tables), and ruling A's client half (a
 * locked record's detail children draw no write actions).
 */

import { describe, it, expect } from 'vitest';
import {
  bodyTablesSaveTogether,
  isMasterDetailChild,
  withDetailWritesWithheld,
} from './recordEditState';

describe('bodyTablesSaveTogether — item 5: the batch is a bulk surface', () => {
  const ids = new Set(['order_line.order']);
  const all = { apiMethods: ['get', 'list', 'create', 'update', 'delete', 'bulk'] };
  const noBulk = { apiMethods: ['get', 'list', 'create', 'update', 'delete'] };

  it('objects that declare no restriction save together', () => {
    expect(bodyTablesSaveTogether({}, [{ name: 'order_line' }], ids)).toBe(true);
    expect(bodyTablesSaveTogether({ enable: all }, [{ name: 'order_line', enable: all }], ids)).toBe(true);
  });

  it('a child without bulk, or the record without bulk, keeps the tables read-only', () => {
    expect(bodyTablesSaveTogether({ enable: all }, [{ name: 'order_line', enable: noBulk }], ids)).toBe(false);
    expect(bodyTablesSaveTogether({ enable: noBulk }, [{ name: 'order_line', enable: all }], ids)).toBe(false);
    expect(
      bodyTablesSaveTogether({}, [{ name: 'order_line', enable: { apiMethods: ['get', 'list', 'create', 'update', 'bulk'] } }], ids),
    ).toBe(false);
  });

  it('no body tables → nothing to save together', () => {
    expect(bodyTablesSaveTogether({}, [], new Set())).toBe(false);
  });
});

describe('ruling A client half — a locked record\'s detail children draw no write actions', () => {
  const objects = [
    { name: 'order_line', fields: { order: { type: 'master_detail', reference: 'order' } } },
    { name: 'order_note', fields: { order: { type: 'lookup', reference: 'order' } } },
  ];

  it('isMasterDetailChild reads the child\'s own field', () => {
    expect(isMasterDetailChild(objects, 'order', 'order_line', 'order')).toBe(true);
    expect(isMasterDetailChild(objects, 'order', 'order_note', 'order')).toBe(false);
    expect(isMasterDetailChild(objects, 'account', 'order_line', 'order')).toBe(false);
  });

  it('strips New / Edit / Delete for a detail child only; a lookup child keeps them (CONTROL)', () => {
    const handlers = { onCreate: () => {}, onEdit: () => {}, onDelete: () => {}, onView: () => {} };
    const bridge = { resolve: () => handlers } as any;
    const served = withDetailWritesWithheld(bridge, (child, fk) => isMasterDetailChild(objects, 'order', child, fk));
    const detail = served.resolve({ objectName: 'order_line', relationshipField: 'order' } as any);
    expect(Object.keys(detail).sort()).toEqual(['onView']);
    const lookup = served.resolve({ objectName: 'order_note', relationshipField: 'order' } as any);
    expect(Object.keys(lookup).sort()).toEqual(['onCreate', 'onDelete', 'onEdit', 'onView']);
  });
});
