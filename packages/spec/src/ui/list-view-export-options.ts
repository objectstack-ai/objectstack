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
 *
 * [#26548] A report's export block lives here too, at the end of the module:
 * {@link ReportExportOptionsSchema}, three of these five members under the
 * same key name, so a report and a list share one export vocabulary rather
 * than two. It is a sibling, not a third carrier of the object above — a
 * report table is not a record grid, and the members it leaves out are the
 * record-stream ones.
 */

import { z } from 'zod';
import { closedObject, strictObjectError } from '../shared/strict-object';
import { VIEW_HISTORY } from './view-history';

// `'pdf'` retirement prescription (#8010). Declared with `//` on purpose — the
// hook-body precedent's placement note applies here too: build-docs takes a
// file's first JSDoc per exported symbol, and this constant needs no doc page.
//
// [#22158] Re-worded under the ruling of record on #8346 (6051470224, letter
// B′, maintainer 「8346 B′」 2026-10-08): the 17.0 retirement STANDS — list
// export does not regain `'pdf'` — but the sentence it carried, "PDF export
// itself was declined as NOT PLANNED", stopped being true when the maintainer
// re-planned PDF documents for v18 (2026-08-13). A printable document is now a
// page with a `print` declaration, so the prescription points there instead,
// and at the view's own `allowPrinting` for printing a list as shown.
export const LIST_VIEW_EXPORT_PDF_RETIRED =
  "'pdf' was removed from `view.exportOptions` formats in @objectstack/spec 17.0.0 — no "
  + 'renderer has ever produced a PDF export: ObjectGrid dropped the declared format from the '
  + 'export menu with only a runtime console.warn, so authoring it was a parse-clean no-op. '
  + "Delete the value; the surviving formats are 'csv', 'xlsx' and 'json'. A list export does "
  + "not produce documents: to let users print a list as shown, set the view's `allowPrinting`; "
  + 'a printable document (an invoice, a delivery order, a letter) is a page that declares '
  + '`print` — its paper, margins and running header and footer — with its blocks in `regions`. '
  + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/**
 * Export formats the platform actually delivers (#8010): `csv`/`json` on both
 * export paths, `xlsx` on the server stream only.
 *
 * `'pdf'` was REMOVED in 17 (#8010): PDF export was then declined
 * platform-side (#1301 NOT_PLANNED), so the enum member was a
 * declared-but-unrenderable format whose only failure signal was a browser
 * console line. The removal stands under the 2026-10-08 ruling on #8346 (B′),
 * which re-planned PDF documents as print PAGES rather than as a list-export
 * format, and the prescription now points there (#22158). This is an
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
 * measured on objectui (read points recorded in `liveness/view.json`, row
 * `list.exportOptions`): `formats`, `maxRecords`, `includeHeaders`, `fileNamePrefix`, and the
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

// ── The report's export block (#26548) ──────────────────────────────────────

/**
 * The formats a REPORT table exports: the list's enum narrowed to `csv` and
 * `xlsx` (ruling 6408567749 on #25873, letter B). A report's rows are
 * aggregates, not records, so `'json'` — the list's record format — is not
 * offered, and a report never had `'pdf'`. The refusal names the two report
 * formats rather than replaying the list's `'pdf'` retirement, whose sentence
 * ("the surviving formats are 'csv', 'xlsx' and 'json'", a view's
 * `allowPrinting`) is true of a list and not of a report. Every other value
 * keeps zod's own enum message, which already lists the two members.
 */
const ReportExportFormatSchema = ListViewExportFormatSchema.exclude(['json'], {
  error: (issue) => {
    if (issue.input === 'json') {
      return "a report exports its table as 'csv' or 'xlsx'. 'json' is a list export's record format, "
        + "and a report's rows are aggregates with no record shape to write. Use 'csv' or 'xlsx'.";
    }
    if (issue.input === 'pdf') {
      return "a report exports its table as 'csv' or 'xlsx' — there is no PDF export of a report. "
        + 'A printable document is a page that declares `print`, with its blocks in `regions`.';
    }
    return undefined;
  },
});

/**
 * The record-stream members of the list block that a report does not carry:
 * a report's rows are already aggregated, and bounded by what it selects.
 */
const REPORT_EXPORT_RECORD_STREAM_MEMBER =
  'is a list export\'s record-stream member, and a report has none: its rows are already aggregated '
  + 'and bounded by what the report selects, and its file is written from the table as drawn. Delete it.';

const REPORT_EXPORT_OPTIONS_ARRAY_FORM =
  'Expected the report export options object `{ formats?, includeHeaders?, fileNamePrefix? }`, '
  + "received a bare array. Put the format list in `formats`: `{ formats: ['csv', 'xlsx'] }`.";

/**
 * Three of the list block's five members, and the list's key name — no second
 * export vocabulary. `includeHeaders` is the list's member BY IDENTITY;
 * `fileNamePrefix` is the list's member re-described, because the list's
 * sentence names an object label and a view label a report has neither of.
 * `formats` narrows the list's enum (see {@link ReportExportFormatSchema}).
 */
const REPORT_EXPORT_OPTIONS_SHAPE = {
  formats: z.array(ReportExportFormatSchema).optional()
    .describe("Formats the report's export control offers (default: ['csv', 'xlsx']); an empty list turns the control off"),
  includeHeaders: LIST_VIEW_EXPORT_OPTIONS_SHAPE.includeHeaders,
  fileNamePrefix: LIST_VIEW_EXPORT_OPTIONS_SHAPE.fileNamePrefix
    .describe('Download file name prefix — replaces the report label in the generated file name'),
};

const reportExportOptionsUnknownKeyError = strictObjectError({
  surface: 'this report export options block',
  history: 'Declared closed from its first day: an unrecognized key is refused, never dropped.',
  guidance: {
    maxRecords: `\`maxRecords\` ${REPORT_EXPORT_RECORD_STREAM_MEMBER}`,
    streaming: `\`streaming\` ${REPORT_EXPORT_RECORD_STREAM_MEMBER}`,
  },
}, REPORT_EXPORT_OPTIONS_SHAPE);

/**
 * `ReportSchema.exportOptions` (#26548): what a report's export control
 * offers. Who may use it is not declared here — the report TSDoc states the
 * `ObjectPermission.allowExport` axis it is gated on.
 *
 * Deliberately NOT the list's union: there is no legacy bare-array spelling
 * to lift on a report, and a union collapses its curated messages into one
 * bare `Invalid input` (#5014). A bare array is answered by name instead.
 * Closed exactly as {@link ListViewExportOptionsSchema} is, `prime` forwarded.
 */
export const ReportExportOptionsSchema = closedObject(z.object(REPORT_EXPORT_OPTIONS_SHAPE, {
  error: Object.assign(
    (issue: Parameters<z.core.$ZodErrorMap>[0]) => (
      issue.code === 'invalid_type' && Array.isArray(issue.input)
        ? REPORT_EXPORT_OPTIONS_ARRAY_FORM
        : reportExportOptionsUnknownKeyError(issue)
    ),
    { prime: () => (reportExportOptionsUnknownKeyError as { prime?: () => void }).prime?.() },
  ),
}).strict());
