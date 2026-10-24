/**
 * Open the browser's native picker (date / datetime-local / time) for an input.
 *
 * Native date/time inputs only open their picker when the user clicks the small
 * calendar/clock icon. Calling `showPicker()` on click makes the whole field
 * behave like other widgets — clicking anywhere in the box opens the picker.
 *
 * `showPicker()` can throw (unsupported browser, not user-activated, or the input
 * is disabled/hidden), so failures are swallowed and the native fallback stands.
 */
export function openNativePicker(input: HTMLInputElement): void {
  if (input.disabled || input.readOnly) return;
  try {
    (input as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    // Ignore — browsers throw when the picker can't be shown; the icon still works.
  }
}
