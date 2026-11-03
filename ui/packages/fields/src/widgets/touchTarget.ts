/**
 * Phone-width touch-target floor for a form control (WCAG 2.5.5, 44 px).
 *
 * The same token the form renderer's built-in controls carry: below `sm` a
 * control is at least 44 px tall, and from `sm` up it keeps the primitive's own
 * height. Internal to this package, so the published surface does not move.
 */
export const PHONE_TOUCH_HEIGHT = 'min-h-[44px] sm:min-h-0';

/** The same floor on both axes, for a square icon button beside or inside a control. */
export const PHONE_TOUCH_SQUARE = 'min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0';
