import React from 'react';
import { Star } from 'lucide-react';
import { cn } from '@object-ui/components';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { toHostGroupProps } from './toHostGroupProps.js';

/**
 * Rating field widget - provides a star rating input
 * Supports numeric values from 0 to max (default 5)
 */
export function RatingField({ value, onChange, field, readonly, className, error, ...props }: FieldWidgetComponentProps<number>) {
  // Get rating-specific configuration from field metadata
  const ratingField = field as any;
  const max = ratingField?.max ?? 5;
  const currentValue = value ?? 0;

  const [hoverValue, setHoverValue] = React.useState<number | null>(null);

  const displayValue = hoverValue !== null ? hoverValue : currentValue;

  if (readonly) {
    // The readonly star row is the field's whole rendered surface, so it — not
    // only the editable row below — consumes the host's group label
    // (objectui#3990) and its help text (objectui#4005). There is no star
    // BUTTON left in this row to announce the description on. See
    // `toHostGroupProps`.
    return (
      <div
        {...toHostGroupProps(props, 'instead-of-the-inputs')}
        className={cn("flex items-center gap-1", className)}
      >
        {Array.from({ length: max }, (_, i) => (
          <Star
            key={i}
            className={`w-5 h-5 ${
              i < currentValue
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-muted-foreground'
            }`}
          />
        ))}
        <span className="ml-2 text-sm text-muted-foreground">
          {currentValue} / {max}
        </span>
      </div>
    );
  }

  // DOM pass-through (objectui#3318): the container carries the form
  // renderer's id / aria-describedby, but NOT its `aria-invalid` — a plain
  // wrapper div is not where assistive tech reads the invalid state. That
  // state goes onto every focusable star button below, computed from the
  // published `error` slot (#3222). `name` is withheld too: it is only
  // DOM-legal on form controls, and on this div it is exactly the leak
  // #3291 sweeps for.
  const {
    'aria-invalid': _hostAriaInvalid,
    name: _domName,
    ...groupDomProps
  } = toDomProps(props);
  // When the host named this container by IDREF (`aria-labelledby`,
  // objectui#3961) it IS the labelled group of stars, so it answers with the
  // matching role; a `label for` pointing at this `div` was inert. Standalone
  // (no host label) the markup is unchanged.
  const isLabelledGroup = groupDomProps['aria-labelledby'] != null;

  return (
    <div
      {...groupDomProps}
      role={isLabelledGroup ? 'group' : undefined}
      className={cn("flex items-center gap-1", className)}
    >
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i + 1)}
          onMouseEnter={() => setHoverValue(i + 1)}
          onMouseLeave={() => setHoverValue(null)}
          className="focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded"
          disabled={readonly || props.disabled}
          aria-invalid={!!error}
        >
          <Star
            className={`w-5 h-5 transition-colors ${
              i < displayValue
                ? 'fill-yellow-400 text-yellow-400 hover:fill-yellow-500 hover:text-yellow-500'
                : 'text-muted-foreground hover:text-yellow-400'
            }`}
          />
        </button>
      ))}
      <span className="ml-2 text-sm text-muted-foreground">
        {currentValue} / {max}
      </span>
    </div>
  );
}
