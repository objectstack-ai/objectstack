// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #18159 — the three keys objectui reads on the record blocks, all declared.
//
// `record:details`, `record:highlights` and `record:related_list` are
// `strictObject`s, and objectui's `@object-ui/plugin-detail` reads three keys
// off each of them that none of the three declared: `enforceFieldSecurity`,
// `redactFields` and `requiredPermissions`. An author who wrote any of them was
// refused at parse while the renderer honoured the same document on the raw-node
// path — a contract that could not be satisfied by writing it down.
//
// The card declared the field-security PAIR first and held the third key until
// its semantics were ruled (#19186 ruling B: an ADR-0066 capability set) and the
// renderers read it that way at the pin. Every pin below is an ACCEPT pin: a
// full `safeParse` success is the assertion (not merely "no
// `unrecognized_keys`"), because the value arm is part of what is being
// declared, and a key-only assertion would stay green over a declaration that
// refused every value.
//
// `requiredPermissions` is pinned through the card's two instruments, each with
// its lit controls `aria` / `fields`:
//
//   A — a parse probe on each block's own legal base document;
//   B — an enumeration of the block's public zod `.shape`.
//
// Plus the ruling's own condition: the four record blocks carrying the key
// (the three above and `record:quick_actions`) declare it IDENTICALLY — same
// shape, same describe, word for word.

import { describe, expect, it } from 'vitest';
import {
  ComponentPropsMap,
  RecordDetailsProps,
  RecordHighlightsProps,
  RecordQuickActionsProps,
  RecordRelatedListProps,
} from './component.zod';
import { z } from 'zod';

/** A document that is legal on its own, per block — the baseline every case adds to. */
const BASE: Record<string, Record<string, unknown>> = {
  'record:details': {},
  'record:highlights': { fields: ['name'] },
  'record:related_list': { objectName: 'task', relationshipField: 'parent_id' },
};

const BLOCKS = Object.keys(BASE) as Array<keyof typeof BASE>;

const parse = (type: string, extra: Record<string, unknown>) =>
  ComponentPropsMap[type as keyof typeof ComponentPropsMap].safeParse({ ...BASE[type], ...extra });

const unknownKeyIssue = (type: string, extra: Record<string, unknown>) => {
  const r = parse(type, extra);
  expect(r.success).toBe(false);
  return r.error!.issues.find((i) => i.code === 'unrecognized_keys');
};

describe('#18159 — the three blocks are the ones under test, and they are strict', () => {
  it('each baseline document parses on its own — the positive control every refusal below rests on', () => {
    for (const type of BLOCKS) {
      expect(parse(type, {}).success).toBe(true);
    }
  });

  it('each block still refuses a nonsense key BY NAME — the accept set widened, it did not open', () => {
    for (const type of BLOCKS) {
      const issue = unknownKeyIssue(type, { zzqx_no_such_key: 1 });
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('zzqx_no_such_key');
    }
  });

  it('the rows under test are the exported schemas, not look-alikes', () => {
    expect(ComponentPropsMap['record:details']).toBe(RecordDetailsProps);
    expect(ComponentPropsMap['record:highlights']).toBe(RecordHighlightsProps);
    expect(ComponentPropsMap['record:related_list']).toBe(RecordRelatedListProps);
  });
});

describe('#18159 — `enforceFieldSecurity` is declared on all three blocks', () => {
  it('parses GREEN with the key set — the whole document, not just the key name', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { enforceFieldSecurity: true });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).enforceFieldSecurity).toBe(true);
    }
  });

  it('accepts `false` — the explicit opt-out is a different fact from an absent key', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { enforceFieldSecurity: false });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).enforceFieldSecurity).toBe(false);
    }
  });

  it('carries NO schema default — an absent key stays absent, never "the author asked for off"', () => {
    for (const type of BLOCKS) {
      const r = parse(type, {});
      expect(r.success).toBe(true);
      expect(r.data as Record<string, unknown>).not.toHaveProperty('enforceFieldSecurity');
    }
  });

  it('refuses a non-boolean as a TYPE error, never as an unknown key', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { enforceFieldSecurity: 'yes' });
      expect(r.success).toBe(false);
      // The discrimination that matters: a key the schema does not know at all
      // reports `unrecognized_keys`. This one reports a value problem, which is
      // only possible because the key IS declared.
      expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
      expect(r.error!.issues.some((i) => i.code === 'invalid_type')).toBe(true);
    }
  });
});

describe('#18159 — `redactFields` is declared on all three blocks', () => {
  it('parses GREEN with the key set, and keeps the authored list', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { redactFields: ['salary', 'ssn'] });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).redactFields).toEqual(['salary', 'ssn']);
    }
  });

  it('accepts the empty list — "redact nothing", explicitly', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { redactFields: [] });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).redactFields).toEqual([]);
    }
  });

  it('refuses a bare string and a non-string member as TYPE errors, never as unknown keys', () => {
    for (const type of BLOCKS) {
      for (const bad of ['salary', [1]] as unknown[]) {
        const r = parse(type, { redactFields: bad });
        expect(r.success).toBe(false);
        expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
      }
    }
  });

  it('coexists with `enforceFieldSecurity` — the renderer folds them in ONE pass, so the contract must accept both at once', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { enforceFieldSecurity: true, redactFields: ['salary'] });
      expect(r.success).toBe(true);
    }
  });

  it('coexists with `record:details`\' neighbouring `hideFields` — two channels, one document', () => {
    const r = parse('record:details', { hideFields: ['name'], redactFields: ['salary'] });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).hideFields).toEqual(['name']);
    expect((r.data as Record<string, unknown>).redactFields).toEqual(['salary']);
  });
});

/** Instrument B: the keys a schema declares, read off zod's public `.shape`. */
const shapeKeys = (type: string): string[] =>
  Object.keys((ComponentPropsMap[type as keyof typeof ComponentPropsMap] as { shape?: object }).shape ?? {});

/** Instrument B, map-wide: every `ComponentPropsMap` row declaring `key`. */
const declaring = (key: string) =>
  Object.entries(ComponentPropsMap)
    .filter(([, schema]) => Object.keys((schema as { shape?: object }).shape ?? {}).includes(key))
    .map(([type]) => type)
    .sort();

/** One lit `aria` value — accepted on all three blocks, so the probe can say yes. */
const ARIA = { ariaLabel: 'Record block' };

describe('#18159 — `requiredPermissions` is declared on the three blocks (instruments A and B)', () => {
  it.each(BLOCKS)('A · %s parses GREEN with the key set — the whole document, beside the lit control `aria`', (type) => {
    // Lit control first, on the same block and the same base document: a probe
    // that cannot say yes to a key known to be declared proves nothing below.
    expect(parse(type, { aria: ARIA }).success).toBe(true);

    const r = parse(type, { requiredPermissions: ['crm.manage'] });
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>).requiredPermissions).toEqual(['crm.manage']);

    // And both at once — the key does not displace its neighbours.
    expect(parse(type, { aria: ARIA, requiredPermissions: ['crm.manage'] }).success).toBe(true);
  });

  it.each(BLOCKS)('B · %s lists the key in its `.shape`, beside the lit control `aria`', (type) => {
    const keys = shapeKeys(type);
    expect(keys).toContain('aria');
    expect(keys).toContain('requiredPermissions');
  });

  it('B · the census: exactly the three blocks and `record:quick_actions` declare it — lit controls `aria` and `fields` fire on the same instrument', () => {
    expect(declaring('requiredPermissions')).toEqual([...BLOCKS, 'record:quick_actions'].sort());
    // Controls: the census can find a key at all, and finds the blocks under
    // test when it should. `fields` is declared on two of the three (the related
    // list's column key is `columns`), which is itself a discriminating reading.
    const aria = declaring('aria');
    for (const type of BLOCKS) expect(aria).toContain(type);
    expect(aria.length).toBeGreaterThan(BLOCKS.length);
    const fields = declaring('fields');
    expect(fields).toContain('record:details');
    expect(fields).toContain('record:highlights');
    expect(fields).not.toContain('record:related_list');
  });

  it('names are capabilities, not object actions: any string is a legal element, `read` as much as `crm.manage`', () => {
    for (const type of BLOCKS) {
      const r = parse(type, { requiredPermissions: ['crm.manage', 'read'] });
      expect(r.success).toBe(true);
      expect((r.data as Record<string, unknown>).requiredPermissions).toEqual(['crm.manage', 'read']);
    }
  });

  it('accepts the empty list, and carries NO schema default — an absent key stays absent', () => {
    for (const type of BLOCKS) {
      const empty = parse(type, { requiredPermissions: [] });
      expect(empty.success).toBe(true);
      expect((empty.data as Record<string, unknown>).requiredPermissions).toEqual([]);
      const absent = parse(type, {});
      expect(absent.success).toBe(true);
      expect(absent.data as Record<string, unknown>).not.toHaveProperty('requiredPermissions');
    }
  });

  it('refuses a bare string and a non-string member as TYPE errors, never as unknown keys', () => {
    for (const type of BLOCKS) {
      for (const bad of ['crm.manage', [1]] as unknown[]) {
        const r = parse(type, { requiredPermissions: bad });
        expect(r.success).toBe(false);
        expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(false);
      }
    }
  });

  it('one key, one text: the four record blocks declare it IDENTICALLY — shape and describe, word for word', () => {
    const declaration = (schema: { shape: Record<string, z.ZodType> }) =>
      JSON.stringify(z.toJSONSchema(schema.shape.requiredPermissions!, { io: 'input' }));
    const reference = declaration(RecordQuickActionsProps as unknown as { shape: Record<string, z.ZodType> });
    for (const schema of [RecordDetailsProps, RecordHighlightsProps, RecordRelatedListProps]) {
      expect(declaration(schema as unknown as { shape: Record<string, z.ZodType> })).toBe(reference);
    }
    // The comparison is not vacuous: the shared declaration is an optional
    // string array that carries a describe.
    const qa = (RecordQuickActionsProps as unknown as { shape: Record<string, z.ZodType> }).shape.requiredPermissions!;
    expect(qa.safeParse(undefined).success).toBe(true);
    expect(qa.safeParse(['a']).success).toBe(true);
    expect(qa.safeParse('a').success).toBe(false);
    expect(typeof qa.description).toBe('string');
    expect((qa.description ?? '').length).toBeGreaterThan(0);
  });
});

describe('#18159 — the pair was declared on THESE blocks only', () => {
  it('the sibling `record:quick_actions` still refuses both keys — no spray', () => {
    for (const key of ['enforceFieldSecurity', 'redactFields'] as const) {
      const r = RecordQuickActionsProps.safeParse({
        [key]: key === 'enforceFieldSecurity' ? true : ['salary'],
      });
      expect(r.success).toBe(false);
      expect(r.error!.issues.some((i) => i.code === 'unrecognized_keys')).toBe(true);
    }
  });

  it('exactly three rows in `ComponentPropsMap` declare each key', () => {
    expect(declaring('enforceFieldSecurity')).toEqual([...BLOCKS].sort());
    expect(declaring('redactFields')).toEqual([...BLOCKS].sort());
  });
});
