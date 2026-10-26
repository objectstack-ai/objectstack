/**
 * Containment is decided by the declared `children` input, and by NOTHING
 * else — the save-gate port (#19969) of objectui#9910 Q1-A.
 *
 * The renderer's copy of this parser (objectui `packages/sdui-parser`, re-cut
 * `5ea623ea`, inside the console pin) moved `not-a-container` off the
 * `isContainer` flag onto the registration's declared `children` input. This
 * copy runs in the SAVE GATE; if it kept reading the flag, the two would give
 * opposite verdicts on the same page (#12719). The 2×2 (flag × slot) below is
 * the same reading objectui pins in its own
 * `containment-declared-slot-9910.test.ts`, because the two failure modes are
 * OPPOSITE: a flag-only cell drawing nothing is the fallback silently
 * re-introduced, and a slot-only cell drawing the warning is the defect.
 * Since #25712 one copy serves both, and the last block carries the cases the
 * renderer's file pinned beyond the 2×2.
 *
 * The second half uses the REAL served entries: in the tracked
 * `sdui.manifest.json` (regenerated at the console pin, `0bf85eaa`) exactly
 * five of 59 components disagree between the flag and the declared input.
 * They are copied verbatim below rather than read from the repo root, so this
 * package's tests keep reading only this package.
 */
import { describe, expect, it } from 'vitest';
import { CHILD_LIST_KEY, acceptsChildren, manifestFromConfigs, validateTree } from '../index.js';
import type { Diagnostic, Manifest, ManifestComponent, SchemaElement } from '../types.js';

const CONTAINMENT = 'not-a-container';
const SLOT = { name: 'children', type: 'slot' } as const;

const containment = (node: SchemaElement, manifest: Manifest): string[] =>
  validateTree(node, manifest)
    .diagnostics.map((d) => d.code)
    .filter((code) => code === CONTAINMENT);

/** A child list of one string node: strings are never validated, so the only
 *  diagnostic this can draw is the containment one on its parent. */
const withChildren = (type: string): SchemaElement => ({ type, children: ['measured'] });

describe('#19969 — the save gate reads the declared `children` input, not the flag (2×2)', () => {
  const manifest: Manifest = manifestFromConfigs([
    // flag, no slot — the `page:tabs` shape
    { type: 'flag-only', namespace: 'ui', isContainer: true, inputs: [{ name: 'items', type: 'array' }] },
    // slot, no flag — the `button` / `badge` shape
    { type: 'slot-only', namespace: 'ui', inputs: [{ name: 'label', type: 'string' }, SLOT] },
    // both — the `flex` shape
    { type: 'both', namespace: 'ui', isContainer: true, inputs: [{ name: 'gap', type: 'number' }, SLOT] },
    // neither — a leaf
    { type: 'neither', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
    // the page kinds publish `children` typed `array`: the NAME is the declaration
    { type: 'array-typed', namespace: 'ui', inputs: [{ name: 'children', type: 'array', of: 'object' }] },
  ]);

  it('the predicate reads exactly the input NAMED `children`, whatever its coarse type', () => {
    expect(CHILD_LIST_KEY).toBe('children');
    expect(acceptsChildren({ inputs: [SLOT] })).toBe(true);
    expect(acceptsChildren({ inputs: [{ name: 'children', type: 'array' }] })).toBe(true);
    expect(acceptsChildren({ inputs: [{ name: 'body', type: 'slot' }] })).toBe(false);
    expect(acceptsChildren({ inputs: [] })).toBe(false);
  });

  it('⛔ the flag is NOT a fallback: flag without slot draws `not-a-container`', () => {
    expect(containment(withChildren('flag-only'), manifest)).toEqual([CONTAINMENT]);
  });

  it('the slot alone is sufficient: slot without flag draws nothing', () => {
    expect(containment(withChildren('slot-only'), manifest)).toEqual([]);
  });

  it('both declared draws nothing; neither declared draws the warning, at warning severity', () => {
    expect(containment(withChildren('both'), manifest)).toEqual([]);
    const found = validateTree(withChildren('neither'), manifest).diagnostics.filter(
      (d) => d.code === CONTAINMENT,
    );
    expect(found.map((d) => [d.code, d.severity, d.tag])).toEqual([[CONTAINMENT, 'warning', 'neither']]);
  });

  it('an `array`-typed `children` input counts — the page kinds', () => {
    expect(containment(withChildren('array-typed'), manifest)).toEqual([]);
  });

  it('no child list, no verdict: an empty or absent list draws nothing anywhere', () => {
    for (const type of ['flag-only', 'slot-only', 'both', 'neither', 'array-typed']) {
      expect(containment({ type }, manifest)).toEqual([]);
      expect(containment({ type, children: [] }, manifest)).toEqual([]);
    }
  });

  it('a component the manifest does not know draws `unknown-component`, never a containment verdict', () => {
    const codes = validateTree(withChildren('nowhere'), manifest).diagnostics.map((d) => d.code);
    expect(codes).toEqual(['unknown-component']);
  });
});

describe('#19969 — the five served entries where the flag and the declared input disagree', () => {
  // Verbatim from the tracked `sdui.manifest.json` at `0bf85eaa`.
  const SERVED: Record<string, ManifestComponent> = {
    "badge": {
      "type": "badge",
      "namespace": "ui",
      "inputs": [
        {
          "name": "label",
          "type": "string"
        },
        {
          "name": "variant",
          "type": "enum",
          "enum": [
            "default",
            "secondary",
            "destructive",
            "outline"
          ]
        },
        {
          "name": "className",
          "type": "string"
        },
        {
          "name": "children",
          "type": "slot",
          "description": "Rich label content, rendered when `label` is not set"
        }
      ]
    },
    "alert": {
      "type": "alert",
      "namespace": "ui",
      "inputs": [
        {
          "name": "title",
          "type": "string",
          "required": true
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "variant",
          "type": "enum",
          "enum": [
            "default",
            "destructive"
          ]
        },
        {
          "name": "className",
          "type": "string"
        },
        {
          "name": "children",
          "type": "slot",
          "description": "Rich description content, rendered when `description` is not set"
        }
      ]
    },
    "button": {
      "type": "button",
      "namespace": "ui",
      "inputs": [
        {
          "name": "label",
          "type": "string"
        },
        {
          "name": "variant",
          "type": "enum",
          "enum": [
            "default",
            "secondary",
            "destructive",
            "outline",
            "ghost",
            "link"
          ]
        },
        {
          "name": "size",
          "type": "enum",
          "enum": [
            "default",
            "sm",
            "lg",
            "icon"
          ]
        },
        {
          "name": "className",
          "type": "string"
        },
        {
          "name": "children",
          "type": "slot",
          "description": "Rich label content, rendered when `label` is not set"
        }
      ]
    },
    "page:tabs": {
      "type": "page:tabs",
      "namespace": "page",
      "isContainer": true,
      "inputs": [
        {
          "name": "items",
          "type": "array",
          "of": "object",
          "required": true,
          "description": "Tab definitions [{ label, value?, icon?, count?, visibleWhen?, children }] — value is the stable ?tab= URL token, count auto-derives from record:related_list descendants when omitted"
        },
        {
          "name": "tabStyle",
          "type": "enum",
          "enum": [
            "line",
            "card",
            "pill"
          ]
        },
        {
          "name": "position",
          "type": "enum",
          "enum": [
            "top",
            "left"
          ]
        },
        {
          "name": "alwaysShowStrip",
          "type": "boolean",
          "description": "Keep the tab strip visible when only one tab survives. Default false: a lone pill is clutter rather than an affordance, so a one-tab strip is hidden and its panel renders bare. Count the tabs AFTER each item visibleWhen predicate has been evaluated — a page authored with four tabs of which three are conditional reaches this rule whenever the other three are false."
        }
      ]
    },
    "page:accordion": {
      "type": "page:accordion",
      "namespace": "page",
      "isContainer": true,
      "inputs": [
        {
          "name": "items",
          "type": "array",
          "of": "object",
          "required": true,
          "description": "Panel definitions [{ label, icon?, collapsed?, children }] — collapsed: false opens a panel by default"
        },
        {
          "name": "allowMultiple",
          "type": "boolean"
        },
        {
          "name": "variant",
          "type": "enum",
          "enum": [
            "flush",
            "card"
          ]
        }
      ]
    }
  } as unknown as Record<string, ManifestComponent>;
  const manifest: Manifest = { components: SERVED };

  it('control: each entry really does disagree — the flag and the declared input answer differently', () => {
    // If a regenerated manifest ever made these agree, the rows below would stop
    // distinguishing the two predicates and this file would pass under either.
    for (const [type, comp] of Object.entries(SERVED)) {
      expect({ type, flag: Boolean(comp.isContainer) }).not.toEqual({ type, flag: acceptsChildren(comp) });
    }
  });

  it.each(['badge', 'alert', 'button'])(
    '<%s> declares the slot with the flag off: its child list draws NO `not-a-container` (was a false warning)',
    (type) => {
      expect(SERVED[type]!.isContainer).toBeFalsy();
      expect(containment(withChildren(type), manifest)).toEqual([]);
    },
  );

  it.each(['page:tabs', 'page:accordion'])(
    '<%s> carries the flag with no slot: its child list DRAWS `not-a-container` (was silenced by the flag)',
    (type) => {
      expect(SERVED[type]!.isContainer).toBe(true);
      expect(containment(withChildren(type), manifest)).toEqual([CONTAINMENT]);
    },
  );
});

describe('objectui#9910 — the base key, the retired spelling, and the layout flag', () => {
  // The renderer's copy pinned these beside its 2×2, over a manifest whose rows
  // nest a declared `text` child so nothing draws `unknown-component`.
  const manifest: Manifest = manifestFromConfigs([
    // flag, no slot — a layout container that renders `items[].children`, never
    // `schema.children` (the `page:tabs` shape)
    { type: 'flag-only', namespace: 'ui', isContainer: true, inputs: [{ name: 'items', type: 'array' }] },
    // slot, no flag — a label-fallback reader (the `button` / `badge` shape)
    { type: 'slot-only', namespace: 'ui', inputs: [{ name: 'label', type: 'string' }, SLOT] },
    // both — a layout container that renders the list (the `flex` shape)
    { type: 'both', namespace: 'ui', isContainer: true, inputs: [{ name: 'gap', type: 'number' }, SLOT] },
    // neither — a leaf
    { type: 'neither', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
    // the page kinds publish `children` typed `array`, not `slot` — the NAME is
    // the declaration, so this row must read as accepting children too
    { type: 'array-typed', namespace: 'ui', inputs: [{ name: 'children', type: 'array', of: 'object' }] },
    // the child every row nests, declared so it never draws `unknown-component`
    { type: 'text', namespace: 'ui', inputs: [{ name: 'content', type: 'string' }] },
  ] as unknown as Parameters<typeof manifestFromConfigs>[0]);

  const CHILD = { type: 'text', content: 'measured' };
  const codes = (node: unknown): string[] =>
    validateTree(node as SchemaElement, manifest).diagnostics.map((d: Diagnostic) => d.code);
  const withChildren = (type: string) => ({ type, children: [CHILD] });

  it('a declared `children` slot is never type-checked or reported as a prop — the key is base', () => {
    // `children` is in `BASE_PROPS`, so the prop walk skips it before the
    // declared input is ever consulted: no `unknown-prop`, no `type-mismatch`,
    // whichever coarse type the declaration carries.
    for (const type of ['slot-only', 'both', 'array-typed', 'flag-only', 'neither']) {
      const found = codes(withChildren(type));
      expect(found.filter((c) => c === 'unknown-prop' || c === 'type-mismatch')).toEqual([]);
    }
    // …and the reachability control: the nested child resolved everywhere.
    for (const type of ['slot-only', 'both', 'array-typed', 'flag-only', 'neither']) {
      expect(codes(withChildren(type))).not.toContain('unknown-component');
    }
  });

  it('the retired `body` spelling follows the SAME predicate', () => {
    // `checkRetiredBodyDialect` is handed `acceptsChildren(comp)`, so the two
    // spellings cannot disagree about which components take a list.
    const under = (type: string) =>
      validateTree({ type, body: [CHILD] } as unknown as SchemaElement, manifest).diagnostics.filter((d) =>
        d.message.includes('"body"'),
      );
    // slot declared ⇒ the list would be accepted under `children`, so `body`
    // is answered as a retired key that names the replacement
    expect(under('slot-only').map((d) => d.code)).toEqual(['unknown-prop']);
    expect(under('slot-only')[0]!.message).toContain('"children"');
    // flag only ⇒ no list is accepted here, so `body` draws the containment
    // sentence — the flag does not rescue the retired spelling either
    expect(under('flag-only').map((d) => d.code)).toEqual([CONTAINMENT]);
    expect(under('neither').map((d) => d.code)).toEqual([CONTAINMENT]);
  });

  it('the manifest still CARRIES `isContainer` for the consumers that read layout containment', () => {
    // Q2-A keeps the field: `manifestFromConfigs` projects it unchanged, the
    // react-page scope builder and the public layout ledger read it, and this
    // tier ignores it. Asserted so a later "clean-up" that drops the projection
    // is a visible decision rather than a side effect.
    expect(manifest.components['flag-only']!.isContainer).toBe(true);
    expect(manifest.components['both']!.isContainer).toBe(true);
    expect(manifest.components['slot-only']!.isContainer).toBeUndefined();
  });
});
