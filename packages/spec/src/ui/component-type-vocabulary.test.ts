// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the page-component type vocabulary claim (#12950) — the
 * `vocabulary-derivation.test.ts` discipline applied to the namespace claim:
 * every set here is DERIVED in the source module, so these tests assert the
 * derivation still holds and the ledger still earns its rows. The failure mode
 * of a restated list is silence; the failure mode of an unpinned ledger is a
 * grandfather clause nobody can date.
 */
import { describe, it, expect } from 'vitest';
import {
  RESERVED_COMPONENT_TYPE_NAMESPACES,
  STRING_ARM_REGISTERED_TYPES,
  KNOWN_COMPONENT_TYPES,
  KNOWN_COMPONENT_TYPE_CANDIDATES,
  hasReservedComponentNamespace,
  isKnownComponentType,
} from './component-type-vocabulary';
import { PageComponentType } from './page.zod';
import { ComponentPropsMap } from './component.zod';

describe('RESERVED_COMPONENT_TYPE_NAMESPACES is derived from the enum', () => {
  it('claims exactly the namespaces the enum populates', () => {
    // A new namespace appearing here is a NEW VOCABULARY CLAIM — the
    // `component-type-unknown` rule starts refusing undeclared strings under
    // it the day the enum member lands. Update this list consciously.
    expect([...RESERVED_COMPONENT_TYPE_NAMESPACES].sort()).toEqual([
      'ai', 'app', 'element', 'global', 'nav', 'page', 'record', 'user',
    ]);
  });

  it('every enum member sits inside a reserved namespace', () => {
    for (const member of PageComponentType.options) {
      expect(hasReservedComponentNamespace(member), member).toBe(true);
    }
  });
});

describe('KNOWN_COMPONENT_TYPES covers every declared face', () => {
  it('contains every enum member and every ComponentPropsMap row', () => {
    for (const member of PageComponentType.options) {
      expect(isKnownComponentType(member), member).toBe(true);
    }
    for (const key of Object.keys(ComponentPropsMap)) {
      expect(isKnownComponentType(key), key).toBe(true);
    }
  });

  it('the candidate list is the known set, sorted and stable', () => {
    expect(KNOWN_COMPONENT_TYPE_CANDIDATES).toEqual([...KNOWN_COMPONENT_TYPES].sort());
  });

  /**
   * #12950's own readiness verdict, pinned: `global:search` and
   * `global:notifications` STAY declared — the 2026-08-26 ruling retires a
   * member only when no data source covers the horizon, and both are backed by
   * shipped platform data sources (the cross-object search protocol behind
   * `GET /api/v1/search`; the inbox materialization behind
   * `GET /api/v1/notifications`). Retiring either later is a conscious edit
   * here, through the spec-property-retirement playbook, not a drive-by.
   */
  it('the Phase-2 members stay declared', () => {
    expect(PageComponentType.options).toContain('global:search');
    expect(PageComponentType.options).toContain('global:notifications');
    expect(isKnownComponentType('global:search')).toBe(true);
    expect(isKnownComponentType('global:notifications')).toBe(true);
  });
});

describe('STRING_ARM_REGISTERED_TYPES ledger discipline', () => {
  it('every entry is reserved-namespace, not an enum member, not a map row', () => {
    const enumSet = new Set<string>(PageComponentType.options);
    const mapKeys = new Set(Object.keys(ComponentPropsMap));
    for (const entry of STRING_ARM_REGISTERED_TYPES) {
      // Outside a reserved namespace the open string arm already accepts the
      // type — a ledger row there is dead weight.
      expect(hasReservedComponentNamespace(entry), entry).toBe(true);
      // An enum member or a map row is already known — a ledger row for one is
      // a grandfather clause pretending to be an exemption. When
      // `record:line_items` is measured into the map, this assertion forces
      // its ledger row OUT in the same PR.
      expect(enumSet.has(entry), entry).toBe(false);
      expect(mapKeys.has(entry), entry).toBe(false);
    }
  });

  it('ledger entries are known', () => {
    for (const entry of STRING_ARM_REGISTERED_TYPES) {
      expect(isKnownComponentType(entry), entry).toBe(true);
    }
  });
});

describe('the namespace predicate leaves the open arm open', () => {
  it.each(['mcp:connect-agent', 'cloud-connection:panel', 'marketplace:installed-list'])(
    'plugin namespace %s is not reserved',
    (type) => {
      expect(hasReservedComponentNamespace(type)).toBe(false);
    },
  );

  it.each(['flex', 'grid', 'object-chart', 'page-header', 'custom.widget'])(
    'colon-free shape %s is not reserved',
    (type) => {
      expect(hasReservedComponentNamespace(type)).toBe(false);
    },
  );

  it('an undeclared string inside a reserved namespace is reserved and unknown', () => {
    expect(hasReservedComponentNamespace('global:serch')).toBe(true);
    expect(isKnownComponentType('global:serch')).toBe(false);
  });
});
