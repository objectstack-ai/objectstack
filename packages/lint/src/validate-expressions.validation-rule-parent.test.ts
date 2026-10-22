// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24720, #24957 — a `validations[]` rule's predicate that reads `parent` is
 * refused at authoring, at `os validate` / `os build` and at the object save
 * door, at `error`. #24720 shipped the verdict at `warning`; #24957 makes it
 * the refusal (the standing ruling 甲, as amended: a narrowing ships now).
 *
 * ## The state this closes
 *
 * ObjectQL evaluates every `validations[]` predicate — a `script` /
 * `cross_field` rule's `condition` (`checkPredicate`), a `conditional` rule's
 * `when` (`checkConditional`), and the rules nested in its `then` /
 * `otherwise` — in `ruleScope(record, previous)`: `record` and `previous`, and
 * no master-detail header. The header is bound as `parent` for a field's own
 * `readonlyWhen` / `requiredWhen` only. `parent` is a `SCOPE_ROOTS` member, so
 * the bare-reference check was silent on it, and a rule reading
 * `parent.status` passed every door — then faulted (`Unknown variable:
 * parent`) on every write it judged, which the server refuses as unevaluable,
 * the seed's own rows included.
 *
 * ## The verdict
 *
 * One root verdict over every predicate the rule carries, located where
 * `check()` locates the same predicate, refusing `parent` at error, with the
 * prescription that is true for it: the field-rule slots where `parent` IS
 * bound, or a denormalised column. The runtime is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateStackExpressions } from './validate-expressions.js';

const PARENT = "parent.status == 'paid'";

const header = {
  name: 'fx_header',
  label: 'Header',
  sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' }, status: { type: 'text', label: 'Status' } },
};

/** A detail with exactly ONE `master_detail` — the shape on which the field-rule slots bind `parent`. */
const line = (
  validations: unknown[],
  extraFields: Record<string, unknown> = {},
  masters: number = 1,
) => ({
  name: 'fx_line',
  label: 'Line',
  sharingModel: 'private',
  fields: {
    ...(masters >= 1 ? { hdr: { type: 'master_detail', label: 'Header', reference: 'fx_header' } } : {}),
    ...(masters >= 2 ? { hdr2: { type: 'master_detail', label: 'Header 2', reference: 'fx_header' } } : {}),
    amount: { type: 'number', label: 'Amount' },
    parent_code: { type: 'text', label: 'Parent code' },
    ...extraFields,
  },
  validations,
});

const script = (condition: string, name = 'paid_lock') => ({ name, type: 'script', condition, message: 'x' });

const stackOf = (...objects: unknown[]) => ({ objects });

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

const commandFindings = (command: 'validate' | 'build', ...objects: unknown[]) => {
  const stack = stackOf(...objects);
  return expressionFindings(runAuthoringRules(command, { normalized: stack, parsed: stack }));
};

const gateObject = (item: unknown, context: unknown[]) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects: context } });

const dump = (r: unknown) => JSON.stringify(r, null, 2);

const WHERE = "object 'fx_line' · validation 'paid_lock'";

describe('#24720 — a `validations[]` predicate reading `parent` is refused at authoring', () => {
  it('⭐ LIT — a `script` rule\'s `condition` reading `parent` is refused at error, located at the rule', () => {
    const issues = validateStackExpressions(stackOf(header, line([script(PARENT)])));

    expect(issues, dump(issues)).toHaveLength(1);
    expect(issues[0]).toMatchObject({ where: WHERE, severity: 'error', source: PARENT });
    expect(issues[0]!.message).toContain("validation rule 'paid_lock' reads `parent`");
  });

  it('⭐ the prescription names the field-rule slots where `parent` IS bound, and the denormalise remedy', () => {
    const [issue] = validateStackExpressions(stackOf(header, line([script(PARENT)])));

    expect(issue!.message).toContain('`readonlyWhen`');
    expect(issue!.message).toContain('`requiredWhen`');
    expect(issue!.message).toContain("denormalise the header value you need onto 'fx_line'");
  });

  it('⭐ the `os validate` and `os build` commands both give the finding at error: the one the command fails on', () => {
    for (const command of ['validate', 'build'] as const) {
      const stack = stackOf(header, line([script(PARENT)]));
      const all = runAuthoringRules(command, { normalized: stack, parsed: stack });
      const found = expressionFindings(all);
      expect(found, `${command}: ${dump(found)}`).toHaveLength(1);
      expect(found[0]).toMatchObject({ severity: 'error', where: WHERE });
      // It is the ONLY error the stack carries, so it is what fails the command.
      expect(all.filter((f) => f.severity === 'error'), `${command}: ${dump(all)}`).toEqual(found);
    }
  });

  it('⭐ the message promises no later release: it IS the refusal', () => {
    const [issue] = validateStackExpressions(stackOf(header, line([script(PARENT)])));

    // The retired promise is gone: the finding is the refusal, not a notice of one.
    expect(issue!.message).not.toMatch(/warning|19\.0/);
  });

  it('⭐ the rule is judged as written: an inactive rule, or an update-only one, is refused too', () => {
    for (const extra of [{ active: false }, { events: ['update'] }]) {
      const issues = validateStackExpressions(stackOf(header, line([{ ...script(PARENT), ...extra }])));
      expect(issues, `${JSON.stringify(extra)}: ${dump(issues)}`).toHaveLength(1);
      expect(issues[0]).toMatchObject({ where: WHERE, severity: 'error' });
    }
  });

  it('⭐ a `cross_field` rule\'s `condition` is judged the same way', () => {
    const rule = { name: 'paid_lock', type: 'cross_field', fields: ['amount'], condition: PARENT, message: 'x' };
    const issues = validateStackExpressions(stackOf(header, line([rule])));

    expect(issues, dump(issues)).toHaveLength(1);
    expect(issues[0]).toMatchObject({ where: WHERE, severity: 'error' });
  });

  it('⭐ a `conditional` rule\'s `when`, and the rules in its `then` / `otherwise`, are judged at their own locations', () => {
    const rule = {
      type: 'conditional',
      name: 'gate',
      when: PARENT,
      message: 'x',
      then: { type: 'script', name: 'inner', condition: "parent.status != 'void'", message: 'y' },
      otherwise: { type: 'script', name: 'other', condition: 'record.amount != null && record.amount > 0', message: 'z' },
    };
    const issues = validateStackExpressions(stackOf(header, line([rule])));

    expect(issues.map((i) => i.where), dump(issues)).toEqual([
      "object 'fx_line' · validation 'gate' when",
      "object 'fx_line' · validation rule 'gate' then → 'inner'",
    ]);
    for (const i of issues) {
      expect(i.severity).toBe('error');
      expect(i.message).toContain('reads `parent`');
    }
  });

  it('gives one finding per predicate however often it reads `parent`', () => {
    const issues = validateStackExpressions(
      stackOf(header, line([script(`${PARENT} && parent.name != ''`)])),
    );
    expect(issues, dump(issues)).toHaveLength(1);
  });

  it('refuses it whatever the object\'s master count: no validation rule binds `parent` on any object', () => {
    for (const masters of [0, 2]) {
      const issues = validateStackExpressions(stackOf(header, line([script(PARENT)], {}, masters)));
      const here = issues.filter((i) => i.where === WHERE);
      expect(here, `${masters} masters: ${dump(issues)}`).toHaveLength(1);
      expect(here[0]!.severity).toBe('error');
    }
  });

  it('⭐ CONTROL — `parent` on the field\'s own `readonlyWhen` / `requiredWhen` is still accepted', () => {
    for (const key of ['readonlyWhen', 'requiredWhen']) {
      const issues = validateStackExpressions(
        stackOf(header, line([], { note: { type: 'text', label: 'Note', [key]: PARENT } })),
      );
      expect(issues, `${key}: ${dump(issues)}`).toEqual([]);
    }
  });

  it('⭐ CONTROL — `record` / `previous` reads, a column spelled like the root and the string `parent` pass', () => {
    for (const condition of [
      'record.amount != null && record.amount > 100',
      'previous != null && previous.amount != null && previous.amount > 100',
      "record.parent_code == 'a'",
      "record.parent_code == 'parent'",
    ]) {
      const issues = validateStackExpressions(stackOf(header, line([script(condition)])));
      expect(issues, `${condition}: ${dump(issues)}`).toEqual([]);
    }
  });
});

describe('#24720 — the object door gives the build\'s verdict', () => {
  it('⭐ LIT — the measured body is REFUSED at the door with the finding as an error, located at the rule', () => {
    const result = gateObject(line([script(PARENT)]), [header]);

    expect(result.rulesRun).toContain('validateStackExpressions');
    const errs = expressionFindings(result.errors);
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ severity: 'error', where: WHERE, path: WHERE });
    expect(errs[0]!.message).toContain("validation rule 'paid_lock' reads `parent`");
    // No longer an advisory: the finding moved, it was not duplicated.
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
  });

  it('⭐ PARITY — the door finding IS the build finding', () => {
    const atBuild = commandFindings('build', header, line([script(PARENT)]));
    const atDoor = expressionFindings(gateObject(line([script(PARENT)]), [header]).errors);

    expect(atBuild, dump(atBuild)).toHaveLength(1);
    expect(atDoor, dump(atDoor)).toEqual(atBuild);
  });

  it('⭐ CONTROL — `parent` on a field\'s own `readonlyWhen` publishes clean, and the build agrees', () => {
    const body = line([], { note: { type: 'text', label: 'Note', readonlyWhen: PARENT } });
    const result = gateObject(body, [header]);

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
    expect(commandFindings('build', header, body)).toEqual([]);
  });
});
