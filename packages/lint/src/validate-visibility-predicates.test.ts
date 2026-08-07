// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateVisibilityPredicates,
  VISIBILITY_ALIAS_DEPRECATED,
  VISIBILITY_ROOT_MISLAYERED,
  VISIBILITY_BARE_IDENTIFIER,
} from './validate-visibility-predicates';
import { AUTHORING_RULES } from './authoring-rules.js';

describe('validateVisibilityPredicates (ADR-0089 D3b)', () => {
  it('is clean for canonical `visibleWhen` with a runtime binding root', () => {
    const stack = {
      views: [
        {
          name: 'task_form',
          sections: [
            {
              label: 'Details',
              visibleWhen: "record.type == 'urgent'",
              fields: [{ field: 'notes', visibleWhen: "record.priority == 'high'" }],
            },
          ],
        },
      ],
      pages: [
        {
          name: 'detail_page',
          regions: [
            { components: [{ type: 'element:text', visibleWhen: "page.selectedId != ''" }] },
          ],
        },
      ],
    };
    expect(validateVisibilityPredicates(stack)).toEqual([]);
  });

  it('flags a deprecated `visibleOn` alias on a form section (→ visibleWhen)', () => {
    const stack = {
      views: [
        { name: 'task_form', sections: [{ label: 'S', visibleOn: "record.a == 1", fields: [] }] },
      ],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(VISIBILITY_ALIAS_DEPRECATED);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('views[0].sections[0].visibleOn');
  });

  it('flags a deprecated `visibleOn` alias on a form field', () => {
    const stack = {
      views: [
        { name: 'task_form', sections: [{ fields: [{ field: 'notes', visibleOn: "record.a == 1" }] }] },
      ],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ALIAS_DEPRECATED]);
    expect(findings[0].path).toBe('views[0].sections[0].fields[0].visibleOn');
  });

  it('flags a deprecated `visibility` alias on a page component', () => {
    const stack = {
      pages: [
        { name: 'p', regions: [{ components: [{ type: 'element:text', visibility: "page.x != ''" }] }] },
      ],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(VISIBILITY_ALIAS_DEPRECATED);
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].visibility');
  });

  it('flags a `data.`-rooted predicate in a runtime view as mis-layered', () => {
    const stack = {
      views: [
        { name: 'task_form', sections: [{ fields: [{ field: 'notes', visibleWhen: "data.type == 'grid'" }] }] },
      ],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(findings[0].severity).toBe('warning');
  });

  it('reports BOTH alias + mis-layer when a `visibleOn` predicate is `data.`-rooted', () => {
    const stack = {
      views: [
        { name: 'task_form', sections: [{ visibleOn: "data.status == 'x'", fields: [] }] },
      ],
    };
    const rules = validateVisibilityPredicates(stack).map((f) => f.rule).sort();
    expect(rules).toEqual([VISIBILITY_ALIAS_DEPRECATED, VISIBILITY_ROOT_MISLAYERED].sort());
  });

  it('does not confuse a field literally named `data` (e.g. `record.data`) for a data root', () => {
    const stack = {
      views: [
        { name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: "record.data == 1" }] }] },
      ],
    };
    expect(validateVisibilityPredicates(stack)).toEqual([]);
  });

  it('resolves predicates stored as `{ dialect, source }` envelopes', () => {
    const stack = {
      pages: [
        {
          name: 'p',
          regions: [{ components: [{ type: 'element:text', visibleWhen: { dialect: 'cel', source: "data.x == 1" } }] }],
        },
      ],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
  });

  it('walks legacy `groups` (alias of sections) too', () => {
    const stack = {
      views: [
        { name: 'f', groups: [{ visibleOn: "record.a == 1", fields: [] }] },
      ],
    };
    expect(validateVisibilityPredicates(stack).map((f) => f.rule)).toEqual([VISIBILITY_ALIAS_DEPRECATED]);
  });

  it('is clean on an empty / model-less stack', () => {
    expect(validateVisibilityPredicates({})).toEqual([]);
    expect(validateVisibilityPredicates({ views: [], pages: [] })).toEqual([]);
  });

  // ── Layer-directional binding-root check (ADR-0089 D3, both directions) ──
  describe('metadata layer (opts.layer: "metadata")', () => {
    it('flags a `record.`-rooted predicate in a metadata-editing form as mis-layered', () => {
      const stack = {
        views: [
          { name: 'page_form', sections: [{ fields: [{ field: 'template', visibleWhen: "record.type != 'list'" }] }] },
        ],
      };
      const findings = validateVisibilityPredicates(stack, { layer: 'metadata' });
      expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain('record.');
      expect(findings[0].hint).toContain('data');
    });

    it('is clean for the canonical `data.` root in a metadata-editing form', () => {
      const stack = {
        views: [
          { name: 'page_form', sections: [{ visibleWhen: "data.type != 'list'", fields: [{ field: 'template', visibleWhen: "data.type == 'grid'" }] }] },
        ],
      };
      expect(validateVisibilityPredicates(stack, { layer: 'metadata' })).toEqual([]);
    });

    it('does NOT flag `data.` as mis-layered in the metadata layer (the runtime rule is the opposite)', () => {
      const stack = {
        views: [{ name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: "data.type == 'grid'" }] }] }],
      };
      // Runtime (default) flags `data.`…
      expect(validateVisibilityPredicates(stack).map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
      // …metadata does not.
      expect(validateVisibilityPredicates(stack, { layer: 'metadata' })).toEqual([]);
    });

    it('still flags a deprecated alias key in the metadata layer (alias check is layer-agnostic)', () => {
      const stack = {
        views: [{ name: 'f', sections: [{ visibleOn: "data.a == 1", fields: [] }] }],
      };
      const rules = validateVisibilityPredicates(stack, { layer: 'metadata' }).map((f) => f.rule);
      // alias present, but `data.` is correct for the metadata layer → only the alias finding.
      expect(rules).toEqual([VISIBILITY_ALIAS_DEPRECATED]);
    });

    it('does not confuse an identifier ending in `record` (e.g. `my_record.x`) for a record root', () => {
      const stack = {
        views: [{ name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: "my_record.x == 1" }] }] }],
      };
      expect(validateVisibilityPredicates(stack, { layer: 'metadata' })).toEqual([]);
    });
  });

  it('runtime is the default layer (no opts) — flags `data.`, not `record.`', () => {
    const dataStack = { views: [{ name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: 'data.a == 1' }] }] }] };
    const recordStack = { views: [{ name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: 'record.a == 1' }] }] }] };
    expect(validateVisibilityPredicates(dataStack).map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(validateVisibilityPredicates(recordStack)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// `visibility-bare-identifier` — #6128 (the build-time half of #5149's
// 2026-08-06 ruling; the runtime warn-once half landed as objectui#3541).
// ─────────────────────────────────────────────────────────────────────

/** A one-field runtime form view carrying `predicate` on its only field. */
function formStack(predicate: unknown): Record<string, unknown> {
  return { views: [{ name: 'task_form', sections: [{ fields: [{ field: 'notes', visibleWhen: predicate }] }] }] };
}

/** Only the bare-identifier findings, for assertions that ignore the advisories. */
function bareFindings(stack: Record<string, unknown>, opts?: { layer: 'runtime' | 'metadata' }) {
  return validateVisibilityPredicates(stack, opts).filter((f) => f.rule === VISIBILITY_BARE_IDENTIFIER);
}

describe('visibility-bare-identifier (#6128 / #5149 requirement 3)', () => {
  describe('the acceptance pair', () => {
    it('#5149 Repro 1 — a bare field name is an ERROR, not an advisory', () => {
      const findings = validateVisibilityPredicates(formStack("status == 'active'"));
      expect(findings).toHaveLength(1);
      expect(findings[0].rule).toBe(VISIBILITY_BARE_IDENTIFIER);
      // The whole point of the ruling: `error` gates, so the broken predicate
      // cannot be shipped at all ("坏谓词根本发不出去").
      expect(findings[0].severity).toBe('error');
      expect(findings[0].path).toBe('views[0].sections[0].fields[0]');
      expect(findings[0].message).toContain('`status`');
      expect(findings[0].hint).toContain('`record.status`');
    });

    it('the `record.`-prefixed spelling of the SAME predicate is clean', () => {
      expect(validateVisibilityPredicates(formStack("record.status == 'active'"))).toEqual([]);
    });
  });

  describe('the whole predicate family, on every carrier the schema declares', () => {
    it('flags a bare identifier on a form SECTION', () => {
      const stack = { views: [{ name: 'f', sections: [{ visibleWhen: 'approved', fields: [] }] }] };
      expect(bareFindings(stack).map((f) => f.path)).toEqual(['views[0].sections[0]']);
    });

    it('flags a bare identifier on a PAGE COMPONENT', () => {
      const stack = {
        pages: [{ name: 'p', regions: [{ components: [{ type: 'element:text', visibleWhen: "kind == 'a'" }] }] }],
      };
      expect(bareFindings(stack).map((f) => f.path)).toEqual(['pages[0].regions[0].components[0]']);
    });

    it('reads the value through the deprecated `visibleOn` alias too (alias + bare, both reported)', () => {
      const stack = { views: [{ name: 'f', sections: [{ visibleOn: "status == 'x'", fields: [] }] }] };
      const rules = validateVisibilityPredicates(stack).map((f) => f.rule).sort();
      expect(rules).toEqual([VISIBILITY_ALIAS_DEPRECATED, VISIBILITY_BARE_IDENTIFIER].sort());
    });

    it('reads the value through the deprecated page-side `visibility` alias too', () => {
      const stack = {
        pages: [{ name: 'p', regions: [{ components: [{ type: 'element:text', visibility: 'shown' }] }] }],
      };
      expect(bareFindings(stack)).toHaveLength(1);
    });

    it('resolves a `{ dialect, source }` envelope the same as a bare string', () => {
      expect(bareFindings(formStack({ dialect: 'cel', source: "status == 'active'" }))).toHaveLength(1);
    });

    it('walks a slotted page\'s `slots` map (single component AND array form)', () => {
      const stack = {
        pages: [
          {
            name: 'record_page',
            kind: 'slotted',
            slots: {
              highlights: { type: 'element:text', visibleWhen: "stage == 'won'" },
              tabs: [
                { type: 'record:related', visibleWhen: 'record.has_children' },
                { type: 'record:related', visibleWhen: 'has_children' },
              ],
            },
          },
        ],
      };
      expect(bareFindings(stack).map((f) => f.path).sort()).toEqual([
        'pages[0].slots.highlights',
        'pages[0].slots.tabs[1]',
      ]);
    });

    it('walks a component sub-tree hidden in the untyped `properties` bag', () => {
      // `page:tabs` / `page:accordion` keep their children at
      // `properties.items[].children`; `page:card` at `properties.body`. A
      // hand-rolled `regions[].components[]` loop sees none of them — which is
      // the dead-rule shape `page-walk.ts` exists to prevent (#3583).
      const stack = {
        pages: [
          {
            name: 'p',
            regions: [
              {
                components: [
                  {
                    type: 'page:tabs',
                    properties: {
                      items: [{ children: [{ type: 'element:text', visibleWhen: "stage == 'won'" }] }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };
      expect(bareFindings(stack)).toHaveLength(1);
    });
  });

  // ── The traversal the rule was measured against ─────────────────────
  //
  // `os build` on examples/app-showcase emits its single view-form predicate at
  // `views[0].formViews.edit.sections[0].fields[6].visibleWhen`: on the runtime
  // app shape a `views[]` entry is a view CONTAINER, and `sections` live under
  // `form` / `formViews.<key>`. Reading only `views[].sections` reported clean
  // on that stack — an `error`-level gate that cannot fire on the shape #5149's
  // own repro used (an object create dialog's `type: 'tabbed'` form view).
  describe('reaches the form views a real stack actually carries', () => {
    it('a container\'s named `formViews.<key>` — the shape app-showcase emits', () => {
      const stack = {
        views: [
          {
            name: 'showcase_task',
            list: { type: 'grid' },
            formViews: {
              edit: { type: 'simple', sections: [{ fields: [{ field: 'notes', visibleWhen: "priority == 'urgent'" }] }] },
            },
          },
        ],
      };
      expect(bareFindings(stack).map((f) => f.path)).toEqual([
        'views[0].formViews.edit.sections[0].fields[0]',
      ]);
    });

    it('names the sub-container in `where`, so two form views are distinguishable', () => {
      const stack = {
        views: [
          {
            object: 'showcase_task',
            formViews: {
              edit: { sections: [{ visibleWhen: 'approved', fields: [] }] },
              tabbed: { sections: [{ visibleWhen: 'approved', fields: [] }] },
            },
          },
        ],
      };
      // No `name` on the container (the emitted-artifact shape) — it falls back
      // to the `object` binding, and the surface tells the two forms apart.
      expect(bareFindings(stack).map((f) => f.where).sort()).toEqual([
        'view "showcase_task" · formViews.edit',
        'view "showcase_task" · formViews.tabbed',
      ]);
    });

    it('a container\'s DEFAULT `form`', () => {
      const stack = {
        views: [{ name: 'v', form: { sections: [{ visibleWhen: 'approved', fields: [] }] } }],
      };
      expect(bareFindings(stack).map((f) => f.path)).toEqual(['views[0].form.sections[0]']);
    });

    it('a bare form view whose `sections` sit at the top (the `defineForm` shape)', () => {
      const stack = { views: [{ name: 'v', sections: [{ visibleWhen: 'approved', fields: [] }] }] };
      expect(bareFindings(stack).map((f) => f.path)).toEqual(['views[0].sections[0]']);
    });

    it('a name-keyed `views` map reports the KEY, not a synthetic index', () => {
      const stack = {
        views: { task_form: { formViews: { edit: { sections: [{ visibleWhen: 'approved', fields: [] }] } } } },
      };
      expect(bareFindings(stack).map((f) => f.path)).toEqual([
        'views.task_form.formViews.edit.sections[0]',
      ]);
    });

    it('does NOT read `objects[].views` — the schema tombstones that key', () => {
      // `object.zod.ts:1833`: "`views` is not an ObjectSchema field". A branch
      // keyed on it could only fire for stacks the schema already rejects by
      // name — the phantom check #4984 / #5017 removed elsewhere.
      const stack = {
        objects: [
          { name: 'task', views: [{ sections: [{ visibleWhen: 'approved', fields: [] }] }] },
        ],
      };
      expect(validateVisibilityPredicates(stack)).toEqual([]);
    });
  });

  describe('the layer decides the prescribed root (ADR-0089 D3)', () => {
    it('a metadata-editing form is told to write `data.`, not `record.`', () => {
      const findings = bareFindings(formStack("layout == 'grid'"), { layer: 'metadata' });
      expect(findings).toHaveLength(1);
      expect(findings[0].hint).toContain('`data.layout`');
      expect(findings[0].hint).not.toContain('`record.layout`');
    });

    it('a runtime surface is told to write `record.`', () => {
      expect(bareFindings(formStack("layout == 'grid'"))[0].hint).toContain('`record.layout`');
    });
  });

  it('a field named after a CEL TYPE (`type`, `string`, …) is a measured blind spot', () => {
    // Not a bug to fix here, and not a false negative anyone can close cheaply:
    // `type` / `int` / `string` / `list` / `map` / `timestamp` … are identifiers
    // CEL itself declares (they denote type values), so `type == 'grid'` is a
    // TYPE-overload error to the checker, not an unknown variable — and
    // `firstUndeclaredReference` acts only on `Unknown variable`. Widening onto
    // the overload message would reject `type(record.x) == string`, which is
    // legitimate CEL, so the gate stays conservative: a missed catch, never a
    // false build error. Pinned so the next reader sees a decision, not a hole.
    expect(bareFindings(formStack("type == 'grid'"))).toEqual([]);
    expect(bareFindings(formStack("record.type == 'grid'"))).toEqual([]);
  });

  // ── The #4953 boundary, pinned rather than described ────────────────
  //
  // #4953 measured the SAME evaluator giving opposite verdicts on a total vs a
  // sparse record binding: `has(record.a)` is true/false and `record.a != null`
  // is false/FAULT depending on which the surface binds. Whichever way that
  // fork is settled, none of it changes THIS rule's verdict — a rootless
  // identifier resolves under neither binding, and a rooted one is never judged
  // here. These cases are the pin on that independence: if a later edit widens
  // the rule into key-level reasoning, they go red rather than the boundary
  // being quietly lost.
  describe('shapes that are legal under a SPARSE binding stay green (#4953)', () => {
    it.each([
      ['has(record.status)', 'the sparse-binding guard idiom'],
      ['record.status != null', 'the TOTAL-binding guard idiom — the opposite spelling'],
      ['has(record.a) && has(record.b) && record.a < record.b', 'the #4763 has()-only shape'],
      ['record.a != null && record.b != null && record.a < record.b', 'its total-binding counterpart'],
      ['!has(record.archived_at)', 'a negated presence test'],
    ])('%s stays clean (%s)', (predicate) => {
      expect(validateVisibilityPredicates(formStack(predicate))).toEqual([]);
    });
  });

  describe('what the rule deliberately does not reject', () => {
    it.each([
      ["record.tags.all(t, t != '')", 'a macro variable used BARE inside the comprehension body'],
      ['record.items.exists(i, i.qty > 0)', 'a macro variable used as a receiver'],
      ["['a', 'b'].exists(x, x == record.status)", 'a macro over a list literal'],
      ['record.lines.filter(l, l.amount > 0).size() > 0', 'a macro chained into a method call'],
    ])('%s — %s', (predicate) => {
      expect(validateVisibilityPredicates(formStack(predicate))).toEqual([]);
    });

    it.each([
      ["current_user.id == record.owner_id", 'the `current_user` root the schema documents'],
      ["'admin' in current_user.positions", 'the ADR-0068 role-membership shape'],
      ["page.selectedProjectId != ''", 'page state as `page.<var>`'],
      ['previous.status != record.status', 'the `previous` root the evaluator binds'],
      ["parent.status == 'paid'", 'a master-detail header injected as `parent`'],
    ])('%s — %s', (predicate) => {
      expect(validateVisibilityPredicates(formStack(predicate))).toEqual([]);
    });

    it('an UNKNOWN root is left to the wrong-root rules — this one only judges rootless refs', () => {
      // `my_record` resolves to nothing either, but it is a root-shaped defect:
      // ADR-0089 D3b owns the two directions the spec states, and the legal-root
      // list is not yet trustworthy enough to gate on (#6146). Widening here
      // would also make the D3b fixture below a false positive of this rule.
      expect(bareFindings(formStack('my_record.x == 1'))).toEqual([]);
      expect(bareFindings(formStack("record.data == 1"))).toEqual([]);
    });

    it('a predicate the canonical front end will not parse is left to the syntax verdict', () => {
      // `===` is not CEL. `parseCelToAst` returns null and this rule stays
      // silent rather than inventing a second syntax verdict — the same policy
      // `validate-null-guards.ts` states. (Documented gap: nothing validates
      // view/page predicate SYNTAX today, so this one is currently un-reported.)
      expect(validateVisibilityPredicates(formStack('country === "USA"'))).toEqual([]);
      expect(validateVisibilityPredicates(formStack('status =='))).toEqual([]);
    });

    it('an absent / empty predicate is not a finding', () => {
      expect(validateVisibilityPredicates(formStack(undefined))).toEqual([]);
      expect(validateVisibilityPredicates(formStack('   '))).toEqual([]);
    });
  });

  describe('the finding really gates', () => {
    it('the registry entry is `gating`, so `error` reaches all three commands', () => {
      // `severity: 'error'` only fails a build because `authoring-rules.ts`
      // says this rule family gates and therefore runs on validate/build/lint
      // alike. Declared = enforced: without this entry the diagnostic would be
      // an `error` nobody runs everywhere (`authoring-rule-wiring.test.ts`
      // states the invariant; this is its per-rule pin).
      const entry = AUTHORING_RULES.find((r) => r.name === 'validateVisibilityPredicates');
      expect(entry, 'validateVisibilityPredicates must be registered').toBeDefined();
      expect(entry!.tier).toBe('gating');
      expect([...entry!.commands].sort()).toEqual(['build', 'lint', 'validate']);
    });

    it('a bare identifier ANYWHERE in the predicate is caught, not just at the head', () => {
      expect(bareFindings(formStack("record.type == 'a' ? record.x > 1 : status == 'b'"))).toHaveLength(1);
      expect(bareFindings(formStack('record.done && overdue'))[0].message).toContain('`overdue`');
    });

    it('an unknown root does not mask a real bare identifier alongside it', () => {
      // The declare-then-check order matters: `my_record` is declared as a
      // namespace first, so the checker's verdict lands on `status` rather than
      // stopping at the root it is not this rule's job to judge.
      const findings = bareFindings(formStack("my_record.x == 1 && status == 'a'"));
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('`status`');
    });
  });
});
