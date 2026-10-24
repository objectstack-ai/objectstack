// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25514 — a `type: 'flow'` action's target resolves against the ARTIFACT once
 * the stack declares its siblings' flows (`DefineStackOptions.artifactFlows`),
 * and a flow NO package of the artifact defines stays refused.
 *
 * ## The defect
 *
 * `validateCrossReferences` built its flow scope from the stack's own `flows`
 * alone, so a sales action on an app-owned object launching a flow that a
 * module package of the SAME artifact ships was refused at `defineStack` —
 * measured downstream on HotCRM's module split as three "which is not defined
 * in flows." refusals, while the composed artifact carried all three flows.
 *
 * ## The two directions this file pins, per position
 *
 * - a sibling-provided flow is ACCEPTED at `defineStack` and at `composeStacks`;
 * - a flow no package provides is REFUSED — at `defineStack` when it is not
 *   claimed, and at `composeStacks` (the artifact pass) when it is claimed but
 *   no input defines it, with the per-stack pass's own message.
 *
 * Plus the fences: the option never switches the check on for a stack with no
 * flows of its own, and an input that did not opt in cannot newly fail at
 * composition even when it bypassed the strict parse.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';

const appManifest = {
  id: 'app.objectstack.hotcrm',
  name: 'HotCRM',
  version: '3.1.0',
  type: 'app' as const,
  namespace: 'crm',
};

const moduleManifest = {
  id: 'app.objectstack.hotcrm.revenue',
  name: 'HotCRM Revenue',
  version: '3.1.0',
  type: 'module' as const,
  namespace: 'crm',
  dependencies: { 'app.objectstack.hotcrm': '^3.1.0' },
};

const flow = (name: string) => ({ name, label: name, type: 'autolaunched' as const, nodes: [], edges: [] });

/** Owned by the module package — the flow every cross-package action launches. */
const SIBLING = 'quote_generation';
/** The flow NO package in the artifact defines. */
const NOWHERE = 'quote_nowhere';

const account = { name: 'crm_account', label: 'Account', fields: { title: { type: 'text' as const } } };
const quote = { name: 'crm_quote', label: 'Quote', fields: { title: { type: 'text' as const } } };

type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };

function refusalOf(run: () => unknown): Envelope | null {
  try {
    run();
    return null;
  } catch (e) {
    return e as Envelope;
  }
}

const anyStack = (config: Record<string, unknown>) => config as unknown as Parameters<typeof defineStack>[0];

/** The module package: owns `crm_quote` and the flow. */
const revenueStack = () =>
  defineStack(anyStack({ manifest: moduleManifest, objects: [quote], flows: [flow(SIBLING)] }));

/**
 * The app package: owns `crm_account` and a flow of its own (so the per-stack
 * flow check runs at all), and launches `target` from all three positions.
 */
const appConfig = (target: string, ownFlows = [flow('crm_local_flow')]) => anyStack({
  manifest: appManifest,
  objects: [
    {
      ...account,
      actions: [{ name: 'quote_from_account', label: 'Quote', type: 'flow', target }],
    },
  ],
  flows: ownFlows,
  actions: [{ name: 'generate_quote', label: 'Generate Quote', type: 'flow', target }],
  pages: [
    {
      name: 'crm_home',
      label: 'Home',
      type: 'home',
      regions: [
        {
          name: 'main',
          components: [
            {
              type: 'element:button',
              properties: { label: 'Go', action: { name: 'inline_quote', type: 'flow', target } },
            },
          ],
        },
      ],
    },
  ],
});

const messages = (target: string) => [
  `Action 'generate_quote' references flow '${target}' which is not defined in flows.`,
  `Action 'quote_from_account' on object 'crm_account' references flow '${target}' which is not defined in flows.`,
  `Inline action 'inline_quote' on page 'crm_home' (regions.0.components.0) references flow '${target}' which is not defined in flows.`,
];

describe('the per-stack pass, without the opt-in — unchanged', () => {
  it('REFUSES the sibling-provided flow from all three positions — the reported defect', () => {
    const refused = refusalOf(() => defineStack(appConfig(SIBLING)));
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues).toEqual(messages(SIBLING));
  });
});

describe('`artifactFlows` resolves a sibling package’s flow', () => {
  it('ACCEPTS all three positions at `defineStack`', () => {
    const revenue = revenueStack();
    expect(
      refusalOf(() => defineStack(appConfig(SIBLING), { artifactFlows: (revenue.flows ?? []).map((f) => f.name) })),
    ).toBeNull();
  });

  it('ACCEPTS the composed artifact — the claim is redeemed by the sibling', () => {
    const app = defineStack(appConfig(SIBLING), { artifactFlows: [SIBLING] });
    expect(refusalOf(() => composeStacks([revenueStack(), app], { manifest: 'preserve' }))).toBeNull();
  });

  it('keeps refusing a name it does NOT list, beside one it does', () => {
    const refused = refusalOf(() => defineStack(appConfig(NOWHERE), { artifactFlows: [SIBLING] }));
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.issues).toEqual(messages(NOWHERE));
  });
});

describe('the ARTIFACT pass: a claimed flow NO package defines is refused', () => {
  const composeClaiming = (name: string) => {
    const app = defineStack(appConfig(name), { artifactFlows: [name] });
    return refusalOf(() => composeStacks([revenueStack(), app], { manifest: 'preserve' }));
  };

  it('REFUSES every position with the per-stack pass’s own message and envelope', () => {
    const refused = composeClaiming(NOWHERE);
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues).toEqual(messages(NOWHERE));
    expect(refused?.message).toContain('composeStacks artifact cross-reference validation failed');
  });

  it('resolves against a nested multi-package input, whose flows live only in its package bodies', () => {
    const inner = composeStacks(
      [revenueStack(), defineStack(anyStack({ manifest: { ...moduleManifest, id: 'x.other' }, objects: [] }))],
      { manifest: 'preserve' },
    );
    const app = defineStack(appConfig(SIBLING), { artifactFlows: [SIBLING] });
    expect(refusalOf(() => composeStacks([inner, app], { manifest: 'preserve' }))).toBeNull();
  });
});

describe('fences', () => {
  it('a stack with NO flows of its own keeps the plugin leniency — the option switches nothing on', () => {
    const app = defineStack(appConfig(NOWHERE, []), { artifactFlows: [SIBLING] });
    // No claim was relied on, so the composition has nothing to redeem.
    expect(refusalOf(() => composeStacks([revenueStack(), app], { manifest: 'preserve' }))).toBeNull();
  });

  it('an input that did not opt in cannot newly fail at composition, even past `strict: false`', () => {
    const loose = defineStack(appConfig(NOWHERE), { strict: false });
    expect(refusalOf(() => composeStacks([revenueStack(), loose], { manifest: 'preserve' }))).toBeNull();
  });

  it('the claim record is not data — the built stack carries no new enumerable key', () => {
    const app = defineStack(appConfig(SIBLING), { artifactFlows: [SIBLING] });
    expect(Object.keys(app)).toEqual(Object.keys(defineStack(appConfig('crm_local_flow'))));
    expect(JSON.stringify(app)).not.toContain('artifact-flow-claims');
  });
});
