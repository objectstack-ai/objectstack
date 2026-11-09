// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D6, child K] A namespace never equals an object name, in either
 * direction, and no package ships an object short-named `custom` — refused at
 * the package door (`SchemaRegistry.installPackage`, beside N's namespace-name
 * refusal), naming both spellings, by the spec's one predicate
 * (`findNamespaceObjectNameClashes`).
 *
 * Driven through the `manifest` service, so the objects an earlier package
 * ships are registered the way a boot registers them (`registerApp`). Every
 * refusal is asserted by its ADR-0112 envelope (`code` + `status`), both
 * spellings in its sentence and the structured `clashes[]`; the refused
 * package is not installed.
 *
 * The CONTROLs pin what stays accepted: an object whose name only STARTS with
 * a namespace, the same package registering again, a package whose own objects
 * carry its own prefix, and an object `NS_custom_*` (longer than the pair's
 * namespace).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import type { ObjectQL } from './engine.js';

type Refusal = Error & {
  code?: string;
  status?: number;
  httpStatus?: number;
  clashes?: Array<{ kind: string; namespace: string; objectName: string; message: string }>;
};

const ALPHA = 'com.acme.alpha';
const BETA = 'com.acme.beta';

const object = (name: string) => ({ name, label: name, fields: { name: { name: 'name', label: 'Name', type: 'text' } } });

/** A package body of namespace `ns` shipping `objects`. */
const body = (id: string, ns: string, objects: string[] = []): Record<string, unknown> => ({
  id,
  name: id.split('.').pop(),
  version: '1.0.0',
  type: 'app',
  namespace: ns,
  ...(objects.length > 0 ? { objects: objects.map(object) } : {}),
});

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
});

async function boot() {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const svc = kernel.getService('manifest') as { register(m: unknown): void | Promise<void> };
  const register = async (manifest: unknown): Promise<Refusal | undefined> => {
    try {
      await svc.register({ packages: [{ manifest }] });
      return undefined;
    } catch (e) {
      return e as Refusal;
    }
  };
  return { ql, register };
}

describe('install door — a namespace never equals an object name', () => {
  it('a NEW namespace equal to an installed object name is refused, naming both spellings', async () => {
    const { ql, register } = await boot();
    expect((await register(body(ALPHA, 'crm', ['crm_lead'])))?.message).toBeUndefined();

    const err = await register(body(BETA, 'crm_lead', ['crm_lead_note']));
    expect([err?.code, err?.status, err?.httpStatus], err?.message).toEqual(['NAMESPACE_CONFLICT', 422, 422]);
    expect(err?.clashes?.map(({ kind, namespace, objectName }) => ({ kind, namespace, objectName }))).toEqual([
      { kind: 'namespace-equals-object', namespace: 'crm_lead', objectName: 'crm_lead' },
    ]);
    expect(err?.message).toContain(`Namespace 'crm_lead' of package '${BETA}'`);
    expect(err?.message).toContain(`the object 'crm_lead' of package '${ALPHA}'`);
    expect(ql.registry.getPackage(BETA)).toBeUndefined();
  });

  it('a NEW object name equal to an installed namespace is refused, naming both spellings', async () => {
    const { ql, register } = await boot();
    expect((await register(body(BETA, 'crm_lead')))?.message).toBeUndefined();

    const err = await register(body(ALPHA, 'crm', ['crm_lead']));
    expect([err?.code, err?.status], err?.message).toEqual(['NAMESPACE_CONFLICT', 422]);
    expect(err?.clashes?.map(({ kind, namespace, objectName }) => ({ kind, namespace, objectName }))).toEqual([
      { kind: 'namespace-equals-object', namespace: 'crm_lead', objectName: 'crm_lead' },
    ]);
    expect(err?.message).toContain(`The object 'crm_lead' of package '${ALPHA}'`);
    expect(err?.message).toContain(`installed namespace 'crm_lead' of package '${BETA}'`);
    expect(ql.registry.getPackage(ALPHA)).toBeUndefined();
    expect(ql.registry.getObject('crm_lead')).toBeUndefined();
  });

  it('an object short-named `custom` (NS_custom) is refused, with no pair installed', async () => {
    const { ql, register } = await boot();
    const err = await register(body(ALPHA, 'crm', ['crm_account', 'crm_custom']));
    expect([err?.code, err?.status], err?.message).toEqual(['NAMESPACE_CONFLICT', 422]);
    expect(err?.clashes?.map(({ kind, objectName }) => ({ kind, objectName }))).toEqual([
      { kind: 'object-short-named-custom', objectName: 'crm_custom' },
    ]);
    expect(err?.message).toContain("is short-named 'custom'");
    expect(ql.registry.getPackage(ALPHA)).toBeUndefined();
  });
});

describe('install door — what stays accepted', () => {
  it('CONTROL — an object whose name only starts with an installed namespace installs', async () => {
    const { ql, register } = await boot();
    expect((await register(body(BETA, 'crm_lead')))?.message).toBeUndefined();
    expect((await register(body(ALPHA, 'crm', ['crm_lead_note'])))?.message).toBeUndefined();
    expect(ql.registry.getPackage(ALPHA)).toBeDefined();
  });

  it('CONTROL — an object `NS_custom_*` is not short-named `custom`', async () => {
    const { register } = await boot();
    expect((await register(body(ALPHA, 'crm', ['crm_custom_field'])))?.message).toBeUndefined();
  });

  it('CONTROL — the same package registering again is never its own clash', async () => {
    const { register } = await boot();
    const alpha = body(ALPHA, 'crm', ['crm_lead']);
    expect((await register(alpha))?.message).toBeUndefined();
    expect((await register(alpha))?.message).toBeUndefined();
  });

  it('CONTROL — two packages, distinct namespaces and objects, both install', async () => {
    const { ql, register } = await boot();
    expect((await register(body(ALPHA, 'crm', ['crm_lead'])))?.message).toBeUndefined();
    expect((await register(body(BETA, 'hr', ['hr_employee'])))?.message).toBeUndefined();
    expect(ql.registry.getPackage(BETA)).toBeDefined();
  });
});
