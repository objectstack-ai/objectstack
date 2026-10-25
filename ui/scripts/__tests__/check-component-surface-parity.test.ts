import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { parseSource } from '../check-handler-key-read-sites.mjs';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import {
  BASE_INTERFACE,
  DESIGNER_SEED_ROWS,
  ExtractionError,
  SPEC_SPECIFIER,
  TYPES_SRC,
  ambientKeys,
  analyze,
  dynamicRegistrationsIn,
  frameworkReads,
  interfaceKeySet,
  readInterfaceIndex,
  specKeySets,
} from '../check-component-surface-parity.mjs';

/**
 * objectui#4631. The gate this file tests compares the FOUR declared surfaces of
 * one registered component type -- spec `ComponentPropsMap`, what the renderer
 * reads, the TS interface, and the registry `inputs` -- under the ruling's
 * authority order.
 *
 * A parity check is the one gate shape that can be catastrophically, invisibly
 * vacuous, and this one has FIVE ways to be so:
 *
 *   - read no registration (an AST walk that stops seeing `register()`), and
 *     every set difference is empty;
 *   - resolve no renderer body (the registration hands over a NAME), and every
 *     declared key reads as extra while every read key vanishes;
 *   - find no interface, and "zero declared keys" reads as "zero bad keys";
 *   - lose the ambient set, and every `className` in the tree is a finding --
 *     a confident RED over a broken instrument, which is the same defect as a
 *     confident green wearing the other hat;
 *   - resolve the wrong `ComponentPropsMap` (a local look-alike), and the spec
 *     half judges nothing.
 *
 * So the controls here are EXECUTABLE, and the first of them is a control that
 * FIRES: a synthetic type whose `inputs` name a key on neither face must be
 * reported. A suite that only proves silence proves nothing.
 */

const here = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(here, '..', '..');

/** The spec half, stubbed. Values only need a readable `shape`. */
const specStub = (map: Record<string, string[]>) => async () => ({
  ComponentPropsMap: Object.fromEntries(
    Object.entries(map).map(([type, keys]) => [
      type,
      { shape: Object.fromEntries(keys.map((key) => [key, true])) },
    ]),
  ),
});

/** No spec entry for anything -- the `tooltip` / `text` case the ruling names. */
const NO_SPEC = specStub({ 'some:unrelated': ['x'] });

/**
 * The two files every fixture tree needs before a single registration can be
 * judged: the base interface every schema extends, and the render loop the
 * ambient set is derived from. Deliberately MINIMAL -- a fixture that copied
 * the real ones would be measuring them instead of the gate.
 */
const SCAFFOLD: Record<string, string> = {
  'packages/types/src/base.ts': `
export interface BaseSchema {
  type: string;
  id?: string;
  className?: string;
  [key: string]: any;
}
`,
  'packages/react/src/SchemaRenderer.tsx': `
export const SchemaRenderer = ({ schema }: { schema: any }) => {
  const visible = schema.visible;
  const source = schema.dataSource;
  return React.createElement(Component, {
    schema,
    className: schema.className,
    'data-obj-id': schema.id,
  });
};
`,
};

/** A throwaway tree in the shape the gate walks: `packages/<name>/src/<file>`. */
function tree(label: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `component-surface-${label}-`));
  for (const [rel, contents] of Object.entries({ ...SCAFFOLD, ...files })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/** One registration file: an interface, a renderer, and the `register()` call. */
function block({
  type,
  namespace = 'ui',
  iface = '',
  body = 'return null;',
  meta = '',
}: {
  type: string;
  namespace?: string;
  iface?: string;
  body?: string;
  meta?: string;
}) {
  return {
    'packages/types/src/widget.ts': `
import type { BaseSchema } from './base';
export interface WidgetSchema extends BaseSchema {
  type: '${type}';
${iface}
}
`,
    'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import type { WidgetSchema } from '@object-ui/types';

function WidgetRenderer({ schema }: { schema: WidgetSchema }) {
  ${body}
}

ComponentRegistry.register('${type}', WidgetRenderer, {
  namespace: '${namespace}',
${meta}
});
`,
  };
}

/** A standalone source file for the reader-level unit tests. */
function parseFixture(source: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'surface-parse-')), 'f.tsx');
  fs.writeFileSync(file, source);
  return parseSource(fs.readFileSync(file, 'utf8'), file);
}

const run = (root: string, options: Record<string, unknown> = {}) =>
  analyze(root, { importSpec: NO_SPEC, seedLedger: {}, ...options });

const kinds = (findings: Array<{ kind: string; key: string }>) =>
  findings.map((finding) => `${finding.kind}:${finding.key}`).sort();

describe('check-component-surface-parity', () => {
  describe('the control that fires', () => {
    it('reports an `inputs` name that is on NEITHER face', async () => {
      const root = tree(
        'input-ghost',
        block({
          type: 'widget',
          iface: '  real?: string;',
          body: 'return schema.real;',
          meta: "  inputs: [{ name: 'real' }, { name: 'ghostKey' }],",
        }),
      );
      const { findings } = await run(root);
      expect(kinds(findings)).toContain('input-outside-keyset:ghostKey');
      const ghost = findings.find((finding) => finding.key === 'ghostKey');
      expect(ghost?.type).toBe('ui:widget');
      expect(ghost?.detail).toContain('outside (spec ∪ renderer reads)');
    });

    it('is SILENT on the same tree once the key is real -- so the fire above is the key, not the fixture', async () => {
      const root = tree(
        'input-real',
        block({
          type: 'widget',
          iface: '  real?: string;',
          body: 'return schema.real;',
          meta: "  inputs: [{ name: 'real' }],",
        }),
      );
      expect(kinds((await run(root)).findings)).toEqual([]);
    });
  });

  describe('the ruling: interface key set = spec ∪ renderer reads', () => {
    it('reports a key the renderer reads and the interface does not declare', async () => {
      const root = tree(
        'iface-missing',
        block({ type: 'widget', iface: '  children?: string;', body: 'return schema.trigger;' }),
      );
      expect(kinds((await run(root)).findings)).toEqual([
        'interface-extra-key:children',
        'interface-missing-key:trigger',
      ]);
    });

    it('reports a key the SPEC declares and the interface does not -- spec outranks the interface', async () => {
      const root = tree('spec-missing', block({ type: 'widget', body: 'return null;' }));
      const { findings } = await run(root, { importSpec: specStub({ 'ui:widget': ['content'] }) });
      expect(kinds(findings)).toEqual(['interface-missing-key:content']);
      expect(findings[0].detail).toContain('the spec declares');
    });

    it('does NOT report a key the spec declares once the interface declares it too', async () => {
      const root = tree(
        'spec-aligned',
        block({ type: 'widget', iface: '  content?: string;', body: 'return schema.content;' }),
      );
      expect(
        kinds((await run(root, { importSpec: specStub({ 'ui:widget': ['content'] }) })).findings),
      ).toEqual([]);
    });
  });

  describe('`inputs` ⊆ the key set -- an OMISSION is legal', () => {
    /**
     * objectui#7316 WAS the live specimen: `toast` / `sonner` declared and read
     * `buttonVariant` while both registry `inputs` arrays omitted it. That card
     * is resolved -- both now declare the key -- so the specimen is gone from
     * the tree and this fixture is the only place the shape survives. It is
     * kept, deliberately: the ruling's rule is a SUBSET relation, an omission
     * is not a violation, and this assertion exists so that widening the rule
     * to a two-way mirror cannot happen silently. Do NOT read the resolution of
     * one specimen as licence to drop the rule it exercised.
     */
    it('is silent on a key the interface declares and the renderer reads but `inputs` omits', async () => {
      const root = tree(
        'inputs-omit',
        block({
          type: 'widget',
          iface: '  buttonLabel?: string;\n  buttonVariant?: string;',
          body: 'return [schema.buttonLabel, schema.buttonVariant];',
          meta: "  inputs: [{ name: 'buttonLabel' }],",
        }),
      );
      expect(kinds((await run(root)).findings)).toEqual([]);
    });
  });

  describe('a `never` member is a TOMBSTONE, not a declaration', () => {
    it('does not report a tombstoned key as an extra declaration', async () => {
      const root = tree(
        'tombstone-quiet',
        block({
          type: 'widget',
          iface: '  trigger?: string;\n  children?: never;',
          body: 'return schema.trigger;',
        }),
      );
      expect(kinds((await run(root)).findings)).toEqual([]);
    });

    it('DOES report a renderer still reading a key the interface refuses by name', async () => {
      const root = tree(
        'tombstone-read',
        block({
          type: 'widget',
          iface: '  children?: never;',
          body: 'return schema.children;',
        }),
      );
      const { findings } = await run(root);
      expect(kinds(findings)).toEqual(['read-of-tombstoned-key:children']);
      expect(findings[0].detail).toContain('never');
    });
  });

  describe('the ambient set -- keys that belong to every type, billed to none', () => {
    it('does not bill a `BaseSchema` key to the block that inherits it', async () => {
      const root = tree(
        'ambient-base',
        block({
          type: 'widget',
          body: 'return schema.className;',
          meta: "  inputs: [{ name: 'className' }],",
        }),
      );
      expect(kinds((await run(root)).findings)).toEqual([]);
    });

    it('does not bill a key only the RENDER LOOP reads', async () => {
      const root = tree(
        'ambient-loop',
        block({ type: 'widget', meta: "  inputs: [{ name: 'dataSource' }]," }),
      );
      expect(kinds((await run(root)).findings)).toEqual([]);
    });

    it('is derived from BOTH halves, and each contributes something the other lacks', () => {
      const interfaces = readInterfaceIndex(repoRoot);
      const loop = frameworkReads(repoRoot);
      const ambient = ambientKeys(repoRoot, interfaces);
      const base = new Set(interfaces.get(BASE_INTERFACE)!.own.keys());
      expect([...loop].some((key) => !base.has(key))).toBe(true);
      expect([...base].some((key) => !loop.has(key))).toBe(true);
      expect(ambient.size).toBeGreaterThan(Math.max(loop.size, base.size));
    });
  });

  describe('read channels the first cut of this gate was blind to', () => {
    it('counts an `element:*` config-bag read -- `readProps(schema).k`', async () => {
      const root = tree(
        'config-bag',
        block({
          type: 'widget',
          body: "const props = readProps<{ items?: string[] }>(schema); return props.items;",
          meta: "  inputs: [{ name: 'items' }],",
        }),
      );
      const { findings } = await run(root);
      expect(kinds(findings)).not.toContain('input-outside-keyset:items');
    });

    it('lets a destructured PROPS parameter widen `inputs` without making the interface owe a declaration', async () => {
      const root = tree('props-channel', {
        'packages/types/src/widget.ts': `
import type { BaseSchema } from './base';
export interface WidgetSchema extends BaseSchema { type: 'widget'; }
`,
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
function WidgetRenderer({ title, subtitle }: { title?: string; subtitle?: string }) {
  return [title, subtitle];
}
ComponentRegistry.register('widget', WidgetRenderer, {
  namespace: 'ui',
  inputs: [{ name: 'title' }, { name: 'subtitle' }],
});
`,
      });
      const { findings } = await run(root);
      expect(kinds(findings)).toEqual([]);
    });

    /**
     * The measured false positive the props channel produced before it was
     * split off: `DataTableRowActionsMenu({ schema, row, t })` is reached
     * through `<Child schema={…}>`, and its own props are chosen by its PARENT.
     * Billing `row` and `t` to `ui:data-table` made two authored keys out of a
     * table row and a translate function.
     */
    it('does not bill a CHILD component\'s own props to the registered type', async () => {
      const root = tree('child-props', {
        'packages/types/src/widget.ts': `
import type { BaseSchema } from './base';
export interface WidgetSchema extends BaseSchema { type: 'widget'; }
`,
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import type { WidgetSchema } from '@object-ui/types';

const RowMenu = ({ schema, row, t }: { schema: WidgetSchema; row: any; t: any }) => [row, t];

function WidgetRenderer({ schema }: { schema: WidgetSchema }) {
  return <RowMenu schema={schema} row={null} t={null} />;
}

ComponentRegistry.register('widget', WidgetRenderer, { namespace: 'ui' });
`,
      });
      const { types } = await run(root);
      const widget = types.find((record) => record.type === 'ui:widget')!;
      expect([...widget.renderer.reads.keys()]).not.toContain('row');
      expect([...widget.renderer.reads.keys()]).not.toContain('t');
    });

    it('follows the registration through a NAME and an HOC, not just an inline arrow', async () => {
      const root = tree('hoc', {
        'packages/types/src/widget.ts': `
import type { BaseSchema } from './base';
export interface WidgetSchema extends BaseSchema { type: 'widget'; deep?: string; }
`,
        'packages/widget/src/impl.tsx': `
import type { WidgetSchema } from '@object-ui/types';
export function Inner({ schema }: { schema: WidgetSchema }) { return schema.deep; }
`,
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import { Inner } from './impl';
const Wrapped = withCarrier(Inner);
ComponentRegistry.register('widget', Wrapped, { namespace: 'ui' });
`,
      });
      const { types } = await run(root);
      const widget = types.find((record) => record.type === 'ui:widget')!;
      expect([...widget.renderer.reads.keys()]).toContain('deep');
      expect(widget.iface.name).toBe('WidgetSchema');
    });
  });

  describe('the `defaultProps` census', () => {
    const pair = (fallback: string, seed: string) =>
      tree(`pair-${fallback}-${seed}`.replace(/\W+/g, ''), {
        ...block({
          type: 'widget',
          iface: '  align?: string;',
          body: `const a = schema.align || ${fallback}; return a;`,
          meta: `  inputs: [{ name: 'align' }],\n  defaultProps: { align: ${seed} },`,
        }),
      });

    it('counts a comparable pair and reports the divergence', async () => {
      const { census, divergences } = await run(pair("'start'", "'center'"));
      expect(census.comparablePairs).toBe(1);
      expect(census.divergences).toBe(1);
      expect(census.unregistered).toBe(1);
      expect(divergences[0]).toMatchObject({
        row: 'ui:widget.align',
        defaultProps: '"center"',
        fallback: '"start"',
      });
    });

    it('counts an AGREEING pair as comparable and reports no divergence', async () => {
      const { census } = await run(pair("'start'", "'start'"));
      expect(census.comparablePairs).toBe(1);
      expect(census.divergences).toBe(0);
    });

    it('a registered designer-seed reason takes the row out of the UNREGISTERED count, not out of the census', async () => {
      const { census, divergences } = await run(pair("'start'", "'center'"), {
        seedLedger: { 'ui:widget.align': 'seed: a fresh canvas drop should look centred' },
      });
      expect(census.divergences).toBe(1);
      expect(census.unregistered).toBe(0);
      expect(divergences[0].reason).toContain('seed:');
    });

    it('reports a STALE seed row whose pair no longer diverges -- the ledger cannot rot into an allowlist', async () => {
      const { staleSeeds } = await run(pair("'start'", "'start'"), {
        seedLedger: { 'ui:widget.align': 'seed: no longer true' },
      });
      expect(staleSeeds).toEqual(['ui:widget.align']);
    });

    it('lands with an EMPTY seed ledger -- populating it would be adjudicating the rows', () => {
      expect(DESIGNER_SEED_ROWS).toEqual({});
    });
  });

  describe('coverage gaps are reported, never counted as agreement', () => {
    it('does not report a `schema: any` renderer as an interface with zero keys', async () => {
      const root = tree('any-schema', {
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
function WidgetRenderer({ schema }: { schema: any }) { return schema.whatever; }
ComponentRegistry.register('widget', WidgetRenderer, {
  namespace: 'ui',
  inputs: [{ name: 'whatever' }],
});
`,
      });
      const { coverage, findings, types } = await run(root);
      expect(coverage.interfaceUnresolved).toHaveLength(1);
      expect(types.map((record) => record.iface.unresolvedReason)).toEqual(['schema-typed-any']);
      expect(kinds(findings)).toEqual([]);
    });

    it('records an `inputs` entry it cannot name rather than dropping it', async () => {
      const root = tree(
        'inputs-unreadable',
        block({ type: 'widget', meta: '  inputs: [...SHARED_INPUTS],' }),
      );
      const { coverage } = await run(root);
      expect(coverage.inputsUnreadable).toHaveLength(1);
    });
  });

  /**
   * objectui#4631 instrument review, round 2. Each of these covers one repair,
   * and the first two FIRE: a bucket that prints nothing and a guard that never
   * skips are both invisible in a green run.
   */
  describe('F1 -- a dynamically typed registration is a named bucket, never a silent pass', () => {
    it('reports a `register(variable, …)` factory instead of dropping its types', async () => {
      const root = tree('dynamic-reg', {
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
ComponentRegistry.register('widget', () => null, { namespace: 'ui' });
for (const tag of ['h1', 'p']) {
  ComponentRegistry.register(tag, () => null, { namespace: 'ui' });
}
`,
      });
      const { coverage, counters } = await run(root);
      expect(coverage.dynamicRegistrations).toHaveLength(1);
      expect(coverage.dynamicRegistrations[0]).toMatchObject({
        file: 'packages/widget/src/index.tsx',
        spelledAs: 'tag',
      });
      expect(counters.dynamicRegistrationSites).toBe(1);
      // The types behind it are NOT invented: the census judges only the one it
      // can name, and says so through the bucket rather than through silence.
      expect(counters.judged).toBe(1);
    });

    it('still FAILS on an under-read that is neither named nor dynamic', async () => {
      const root = tree('under-read-still', {
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
ComponentRegistry.register('widget', () => null, { namespace: 'ui' });
ComponentRegistry.register('orphan');
`,
      });
      await expect(run(root)).rejects.toThrow(ExtractionError);
    });

    it('reads the factory sites on the real tree, and they are outside the judged population', async () => {
      const { coverage, types } = await analyze(repoRoot);
      expect(coverage.dynamicRegistrations.length).toBeGreaterThan(0);
      const judged = new Set(types.map((record) => record.type));
      // Controls that FIRE in the same population, so "absent" is a reading.
      for (const present of ['nav:menu', 'ui:toast', 'ui:sonner']) expect(judged.has(present)).toBe(true);
      for (const absent of ['ui:h1', 'ui:p', 'field:text']) expect(judged.has(absent)).toBe(false);
    }, 120_000);

    it('`dynamicRegistrationsIn` sees a variable key and does not see a literal one', () => {
      const dynamic = dynamicRegistrationsIn(
        parseFixture("ComponentRegistry.register(tag, C, {});"),
        null,
        'f.tsx',
      );
      expect(dynamic).toHaveLength(1);
      expect(
        dynamicRegistrationsIn(parseFixture("ComponentRegistry.register('x', C, {});"), null, 'f.tsx'),
      ).toHaveLength(0);
    });
  });

  describe('F3 -- the `inputs` rule is guarded on its own coverage gap', () => {
    it('does NOT report inputs for a registration whose renderer body it cannot reach', async () => {
      const root = tree('inputs-guarded', {
        'packages/types/src/widget.ts': `
import type { BaseSchema } from './base';
export interface WidgetSchema extends BaseSchema { type: 'widget'; }
`,
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import { Renderer } from '@some/package-outside-this-walk';
ComponentRegistry.register('widget', Renderer, {
  namespace: 'ui',
  inputs: [{ name: 'objectName' }, { name: 'columns' }],
});
`,
      });
      const { findings, coverage, types } = await run(root);
      expect(types.map((record) => record.renderer.unresolved)).toEqual([
        'component-body-not-reachable',
      ]);
      expect(coverage.rendererUnresolved).toHaveLength(1);
      // The row stays in the bucket; it does not become two false findings.
      expect(kinds(findings)).toEqual([]);
    });

    it('FIRES on the same inputs once the renderer body IS reachable -- so the guard is the gap, not the rule', async () => {
      const root = tree('inputs-unguarded', {
        'packages/types/src/widget.ts': `
import type { BaseSchema } from './base';
export interface WidgetSchema extends BaseSchema { type: 'widget'; }
`,
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
function Renderer({ schema }: { schema: any }) { return schema.somethingElse; }
ComponentRegistry.register('widget', Renderer, {
  namespace: 'ui',
  inputs: [{ name: 'objectName' }, { name: 'columns' }],
});
`,
      });
      const { findings } = await run(root);
      expect(kinds(findings)).toEqual([
        'input-outside-keyset:columns',
        'input-outside-keyset:objectName',
      ]);
    });
  });

  describe('F2 / F4 / F5 -- what the census must disclose about itself', () => {
    it('counts the spec-and-interface INTERSECTION, not just its two halves', async () => {
      const aligned = tree(
        'intersection',
        block({ type: 'widget', iface: '  content?: string;', body: 'return schema.content;' }),
      );
      const { counters } = await run(aligned, { importSpec: specStub({ 'ui:widget': ['content'] }) });
      expect(counters.withSpec).toBe(1);
      expect(counters.withInterface).toBe(1);
      expect(counters.withSpecAndInterface).toBe(1);

      // A spec-declared type whose renderer takes `schema: any` -- the real
      // tree's whole shape -- has both halves non-zero and the intersection 0.
      const inert = tree('intersection-inert', {
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
function WidgetRenderer({ schema }: { schema: any }) { return schema.content; }
ComponentRegistry.register('widget', WidgetRenderer, { namespace: 'ui' });
`,
        'packages/types/src/other.ts': `
import type { BaseSchema } from './base';
export interface OtherSchema extends BaseSchema { type: 'other'; x?: string; }
`,
      });
      const inertCounters = (await run(inert, { importSpec: specStub({ 'ui:widget': ['content'] }) }))
        .counters;
      expect(inertCounters.withSpec).toBe(1);
      expect(inertCounters.withSpecAndInterface).toBe(0);
    });

    it('attributes every `interface-missing-key` to the arm that actually fired', async () => {
      const root = tree('cause', block({ type: 'widget', body: 'return schema.readOnly;' }));
      const { findings } = await run(root, { importSpec: specStub({ 'ui:widget': ['specOnly'] }) });
      const causes = Object.fromEntries(findings.map((f) => [f.key, f.cause]));
      expect(causes).toEqual({ specOnly: 'spec', readOnly: 'renderer' });
    });

    it('never tags `interface-missing-key` with the rest-spread caveat, which is about UNREAD keys', async () => {
      const root = tree('missing-not-hedged', {
        'packages/types/src/widget.ts': `
import type { BaseSchema } from './base';
export interface WidgetSchema extends BaseSchema { type: 'widget'; }
`,
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import type { WidgetSchema } from '@object-ui/types';
function Renderer({ schema, ...props }: { schema: WidgetSchema; [k: string]: any }) {
  return <div {...props}>{schema.deep}</div>;
}
ComponentRegistry.register('widget', Renderer, { namespace: 'ui' });
`,
      });
      const { types, findings } = await run(root);
      expect(types[0].renderer.forwardsRest).toBe(true);
      const missing = findings.filter((finding) => finding.kind === 'interface-missing-key');
      expect(missing.length).toBeGreaterThan(0);
      expect(missing.every((finding) => finding.restSpread === false)).toBe(true);
    });

    it('names the registrations whose declared interface is the base itself', async () => {
      const root = tree('base-annotated', {
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import type { BaseSchema } from '@object-ui/types';
function Renderer({ schema }: { schema: BaseSchema }) { return schema.anything; }
ComponentRegistry.register('widget', Renderer, { namespace: 'ui' });
`,
      });
      const { counters, findings } = await run(root);
      expect(counters.withBaseAsItsOwnInterface).toBe(1);
      // No OWN members, so `interface-extra-key` is structurally impossible here.
      expect(findings.some((finding) => finding.kind === 'interface-extra-key')).toBe(false);
    });
  });

  describe('extraction failure is an ERROR, never a pass', () => {
    it('throws when the population holds no registration at all', async () => {
      const root = tree('empty-population', {
        'packages/widget/src/index.tsx': 'export const nothing = 1;\n',
      });
      await expect(run(root)).rejects.toThrow(ExtractionError);
      await expect(run(root)).rejects.toThrow(/no `ComponentRegistry.register` call/);
    });

    it('throws when the render loop is missing -- an empty ambient set is a confident RED', () => {
      const root = tree('no-loop', {});
      fs.rmSync(path.join(root, 'packages/react/src/SchemaRenderer.tsx'));
      expect(() => frameworkReads(root)).toThrow(ExtractionError);
    });

    it('throws when the base interface is missing', () => {
      const root = tree('no-base', {
        'packages/types/src/widget.ts': 'export interface WidgetSchema { type: string; }\n',
      });
      fs.rmSync(path.join(root, 'packages/types/src/base.ts'));
      expect(() => ambientKeys(root, readInterfaceIndex(root))).toThrow(ExtractionError);
    });

    it('throws when `ComponentPropsMap` cannot be resolved', async () => {
      await expect(specKeySets(async () => ({}))).rejects.toThrow(ExtractionError);
      await expect(specKeySets(async () => ({ ComponentPropsMap: {} }))).rejects.toThrow(
        ExtractionError,
      );
    });

    it('throws when this walk reads FEWER register calls than the tree\'s own registration reader', async () => {
      // `ComponentRegistry.register('orphan')` has a readable key and no
      // component, so `component-registrations.mjs` counts it and this walk
      // cannot attribute it. A census that silently dropped it would be short by
      // one type with nothing to say so.
      const root = tree('under-read', {
        'packages/widget/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
ComponentRegistry.register('widget', () => null, { namespace: 'ui' });
ComponentRegistry.register('orphan');
`,
      });
      await expect(run(root)).rejects.toThrow(ExtractionError);
      await expect(run(root)).rejects.toThrow(/register call/);
    });

    it('accepts a backtick key, so the cross-check above fires on a real shortfall and not on a quote character', async () => {
      const root = tree('backtick-key', {
        'packages/widget/src/index.tsx': [
          "import { ComponentRegistry } from '@object-ui/core';",
          'ComponentRegistry.register(`widget`, () => null, { namespace: \'ui\' });',
        ].join('\n'),
      });
      const { types } = await run(root);
      expect(types.map((record) => record.type)).toEqual(['ui:widget']);
    });
  });

  describe('provenance -- the spec half is the INSTALLED build', () => {
    it('reads `ComponentPropsMap` from the same module a plain import resolves', async () => {
      const resolved = await specKeySets();
      expect(resolved.size).toBe(Object.keys(ComponentPropsMap).length);
      for (const type of Object.keys(ComponentPropsMap)) expect(resolved.has(type)).toBe(true);
      expect(SPEC_SPECIFIER).toBe('@objectstack/spec/ui');
    });

    it('treats a `z.never()` entry as DECLARED-with-no-keys, not as missing', async () => {
      const resolved = await specKeySets();
      const never = [...resolved.values()].filter((entry) => entry.kind === 'never');
      expect(never.length).toBeGreaterThan(0);
      expect(never.every((entry) => entry.keys.size === 0)).toBe(true);
      expect([...resolved.values()].every((entry) => entry.kind !== 'unreadable')).toBe(true);
    });
  });

  describe('against the real tree', () => {
    it('reads all four surfaces and stays report-only', async () => {
      const result = await analyze(repoRoot);
      // Non-vacuity, in the four directions a vacuous run would collapse.
      expect(result.counters.judged).toBeGreaterThan(100);
      expect(result.counters.withSpec).toBeGreaterThan(0);
      expect(result.counters.withInterface).toBeGreaterThan(0);
      expect(result.counters.withRenderer).toBeGreaterThan(result.counters.judged / 2);
      expect(result.census.comparablePairs).toBeGreaterThan(0);
      // The interface index is real, and `BaseSchema` resolves through it.
      const index = readInterfaceIndex(repoRoot);
      expect(index.has(BASE_INTERFACE)).toBe(true);
      expect(TYPES_SRC).toBe('packages/types/src');
    }, 120_000);

    it('resolves a real interface through its `extends` chain, splitting the base out as INHERITED', () => {
      const index = readInterfaceIndex(repoRoot);
      const tooltip = interfaceKeySet('TooltipSchema', index);
      expect(tooltip.own.size).toBeGreaterThan(0);
      expect(tooltip.inherited.has('className')).toBe(true);
      expect(tooltip.own.has('className')).toBe(false);
    });
  });
});
