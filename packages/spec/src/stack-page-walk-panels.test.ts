/**
 * `defineStack`'s page cross-reference checks judge a component wherever the
 * page carries it — a `page:tabs` or `page:accordion` item's `children`
 * included.
 *
 * Two checks read a page through one traversal (`forEachPageComponent`,
 * `stack.zod.ts`): the inline-action target check and the inline grid column
 * check. A tab or accordion item is a panel record (`{ label, value?,
 * children }`), not a component, so a walk that descends only arrays of
 * component-shaped entries stops at the item, and everything inside a tab or
 * an accordion panel went unjudged: a dangling inline modal target there built
 * green while the same button at region level was refused. The walk now
 * descends the panel positions the component rows declare
 * (`pageComponentSlotPositions`), the list every other page walk reads.
 *
 * Every refusal here is pinned against its REGION-LEVEL TWIN: the same
 * component built at `regions.0.components.0` gives the reference finding, and
 * the panel case must give exactly that finding with only its location changed.
 * So these pins hold the message to the region-level one rather than restating
 * it, and assert the envelope (`code`, `status`, the whole `issues` list), not
 * a bare throw.
 */
import { describe, expect, it } from 'vitest';
import { defineStack } from './stack.zod';
import { pageComponentSlotPositions } from './ui/component.zod';

const manifest = {
  id: 'com.example.pagewalkpanels',
  name: 'page-walk-panels-test',
  version: '1.0.0',
  type: 'app' as const,
};

const PARENT = { name: 'crm_invoice', label: 'Invoice', fields: { title: { type: 'text' as const } } };

const CHILD = {
  name: 'crm_invoice_line',
  label: 'Invoice Line',
  fields: {
    invoice: { type: 'master_detail' as const, reference: 'crm_invoice' },
    quantity: { type: 'number' as const },
    amount: { type: 'currency' as const },
  },
};

const PAGE = 'crm_invoice_record';
const REGION = 'regions.0.components.0';

// ---------------------------------------------------------------------------
// The judged components — one per check, each refused at region level.
// ---------------------------------------------------------------------------

const button = (target = 'no_such_modal_xyz') => ({
  type: 'element:button',
  properties: { label: 'Open', action: { name: 'open_detail', type: 'modal', target } },
});

const lineItems = (columns: unknown[] = [{ name: 'amount', scale: 2 }]) => ({
  type: 'record:line_items',
  properties: { childObject: 'crm_invoice_line', relationshipField: 'invoice', columns },
});

const masterDetail = (columns: unknown[] = [{ name: 'amount', scale: 2 }]) => ({
  type: 'object-master-detail-form',
  properties: { objectName: 'crm_invoice', details: [{ title: 'Lines', childObject: 'crm_invoice_line', columns }] },
});

const JUDGED = [
  ['an inline action with a dangling modal target', button],
  ['a `record:line_items` identity-only column carrying `scale` over a currency child field', lineItems],
  ['an `object-master-detail-form` identity-only column carrying `scale` over a currency child field', masterDetail],
] as const;

// ---------------------------------------------------------------------------
// Panels and pages.
// ---------------------------------------------------------------------------

/** A `page:tabs` node, one tab per child list. */
const tabs = (...panels: unknown[][]) => ({
  type: 'page:tabs',
  properties: { items: panels.map((children, i) => ({ label: `Tab ${i}`, value: `tab_${i}`, children })) },
});

/** A `page:accordion` node, one panel per child list. */
const accordion = (...panels: unknown[][]) => ({
  type: 'page:accordion',
  properties: { items: panels.map((children, i) => ({ label: `Panel ${i}`, children })) },
});

/** A stack whose one record page carries `components` in its main region. */
const stackWith = (components: unknown[]) => ({
  manifest,
  objects: [PARENT, CHILD],
  pages: [{
    name: PAGE,
    label: 'Invoice',
    type: 'record' as const,
    object: 'crm_invoice',
    regions: [{ name: 'main', components }],
  }],
});

/** The same page with `components` under a slot instead. */
const slottedStackWith = (components: unknown[]) => ({
  manifest,
  objects: [PARENT, CHILD],
  pages: [{
    name: PAGE,
    label: 'Invoice',
    type: 'record' as const,
    object: 'crm_invoice',
    kind: 'slotted',
    regions: [{ name: 'main', components: [] }],
    slots: { details: components },
  }],
});

type Refusal = { code?: string; status?: number; issues?: unknown[]; message: string };

const build = (stack: unknown) => defineStack(stack as Parameters<typeof defineStack>[0]);

/** Run `defineStack` and return the refusal it threw — fails the test when it accepted. */
function refusalOf(stack: unknown): Refusal {
  try {
    build(stack);
  } catch (error) {
    return error as Refusal;
  }
  throw new Error('expected defineStack to REFUSE this stack, and it accepted it');
}

/** The one finding `component` raises at region level — the reference every panel case is held to. */
function regionLevelFinding(component: unknown): string {
  const refusal = refusalOf(stackWith([component]));
  expect({ code: refusal.code, status: refusal.status }).toEqual({ code: 'STACK_CROSS_REFERENCE_INVALID', status: 422 });
  expect(refusal.issues).toHaveLength(1);
  const finding = String(refusal.issues![0]);
  expect(finding.split(`(${REGION})`), finding).toHaveLength(2);
  return finding;
}

/**
 * `stack` is refused with the envelope and the one finding `twin` raises at
 * region level, located at `path` instead.
 */
function expectRefusedLikeRegionLevel(stack: unknown, twin: unknown, path: string): void {
  const expected = regionLevelFinding(twin).replace(`(${REGION})`, `(${path})`);
  const refusal = refusalOf(stack);
  expect({ code: refusal.code, status: refusal.status, issues: refusal.issues }).toEqual({
    code: 'STACK_CROSS_REFERENCE_INVALID',
    status: 422,
    issues: [expected],
  });
}

describe('defineStack judges a component inside a tab or accordion panel as it judges one at region level', () => {
  it('refuses a dangling inline modal target under a `page:tabs` item, located through the panel', () => {
    const path = `${REGION}.properties.items.1.children.0`;
    expectRefusedLikeRegionLevel(stackWith([tabs([], [button()])]), button(), path);
    // The full finding, once, as an author reads it.
    expect(refusalOf(stackWith([tabs([], [button()])])).issues).toEqual([
      `Inline action 'open_detail' on page '${PAGE}' (${path}) `
      + "references page 'no_such_modal_xyz' (via modal target) which is not defined in pages.",
    ]);
  });

  it.each(JUDGED)('refuses %s under a `page:tabs` item', (_label, component) => {
    expectRefusedLikeRegionLevel(
      stackWith([tabs([], [component()])]),
      component(),
      `${REGION}.properties.items.1.children.0`,
    );
  });

  it.each(JUDGED)('refuses %s under a `page:accordion` item', (_label, component) => {
    expectRefusedLikeRegionLevel(
      stackWith([accordion([component()])]),
      component(),
      `${REGION}.properties.items.0.children.0`,
    );
  });

  it.each(JUDGED)('refuses %s in tabs nested in an accordion panel', (_label, component) => {
    expectRefusedLikeRegionLevel(
      stackWith([accordion([tabs([], [component()])])]),
      component(),
      `${REGION}.properties.items.0.children.0.properties.items.1.children.0`,
    );
  });

  it('refuses it in a panel inside a container, and in a panel under a slot — the panel rule composes with every root and nesting', () => {
    expectRefusedLikeRegionLevel(
      stackWith([{ type: 'page:card', properties: { children: [tabs([button()])] } }]),
      button(),
      `${REGION}.properties.children.0.properties.items.0.children.0`,
    );
    const refusal = refusalOf(slottedStackWith([accordion([lineItems()])]));
    expect({ code: refusal.code, status: refusal.status, issues: refusal.issues }).toEqual({
      code: 'STACK_CROSS_REFERENCE_INVALID',
      status: 422,
      issues: [regionLevelFinding(lineItems()).replace(`(${REGION})`, '(slots.details.0.properties.items.0.children.0)')],
    });
  });

  it('reports each panel\'s finding at its own location, in document order', () => {
    const refusal = refusalOf(stackWith([tabs([button('no_such_a')], [], [button('no_such_b')])]));
    expect(refusal.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refusal.issues).toEqual([
      regionLevelFinding(button('no_such_a')).replace(`(${REGION})`, `(${REGION}.properties.items.0.children.0)`),
      regionLevelFinding(button('no_such_b')).replace(`(${REGION})`, `(${REGION}.properties.items.2.children.0)`),
    ]);
  });

  it('following the remedy builds: a declared modal target, and the column with `scale` deleted', () => {
    expect(() => build(stackWith([tabs([button(PAGE)], [lineItems([{ name: 'amount' }])])]))).not.toThrow();
    expect(() => build(stackWith([accordion([masterDetail([{ name: 'amount' }, { name: 'quantity', scale: 1 }])])]))).not.toThrow();
  });
});

describe('the walk descends the declared panel positions, and only those', () => {
  const panelPositions = pageComponentSlotPositions().filter((position) => position.panelKey !== undefined && !position.retired);

  it('descends every authorable panel position the component rows declare, on any component carrying that shape', () => {
    // Read off the one list, so a panel position a row declares later is
    // covered here without this file naming it. Non-empty, or the loop below
    // proves nothing.
    expect(panelPositions.length).toBeGreaterThan(0);
    for (const { key, panelKey } of panelPositions) {
      // A type no row declares: positions are matched by shape, as every
      // page walk matches them, because custom types compose the same vocabulary.
      const node = { type: 'acme:panels', properties: { [key]: [{ [panelKey as string]: [button()] }] } };
      expectRefusedLikeRegionLevel(stackWith([node]), button(), `${REGION}.properties.${key}.0.${panelKey}.0`);
    }
  });

  it('CONTROL — a panel record is not itself a component: its own keys are not judged, and a child list holding no component visits nothing', () => {
    const items = [
      { label: 'Looks like a node', properties: { action: { type: 'modal', target: 'no_such_modal_xyz' } }, children: [] },
      { label: 'No children' },
      { label: 'Not components', children: ['bare_component_id', null, 42, [button()]] },
    ];
    expect(() => build(stackWith([{ type: 'page:tabs', properties: { items } }]))).not.toThrow();
  });

  it('CONTROL — a record under a key no row declares a panel list is not walked, even one carrying a `type` key and a list of components', () => {
    // A detail entry with a `type` key looks component-shaped, and its
    // `children` holds a real dangling button; `details` is a non-container
    // prop, so the renderer draws nothing from that list.
    const detail = { title: 'Lines', childObject: 'crm_invoice_line', type: 'grid', children: [button()] };
    const nonContainer = { type: 'object-master-detail-form', properties: { objectName: 'crm_invoice', details: [detail] } };
    // A panel-shaped list under an undeclared key, and an undeclared key inside a declared panel.
    const undeclaredList = { type: 'page:tabs', properties: { panels: [{ label: 'A', children: [button()] }] } };
    const undeclaredPanelKey = { type: 'page:tabs', properties: { items: [{ label: 'A', content: [button()] }] } };
    for (const component of [nonContainer, undeclaredList, undeclaredPanelKey]) {
      expect(() => build(stackWith([component])), JSON.stringify(component)).not.toThrow();
    }
    // …while the same button in the declared position is refused, so the
    // controls above are not passing on a broken fixture.
    expect(refusalOf(stackWith([tabs([button()])])).code).toBe('STACK_CROSS_REFERENCE_INVALID');
  });
});
