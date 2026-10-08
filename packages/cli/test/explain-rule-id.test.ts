// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22161] `os explain <rule-id>` and the `rule:` line that points at it.
 *
 * An author-time finding prints one verdict sentence and one fix; the rule's
 * long reasoning is its explanation in `@objectstack/lint`, keyed by rule id,
 * which `os explain <rule-id>` prints. The `rule:` line names that command —
 * spelled once, in `utils/format.ts` — for exactly the rules that have one.
 *
 * Pinned here:
 *  - one positional, two namespaces: a schema name resolves as before, a rule
 *    id resolves to its explanation, and the two sets are disjoint (so neither
 *    lookup can shadow the other);
 *  - every rule id the pointer can name resolves through the command — the
 *    pointer is never printed for a command that would answer "unknown";
 *  - the printed shape of each shortened rule, from the rule's REAL finding:
 *    a verdict line, a `fix:` line, and the `rule:` line with the pointer.
 *
 * In-process, no spawn: `test/rule-line-explain-pointer.e2e.test.ts` drives
 * the same shape through the real `os validate` / `os build` binaries.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as lint from '@objectstack/lint';
import {
  AUTHORING_RULES,
  EXPRESSION_INVALID,
  FIELD_NO_CONSUMERS,
  RULE_EXPLANATIONS,
  SECURITY_OWD_UNSET,
  validateFieldConsumers,
  validateSecurityPosture,
} from '@objectstack/lint';
import Explain, { SCHEMAS } from '../src/commands/explain';
import {
  authoringFindingDetailLines,
  explainPointer,
  printAuthoringAdvisories,
  printAuthoringRuleErrors,
} from '../src/utils/format';

const CLI_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

/** Everything written to stdout while `fn` runs, ANSI-free. */
async function captureStdout(fn: () => unknown | Promise<unknown>): Promise<string> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
    done?.(null);
    return true;
  }) as never);
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  // eslint-disable-next-line no-control-regex
  return chunks.join('').replace(/\u001b\[[0-9;]*m/g, '');
}

/** Every rule id constant `@objectstack/lint` exports, by value. */
function exportedRuleIds(): string[] {
  return Object.entries(lint)
    .filter(([name, value]) => /^[A-Z][A-Z0-9_]*$/.test(name) && typeof value === 'string')
    .map(([, value]) => value as string);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('os explain — one positional, schema names and rule ids (#22161)', () => {
  it('the schema names and the rule ids are disjoint sets', () => {
    const schemas = Object.keys(SCHEMAS);
    const ruleIds = exportedRuleIds();
    // Anti-vacuity: both sides are populated.
    expect(schemas.length).toBeGreaterThan(5);
    expect(ruleIds.length).toBeGreaterThan(100);
    // The command lowercases a schema lookup, so compare lowercased.
    const lowered = new Set(ruleIds.map((id) => id.toLowerCase()));
    expect(schemas.filter((s) => lowered.has(s))).toEqual([]);
    expect(Object.keys(RULE_EXPLANATIONS).filter((id) => id.toLowerCase() in SCHEMAS)).toEqual([]);
  });

  it('every rule the pointer can name resolves through the command to its own explanation', async () => {
    const ids = Object.keys(RULE_EXPLANATIONS);
    expect(ids).toEqual(expect.arrayContaining([FIELD_NO_CONSUMERS, SECURITY_OWD_UNSET]));
    for (const id of ids) {
      expect(explainPointer(id)).toBe(` — \`os explain ${id}\` for ${RULE_EXPLANATIONS[id].covers}`);
      const out = await captureStdout(() => Explain.run([id, '--json'], { root: CLI_ROOT }));
      expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(RULE_EXPLANATIONS[id])));
    }
  }, 60_000);

  it('a rule with no explanation gets no pointer', () => {
    expect(explainPointer('liveness-dead-property')).toBe('');
    expect(explainPointer('no-such-rule')).toBe('');
  });

  it('`os explain field-no-consumers` prints the reasoning the warning no longer carries', async () => {
    const out = await captureStdout(() => Explain.run([FIELD_NO_CONSUMERS], { root: CLI_ROOT }));
    expect(out).toContain(`Rule: ${FIELD_NO_CONSUMERS}`);
    const flat = out.replace(/\s+/g, ' ');
    for (const paragraph of RULE_EXPLANATIONS[FIELD_NO_CONSUMERS].paragraphs) {
      expect(flat).toContain(paragraph.replace(/\s+/g, ' '));
    }
    // Wrapped for a terminal: no printed line runs past the wrap width.
    for (const line of out.split('\n')) expect(line.length, line).toBeLessThanOrEqual(88);
  }, 60_000);

  it('a schema name still resolves as before', async () => {
    const out = await captureStdout(() => Explain.run(['object'], { root: CLI_ROOT }));
    expect(out).toContain('Schema: Object');
    expect(out).not.toContain('Rule:');
  }, 60_000);

  it('the no-argument listing names the rule explanations beside the schemas', async () => {
    const out = await captureStdout(() => Explain.run(['--json'], { root: CLI_ROOT }));
    const payload = JSON.parse(out) as { schemas: { name: string }[]; rules: { id: string; covers: string }[] };
    expect(payload.schemas.map((s) => s.name)).toEqual(Object.keys(SCHEMAS));
    expect(payload.rules).toEqual(
      Object.values(RULE_EXPLANATIONS).map((r) => ({ id: r.rule, covers: r.covers })),
    );
  }, 60_000);

  it('a prototype key is neither a schema nor a rule: refused, not crashed', async () => {
    for (const key of ['constructor', '__proto__', 'toString']) {
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      let thrown: unknown;
      const out = await captureStdout(async () => {
        try {
          await Explain.run([key, '--json'], { root: CLI_ROOT });
        } catch (e) {
          thrown = e;
        }
      });
      expect(String((thrown as Error)?.message), key).toBe('exit:1');
      expect(JSON.parse(out), key).toEqual({ error: `Unknown schema or rule id: ${key}` });
      vi.restoreAllMocks();
    }
  }, 60_000);

  it('an id that is neither refuses with exit 1 and names both lists', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(a.join(' '));
    });
    let thrown: unknown;
    const out = await captureStdout(async () => {
      try {
        await Explain.run(['field-no-consumer'], { root: CLI_ROOT });
      } catch (e) {
        thrown = e;
      }
    });
    expect(String((thrown as Error)?.message)).toBe('exit:1');
    expect(exit).toHaveBeenCalledWith(1);
    const text = out + errors.join('\n');
    expect(text).toContain('Unknown schema or rule id: "field-no-consumer"');
    expect(text).toContain(`Rules with an explanation: ${Object.keys(RULE_EXPLANATIONS).join(', ')}`);
  }, 60_000);
});

describe('the printed shape of each shortened rule — verdict, fix, rule line with the pointer (#22161)', () => {
  const fieldFinding = () => {
    const [finding] = validateFieldConsumers({
      objects: [
        {
          name: 'my_app_ticket',
          fields: { title: { type: 'text' }, description: { type: 'textarea' } },
        },
      ],
      views: [{ list: { data: { object: 'my_app_ticket' }, columns: [{ field: 'title' }] } }],
    });
    return finding;
  };

  it('field-no-consumers', async () => {
    const finding = fieldFinding();
    expect(finding.rule).toBe(FIELD_NO_CONSUMERS);
    expect(authoringFindingDetailLines(finding)).toEqual([
      'fix: add it to a view column or a form section, or remove the declaration',
      'rule: field-no-consumers  at objects[0].fields.description — ' +
        '`os explain field-no-consumers` for what counts as a consumer',
    ]);
    const out = await captureStdout(() => printAuthoringAdvisories([finding]));
    expect(out.split('\n').filter((l) => l.trim() !== '')).toEqual([
      '  ⚠ object "my_app_ticket" · field "description": declared, but nothing in this stack displays or reads it (inert)',
      '    fix: add it to a view column or a form section, or remove the declaration',
      '    rule: field-no-consumers  at objects[0].fields.description — ' +
        '`os explain field-no-consumers` for what counts as a consumer',
    ]);
  });

  it('security-owd-unset', async () => {
    const [finding] = validateSecurityPosture({ objects: [{ name: 'my_app_ticket', label: 'Ticket' }] });
    expect(finding.rule).toBe(SECURITY_OWD_UNSET);
    const out = await captureStdout(() => printAuthoringRuleErrors([finding]));
    expect(out.split('\n').filter((l) => l.trim() !== '')).toEqual([
      '  • object "my_app_ticket": custom object declares no sharingModel (OWD); the runtime falls back to ' +
        "'private', but the baseline must be an authored decision",
      "      fix: declare sharingModel: 'private' (owner + shares; recommended), 'public_read', " +
        "'public_read_write', or 'controlled_by_parent' (master-detail children)",
      '      rule: security-owd-unset  at objects[0].sharingModel — ' +
        '`os explain security-owd-unset` for why the baseline must be declared',
    ]);
  });

  it('a rule without an explanation keeps a bare rule line', () => {
    expect(authoringFindingDetailLines({ rule: 'liveness-dead-property', path: 'views[0].name', hint: 'Remove it.' }))
      .toEqual(['fix: Remove it.', 'rule: liveness-dead-property  at views[0].name']);
    expect(authoringFindingDetailLines({ rule: 'some-rule', path: 'p' })).toEqual(['rule: some-rule  at p']);
  });

  // The `fix:` label is only true of a hint that IS a fix. `expression-invalid`
  // used to put the authored source in `hint`, which printed as
  // `fix: source: \`status != "resolved"\`` — the expression the author already
  // wrote, offered as the fix. The source is a quote: it rides the verdict, so
  // it still reaches the text face (and the runtime 422 issue's `message`).
  it('expression-invalid: the authored source rides the verdict, and no `fix: source:` line is printed', async () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateStackExpressions');
    expect(entry, 'the registry entry that adapts ExprIssue into expression-invalid').toBeDefined();
    const [finding] = entry!.run(
      {
        objects: [
          {
            name: 'my_app_ticket',
            fields: {
              title: { type: 'text' },
              status: { type: 'select', options: [{ label: 'Open', value: 'open' }, { label: 'Resolved', value: 'resolved' }] },
            },
          },
        ],
        actions: [
          { name: 'resolve_ticket', label: 'Resolve', objectName: 'my_app_ticket', type: 'script', visible: 'status != "resolved"' },
        ],
      },
      {},
    );
    expect(finding?.rule).toBe(EXPRESSION_INVALID);
    expect(finding.message).toContain('Write `record.status`');
    expect(finding.message).toMatch(/ — source: `status != "resolved"`$/);
    expect(finding.hint).toBe('');

    const out = await captureStdout(() => printAuthoringRuleErrors([finding]));
    const lines = out.split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`  • ${finding.where}: ${finding.message}`);
    expect(lines[0]).toContain('source: `status != "resolved"`');
    expect(lines[1]).toBe(`      rule: expression-invalid  at ${finding.path}`);
    expect(out).not.toMatch(/fix: source:/);
    expect(out).not.toMatch(/^\s*fix:/m);
  });
});
