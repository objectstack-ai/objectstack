/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `TagsField` composes the host's `onBlur` instead of replacing it
 * (objectui#6802) — and still commits the typed draft.
 *
 * `onBlur` is a DECLARED DOM pass-through key: named in `FieldWidgetDomProps`
 * (`../widgets/types.ts`) and in `SDUI_DOM_PASS_THROUGH_KEYS`
 * (`@object-ui/core`), and forwarded by `toDomProps`. This widget wrote
 * `onBlur={() => addTag(draft)}` AFTER its `{...toDomProps(props)}` spread, so
 * a host's handler was overwritten and never reached the input — this package's
 * DECLARED-BUT-NOT-DELIVERED class (objectui#3290 / objectui#3222).
 *
 * ⚠️ Why a pin is required rather than nice-to-have: nothing that existed
 * before could go red on this. The regression is invisible to every other test
 * in the package, because none of them supplies a host `onBlur` — so the assert
 * has to DRIVE a host handler through the real widget, not restate the
 * predicate. The user-visible half (blur-mode validation through the real form
 * renderer) is pinned in `hostOnBlurDelivery-e2e.test.tsx`; the four
 * `type="number"` widgets carry the same pin in
 * `NumberInputWidgets.badInputAnnounce.test.tsx`.
 *
 * ⛔ Both halves are asserted together on purpose. Composition that dropped
 * `addTag` would satisfy a host-only assertion while losing the tag the user
 * just typed, and the old `addTag`-only handler satisfies a tag-only assertion
 * while losing the host — one assertion each way cannot tell those apart.
 */

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

import { TagsField } from '../widgets/TagsField';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Mount with a host that ECHOES the emission back into `value`, the way a real
 * form does — `TagsField` is a controlled input, so a bare spy host would leave
 * `value` frozen and hide any second emission.
 */
function mountTags(extra: { onBlur?: React.FocusEventHandler<HTMLElement> } = {}) {
  const onChange = vi.fn();
  const Host = () => {
    const [value, setValue] = React.useState<string[]>([]);
    return (
      <TagsField
        value={value}
        onChange={(v: string[]) => {
          onChange(v);
          setValue(v);
        }}
        field={{ name: 'labels', type: 'tags' } as any}
        {...extra}
      />
    );
  };
  const { container } = render(<Host />);
  const box = container.querySelector('input') as HTMLInputElement;
  return { container, onChange, box };
}

describe('TagsField and a host-supplied onBlur (objectui#6802)', () => {
  it('calls the host onBlur', () => {
    const hostBlur = vi.fn();
    const { box } = mountTags({ onBlur: hostBlur });

    fireEvent.blur(box);

    expect(hostBlur).toHaveBeenCalledTimes(1);
  });

  it('hands the host the real focus event, not a fabricated one', () => {
    const hostBlur = vi.fn();
    const { box } = mountTags({ onBlur: hostBlur });

    fireEvent.blur(box);

    // react-hook-form's controller `onBlur` reads the event it is handed; a
    // composition that called `domProps.onBlur?.()` with no argument would pass
    // the count assertion above and still break a real host.
    const event = hostBlur.mock.calls[0]?.[0];
    expect(event).toBeDefined();
    expect(event.target).toBe(box);
  });

  it('still commits the typed draft as a tag on that same blur', () => {
    const hostBlur = vi.fn();
    const { box, onChange } = mountTags({ onBlur: hostBlur });

    fireEvent.change(box, { target: { value: 'urgent' } });
    fireEvent.blur(box);

    expect(onChange).toHaveBeenCalledWith(['urgent']);
    expect(hostBlur).toHaveBeenCalledTimes(1);
  });

  it('works with no host handler at all — the key is optional', () => {
    const { box, onChange } = mountTags();

    fireEvent.change(box, { target: { value: 'urgent' } });
    expect(() => fireEvent.blur(box)).not.toThrow();

    expect(onChange).toHaveBeenCalledWith(['urgent']);
  });
});
