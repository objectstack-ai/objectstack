/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * FormSectionContainer
 *
 * The chrome a form section renders in: an optional collapsible header plus a
 * multi-column grid around whatever fields are passed as children.
 *
 * Renamed off `FormSection` (objectui#3161, objectstack#4115 ledger batch 7).
 * `@objectstack/spec/ui` owns `FormSection` for the authored section METADATA —
 * `{ name?, label?, description?, collapsible, collapsed, columns, pane?,
 * visibleWhen?, fields }` — and this repo already uses that word for that
 * meaning in its own prose: `plugin-form/README.md` and the plugin docs both
 * write "spec `FormSection.pane`", `@object-ui/types` re-exports the spec type
 * as `SpecFormSection`, and its own authored dialect is `ObjectFormSection`. So
 * the name was taken twice over, and the file header said this component
 * "aligns with @objectstack/spec FormSection" — the canonical-claim comment the
 * symbol guard's header describes as a planted premise for the next session.
 *
 * It is NOT the `ListView`-style exemption batch 6 granted, and the difference
 * is worth stating: `ListViewProps.schema` takes the spec-derived metadata as
 * ONE prop, so that renderer restates nothing. This one takes the metadata
 * FLATTENED into individual props (`label`, `description`, `collapsible`,
 * `collapsed`, `columns`) — a second vocabulary for the same keys, minus
 * `fields` (children instead), minus `name`, minus `pane`, minus `visibleWhen`,
 * plus render-only knobs. A declaration like that is exactly what the next
 * session would read as the authoritative shape of a form section.
 *
 * `columns` deliberately stays `1 | 2 | 3 | 4` rather than binding the spec's
 * key: the spec ACCEPTS `'1' | 1 | '2' | 2 | …` on the authoring side and
 * normalises the strings away in its pipe, while `gridCols` here is indexed by
 * number. Binding the authored type would hand this component a `'2'` it would
 * silently render as one column. The normalisation belongs at the seam that
 * parses authored metadata, not in the container's props.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@object-ui/components';
import { Card, CardContent, CardHeader } from '@object-ui/components';

export interface FormSectionContainerProps {
  /**
   * Section title/label
   */
  label?: string;
  
  /**
   * Section description
   */
  description?: string;
  
  /**
   * Whether the section can be collapsed
   * @default false
   */
  collapsible?: boolean;
  
  /**
   * Whether the section is initially collapsed
   * @default false
   */
  collapsed?: boolean;
  
  /**
   * Number of columns for field layout
   * @default 1
   */
  columns?: 1 | 2 | 3 | 4;
  
  /**
   * Section children (form fields)
   */
  children: React.ReactNode;
  
  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Override the default responsive grid classes.
   * When provided, replaces the viewport-based grid-cols classes
   * (e.g. with container-query-based classes like `@md:grid-cols-2`).
   */
  gridClassName?: string;

  /**
   * Wrap the section in Card chrome (border + subtle background).
   * When `undefined`, defaults to `true` for sections with a `label`
   * (so titled sections feel like discrete cards) and `false` for
   * untitled fallback sections (so the form looks like one flat block).
   * Mirrors the same auto-default used by DetailSection on detail pages.
   */
  showBorder?: boolean;
}

/**
 * FormSectionContainer Component
 * 
 * Groups form fields with optional header, collapsibility, and multi-column layout.
 * 
 * @example
 * ```tsx
 * <FormSectionContainer label="Contact Details" columns={2} collapsible>
 *   <FormField name="firstName" />
 *   <FormField name="lastName" />
 * </FormSectionContainer>
 * ```
 */
export const FormSectionContainer: React.FC<FormSectionContainerProps> = ({
  label,
  description,
  collapsible = false,
  collapsed: initialCollapsed = false,
  columns = 1,
  children,
  className,
  gridClassName,
  showBorder,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  const gridCols: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  };

  const handleToggle = () => {
    if (collapsible) {
      setIsCollapsed(!isCollapsed);
    }
  };

  // Auto-default: titled sections render as Card; untitled sections stay flat.
  const wrapInCard = showBorder ?? Boolean(label);

  const headerNode = (label || description) ? (
    <div
      className={cn(
        'flex items-start gap-2',
        !wrapInCard && 'mb-4',
        collapsible && 'cursor-pointer select-none'
      )}
      onClick={handleToggle}
      role={collapsible ? 'button' : undefined}
      aria-expanded={collapsible ? !isCollapsed : undefined}
    >
      {collapsible && (
        <span className="mt-0.5 text-muted-foreground">
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      )}
      <div className="flex-1">
        {label && (
          <h3 className="text-sm font-semibold text-foreground">
            {label}
          </h3>
        )}
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {description}
          </p>
        )}
      </div>
    </div>
  ) : null;

  const contentNode = !isCollapsed ? (
    <div className={cn('grid gap-4', gridClassName || gridCols[columns])}>
      {children}
    </div>
  ) : null;

  if (wrapInCard) {
    return (
      <Card className={cn('form-section bg-muted/40 shadow-none', className)}>
        {headerNode && <CardHeader className="border-b border-border pb-3">{headerNode}</CardHeader>}
        {contentNode && <CardContent className="pt-4">{contentNode}</CardContent>}
      </Card>
    );
  }

  return (
    <div className={cn('form-section', className)}>
      {headerNode}
      {contentNode}
    </div>
  );
};

export default FormSectionContainer;
