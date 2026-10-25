import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KNOWN_UNDECLARED_READS,
  analyze,
  claimedTypeKeys,
  collectArms,
  isHandlerKey,
  registrationsIn,
  parseSource,
} from '../check-handler-key-read-sites.mjs';

/**
 * objectui#7753 — every `on*` key a registered renderer READS off the authored
 * document must be a declared member of the arm for the type it is registered
 * under.
 *
 * `BaseSchema` is `.passthrough()`, so a key that is not declared is not refused:
 * it stops being judged and the value is KEPT. objectui#7664 measured that on the
 * built dist — `{ type: 'kanban', columns: [], onCardClick: { action: 'toast' } }`
 * went from REFUSED to ACCEPTED with the object surviving into the parsed output
 * — while every gate stayed green, because the #6124 ledger's population is a
 * literal and the change re-keyed the arm by SUBSTITUTION.
 *
 * What this file pins, in the order the gate can go wrong:
 *
 *  1. **The lit control, and a control ON that control.** Deleting a
 *     still-read key from an arm must go RED and name it; a deletion of
 *     comparable size from the same arm that is HARMLESS must stay GREEN.
 *     Without the second leg, "the plant reddens it" only proves the gate
 *     reacts to edits.
 *  2. **The historical shape, rebuilt as a fixture.** The registration hands
 *     over a NAME, that name is an HOC, the document reaches the reader through
 *     a render-prop parameter and an object spread. Every hop in that chain is
 *     load-bearing: a walk that stops at any of them is GREEN on objectui#7664's
 *     own deletion, which is the one reading that would make this gate
 *     worthless.
 *  3. **Each narrowing, named after the false positive it removed.** The first,
 *     coarser cut of this gate produced 36 findings on `main`; every one of the
 *     rules below is why a class of them is gone.
 *  4. **A green is never "the walk found nothing."** Every fixture that passes
 *     asserts its own counters are non-zero, and so does the repository run.
 *  4b. **A registration is keyed on what it CLAIMS** (objectui#9573).
 *     `skipFallback` under a namespace means the registration never claims the
 *     bare type key, so the bare arm is another component's and a finding
 *     against it is addressed to the wrong schema. Both directions are pinned:
 *     rows that could not be drained, and a read that PASSED because the foreign
 *     arm happened to declare the same spelling.
 *  4c. **A registration WRAPPER hop is taken** (objectui#9700). A type-only cast
 *     on the expression that hands a child the document erases at runtime, so it
 *     must not close the hop. ⚠️ A lost HOP is worse than a lost read: the
 *     component leaves the census entirely, and the green then covers a file the
 *     gate never opened. That is the state objectui#9447 stood in.
 *  5. **This repository is green**, with the ledger's rows all still live.
 *  6. **The gate is wired** where the sibling parse-based gates run, and the
 *     page that inventories them names it.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway tree in the shape the gate walks: `packages/<name>/src/<file>`,
 * with the zod mirrors at `packages/types/src/zod`. Written to disk rather than
 * fed as strings because the population walk — which directories are read, which
 * files are skipped as tooling — is half of what can go wrong.
 */
function tree(label: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `handler-reads-${label}-`));
  fixtures.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return root;
}

/** `BaseSchema` is the base every arm extends; without it no arm resolves. */
const BASE = `
import { z } from 'zod';
export const BaseSchema = z.object({
  id: z.string().optional(),
  className: z.string().optional(),
});
`;

/** One arm, written the way the mirrors write one. */
function arm(type: string, schemaName: string, members: string[]): string {
  return `
import { z } from 'zod';
import { BaseSchema } from './base.zod';
import { handlerKeyRefusal } from './tombstone.zod';
export const ${schemaName} = BaseSchema.extend({
  type: z.literal('${type}'),
${members.map((m) => `  ${m},`).join('\n')}
});
`;
}

const RUNTIME_SLOT = (key: string) => `${key}: handlerKeyRefusal('${key}', 'runtime-slot', '${key} handler')`;
const RETIRED = (key: string) => `${key}: handlerKeyRefusal('${key}', 'retired', '${key} handler')`;

/** Keys of the findings a run produced, in a form a test can read. */
const keysOf = (root: string) => analyze(root).findings.map((finding) => finding.key).sort();

describe('check-handler-key-read-sites — the lit control, and the control on it', () => {
  const board = (members: string[]) => ({
    'packages/types/src/zod/base.zod.ts': BASE,
    'packages/types/src/zod/complex.zod.ts': arm('kanban', 'KanbanSchema', members),
    'packages/plugin-kanban/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
export const KanbanRenderer = ({ schema }: { schema: any }) => (
  <Board onCardMove={schema.onCardMove} onCardClick={schema.onCardClick} />
);
ComponentRegistry.register('kanban', KanbanRenderer, { namespace: 'view' });
`,
  });

  const DECLARED = [RUNTIME_SLOT('onCardMove'), RUNTIME_SLOT('onCardClick'), "coverImageField: z.string().optional()"];

  it('is green while both read keys are declared, and says so with real counts', () => {
    const result = analyze(tree('lit-green', board(DECLARED)));
    expect(result.findings).toEqual([]);
    // A green that walked nothing is the failure this whole gate family exists
    // to prevent, so the green above is only meaningful beside these.
    expect(result.counters.arms).toBeGreaterThan(0);
    expect(result.counters.armed).toBe(1);
    expect(result.counters.reads).toBe(2);
    expect(result.counters.judged).toBe(2);
  });

  it('goes RED and names the key when a still-read key is deleted from the arm', () => {
    // objectui#7664's edit, verbatim in shape: the key leaves the arm, the
    // renderer keeps forwarding it.
    const root = tree('lit-red', board(DECLARED.filter((m) => !m.includes('onCardClick'))));
    const result = analyze(root);
    expect(result.findings.map((f) => f.key)).toEqual(['kanban::KanbanSchema.onCardClick']);
    expect(result.findings[0].kind).toBe('undeclared');
    expect(result.findings[0].file).toBe('packages/plugin-kanban/src/index.tsx');
  });

  it('stays GREEN on a deletion of the same size from the same arm that is harmless', () => {
    // The control ON the control. Identical operation — one member removed from
    // the same object literal in the same file — but the member is not read by
    // any renderer, so nothing about the document's judgement changed. If this
    // reddened, the red above would only mean "a file was edited".
    const root = tree('lit-nearmiss', board(DECLARED.filter((m) => !m.includes('coverImageField'))));
    const result = analyze(root);
    expect(result.findings).toEqual([]);
    expect(result.counters.judged).toBe(2);
  });

  it('goes RED when a still-read key is declared RETIRED rather than deleted', () => {
    // The other direction of the same contract: a tombstone says nothing reads
    // this key, and a renderer reading it contradicts that in the tree.
    const root = tree('lit-retired', board([RUNTIME_SLOT('onCardMove'), RETIRED('onCardClick')]));
    const result = analyze(root);
    expect(result.findings.map((f) => `${f.kind} ${f.key}`)).toEqual([
      'retired-but-read kanban::KanbanSchema.onCardClick',
    ]);
  });
});

describe('check-handler-key-read-sites — the historical chain, hop by hop', () => {
  /**
   * objectui#7664's real shape, which is the reason this gate walks at all:
   *
   *   register('kanban', ObjectKanbanRenderer)   — a NAME, not a body
   *   ObjectKanbanRenderer = block(Inner)        — an HOC
   *   Inner renders <Gate schema={schema}>{(bound) => <ObjectKanban schema={bound} />}
   *   ObjectKanban renders <KanbanRenderer schema={{ ...effective, … }} />
   *   KanbanRenderer reads schema.onCardClick
   */
  const chain = (members: string[]) => ({
    'packages/types/src/zod/base.zod.ts': BASE,
    'packages/types/src/zod/complex.zod.ts': arm('kanban', 'KanbanSchema', members),
    'packages/plugin-kanban/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import { ObjectKanban } from './ObjectKanban';
export const KanbanRenderer = ({ schema }: { schema: any }) => (
  <Board onCardMove={schema.onCardMove} onCardClick={schema.onCardClick} />
);
export const ObjectKanbanRenderer = elementDataSourceBlock(({ schema, ...props }: any) => (
  <ElementDataSourceGate schema={schema}>
    {(bound: any) => <ObjectKanban schema={bound} {...props} />}
  </ElementDataSourceGate>
));
ComponentRegistry.register('kanban', ObjectKanbanRenderer, { namespace: 'view' });
`,
    'packages/plugin-kanban/src/ObjectKanban.tsx': `
import { KanbanRenderer } from './index';
export const ObjectKanban = ({ schema }: { schema: any }) => {
  const effectiveSchema = { ...schema, columns: [] };
  return <KanbanRenderer schema={{ ...effectiveSchema, onCardMove: handle }} />;
};
`,
  });

  it('reaches the reader four hops away and is green when the arm declares the keys', () => {
    const result = analyze(tree('chain-green', chain([RUNTIME_SLOT('onCardMove'), RUNTIME_SLOT('onCardClick')])));
    expect(result.findings).toEqual([]);
    // Named, not counted: a walk that stopped at the registration identifier
    // would also report zero findings.
    expect(result.census.map((c) => `${c.type}.${c.key}`).sort()).toEqual(['kanban.onCardClick', 'kanban.onCardMove']);
  });

  it('goes RED on the real deletion, four hops from the registration', () => {
    const root = tree('chain-red', chain([RUNTIME_SLOT('onCardMove')]));
    expect(keysOf(root)).toEqual(['kanban::KanbanSchema.onCardClick']);
  });
});

describe('check-handler-key-read-sites — the narrowings, each named after what it removed', () => {
  it('reads registrations off the AST, so prose naming the call registers nothing', () => {
    // 13 of the coarse cut's 36 findings came from `packages/types/src/complex.ts`,
    // which NAMES `ComponentRegistry.register('chatbot', ...)` in doc comments
    // eleven times and registers nothing — the file's own interfaces then read as
    // handler reads on three chatbot arms.
    const root = tree('prose', {
      'packages/types/src/zod/base.zod.ts': BASE,
      'packages/types/src/zod/complex.zod.ts': arm('chatbot', 'ChatbotSchema', [RUNTIME_SLOT('onSend')]),
      'packages/types/src/complex.ts': `
/**
 * The registration is \`ComponentRegistry.register('chatbot', ChatbotRenderer)\`,
 * which is where \`schema.onCardClick\` would be forwarded if it were.
 */
export interface ChatbotSchema { onCardClick?: () => void }
`,
    });
    const result = analyze(root);
    expect(result.counters.registrations).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('scopes `props.onX` to the component\'s own parameters, not every nested arrow', () => {
    // `'menubar'.onClick`, from the coarse cut: `items.map((child) => child.onClick?.())`
    // is a MENU ITEM's handler, not the board's document.
    const root = tree('nested-param', {
      'packages/types/src/zod/base.zod.ts': BASE,
      'packages/types/src/zod/complex.zod.ts': arm('menubar', 'MenubarSchema', ["menus: z.array(z.any()).optional()"]),
      'packages/components/src/menubar.tsx': `
import { ComponentRegistry } from '@object-ui/core';
ComponentRegistry.register('menubar', ({ schema, ...props }: any) => (
  <Menubar>
    {schema.menus?.map((child: any) => <Item key={child.id} onSelect={() => child.onClick?.()} />)}
  </Menubar>
), { namespace: 'ui' });
`,
    });
    expect(analyze(root).findings).toEqual([]);
  });

  it('does not follow a child handed a document the parent BUILT', () => {
    // `'object-view'.onViewChange`, from the second cut: `ObjectView` composes
    // `{ type: 'view-switcher', …, storageKey: \`view-pref-\${schema.objectName}\` }`
    // and hands it to `<ViewSwitcher schema={…} />`. It mentions `schema`, so a
    // mention test called it the parent's document and reported `ViewSwitcher`'s
    // read against `ObjectViewSchema` — an arm that is not even the one read.
    const root = tree('new-document', {
      'packages/types/src/zod/base.zod.ts': BASE,
      'packages/types/src/zod/objectql.zod.ts': arm('object-view', 'ObjectViewSchema', ["objectName: z.string().optional()"]),
      'packages/plugin-view/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import { ObjectView } from './ObjectView';
ComponentRegistry.register('object-view', ObjectView, { namespace: 'view' });
`,
      'packages/plugin-view/src/ObjectView.tsx': `
import { ViewSwitcher } from './ViewSwitcher';
export const ObjectView = ({ schema }: { schema: any }) => {
  const viewSwitcherSchema = { type: 'view-switcher', storageKey: schema.objectName };
  return <ViewSwitcher schema={viewSwitcherSchema} />;
};
`,
      'packages/plugin-view/src/ViewSwitcher.tsx': `
export const ViewSwitcher = ({ schema }: { schema: any }) => <div>{schema.onViewChange}</div>;
`,
    });
    expect(analyze(root).findings).toEqual([]);
  });

  it('does not follow a child handed a DIFFERENT document', () => {
    // `'dashboard'.onRowClick`, from the second cut: a dashboard lays out widgets
    // and each gets its own `schema`, so the widget's `schema.onRowClick` is a
    // read of the WIDGET's document.
    const root = tree('other-document', {
      'packages/types/src/zod/base.zod.ts': BASE,
      'packages/types/src/zod/complex.zod.ts': arm('dashboard', 'DashboardSchema', ["components: z.array(z.any()).optional()"]),
      'packages/plugin-dashboard/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import { DashboardRenderer } from './DashboardRenderer';
ComponentRegistry.register('dashboard', DashboardRenderer, { namespace: 'view' });
`,
      'packages/plugin-dashboard/src/DashboardRenderer.tsx': `
import { Widget } from './Widget';
export const DashboardRenderer = ({ schema }: { schema: any }) => (
  <div>{schema.components.map((widget: any) => <Widget key={widget.id} schema={widget} />)}</div>
);
`,
      'packages/plugin-dashboard/src/Widget.tsx': `
export const Widget = ({ schema }: { schema: any }) => <Table onRowClick={schema.onRowClick} />;
`,
    });
    expect(analyze(root).findings).toEqual([]);
  });

  it('says nothing about a type that has no arm', () => {
    // `'kanban-ui'`, `'kanban-enhanced'`, and the whole app-shell surface. An arm
    // that does not exist cannot have lost a member.
    const root = tree('no-arm', {
      'packages/types/src/zod/base.zod.ts': BASE,
      'packages/app-shell/src/notifications.tsx': `
import { ComponentRegistry } from '@object-ui/core';
ComponentRegistry.register('notifications', ({ schema }: any) => <X onDismiss={schema.onDismiss} />, {});
`,
    });
    const result = analyze(root);
    expect(result.counters.registrations).toBe(1);
    expect(result.counters.armed).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('resolves a spread shape, so a member reached through `pick().shape` counts as declared', () => {
    // Four of the first cut's findings were `chatbot-enhanced` / `chatbot-floating`
    // slots that ARE declared — through `...ChatbotSharedMirrorShape`, which is
    // `ChatbotSchema.pick({ … }).shape`.
    const root = tree('spread', {
      'packages/types/src/zod/base.zod.ts': BASE,
      'packages/types/src/zod/complex.zod.ts': `
import { z } from 'zod';
import { BaseSchema } from './base.zod';
import { handlerKeyRefusal } from './tombstone.zod';
export const ChatbotSchema = BaseSchema.extend({
  type: z.literal('chatbot'),
  ${RUNTIME_SLOT('onSend')},
  ${RUNTIME_SLOT('onError')},
});
const SharedShape = ChatbotSchema.pick({ onSend: true, onError: true }).shape;
export const ChatbotEnhancedSchema = BaseSchema.extend({
  type: z.literal('chatbot-enhanced'),
  ...SharedShape,
});
`,
      'packages/plugin-chatbot/src/renderer.tsx': `
import { ComponentRegistry } from '@object-ui/core';
ComponentRegistry.register('chatbot-enhanced', ({ schema }: any) => (
  <Chat onSend={schema.onSend} onError={schema.onError} />
), { namespace: 'plugin' });
`,
    });
    const result = analyze(root);
    expect(result.findings).toEqual([]);
    expect(result.counters.judged).toBe(2);
  });

  it('refuses to judge a read on an arm whose shape spreads something it cannot follow', () => {
    // The one direction a gate must never take is a red nobody can act on. An
    // unresolved spread means the member list is not fully known, so "undeclared"
    // is not a claim this reader is entitled to make.
    const root = tree('unresolved', {
      'packages/types/src/zod/base.zod.ts': BASE,
      'packages/types/src/zod/objectql.zod.ts': `
import { z } from 'zod';
import { BaseSchema } from './base.zod';
import { SpecFields } from '@objectstack/spec';
export const ObjectGridSchema = BaseSchema.extend({
  type: z.literal('object-grid'),
  ...SpecFields,
});
`,
      'packages/plugin-grid/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
ComponentRegistry.register('object-grid', ({ schema }: any) => <Grid onNavigate={schema.onNavigate} />, {});
`,
    });
    const result = analyze(root);
    expect(result.findings).toEqual([]);
    expect(result.counters.unjudgeable).toBe(1);
    expect(result.census[0].unjudgeable).toEqual(['SpecFields']);
  });

  it('resolves a bare alias base, so `BaseSchema = BaseSchemaCore` does not blank every arm', () => {
    // This one is a scar. `export const BaseSchema = BaseSchemaCore;` is a plain
    // alias; missing it made all 106 arms carry an unresolved base, which marked
    // every read unjudgeable and turned the repository run into a green that had
    // judged 23 of 62 read sites.
    const root = tree('alias-base', {
      'packages/types/src/zod/base.zod.ts': `
import { z } from 'zod';
const BaseSchemaCore = z.object({ id: z.string().optional() });
export const BaseSchema = BaseSchemaCore;
`,
      'packages/types/src/zod/form.zod.ts': arm('button', 'ButtonSchema', [RUNTIME_SLOT('onClick')]),
      'packages/components/src/button.tsx': `
import { ComponentRegistry } from '@object-ui/core';
ComponentRegistry.register('button', ({ schema }: any) => <b onClick={schema.onClick} />, {});
`,
    });
    const result = analyze(root);
    expect(result.counters.unjudgeable).toBe(0);
    expect(result.counters.judged).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it('judges only `on*` names', () => {
    expect(isHandlerKey('onCardClick')).toBe(true);
    expect(isHandlerKey('onclick')).toBe(false);
    expect(isHandlerKey('on')).toBe(false);
    expect(isHandlerKey('once')).toBe(false);
    expect(isHandlerKey('columns')).toBe(false);
  });

  it('reads a registration\'s type off a string literal, and skips a computed one', () => {
    const source = parseSource(
      `ComponentRegistry.register('kanban', A, {});\nComponentRegistry.register(type, B, {});\nOther.register('x', C);`,
      'probe.tsx',
    );
    expect(registrationsIn(source).map((r) => r.type)).toEqual(['kanban']);
  });
});

/**
 * objectui#9344 — a cast ERASES the receiver, and this census read the AST
 * literally enough to lose the read along with it.
 *
 * `(schema as any).onTabChange` and `schema.onTabChange` emit the same property
 * access on the same object: the cast is gone before anything runs. So this is
 * not a channel the gate had declared itself out of — the docblock lists five of
 * those and a cast is none of them — it was an undeclared hole, and two LIVE
 * reads sat in it while the census count that missed them was quoted as a
 * population in one ruling and six dispatches (objectui#7804's "39").
 *
 * ⚠️ The first leg is the FIRING NEGATIVE CONTROL, and it is what makes every
 * other green in this file mean something. Before the fix this exact fixture was
 * GREEN. Without a leg that reddens on a cast-hidden read, a green gate cannot
 * distinguish "now covered" from "still blind" — which is the whole failure
 * objectui#9344 measured.
 */
describe('check-handler-key-read-sites — a cast does not hide a read (objectui#9344)', () => {
  // ⚠️ The fixture key is `onTabSwap`, not the live `onTabChange`, and that is
  // load-bearing rather than cosmetic: `KNOWN_UNDECLARED_READS` is global, so a
  // fixture naming the same `type::Schema.key` as a real ledger row is EXEMPTED
  // and reports no finding. Spelled `onTabChange`, the negative control below
  // went green for that reason alone — a green that says nothing about whether
  // the gate can see a cast.
  const behindCast = (members: string[], read: string) => ({
    'packages/types/src/zod/base.zod.ts': BASE,
    'packages/types/src/zod/layout.zod.ts': arm('tabs', 'TabsSchema', members),
    'packages/plugin-tabs/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
export const TabsRenderer = ({ schema }: { schema: any }) => (
  <Tabs onValueChange={${read}} />
);
ComponentRegistry.register('tabs', TabsRenderer, { namespace: 'view' });
`,
  });

  // ⭐ THE FIRING NEGATIVE CONTROL. A handler read deliberately hidden behind a
  // cast, on an arm that declares nothing, must turn the gate RED. This leg
  // fails on the gate as it stood before objectui#9344 — that is its job.
  it('goes RED on a handler read hidden behind an `as any` cast', () => {
    const result = analyze(tree('cast-red', behindCast([], '(schema as any).onTabSwap')));
    expect(
      result.findings.map((f) => `${f.kind} ${f.key}`),
      'a cast-hidden read of a key no arm declares must be a FINDING — a green here is the ' +
        'objectui#9344 blindness, not a clean tree',
    ).toEqual(['undeclared tabs::TabsSchema.onTabSwap']);
    expect(result.counters.reads).toBe(1);
  });

  // The optional-chained spelling, which is how `packages/components`' layout
  // `containers.tsx` writes the live one. `?.` puts the cast under a
  // PropertyAccessExpression with a questionDotToken; the receiver is the same
  // parenthesised cast either way, so losing one spelling and not the other
  // would be a half-fix.
  it('goes RED on the optional-chained cast spelling too', () => {
    const result = analyze(tree('cast-red-optional', behindCast([], '(schema as any)?.onTabSwap')));
    expect(result.findings.map((f) => f.key)).toEqual(['tabs::TabsSchema.onTabSwap']);
  });

  // The other type-only wrappers that erase the same way. Each is asserted for
  // the READ being seen, so a future narrowing that drops one is caught here
  // rather than by the next census that quietly shrinks.
  it.each([
    ['non-null assertion', 'schema!.onTabSwap'],
    ['satisfies expression', '(schema satisfies any).onTabSwap'],
    ['a cast under a cast', '((schema as any) as any).onTabSwap'],
  ])('sees the read through a %s', (_label, read) => {
    const result = analyze(tree(`cast-red-${_label.replace(/\W+/g, '-')}`, behindCast([], read)));
    expect(result.findings.map((f) => f.key)).toEqual(['tabs::TabsSchema.onTabSwap']);
  });

  // ⚠️ The angle-bracket assertion is the one erasing form this gate CANNOT see,
  // and that is a property of the parse rather than of the walk: `parseSource`
  // hard-codes `ts.ScriptKind.TSX`, under which `<any>schema` is JSX and the
  // property access never exists. Asserted rather than left out, so the day the
  // gate stops parsing as TSX this leg says what changed.
  it('cannot see the angle-bracket assertion, because TSX parses it as JSX', () => {
    const result = analyze(tree('cast-angle', behindCast([], '(<any>schema).onTabSwap')));
    expect(result.findings).toEqual([]);
    expect(result.counters.reads).toBe(0);
    // FIRING CONTROL for that zero: the identical fixture with the `as any`
    // spelling DOES produce the read, so this zero is about the parse of one
    // form and not a fixture the walk never reached.
    const asAny = analyze(tree('cast-angle-control', behindCast([], '(schema as any).onTabSwap')));
    expect(asAny.counters.reads).toBe(1);
    expect(asAny.findings.map((f) => f.key)).toEqual(['tabs::TabsSchema.onTabSwap']);
  });

  // The control ON the negative control: the same cast-hidden read, DECLARED.
  // Green here has to be a green about the declaration — so the read counter is
  // asserted non-zero, because a green that walked nothing would satisfy the
  // findings assertion identically.
  it('stays GREEN when the arm declares the key the cast hides', () => {
    const result = analyze(
      tree('cast-green', behindCast([RUNTIME_SLOT('onTabSwap')], '(schema as any).onTabSwap')),
    );
    expect(result.findings).toEqual([]);
    expect(
      result.counters.reads,
      'the green above must be a judgement on a read that was FOUND, not a walk that found none',
    ).toBe(1);
    expect(result.counters.judged).toBe(1);
  });

  // ⚠️ The widening is about what the gate SEES, never about what it JUDGES.
  // Peeling the wrapper still leaves an identifier that has to be the document
  // or the component's own props parameter — so a cast on an unrelated local
  // stays invisible, exactly as the uncast form of the same read does.
  it('still ignores a cast on an object that is not the document or the props', () => {
    const result = analyze(
      tree('cast-unrelated', {
        'packages/types/src/zod/base.zod.ts': BASE,
        'packages/types/src/zod/layout.zod.ts': arm('tabs', 'TabsSchema', []),
        'packages/plugin-tabs/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import { useToolbar } from './toolbar';
export const TabsRenderer = ({ schema }: { schema: any }) => {
  const toolbar = useToolbar();
  return <Tabs label={schema.title} onValueChange={(toolbar as any).onTabSwap} />;
};
ComponentRegistry.register('tabs', TabsRenderer, { namespace: 'view' });
`,
      }),
    );
    expect(result.findings).toEqual([]);
    // FIRING CONTROL for that zero: the same fixture shape DOES produce a read
    // when the receiver is the document, one leg above. A zero with no such
    // control would also be produced by a walk that never ran.
    expect(result.counters.reads).toBe(0);
    expect(result.counters.registrations).toBe(1);
    expect(result.counters.armed).toBe(1);
  });
});

/**
 * objectui#9573 — a registration is keyed on what it CLAIMS, not on how its type
 * string is spelled.
 *
 * `register()` in `@object-ui/core`'s `Registry` sets `ns:type`, and sets the
 * bare `type` key only when a namespaced registration omits `skipFallback`. A
 * census keyed on the raw string therefore judged
 * `{ namespace: 'view', skipFallback: true }` against the bare key's arm — the
 * key `skipFallback` exists to stop that alias claiming — and asked its question
 * of a schema minted for a DIFFERENT component.
 *
 * ⚠️ The defect moved the count in BOTH directions, so both are pinned here:
 * rows that could never be drained (the alias's reads scored against a foreign
 * arm) and a read that PASSED for a coincidental reason (the foreign arm happened
 * to declare the same spelling), which left no row at all and so could not be
 * seen in the ledger.
 */
describe('check-handler-key-read-sites — the registration WRAPPER hop, and the cast that hid it (objectui#9700)', () => {
  /**
   * objectui#9447's shape, rebuilt hop for hop.
   *
   * `register('detail-view', DetailViewRenderer)` hands the registry a WRAPPER:
   * `elementDataSourceBlock(...)` around a body that renders a data-source gate
   * and gives the real component the document through the gate's render-prop
   * parameter — `{(bound) => <DetailView schema={bound as DetailViewSchema} />}`.
   * The gate is imported from another package, so the walk cannot follow it; the
   * render-prop hop is the ONLY way to `DetailView`, and the `as` on that
   * attribute is what closed it.
   *
   * ⚠️ objectui#9344 peeled type-only wrappers off a READ receiver. It did not
   * peel them off a HOP, and the two failures are not symmetric: a hidden read
   * still leaves the component in the census, while a hidden hop removes the
   * component entirely — no finding, no ledger row, no census row, and a green
   * that reads as "no undeclared reads" over a file the gate never opened. That
   * is the state objectui#9447 stood in: two undeclared keys read on a live
   * call path, and this gate exited 0 over them.
   *
   * ⚠️ The key is spelled `onRecordJump`, never a live one: `KNOWN_UNDECLARED_READS`
   * is global, so a fixture reusing a real row's `type::Schema.key` is EXEMPTED
   * and its RED leg goes green for a reason that has nothing to do with the hop.
   */
  const wrapped = (members: string[], handed: string) => ({
    'packages/types/src/zod/base.zod.ts': BASE,
    'packages/types/src/zod/views.zod.ts': arm('detail-view', 'DetailViewSchema', members),
    'packages/plugin-detail/src/DetailView.tsx': `
export const DetailView = ({ schema }: { schema: any }) => (
  <article onClick={() => schema.onRecordJump?.('/next')} />
);
`,
    'packages/plugin-detail/src/index.tsx': `
import { ComponentRegistry, elementDataSourceBlock } from '@object-ui/core';
import { ElementDataSourceGate } from '@object-ui/react';
import { DetailView } from './DetailView';
export const DetailViewRenderer = elementDataSourceBlock(({ schema, ...props }: any) => {
  const fallbackNode = { id: 'placeholder' };
  return (
    <ElementDataSourceGate schema={schema} testId="detail-view">
      {(bound) => <DetailView schema={${handed}} {...props} />}
    </ElementDataSourceGate>
  );
});
ComponentRegistry.register('detail-view', DetailViewRenderer, { namespace: 'plugin-detail' });
`,
  });

  // ⭐ THE FIRING PIN. objectui#9447's own shape, on an arm that declares
  // nothing: the gate must reach `DetailView` THROUGH the wrapper and report the
  // key. This leg is GREEN — findings `[]` — on the gate as it stood before
  // objectui#9700, which is precisely why the card exists: the miss was
  // demonstrated on the real tree and nothing in this file could have said so.
  it('goes RED on a read reached only through a registration wrapper handing a CAST document', () => {
    const result = analyze(tree('wrapper-cast-red', wrapped([], 'bound as DetailViewSchema')));
    expect(
      result.findings.map((f) => `${f.kind} ${f.key}`),
      'the wrapper hop must reach the component behind it — a green here is the objectui#9700 ' +
        'blind spot, and it certifies the very shape this gate hunts',
    ).toEqual(['undeclared detail-view::DetailViewSchema.onRecordJump']);
    expect(result.counters.reads).toBe(1);
  });

  // The control ON that pin: the same fixture with the key DECLARED. Green has
  // to be a green about the declaration, so the read and judged counters are
  // asserted non-zero — a walk that found nothing satisfies `findings: []`
  // identically.
  it('stays GREEN through the same wrapper when the arm declares the key', () => {
    const result = analyze(
      tree('wrapper-cast-green', wrapped([RUNTIME_SLOT('onRecordJump')], 'bound as DetailViewSchema')),
    );
    expect(result.findings).toEqual([]);
    expect(
      result.counters.reads,
      'the green must be a judgement on a read that was FOUND, not a hop that was never taken',
    ).toBe(1);
    expect(result.counters.judged).toBe(1);
  });

  // ⭐ FIRING CONTROL — ONE TOKEN apart. The same wrapper, the same cast, the
  // same arm; only the operand under the cast changes, from the render-prop
  // document to an unrelated local declared two lines above it. The hop must NOT
  // be taken. Without this leg, "peel the cast" could have been spelled "follow
  // every `schema=` attribute", which reattributes reads to arms that never see
  // them — the false positives `carriesDocument` exists to remove.
  it('FIRING CONTROL — a cast over a NON-document operand is still not followed', () => {
    const control = analyze(tree('wrapper-cast-control', wrapped([], 'fallbackNode as DetailViewSchema')));
    expect(control.findings).toEqual([]);
    expect(control.counters.reads).toBe(0);
    // The lit half of the pair, so the zero above is a reading about the operand
    // and not a fixture the walk never reached.
    const lit = analyze(tree('wrapper-cast-control-lit', wrapped([], 'bound as DetailViewSchema')));
    expect(lit.counters.reads).toBe(1);
    expect(lit.findings.map((f) => f.key)).toEqual(['detail-view::DetailViewSchema.onRecordJump']);
  });

  // Every type-only wrapper that erases the same way, on the hop side this time.
  // `erasedReceiverName` already peels all of them off a READ; a walk that peels
  // one spelling and not another is describing a type annotation, not a runtime.
  it.each([
    ['as-cast', 'bound as DetailViewSchema'],
    ['double cast', 'bound as unknown as DetailViewSchema'],
    ['non-null assertion', 'bound!'],
    ['satisfies expression', 'bound satisfies DetailViewSchema'],
    ['parenthesised cast', '(bound as DetailViewSchema)'],
    ['spread of a cast', '{ ...(bound as DetailViewSchema) }'],
  ])('takes the wrapper hop through a %s', (label, handed) => {
    const result = analyze(tree(`wrapper-hop-${label.replace(/\W+/g, '-')}`, wrapped([], handed)));
    expect(result.findings.map((f) => f.key)).toEqual(['detail-view::DetailViewSchema.onRecordJump']);
  });

  // ⚠️ The peel widens what the walk SEES, never what it FOLLOWS. A child handed
  // a document the wrapper BUILT is still not followed, cast or no cast — that
  // narrowing is what keeps `ViewSwitcher`'s `onViewChange` off `ObjectViewSchema`,
  // and a peel that reached past `declaresOwnType` would put it back.
  it('still refuses a hop to a child handed a document the wrapper BUILT, cast and all', () => {
    const result = analyze(
      tree('wrapper-built-doc', wrapped([], "{ ...bound, type: 'view-switcher' } as DetailViewSchema")),
    );
    expect(
      result.findings,
      'an object literal writing its own `type` is a NEW node; following it attributes the ' +
        "child's reads to an arm that never sees them",
    ).toEqual([]);
    expect(result.counters.reads).toBe(0);
  });
});

describe('check-handler-key-read-sites — a registration is keyed on what it CLAIMS (objectui#9573)', () => {
  /**
   * The tree's own shape: `ListViewRenderer` is registered under `view:list`
   * with `skipFallback: true` because the bare `list` key belongs to the
   * bullet/numbered list DISPLAY primitive, and it reads a density handler no
   * bullet list has any business declaring.
   */
  const alias = (meta: string, bareMembers: string[] = ['items: z.array(z.any()).optional()']) => ({
    'packages/types/src/zod/base.zod.ts': BASE,
    'packages/types/src/zod/data-display.zod.ts': arm('list', 'ListSchema', bareMembers),
    'packages/plugin-list/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
export const ListViewRenderer = ({ schema }: { schema: any }) => (
  <List onDensityChange={schema.onDensityChange} />
);
ComponentRegistry.register('list', ListViewRenderer, ${meta});
`,
  });

  it('does NOT judge a namespaced-only alias against the bare key\'s arm', () => {
    const result = analyze(tree('alias-skipfallback', alias("{ namespace: 'view', skipFallback: true }")));
    expect(
      result.findings.map((f) => f.key),
      'the bare `list` arm belongs to the bullet list primitive — a finding here is addressed to the ' +
        'wrong schema, and draining it would publish a density handler on a bullet list',
    ).toEqual([]);
    // ⚠️ NOT a green that lost the read. The read is still SEEN and still
    // counted; what changed is which arm it is put to, and no arm mirrors
    // `view:list`.
    expect(result.counters.judged).toBe(0);
    expect(result.counters.aliasRegistrations).toBe(1);
    expect(result.counters.aliasReads).toBe(1);
    expect(result.census.map((c) => `${c.type}.${c.key}`)).toEqual(['view:list.onDensityChange']);
    expect(result.census[0].unmirroredAlias).toEqual({ bareType: 'list', bareSchema: 'ListSchema' });
  });

  it('FIRING CONTROL — the same registration WITHOUT `skipFallback` claims the bare key and goes RED', () => {
    // The control on the control: one property removed from the same object
    // literal in the same file. `skipFallback` is the ONLY difference, so the
    // green above is a reading about the registration and not about a walk that
    // stopped finding the read.
    const result = analyze(tree('alias-fallback', alias("{ namespace: 'view' }")));
    expect(result.findings.map((f) => f.key)).toEqual(['list::ListSchema.onDensityChange']);
    expect(result.counters.judged).toBe(1);
    expect(result.counters.aliasReads).toBe(0);
  });

  it('judges a namespaced-only alias against the arm for the key it DOES claim, when one exists', () => {
    // The repair is not "stop judging aliases": it is "judge the key the
    // registry would resolve". Mirror `view:list` and the same read is judged
    // again — on the arm that is actually its own.
    const files = alias("{ namespace: 'view', skipFallback: true }");
    const result = analyze(
      tree('alias-mirrored', {
        ...files,
        'packages/types/src/zod/objectql.zod.ts': arm('view:list', 'ListViewSchema', [
          'items: z.array(z.any()).optional()',
        ]),
      }),
    );
    expect(result.findings.map((f) => f.key)).toEqual(['view:list::ListViewSchema.onDensityChange']);
    expect(result.counters.aliasReads).toBe(0);
    expect(result.counters.judged).toBe(1);
  });

  it('removes a FALSE GREEN: a foreign arm that coincidentally declares the same spelling', () => {
    // The half the ledger could never show. `'form' FormSchema.onCancel` passed
    // because `FormSchema` — the `ui:form` primitive's arm — mints its OWN
    // `onCancel` for its own destructure, and the two spellings coincided. A
    // passing read leaves no row, so no count of the ledger could see it.
    const files = alias("{ namespace: 'view', skipFallback: true }", [
      'items: z.array(z.any()).optional()',
      RUNTIME_SLOT('onDensityChange'),
    ]);
    const result = analyze(tree('alias-false-green', files));
    expect(result.findings).toEqual([]);
    // Before the re-key this read was JUDGED and DECLARED against the foreign
    // arm — green, and green for a reason that had nothing to do with it. Now it
    // is not judged there at all.
    expect(result.census.filter((c) => c.declared === true)).toEqual([]);
    expect(result.counters.judged).toBe(0);
    expect(result.counters.aliasReads).toBe(1);
  });

  it('resolves the mechanics through a same-file `const` and a spread of one', () => {
    // The tree hands five page registrations a shared `pageMeta` identifier and
    // spreads it in four of them. A reader that only understood inline literals
    // would mark all five unkeyable and stop judging reads it judges today.
    const source = parseSource(
      `const pageMeta: any = { namespace: 'ui', label: 'Page' };\n` +
        `const aliasMeta = { ...pageMeta, skipFallback: true };\n` +
        `ComponentRegistry.register('page', P, pageMeta);\n` +
        `ComponentRegistry.register('app', P, { ...pageMeta, label: 'App Page' });\n` +
        `ComponentRegistry.register('tabs', T, aliasMeta);\n` +
        `ComponentRegistry.register('inline', I, { namespace: 'page', skipFallback: true });\n` +
        `ComponentRegistry.register('bare', B);\n`,
      'probe.tsx',
    );
    expect(registrationsIn(source).map((r) => ({ type: r.type, keyable: r.keyable, claims: r.claims }))).toEqual([
      { type: 'page', keyable: true, claims: ['ui:page', 'page'] },
      { type: 'app', keyable: true, claims: ['ui:app', 'app'] },
      { type: 'tabs', keyable: true, claims: ['ui:tabs'] },
      { type: 'inline', keyable: true, claims: ['page:inline'] },
      { type: 'bare', keyable: true, claims: ['bare'] },
    ]);
  });

  it('refuses to KEY a registration whose mechanics it cannot resolve, rather than guessing', () => {
    // "Claims the bare key" and "is a namespaced-only alias" are different
    // questions about the same document, and guessing either way is this card's
    // defect in a narrower shape. ⚠️ The refusal is scoped to registrations whose
    // type HAS an arm — the rest were never judged anyway.
    const root = tree('unkeyable', {
      'packages/types/src/zod/base.zod.ts': BASE,
      'packages/types/src/zod/data-display.zod.ts': arm('list', 'ListSchema', ['items: z.array(z.any()).optional()']),
      'packages/plugin-list/src/index.tsx': `
import { ComponentRegistry } from '@object-ui/core';
import { listMeta } from '@object-ui/core/meta';
ComponentRegistry.register('list', ({ schema }: any) => <List onDensityChange={schema.onDensityChange} />, listMeta);
ComponentRegistry.register('unmirrored', ({ schema }: any) => <X onGo={schema.onGo} />, listMeta);
`,
    });
    const result = analyze(root);
    expect(result.unkeyable.map((u) => u.type)).toEqual(['list']);
    expect(result.counters.unkeyable).toBe(1);
    expect(result.counters.judged).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it('spells the claim rule the way the registry does', () => {
    expect(claimedTypeKeys({ type: 'list', namespace: undefined, skipFallback: false })).toEqual(['list']);
    expect(claimedTypeKeys({ type: 'list', namespace: 'view', skipFallback: false })).toEqual(['view:list', 'list']);
    expect(claimedTypeKeys({ type: 'list', namespace: 'view', skipFallback: true })).toEqual(['view:list']);
  });
});

describe('check-handler-key-read-sites — this repository', () => {
  const result = analyze(repoRoot);

  /**
   * The size guard. Every assertion above runs on a throwaway tree, so a
   * refactor that emptied this repository's walk would satisfy all of them while
   * reporting a pass over nothing.
   */
  it('walks a real population on both halves, and judges something in it', () => {
    expect(result.counters.arms).toBeGreaterThan(50);
    expect(result.counters.files).toBeGreaterThan(200);
    expect(result.counters.registrations).toBeGreaterThan(100);
    expect(result.counters.armed).toBeGreaterThan(10);
    expect(
      result.counters.judged,
      'no registered renderer in this repository reads a handler key off a document whose arm ' +
        'this gate could resolve, so its green says nothing',
    ).toBeGreaterThan(20);
  });

  it('is green, with the objectui#7664 read sites among the ones it judged', () => {
    expect(
      result.findings.map((f) => f.key),
      'a registered renderer reads a handler key its arm does not declare',
    ).toEqual([]);

    // Named rather than counted: these three are the reason this gate exists.
    // They sit four hops from the kanban plugin's registration, so a walk that
    // stopped following the document would leave the green above intact while
    // losing exactly the instance the card was filed for.
    //
    // ⚠️ Re-keyed by objectui#8802, and the re-key CHANGED ONE READING rather
    // than merely renaming a string. The rows used to be `kanban.*`, DECLARED,
    // carrying the RUNTIME SLOT disposition off the `'kanban'` Zod arm. That
    // arm retired with the bare node type key and the surviving `object-kanban`
    // face declared none of the three, so the walk went on finding all three
    // reads (which is what this leg is for) and reported them UNDECLARED.
    //
    // ⭐ objectui#7804 closed TWO of them on the surviving face, each measured
    // at its own channel, and the split is asserted rather than averaged: a
    // reading that put all three in one bucket would be the error that ruling
    // forbids. `onCardMove` was the third — its authored value reaches nothing
    // on this entry, which is the `'retired'` disposition, and THIS GATE
    // refused that spelling while `KanbanRenderer` still read the key.
    //
    // ⭐ objectui#9342 resolved that standoff by moving the READ: `onCardMove`
    // is an explicit React prop on `KanbanRendererProps` now, so it is no
    // longer a READ SITE at all and correctly leaves this census — while the
    // arm carries the tombstone. ⚠️ Its absence below is therefore a reading,
    // and the two survivors are what keep it from being a census that lost the
    // kanban walk altogether (the hop this whole leg exists for).
    //
    // ⭐ objectui#11234 took `onQuickAdd` out of the census the same way.
    // `ObjectKanban` renders the internal `KanbanBoardCore` now, which takes the
    // Quick Add pair only as explicit props, so the walk reaches no read of the
    // key, and the arm carries its tombstone. The exported `KanbanRenderer`
    // still reads `schema.onQuickAdd` for a React host, and no registration
    // reaches that body. `onCardClick` is the survivor that keeps the kanban
    // walk honest, and it is now read in the internal board's file, one hop
    // further than before.
    const judged = result.census.map((c) => `${c.type}.${c.key}`);
    expect(judged).toContain('object-kanban.onCardClick');
    expect(judged).not.toContain('object-kanban.onQuickAdd');
    expect(judged).not.toContain('object-kanban.onCardMove');
    const kanbanRow = (key: string) =>
      result.census.find((c) => c.type === 'object-kanban' && c.key === key);
    expect(
      ['onCardClick', 'onCardMove', 'onQuickAdd'].map((key) => ({
        key,
        declared: kanbanRow(key)?.declared,
        disposition: kanbanRow(key)?.disposition,
      })),
    ).toEqual([
      { key: 'onCardClick', declared: true, disposition: 'runtime-slot' },
      // No census row: the key is declared on the arm (as a tombstone) but the
      // renderer no longer reads it off the document, so there is nothing to
      // judge. The arm-side reading is asserted in the resolver leg below.
      { key: 'onCardMove', declared: undefined, disposition: undefined },
      // No census row either, since objectui#11234, for the same reason.
      { key: 'onQuickAdd', declared: undefined, disposition: undefined },
    ]);
    // The survivor's read site is the internal board the registration reaches
    // (objectui#11234), not the exported `KanbanRenderer` in the barrel.
    expect(kanbanRow('onCardClick')?.file).toBe('packages/plugin-kanban/src/KanbanBoardCore.tsx');

    // FIRING CONTROL for the `false` above: the census still reports DECLARED
    // runtime slots elsewhere, so `declared: false` is a reading about that one
    // key and not a census that lost its dispositions.
    const chatbotSend = result.census.find((c) => c.type === 'chatbot' && c.key === 'onSend');
    expect(chatbotSend?.declared).toBe(true);
    expect(chatbotSend?.disposition).toBe('runtime-slot');
  });

  /**
   * objectui#9700 on the real tree — objectui#9447's own instance, now a
   * READING where it used to be an absence.
   *
   * ⚠️ This is the leg the card was filed for. Its state before the repair was
   * not "declared" or "exempted": there were no `detail-view` rows AT ALL, and
   * no assertion in this file could tell that apart from a clean arm. The three
   * rows below are all read from ONE file — `DetailView.tsx` — which TWO
   * registrations reach, and only the raw one (`detail`) used to arrive.
   */
  it('reaches objectui#9447\'s reads through the `detail-view` registration WRAPPER', () => {
    const at = (type: string, key: string) => result.census.find((c) => c.type === type && c.key === key);

    expect(
      result.census.filter((c) => c.type === 'detail-view').map((c) => c.key).sort(),
      'the wrapper hop is the whole of objectui#9700 — an empty `detail-view` census is the blind ' +
        'spot restored, not a clean arm',
    ).toEqual(['onAddComment', 'onNavigate', 'onTabChange']);
    for (const key of ['onAddComment', 'onNavigate', 'onTabChange']) {
      expect(at('detail-view', key)?.file).toBe('packages/plugin-detail/src/DetailView.tsx');
    }

    // The two objectui#9447 named. They are DECLARED runtime slots today — that
    // card was fixed by a different path, ⛔ not by this gate — so what this leg
    // pins is that the gate can now SEE them. ⚠️ Green on these two says
    // "declared"; before the repair the same green said nothing at all.
    expect(at('detail-view', 'onNavigate')?.disposition).toBe('runtime-slot');
    expect(at('detail-view', 'onAddComment')?.disposition).toBe('runtime-slot');

    // The third is the row the blind spot was hiding: the SAME read site as
    // `detail::DetailSchema.onTabChange`, scored under the other registration
    // that reaches it. Both carry objectui#7804, which owns the disposition —
    // the decision lands in the zod arm, never in the gate.
    expect(at('detail-view', 'onTabChange')?.declared).toBe(false);
    expect(KNOWN_UNDECLARED_READS.get('detail-view::DetailViewSchema.onTabChange')).toBe('objectui#7804');

    // ⭐ FIRING CONTROL for all of the above: the RAW twin's rows. The repair
    // only ever ADDS hops — `register('detail', DetailView)` hands over the
    // component itself and its walk crosses no cast at all — so these three must
    // be untouched. If they moved, the reading above is a re-keying that
    // relocated the reads, not a wrapper hop that found them.
    expect(
      result.census.filter((c) => c.type === 'detail').map((c) => c.key).sort(),
    ).toEqual(['onAddComment', 'onNavigate', 'onTabChange']);
    expect(at('detail', 'onNavigate')?.disposition).toBe('runtime-slot');
    expect(at('detail', 'onTabChange')?.declared).toBe(false);
    expect(KNOWN_UNDECLARED_READS.get('detail::DetailSchema.onTabChange')).toBe('objectui#7804');
  });

  /**
   * objectui#9344's REPRODUCTION-IS-ACCEPTANCE leg, pinned on the real tree.
   *
   * Two live `(schema as any).onTabChange` reads were outside this census
   * entirely — not exempted, not judged, not counted. They are the measured
   * instance of the cast blindness, so they are named here rather than left to a
   * count: a count moves for any reason, and the reason these two moved is the
   * one thing this leg exists to hold.
   */
  it('counts the two cast-hidden `onTabChange` reads objectui#9344 measured', () => {
    const census = (type: string, key: string) => result.census.find((c) => c.type === type && c.key === key);

    // Both are SEEN by the census — the state before objectui#9344 was absence,
    // which no assertion about declaration could have caught. The cast-visibility
    // this leg exists for is unchanged — remove the receiver peeling and both rows
    // vanish from the census. The `containers` read belongs to
    // `PageTabsRenderer`, registered `{ namespace: 'page', skipFallback: true }`,
    // so it claims `page:tabs`; the `DetailView` read belongs to a registration
    // that omits `skipFallback`, so it claims the bare `detail` key and
    // `DetailSchema` is its arm.
    expect(census('page:tabs', 'onTabChange')?.file).toBe('packages/components/src/renderers/layout/containers.tsx');
    expect(census('detail', 'onTabChange')?.file).toBe('packages/plugin-detail/src/DetailView.tsx');

    // ⭐ `page:tabs` is judged against its OWN arm now (objectui#10872), and
    // declared there. It sat in the objectui#9573 alias population until then:
    // no mirror carried a `page:tabs` arm, and scoring the read against the bare
    // `tabs` key's `TabsSchema` — the `ui:tabs` primitive's arm, a DIFFERENT
    // component's — produced a row that could never be drained without
    // publishing a page-tab handler on the wrong schema, so objectui#9573 keyed
    // it as an unmirrored alias instead. objectui#10872 gave the ADR-0080 public
    // block its own arm, `PageTabsBlockSchema` (`public-blocks.zod.ts`), and
    // declared the host-injected callback there as an objectui#6124 RUNTIME
    // SLOT — so the read is judged where it lives, through that refusal.
    const pageTabs = census('page:tabs', 'onTabChange');
    expect(pageTabs?.unmirroredAlias, 'page:tabs is an armed type, not an alias').toBeUndefined();
    expect(pageTabs?.schema).toBe('PageTabsBlockSchema');
    expect(pageTabs?.declared).toBe(true);
    expect(pageTabs?.disposition).toBe('runtime-slot');
    // Un-vacuous from the arm side too: the resolver READ the member and its
    // disposition off the arm, rather than defaulting a row to green.
    expect(collectArms(repoRoot).arms.get('page:tabs')?.members.get('onTabChange')).toBe('runtime-slot');
    // …and nothing re-keys it onto the bare `tabs` arm.
    expect(census('tabs', 'onTabChange')).toBeUndefined();
    expect(KNOWN_UNDECLARED_READS.has('tabs::TabsSchema.onTabChange')).toBe(false);
    expect(KNOWN_UNDECLARED_READS.has('page:tabs::PageTabsBlockSchema.onTabChange')).toBe(false);

    // `detail` keeps its row. ⚠️ This leg deliberately asserts nothing about
    // which disposition it should get. ⛔ That decision is NOT objectui#9344's —
    // that card closed `completed` on 2026-09-13 with its item ② undone, and this
    // comment was one of the three places still routing a reader to it
    // (objectui#9456). The owner is objectui#7804, the card the ledger row
    // carries.
    expect(census('detail', 'onTabChange')?.declared).toBe(false);
    expect(KNOWN_UNDECLARED_READS.has('detail::DetailSchema.onTabChange')).toBe(true);

    // FIRING CONTROL for the `false` above: the `tabs` arm the alias used to be
    // judged against is still resolvable and still declares a DIFFERENT spelling
    // for what looks like the same event, so "no longer judged there" is a
    // reading about the KEYING and not an arm the resolver failed to read.
    const { arms } = collectArms(repoRoot);
    expect(arms.get('tabs')?.members.has('onValueChange')).toBe(true);
    expect(arms.get('tabs')?.members.has('onTabChange')).toBe(false);
  });

  /**
   * objectui#9573 on the real tree, in both directions the defect moved the
   * count.
   *
   * ⚠️ The floor matters more here than anywhere else in this file: a census
   * that collapsed would report an empty alias population and read as a clean
   * tree. So the registrations are NAMED, not counted.
   *
   * `page:tabs` was the sixth until objectui#10872 gave it its own arm, which
   * takes it out of this population by construction — an armed type is not an
   * alias. Where its read is judged now is pinned in the objectui#9344 leg above.
   * `action:button` and `action:icon` left the same way in objectui#10872 batch
   * 4; where their reads are judged now is pinned in the leg below.
   */
  it('keys the three namespaced-only aliases on what they claim, and scores their reads once', () => {
    const aliasRows = result.census.filter((c) => c.unmirroredAlias);
    expect(
      [...new Set(aliasRows.map((c) => c.type))].sort(),
      'the alias census is the objectui#9573 population — an empty one is a collapsed scan, not a clean tree',
    ).toEqual(['view:form', 'view:grid', 'view:list']);
    expect(result.counters.aliasReads).toBe(aliasRows.length);
    expect(aliasRows.length).toBeGreaterThan(10);

    // ⛔ None of the thirteen left by being DECLARED. Ten of them are the SAME
    // read sites, still judged — under the registration that claims a MIRRORED
    // key, where they are declared runtime slots. What left is a second, wrongly
    // addressed scoring of them.
    for (const row of ['list::ListSchema.onDensityChange', 'form::FormSchema.onSuccess', 'grid::GridSchema.onNavigate']) {
      expect(KNOWN_UNDECLARED_READS.has(row)).toBe(false);
    }
    const judgedAt = (type: string, key: string) => result.census.find((c) => c.type === type && c.key === key);
    expect(judgedAt('list-view', 'onDensityChange')?.disposition).toBe('runtime-slot');
    expect(judgedAt('object-form', 'onSuccess')?.disposition).toBe('runtime-slot');
    expect(judgedAt('object-grid', 'onNavigate')?.disposition).toBe('runtime-slot');

    // ⭐ The other half, which the ledger could never show because a passing read
    // leaves no row: `'form' FormSchema.onCancel` passed only because
    // `FormSchema` — the `ui:form` primitive's arm — mints its own `onCancel` for
    // its own destructure. It is gone from the census, and the SAME read is
    // still scored, once, where it lives.
    expect(judgedAt('form', 'onCancel')).toBeUndefined();
    expect(judgedAt('object-form', 'onCancel')?.disposition).toBe('runtime-slot');

    // Every registration in this repository resolves to literals, so nothing is
    // left unkeyed — and an unkeyed registration is what a broken resolver looks
    // like across the board.
    expect(result.unkeyable).toEqual([]);
  });

  /**
   * objectui#10872 batch 4 — `action:button` and `action:icon` got their own
   * arms (`ActionButtonBlockSchema`, `ActionIconBlockSchema`), so the four reads
   * this census used to report as UNMIRRORED-ALIAS rows are judged there now,
   * each a DECLARED member: `onClick` as an objectui#6124 runtime slot, and
   * `onSuccess` as the alias refusal naming `properties.onSuccess`, the row's
   * member. ⛔ Neither was waived into the ledger.
   */
  it('judges the `action:button` / `action:icon` handler reads on their own arms (objectui#10872 batch 4)', () => {
    const census = (type: string, key: string) => result.census.find((c) => c.type === type && c.key === key);
    for (const [type, schema] of [['action:button', 'ActionButtonBlockSchema'], ['action:icon', 'ActionIconBlockSchema']]) {
      for (const key of ['onClick', 'onSuccess']) {
        const row = census(type, key);
        expect(row, `${type}.${key} left the census`).toBeDefined();
        expect(row?.unmirroredAlias, `${type} is an armed type, not an alias`).toBeUndefined();
        expect(row?.schema).toBe(schema);
        expect(row?.declared, `${type}.${key}`).toBe(true);
        expect(KNOWN_UNDECLARED_READS.has(`${type}::${schema}.${key}`)).toBe(false);
      }
      expect(census(type, 'onClick')?.disposition).toBe('runtime-slot');
      // Un-vacuous from the arm side: the resolver READ both members off the arm.
      const members = collectArms(repoRoot).arms.get(type)?.members;
      expect(members?.get('onClick')).toBe('runtime-slot');
      expect(members?.has('onSuccess')).toBe(true);
    }
    // …and nothing re-keys them onto the bare `button` / `icon` arms, which are other components'.
    expect(census('button', 'onClick')).toBeUndefined();
    expect(census('icon', 'onSuccess')).toBeUndefined();
  });

  /**
   * The ledger is an EXEMPTION list, never the population, and it only shrinks.
   * Both directions are pinned: a row whose defect is gone reads as a live waiver
   * for nothing, and a row with no card is indistinguishable from switching the
   * gate off for that read site.
   */
  it('keeps every exemption honest — no stale row, and a card on each', () => {
    expect(
      result.stale,
      'a KNOWN_UNDECLARED_READS row names a read site this gate no longer finds — the defect it ' +
        'waives is fixed, so the row is a live waiver for nothing. Delete it.',
    ).toEqual([]);

    for (const [key, card] of KNOWN_UNDECLARED_READS) {
      expect(card, `KNOWN_UNDECLARED_READS[${key}] must name the card that owns the fix`).toMatch(/objectui#\d+/);
    }
  });

  it('is wired where the sibling parse-based gates run', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts['check:handler-key-reads']).toBe('node scripts/check-handler-key-read-sites.mjs');

    const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci, 'the gate must run in CI, next to the other source-parsing gates').toContain(
      'run: pnpm check:handler-key-reads',
    );

    // The page that inventories the gates is pinned by command (objectui#3653), so
    // this would fail there too — asserted here as well because a reader looking
    // for this gate looks at this file first.
    const page = fs.readFileSync(path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md'), 'utf8');
    expect(page).toContain('check:handler-key-reads');
  });

  it('derives its arms from the mirrors, including the one the card is about', () => {
    const { arms } = collectArms(repoRoot);

    // ⚠️ The worked example was the `'kanban'` arm (`complex.zod.ts`,
    // `KanbanSchema`) until objectui#8802 retired the bare node type key and the
    // arm with it. `object-kanban` is the surviving kanban face and is what the
    // gate now resolves the plugin's reads against.
    const objectKanban = arms.get('object-kanban');
    expect(objectKanban?.schema).toBe('ObjectKanbanSchema');
    expect(objectKanban?.file).toBe('objectql.zod.ts');
    expect(
      objectKanban?.unresolved,
      'the `object-kanban` arm must resolve completely, or its reads go unjudged',
    ).toEqual([]);
    // It declares real members — the anti-vacuity half, so "resolves completely"
    // is not satisfied by an empty arm.
    expect(objectKanban?.members.has('groupBy')).toBe(true);
    // ⭐ And the resolver reads its handler dispositions PER KEY, which is what
    // objectui#7804 measured this face on: two of the three keys the plugin
    // consumes are objectui#6124 RUNTIME SLOTS, and `onCardMove` is `'retired'`
    // — its authored value reaches neither channel. ⭐ `undefined` here until
    // objectui#9342: this gate refuses a tombstone while a renderer still reads
    // the key, so the arm could not carry one until that read moved to an
    // explicit React prop on `KanbanRendererProps`.
    //
    // ⭐ `onQuickAdd` reads `'retired'` since objectui#11234, once the
    // `object-kanban` path's read moved onto the internal board's explicit props.
    expect({
      onCardClick: objectKanban?.members.get('onCardClick'),
      onCardMove: objectKanban?.members.get('onCardMove'),
      onQuickAdd: objectKanban?.members.get('onQuickAdd'),
    }).toEqual({
      onCardClick: 'runtime-slot',
      onCardMove: 'retired',
      onQuickAdd: 'retired',
    });

    // A live arm that still carries both dispositions, so this leg keeps
    // proving the resolver can read them at all.
    const chatbot = arms.get('chatbot');
    expect(chatbot?.members.get('onSend')).toBe('runtime-slot');
    expect(chatbot?.members.get('onSendMessage')).toBe('retired');
  });
});
