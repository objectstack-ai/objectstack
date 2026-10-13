import { describe, it, expect } from 'vitest';
import { isViewContainerShaped, ViewSchema } from '@objectstack/spec/ui';
import {
  validateViewContainers as validateViewContainersUnrecorded,
  VIEW_CONTAINER_SHAPE,
} from './validate-view-containers.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain view-container-shape`. Every direct call below records
// what it fired, and the last cases in this file hold each recorded verdict to
// one line of at most 200 characters — every firing variant this suite
// exercises, not a chosen few. Run the whole file: those cases read what the
// cases above fired.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateViewContainers: typeof validateViewContainersUnrecorded = (...args) => {
  const findings = validateViewContainersUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

describe('validateViewContainers (defineView container shape guardrail)', () => {
  it('passes a proper container with a default list', () => {
    const findings = validateViewContainers({
      views: [
        { list: { type: 'grid', data: { provider: 'object', object: 'task' }, columns: ['title'] } },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it('passes a container with only named listViews / formViews', () => {
    const findings = validateViewContainers({
      views: [
        { listViews: { urgent: { type: 'grid', columns: ['title'] } } },
        { formViews: { edit: { type: 'simple', sections: [{ fields: ['title'] }] } } },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  // [#5320] Inverted from "passes an independent ViewItem": the loader's
  // as-is registration of ViewItems from `views:` was the undeclared wider
  // acceptance this card removed, and the pre-parse door now reaches the same
  // verdict the schema and the registration loop enforce.
  it('flags an independent ViewItem in `views:` with the wrap-it prescription (#5320)', () => {
    const findings = validateViewContainers({
      views: [
        {
          name: 'task.pipeline',
          object: 'task',
          viewKind: 'list',
          config: { type: 'kanban', columns: ['title'] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: VIEW_CONTAINER_SHAPE,
      path: 'views[0]',
    });
    expect(findings[0].where).toContain('task.pipeline');
    expect(findings[0].message).toContain('containers only');
    expect(findings[0].hint).toContain('defineView');
    expect(findings[0].hint).toContain('metadata door');
  });

  it('flags a hand-authored `viewItems:` as machine-assembled-only (#5320)', () => {
    const findings = validateViewContainers({
      viewItems: [
        {
          name: 'task.pipeline',
          object: 'task',
          viewKind: 'list',
          config: { type: 'kanban', columns: ['title'] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: VIEW_CONTAINER_SHAPE,
      path: 'viewItems',
    });
    expect(findings[0].message).toContain('machine-assembled');
    expect(findings[0].hint).toContain('metadata door');
  });

  it('flags a flat list-view object with the wrap-it hint', () => {
    const findings = validateViewContainers({
      views: [
        {
          name: 'all_tasks',
          label: 'All Tasks',
          type: 'grid',
          data: { provider: 'object', object: 'task' },
          columns: ['title', 'status'],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: VIEW_CONTAINER_SHAPE,
      path: 'views[0]',
    });
    expect(findings[0].where).toContain('all_tasks');
    expect(findings[0].message).toContain('Flat list-view object');
    expect(findings[0].hint).toContain('defineView');
  });

  it('flags a container whose slots are all empty', () => {
    const findings = validateViewContainers({
      views: [{ listViews: {}, formViews: {} }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('defines no views');
  });

  it('handles a name-keyed views map', () => {
    const findings = validateViewContainers({
      views: {
        task: { list: { type: 'grid', columns: ['title'] } },
        broken: { type: 'grid', columns: ['title'] },
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('views.broken');
  });

  it('ignores non-object entries and stacks without views', () => {
    expect(validateViewContainers({})).toHaveLength(0);
    expect(validateViewContainers({ views: [null, 42, 'x'] as unknown as [] })).toHaveLength(0);
  });
});

describe('[#22161] one-line verdicts — view-container-shape', () => {
  const viewItem = { name: 'task.pipeline', object: 'task', viewKind: 'list', config: { type: 'kanban', columns: ['title'] } };
  const flat = { name: 'all_tasks', type: 'grid', data: { provider: 'object', object: 'task' }, columns: ['title'] };

  it('reads as one sentence per arm', () => {
    const findings = validateViewContainers({ views: [viewItem, flat, { listViews: {} }] });
    expect(findings.map((f) => f.message)).toEqual([
      'A ViewItem record (`viewKind`) is not a view container: `views:` carries containers only, so the stack '
        + 'schema, this rule and the registration loop all refuse it.',
      'Flat list-view object is not a view container: its single-view keys sit where the container slots '
        + 'belong, so the stack schema and the registration loop refuse it.',
      'View container defines no views — all of `list` / `form` / `listViews` / `formViews` are absent or '
        + 'empty, so nothing registers.',
    ]);
  });

  it('the refusals the verdicts name are the schema\'s and the registration loop\'s', () => {
    // The flat arm used to say `ViewSchema` strips the keys to an EMPTY
    // container. Held here to the two seams instead: the strict schema refuses
    // both single-view shapes, and the loop's classifier
    // (`isViewContainerShaped`) refuses both while it takes the empty container.
    for (const [label, entry] of [['ViewItem', viewItem], ['flat', flat]] as const) {
      expect(ViewSchema.safeParse(entry).success, label).toBe(false);
      expect(isViewContainerShaped(entry), label).toBe(false);
    }
    expect(isViewContainerShaped({ listViews: {} })).toBe(true);
  });

  it('`os explain` carries what the verdicts no longer say', () => {
    const entry = explainRule(VIEW_CONTAINER_SHAPE);
    expect(entry, 'no `os explain view-container-shape` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      '`{ list, form, listViews, formViews }`',
      'no switcher entry',
      '`ViewSchema` is strict',
      '`isViewContainerShaped`, 422 `INVALID_METADATA`',
      'one container-only contract',
      '`os lint` on a raw config',
      '`defineStack(config, { strict: false })`',
      'machine-assembled channel',
      '`PUT /api/v1/meta/view`',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === VIEW_CONTAINER_SHAPE);
    // The coverage control first: all four arms fired.
    for (const arm of ['A ViewItem record', '`viewItems` is', 'Flat list-view object', 'View container defines no views']) {
      expect(converted.some((f) => f.message.startsWith(arm)), arm).toBe(true);
    }
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});

// [#22161] Slice 16: the `fix:` lines. The ViewItem arm names its two ways out
// in one line; that machine-assembled manifests carry it under `viewItems:` is
// the explanation's.
describe('[#22161] one-line fixes — view-container-shape', () => {
  it('every `fix:` line the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === VIEW_CONTAINER_SHAPE);
    // Coverage control: all four arms fired.
    for (const arm of ['A ViewItem record', '`viewItems` is', 'Flat list-view object', 'View container defines no views']) {
      expect(converted.some((f) => f.message.startsWith(arm)), arm).toBe(true);
    }
    for (const f of converted) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('the ViewItem arm reads as one remedy', () => {
    const [f] = validateViewContainers({
      views: [{ name: 'task.pipeline', object: 'task', viewKind: 'list', config: { type: 'kanban', columns: ['title'] } }],
    });
    expect(f!.hint).toBe(
      'Wrap it in a defineView container (defineView({ list: { type, data, columns, ... }, listViews: { ... } })), ' +
        'or author it through the metadata door (Studio / `PUT /api/v1/meta/view`)',
    );
  });
});
