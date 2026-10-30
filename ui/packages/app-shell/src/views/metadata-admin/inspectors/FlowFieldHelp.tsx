// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowFieldHelp — the help line under a flow inspector field or list column.
 *
 * Help text is often the engine-published schema description, which can run to
 * a paragraph. A help longer than {@link FLOW_HELP_CLAMP_CHARS} opens clamped to
 * two lines with a "Learn more" toggle; the full text stays in the DOM either
 * way, so a screen reader and a text search still reach all of it.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import { t, useMetadataLocale } from '../i18n.js';

/** Help at or under this many characters renders in full, with no toggle. */
export const FLOW_HELP_CLAMP_CHARS = 120;

export function FlowFieldHelp({ text, className }: { text: string; className?: string }) {
  const locale = useMetadataLocale();
  const [expanded, setExpanded] = React.useState(false);
  const id = React.useId();
  const long = text.length > FLOW_HELP_CLAMP_CHARS;
  return (
    <div className={className} data-testid="flow-field-help">
      <p
        id={id}
        className={cn('text-[11px] leading-snug text-muted-foreground', long && !expanded && 'line-clamp-2')}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          className="text-[11px] font-medium text-primary hover:underline"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
        >
          {t(expanded ? 'engine.inspector.flowNode.help.showLess' : 'engine.inspector.flowNode.help.learnMore', locale)}
        </button>
      )}
    </div>
  );
}
