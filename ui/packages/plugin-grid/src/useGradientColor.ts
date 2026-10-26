/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo, useCallback } from 'react';

/** A single stop in a colour gradient. */
export interface GradientStop {
  /** Position between 0 and 1. */
  position: number;
  /** Tailwind background class applied at this stop (e.g. "bg-green-100"). */
  className: string;
}

export interface UseGradientColorOptions {
  /** The numeric field to evaluate on each row. */
  field: string;
  /** Flat data array used to derive min/max when not provided. */
  data: Record<string, any>[];
  /** Optional explicit minimum value. */
  min?: number;
  /** Optional explicit maximum value. */
  max?: number;
  /**
   * Ordered gradient stops (position 0 → 1).
   * When omitted a default green→yellow→red palette is used.
   */
  stops?: GradientStop[];
}

/** Default three-stop gradient: green → yellow → red. */
const DEFAULT_STOPS: GradientStop[] = [
  { position: 0, className: 'bg-green-100' },
  { position: 0.5, className: 'bg-yellow-100' },
  { position: 1, className: 'bg-red-100' },
];

/**
 * Derive min and max numeric values for `field` across `data`.
 */
function deriveRange(data: Record<string, any>[], field: string): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of data) {
    const v = Number(row[field]);
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [0, 0];
  return [lo, hi];
}

/**
 * Pick the closest gradient stop class for a normalised position (0‑1).
 */
function pickStopClass(t: number, stops: GradientStop[]): string {
  if (stops.length === 0) return '';
  if (stops.length === 1) return stops[0].className;

  let best = stops[0];
  let bestDist = Math.abs(t - best.position);

  for (let i = 1; i < stops.length; i++) {
    const dist = Math.abs(t - stops[i].position);
    if (dist < bestDist) {
      best = stops[i];
      bestDist = dist;
    }
  }
  return best.className;
}

/**
 * Hook that returns a row → Tailwind class resolver based on a numeric
 * field's value mapped onto a configurable colour gradient.
 *
 * @param options - gradient configuration
 * @returns `(row) => className | undefined`
 */
export function useGradientColor(options: UseGradientColorOptions) {
  const { field, data, min: minProp, max: maxProp, stops = DEFAULT_STOPS } = options;

  const [derivedMin, derivedMax] = useMemo(() => deriveRange(data, field), [data, field]);
  const min = minProp ?? derivedMin;
  const max = maxProp ?? derivedMax;

  return useCallback(
    (row: Record<string, any>): string | undefined => {
      const v = Number(row[field]);
      if (!Number.isFinite(v)) return undefined;
      if (max === min) return stops.length > 0 ? stops[0].className : undefined;

      const t = Math.max(0, Math.min(1, (v - min) / (max - min)));
      return pickStopClass(t, stops);
    },
    [field, min, max, stops],
  );
}
