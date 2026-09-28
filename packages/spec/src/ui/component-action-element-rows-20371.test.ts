// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20371 — six `ComponentPropsMap` rows for the curated objectui public blocks
// that had none: `action:button`, `action:group`, `action:menu`, `action:icon`,
// `element:definition-list`, `element:repeater`.
//
// Before these rows the four `action:*` types were skipped by the props gate
// (outside every namespace the enum populates) and the two `element:*` lists
// were refused as `component-type-unknown` (inside the reserved `element:`
// namespace with neither an enum member nor a row). Each row is strict from
// birth, with its key set measured from the renderer's read points at the
// `.objectui-sha` pin — the per-key citations live in `component.zod.ts`,
// section 4b. The key sets are asserted WHOLE, as #18305's were: a row derived
// from read points is a claim about a complete set, and only an equality holds
// a later addition to having been measured too.

import { describe, expect, it } from 'vitest';
import {
  ActionButtonPropsSchema,
  ActionGroupPropsSchema,
  ActionIconPropsSchema,
  ActionMenuPropsSchema,
  ComponentPropsMap,
  ElementDefinitionListPropsSchema,
  ElementRepeaterPropsSchema,
} from './component.zod';
import {
  KNOWN_COMPONENT_TYPE_CANDIDATES,
  STRING_ARM_REGISTERED_TYPES,
  hasReservedComponentNamespace,
  isKnownComponentType,
} from './component-type-vocabulary';
import { PageComponentSchema, PageComponentType } from './page.zod';

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };

/** The issues of a failed safeParse — fails the test when the parse succeeded. */
const issuesOf = (result: { success: boolean; error?: { issues: unknown[] } }): Issue[] => {
  expect(result.success).toBe(false);
  return result.error!.issues as Issue[];
};

/** The one `unrecognized_keys` issue at the bag's root. */
const unknownKeyIssue = (result: { success: boolean; error?: { issues: unknown[] } }): Issue => {
  const at = issuesOf(result).filter((i) => i.code === 'unrecognized_keys' && i.path.length === 0);
  expect(at).toHaveLength(1);
  return at[0]!;
};

/** Top-level declared keys of a (lazy) strict object schema. */
const keysOf = (schema: unknown): string[] =>
  Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();

const ROWS = {
  'action:button': ActionButtonPropsSchema,
  'action:group': ActionGroupPropsSchema,
  'action:menu': ActionMenuPropsSchema,
  'action:icon': ActionIconPropsSchema,
  'element:definition-list': ElementDefinitionListPropsSchema,
  'element:repeater': ElementRepeaterPropsSchema,
} as const;

describe('the six rows exist and are the exported schemas (#20371)', () => {
  it.each(Object.entries(ROWS))('`%s` dispatches to its exported schema', (type, schema) => {
    expect(Object.keys(ComponentPropsMap)).toContain(type);
    expect((ComponentPropsMap as Record<string, unknown>)[type]).toBe(schema);
  });

  it('the page node still parses all six through the open `type` arm — the rows add no parse change there', () => {
    for (const type of Object.keys(ROWS)) {
      const node = PageComponentSchema.safeParse({ type, properties: { anything: 1 } });
      // The carrier stays an open bag: the rows are judged at the authoring
      // door (the props gate), not by `PageComponentSchema.parse`.
      expect(node.success, type).toBe(true);
    }
  });
});

describe('key sets, asserted whole — measured from the renderers\' read points', () => {
  // Forwarded to the action runner by `action:button` / `action:icon`
  // (`execute({ ...forwarded })`). `undoable` / `recordIdField` are forwarded
  // by the button only. `objectName` joined the forward with the pin that
  // carries it; the four renderers forward it, the two containers per member.
  const FORWARDED = [
    'params', 'description', 'target', 'openIn', 'endpoint', 'method', 'bodyExtra', 'bodyShape',
    'operation', 'patch', 'confirmText', 'successMessage', 'errorMessage', 'refreshAfter',
    'locations', 'toast', 'resultDialog', 'onSuccess', 'objectName',
  ];

  it('action:button', () => {
    expect(keysOf(ActionButtonPropsSchema)).toEqual([
      'name', 'label', 'icon', 'actionType', 'variant', 'size', 'visible', 'disabled',
      ...FORWARDED, 'undoable', 'recordIdField',
    ].sort());
  });

  it('action:icon — no `size` (fixed icon size), no `undoable` / `recordIdField` (not forwarded)', () => {
    expect(keysOf(ActionIconPropsSchema)).toEqual([
      'name', 'label', 'icon', 'actionType', 'variant', 'visible', 'disabled', ...FORWARDED,
    ].sort());
  });

  it('action:group — no group-level `name` (never read)', () => {
    expect(keysOf(ActionGroupPropsSchema)).toEqual(
      ['actions', 'display', 'location', 'label', 'icon', 'variant', 'size', 'visible'].sort(),
    );
  });

  it('action:menu', () => {
    expect(keysOf(ActionMenuPropsSchema)).toEqual(
      ['actions', 'label', 'icon', 'variant', 'size', 'visible'].sort(),
    );
  });

  it('element:definition-list', () => {
    expect(keysOf(ElementDefinitionListPropsSchema)).toEqual(['items', 'columns', 'inline'].sort());
  });

  it('element:repeater', () => {
    expect(keysOf(ElementRepeaterPropsSchema)).toEqual(
      ['object', 'titleField', 'fields', 'filter', 'sort', 'limit', 'emptyText', 'divided'].sort(),
    );
  });

  it('no row declares a node key (`className` / `style` / `id` stay on the node)', () => {
    for (const [type, schema] of Object.entries(ROWS)) {
      for (const nodeKey of ['className', 'style', 'id', 'dataSource', 'responsiveStyles']) {
        expect(keysOf(schema), `${type}.${nodeKey}`).not.toContain(nodeKey);
      }
    }
  });
});

describe('one accepted authored example per type, taken from objectui', () => {
  it('action:button — the node objectui\'s AGENTS.md teaches', () => {
    const authored = { label: 'Open details', actionType: 'url', target: '/users/ada' };
    expect(ActionButtonPropsSchema.parse(authored)).toEqual(authored);
  });

  it('action:icon — the registration\'s own defaults', () => {
    const authored = { icon: 'play', actionType: 'script', variant: 'ghost' as const };
    expect(ActionIconPropsSchema.parse(authored)).toEqual(authored);
  });

  it('action:group — the registration\'s defaults with one member action', () => {
    const authored = {
      display: 'inline' as const,
      variant: 'outline' as const,
      size: 'sm' as const,
      actions: [{ name: 'approve', label: 'Approve', type: 'api', target: '/api/approve' }],
    };
    expect(ActionGroupPropsSchema.parse(authored)).toEqual(authored);
  });

  it('action:menu — the registration\'s defaults with one member action', () => {
    const authored = {
      variant: 'ghost' as const,
      actions: [{ name: 'archive', label: 'Archive', type: 'script', tags: ['separator-before'] }],
    };
    expect(ActionMenuPropsSchema.parse(authored)).toEqual(authored);
  });

  it('element:definition-list — objectui\'s own renderer specimen', () => {
    const authored = {
      items: [
        { term: 'Status', description: 'Active' },
        { term: 'Owner', description: 'Ada' },
      ],
    };
    expect(ElementDefinitionListPropsSchema.parse(authored)).toEqual(authored);
  });

  it('element:repeater — objectui\'s own renderer specimen', () => {
    const authored = { object: 'showcase_category', fields: ['name'], emptyText: 'Nothing here' };
    expect(ElementRepeaterPropsSchema.parse(authored)).toEqual(authored);
  });
});

describe('strict from birth — an unknown key is refused on every row', () => {
  it.each(Object.entries(ROWS))('`%s` refuses an undeclared key, naming its surface', (type, schema) => {
    const base = type === 'element:repeater' ? { object: 'task' } : {};
    const issue = unknownKeyIssue(schema.safeParse({ ...base, notARealProp: 1 }));
    expect(issue.keys).toEqual(['notARealProp']);
    expect(issue.message).toContain(`\`${type}\``);
  });

  it('a node key written into the bag gets the wrong-layer prescription, not a bare refusal', () => {
    const issue = unknownKeyIssue(ActionButtonPropsSchema.safeParse({ label: 'X', className: 'mt-2' }));
    expect(issue.keys).toEqual(['className']);
    expect(issue.message).toContain('NODE');
  });
});

describe('what the measurement decided, pinned', () => {
  it('`name` is OPTIONAL on action:button — the renderer reads `schema.name ?? schema.label`', () => {
    expect(ActionButtonPropsSchema.safeParse({ label: 'Save', actionType: 'script' }).success).toBe(true);
  });

  it('`type` is refused on action:button / action:icon and renamed to `actionType`', () => {
    for (const schema of [ActionButtonPropsSchema, ActionIconPropsSchema]) {
      const issue = unknownKeyIssue(schema.safeParse({ label: 'X', type: 'url' }));
      expect(issue.keys).toEqual(['type']);
      expect(issue.message).toContain('`actionType`');
    }
  });

  it('`enabled` and `autoTrigger` are read-but-not-authorable on action:button / action:icon', () => {
    for (const schema of [ActionButtonPropsSchema, ActionIconPropsSchema]) {
      for (const key of ['enabled', 'autoTrigger']) {
        const issue = unknownKeyIssue(schema.safeParse({ label: 'X', [key]: true }));
        expect(issue.keys).toEqual([key]);
      }
    }
  });

  it('action:icon refuses `size` — the renderer pins the icon size', () => {
    expect(unknownKeyIssue(ActionIconPropsSchema.safeParse({ size: 'sm' })).keys).toEqual(['size']);
    // Firing control: the button sibling reads `size`.
    expect(ActionButtonPropsSchema.safeParse({ size: 'sm' }).success).toBe(true);
  });

  it('action:group refuses a group-level `name`, which the registration publishes and nothing reads', () => {
    expect(unknownKeyIssue(ActionGroupPropsSchema.safeParse({ name: 'toolbar' })).keys).toEqual(['name']);
  });

  it('`variant` / `size`: `primary` and `md` only where the renderer maps them', () => {
    // action:button maps both; action:icon maps `primary` (no `size` at all).
    expect(ActionButtonPropsSchema.safeParse({ variant: 'primary', size: 'md' }).success).toBe(true);
    expect(ActionIconPropsSchema.safeParse({ variant: 'primary' }).success).toBe(true);
    // action:menu hands both to the Button primitive unmapped; action:group
    // maps `md` on its dropdown trigger only, not in its default inline mode.
    for (const schema of [ActionMenuPropsSchema, ActionGroupPropsSchema]) {
      const variant = issuesOf(schema.safeParse({ variant: 'primary' }));
      expect(variant.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_value', 'variant']]);
      const size = issuesOf(schema.safeParse({ size: 'md' }));
      expect(size.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_value', 'size']]);
    }
  });

  it('`actions` is a LIST of action objects — a bare action-name list is refused', () => {
    for (const schema of [ActionGroupPropsSchema, ActionMenuPropsSchema]) {
      const issues = issuesOf(schema.safeParse({ actions: ['approve'] }));
      expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_type', 'actions.0']]);
      // The object form, and the record shape the registration publishes, is
      // not a list either.
      expect(schema.safeParse({ actions: { approve: {} } }).success).toBe(false);
    }
  });

  it('a bare CEL `visible` normalizes to the canonical envelope; a boolean stays a literal', () => {
    const parsed = ActionMenuPropsSchema.parse({ visible: "record.status == 'open'" });
    expect(parsed.visible).toEqual({ dialect: 'cel', source: "record.status == 'open'" });
    expect(ActionButtonPropsSchema.parse({ visible: false, disabled: true })).toEqual({ visible: false, disabled: true });
  });

  it('definition-list `columns` is the NUMBER 1 or 2 — the registration\'s string spelling is refused', () => {
    expect(ElementDefinitionListPropsSchema.safeParse({ columns: 2 }).success).toBe(true);
    const issues = issuesOf(ElementDefinitionListPropsSchema.safeParse({ columns: '2' }));
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_value', 'columns']]);
    expect(issues[0]!.message).toContain('`columns: 2`');
    expect(ElementDefinitionListPropsSchema.safeParse({ columns: 3 }).success).toBe(false);
  });

  it('definition-list items are strict — the designer\'s old `label` / `value` pair is refused and renamed', () => {
    const issues = issuesOf(ElementDefinitionListPropsSchema.safeParse({ items: [{ label: 'A', value: 1 }] }));
    const keyIssue = issues.find((i) => i.code === 'unrecognized_keys');
    expect(keyIssue?.path).toEqual(['items', 0]);
    expect(keyIssue?.keys).toEqual(['label', 'value']);
    expect(keyIssue?.message).toContain('`term`');
    expect(keyIssue?.message).toContain('`description`');
    // `term` is required on an item; `items` itself is optional (the renderer
    // shows its "No details" state for absent and empty alike).
    expect(issues.some((i) => i.code === 'invalid_type' && i.path.join('.') === 'items.0.term')).toBe(true);
    expect(ElementDefinitionListPropsSchema.safeParse({}).success).toBe(true);
  });

  it('repeater `object` is required — without it the list never queries', () => {
    const issues = issuesOf(ElementRepeaterPropsSchema.safeParse({ fields: ['name'] }));
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_type', 'object']]);
  });

  it('repeater `fields` takes a name or `{ field }`; the unrendered `label` is refused inside the union', () => {
    expect(ElementRepeaterPropsSchema.safeParse({ object: 't', fields: ['a', { field: 'b' }] }).success).toBe(true);
    const [union] = issuesOf(ElementRepeaterPropsSchema.safeParse({ object: 't', fields: [{ field: 'b', label: 'B' }] }));
    expect(union!.code).toBe('invalid_union');
    expect(union!.path).toEqual(['fields', 0]);
    // Exactly one arm judged keys, and only keys — the shape the props gate
    // unpacks back onto its unknown-key rule.
    const keyArms = union!.errors!.filter((arm) => arm.some((i) => i.code === 'unrecognized_keys'));
    expect(keyArms).toHaveLength(1);
    expect(keyArms[0]!.map((i) => i.keys)).toEqual([['label']]);
  });

  it('repeater `filter` / `sort` are the family\'s one orthography — the record form is refused', () => {
    const ok = ElementRepeaterPropsSchema.safeParse({
      object: 'task',
      filter: [{ field: 'status', operator: 'equals', value: 'open' }],
      sort: [{ field: 'due_date', order: 'asc' }],
      limit: 10,
    });
    expect(ok.success).toBe(true);
    const record = issuesOf(ElementRepeaterPropsSchema.safeParse({ object: 'task', filter: { status: 'open' } }));
    expect(record.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_type', 'filter']]);
    const limit = issuesOf(ElementRepeaterPropsSchema.safeParse({ object: 'task', limit: 0 }));
    expect(limit.map((i) => [i.code, i.path.join('.')])).toEqual([['too_small', 'limit']]);
  });

  it('`objectName` is declared where the renderer forwards it — on the action, never on a container', () => {
    for (const schema of [ActionButtonPropsSchema, ActionIconPropsSchema]) {
      expect(schema.parse({ label: 'Close child', objectName: 'task' })).toEqual({ label: 'Close child', objectName: 'task' });
    }
    // `action:group` / `action:menu` forward each MEMBER's `objectName`: it
    // rides the member object, which this row does not judge ...
    for (const schema of [ActionGroupPropsSchema, ActionMenuPropsSchema]) {
      const member = { name: 'close', label: 'Close', type: 'script', objectName: 'task' };
      expect(schema.safeParse({ actions: [member] }).success).toBe(true);
      // ... and a container-level one is read by nothing.
      expect(unknownKeyIssue(schema.safeParse({ objectName: 'task' })).keys).toEqual(['objectName']);
    }
  });

  it('repeater: the `object-*` family\'s `objectName` is refused and renamed to `object`', () => {
    const issue = unknownKeyIssue(ElementRepeaterPropsSchema.safeParse({ object: 'task', objectName: 'task' }));
    expect(issue.keys).toEqual(['objectName']);
    expect(issue.message).toContain('`object`');
  });
});

describe('the `element:` vocabulary admits the two lists through their rows', () => {
  it('both are reserved-namespace AND known — `component-type-unknown` no longer refuses them', () => {
    for (const type of ['element:definition-list', 'element:repeater']) {
      expect(hasReservedComponentNamespace(type), type).toBe(true);
      expect(isKnownComponentType(type), type).toBe(true);
      expect(KNOWN_COMPONENT_TYPE_CANDIDATES, type).toContain(type);
    }
    // Firing control: a typo inside the same namespace is still unknown, so
    // the claim did not open the namespace — it named two members of it.
    expect(isKnownComponentType('element:repeatr')).toBe(false);
    expect(hasReservedComponentNamespace('element:repeatr')).toBe(true);
  });

  it('they join by ROW, not by enum member or string-arm ledger entry (the `element:metadata_viewer` shape)', () => {
    for (const type of ['element:definition-list', 'element:repeater']) {
      expect(PageComponentType.options as readonly string[]).not.toContain(type);
      expect(STRING_ARM_REGISTERED_TYPES).not.toContain(type);
    }
  });

  it('the four `action:*` types stay outside every reserved namespace — the rows add no vocabulary claim', () => {
    for (const type of ['action:button', 'action:group', 'action:menu', 'action:icon']) {
      expect(hasReservedComponentNamespace(type), type).toBe(false);
      expect(isKnownComponentType(type), type).toBe(true);
    }
  });
});
