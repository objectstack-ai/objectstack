/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { cn } from '../lib/utils';
import { Box, FileQuestion } from 'lucide-react';

export const PlaceholderRenderer = ({ schema, className }: any) => {
  const type = schema.type;
  const isView = type.startsWith('view:');
  const isWidget = type.startsWith('widget:');
  const isField = type.startsWith('field:');

  return (
    <div className={cn(
      "flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg bg-muted/30 transition-colors hover:bg-muted/50",
      isView && "border-blue-300 bg-blue-50/50 min-h-[200px]",
      isWidget && "border-purple-300 bg-purple-50/50 min-h-[150px]",
      isField && "border-yellow-300 bg-yellow-50/50 p-2 min-h-[40px] flex-row gap-2 justify-start",
      className
    )}>
      <div className={cn("flex items-center gap-2 text-muted-foreground", isField && "text-sm")}>
        {isField ? <Box className="h-4 w-4" /> : <FileQuestion className="h-8 w-8 mb-2 opacity-50" />}
        <div className="flex flex-col items-center text-center">
             <span className="font-mono font-medium text-foreground">{type}</span>
             {!isField && <span className="text-xs">Component Placeholder</span>}
        </div>
      </div>
      {schema.props && !isField && (
        <div className="mt-4 w-full text-xs text-muted-foreground bg-background/50 p-2 rounded overflow-hidden">
            <div className="opacity-70">Properties:</div>
            <pre className="mt-1 truncate">{JSON.stringify(schema.props, null, 0)}</pre>
        </div>
      )}
    </div>
  );
};

// List of all protocol-defined components that need placeholders
const PROTOCOL_COMPONENTS = [
  // 1. Views (List)
  'view:grid', 'view:kanban', 'view:map', 'view:calendar', 'view:gantt', 
  'view:timeline', 'view:gallery',
  
  // 2. Views (Form)
  'view:simple', 'view:wizard', 'view:tabbed', 'view:drawer', 'view:modal', 'view:split',

  // 3. Fields (Textual)
  'field:text', 'field:textarea', 'field:password', 'field:email', 'field:url', 'field:phone',
  
  // 4. Fields (Rich)
  'field:markdown', 'field:html', 'field:code',

  // 5. Fields (Numeric)
  'field:number', 'field:currency', 'field:percent', 'field:slider',

  // 6. Fields (Selection)
  'field:boolean', 'field:checkboxes', 'field:select', 'field:multiselect', 'field:radio',

  // 7. Fields (Date/Time)
  'field:date', 'field:datetime', 'field:time', 'field:duration',

  // 8. Fields (Relational)
  'field:lookup', 'field:master_detail', 'field:tree',

  // 9. Fields (Media)
  'field:image', 'field:file', 'field:video', 'field:audio', 'field:avatar',

  // 10. Fields (Visual)
  'field:color', 'field:rating', 'field:signature', 'field:qrcode', 'field:progress',

  // 11. Fields (Structure)
  'field:json', 'field:address', 'field:location',

  // 12. Page Components
  // `page-header` left with its `@object-ui/layout` registration (objectui#10859
  // batch 8, phase 2c): it was never a protocol page block — the spec's
  // `PageComponentType` member is `page:header` — and a placeholder here would
  // have kept the retired bare key registered in every host that opts in.
  'page:header',
  'page:footer', 'page:tabs', 'page:accordion', 'page:card', 'page:sidebar',
  'record:details', 'record:highlights', 'record:related_list', 'record:activity', 
  'record:chatter', 'record:path',
  'app:launcher', 'nav:menu', 'nav:breadcrumb',
  'global:search', 'global:notifications',
  // 'user:profile' intentionally omitted — `@objectstack/spec` 17.3.0 RETIRED
  // it from `PageComponentType` (measured: the enum went 34 → 32 options, lost
  // set exactly `['user:profile', 'element:form']`, gained set empty), so it is
  // no longer a page block any author can legitimately write. It never had a
  // renderer here either, only the dashed scaffold below, and the shell's own
  // profile affordance is a React slot rather than this block type — so nothing
  // user-reachable went with it. Same reasoning as `ai:chat_window` further
  // down: a page schema still naming it now produces the loud "Unknown
  // component type" panel instead of a silent grey box, which is what sends the
  // fix to the source. Retired across all three sites at once (objectui#7122):
  // here, the Studio palette ledger (`app-shell` `previews/block-types.ts`),
  // and the regenerated `@object-ui/cli` `known-schema-types.ts`.

  // 13. Dashboard Widgets
  'widget:metric', 'widget:bar', 'widget:line', 'widget:pie', 'widget:funnel', 
  'widget:radar', 'widget:scatter', 'widget:heatmap', 'widget:pivot', 'widget:table', 'widget:text', 'widget:image',

  // 14. Smart Actions (implemented in ./action/)
  // 'action:button', 'action:group', 'action:menu', 'action:icon',

  // 15. AI
  // 'ai:chat_window' intentionally omitted — the floating chat overlay
  // (see plugin-chatbot) is the canonical entry point; inline page-level
  // chat windows are not part of the supported surface. A referencing
  // page schema will produce a loud "Unknown component type" so the
  // misconfiguration is fixed at the source rather than silently hidden.
  'ai:input', 'ai:suggestion', 'ai:feedback'
];

/**
 * Page blocks the Studio palette OFFERS but no package renders yet.
 *
 * These are registered eagerly (see the side-effect call below, reached through
 * the `./renderers` barrel) rather than waiting for a host to opt in via
 * {@link registerPlaceholders} — which only `apps/console` does. A block Studio
 * advertises must not render a red "Unknown component type" panel in every
 * other host just because that host didn't call an optional bootstrap (#2943).
 *
 * Deliberately NARROW: the rest of {@link PROTOCOL_COMPONENTS} stays opt-in so
 * a genuinely missing renderer keeps failing loudly, which is what makes the
 * misconfiguration get fixed at the source (the same reasoning that keeps
 * `ai:chat_window` out of this file entirely — and, since #2943, out of the
 * palette too).
 */
export const PALETTE_PLACEHOLDER_BLOCKS = [
  'nav:menu', 'nav:breadcrumb', 'global:search', 'ai:suggestion',
];

/**
 * Register one placeholder, never over a key something else already owns: a
 * loaded registration, or a pending `registerLazy` stub (objectui#11680).
 *
 * ⭐ The stub half is the one that was missing. `get()` answers for LOADED
 * registrations only, so a key held by a stub whose chunk has not loaded read
 * as free. The console declares `view:calendar` and `view:timeline` that way,
 * and runs {@link registerPlaceholders} after its stubs. So the placeholder took
 * both keys and the registry cleared the stubs under them, as it does for any
 * key a registration takes. An authored `view:calendar` then drew the dashed
 * scaffold until some other node happened to load the calendar chunk, and the
 * registry's race warning fired for both keys on every boot. `hasLazy()` counts
 * the pending stub, so the key stays with the plugin that declared it and
 * `SchemaRenderer`'s lazy branch loads that plugin on first use.
 *
 * ⚠️ The check is made when the placeholder registers, so it only sees stubs
 * declared before it. A stub declared afterwards finds the key already taken.
 * That is why a host calls {@link registerPlaceholders} after its own stubs, as
 * the console's `main.tsx` says it must.
 */
function registerPlaceholder(type: string) {
    if (ComponentRegistry.hasLazy(type)) return;
    if (!ComponentRegistry.get(type)) {
        ComponentRegistry.register(type, PlaceholderRenderer, { namespace: 'protocol-placeholder' });
    }
}

/**
 * Register placeholders for the whole protocol vocabulary. Opt-in: hosts that
 * want every declared component to render *something* (the console's preview
 * gallery) call this; others keep the loud unknown-type error.
 */
export function registerPlaceholders() {
    PROTOCOL_COMPONENTS.forEach(registerPlaceholder);
}

// Palette-offered page blocks render everywhere, in every host (see above).
PALETTE_PLACEHOLDER_BLOCKS.forEach(registerPlaceholder);
