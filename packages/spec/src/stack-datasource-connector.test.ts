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
 * …and `composeStacks` judges the same reference over every input's
 * `connectors` (the composed counterpart, #25211 shape):
 *
 * - a dangling name, a descriptor or an instance with nothing to lend, carried
 *   by an input built with `strict: false`, is refused with the same finding
 *   and envelope, under `last` and `preserve`;
 * - a connector name a later input re-declares is judged against that later
 *   entry, the one the runtime keeps, and that finding names both
 *   declarations and prescribes the duplicate's fix;
 * - a nested multi-package input (a `manifest: 'preserve'` artifact) is read
 *   through its package bodies, where its connectors and datasources live;
 * - CONTROL: a datasource borrowing an instance another input declares
 *   composes, in either order;
 * - CONTROL: the per-stack strict refusal is unchanged, so a strict input
 *   never carries a dangling name into a composition.
 *
 * The pairings the key can never serve (both channels, a built-in driver, a
 * managed datasource) are the datasource schema's half, pinned in
 * `data/datasource.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from './stack.zod';

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

describe('composeStacks judges external.connector against the connectors of every input', () => {
  const pluginManifest = (id: string) => ({
    id,
    namespace: id.split('.').pop(),
    version: '1.0.0',
    type: 'plugin',
    name: id.split('.').pop(),
  });
  const owner = (connector: Record<string, unknown> = instance()) =>
    defineStack({ manifest: pluginManifest('com.acme.sap'), connectors: [connector] } as never);
  const looseBorrower = (connector = 'sap_s4') =>
    defineStack({ manifest: pluginManifest('com.acme.orders'), datasources: [sapOrders(connector)] } as never, {
      strict: false,
    });
  const composeRefusal = (stacks: unknown[], options?: Record<string, unknown>): Envelope | undefined => {
    try {
      composeStacks(stacks as never, options as never);
      return undefined;
    } catch (err) {
      return err as Envelope;
    }
  };
  const expectComposedFinding = (refused: Envelope | undefined, fragment: string): void => {
    expectOneFinding(refused, fragment);
    expect(refused?.issues).toHaveLength(1);
    expect(refused?.message).toContain('composeStacks artifact cross-reference validation failed (1 issue):');
  };

  it.each([
    ['owner first, `last`', false, 'last'],
    ['borrower first, `last`', true, 'last'],
    ['owner first, `preserve`', false, 'preserve'],
    ['borrower first, `preserve`', true, 'preserve'],
  ])('CONTROL: a datasource borrowing an instance another input declares composes — %s', (_order, reversed, manifestOpt) => {
    const stacks = reversed ? [looseBorrower(), owner()] : [owner(), looseBorrower()];
    expect(composeRefusal(stacks, { manifest: manifestOpt })).toBeUndefined();
  });

  it.each(['last', 'preserve'])('refuses a dangling name a `strict: false` input carries (`%s`)', (manifestOpt) => {
    const refused = composeRefusal([owner(instance({ name: 'sap_ariba' })), looseBorrower()], { manifest: manifestOpt });
    expectComposedFinding(refused, 'which is not defined in connectors');
  });

  it('refuses a descriptor, and an instance with nothing to lend, that another input declares', () => {
    const descriptor = { name: 'sap_s4', label: 'SAP S/4HANA', type: 'api' };
    expectComposedFinding(composeRefusal([owner(descriptor), looseBorrower()]), 'which declares no provider');
    expectComposedFinding(
      composeRefusal([owner(instance({ auth: { type: 'none' } })), looseBorrower()]),
      'which declares no auth credential',
    );
  });

  it('judges a name two inputs declare against the later entry, the one the runtime keeps', () => {
    const strictPair = defineStack({
      manifest: pluginManifest('com.acme.orders'),
      datasources: [sapOrders()],
      connectors: [instance()],
    } as never);
    const descriptor = { name: 'sap_s4', label: 'SAP S/4HANA', type: 'api' };
    const refused = composeRefusal([strictPair, owner(descriptor)]);
    expectComposedFinding(refused, 'which declares no provider in the entry the composed artifact keeps');
    expect(String(refused?.issues?.[0])).toContain(
      "Connector 'sap_s4' is declared more than once: 'com.acme.orders' (stack #0) declares an instance " +
        "that can lend, and 'com.acme.sap' (stack #1) declares the later entry, which the runtime keeps. " +
        'Rename or remove the later entry',
    );
    expect(String(refused?.issues?.[0])).not.toContain('Give it the provider');
    expect(composeRefusal([owner(descriptor), strictPair])).toBeUndefined();
  });

  it('keeps the per-stack prescription when no declaration of the name could lend', () => {
    const descriptor = { name: 'sap_s4', label: 'SAP S/4HANA', type: 'api' };
    const refused = composeRefusal([owner(descriptor), owner(instance({ auth: { type: 'none' } })), looseBorrower()]);
    expectComposedFinding(refused, 'which declares no auth credential — there is nothing to borrow. Declare the');
  });

  describe('a nested multi-package input, whose collections live only in its package bodies', () => {
    const other = () => defineStack({ manifest: pluginManifest('com.acme.other') } as never);
    const nested = (...stacks: unknown[]) => composeStacks([...stacks, other()] as never, { manifest: 'preserve' });

    it('CONTROL: a borrower resolves against an instance a package body of the nested input carries', () => {
      const inner = nested(owner());
      expect((inner as Record<string, unknown>).connectors).toBeUndefined();
      expect(composeRefusal([inner, looseBorrower()], { manifest: 'preserve' })).toBeUndefined();
      expect(composeRefusal([looseBorrower(), inner])).toBeUndefined();
    });

    it("judges a datasource a nested input's package body carries", () => {
      // Hand-assembled: a composition would refuse the dangling name itself.
      const inner = defineStack(
        {
          manifest: pluginManifest('com.acme.bundle'),
          packages: [{ manifest: { ...pluginManifest('com.acme.orders'), datasources: [sapOrders('sap_missing')] } }],
        } as never,
        { strict: false },
      );
      const refused = composeRefusal([owner(), inner], { manifest: 'preserve' });
      expect({ code: refused?.code, status: refused?.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
      expect(refused?.issues).toEqual([
        expect.stringMatching(
          /^Datasource 'sap_orders' borrows the credential of connector 'sap_missing' \(external\.connector\), which is not defined in connectors\./,
        ),
      ]);
    });

    it('names the package body that declares a shadowed instance', () => {
      const strictPair = defineStack({
        manifest: pluginManifest('com.acme.orders'),
        datasources: [sapOrders()],
        connectors: [instance()],
      } as never);
      const refused = composeRefusal([nested(strictPair), owner({ name: 'sap_s4', label: 'SAP', type: 'api' })]);
      expect(String(refused?.issues?.[0])).toContain("package 'com.acme.orders' of 'com.acme.other' (stack #0)");
    });
  });

  it('CONTROL: the per-stack strict refusal is unchanged — a strict input never carries a dangling name in', () => {
    const refused = refusalOf({ manifest: pluginManifest('com.acme.orders'), datasources: [sapOrders()] });
    expectOneFinding(refused, 'which is not defined in connectors');
    expect(refused?.message).not.toContain('composeStacks');
  });
});
