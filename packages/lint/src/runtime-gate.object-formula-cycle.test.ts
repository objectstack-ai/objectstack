// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #33100 — a formula that reads its own value is refused at the object door
 * and by `os build`; a formula that reads another formula is not.
 *
 * The engine computes an object's formulas in dependency order, so
 * `f_total = record.f_sibling * 2` over the formula `f_sibling` reads the
 * computed value (`@objectstack/objectql`'s
 * `engine-formula-dependency-order.test.ts`). A formula on a cycle — itself
 * (`record.f_total * 2` on `f_total`), or two reading each other — has no
 * order to be computed in and reads null on every row, so the door refuses it
 * on each declared member, with the sentence the engine reports it with.
 */
import { describe, expect, it } from 'vitest';
import { formulaCycleMessage } from '@objectstack/formula';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import type { StoredObjectExtension } from './object-graph.js';

const formula = (expression: string) => ({ type: 'formula', label: 'F', expression, returnType: 'number' });

/** The card's object, with the formulas given. `sharingModel` keeps `security-owd-unset` quiet. */
const xJob = (formulas: Record<string, unknown>) => ({
  name: 'x_job',
  label: 'Job',
  sharingModel: 'public_read_write',
  fields: {
    quantity: { type: 'number', label: 'Quantity' },
    unit_price: { type: 'number', label: 'Unit price' },
    ...formulas,
  },
});

const where = (field: string) => `object 'x_job' · field '${field}' expression`;

const gateObject = (item: unknown) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects: [] } });

const cycleFindings = <T extends { rule: string; message: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID && f.message.includes('reads its own value'));

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#33100 — formula cycles at the object door and in the build', () => {
  it('a formula over a formula (the card\'s case) is accepted, in either declaration order', () => {
    for (const fields of [
      { f_sibling: formula('record.quantity * record.unit_price'), f_total: formula('record.f_sibling * 2') },
      { f_total: formula('record.f_sibling * 2'), f_sibling: formula('record.quantity * record.unit_price') },
    ]) {
      const result = gateObject(xJob(fields));
      expect(result.errors.filter((f) => f.rule === EXPRESSION_INVALID), dump(result)).toEqual([]);
    }
  });

  it('a chain of three formulas is accepted', () => {
    const result = gateObject(xJob({
      f_c: formula('record.f_b + 1'),
      f_b: formula('record.f_a * 2'),
      f_a: formula('record.quantity * record.unit_price'),
    }));
    expect(result.errors.filter((f) => f.rule === EXPRESSION_INVALID), dump(result)).toEqual([]);
  });

  it('a formula reading itself is REFUSED, located on its expression, in the engine\'s words', () => {
    const result = gateObject(xJob({ f_total: formula('record.f_total * 2') }));

    const errs = cycleFindings(result.errors);
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ severity: 'error', where: where('f_total') });
    expect(errs[0]!.message).toContain(formulaCycleMessage('f_total', ['f_total']));
  });

  it('two formulas reading each other are REFUSED on each; a formula reading one of them is not', () => {
    const result = gateObject(xJob({
      f_x: formula('record.f_y + 1'),
      f_y: formula('record.f_x + 1'),
      f_reads: formula('record.f_x * 2'),
    }));

    const errs = cycleFindings(result.errors);
    expect(errs.map((e) => e.where), dump(result)).toEqual([where('f_x'), where('f_y')]);
    expect(errs[0]!.message).toContain(formulaCycleMessage('f_x', ['f_x', 'f_y']));
    expect(errs[1]!.message).toContain(formulaCycleMessage('f_y', ['f_x', 'f_y']));
  });

  it('the build refuses the same body with the same finding', () => {
    const stack = { objects: [xJob({ f_total: formula('record.f_total * 2') })] };
    const built = cycleFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));
    const door = cycleFindings(gateObject(stack.objects[0]).errors);

    expect(built, dump(built)).toHaveLength(1);
    expect(door).toHaveLength(1);
    expect({ where: built[0]!.where, message: built[0]!.message }).toEqual({ where: door[0]!.where, message: door[0]!.message });
  });
});

describe('#33153 — formula cycles an object extension adds, at the object_extension door and in the build', () => {
  /** The extended object, as the door's live universe carries it, with the formulas given. */
  const target = (formulas: Record<string, unknown> = {}) => xJob(formulas);
  const extension = (fields: Record<string, unknown>) => ({ extend: 'x_job', fields });
  const extWhere = (field: string, at = 0) => `object 'x_job' · objectExtensions[${at}] · field '${field}' expression`;
  /**
   * The door, as `judgeRuntimeAuthoringRules` calls it: the live target, and
   * (#33494) the target's other packages' published extensions when the host
   * states them (`storedObjectExtensions`, from the registry's contributors).
   */
  const gateExtension = (item: unknown, objects: unknown[] = [target()], stored?: StoredObjectExtension[]) =>
    runRuntimeAuthoringRules({
      type: 'object_extension',
      item,
      context: { objects },
      ...(stored !== undefined ? { storedObjectExtensions: stored } : {}),
    });
  const build = (stack: Record<string, unknown>) =>
    cycleFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));
  const located = (fs: ReadonlyArray<{ where: string; message: string }>) => fs.map(({ where: w, message }) => ({ where: w, message }));

  it('⭐ LIT — an extension formula reading itself is REFUSED at the door and the build, located at the entry, in the engine\'s words', () => {
    const item = extension({ a__c: formula('record.a__c') });

    const door = cycleFindings(gateExtension(item).errors);
    expect(door, dump(door)).toHaveLength(1);
    expect(door[0]).toMatchObject({ severity: 'error', where: extWhere('a__c') });
    expect(door[0]!.message).toContain(formulaCycleMessage('a__c', ['a__c']));

    const built = build({ objects: [target()], objectExtensions: [item] });
    expect(located(built)).toEqual(located(door));
  });

  it('⭐ LIT — two extension formulas reading each other are REFUSED on each, at the door and the build', () => {
    const item = extension({ a__c: formula('record.b__c'), b__c: formula('record.a__c') });

    const door = cycleFindings(gateExtension(item).errors);
    expect(door.map((f) => f.where), dump(door)).toEqual([extWhere('a__c'), extWhere('b__c')]);
    expect(door[0]!.message).toContain(formulaCycleMessage('a__c', ['a__c', 'b__c']));
    expect(door[1]!.message).toContain(formulaCycleMessage('b__c', ['a__c', 'b__c']));

    expect(located(build({ objects: [target()], objectExtensions: [item] }))).toEqual(located(door));
  });

  it('⭐ LIT — a cycle closing through a declared formula: the declared member keeps its location at the object, the added one is located at the entry', () => {
    const declared = target({ f_total: formula('record.e__c * 2') });
    const item = extension({ e__c: formula('record.f_total + 1') });

    // The door judges the extension write: the member it adds.
    const door = cycleFindings(gateExtension(item, [declared]).errors);
    expect(door.map((f) => f.where), dump(door)).toEqual([extWhere('e__c')]);
    expect(door[0]!.message).toContain(formulaCycleMessage('e__c', ['e__c', 'f_total']));

    // The build names each member once, where it is authored.
    const built = build({ objects: [declared], objectExtensions: [item] });
    expect(built.map((f) => f.where), dump(built)).toEqual([where('f_total'), extWhere('e__c')]);
  });

  it('a cycle across two packages\' extensions is named at each entry, by the build', () => {
    const stack = {
      objects: [target()],
      packages: [
        { manifest: { objectExtensions: [extension({ a__c: formula('record.b__c') })] } },
        { manifest: { objectExtensions: [extension({ b__c: formula('record.a__c') })] } },
      ],
    };
    const built = build(stack);
    expect(built.map((f) => f.where), dump(built)).toEqual([
      "object 'x_job' · packages[0].manifest.objectExtensions[0] · field 'a__c' expression",
      "object 'x_job' · packages[1].manifest.objectExtensions[0] · field 'b__c' expression",
    ]);
  });

  it('⭐ LIT — the door refuses a member under a name the target already serves: a re-declared own field', () => {
    // A package extending an object it owns and re-declaring one of its
    // declared fields as a formula that reads itself: the written definition
    // is the one served, so the door refuses it at the entry.
    const declared = target();
    const item = extension({ quantity: formula('record.quantity + 1') });

    const door = cycleFindings(gateExtension(item, [declared]).errors);
    expect(door.map((f) => f.where), dump(door)).toEqual([extWhere('quantity')]);
    expect(door[0]!.message).toContain(formulaCycleMessage('quantity', ['quantity']));

    // The build refuses the same stack once, at the object, where the object
    // walk locates the declared name.
    const built = build({ objects: [declared], objectExtensions: [item] });
    expect(built.map((f) => f.where), dump(built)).toEqual([where('quantity')]);
  });

  it('⭐ LIT — the door refuses a member under a name a sibling package\'s published extension already serves', () => {
    // The door's live target carries the sibling's `s__c` (a stored number);
    // the written entry adds `s__c` over it as a formula reading itself.
    const served = target({ s__c: { type: 'number', label: 'Sibling' } });
    const item = { ...extension({ s__c: formula('record.s__c * 2') }), priority: 300 };

    const door = cycleFindings(gateExtension(item, [served]).errors);
    expect(door.map((f) => f.where), dump(door)).toEqual([extWhere('s__c')]);

    // The build over both packages serves the later writer and refuses it at its entry.
    const built = build({
      objects: [target()],
      packages: [
        { manifest: { objectExtensions: [{ ...extension({ s__c: { type: 'number', label: 'Sibling' } }), priority: 100 }] } },
        { manifest: { objectExtensions: [item] } },
      ],
    });
    expect(built.map((f) => f.where), dump(built)).toEqual([
      "object 'x_job' · packages[1].manifest.objectExtensions[0] · field 's__c' expression",
    ]);
  });

  describe('#33494 — the door serves the build\'s winner when the host states the other packages\' extensions', () => {
    // The door's live target carries a sibling package's published `s__c` as a
    // plain field; the host also states the sibling's extension itself, with
    // its package and priority, so the gate folds the written entry among it
    // by priority, as the build folds both packages' entries.
    const number = { type: 'number', label: 'Sibling' };
    const stored = (fields: Record<string, unknown>, priority: number): StoredObjectExtension =>
      ({ extend: 'x_job', priority, fields, packageId: 'com.acme.sibling' });
    const twoPackages = (sibling: Record<string, unknown>, siblingPriority: number, written: unknown) => ({
      objects: [target()],
      packages: [
        { manifest: { objectExtensions: [{ ...extension(sibling), priority: siblingPriority }] } },
        { manifest: { objectExtensions: [written] } },
      ],
    });
    const writtenAt = (packageWhere: string) => packageWhere.replace('objectExtensions[0]', 'packages[1].manifest.objectExtensions[0]');

    it('⭐ shapes 1 and 2 — a tie (200/200) and an outranked entry (sibling 300, written 200) are not refused at the door, as the build does not refuse them', () => {
      const served = target({ s__c: number });
      for (const [label, siblingPriority, writtenPriority] of [['a tie', 200, 200], ['outranked', 300, 200]] as const) {
        const written = { ...extension({ s__c: formula('record.s__c * 2') }), priority: writtenPriority };
        const door = cycleFindings(gateExtension(written, [served], [stored({ s__c: number }, siblingPriority)]).errors);
        expect(door, `${label}: ${dump(door)}`).toEqual([]);
        const built = build(twoPackages({ s__c: number }, siblingPriority, written));
        expect(built, `${label}: ${dump(built)}`).toEqual([]);
      }
    });

    it('⭐ LIT shape 3 — a higher sibling\'s definition closing a cycle through another field of the entry is refused at the door on that field, as the build refuses it', () => {
      // The sibling (300) serves `s__c` as a formula reading `a__c`; the written
      // entry (200) adds `s__c` as a number, outranked, and `a__c` reading `s__c`.
      const siblingFields = { s__c: formula('record.a__c + 1') };
      const served = target(siblingFields);
      const written = { ...extension({ s__c: number, a__c: formula('record.s__c * 2') }), priority: 200 };

      const door = cycleFindings(gateExtension(written, [served], [stored(siblingFields, 300)]).errors);
      expect(door.map((f) => f.where), dump(door)).toEqual([extWhere('a__c')]);
      expect(door[0]!.message).toContain(formulaCycleMessage('a__c', ['a__c', 's__c']));

      // The build names the entry's member at the entry and the sibling's at the sibling's.
      const built = build(twoPackages(siblingFields, 300, written));
      expect(built.map((f) => f.where), dump(built)).toEqual([
        "object 'x_job' · packages[0].manifest.objectExtensions[0] · field 's__c' expression",
        writtenAt(extWhere('a__c')),
      ]);
    });

    it('the entry that outranks the sibling (written 300 over sibling 200) is still refused at the door at the entry', () => {
      const served = target({ s__c: number });
      const written = { ...extension({ s__c: formula('record.s__c * 2') }), priority: 300 };
      const door = cycleFindings(gateExtension(written, [served], [stored({ s__c: number }, 200)]).errors);
      expect(door.map((f) => f.where), dump(door)).toEqual([extWhere('s__c')]);
      const built = build(twoPackages({ s__c: number }, 200, written));
      expect(built.map((f) => f.where), dump(built)).toEqual([writtenAt(extWhere('s__c'))]);
    });

    it('a tied name is not served again from the target as the sibling stored it: a sibling\'s cyclic definition there is not charged to the write', () => {
      // The sibling's own `s__c` reads itself (its stored cycle); the written
      // entry adds `s__c` at the same priority. The tie leaves the name out, as
      // the build leaves it out; the target's served copy does not put it back.
      const siblingFields = { s__c: formula('record.s__c + 1') };
      const written = { ...extension({ s__c: number }), priority: 200 };
      const door = cycleFindings(gateExtension(written, [target(siblingFields)], [stored(siblingFields, 200)]).errors);
      expect(door, dump(door)).toEqual([]);
      expect(build(twoPackages(siblingFields, 200, written))).toEqual([]);
    });

    it('a host that states no extensions leaves the door as it was: the written entry is folded over the target as served', () => {
      const written = { ...extension({ s__c: formula('record.s__c * 2') }), priority: 200 };
      const door = cycleFindings(gateExtension(written, [target({ s__c: number })]).errors);
      expect(door.map((f) => f.where), dump(door)).toEqual([extWhere('s__c')]);
    });
  });

  it('a sibling package\'s stored cycle, and a formula that only reads a cycle, are not the extension write\'s to answer for', () => {
    const served = target({ s_x: formula('record.s_y + 1'), s_y: formula('record.s_x + 1') });
    const result = gateExtension(extension({ e__c: formula('record.s_x * 2') }), [served]);
    expect(result.errors.filter((f) => f.rule === EXPRESSION_INVALID), dump(result)).toEqual([]);
  });

  it('an extension of an object the door does not carry is judged on its own fields', () => {
    const door = cycleFindings(gateExtension(extension({ a__c: formula('record.a__c') }), []).errors);
    expect(door.map((f) => f.where), dump(door)).toEqual([extWhere('a__c')]);
  });

  it('the target\'s own stored cycle is not the extension write\'s to answer for (the differential)', () => {
    const cyclic = target({ f_x: formula('record.f_y + 1'), f_y: formula('record.f_x + 1') });
    // [#33644] A label of its own: under the helper's shared 'F' the entry
    // would join the target's `f_x` / `f_y` label group, a clash the
    // duplicate-label rule charges to the extension at this door.
    const result = gateExtension(extension({ e__c: { ...formula('record.quantity * 2'), label: 'E' } }), [cyclic]);
    expect(result.errors, dump(result)).toEqual([]);
  });

  it('⭐ CONTROL — an extension formula over a declared formula, and a chain inside the extension, publish clean', () => {
    const declared = target({ f_total: formula('record.quantity * record.unit_price') });
    for (const item of [
      extension({ e__c: formula('record.f_total + 1') }),
      extension({ b__c: formula('record.a__c * 2'), a__c: formula('record.quantity + 1') }),
    ]) {
      const result = gateExtension(item, [declared]);
      expect(result.errors.filter((f) => f.rule === EXPRESSION_INVALID), dump(result)).toEqual([]);
      expect(build({ objects: [declared], objectExtensions: [item] })).toEqual([]);
    }
  });
});
