/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one link an empty state names (objectui#12270).
 *
 * `@objectstack/spec`'s `EmptyStateSchema` declares an optional `link`,
 * `{ label, url }`: the one next step an empty list names, such as the how-to
 * page that explains what belongs here. The shape is taken by reference, so the
 * link reaches every empty state that shape reaches, and each of them draws it
 * through this component, ⛔ never a copy of its own:
 *
 * - a list view's `emptyState`, drawn by `@object-ui/plugin-list`'s `ListView`;
 * - a list page's own `interfaceConfig.emptyState`, which that page hands the
 *   same `ListView`;
 * - the `object-grid` block's `emptyState`, drawn by `@object-ui/plugin-grid`'s
 *   `ObjectGrid`.
 *
 * ## The click is the action runner's
 *
 * The link is followed as a `type: 'url'` action through the ActionRunner, so
 * what a click may open is the runner's `classifyNavigationTarget` answer, the
 * one answer every navigator in the app asks (ruling A+ on objectui#12191).
 * ⛔ No scheme test lives here. An in-app path goes through the host's router,
 * in place. An `http(s)://` address opens as the runner opens any external
 * target. `mailto:` opens the mail client in place. Any other value is refused
 * by the runner at the click, which reports its refusal (an error toast under
 * the console's provider) and navigates nowhere. The spec judges the url at
 * parse, except a template that opens with `${…}`, which it says is judged when
 * it is clicked, after interpolation: the runner's click is that judgement, so
 * nothing is judged here at render.
 *
 * Following a link is not feedback-worthy, so it raises no success toast, as
 * the html tier's anchor and the dashboard's header link raise none.
 *
 * ## Without an ActionProvider
 *
 * `useAction()` then hands over a local runner with no navigation or toast
 * handler. That runner hands an admitted in-app path back as `redirect`
 * instead of navigating, and reports a refusal to nobody, so this component
 * follows the redirect with a page navigation and logs the refusal.
 */

import * as React from 'react';
import { resolveI18nLabel, type EmptyState } from '@objectstack/spec/ui';
import { useAction } from '@object-ui/react';
import { Button } from '../ui/button';
import { cn } from '../lib/utils';

/** The spec's empty-state link, `{ label, url }` (`EmptyStateSchema.link`). */
export type EmptyStateLinkSpec = NonNullable<EmptyState['link']>;

export interface EmptyStateLinkProps {
  /** The authored `emptyState.link`. Absent, nothing is drawn. */
  link?: EmptyStateLinkSpec;
  /**
   * The locale the `label` is resolved against when it is an inline locale
   * map: the one the caller resolves the empty state's `title` and `message`
   * against. A label that resolves to no text draws nothing.
   */
  displayLocale: string;
  className?: string;
  'data-testid'?: string;
}

export function EmptyStateLink({
  link,
  displayLocale,
  className,
  'data-testid': testId = 'empty-state-link',
}: EmptyStateLinkProps) {
  const { runner } = useAction();
  const label = resolveI18nLabel(link?.label, displayLocale);
  if (!link || !label) return null;

  const follow = async () => {
    const result = await runner.execute({
      type: 'url',
      target: link.url,
      toast: { showOnSuccess: false },
    });
    if (!result.success) {
      console.warn('[EmptyStateLink] link not followed', result.error);
      return;
    }
    if (result.redirect) window.location.assign(result.redirect);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid={testId}
      className={cn(className)}
      onClick={() => { void follow(); }}
    >
      {label}
    </Button>
  );
}
