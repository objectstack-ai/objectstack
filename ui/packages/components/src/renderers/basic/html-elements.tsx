/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Safe native HTML element passthrough renderers (ADR: kind:'html').
 *
 * A `kind:'html'` page is authored as a constrained JSX string that is
 * PARSED (never executed) into the SDUI tree. For that tier to live up to its
 * name, the everyday HTML tags an author reaches for — headings, paragraphs,
 * lists, links, images, emphasis — must each resolve to a renderer (otherwise
 * the parser flags them `unknown-component`). div / span / table / label and
 * the semantic sectioning tags are registered elsewhere; this module fills in
 * the rest of the safe flow/inline set — `code` included (objectui#10756): the
 * bare `code` key used to be the `field:code` widget's namespace fallback, so
 * `<code>inline</code>` on an html page drew a code EDITOR and dropped its
 * text. The widget now stands down from the bare key (`FIELD_TYPES_SKIP_FALLBACK`
 * in `@object-ui/fields`) and stays reachable as `field:code`.
 *
 * Safety: these render real DOM, but the html tier never executes JS, so props
 * are static literals from the parser. As defense-in-depth the passthrough
 * still strips event handlers (`on*`) and `dangerouslySetInnerHTML`, and
 * neutralizes `javascript:`/`data:` URLs on `<a href>`.
 */

import { ComponentRegistry, type ActionResult } from '@object-ui/core';
import { ActionCtxReact } from '@object-ui/react';
import { renderChildren } from '../../lib/utils';
import { createElement, forwardRef, useContext } from 'react';
import type { MouseEventHandler } from 'react';

type AnyProps = { schema: any; className?: string; [key: string]: any };

// Tags that take no children.
const VOID_TAGS = new Set(['img', 'hr', 'br']);

// The safe set we own here. Deliberately excludes anything already registered
// (div, span, table, label, kbd, the semantic sectioning tags, html) and
// anything that can execute or escape (script, style, iframe, object, embed,
// link, meta, form, input, button — button is the shadcn component).
//
// `kbd` was in this list until objectui#5125 despite the exclusion above:
// `data-display/kbd.tsx` already owns `ui:kbd`, and because `renderers/index.ts`
// imports `./basic` before `./data-display`, the entry here was overwritten and
// never ran. `renderers/__tests__/registration-uniqueness.test.tsx` now fails on
// any tag added here that another renderer already registers.
const TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'a', 'blockquote', 'pre', 'code',
  'strong', 'em', 'b', 'i', 'u', 'small', 'mark', 'sub', 'sup', 'del', 'ins', 'abbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'img', 'hr', 'br', 'time', 'address', 'cite', 'q',
] as const;

const PER_TAG_INPUTS: Record<string, Array<{ name: string; type: 'string' | 'number' }>> = {
  a: [
    { name: 'href', type: 'string' },
    { name: 'target', type: 'string' },
    { name: 'rel', type: 'string' },
    { name: 'title', type: 'string' },
  ],
  img: [
    { name: 'src', type: 'string' },
    { name: 'alt', type: 'string' },
    { name: 'width', type: 'number' },
    { name: 'height', type: 'number' },
    { name: 'title', type: 'string' },
  ],
  time: [{ name: 'dateTime', type: 'string' }],
  abbr: [{ name: 'title', type: 'string' }],
  q: [{ name: 'cite', type: 'string' }],
  blockquote: [{ name: 'cite', type: 'string' }],
};

function sanitizeHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  // Disallow script-bearing schemes; allow http(s), mailto, tel, anchors, relative.
  if (/^(javascript|data|vbscript):/i.test(v)) return undefined;
  return v;
}

/**
 * Resolve an authored href to an app-root-absolute path (`/apps/...`) when it
 * is an internal SPA link, or null when the browser should handle it natively
 * (scheme-qualified, protocol-relative, or in-page fragment links).
 *
 * Authored pages write app-root-relative hrefs (`apps/<app>/<object>`,
 * `docs/<name>`). A raw `<a>` resolves those against `document.baseURI`,
 * which only lands on the app root when the host injected a matching `<base>`
 * tag — without one (root-mounted consoles, vite dev) the browser nests the
 * path under the current page URL and 404s (objectui#2638). Routing internal
 * links through the SPA's navigation handler makes them deployment-agnostic.
 */
function toInternalPath(href: unknown): string | null {
  if (typeof href !== 'string' || href.trim().length === 0) return null;
  const v = href.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null; // http:, https:, mailto:, tel:, …
  if (v.startsWith('//')) return null; // protocol-relative external
  if (v.startsWith('#')) return null; // in-page fragment
  try {
    // Resolve ./ and ../ segments against a synthetic root so the result is
    // app-root-absolute regardless of the current page path.
    const u = new URL(v, 'https://internal.invalid/');
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

for (const tag of TAGS) {
  const isVoid = VOID_TAGS.has(tag);
  // Index signature on the parameter annotation, not on the `forwardRef` type
  // argument — mechanism note on `action:bar` (objectui#4422), pinned by
  // `__tests__/forwardref-props-annotation.guard.test.ts`. `schema` is
  // genuinely `any` here (one factory over every raw HTML tag), so nothing is
  // recovered by the annotation; it is written the same way as its 11 siblings
  // so the guard needs no per-file carve-out.
  const Component = forwardRef<HTMLElement, { schema: AnyProps['schema']; className?: AnyProps['className'] }>(({ schema, className, ...props }: AnyProps, ref) => {
    const {
      'data-obj-id': dataObjId,
      'data-obj-type': dataObjType,
      style,
      // never forward these onto raw DOM from authored source
      dangerouslySetInnerHTML: _dsih,
      children: _children,
      ...rest
    } = props;

    // Strip event handlers (the html tier has no JS; these would be inert/strings).
    const safe: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (/^on[A-Z]/.test(k)) continue;
      safe[k] = val;
    }
    if (tag === 'a' && 'href' in safe) safe.href = sanitizeHref(safe.href);

    // Internal links navigate through the SPA router (via the url action's
    // navigation handler) instead of a raw browser navigation, so they no
    // longer depend on a host-injected <base> tag (objectui#2638). Modified
    // clicks, new-tab targets, fragments, and external URLs keep native
    // behavior; without an ActionProvider the anchor stays untouched.
    const actionCtx = useContext(ActionCtxReact);
    let onClick: MouseEventHandler | undefined;
    if (tag === 'a' && actionCtx) {
      const path = toInternalPath(safe.href);
      const linkTarget = typeof safe.target === 'string' ? safe.target : '';
      if (path && (!linkTarget || linkTarget === '_self')) {
        onClick = (e) => {
          if (e.defaultPrevented || e.button !== 0) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          // The url action keeps SPA-vs-full-page semantics (`/api/` paths
          // escape the router); with no navigation handler wired it reports
          // the redirect back for us to follow. Success toasts are suppressed
          // — following a link is not a feedback-worthy "action".
          void actionCtx.runner
            .execute({ type: 'url', target: path, toast: { showOnSuccess: false } })
            .then((r: ActionResult) => {
              if (r?.success && r.redirect) window.location.assign(r.redirect);
            });
        };
      }
    }

    return createElement(
      tag,
      {
        ref,
        className,
        ...safe,
        ...(onClick ? { onClick } : {}),
        'data-obj-id': dataObjId,
        'data-obj-type': dataObjType,
        style,
      },
      // `children` only (objectui#6771). This factory backs every safe HTML
      // tag, so a surviving `??` arm would have kept the retired spelling
      // alive across the widest surface in the tree while both published
      // faces refuse it — the runtime honouring what the contract rejects.
      isVoid ? undefined : renderChildren(schema?.children),
    );
  });
  Component.displayName = `Html${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;

  ComponentRegistry.register(tag, Component, {
    namespace: 'ui',
    label: tag.toUpperCase(),
    category: 'basic',
    inputs: [
      { name: 'className', type: 'string' },
      ...(PER_TAG_INPUTS[tag] ?? []),
      // The child slot, declared on exactly the tags the factory renders it
      // for (objectui#9910): `validateTree`'s `not-a-container` reads THIS
      // input, so a void tag must not declare it — `<br>` taking children
      // would be the lie in the other direction — and every flow/inline tag
      // must, or the html tier warns on the one key its authors write.
      ...(isVoid ? [] : [{ name: 'children', type: 'slot' as const }]),
    ],
  });
}
