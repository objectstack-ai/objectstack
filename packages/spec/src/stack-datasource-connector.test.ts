// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A datasource's `external.connector` names a connector instance the stack
 * declares (ADR-0015 amendment D7, ruling 6486136301: "refused at build when
 * the named instance is not declared").
 *
 * ## What is pinned
 *
 * - `defineStack` refuses, with the cross-reference envelope
 *   (`STACK_CROSS_REFERENCE_INVALID`, 422), a datasource whose `connector`
 *   names no `connectors` entry, an entry with no `provider` (a catalog
 *   descriptor), or an instance with no `auth` / `auth: { type: 'none' }`;
 * - each finding names the datasource and the connector;
 * - the check needs no object: a stack with no `objects` is judged too;
 * - CONTROL: a datasource naming a provider-bound instance with a credential
 *   is accepted, and so is one naming a disabled instance;
 * - CONTROL: a datasource with no `connector` is untouched by the rule.
 *
 * The pairings the key can never serve (both channels, a built-in driver, a
 * managed datasource) are the datasource schema's half, pinned in
 * `data/datasource.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { defineStack } from './stack.zod';

const manifest = { id: 'com.example.erp', name: 'erp', version: '1.0.0', type: 'app' as const };

const instance = (over: Record<string, unknown> = {}) => ({
  name: 'sap_s4',
  label: 'SAP S/4HANA',
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec: 'https://sap.example.com/openapi.json' },
  auth: { type: 'bearer', credentialRef: 'sap_token' },
  ...over,
});

const sapOrders = (connector = 'sap_s4') => ({
  name: 'sap_orders',
  driver: 'odata',
  config: { serviceUrl: 'https://sap.example.com/odata/v4/orders' },
  schemaMode: 'external',
  external: { connector },
});

type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };

const refusalOf = (raw: Record<string, unknown>): Envelope | undefined => {
  try {
    defineStack(raw as never);
    return undefined;
  } catch (err) {
    return err as Envelope;
  }
};

const SUBJECT = "Datasource 'sap_orders' borrows the credential of connector 'sap_s4' (external.connector)";

function expectOneFinding(refused: Envelope | undefined, fragment: string): void {
  expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
  expect(refused?.status).toBe(422);
  const hits = (refused?.issues ?? []).filter((i) => i.startsWith(SUBJECT));
  expect(hits).toHaveLength(1);
  expect(hits[0]).toContain(fragment);
}

describe('a datasource borrows the credential of a connector instance its stack declares', () => {
  it('refuses a connector name the stack does not declare', () => {
    const refused = refusalOf({ manifest, datasources: [sapOrders()], connectors: [instance({ name: 'sap_ariba' })] });
    expectOneFinding(refused, 'which is not defined in connectors');
  });

  it('refuses it in a stack that declares no connectors at all', () => {
    expectOneFinding(refusalOf({ manifest, datasources: [sapOrders()] }), 'which is not defined in connectors');
  });

  it('refuses a catalog descriptor — an entry with no provider holds no credential', () => {
    const descriptor = { name: 'sap_s4', label: 'SAP S/4HANA', type: 'api' };
    const refused = refusalOf({ manifest, datasources: [sapOrders()], connectors: [descriptor] });
    expectOneFinding(refused, 'which declares no provider');
  });

  it('refuses an instance with no auth, and one with `auth: { type: none }`', () => {
    const { auth: _auth, ...withoutAuth } = instance();
    for (const connector of [withoutAuth, instance({ auth: { type: 'none' } })]) {
      const refused = refusalOf({ manifest, datasources: [sapOrders()], connectors: [connector] });
      expectOneFinding(refused, 'which declares no auth credential');
    }
  });

  it('judges a stack with objects too, and names each borrowing datasource once', () => {
    const refused = refusalOf({
      manifest,
      objects: [{ name: 'erp_note', label: 'Note', fields: { title: { type: 'text', label: 'Title' } } }],
      datasources: [sapOrders('sap_missing'), { ...sapOrders(), name: 'sap_invoices' }],
      connectors: [instance()],
    });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    const hits = (refused?.issues ?? []).filter((i) => i.includes('(external.connector)'));
    expect(hits).toEqual([
      expect.stringContaining("Datasource 'sap_orders' borrows the credential of connector 'sap_missing'"),
    ]);
  });

  it('CONTROL: a provider-bound instance with a credential is accepted', () => {
    const stack = defineStack({ manifest, datasources: [sapOrders()], connectors: [instance()] } as never);
    expect(stack.datasources?.[0]?.external?.connector).toBe('sap_s4');
  });

  it('CONTROL: a disabled instance is accepted — the switch turns the vendor off for actions and records alike', () => {
    expect(refusalOf({ manifest, datasources: [sapOrders()], connectors: [instance({ enabled: false })] })).toBeUndefined();
  });

  it('CONTROL: a datasource with no connector is untouched by the rule', () => {
    const plain = { ...sapOrders(), external: { credentialsRef: 'sys_secret:9f2c' } };
    expect(refusalOf({ manifest, datasources: [plain] })).toBeUndefined();
  });
});
