// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_ORGANIZATION_KEY,
  ScheduleOrganizationSchema,
  describeMissingScheduleOrganization,
  findScheduleOrganizationNearMissInConfig,
  resolveScheduleOrganization,
} from './schedule-organization.zod';

// [#16659] The declaration side of the acting-organization ruling. Two
// consumers read this module and they must not be able to disagree about what
// counts as DECLARED: the automation engine lifts the value onto the trigger
// binding (`resolveTriggerBinding`), and both time triggers refuse a binding
// that resolves to nothing. A value one layer calls usable and the other calls
// missing reopens the silent hole the card closed.

function flow(config?: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    name: 'nightly_sweep',
    label: 'Nightly sweep',
    type: 'schedule',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', ...(config ? { config } : {}) },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    ...extra,
  };
}

describe('SCHEDULE_ORGANIZATION_KEY', () => {
  it('is the bare `organization` spelling the refusal tells authors to write', () => {
    // The constant, the refusal sentence and the docs all have to name ONE
    // spelling; every other spelling in this area is a near-miss by definition.
    expect(SCHEDULE_ORGANIZATION_KEY).toBe('organization');
    expect(describeMissingScheduleOrganization('f')).toContain('`organization`');
  });
});

describe('ScheduleOrganizationSchema', () => {
  it('accepts any non-empty string, including a non-`org_` id', () => {
    // Deliberately not a pattern: organization ids are minted at runtime and a
    // deployment that migrated ids from elsewhere must not be refused by a
    // shape this layer invented. What is checked is that a value was DECLARED.
    expect(ScheduleOrganizationSchema.safeParse('org_msokm9oaz0cal87q').success).toBe(true);
    expect(ScheduleOrganizationSchema.safeParse('7f3c1e00-0000-4000-8000-000000000001').success).toBe(true);
  });

  it.each([
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { id: 'org_x' }],
  ])('refuses %s', (_label, value) => {
    expect(ScheduleOrganizationSchema.safeParse(value).success).toBe(false);
  });
});

describe('resolveScheduleOrganization', () => {
  it('reads the start node config', () => {
    expect(resolveScheduleOrganization(flow({ organization: 'org_a' }))).toBe('org_a');
  });

  it('answers undefined for a flow that declares none', () => {
    expect(resolveScheduleOrganization(flow({ schedule: { type: 'cron', expression: '0 1 * * *' } }))).toBeUndefined();
  });

  it('answers undefined for a present-but-unusable value', () => {
    // ⭐ The engine lifts this onto the binding and the trigger refuses on
    // `undefined`. Reporting an empty string as "declared" would arm a flow
    // with nothing to stamp — the exact green-and-wrong shape of the card.
    expect(resolveScheduleOrganization(flow({ organization: '' }))).toBeUndefined();
    expect(resolveScheduleOrganization(flow({ organization: 7 }))).toBeUndefined();
    expect(resolveScheduleOrganization(flow({ organization: { id: 'org_a' } }))).toBeUndefined();
  });

  it('is structural: anything that is not a flow answers undefined rather than throwing', () => {
    for (const input of [undefined, null, 42, 'flow', {}, { nodes: 'not-an-array' }, { nodes: [] }]) {
      expect(() => resolveScheduleOrganization(input)).not.toThrow();
      expect(resolveScheduleOrganization(input)).toBeUndefined();
    }
  });

  it('ignores an `organization` that is not on the START node', () => {
    const f = flow(undefined) as { nodes: Array<Record<string, unknown>> };
    f.nodes[1].config = { organization: 'org_on_the_end_node' };
    expect(resolveScheduleOrganization(f)).toBeUndefined();
  });
});

describe('findScheduleOrganizationNearMissInConfig', () => {
  it('takes the START NODE CONFIG — the record a trigger actually holds', () => {
    // ⛔ Not a flow. The only caller is a trigger, and the engine hands a
    // trigger the start node's `config`, never the flow.
    expect(findScheduleOrganizationNearMissInConfig({ organizationId: 'org_a' })).toBe('organizationId');
    expect(findScheduleOrganizationNearMissInConfig(flow({ organizationId: 'org_a' }))).toBeUndefined();
  });

  it.each(['organizationId', 'organization_id', 'organizationID', 'orgId', 'org_id', 'org', 'tenantId', 'tenant_id', 'tenant'])(
    'recognises `%s`',
    (key) => {
      expect(findScheduleOrganizationNearMissInConfig({ [key]: 'org_a' })).toBe(key);
    },
  );

  it('ignores a near-miss key present but empty or null', () => {
    // A key the author left blank is not evidence of the mistake the message
    // describes ("you wrote X, which is not this key").
    expect(findScheduleOrganizationNearMissInConfig({ organizationId: '' })).toBeUndefined();
    expect(findScheduleOrganizationNearMissInConfig({ organizationId: null })).toBeUndefined();
  });

  it('answers undefined for anything that is not a record', () => {
    for (const input of [undefined, null, 42, 'org_a', []]) {
      expect(() => findScheduleOrganizationNearMissInConfig(input)).not.toThrow();
      expect(findScheduleOrganizationNearMissInConfig(input)).toBeUndefined();
    }
  });
});

describe('describeMissingScheduleOrganization', () => {
  it('names the flow, the key, and the consequence an operator already saw', () => {
    const msg = describeMissingScheduleOrganization('nightly_sweep');
    expect(msg).toContain("'nightly_sweep'");
    expect(msg).toContain('`organization`');
    expect(msg).toContain('sys_automation_run');
    expect(msg).toContain('reports itself healthy');
  });

  it('names the near-miss spelling and never a value', () => {
    const msg = describeMissingScheduleOrganization('nightly_sweep', { nearMiss: 'organizationId' });
    expect(msg).toContain('`organizationId`');
    expect(msg).toContain('open');
  });

  it('says `time-relative` for the sweep and `scheduled` for the plain cadence', () => {
    expect(describeMissingScheduleOrganization('f', { kind: 'time_relative' })).toContain('time-relative flow');
    expect(describeMissingScheduleOrganization('f', { kind: 'schedule' })).toContain('scheduled flow');
    expect(describeMissingScheduleOrganization('f')).toContain('scheduled flow');
  });

  it('⛔ never offers a fallback: no organization is ever chosen for the author', () => {
    // The ruling forbids a silent default and forbids the platform
    // organization. The sentence must ASK for a value, not supply one.
    const msg = describeMissingScheduleOrganization('nightly_sweep', { nearMiss: 'orgId' });
    expect(msg).toContain('<sys_organization.id>');
    expect(msg).not.toMatch(/defaults? to/i);
    expect(msg).not.toMatch(/platform organization/i);
    expect(msg).toContain('no organization is ever chosen for it');
  });
});
