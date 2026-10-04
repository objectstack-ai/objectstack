// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The EXPORT OPTIONS block, declared once (#8010, #21229): the format enum, the
 * retired-`'pdf'` prescription, and the strict five-member object.
 *
 * One block reaches one renderer — objectui's `ObjectGrid`, which reads
 * `exportOptions.formats`, `.maxRecords`, `.includeHeaders`, `.fileNamePrefix`
 * and `.streaming` — from two carriers:
 *
 * - a list view's `exportOptions` (`./view.zod.ts`), the union of this object
 *   and the legacy bare format array, which LIFTS to `{ formats }` at parse;
 * - an `object-grid` page component's `properties.exportOptions`
 *   (`./component.zod.ts`), which takes this object BY IDENTITY and not the
 *   union: the grid reads `.formats` and lifts nothing, so the legacy spelling
 *   does not spread to the page component (#21229, triage ruling). Until then
 *   that row was `z.unknown()`, and a bare array passed every door and was
 *   dropped for the csv/json default.
 *
 * A module of its own, and outside the `ui` barrel, so the two carriers share
 * one declaration without it becoming published API (the
 * `./analytics-carrier-filter.ts` precedent). It moved here verbatim from
 * `./view.zod.ts` when the page component became its second carrier, with one
 * addition: the object's own answer to a bare array (see
 * {@link LIST_VIEW_EXPORT_OPTIONS_ARRAY_FORM}). The list view's published JSON
 * Schema did not move with it.
 */

import { z } from 'zod';
import { closedObject, strictObjectError } from '../shared/strict-object';
import { VIEW_HISTORY } from './view-history';

// `'pdf'` retirement prescription (#8010). Declared with `//` on purpose — the
// hook-body precedent's placement note applies here too: build-docs takes a
// file's first JSDoc per exported symbol, and this constant needs no doc page.
export const LIST_VIEW_EXPORT_PDF_RETIRED =
  "'pdf' was removed from `view.exportOptions` formats in @objectstack/spec 17.0.0 "
  + '(PDF export itself was declined as NOT PLANNED) — no renderer has ever produced a PDF '
  + 'export: ObjectGrid dropped the declared format from the export menu with only a runtime '
  + "console.warn, so authoring it was a parse-clean no-op. Delete the value; the surviving "
  + "formats are 'csv', 'xlsx' and 'json'. "
  + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';

/**
 * Export formats the platform actually delivers (#8010): `csv`/`json` on both
 * export paths, `xlsx` on the server stream only.
 *
 * `'pdf'` was REMOVED in 17 (#8010): PDF export was declined platform-side
 * (#1301 NOT_PLANNED), so the enum member was a declared-but-unrenderable
 * format whose only failure signal was a browser console line. This is an
 * enum-VALUE narrowing, so there is no `retiredKey()` tombstone to hang the
 * prescription on — the enum's own error map carries it
 * ({@link LIST_VIEW_EXPORT_PDF_RETIRED}), keyed on `issue.input` so that only
 * the value which used to be legal gets the "was removed" message (the
 * `HookBodyCapability` / `object.managedBy: 'system'` precedent).
 */
export const ListViewExportFormatSchema = z.enum(['csv', 'xlsx', 'json'], {
  error: (issue) => (issue.input === 'pdf' ? LIST_VIEW_EXPORT_PDF_RETIRED : undefined),
});

/**
 * [#21229] The object's own answer to a bare format array — the one
 * `invalid_type` the block names, carried on the object's error map because
 * that is the only map a type failure at this position consults (a map on an
 * enclosing row or wrapper is never reached, and an object-level refinement
 * never runs once a property has failed its type).
 *
 * Worded to be true on BOTH carriers, because both read this one declaration.
 * On an `object-grid` it is the whole refusal of `exportOptions: ['csv']`. On a
 * list view a bare array is the legacy spelling and the union's other arm
 * lifts it, so this text appears only nested under a union failure whose array
 * arm failed too — where naming the object form is still the right advice.
 */
const LIST_VIEW_EXPORT_OPTIONS_ARRAY_FORM =
  'Expected the export options object `{ formats?, maxRecords?, includeHeaders?, fileNamePrefix?, '
  + 'streaming? }`, received a bare array. Put the format list in `formats`: '
  + "`{ formats: ['csv', 'xlsx'] }`.";

const LIST_VIEW_EXPORT_OPTIONS_SHAPE = {
  formats: z.array(ListViewExportFormatSchema).optional()
    .describe("Formats offered in the export menu (default: ['csv', 'json']). XLSX is delivered by the server stream only."),
  maxRecords: z.number().int().nonnegative().optional()
    .describe('Maximum number of records to export; 0 or absent = unlimited'),
  includeHeaders: z.boolean().optional()
    .describe('Include column headers in the exported file (default true)'),
  fileNamePrefix: z.string().optional()
    .describe('Download file name prefix — replaces the object label and suppresses the view label in the generated file name'),
  streaming: z.boolean().optional()
    .describe('Set false to force the client-side export path (csv/json only) instead of the server stream'),
};

/**
 * The unknown-key map `strictObject()` would build for this block. Spelled out
 * rather than through `strictObject()` only so the array answer above can sit
 * in front of it; the surface, the history and the registered declaration are
 * the ones the block has always had.
 */
const exportOptionsUnknownKeyError = strictObjectError({
  surface: 'this export options block',
  history: VIEW_HISTORY,
}, LIST_VIEW_EXPORT_OPTIONS_SHAPE);

/**
 * Object form of `view.exportOptions` (#8010, maintainer ruling 2026-08-12 —
 * option A). The declared key set is exactly what the only renderer reads,
 * measured on objectui `origin/main@878140b` (`ObjectGrid.tsx:1596–1642`):
 * `formats`, `maxRecords`, `includeHeaders`, `fileNamePrefix`, and the
 * previously UNDECLARED `streaming` opt-out — declared here so no
 * undeclared-but-read key survives the fix. Declaring anything more would be
 * capability surface with no reader; declaring less recreates the defect.
 *
 * [#21229] Also `ComponentPropsMap['object-grid'].exportOptions`, by identity.
 * Closed exactly as `strictObject()` closes a shape; the `prime` handle is
 * forwarded so the unknown-key map is still built on the refusal path
 * (`closedObject`'s contract, #19581).
 */
export const ListViewExportOptionsSchema = closedObject(z.object(LIST_VIEW_EXPORT_OPTIONS_SHAPE, {
  error: Object.assign(
    (issue: Parameters<z.core.$ZodErrorMap>[0]) => (
      issue.code === 'invalid_type' && Array.isArray(issue.input)
        ? LIST_VIEW_EXPORT_OPTIONS_ARRAY_FORM
        : exportOptionsUnknownKeyError(issue)
    ),
    { prime: () => (exportOptionsUnknownKeyError as { prime?: () => void }).prime?.() },
  ),
}).strict());
