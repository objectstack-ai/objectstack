// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { apiTriggerSecretRefOf, apiTriggerSecretRefRefusals } from './api-trigger-secret-ref.zod';
import { FlowSchema } from './flow.zod';

// `config.secretRef` — an `api` flow's start node names its inbound hook's
// secret instead of carrying it, so an app package can ship the flow without
// publishing the credential. These pins hold the contract half: the accepted
// form parses whole, and each refusal lands on the start node's `secretRef`.

function flow(type: string, config: Record<string, unknown>) {
  return {
    name: 'srm_heartbeat',
    label: 'Heartbeat',
    type,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', config },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };
}

function refusalAt(result: ReturnType<typeof FlowSchema.safeParse>) {
  expect(result.success).toBe(false);
  const issues = result.error!.issues.filter((i) => i.path.join('.') === 'nodes.0.config.secretRef');
  expect(issues).toHaveLength(1);
  return issues[0]!;
}

describe('config.secretRef — an api flow names its hook secret', () => {
  it('a type api flow whose start node names its secret parses whole, the reference served as written', () => {
    const result = FlowSchema.safeParse(flow('api', { hookId: 'heartbeat', secretRef: 'SRM_HEARTBEAT_SECRET' }));
    expect(result.success).toBe(true);
    expect(result.data!.nodes[0]!.config).toEqual({ hookId: 'heartbeat', secretRef: 'SRM_HEARTBEAT_SECRET' });
  });

  it("a start node triggerType: 'api' binds the hook too, so the reference is read there", () => {
    expect(FlowSchema.safeParse(flow('autolaunched', { triggerType: 'api', secretRef: '_HOOK_KEY_2' })).success).toBe(true);
  });

  it('refuses a reference that is not a name — blank, spaced, a literal-looking value, a non-string', () => {
    for (const bad of ['', ' SRM_SECRET', 'srm-secret', 'whsec_9f8e/7d6c', 42, null, { env: 'X' }]) {
      const issue = refusalAt(FlowSchema.safeParse(flow('api', { secretRef: bad })));
      expect(issue.code).toBe('custom');
    }
  });

  it('refuses a name in the platform OS_ namespace, whatever its case', () => {
    for (const reserved of ['OS_AUTH_SECRET', 'os_auth_secret']) {
      expect(refusalAt(FlowSchema.safeParse(flow('api', { secretRef: reserved }))).message).toMatch(/`OS_` namespace/);
    }
  });

  it('refuses secretRef beside a literal secret — the cleared form included', () => {
    for (const secret of ['literal-value', '']) {
      const issue = refusalAt(FlowSchema.safeParse(flow('api', { secret, secretRef: 'SRM_HEARTBEAT_SECRET' })));
      expect(issue.message).toMatch(/both `config\.secret` and `config\.secretRef`/);
    }
  });

  it('refuses a reference on a flow that binds no api trigger — nothing would read it', () => {
    const issue = refusalAt(FlowSchema.safeParse(flow('autolaunched', { secretRef: 'SRM_HEARTBEAT_SECRET' })));
    expect(issue.message).toMatch(/binds no inbound `api` trigger/);
    // A record token outranks `type: 'api'` in the binding chain, so that flow binds the record trigger.
    refusalAt(FlowSchema.safeParse(flow('api', {
      objectName: 'task', triggerType: 'record-after-create', secretRef: 'SRM_HEARTBEAT_SECRET',
    })));
  });

  it('apiTriggerSecretRefOf answers the usable name only', () => {
    expect(apiTriggerSecretRefOf({ secretRef: 'SRM_HEARTBEAT_SECRET' })).toBe('SRM_HEARTBEAT_SECRET');
    expect(apiTriggerSecretRefOf({ secretRef: 'OS_AUTH_SECRET' })).toBeUndefined();
    expect(apiTriggerSecretRefOf({ secretRef: '' })).toBeUndefined();
    expect(apiTriggerSecretRefOf({ secret: 'x' })).toBeUndefined();
    expect(apiTriggerSecretRefOf(undefined)).toBeUndefined();
  });

  it('a start node without secretRef raises nothing here', () => {
    expect(apiTriggerSecretRefRefusals(flow('api', { secret: 'x' }))).toEqual([]);
    expect(apiTriggerSecretRefRefusals('not a flow')).toEqual([]);
  });
});
