/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Deliver a change of `filter-ui`, `sort-ui` or `view-switcher` on both of its
 * channels. The three controls call this one function, so they cannot drift
 * apart (objectui#10616).
 *
 * ## The two channels
 *
 * 1. HOST: the React prop `onChange` / `onViewChange`, holding a FUNCTION a
 *    host passes. It is called with the new value.
 * 2. AUTHORED: the schema key of the same name, holding an EVENT NAME
 *    (objectui#6124). It is dispatched on `window` as a `CustomEvent` whose
 *    `detail` is the documented shape: `{ values }`, `{ sort }` or `{ view }`.
 *
 * ## Why the prop is called only when it is a function
 *
 * `SchemaRenderer` spreads every non-metadata node key as a React prop, so
 * when no host supplies one, the authored event name also lands in the
 * same-named callback prop. The controls used to call that prop with `?.()`,
 * which does not guard a string: the first interaction threw
 * `TypeError: onChange is not a function` and the window event after it never
 * fired, so the declared, documented authoring form crashed through the
 * renderer. A string in the prop slot is only the spread copy of the authored
 * key, not a second channel: the event name is read from `schema`, the one
 * place the contract declares it, and the string is never called.
 *
 * ## When a host function and an authored name are both present
 *
 * Neither replaces the other. A host function passed through `SchemaRenderer`
 * takes the prop slot (its own props are spread last), and the authored name
 * is still on `schema`, so both channels deliver, in the order these controls
 * always used: the host function first, then the window event.
 */
export function notifyViewHandlerChannels<T>(
  hostCallback: ((value: T) => void) | string | undefined,
  eventName: string | undefined,
  value: T,
  detail: Record<string, unknown>,
): void {
  if (typeof hostCallback === 'function') {
    hostCallback(value);
  }

  if (eventName && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}
