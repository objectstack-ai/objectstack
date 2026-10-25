// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11790 — the Studio nav editor's type list is the spec's, and a
 * change of type writes a shape the spec's member for that type takes.
 *
 * `NAV_ENTRY_TYPES` is keyed by the spec-derived `NavigationItemType`, so the
 * compiler already refuses a member missing from it or one the spec does not
 * declare. This file is the runtime half, and it reads the vocabulary from the
 * INSTALLED `@objectstack/spec`'s `NavigationItemSchema` discriminants rather
 * than from a list written here, so it follows whatever spec it runs against.
 * The key sets `retypedNavEntry` keeps are judged the same way: by the spec
 * members' own shapes and by a parse, never by a second list. So is
 * `navEntryOffersField` (objectui#11847), which reads the same key sets to
 * answer which describing fields the nav editors offer an entry.
 */

import { describe, expect, it } from 'vitest';
import { NavigationItemSchema } from '@objectstack/spec/ui';
import type { NavigationItemType } from '@object-ui/types';
import {
  NAV_ENTRY_TYPES,
  isNavEntryType,
  navEntryOffersField,
  navTypeAcceptsChildren,
  retypedNavEntry,
} from './nav-target';

/**
 * Walk `.unwrap()` (the spec wraps its schemas lazily) until the node carries
 * `key`. Bounded, and answers `undefined` rather than looping on a shape it
 * does not recognise. (The same walk as plugin-designer's
 * `NavigationDesigner.specNavTypes.test.tsx`, objectui#10287.)
 */
function unwrapUntil(node: unknown, key: string): Record<string, unknown> | undefined {
  let current = node as Record<string, unknown> | undefined;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (key in current) return current;
    const unwrap = current.unwrap;
    if (typeof unwrap !== 'function') return undefined;
    current = unwrap.call(current) as Record<string, unknown> | undefined;
  }
  return current && key in current ? current : undefined;
}

/** Each member of the spec's nav-item union: its `type` literal and its declared keys. Throws when unreadable. */
function specNavMembers(): Array<{ type: string; keys: string[] }> {
  const union = unwrapUntil(NavigationItemSchema, 'options');
  const options = union?.options;
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error('could not read NavigationItemSchema options from @objectstack/spec');
  }
  return options.map((option, index) => {
    const shape = unwrapUntil(option, 'shape')?.shape as Record<string, unknown> | undefined;
    const literal = shape?.type as { values?: unknown } | undefined;
    if (!shape || !(literal?.values instanceof Set) || literal.values.size !== 1) {
      throw new Error(`could not read the \`type\` literal of NavigationItemSchema option ${index}`);
    }
    return { type: String([...literal.values][0]), keys: Object.keys(shape) };
  });
}

const SPEC_MEMBERS = specNavMembers();
const SPEC_TYPES = SPEC_MEMBERS.map((m) => m.type);

/**
 * One target per target-bearing member, in the key that member declares for
 * it. Keyed by the spec-derived type, so a member the spec adds stops this file
 * compiling until it has a sample here.
 */
const TARGET_SAMPLE: Record<NavigationItemType, Record<string, unknown>> = {
  object: { objectName: 'acme_task' },
  page: { pageName: 'home' },
  dashboard: { dashboardName: 'ops_board' },
  report: { reportName: 'tasks_by_status' },
  url: { url: 'https://example.com/help' },
  action: { actionDef: { actionName: 'sync_all' } },
  component: { componentRef: 'metadata:directory' },
  doc: { doc: 'getting_started' },
  group: {},
  separator: {},
};

/**
 * The keys every non-separator member declares, read off the spec: the shared
 * base `retypedNavEntry` carries across a change of type.
 */
const SPEC_BASE_KEYS = SPEC_MEMBERS.filter((m) => m.type !== 'separator')
  .map((m) => new Set(m.keys))
  .reduce((acc, keys) => new Set([...acc].filter((k) => keys.has(k))));

/** A valid value for each base key, so an entry carrying all of them parses. */
const BASE_VALUES: Record<string, unknown> = {
  id: 'nav_item_3',
  label: 'Tasks',
  icon: 'list-checks',
  order: 3,
  badge: 'NEW',
  badgeVariant: 'secondary',
  visible: "'admin' in current_user.positions",
  dataSource: { provider: 'api', read: { url: '/api/v1/cloud/home' }, path: 'data.environments' },
  requiredPermissions: ['task.read'],
  requiresObject: 'acme_task',
  requiresService: 'ai',
};

/** An `object` entry as an author leaves it: bound, labelled, gated, badged. */
const FULL_OBJECT_ENTRY: Record<string, unknown> = { ...BASE_VALUES, type: 'object', objectName: 'acme_task' };

/** What the save meets: `undefined`-valued keys erased, as JSON does. */
const wire = (entry: Record<string, unknown>) => JSON.parse(JSON.stringify(entry)) as Record<string, unknown>;

const unrecognizedKeys = (entry: Record<string, unknown>): string[] => {
  const r = NavigationItemSchema.safeParse(wire(entry));
  return r.success ? [] : r.error.issues.flatMap((i) => (i.code === 'unrecognized_keys' ? i.keys : []));
};

describe('NAV_ENTRY_TYPES — exactly the spec nav-item union (objectui#11790)', () => {
  it('reads a non-empty vocabulary from the installed spec', () => {
    // Non-vacuity: an empty or mis-read list would make every case below pass.
    expect(SPEC_TYPES).toContain('object');
    expect(SPEC_TYPES).toContain('separator');
    expect(new Set(SPEC_TYPES).size).toBe(SPEC_TYPES.length);
    expect(SPEC_BASE_KEYS.has('label')).toBe(true);
  });

  it('offers every member the spec declares, and no other', () => {
    expect([...NAV_ENTRY_TYPES].sort()).toEqual([...SPEC_TYPES].sort());
    expect(new Set(NAV_ENTRY_TYPES).size).toBe(NAV_ENTRY_TYPES.length);
  });

  it('`isNavEntryType` answers the same membership', () => {
    for (const type of SPEC_TYPES) expect(isNavEntryType(type)).toBe(true);
    for (const other of ['view', 'item', '', 'Object', undefined, 3]) expect(isNavEntryType(other)).toBe(false);
  });

  it('`navTypeAcceptsChildren` is the spec answer: a bound entry with `children: []` parses only where it is true', () => {
    for (const type of NAV_ENTRY_TYPES) {
      const entry = { ...(type === 'separator' ? { id: 'nav_sep' } : { id: 'nav_x' }), type, ...TARGET_SAMPLE[type], children: [] };
      expect({ type, parses: NavigationItemSchema.safeParse(entry).success }).toEqual({
        type,
        parses: navTypeAcceptsChildren(type),
      });
    }
  });
});

describe('retypedNavEntry — a change of type writes what the new member takes (objectui#11790)', () => {
  it.each(NAV_ENTRY_TYPES.filter((type) => type !== 'object'))(
    'object → %s: once its target is picked, the entry parses whole',
    (type) => {
      const retyped = retypedNavEntry(FULL_OBJECT_ENTRY, type);
      const bound = { ...retyped, ...TARGET_SAMPLE[type] };
      const r = NavigationItemSchema.safeParse(wire(bound));
      expect(r.success ? [] : r.error.issues).toEqual([]);
    },
  );

  it.each(NAV_ENTRY_TYPES.filter((type) => type !== 'object'))(
    'object → %s: before a target is picked, no key it carries is one the member refuses',
    (type) => {
      expect(unrecognizedKeys(retypedNavEntry(FULL_OBJECT_ENTRY, type))).toEqual([]);
    },
  );

  it('the old target goes: no member but `object` keeps `objectName`', () => {
    for (const type of NAV_ENTRY_TYPES.filter((t) => t !== 'object')) {
      expect(retypedNavEntry(FULL_OBJECT_ENTRY, type)).not.toHaveProperty('objectName');
    }
  });

  it('what describes the entry stays: every key the spec base declares survives a change between non-separators', () => {
    // The base set is read off the spec, so a key the spec adds to its base and
    // the editor forgets to carry fails here rather than vanishing on retype.
    const entry: Record<string, unknown> = { type: 'object', objectName: 'acme_task' };
    for (const key of SPEC_BASE_KEYS) {
      if (key === 'type') continue;
      expect(BASE_VALUES).toHaveProperty(key);
      entry[key] = BASE_VALUES[key];
    }
    expect(NavigationItemSchema.safeParse(entry).success).toBe(true);
    const retyped = retypedNavEntry(entry, 'dashboard');
    for (const key of SPEC_BASE_KEYS) {
      if (key === 'type') continue;
      expect({ key, value: retyped[key] }).toEqual({ key, value: entry[key] });
    }
  });

  it('a separator keeps only what its member declares: its id and order, and no label', () => {
    const separatorKeys = SPEC_MEMBERS.find((m) => m.type === 'separator')!.keys;
    const retyped = retypedNavEntry(FULL_OBJECT_ENTRY, 'separator');
    expect(Object.keys(retyped).sort()).toEqual([...separatorKeys].sort());
    expect(retyped).toEqual({ id: 'nav_item_3', type: 'separator', order: 3 });
    expect(NavigationItemSchema.safeParse(retyped).success).toBe(true);
  });

  it('a group is born with the empty `children` its member requires, and parses', () => {
    const retyped = retypedNavEntry({ id: 'nav_item_4', type: 'object' }, 'group');
    expect(retyped).toEqual({ id: 'nav_item_4', type: 'group', children: [] });
    expect(NavigationItemSchema.safeParse(retyped).success).toBe(true);
  });

  it('children stay on a type that accepts them', () => {
    const child = { id: 'nav_child', type: 'object', objectName: 'acme_task' };
    const retyped = retypedNavEntry({ id: 'nav_grp', type: 'group', label: 'Work', children: [child] }, 'object');
    expect(retyped.children).toEqual([child]);
  });

  it('the same type answers the entry unchanged (the same object)', () => {
    expect(retypedNavEntry(FULL_OBJECT_ENTRY, 'object')).toBe(FULL_OBJECT_ENTRY);
  });
});

describe('navEntryOffersField — the describing fields a nav editor offers are the ones the member declares (objectui#11847)', () => {
  type DescribingKey = Parameters<typeof navEntryOffersField>[1];
  /** The describing keys, read off the spec: its shared base, less the discriminant. */
  const DESCRIBING_KEYS = [...SPEC_BASE_KEYS].filter((key) => key !== 'type') as DescribingKey[];

  it('reads a describing vocabulary that holds the label and the icon (non-vacuity)', () => {
    expect(DESCRIBING_KEYS).toContain('label');
    expect(DESCRIBING_KEYS).toContain('icon');
  });

  it('answers, for every member and every describing key, whether the INSTALLED spec member declares it', () => {
    for (const member of SPEC_MEMBERS) {
      const type = member.type as NavigationItemType;
      for (const key of DESCRIBING_KEYS) {
        expect({ type, key, offered: navEntryOffersField(type, key) }).toEqual({
          type,
          key,
          offered: member.keys.includes(key),
        });
      }
    }
  });

  it('a separator is offered no label and no icon; every other member is offered both', () => {
    expect(navEntryOffersField('separator', 'label')).toBe(false);
    expect(navEntryOffersField('separator', 'icon')).toBe(false);
    for (const type of NAV_ENTRY_TYPES.filter((t) => t !== 'separator')) {
      expect({ type, label: navEntryOffersField(type, 'label'), icon: navEntryOffersField(type, 'icon') }).toEqual({
        type,
        label: true,
        icon: true,
      });
    }
  });

  it('an entry with no spec type (`null`) is offered the shared base, as before', () => {
    for (const key of DESCRIBING_KEYS) expect({ key, offered: navEntryOffersField(null, key) }).toEqual({ key, offered: true });
  });

  it('agrees with `retypedNavEntry`: a retype keeps exactly the describing keys the new type is offered', () => {
    const entry: Record<string, unknown> = { type: 'object', objectName: 'acme_task' };
    for (const key of DESCRIBING_KEYS) entry[key] = BASE_VALUES[key];
    for (const type of NAV_ENTRY_TYPES.filter((t) => t !== 'object')) {
      const retyped = retypedNavEntry(entry, type);
      for (const key of DESCRIBING_KEYS) {
        expect({ type, key, kept: key in retyped }).toEqual({ type, key, kept: navEntryOffersField(type, key) });
      }
    }
  });
});
