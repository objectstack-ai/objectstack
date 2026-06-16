// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  lintLivenessProperties,
  LIVENESS_DEAD_PROPERTY,
} from './lint-liveness-properties.js';

/**
 * These run against the REAL ledgers shipped by `@objectstack/spec` (the same
 * files the gate enforces), so they double as a contract test: if an
 * `authorWarn` annotation is removed from `enable.feeds` / `columnName` / etc.,
 * the matching assertion fails.
 */

const objStack = (obj: Record<string, unknown>) => ({ objects: [{ name: 'widget', ...obj }] });
const rules = (findings: { rule: string }[]) => findings.map((f) => f.rule);
const paths = (findings: { message: string }[]) => findings.map((f) => f.message);

describe('lintLivenessProperties', () => {
  it('warns on an authored dead capability flag (enable.feeds: true)', () => {
    const findings = lintLivenessProperties(objStack({ enable: { feeds: true } }));
    expect(findings.length).toBeGreaterThan(0);
    const feeds = findings.find((f) => f.message.includes('enable.feeds'));
    expect(feeds).toBeDefined();
    expect(feeds!.rule).toBe(LIVENESS_DEAD_PROPERTY);
    expect(feeds!.where).toBe("object 'widget'");
    expect(feeds!.hint.length).toBeGreaterThan(0);
  });

  it('does NOT warn on a default-on flag the author left alone (enable.trash: true)', () => {
    const findings = lintLivenessProperties(objStack({ enable: { trash: true } }));
    expect(paths(findings).some((m) => m.includes('enable.trash'))).toBe(false);
  });

  it('does NOT warn when a dead boolean flag is explicitly false (enable.files: false)', () => {
    const findings = lintLivenessProperties(objStack({ enable: { files: false } }));
    expect(paths(findings).some((m) => m.includes('enable.files'))).toBe(false);
  });

  it('warns on a present dead object block (versioning)', () => {
    const findings = lintLivenessProperties(objStack({ versioning: { enabled: true } }));
    expect(paths(findings).some((m) => m.includes('versioning'))).toBe(true);
  });

  it('warns on a misleading dead field prop (columnName)', () => {
    const findings = lintLivenessProperties(
      objStack({ fields: [{ name: 'code', type: 'text', columnName: 'legacy_code' }] }),
    );
    const f = findings.find((x) => x.message.includes('columnName'));
    expect(f).toBeDefined();
    expect(f!.where).toBe("object 'widget' · field 'code'");
  });

  it('warns on a field-level index flag set true, but not when false', () => {
    const on = lintLivenessProperties(objStack({ fields: [{ name: 'code', type: 'text', index: true }] }));
    expect(paths(on).some((m) => m.includes('`index`'))).toBe(true);
    const off = lintLivenessProperties(objStack({ fields: [{ name: 'code', type: 'text', index: false }] }));
    expect(paths(off).some((m) => m.includes('`index`'))).toBe(false);
  });

  it('is silent for a clean object with only live properties', () => {
    const findings = lintLivenessProperties(
      objStack({
        label: 'Widget',
        enable: { apiEnabled: true },
        fields: [{ name: 'name', type: 'text', label: 'Name' }],
      }),
    );
    expect(findings).toEqual([]);
  });

  it('handles objects as a keyed record (not just arrays)', () => {
    const findings = lintLivenessProperties({
      objects: { widget: { name: 'widget', enable: { feeds: true } } },
    });
    expect(rules(findings)).toContain(LIVENESS_DEAD_PROPERTY);
  });

  it('returns [] on an empty / shapeless stack', () => {
    expect(lintLivenessProperties({})).toEqual([]);
    expect(lintLivenessProperties({ objects: [] })).toEqual([]);
  });
});
