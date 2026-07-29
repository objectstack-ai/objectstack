// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit tests for the empty-state gate (#3896 follow-up).
//
// Two things are worth failing over here. The gate must catch the sentence that
// shipped the original bug — and it must stay quiet on the many innocent lines
// that look like it, because a check that cries wolf is a check that gets
// skipped, which is how the sentence shipped in the first place.

import { describe, it, expect } from 'vitest';

import { scanSource, resolveProperty, checkEmptyState } from './empty-state.mts';
import { EMPTY_STATE_REGISTRY } from './empty-state-registry.mts';
import type { EmptyStateEntry } from './empty-state-registry.mts';

const all = () => true;

/** Build a one-file source map for `checkEmptyState`. */
const sourcesOf = (file: string, source: string) => new Map([[file, source]]);

describe('scanSource — statements it must catch', () => {
  it('catches the sentence #3896 shipped', () => {
    const hits = scanSource(
      'f.zod.ts',
      [
        '  /** Criteria for the rule. Leave empty to share every record. */',
        '  criteria: z.record(z.string(), z.unknown()).optional(),',
      ].join('\n'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.property).toBe('criteria');
  });

  it('catches `empty = all` inside a describe argument', () => {
    const hits = scanSource(
      'f.zod.ts',
      [
        '  includeObjects: z.array(z.string()).optional()',
        "    .describe('Objects to replicate (empty = all)'),",
      ].join('\n'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.property).toBe('includeObjects');
  });

  it('catches `absent = default-allow`', () => {
    const hits = scanSource('f.zod.ts', "  apiOperations: z.array(x).optional().describe('absent = default-allow'),");
    expect(hits.map((h) => h.property)).toEqual(['apiOperations']);
  });

  it('catches a permissive empty state in a JSDoc line above the property', () => {
    const hits = scanSource(
      'f.zod.ts',
      ['  /**', '   * Allowed plugin sources (empty = all allowed)', '   */', '  allowedSources: z.array(x).optional(),'].join('\n'),
    );
    expect(hits.map((h) => h.property)).toEqual(['allowedSources']);
  });

  it('catches filler words between the separator and the permissive token', () => {
    const hits = scanSource('f.zod.ts', "  errorCode: z.string().optional().describe('(empty = catch all errors)'),");
    expect(hits).toHaveLength(1);
  });
});

describe('scanSource — lines it must stay quiet on', () => {
  it('ignores code that merely assigns something named `empty`', () => {
    expect(scanSource('f.zod.ts', '  const empty = { all: true };')).toEqual([]);
  });

  it('ignores a NEGATED permissive token — `deny-all` is the opposite of the hazard', () => {
    // object.zod.ts prints this precisely to warn that an empty whitelist closes
    // the object. Flagging it would invert the gate's meaning.
    const hits = scanSource('f.zod.ts', '  // After stripping, this whitelist is EMPTY — `[]` means DENY-ALL (fully closed)');
    expect(hits).toEqual([]);
  });

  it('ignores a bare deprecation instruction with no permissive consequence', () => {
    const hits = scanSource('f.zod.ts', "  environmentId: z.string().optional().describe('Deprecated. New writes leave unset.'),");
    expect(hits).toEqual([]);
  });

  it('does not treat `:` as a separator — every schema line has one', () => {
    const hits = scanSource('f.zod.ts', '   * guards pin those keys to `undefined`: a body carrying any of them is a record');
    expect(hits).toEqual([]);
  });

  it('ignores "no grants" — an empty state that is already restrictive', () => {
    expect(scanSource('f.zod.ts', '  // a per-object grant map; empty = no grants yet.')).toEqual([]);
  });
});

describe('resolveProperty — direction matters', () => {
  const lines = [
    '  /** Doc above its property. */', // 0
    '  docProp: z.string(),', // 1
    '', // 2
    '  describedProp: z.string()', // 3
    "    .describe('trailing describe below its property'),", // 4
  ];

  it('resolves a doc comment FORWARD to the property beneath it', () => {
    expect(resolveProperty(lines, 0)).toBe('docProp');
  });

  it('resolves a describe argument BACKWARD to the property above it', () => {
    // Searching forward here would attribute the statement to the NEXT property
    // down the file — the mis-attribution that showed up on explain.zod.ts.
    expect(resolveProperty(lines, 4)).toBe('describedProp');
  });

  it('prefers the property on the matched line itself', () => {
    expect(resolveProperty(["  inline: z.string().describe('empty = all'),"], 0)).toBe('inline');
  });
});

describe('checkEmptyState — the ratchet', () => {
  const file = 'packages/spec/src/x.zod.ts';
  const permissive = ["  thing: z.array(z.string()).optional()", "    .describe('Scope (empty = all)'),"].join('\n');

  const entry = (over: Partial<EmptyStateEntry> = {}): EmptyStateEntry => ({
    file,
    property: 'thing',
    semantics: 'scope',
    rationale: 'selects work, grants nothing',
    ...over,
  });

  it('FAILS on a permissive empty state nobody classified', () => {
    const { findings } = checkEmptyState({ sources: sourcesOf(file, permissive), registry: [], exists: all });
    expect(findings.map((f) => f.kind)).toEqual(['unregistered']);
    expect(findings[0]?.property).toBe('thing');
  });

  it('passes once it is classified', () => {
    const { findings } = checkEmptyState({ sources: sourcesOf(file, permissive), registry: [entry()], exists: all });
    expect(findings).toEqual([]);
  });

  it('FAILS on a stale entry whose statement is gone', () => {
    const { findings } = checkEmptyState({
      sources: sourcesOf(file, '  thing: z.array(z.string()).optional(),'),
      registry: [entry()],
      exists: all,
    });
    expect(findings.map((f) => f.kind)).toEqual(['stale']);
  });

  it('exempts `closed` entries from staleness — a closed gate has no permissive prose to find', () => {
    const { findings } = checkEmptyState({
      sources: sourcesOf(file, '  thing: z.array(z.string()),'),
      registry: [entry({ semantics: 'closed', evidence: 'packages/spec/src/x.zod.ts' })],
      exists: all,
    });
    expect(findings).toEqual([]);
  });

  it('FAILS an access-gate classification with no evidence', () => {
    const { findings } = checkEmptyState({
      sources: sourcesOf(file, permissive),
      registry: [entry({ semantics: 'open' })],
      exists: all,
    });
    expect(findings.map((f) => f.kind)).toEqual(['missing-evidence']);
  });

  it('FAILS on evidence that no longer resolves', () => {
    const { findings } = checkEmptyState({
      sources: sourcesOf(file, permissive),
      registry: [entry({ semantics: 'open', evidence: 'packages/spec/src/gone.ts' })],
      exists: () => false,
    });
    expect(findings.map((f) => f.kind)).toEqual(['rotted-evidence']);
  });

  it('FAILS an entry with no rationale — the classification must be a decision', () => {
    const { findings } = checkEmptyState({
      sources: sourcesOf(file, permissive),
      registry: [entry({ rationale: '  ' })],
      exists: all,
    });
    expect(findings.map((f) => f.kind)).toContain('missing-rationale');
  });

  it('does not require evidence of `scope` / `output` — they have no enforcement site', () => {
    const { findings } = checkEmptyState({
      sources: sourcesOf(file, permissive),
      registry: [entry({ semantics: 'output' })],
      exists: () => false,
    });
    expect(findings).toEqual([]);
  });

  it('reports narrative prose as a NOTE, not a failure', () => {
    const narrative = ['/**', ' * A past bug: a missing criteria became the empty filter → every record.', ' */', 'export const X = 1;'].join('\n');
    const { findings, notes } = checkEmptyState({ sources: sourcesOf(file, narrative), registry: [], exists: all });
    expect(findings).toEqual([]);
    expect(notes.map((n) => n.kind)).toEqual(['unresolved']);
  });
});

describe('the shipped registry', () => {
  it('gives every entry a rationale', () => {
    const bare = EMPTY_STATE_REGISTRY.filter((e) => !e.rationale?.trim());
    expect(bare).toEqual([]);
  });

  it('gives every access-gate entry an evidence pointer', () => {
    const gates = EMPTY_STATE_REGISTRY.filter((e) => e.semantics === 'closed' || e.semantics === 'open');
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.filter((e) => !e.evidence?.trim())).toEqual([]);
  });

  it('has no duplicate file#property keys', () => {
    const keys = EMPTY_STATE_REGISTRY.map((e) => `${e.file}#${e.property}`);
    expect(keys).toEqual([...new Set(keys)]);
  });

  it('records the #3896 gate itself, so "what does an empty criteria do?" is answerable', () => {
    const criteria = EMPTY_STATE_REGISTRY.find((e) => e.property === 'condition' && e.file.endsWith('sharing.zod.ts'));
    expect(criteria?.semantics).toBe('closed');
  });
});
