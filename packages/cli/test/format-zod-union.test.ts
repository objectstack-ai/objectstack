// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Does a rejection behind a `z.union` reach the terminal? (#5341)
 *
 * Zod folds every branch of a failed union into ONE top-level issue whose own
 * `message` is the literal `"Invalid input"`; each branch's real rejection —
 * required-property and unknown-key prescriptions alike — sits in
 * `issue.errors[]` with paths RELATIVE to the union's own. A consumer that
 * walks only the top level prints `invalid_union: Invalid input` and drops
 * every curated word the #4001 campaign wrote for the strict shapes behind
 * that union.
 *
 * This is the same defect in its THIRD consumer, each a separate piece of code:
 *
 *   1. `formatZodError` (`spec/src/shared/error-map.zod.ts`) — #4971, PR #5342;
 *   2. `zodIssuesToFields` (`rest/src/rest-server.ts`, the wire) — #5014, PR #5362;
 *   3. `formatZodErrors` (`cli/src/utils/format.ts`, the terminal) — THIS file.
 *
 * (3) is what `os validate`, `os build` (compile) and `os plugin build` print
 * through — three commands, one function — so until #5341 an author publishing
 * from the terminal was the one reader the campaign's prose never reached,
 * while the `--json` payload beside it carried the whole tree.
 *
 * The whole risk of fixing it is the opposite failure: N branches × the same
 * mistake reported N times, which is what made `view.zod.ts`'s `submitBehavior`
 * reach for `discriminatedUnion` (#4001 批 6c). Both directions are pinned.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ObjectStackDefinitionSchema } from '@objectstack/spec';
import { formatZodErrors } from '../src/utils/format';

const cliBin = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'bin', 'run-dev.js');

/** Drop SGR sequences so an assertion reads the words, not chalk's opinion. */
const stripAnsi = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

/** Run `formatZodErrors` and return everything it printed, as one string. */
function render(error: z.ZodError): string {
  const captured: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    formatZodErrors(error as never);
  } finally {
    console.log = original;
  }
  return stripAnsi(captured.join('\n'));
}

/** The campaign's shape: a string form OR a strict object form. */
const ACTION_REF = z.union([
  z.string(),
  z.strictObject({ type: z.string(), params: z.record(z.string(), z.unknown()).optional() }),
]);

describe('[#5341] formatZodErrors expands invalid_union branches', () => {
  it('prints the failing branch prose under the union line', () => {
    const out = render(ACTION_REF.safeParse({ type: 'log', args: { a: 1 } }).error!);
    // The union's own two lines are PRESERVED — they are what says "no branch
    // matched", and keeping them makes this change strictly additive: nothing
    // that printed before #5341 stopped printing.
    expect(out).toContain('invalid_union: Invalid input');
    // …and the branch's prescription now arrives with them.
    expect(out).toContain('Unrecognized key: "args"');
  });

  it('drops the kind-mismatch branch that carries no prescription', () => {
    const out = render(ACTION_REF.safeParse({ type: 'log', args: 1 }).error!);
    // Paired deliberately: the `not` alone would also pass if the expansion
    // produced NOTHING — a green for the empty reason. The positive assertion
    // is what makes the negative one mean "selected against", not "absent".
    expect(out).toContain('args');
    // `expected string, received object` is the string branch complaining that
    // the author did not write a string. They never meant to.
    expect(out).not.toContain('expected string');
  });

  it('resolves branch paths against the union, not relative to it', () => {
    const schema = z.object({ actions: z.array(ACTION_REF) });
    const out = render(schema.safeParse({ actions: [{ type: 'log', args: { a: 1 } }] }).error!);
    expect(out).toContain('✗ actions.0: Unrecognized key: "args"');
    // Never the bare relative path a naive splice would print.
    expect(out).not.toContain('✗ (root): Unrecognized key');
  });

  it('expands a union nested inside a union', () => {
    const schema = z.object({ on: z.union([z.string(), z.object({ actions: z.array(ACTION_REF) })]) });
    const out = render(schema.safeParse({ on: { actions: [{ type: 'log', args: { a: 1 } }] } }).error!);
    expect(out).toContain('✗ on.actions.0: Invalid input');
    expect(out).toContain('✗ on.actions.0: Unrecognized key: "args"');
  });

  // ⚠️ THE anti-regression, mirroring the pin #4971 left in
  // `spec/src/shared/error-map.test.ts`. #4001 批 6c measured a plain `z.union`
  // of four strict members reporting one bad key once per member. Selecting the
  // branch that complains LEAST is what keeps the expansion from reintroducing
  // it: the member the author was aiming at reports only the stray key, while
  // the others also report a wrong discriminator and their own missing requireds.
  it('reports one unknown key ONCE, not once per branch', () => {
    const union = z.union([
      z.strictObject({ kind: z.literal('a'), x: z.string() }),
      z.strictObject({ kind: z.literal('b'), y: z.string() }),
      z.strictObject({ kind: z.literal('c'), z: z.string() }),
    ]);
    const out = render(union.safeParse({ kind: 'a', x: 'ok', bogus: 1 }).error!);

    expect(out.match(/bogus/g)?.length).toBe(1);
    // The two shapes the author was not writing stay out of the terminal.
    expect(out).not.toContain('expected "b"');
    expect(out).not.toContain('expected "c"');
  });

  it('leaves a non-union issue rendered exactly as before', () => {
    const out = render(z.object({ name: z.string() }).safeParse({ name: 1 }).error!);
    expect(out).toContain('✗ name');
    expect(out).toContain('invalid_type:');
    expect(out).toContain('expected: string');
    // The footer counts `error.issues`, unchanged: a union is ONE issue no
    // matter how many lines explain it, which is what keeps this number
    // agreeing with the `--json` payload beside it.
    expect(out).toContain('1 validation error(s) total');
  });

  it('counts a union as one issue however many lines explain it', () => {
    const out = render(ACTION_REF.safeParse({ type: 'log', args: { a: 1 } }).error!);
    expect(out).toContain('1 validation error(s) total');
  });
});

/**
 * The live specimen, on the surface `os validate` actually parses.
 *
 * `views[].list.sort` is `z.union([z.string(), z.array(<strict sort entry>)])`
 * and the entry declares the #4721 alias `direction → order` — the same tuple
 * under a different word, which is worth a prescription precisely because
 * getting it wrong REVERSES the sort silently. Behind a union, that
 * prescription was produced on every run and delivered on none.
 */
const SORT_ALIAS_STACK = {
  manifest: { id: 'union_probe', name: 'Union Probe', namespace: 'union_probe', version: '1.0.0', type: 'app' },
  views: [
    {
      name: 'union_probe_view',
      object: 'union_probe_obj',
      list: {
        name: 'union_probe_list',
        label: 'Union Probe',
        type: 'grid',
        columns: ['name'],
        sort: [{ field: 'name', direction: 'desc' }],
      },
    },
  ],
};

/** Run a CLI command in a temp dir holding `stack` as the config. */
function runCli(command: string, stack: Record<string, unknown>, args: string[] = []): { exitCode: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'os-union-format-'));
  try {
    // A plain literal, not `defineStack`/`defineView`: those factories parse
    // eagerly and would throw through spec's OWN formatter, which has expanded
    // unions since #4971 — the one thing this file must not accidentally
    // measure instead of the CLI's renderer.
    writeFileSync(join(dir, 'objectstack.config.mjs'), `export default ${JSON.stringify(stack, null, 2)};\n`);
    try {
      const output = execFileSync(process.execPath, [cliBin, command, ...args], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return { exitCode: 0, output: stripAnsi(output) };
    } catch (error: any) {
      return { exitCode: error.status ?? 1, output: stripAnsi(`${error.stdout ?? ''}${error.stderr ?? ''}`) };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('[#5341] `os validate` delivers a union branch prescription', () => {
  // Reverse verification, direction declared up front: the failure this
  // reports must be the union and nothing else, so the schema-level control
  // runs first. If the stack failed for some unrelated reason the terminal
  // assertion below could pass on the wrong error entirely.
  it('the specimen fails on exactly one issue, and that issue is the union', () => {
    const result = ObjectStackDefinitionSchema.safeParse(SORT_ALIAS_STACK);
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe('invalid_union');
    // The prescription exists in the payload — it always has. Delivery is the
    // only thing #5341 is about.
    expect(JSON.stringify(issues[0])).toContain('`direction` → `order`');
  });

  it('prints the prescription, not a bare `invalid_union: Invalid input`', () => {
    const { exitCode, output } = runCli('validate', SORT_ALIAS_STACK);
    expect(exitCode, `os validate accepted a stack with an aliased sort key:\n${output}`).not.toBe(0);
    expect(output).toContain('views.0.list.sort');
    expect(output).toContain('`direction` → `order`');
  }, 120_000);

  it('leaves the `--json` payload exactly as it was — full, and nested', () => {
    // The machine path never had this defect: it passes `error.issues` through,
    // so the branch tree was always on it. Pinned here because the fix is one
    // `console.log` loop away from being "helpfully" moved into the payload.
    const { exitCode, output } = runCli('validate', SORT_ALIAS_STACK, ['--json']);
    expect(exitCode).not.toBe(0);
    const payload = JSON.parse(output.slice(output.indexOf('{')));
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].code).toBe('invalid_union');
    // The branch tree, untouched — and NOT flattened into extra `errors[]` rows.
    expect(JSON.stringify(payload.errors[0].errors)).toContain('`direction` → `order`');
  }, 120_000);
});

/**
 * [#5389] The terminal's share of the 4th/5th family members.
 *
 * `invalid_key` / `invalid_element` hang the key/element schema's real
 * complaint on `issue.issues[]` rather than on `invalid_union`'s
 * `issue.errors[]`. The descent itself is `@objectstack/spec`'s — reused, not
 * re-derived, exactly as #5341 reused it for the union — so this file's whole
 * share of the fix is that its gate stopped saying `code !== 'invalid_union'`
 * and started naming all three expandable codes.
 *
 * Strictly additive, same as #5341: the `code: message` line the terminal
 * already printed for the container is untouched; only the explanation is new.
 */
describe('[#5389] formatZodErrors expands invalid_key / invalid_element', () => {
  const SnakeKey = z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "Invalid identifier. Must be lowercase snake_case (e.g. 'first_name').");

  it('prints the key schema prose under the container line', () => {
    const schema = z.object({ fields: z.record(SnakeKey, z.object({ type: z.string() })) });
    const out = render(schema.safeParse({ fields: { 'First Name': { type: 'text' } } }).error!);
    expect(out).toContain('invalid_key: Invalid key in record');
    expect(out).toContain("Invalid identifier. Must be lowercase snake_case (e.g. 'first_name').");
  });

  it('prints the element schema prose for a map', () => {
    const schema = z.map(z.object({ id: z.string() }), z.number().min(5, 'too small'));
    const out = render(schema.safeParse(new Map([[{ id: 'a' }, 1]])).error!);
    expect(out).toContain('invalid_element');
    expect(out).toContain('too small');
  });

  it('adds nothing to an ordinary issue', () => {
    // The conservative half: only the three expandable codes may grow lines.
    const before = render(z.object({ a: z.string() }).safeParse({}).error!);
    expect(before.split('\n').filter((l) => l.includes('✗'))).toHaveLength(1);
  });
});
