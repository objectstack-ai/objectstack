// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { installAttachmentFilesOptInGate } from './attachment-files-opt-in.js';

type Handler = (ctx: unknown) => unknown;

function engineWith(definitions: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const hooks: Array<{ event: string; fn: Handler; opts: any }> = [];
  const engine = {
    registerHook: (event: string, fn: Handler, opts: any) => {
      hooks.push({ event, fn, opts });
    },
    getSchema: (name: string) => definitions[name],
    ...extra,
  };
  return { engine, hooks };
}

const write = (data: Record<string, unknown>, session?: Record<string, unknown>) => ({ input: { data }, session });

describe('installAttachmentFilesOptInGate: the per-object attachment opt-in, enforced by the storage service', () => {
  it('installs on sys_attachment insert and update, under the storage package, and says so', () => {
    const { engine, hooks } = engineWith({});
    expect(installAttachmentFilesOptInGate(engine)).toBe(true);
    expect(hooks.map((h) => [h.event, h.opts])).toEqual([
      ['beforeInsert', { object: 'sys_attachment', packageId: 'com.objectstack.service.storage' }],
      ['beforeUpdate', { object: 'sys_attachment', packageId: 'com.objectstack.service.storage' }],
    ]);
  });

  it('an engine without the hook seam: not installed, and says so', () => {
    expect(installAttachmentFilesOptInGate({} as never)).toBe(false);
  });

  it('an engine that refuses the registration: not installed, and says so', () => {
    const engine = {
      registerHook: () => {
        throw new Error('no hooks today');
      },
    };
    expect(installAttachmentFilesOptInGate(engine)).toBe(false);
  });

  const DEFINITIONS = {
    opted: { name: 'opted', enable: { files: true } },
    off: { name: 'off', enable: { files: false } },
    silent: { name: 'silent', enable: {} },
    bare: { name: 'bare' },
  };

  it.each([
    ['declares files: false', 'off'],
    ['declares an enable block without files', 'silent'],
    ['declares no enable block', 'bare'],
    ['is not registered', 'nowhere'],
  ])('refuses an attachment onto an object that %s (403 FILES_DISABLED), on insert and on re-point alike', async (_why, parent) => {
    const { engine, hooks } = engineWith(DEFINITIONS);
    installAttachmentFilesOptInGate(engine);
    for (const { fn } of hooks) {
      await expect(fn(write({ parent_object: parent, parent_id: 'r1' }))).rejects.toMatchObject({
        code: 'FILES_DISABLED',
        status: 403,
        object: parent,
      });
    }
  });

  it('admits an attachment onto an object that declares files: true', async () => {
    const { engine, hooks } = engineWith(DEFINITIONS);
    installAttachmentFilesOptInGate(engine);
    for (const { fn } of hooks) {
      await expect(fn(write({ parent_object: 'opted', parent_id: 'r1' }))).resolves.toBeUndefined();
    }
  });

  it('the system context is not exempt: the opt-in is a statement about the object, not the caller', async () => {
    const { engine, hooks } = engineWith(DEFINITIONS);
    installAttachmentFilesOptInGate(engine);
    await expect(hooks[0].fn(write({ parent_object: 'bare', parent_id: 'r1' }, { isSystem: true }))).rejects.toMatchObject({
      code: 'FILES_DISABLED',
    });
  });

  it('a write naming no parent object has nothing to ask: left to validation on insert, not a re-point on update', async () => {
    const { engine, hooks } = engineWith(DEFINITIONS);
    installAttachmentFilesOptInGate(engine);
    for (const { fn } of hooks) {
      await expect(fn(write({ title: 'renamed' }))).resolves.toBeUndefined();
      await expect(fn(write({ parent_object: '' }))).resolves.toBeUndefined();
      await expect(fn({})).resolves.toBeUndefined();
    }
  });

  it('a definition that cannot be read refuses: no schema lookup, or one that throws', async () => {
    const hooks: Handler[] = [];
    installAttachmentFilesOptInGate({
      registerHook: (_event: string, fn: Handler) => {
        hooks.push(fn);
      },
    });
    await expect(hooks[0](write({ parent_object: 'opted' }))).rejects.toMatchObject({ code: 'FILES_DISABLED' });

    const throwing = engineWith({}, {
      getSchema: () => {
        throw new Error('registry offline');
      },
    });
    installAttachmentFilesOptInGate(throwing.engine);
    await expect(throwing.hooks[0].fn(write({ parent_object: 'opted' }))).rejects.toMatchObject({ code: 'FILES_DISABLED' });
  });

  it('reads the live definition on every write: an object switched to files: true is attachable on the next write', async () => {
    const definitions: Record<string, unknown> = { later: { name: 'later', enable: { files: false } } };
    const { engine, hooks } = engineWith(definitions);
    installAttachmentFilesOptInGate(engine);
    await expect(hooks[0].fn(write({ parent_object: 'later' }))).rejects.toMatchObject({ code: 'FILES_DISABLED' });
    definitions.later = { name: 'later', enable: { files: true } };
    await expect(hooks[0].fn(write({ parent_object: 'later' }))).resolves.toBeUndefined();
  });
});
