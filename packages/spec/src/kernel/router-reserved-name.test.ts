// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5] A name of a bucket 2/3 type never starts with `_`: the router
 * reserves `_`-led segments for its own (`_env`, `_status`, `_activation`, …).
 * These ten types are the ones whose name schema admitted a leading `_`
 * before (`^[a-z_][a-z0-9_]*$`); the rest of buckets 2–3 already spelled
 * names with `SnakeCaseIdentifierSchema`. Each now refuses it, naming the
 * reserved prefix, and keeps every letter-led name it accepted.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AgentSchema } from '../ai/agent.zod';
import { SkillSchema } from '../ai/skill.zod';
import { ToolSchema } from '../ai/tool.zod';
import { ApiEndpointSchema } from '../api/endpoint.zod';
import { FlowSchema } from '../automation/flow.zod';
import { CubeSchema } from '../data/analytics.zod';
import { HookSchema } from '../data/hook.zod';
import { ConnectorSchema, DeclarativeConnectorEntrySchema } from '../integration/connector.zod';
import { SharingRuleSchema } from '../security/sharing.zod';
import { defineStack } from '../stack.zod';
import { JobSchema } from '../system/job.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ROUTER_ADDRESSABLE_NAME_PATTERN } from './address-grammar';

const nameOf = (schema: unknown): z.ZodTypeAny =>
  (schema as { shape: { name: z.ZodTypeAny } }).shape.name;

const NAME_SCHEMAS: ReadonlyArray<readonly [string, z.ZodTypeAny]> = [
  ['tool', nameOf(ToolSchema)],
  ['skill', nameOf(SkillSchema)],
  ['agent', nameOf(AgentSchema)],
  ['flow', nameOf(FlowSchema)],
  ['hook', nameOf(HookSchema)],
  ['job', nameOf(JobSchema)],
  ['sharing rule', nameOf(SharingRuleSchema)],
  ['analytics cube', nameOf(CubeSchema)],
  ['api endpoint', nameOf(ApiEndpointSchema)],
  ['connector', nameOf(ConnectorSchema)],
  ['connector entry', nameOf(DeclarativeConnectorEntrySchema)],
];

describe('bucket 2/3 names refuse the router-reserved `_` prefix (ADR-0150 D5)', () => {
  it.each(NAME_SCHEMAS)('%s: refuses a `_`-led name, naming the reserved prefix', (_type, schema) => {
    for (const name of ['_send_email', '_env', '_status', '__x']) {
      const result = schema.safeParse(name);
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toMatch(/A leading "_" is reserved for the router/);
    }
  });

  it.each(NAME_SCHEMAS)('%s: keeps every letter-led snake_case name, prefixed or not', (_type, schema) => {
    for (const name of ['send_email', 'crm_send_email', 'a', 'v2_sync', 'x__y']) {
      expect(schema.safeParse(name).success).toBe(true);
    }
  });

  it('is the grammar the rest of buckets 2–3 already used', () => {
    for (const name of ['_x', 'x', 'crm_x', 'X', 'x-y']) {
      expect(ROUTER_ADDRESSABLE_NAME_PATTERN.test(name)).toBe(/^[a-z][a-z0-9_]*$/.test(name));
    }
    expect(SnakeCaseIdentifierSchema.safeParse('_x').success).toBe(false);
  });

  it('refuses a `_`-led flow at defineStack, naming the reserved prefix', () => {
    const manifest = { id: 'com.example.p', version: '1.0.0', type: 'app' as const, name: 'P', namespace: 'demo' };
    const flow = (name: string) => ({ name, label: 'F', type: 'autolaunched', nodes: [{ id: 'start', type: 'start', label: 'Start' }], edges: [] });
    expect(() => defineStack({ manifest, flows: [flow('_welcome')] } as never)).toThrow(/A leading "_" is reserved for the router/);
    expect(() => defineStack({ manifest, flows: [flow('welcome')] } as never)).not.toThrow();
  });
});
