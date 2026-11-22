/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** The computed styles a mirror copies so its text wraps where the textarea's does. */
const MIRRORED_PROPERTIES = [
  'boxSizing',
  'width',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontSizeAdjust',
  'lineHeight',
  'fontFamily',
  'textAlign',
  'textTransform',
  'textIndent',
  'letterSpacing',
  'wordSpacing',
  'tabSize',
] as const;

export interface CaretCoordinates {
  /** Top of the caret's line, from the textarea's top border edge, before scrolling. */
  top: number;
  /** Left of the caret, from the textarea's left border edge, before scrolling. */
  left: number;
  /** The caret line's height in px. */
  height: number;
}

/**
 * Where the caret at `position` sits inside a textarea (objectstack#36070,
 * the mention menu that opens at the caret): a hidden mirror `div` takes the
 * textarea's box and font, holds the text up to `position`, and a marker span
 * after it reports the offset. The textarea's own scroll is NOT subtracted;
 * the caller does that with `scrollTop` / `scrollLeft`.
 *
 * Returns `null` where layout cannot be measured (no `window`, or a DOM such
 * as jsdom that lays nothing out): the caller keeps its fallback placement.
 */
export function getTextareaCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretCoordinates | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const style = mirror.style;
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.top = '0';
  style.left = '-9999px';
  style.whiteSpace = 'pre-wrap';
  style.overflowWrap = 'break-word';
  style.overflow = 'hidden';
  for (const prop of MIRRORED_PROPERTIES) {
    style[prop] = computed[prop];
  }
  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement('span');
  // A character, so the span has a line box even at the end of a line.
  marker.textContent = textarea.value.slice(position) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  try {
    const lineHeight = parseFloat(computed.lineHeight);
    const height = Number.isFinite(lineHeight) ? lineHeight : marker.offsetHeight;
    if (!height) return null;
    return {
      top: marker.offsetTop + parseFloat(computed.borderTopWidth || '0'),
      left: marker.offsetLeft + parseFloat(computed.borderLeftWidth || '0'),
      height,
    };
  } finally {
    document.body.removeChild(mirror);
  }
}
