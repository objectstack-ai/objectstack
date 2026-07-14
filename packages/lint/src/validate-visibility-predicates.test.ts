// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateVisibilityPredicates,
  VISIBILITY_ALIAS_DEPRECATED,
  VISIBILITY_ROOT_MISLAYERED,
} from './validate-visibility-predicates';

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
