/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6250 — the fourteen `components-feedback-toast/*` and
 * `components-feedback-sonner/*` demos hung an action object off `onClick`:
 *
 *   { "type": "button", "label": "Destructive Toast", "variant": "destructive",
 *     "onClick": { "action": "toast", "variant": "error", "title": "Error", … } }
 *
 * That shape is declared nowhere and executed nowhere, and the docs page prints
 * `JSON.stringify(schema)` right beside the demo
 * (`apps/site/app/components/InteractiveDemo.tsx`), so it is the literal
 * copy-paste surface for every reader and every few-shot retriever.
 *
 * ## The half this file carries
 *
 * The DECLARED half — `ButtonSchema.onClick` is `z.function()`
 * (`zod/form.zod.ts`), so all fourteen were a RED `safeParse` on the ENVELOPE —
 * belongs to `component-fixture-declared-keys.test.ts`. This file carries the
 * EXECUTED half, which no schema parse can see.
 *
 * `ActionRunner`'s runnable vocabulary is `script | url | modal | flow | api |
 * form | navigation` (`builtinExecutors`, `core/src/actions/ActionRunner.ts`) —
 * there is no `toast` and no `sonner` executor, and nothing anywhere reads a
 * handler key as an action object. So `{ action: 'toast', … }` had no
 * dispatcher on any tree.
 *
 * ⚠️ It was WORSE than inert, and that is measured below rather than asserted.
 * `onClick` is a member of `SDUI_DOM_PASS_THROUGH_KEYS`
 * (`core/src/utils/dom-props.ts`), so the action object was forwarded to the
 * rendered `<button>`'s DOM listener slot, and React rejects it on click:
 * `Expected 'onClick' listener to be a function, instead got a value of
 * 'object' type.` The counter-probe at the end pins that, so "the old shape did
 * nothing" is a reading taken in this harness rather than a claim inherited
 * from the card.
 *
 * The registered spellings DO run: `ComponentRegistry.register('toast', …)` and
 * `('sonner', …)` each render their own trigger button and call sonner's
 * `toast()` from its handler. The correction is therefore to a spelling the
 * engine already executes, and this file measures the execution.
 *
 * ## Why a real click against a real `<Toaster />`, and not `vi.mock('sonner')`
 *
 * A mock would prove the renderer CALLS something; it would not prove a reader
 * who copies the JSON sees a toast. `sonner` is also not a dependency of this
 * example package, so the mock specifier would resolve to a different module
 * than the one `renderers/feedback/toast.tsx` imports — a mock that cannot
 * fail. `Toaster` re-exported from `@object-ui/components` is the same module
 * instance the renderers use.
 *
 * ## Why toasts are identified by NODE IDENTITY, not by their text
 *
 * sonner's toast store is MODULE-GLOBAL and replays to every newly mounted
 * `<Toaster />`, so `cleanup()` alone does not clear it — see the `afterEach`
 * below, which does. Even with the store cleared, identity beats text here:
 * `basic-toast` and `success-toast` share the description "Your changes have
 * been saved.", and a text query found it twice on the first run. Diffing
 * `[data-sonner-toast]` nodes by identity is immune to that, and to any two
 * fixtures ever authoring the same string.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@object-ui/components';
import { Toaster, toast } from '@object-ui/components';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

type Json = Record<string, unknown>;

/** Every demo on the two pages this card covers, straight from the catalog. */
const DEMOS = allExamples()
  .filter(
    (e) =>
      e.meta.category === 'components-feedback-toast' ||
      e.meta.category === 'components-feedback-sonner',
  )
  .map((e) => [e.id, e.schema as unknown as Json] as const);

/**
 * The strings a reader must see after clicking. `title` is `ToastSchema`'s
 * heading, `message` is `SonnerSchema`'s, and both renderers pass `description`
 * through as sonner's `description` option.
 */
function authoredToastText(schema: Json): string[] {
  return [schema.title, schema.message, schema.description].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
}

const toastNodes = () => Array.from(document.querySelectorAll('[data-sonner-toast]'));

function renderDemo(schema: unknown) {
  return render(
    <>
      <SchemaRenderer schema={schema as never} />
      <Toaster visibleToasts={20} />
    </>,
  );
}

/**
 * sonner replays every ACTIVE toast to each newly mounted `<Toaster />`
 * (`getActiveToasts().forEach(subscriber)` in its `Observer.subscribe`), and
 * that replay lands in a mount effect — AFTER a snapshot taken right after
 * `render()`. Measured before this hook existed: the last case in the file saw
 * 14 foreign toast nodes appear around its click.
 *
 * `toast.dismiss()` with no id adds every active id to sonner's
 * `dismissedToasts` set, which `getActiveToasts` filters on — so the next
 * `<Toaster />` has nothing to replay. It is the same module instance the
 * renderers import: `@object-ui/components` re-exports it through
 * `ui/index.ts`'s `export * from './sonner'`.
 */
afterEach(() => {
  toast.dismiss();
  cleanup();
});

describe('objectui#6250 — every toast/sonner demo raises a real toast when clicked', () => {
  it('the corpus is the fourteen entries this card covers — non-vacuity control', () => {
    expect(DEMOS).toHaveLength(14);
    expect(
      DEMOS.filter(([, schema]) => schema.type === 'toast' || schema.type === 'sonner'),
    ).toHaveLength(14);
  });

  it('no demo hangs a payload off a handler key any more — the retired shape', () => {
    const violations = DEMOS.flatMap(([id, schema]) =>
      Object.entries(schema)
        .filter(([key]) => /^on[A-Z]/.test(key) || key === 'events')
        .map(([key, value]) => `${id}.${key} = ${JSON.stringify(value)}`),
    );
    expect(violations).toEqual([]);
  });

  it.each(DEMOS)('%s fires its toast on click', async (id, schema) => {
    const texts = authoredToastText(schema);
    expect(texts.length, `${id} authors no toast text to assert on`).toBeGreaterThan(0);

    renderDemo(schema);
    const before = new Set(toastNodes());

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      const added = toastNodes().filter((n) => !before.has(n));
      expect(added).toHaveLength(1);
      for (const text of texts) {
        expect(added[0].textContent ?? '').toContain(text);
      }
    });
  });

  it('counter-probe: the retired action-object shape raises no toast in this same harness', async () => {
    const retired = {
      type: 'button',
      label: 'Destructive Toast',
      variant: 'destructive',
      onClick: {
        action: 'toast',
        variant: 'error',
        title: 'Error',
        description: 'Something went wrong.',
      },
    };

    renderDemo(retired);
    const before = new Set(toastNodes());
    expect(screen.getByRole('button').textContent).toContain('Destructive Toast');

    let thrown: unknown;
    try {
      await userEvent.click(screen.getByRole('button'));
    } catch (error) {
      thrown = error;
    }

    // The load-bearing half: no toast, whatever the click did.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toastNodes().filter((n) => !before.has(n))).toHaveLength(0);

    // The measured half: the payload reached the DOM listener slot through
    // `SDUI_DOM_PASS_THROUGH_KEYS` and React refused it. Pinned as a literal so
    // a change in that behaviour turns this red for review rather than quietly
    // becoming a different fact.
    expect(String((thrown as Error | undefined)?.message ?? '')).toContain(
      "Expected `onClick` listener to be a function, instead got a value of `object` type.",
    );
  });
});
