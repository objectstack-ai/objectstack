/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10471 — the tombstone names the spelling it was RESOLVED under,
 * not the live `type` of the field it happens to be handed.
 *
 * A retired spelling can reach the tombstone through a DIFFERENT key than the
 * field's `type`: an authored `widget` wins over `type` in both form hosts
 * (the record form resolves `f?.widget || f?.field?.widget || f?.type`, and
 * `FormPage` reads `field.widget` first). So `{ type: 'user', widget: 'owner' }`
 * is answered by the `owner` tombstone while its `field.type` is `user`. The
 * tombstone used to re-derive its spelling from `field.type`, and so it named
 * the LIVE type as retired ("Field type `user` was retired."), lost the
 * migration prescription for the real retired spelling, and — because
 * `reportRetiredFieldType('user')` is a no-op — logged nothing at all.
 *
 * Both resolvers that answer a retired key with the tombstone now bind the key
 * they resolved: `getLazyFieldWidget` (the ADR-0059 door `FormPage`,
 * `ActionParamDialog` and the bulk dialog render through) and the `field:`
 * registrations `registerAllFields()` makes (the record form's lookup).
 *
 * The expected spelling and its prescription are read from
 * `RETIRED_FIELD_TYPES` at runtime, never restated: the prescription TEXT is
 * the table's, so asserting the table's own value reached the screen pins the
 * hand-off, not the wording.
 *
 * `FormPage`'s end-to-end reproduction lives beside its own tombstone pin:
 * `apps/console/src/components/FormPage.retiredWidget-10471.test.tsx`.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not `beforeAll` — registers the real `form` renderer; the cold
// transform must not be billed to `hookTimeout` (objectui#3010).
import '@object-ui/components';

import {
  registerAllFields,
  getLazyFieldWidget,
  RetiredFieldTombstone,
  RETIRED_FIELD_TYPES,
  resetRetiredFieldTypeReports,
} from '../index';

/** The retired spellings, from the resolvers' own table. */
const RETIRED: readonly string[] = Object.keys(RETIRED_FIELD_TYPES);

/** The tombstone's observable facts: the spelling it names, and what it says. */
function tombstoneFacts(root: ParentNode) {
  const tombstones = root.querySelectorAll('[data-testid="field-retired-tombstone"]');
  const tombstone = tombstones[0] ?? null;
  return {
    count: tombstones.length,
    names: tombstone?.getAttribute('data-retired-field-type') ?? null,
    says: tombstone?.textContent ?? null,
  };
}

const expected = (spelling: string) => ({
  count: 1,
  names: spelling,
  says: RETIRED_FIELD_TYPES[spelling],
});

beforeEach(() => {
  resetRetiredFieldTypeReports();
  registerAllFields();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the retired set is read from the resolvers\' table, not restated', () => {
  it('is non-empty and contains `owner`, the card\'s case', () => {
    expect(RETIRED.length).toBeGreaterThan(0);
    expect(RETIRED).toContain('owner');
  });
});

describe.each(RETIRED)('objectui#10471 — the resolved spelling `%s` reaches the tombstone', (spelling) => {
  describe('each resolver answers with a tombstone bound to the key it resolved', () => {
    it('`getLazyFieldWidget` — handed a LIVE field type, it still names the resolved spelling', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const Widget = getLazyFieldWidget(spelling);
      const { container } = render(<Widget field={{ name: 'who', type: 'user' }} />);
      expect(tombstoneFacts(container)).toEqual(expected(spelling));
    });

    it('the `field:` registration — the record form\'s lookup — names the resolved spelling', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const Widget = ComponentRegistry.get(`field:${spelling}`)!;
      const { container } = render(<Widget field={{ name: 'who', type: 'text' }} />);
      expect(tombstoneFacts(container)).toEqual(expected(spelling));
    });

    it('one tombstone per spelling, shared by both resolvers and stable across calls', () => {
      // `FormPage` memoises on the key, and a fresh component per call would
      // remount the row; the registry and the lazy door must not diverge.
      expect(getLazyFieldWidget(spelling)).toBe(getLazyFieldWidget(spelling));
      expect(ComponentRegistry.get(`field:${spelling}`)).toBe(getLazyFieldWidget(spelling));
    });

    it('the migration prescription is written to the console for the resolved spelling, once', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const Widget = getLazyFieldWidget(spelling);
      render(
        <>
          <Widget field={{ name: 'a', type: 'user' }} />
          <Widget field={{ name: 'b', type: 'text' }} />
        </>,
      );
      const said = error.mock.calls.map((c) => String(c[0]));
      expect(said.filter((m) => m === RETIRED_FIELD_TYPES[spelling])).toHaveLength(1);
    });
  });

  describe('the tombstone itself', () => {
    it('an explicit `retiredFieldType` wins over the field it is handed', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { container } = render(
        <RetiredFieldTombstone retiredFieldType={spelling} field={{ type: 'user' }} />,
      );
      expect(tombstoneFacts(container)).toEqual(expected(spelling));
    });

    it('without it, the field\'s `type` is still read — a host whose key IS `field.type`', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { container } = render(<RetiredFieldTombstone field={{ type: spelling }} />);
      expect(tombstoneFacts(container)).toEqual(expected(spelling));
    });
  });

  describe('the record form (`form.tsx`), real renderer and real registry', () => {
    function renderForm(fields: Array<Record<string, unknown>>) {
      const Form = ComponentRegistry.get('form')!;
      return render(
        <Form schema={{ type: 'form', showSubmit: false, showCancel: false, fields }} />,
      );
    }
    const cell = (name: string) => {
      const el = document.querySelector(`[data-testid="field:${name}"]`);
      if (!el) throw new Error(`no field cell for ${name}`);
      return el;
    };

    it('REPRODUCTION — an object-form field `{ widget }` over a `user` field names the resolved spelling', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      // The `ObjectForm` shape: the mapped widget type, the authored `widget`,
      // and the raw metadata as `field`.
      renderForm([
        {
          name: 'who',
          label: 'Who',
          type: 'field:user',
          widget: spelling,
          field: { name: 'who', type: 'user', widget: spelling },
        },
      ]);
      expect(tombstoneFacts(cell('who'))).toEqual(expected(spelling));
    });

    it('REPRODUCTION — a standalone `{ type: \'text\', widget }` field names the resolved spelling', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      renderForm([{ name: 'ttl', label: 'Title', type: 'text', widget: spelling }]);
      expect(tombstoneFacts(cell('ttl'))).toEqual(expected(spelling));
    });

    it('REPRODUCTION — the namespaced `widget: \'field:SPELLING\'` over a `user` field names the bare spelling', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      renderForm([
        {
          name: 'ns',
          label: 'Namespaced',
          type: 'field:user',
          widget: `field:${spelling}`,
          field: { name: 'ns', type: 'user' },
        },
      ]);
      expect(tombstoneFacts(cell('ns'))).toEqual(expected(spelling));
    });

    it('CONTROL — a field whose TYPE is the retired spelling still names it', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      renderForm([
        {
          name: 'own',
          label: 'Owner',
          type: `field:${spelling}`,
          field: { name: 'own', type: spelling },
        },
      ]);
      expect(tombstoneFacts(cell('own'))).toEqual(expected(spelling));
    });
  });
});

describe('a live type never reaches the retirement machinery', () => {
  it('`field:user` is not a retired spelling\'s tombstone', () => {
    expect(RETIRED).not.toContain('user');
    for (const spelling of RETIRED) {
      expect(ComponentRegistry.get('field:user')).not.toBe(getLazyFieldWidget(spelling));
    }
  });
});
