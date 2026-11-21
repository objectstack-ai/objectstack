import React from 'react';
import { cn } from '@object-ui/components';

/**
 * The typed-input face of a list cell's editor (objectstack#35688, #36023):
 * the cell itself turns into the input.
 *
 * - One row tall (the editor layer's anchor height, less the layer's 2px
 *   frame), square, with no border, fill or shadow of its own; the layer's
 *   frame is the only line around it. Text and inset match the cell's text.
 * - As wide as the cell, and wider as the text grows: an invisible copy of the
 *   text sizes the box and the input lies over it, so the layer (which is
 *   `w-max`) widens to the right over the next cells and never moves them.
 * - `data-in-cell-face="input"` on the root is what the layer reads to drop its
 *   own padding, radius and shadow; `data-in-cell-input` keeps the layer's
 *   form-density height off this input.
 *
 * Not on the package entry: the typed widgets draw it when `inCell` is set.
 */
export const InCellTextInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value'> & {
    value: string | number | null | undefined;
    /** `end` for numbers, so digits line up as they do in the cell. */
    align?: 'start' | 'end';
    /** Drawn before the text, muted (a currency code). */
    leading?: React.ReactNode;
    /** Drawn after the text, muted (a percent sign). */
    trailing?: React.ReactNode;
    /** Drawn under the row, inside the layer (a refusal message). */
    below?: React.ReactNode;
  }
>(function InCellTextInput({ value, align = 'start', leading, trailing, below, className, placeholder, ...inputProps }, ref) {
  const text = value == null ? '' : String(value);
  return (
    <div data-in-cell-face="input" className="flex flex-col">
      <div className="flex h-[calc(var(--radix-popper-anchor-height,2rem)-4px)] items-center gap-1 px-2.5 text-[13px]">
        {leading != null && <span className="shrink-0 text-muted-foreground tabular-nums">{leading}</span>}
        <span className="relative min-w-0 flex-1 overflow-hidden">
          {/* Sizes the box: the text (or the placeholder) plus room for the caret. */}
          <span aria-hidden="true" className={cn('invisible block whitespace-pre pr-1', align === 'end' && 'tabular-nums')}>
            {text || placeholder || ' '}
          </span>
          <input
            ref={ref}
            {...inputProps}
            data-in-cell-input=""
            value={text}
            placeholder={placeholder}
            className={cn(
              'absolute inset-0 h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13px] text-foreground shadow-none outline-none',
              'placeholder:text-muted-foreground',
              // A number box shows no spinner: the value is typed, as in the cell.
              '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
              align === 'end' && 'text-right tabular-nums',
              className,
            )}
          />
        </span>
        {trailing != null && <span className="shrink-0 text-muted-foreground">{trailing}</span>}
      </div>
      {below}
    </div>
  );
});
