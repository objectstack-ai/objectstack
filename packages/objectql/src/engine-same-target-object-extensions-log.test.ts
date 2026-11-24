// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35228 ruling A, runtime arm A1] A package body carrying two
 * `objectExtensions` entries for one target — an artifact built before
 * authoring refused that body — still loads with today's outcome (only the
 * last entry's fields register), and the registration says so at `error`, once
 * per (package, target), naming the target, the package and every entry.
 *
 * The ruling: 「推荐 A，已安装的包只记错误日志、照常启动。」 So the body is
 * neither refused nor merged, and replace-on-reload is unchanged: one
 * registration of a package still replaces that package's previous
 * contribution to the target, which is what the reload pin below holds.
 *
 * Real engine, real `SchemaRegistry` — no doubles: what is pinned is what the
 * registration seam serves.
 */
import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from '@objectstack/spec';
import { ObjectQL } from './engine';

interface ErrorLine { msg: string; meta: Record<string, unknown> | undefined }

function engineRecordingErrors(): { engine: ObjectQL; errors: ErrorLine[] } {
  const errors: ErrorLine[] = [];
  const logger = {
    debug() {}, info() {}, warn() {},
    error: (msg: string, _error?: Error, meta?: Record<string, unknown>) => { errors.push({ msg, meta }); },
  };
  return { engine: new ObjectQL({ logger } as any), errors };
}

const OWNER = 'com.example.sales';
const EXTENDER = 'com.example.billing';
const TARGET = 'crm_line';

const owner = {
  id: OWNER,
  name: 'sales',
  version: '1.0.0',
  type: 'app',
  namespace: 'crm',
  objects: [{ name: TARGET, label: 'Line', fields: { title: { name: 'title', type: 'text', label: 'Title' } } }],
};

const extension = (field: string) => ({ extend: TARGET, fields: { [field]: { name: field, type: 'text', label: field } } });

const extender = (objectExtensions: unknown[]) => ({
  id: EXTENDER,
  name: 'billing',
  version: '1.0.0',
  type: 'module',
  namespace: 'crm',
  dependencies: { [OWNER]: '^1.0.0' },
  objectExtensions,
});

const servedFields = (engine: ObjectQL): string[] => Object.keys(engine.getSchema(TARGET)?.fields ?? {}).sort();

const sameTargetLines = (errors: ErrorLine[]): ErrorLine[] =>
  errors.filter((line) => line.msg.includes('objectExtensions entries for object'));

describe('[#35228 A1] two objectExtensions entries for one target in one package body', () => {
  it('logs one error naming the target, the package and both entries, and keeps only the last entry\'s fields', () => {
    const { engine, errors } = engineRecordingErrors();
    engine.registerApp(owner);
    engine.registerApp(extender([extension('cb_account'), extension('cb_other')]));

    const lines = sameTargetLines(errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.msg).toContain(`Package '${EXTENDER}'`);
    expect(lines[0]!.msg).toContain(`object '${TARGET}'`);
    expect(lines[0]!.msg).toContain('objectExtensions[0] and objectExtensions[1]');
    expect(lines[0]!.msg).toContain(`Merge them into a single objectExtensions entry for '${TARGET}'`);
    expect(lines[0]!.meta).toEqual({ package: EXTENDER, target: TARGET, entries: [0, 1] });

    // Today's outcome, kept by the ruling: the last entry's field is served,
    // the earlier entry's field is absent, and nothing was refused.
    expect(servedFields(engine)).toContain('cb_other');
    expect(servedFields(engine)).not.toContain('cb_account');
  });

  it('logs once per (package, target): three entries for one target and two for another are two lines', () => {
    const { engine, errors } = engineRecordingErrors();
    engine.registerApp({
      ...owner,
      objects: [...owner.objects, { name: 'crm_note', label: 'Note', fields: { title: { name: 'title', type: 'text', label: 'Title' } } }],
    });
    const note = (field: string) => ({ extend: 'crm_note', fields: { [field]: { name: field, type: 'text', label: field } } });
    engine.registerApp(extender([extension('a1'), note('n1'), extension('a2'), note('n2'), extension('a3')]));

    const lines = sameTargetLines(errors);
    expect(lines.map((line) => line.meta)).toEqual([
      { package: EXTENDER, target: TARGET, entries: [0, 2, 4] },
      { package: EXTENDER, target: 'crm_note', entries: [1, 3] },
    ]);
    expect(lines[0]!.msg).toContain('objectExtensions[0], objectExtensions[2] and objectExtensions[4]');
  });

  it('CONTROL: one entry per target logs nothing', () => {
    const { engine, errors } = engineRecordingErrors();
    engine.registerApp(owner);
    engine.registerApp(extender([extension('cb_account')]));
    expect(sameTargetLines(errors)).toEqual([]);
    expect(servedFields(engine)).toContain('cb_account');
  });

  it('CONTROL: two packages each extending one target is cross-package, served together, and logs nothing', () => {
    const { engine, errors } = engineRecordingErrors();
    engine.registerApp(owner);
    engine.registerApp(extender([extension('cb_account')]));
    engine.registerApp({ ...extender([extension('cb_other')]), id: 'com.example.ops', name: 'ops' });
    expect(sameTargetLines(errors)).toEqual([]);
    expect(servedFields(engine)).toEqual(expect.arrayContaining(['cb_account', 'cb_other']));
  });

  it('[review S3] the accepted twice-passed sub-stack composition, registered, logs no error — and neither does its built JSON', () => {
    const sub = defineStack({ objectExtensions: [extension('cb_account')] } as never);
    const manifestOnly = defineStack({ manifest: { id: EXTENDER, name: 'billing', version: '1.0.0', type: 'module', namespace: 'crm' } } as never);
    const composed = composeStacks([manifestOnly, sub, sub]) as unknown as { objectExtensions: unknown[] };
    expect(composed.objectExtensions, 'anti-vacuity: the composition carries the entry twice').toHaveLength(2);

    for (const [label, objectExtensions] of [
      ['as composed (one object, two references)', composed.objectExtensions],
      ['as built (serialised: two equal objects)', JSON.parse(JSON.stringify(composed.objectExtensions))],
    ] as const) {
      const { engine, errors } = engineRecordingErrors();
      engine.registerApp(owner);
      engine.registerApp(extender(objectExtensions as unknown[]));
      expect(sameTargetLines(errors), label).toEqual([]);
      expect(servedFields(engine), label).toContain('cb_account');
    }
  });

  it('[review S3] equal entries beside one that differs still log, naming every entry', () => {
    const { engine, errors } = engineRecordingErrors();
    engine.registerApp(owner);
    engine.registerApp(extender([extension('cb_account'), extension('cb_account'), extension('cb_other')]));
    expect(sameTargetLines(errors).map((line) => line.meta)).toEqual([{ package: EXTENDER, target: TARGET, entries: [0, 1, 2] }]);
  });

  it('reload: re-registering the package with a renamed field serves the new name and not the old', () => {
    const { engine, errors } = engineRecordingErrors();
    engine.registerApp(owner);
    engine.registerApp(extender([extension('cb_account')]));
    expect(servedFields(engine)).toContain('cb_account');

    engine.registerApp(extender([extension('cb_account2')]));
    expect(servedFields(engine)).toContain('cb_account2');
    expect(servedFields(engine)).not.toContain('cb_account');
    expect(sameTargetLines(errors)).toEqual([]);
  });
});
