// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6036 — `sys_setting.scope` once declared a fourth option, `runtime`, that
// nothing in the platform could produce or consume: `SpecifierScopeSchema` is
// three-valued, `SettingsService` never mentions the string, and every write
// reaches the table through `set()`/`setMany()`, whose scope comes from the
// manifest registry (`reg.scopes`) — i.e. from that same three-value enum.
// A declared-but-unenforced value domain of exactly the ADR-0049 kind.
//
// These pins make the divergence loud instead of dormant. The load-bearing one
// is the PARITY assertion: the storage column's option list and the spec enum
// are two spellings of one truth, so they are compared to each other rather
// than to a hand-copied literal that would need editing on both sides anyway.
// A future fourth cascade layer therefore lands here as a red test, not as a
// silent re-divergence.
//
// [ADR-0131 D7] Since the global rung moved to the tenant-less
// `sys_platform_setting`, this table stores the cascade's OTHER layers: its
// option list is the spec enum minus `global`, and that difference is pinned
// as such. The audit trail still records every layer, `global` included.
import { describe, expect, it } from 'vitest';
import { SpecifierScopeSchema } from '@objectstack/spec/system';
import { SysSetting } from './sys-setting.object.js';
import { SysSettingAudit } from './sys-setting-audit.object.js';

/** Declared option values of a select field, in declaration order. */
function optionValues(object: unknown, field: string): string[] {
  const f = (object as any).fields?.[field];
  expect(f, `${field} field exists`).toBeDefined();
  expect(f.type).toBe('select');
  return ((f.options ?? []) as Array<{ value: unknown }>).map((o) => String(o.value));
}

describe('sys_setting.scope — value domain (#6036)', () => {
  it('declares exactly the cascade layers this table stores', () => {
    expect(optionValues(SysSetting, 'scope')).toEqual(['tenant', 'user']);
  });

  it('[ADR-0131 D7] does not declare `global` — that rung is stored in sys_platform_setting', () => {
    // Its own case because re-adding the option breaks nothing at runtime:
    // the service never writes such a row and excludes one from its reads.
    expect(optionValues(SysSetting, 'scope')).not.toContain('global');
  });

  it('does not declare a `runtime` layer', () => {
    // Spelled as its own case because THIS is the regression: the option was
    // inert, so re-adding it breaks nothing at runtime and would otherwise
    // sail through review a second time.
    expect(optionValues(SysSetting, 'scope')).not.toContain('runtime');
  });

  it('matches SpecifierScopeSchema minus the global rung — the reference truth for the cascade', () => {
    // Set-compare: the spec enum is the authority on which layers exist, the
    // object definition is the storage mirror of the layers stored HERE. Either
    // side growing alone is the #6036 defect, in whichever direction it
    // happens next.
    expect([...optionValues(SysSetting, 'scope')].sort()).toEqual(
      SpecifierScopeSchema.options.filter((s) => s !== 'global').sort(),
    );
  });

  it('the audit trail object records EVERY layer — the global rung\'s changes included', () => {
    // `buildSettingAuditWriter` writes the changed key's scope, and a
    // global-scope change is still a change: the audit option list is the
    // full spec enum, not this table's subset.
    expect([...optionValues(SysSettingAudit, 'scope')].sort()).toEqual(
      [...SpecifierScopeSchema.options].sort(),
    );
  });

  it('keeps `tenant` as the default, and the default is a declared option', () => {
    const f = (SysSetting as any).fields.scope;
    expect(f.defaultValue).toBe('tenant');
    expect(optionValues(SysSetting, 'scope')).toContain(f.defaultValue);
  });
});
