/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * dataset-pivot — the lookup-key encoders every cross-tab over a semantic-layer
 * `queryDataset` result shares (ADR-0021).
 *
 * A pivot keys three lookups off dimension-value tuples: the DOWN bucket, the
 * ACROSS bucket, and the cell where the two meet. Every one of them used to be
 * spelled by concatenating values with a character the data was ASSUMED never
 * to contain — an empty string, a plain space, U+0001 — and each assumption
 * failed on ordinary data: `"x"` + `"yz"` and `"xy"` + `"z"` are one id under an
 * empty join, and `"New"` × `"York Q1"` and `"New York"` × `"Q1"` are one cell
 * key under a space join. The later row silently overwrote the earlier one, so
 * the cell showed a different row's measure, the overwritten row's value was
 * unreachable, and drill-through followed the same wrong index into the wrong
 * records — all without an error (objectstack#5473, objectstack#5665).
 *
 * `JSON.stringify` carries the boundary in its own quoting rather than in a
 * character the values must avoid, so these are unambiguous for ANY value a
 * dimension can hold. The ids are opaque lookup keys, never displayed — visible
 * text comes from the separately-formatted labels.
 *
 * Both encoders live here, in `@object-ui/core`, because the same pivot is
 * rendered by two packages (`plugin-dashboard`'s `DatasetWidget` and
 * `plugin-report`'s `DatasetReportRenderer`). Each having written its own is
 * exactly why both carried the defect and why fixing one left the other broken.
 * The same rule applies WITHIN a renderer: the cell index and the subtotal
 * lookups key the same buckets, so they must all call these — a second
 * hand-rolled encoding of the same id agrees with the first only for the
 * dimension counts someone happened to test, which is what kept the original
 * bug invisible.
 *
 * Pure (no React / i18n), like its `dataset-format` neighbour.
 *
 * The empty-value encoding closed the last instance of the same assumption
 * (objectui#4056): callers used to spell a null/undefined dimension value as
 * the STRING `'∅'` before encoding it, so a row whose value literally IS that
 * character shared a bucket with a row whose value is absent — the placeholder
 * reintroduced, one level up, exactly the "no value contains this character"
 * assumption the encoder below had just removed. An empty value is now JSON
 * `null`, which `JSON.stringify` renders as a bare `null` no string can spell,
 * and `pivotDimensionValue` owns that normalization so no caller has to hold a
 * placeholder literal of its own.
 */

/**
 * Normalize ONE raw dimension value for `pivotBucketId`: an absent value (null
 * or undefined) becomes JSON `null`, everything else its string form.
 *
 * This lives here rather than at each call site because a placeholder spelled
 * by the caller is a placeholder that can collide: `String(v ?? '∅')` put an
 * ordinary string into the tuple, so `null` and the character `'∅'` encoded
 * identically (objectui#4056). `null` is not a string, so nothing a dimension
 * can hold encodes to it — the same reason the tuple is JSON rather than a
 * delimiter join.
 */
export const pivotDimensionValue = (value: unknown): string | null =>
  value == null ? null : String(value);

/**
 * Encode a pivot BUCKET id from its dimension values, each already normalized
 * by `pivotDimensionValue` (empty ⇒ `null`).
 *
 * Axis-neutral on purpose: a DOWN bucket and an ACROSS bucket are the same kind
 * of thing (a dimension-value tuple), and a cross-tab with multiple across
 * dimensions collides on that axis just as readily as on the down axis. That
 * holds for a SINGLE-value across bucket too — a bare value is a one-element
 * tuple, and spelling it as the raw string instead is what left the dashboard's
 * column ids on a second, colliding encoding after the row ids were fixed.
 */
export const pivotBucketId = (dimensionValues: Array<string | null>): string =>
  JSON.stringify(dimensionValues);

/**
 * Encode the cell key for a (down bucket, across bucket) pair — the key of the
 * map a renderer reads to place a measure and to resolve a drill-through.
 */
export const pivotCellKey = (rowId: string, colId: string): string => JSON.stringify([rowId, colId]);
