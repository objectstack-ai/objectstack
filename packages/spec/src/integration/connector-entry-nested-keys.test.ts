// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// An authored connector entry (`DeclarativeConnectorEntrySchema`, behind
// `defineConnector()`, `defineStack({ connectors })`, `os validate` /
// `os compile`, the artifact load and `PUT /meta/connector/:name`) refuses a
// key its two nested shapes do not declare — inside `retryConfig`, and inside
// each `actions` element — as it refuses one at its own top level. Every
// refusal is pinned by its issue `code`, `path` and `keys`, with a CONTROL
// accept beside it. The open carriers a plugin's connector def and the runtime
// use (`ConnectorSchema`, `RetryConfigSchema`, `ConnectorActionSchema`) keep
// their posture, pinned as controls.
//
// Every value below is an obviously-fake placeholder, and the refusal must
// never echo it.

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  ConnectorActionSchema,
  ConnectorSchema,
  DeclarativeConnectorEntrySchema,
  RetryConfigSchema,
  defineConnector,
} from './connector.zod';
import { ObjectStackDefinitionSchema } from '../stack.zod';

const PLACEHOLDER = 'TEST_PLACEHOLDER_NOT_A_SECRET';

const INSTANCE = {
  name: 'vendor',
  label: 'Vendor',
  type: 'api',
  provider: 'rest',
  providerConfig: { baseUrl: 'https://vendor.example.com' },
  auth: { type: 'bearer', credentialRef: 'VENDOR_TOKEN' },
} as const;

const DESCRIPTOR = { name: 'erp', label: 'ERP', type: 'saas' } as const;

const RETRY = { strategy: 'exponential_backoff', maxAttempts: 2, initialDelayMs: 500, jitter: false } as const;
const ACTION = { key: 'get_invoice', label: 'Get invoice', description: 'One invoice.', effect: 'read', inputSchema: { type: 'object' } } as const;

/** The one issue of a refused parse, as `[code, path, keys]`, and its message. */
function refusal(input: unknown): { located: [string, string, unknown]; message: string } {
  const result = DeclarativeConnectorEntrySchema.safeParse(input);
  expect(result.success, 'the entry must be refused').toBe(false);
  expect(result.error!.issues, JSON.stringify(result.error!.issues)).toHaveLength(1);
  const issue = result.error!.issues[0]!;
  return { located: [issue.code, issue.path.join('.'), (issue as { keys?: unknown }).keys], message: issue.message };
}

describe('an authored connector entry refuses a key its nested shapes do not declare', () => {
  it.each([
    ['an instance with every declared `retryConfig` key', { ...INSTANCE, retryConfig: RETRY }],
    ['a descriptor with every declared action key', { ...DESCRIPTOR, actions: [ACTION, { key: 'list', label: 'List' }] }],
    ['an empty `retryConfig` (clears the policy)', { ...INSTANCE, retryConfig: {} }],
  ] as const)('CONTROL: %s parses', (_label, entry) => {
    expect(DeclarativeConnectorEntrySchema.safeParse(entry).success).toBe(true);
  });

  it.each([
    ['a credential-shaped key', { secret: PLACEHOLDER }, ['secret']],
    ['a misspelled policy key', { maxRetries: 4 }, ['maxRetries']],
    ['several keys', { secret: PLACEHOLDER, timeoutMs: 100 }, ['secret', 'timeoutMs']],
  ] as const)('`retryConfig` with %s is refused at `retryConfig`', (_label, extra, keys) => {
    const { located, message } = refusal({ ...INSTANCE, retryConfig: { ...RETRY, ...extra } });
    expect(located).toEqual(['unrecognized_keys', 'retryConfig', keys]);
    expect(message).not.toContain(PLACEHOLDER);
  });

  it.each([
    ['a credential-shaped key', { token: PLACEHOLDER }, ['token']],
    ['an execution binding', { method: 'GET', path: '/invoices/{id}' }, ['method', 'path']],
  ] as const)('an `actions` element with %s is refused at that element', (_label, extra, keys) => {
    const { located, message } = refusal({ ...DESCRIPTOR, actions: [{ key: 'list', label: 'List' }, { ...ACTION, ...extra }] });
    expect(located).toEqual(['unrecognized_keys', 'actions.1', keys]);
    expect(message).not.toContain(PLACEHOLDER);
  });

  it('inside a stack, the issue is located under the entry', () => {
    const result = ObjectStackDefinitionSchema.safeParse({
      manifest: { id: 'com.example.app', name: 'app', version: '1.0.0', type: 'app' },
      connectors: [{ ...INSTANCE, retryConfig: { ...RETRY, secret: PLACEHOLDER } }],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join('.'))).toContain('connectors.0.retryConfig');
  });

  it('`defineConnector()` refuses it too, and accepts the declared keys', () => {
    let thrown: unknown;
    try {
      defineConnector({ ...DESCRIPTOR, actions: [{ ...ACTION, token: PLACEHOLDER } as never] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown, 'defineConnector must refuse the undeclared action key').toBeInstanceOf(ZodError);
    expect((thrown as ZodError).issues.map((issue) => [issue.code, issue.path.join('.'), (issue as { keys?: unknown }).keys]))
      .toEqual([['unrecognized_keys', 'actions.0', ['token']]]);
    expect(() => defineConnector({ ...DESCRIPTOR, actions: [ACTION] })).not.toThrow();
  });

  it('CONTROL: the open carriers keep their posture (an undeclared nested key is dropped, not refused)', () => {
    const def = ConnectorSchema.parse({ ...DESCRIPTOR, retryConfig: { ...RETRY, secret: PLACEHOLDER }, actions: [{ ...ACTION, token: PLACEHOLDER }] });
    expect(JSON.stringify(def)).not.toContain(PLACEHOLDER);
    expect(RetryConfigSchema.safeParse({ ...RETRY, secret: PLACEHOLDER }).success).toBe(true);
    expect(ConnectorActionSchema.safeParse({ ...ACTION, token: PLACEHOLDER }).success).toBe(true);
  });

  describe('the prescription each refusal carries', () => {
    const CREDENTIAL = ['connector metadata never holds a credential', 'auth: { type, credentialRef }'];
    const BINDING = ['an action carries no execution binding (ADR-0097 §5)', 'derives its actions from the upstream'];

    it.each(['secret', 'token', 'apiKey', 'key', 'password', 'credentials', 'credentialRef'])(
      'a credential-shaped `%s` inside `retryConfig` meets the entry\'s credential prescription',
      (name) => {
        const { located, message } = refusal({ ...INSTANCE, retryConfig: { ...RETRY, [name]: PLACEHOLDER } });
        expect(located).toEqual(['unrecognized_keys', 'retryConfig', [name]]);
        for (const needle of CREDENTIAL) expect(message).toContain(needle);
        expect(message).not.toContain(PLACEHOLDER);
      },
    );

    it.each(['secret', 'token', 'apiKey', 'password', 'credentialRef'])(
      'a credential-shaped `%s` inside an `actions` element meets the entry\'s credential prescription',
      (name) => {
        const { located, message } = refusal({ ...DESCRIPTOR, actions: [{ ...ACTION, [name]: PLACEHOLDER }] });
        expect(located).toEqual(['unrecognized_keys', 'actions.0', [name]]);
        for (const needle of CREDENTIAL) expect(message).toContain(needle);
        expect(message).not.toContain(PLACEHOLDER);
      },
    );

    it.each(['method', 'path', 'url'])('an execution binding `%s` on an action meets ADR-0097 §5\'s prescription', (name) => {
      const { located, message } = refusal({ ...DESCRIPTOR, actions: [{ ...ACTION, [name]: 'x' }] });
      expect(located).toEqual(['unrecognized_keys', 'actions.0', [name]]);
      for (const needle of BINDING) expect(message).toContain(needle);
    });

    it('CONTROL: an action\'s own `key` is its declared machine name, never a misplaced credential', () => {
      expect(DeclarativeConnectorEntrySchema.safeParse({ ...DESCRIPTOR, actions: [ACTION] }).success).toBe(true);
    });
  });

  it('the closed nested shapes declare exactly the open shapes\' keys, as the same field instances', () => {
    const entry = DeclarativeConnectorEntrySchema.safeParse({ ...INSTANCE, retryConfig: RETRY });
    expect(entry.success).toBe(true);
    const shapeOf = (schema: unknown) => (schema as { shape: Record<string, unknown> }).shape;
    const unwrapped = (schema: unknown): unknown => {
      let node = schema as { unwrap?: () => unknown; shape?: unknown };
      while (node.shape === undefined && typeof node.unwrap === 'function') node = node.unwrap() as typeof node;
      return node;
    };
    const entryShape = shapeOf(DeclarativeConnectorEntrySchema);
    const retryTwin = shapeOf(unwrapped(entryShape.retryConfig));
    const actionTwin = shapeOf(unwrapped(unwrapped(entryShape.actions)));
    const retryKeys = Object.keys(shapeOf(RetryConfigSchema)).sort();
    const actionKeys = Object.keys(shapeOf(ConnectorActionSchema)).sort();
    expect(Object.keys(retryTwin).sort()).toEqual(retryKeys);
    expect(Object.keys(actionTwin).sort()).toEqual(actionKeys);
    // The same instances, so the authorable-surface gate reaches the open defs through the twins.
    for (const key of retryKeys) expect(retryTwin[key], `retryConfig.${key}`).toBe(shapeOf(RetryConfigSchema)[key]);
    for (const key of actionKeys) expect(actionTwin[key], `actions[].${key}`).toBe(shapeOf(ConnectorActionSchema)[key]);
    // Every declared key is accepted by the closed entry …
    const everyRetry = Object.fromEntries(retryKeys.map((k) => [k, (RetryConfigSchema.parse({}) as Record<string, unknown>)[k]]));
    expect(DeclarativeConnectorEntrySchema.safeParse({ ...INSTANCE, retryConfig: everyRetry }).success).toBe(true);
    const everyAction = { ...ACTION, outputSchema: { type: 'object' } };
    expect(Object.keys(everyAction).sort()).toEqual(actionKeys);
    expect(DeclarativeConnectorEntrySchema.safeParse({ ...DESCRIPTOR, actions: [everyAction] }).success).toBe(true);
  });
});
