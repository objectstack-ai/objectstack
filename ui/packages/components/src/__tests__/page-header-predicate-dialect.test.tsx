/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `page:header` action predicates speak CEL — one dialect, one engine
 * (objectui#3521).
 *
 * The record header was the last action surface still handing EVERY predicate
 * to the legacy JS evaluator. The row kebab, the selection bar and conditional
 * formatting have routed through `evalRowPredicate` since objectui#1584 /
 * ADR-0058, where a bare string is CEL (what `@objectstack/spec` types
 * `ActionSchema.visible` as, and what the server enforces with). So every
 * construct that exists ONLY in CEL — a method call, the `in` operator, a
 * stdlib function — parsed fine in a list row and threw on the detail page,
 * where the throw fail-closed hid the button with nothing on screen to see:
 *
 *   Failed to evaluate expression '"red" in record.f_multiselect':
 *     Unexpected token "i" at position 6
 *   Failed to evaluate expression 'record.f_date < today()':
 *     "today" is not a function
 *
 * These tests pin the three families from the issue plus the fallback that
 * keeps the switch non-breaking: a legacy-dialect string (`${…}`, `===`,
 * `.includes()`) still routes to the old evaluator with its deprecation
 * warning, and a predicate that genuinely cannot be evaluated still fails
 * CLOSED, once, with the action named.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider, PredicateScopeProvider } from '@object-ui/react';

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- registry component is stable
  return <Component schema={schema} />;
}

/** The showcase field-zoo shape the issue was measured on. */
const OBJECT_SCHEMA = {
  name: 'showcase_field_zoo',
  label: 'Field Zoo',
  fields: {
    f_status: { type: 'select' },
    f_tags: { type: 'select', multiple: true },
    f_multiselect: { type: 'select', multiple: true },
    f_textarea: { type: 'textarea' },
    f_email: { type: 'email' },
    f_date: { type: 'date' },
    owner: { type: 'user' },
  },
};

const RECORD = {
  id: 'r1',
  f_status: 'open',
  f_tags: ['alpha', 'beta'],
  f_multiselect: ['red', 'blue'],
  f_textarea: 'please handle, urgent',
  f_email: 'ada@example.com',
  f_date: '2020-01-01',
  owner: { id: 'U1', name: 'Ada Lovelace' },
};

const SCOPE = { user: { id: 'U1' }, os: { user: { id: 'U1' } } };

function renderHeader(action: Record<string, unknown>, record: any = RECORD) {
  return render(
    <PredicateScopeProvider scope={SCOPE}>
      <ActionProvider>
        <RecordContextProvider
          objectName="showcase_field_zoo"
          recordId={record?.id ?? null}
          data={record}
          objectSchema={OBJECT_SCHEMA}
        >
          <PageHeader
            schema={{
              type: 'page:header',
              title: 'Specimen',
              actions: [{ locations: ['record_header'], label: 'Zoo Action', type: 'api', ...action }],
            }}
          />
        </RecordContextProvider>
      </ActionProvider>
    </PredicateScopeProvider>,
  );
}

const button = () => screen.queryByRole('button', { name: /Zoo Action/i });
const shown = () => !!button();

describe('page:header — CEL-only constructs in action predicates (#3521)', () => {
  describe('method calls', () => {
    it('evaluates `.size()` instead of throwing on it', () => {
      renderHeader({ name: 'zoo_size_true', visible: 'record.f_tags.size() > 0' });
      expect(shown()).toBe(true);
    });

    it('reaches the NEGATIVE verdict too — not just "no longer hidden"', () => {
      renderHeader({ name: 'zoo_size_false', visible: 'record.f_tags.size() > 0' }, { ...RECORD, f_tags: [] });
      expect(shown()).toBe(false);
    });

    it('evaluates `.contains()`', () => {
      renderHeader({ name: 'zoo_contains_true', visible: 'record.f_textarea.contains("urgent")' });
      expect(shown()).toBe(true);
    });

    it('hides when `.contains()` is false', () => {
      renderHeader(
        { name: 'zoo_contains_false', visible: 'record.f_textarea.contains("urgent")' },
        { ...RECORD, f_textarea: 'nothing to see here' },
      );
      expect(shown()).toBe(false);
    });

    // `.matches()` is CEL's regex method — the third method call the issue's
    // table names, and the one closest to a legacy marker: `.match(` IS a
    // legacy JS marker, `.matches(` deliberately is not (the marker requires
    // `(` right after `match`), so this must reach the CEL engine.
    it('evaluates `.matches()` — and is not mistaken for the legacy `.match()`', () => {
      renderHeader({
        name: 'zoo_matches_true',
        visible: 'record.f_email != null && record.f_email.matches(".*@example[.]com")',
      });
      expect(shown()).toBe(true);
    });

    it('hides when `.matches()` is false', () => {
      renderHeader(
        {
          name: 'zoo_matches_false',
          visible: 'record.f_email != null && record.f_email.matches(".*@example[.]com")',
        },
        { ...RECORD, f_email: 'ada@other.org' },
      );
      expect(shown()).toBe(false);
    });
  });

  describe('the `in` operator', () => {
    it('evaluates membership instead of failing to parse at position 6', () => {
      renderHeader({ name: 'zoo_in_true', visible: '"red" in record.f_multiselect' });
      expect(shown()).toBe(true);
    });

    it('hides when the member is absent', () => {
      renderHeader({ name: 'zoo_in_false', visible: '"green" in record.f_multiselect' });
      expect(shown()).toBe(false);
    });
  });

  describe('stdlib functions', () => {
    it('resolves `today()` instead of reporting it is not a function', () => {
      renderHeader({ name: 'zoo_today_true', visible: 'record.f_date != null && record.f_date < today()' });
      expect(shown()).toBe(true);
    });

    it('hides for a future date', () => {
      renderHeader(
        { name: 'zoo_today_false', visible: 'record.f_date != null && record.f_date < today()' },
        { ...RECORD, f_date: '2999-01-01' },
      );
      expect(shown()).toBe(false);
    });
  });

  it('honours a CEL construct inside the `{ dialect, source }` envelope', () => {
    renderHeader({
      name: 'zoo_envelope',
      visible: { dialect: 'cel', source: 'record.f_tags.size() > 1' },
    });
    expect(shown()).toBe(true);
  });

  it('applies CEL to `hidden`, the mirror predicate', () => {
    renderHeader({ name: 'zoo_hidden_cel', hidden: '"red" in record.f_multiselect' });
    expect(shown()).toBe(false);
  });

  it('keeps `hidden` false-y when the CEL verdict is false', () => {
    renderHeader({ name: 'zoo_hidden_cel_false', hidden: '"green" in record.f_multiselect' });
    expect(shown()).toBe(true);
  });

  it('applies CEL to `disabled` — the second call site of the same evaluator', () => {
    renderHeader({ name: 'zoo_disabled_cel', disabled: 'record.f_tags.size() > 0' });
    expect(button()).toBeTruthy();
    expect(button()).toBeDisabled();
  });

  it('leaves the button enabled when the `disabled` CEL verdict is false', () => {
    renderHeader({ name: 'zoo_enabled_cel', disabled: '"green" in record.f_multiselect' });
    expect(button()).toBeTruthy();
    expect(button()).not.toBeDisabled();
  });

  describe('bindings the row surfaces already offered', () => {
    // objectui#5741 (Phase 2 of the objectui#5330 canon): the bare-field and
    // `data.*` spellings are no longer bound on a record surface. They fault,
    // and this surface's existing policy is fail-closed — the SAME verdict on a
    // matching and a non-matching row is what "unbound" looks like from here.
    it('no longer binds bare field names (objectui#5741) — hidden on both rows', () => {
      renderHeader({ name: 'zoo_bare', visible: 'f_status == "open"' });
      expect(shown()).toBe(false);
      cleanup();
      renderHeader({ name: 'zoo_bare_other', visible: 'f_status == "open"' }, { ...RECORD, f_status: 'closed' });
      expect(shown()).toBe(false);
    });

    it('no longer binds `data.*` (objectui#5741) — hidden on both rows', () => {
      renderHeader({ name: 'zoo_data', visible: 'data.f_status == "open"' });
      expect(shown()).toBe(false);
      cleanup();
      renderHeader({ name: 'zoo_data_other', visible: 'data.f_status == "open"' }, { ...RECORD, f_status: 'closed' });
      expect(shown()).toBe(false);
    });

    it('binds the host scope (`os.user.*`) alongside the record', () => {
      renderHeader({ name: 'zoo_scope', visible: 'os.user.id == "U1" && record.f_status == "open"' });
      expect(shown()).toBe(true);
    });

    it('keeps #3501 relation binding: an EXPANDED lookup still compares as its id, in the same predicate as a CEL construct', () => {
      renderHeader({
        name: 'zoo_relation_and_cel',
        visible: 'record.owner == os.user.id && record.f_tags.size() > 0',
      });
      expect(shown()).toBe(true);
    });

    it('and reaches the same verdict when the lookup arrived UNexpanded', () => {
      renderHeader(
        { name: 'zoo_relation_unexpanded', visible: 'record.owner == os.user.id && record.f_tags.size() > 0' },
        { ...RECORD, owner: 'U1' },
      );
      expect(shown()).toBe(true);
    });
  });
});

describe('page:header — legacy dialect still falls back (#3521)', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => warn.mockRestore();
  });

  // `ReturnType<typeof vi.spyOn>` erases the spied signature, so `mock.calls`
  // arrives as `any` and this parameter had no type to infer. A console.warn
  // call is a list of arguments, of which only the first is read (objectui#4353).
  const legacyWarnings = () =>
    warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('legacy expression dialect'));

  it('evaluates a `${…}` template predicate on the legacy engine', () => {
    renderHeader({ name: 'zoo_legacy_template', visible: '${record.f_status === "open"}' });
    expect(shown()).toBe(true);
    expect(legacyWarnings().length).toBeGreaterThan(0);
  });

  it('hides when the `${…}` template predicate is false', () => {
    renderHeader({ name: 'zoo_legacy_template_false', visible: '${record.f_status === "closed"}' });
    expect(shown()).toBe(false);
  });

  it('evaluates a bare `===` predicate on the legacy engine', () => {
    renderHeader({ name: 'zoo_legacy_strict_eq', visible: 'record.f_status === "open"' });
    expect(shown()).toBe(true);
    expect(legacyWarnings().length).toBeGreaterThan(0);
  });

  it('evaluates a JS-only method (`.includes()`) on the legacy engine', () => {
    renderHeader({ name: 'zoo_legacy_includes', visible: 'record.f_textarea.includes("urgent")' });
    expect(shown()).toBe(true);
  });

  it('routes a legacy `disabled` predicate the same way', () => {
    renderHeader({ name: 'zoo_legacy_disabled', disabled: 'record.f_status === "open"' });
    expect(button()).toBeDisabled();
  });
});

describe('page:header — fail-closed stays fail-closed, and says so once (#3521)', () => {
  it('hides a predicate that cannot be evaluated and warns exactly once, naming the action', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const action = { name: 'zoo_broken_3521', visible: 'no_such_var_3521 == 1' };
      const { unmount } = renderHeader(action);
      expect(shown()).toBe(false);

      // The fault report now comes from `evalRowPredicate`'s warn-once
      // machinery — the SAME words the row kebab and the selection bar print —
      // carrying the label this surface passes, so the hidden button still
      // names itself.
      const faults = () =>
        warn.mock.calls.filter(
          c => String(c[0]).includes('failed to evaluate') && String(c[0]).includes('zoo_broken_3521'),
        );
      expect(faults()).toHaveLength(1);
      expect(String(faults()[0][0])).toContain('page:header');
      expect(String(faults()[0][0])).toContain('no_such_var_3521 == 1');

      // Re-render must not spam it (deduped per label + predicate).
      unmount();
      renderHeader(action);
      expect(faults()).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('renders a faulting `disabled` predicate DISABLED — the closed direction on this key (objectui#11212)', () => {
    // It was left ENABLED until objectui#11212, sharing `visible`'s `false`
    // fallback — which on this key is the OPEN answer. Rider 1 of
    // objectui#4421 (a permission-shaped gate is closed while the permissions
    // payload has not loaded) decided the `disabled` leg's own direction.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderHeader({ name: 'zoo_broken_disabled_3521', disabled: 'no_such_var_disabled_3521 == 1' });
      expect(button()).toBeTruthy();
      expect(button()).toBeDisabled();
      expect(
        warn.mock.calls.filter(c => String(c[0]).includes('zoo_broken_disabled_3521') && String(c[0]).includes('disabled')),
      ).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves a faulting `hidden` predicate rendered — the historical direction', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      renderHeader({ name: 'zoo_broken_hidden_3521', hidden: 'no_such_var_hidden_3521 == 1' });
      expect(shown()).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});
