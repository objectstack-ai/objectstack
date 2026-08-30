// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one place PRODUCTION source in this package reaches `exceljs`.
 *
 * Two production paths load the module lazily — `parseXlsxToRows` (the whole
 * .xlsx **import** path, `import-prepare.ts`) and `createXlsxStream` (the
 * streaming .xlsx **export** path, `rest-server.ts`). Both used to bind it as
 * `const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'))`,
 * so every workbook, worksheet, row and cell downstream of that binding sat
 * outside the type system: a misspelled method, a wrong argument arity or a
 * property exceljs renamed was not a compile error, only a runtime fault in a
 * deployed import or export. Stating the binding once, here, and typing it is
 * what puts those two paths back inside tsc's reach.
 *
 * ## The lazy load is deliberate, and it is preserved
 *
 * `exceljs` is reached through `await import('exceljs')` ON PURPOSE, so CSV and
 * JSON imports/exports never pay to load it. Everything in this module is
 * either a TYPE (erased at emit) or lives inside the async accessor, so the
 * module stays out of both callers' static graph exactly as before.
 * ⛔ Do not convert this to a static import.
 *
 * ## The trade this file accepts, stated once because it is real
 *
 * Typing `await import('exceljs')` pulls exceljs's DECLARATIONS into production
 * modules that previously kept them out — including the module-local `Buffer`
 * shim the test layer already documents. `exceljs@4.4.0/index.d.ts` opens, at
 * line 1, with:
 *
 * ```ts
 * declare interface Buffer extends ArrayBuffer { }
 * ```
 *
 * That file carries 106 top-level `export` declarations, so it IS a module —
 * which makes this `Buffer` module-local, and it therefore SHADOWS Node's
 * global `Buffer` inside every exceljs signature, `Xlsx.load` (index.d.ts:1490)
 * included:
 *
 * ```ts
 * load(buffer: Buffer, options?: Partial<XlsxReadOptions>): Promise<Workbook>;
 * ```
 *
 * ⇒ there is no Node `Buffer` value that satisfies that parameter, so the
 * production import path inherits the same assertion problem the test layer
 * pays. The defect is in the published declaration, not at any call site.
 *
 * ⭐ That trade is accepted deliberately, and it is a trade DOWN. Before this
 * module the cost was *the whole path is unchecked*; after it the cost is *one
 * named assertion with its reason written next to it* —
 * {@link asXlsxLoadInput}, applied to the Node `Buffer` arm and to nothing
 * else. The first hides the problem; the second puts it where a reader can see
 * it, and where a future exceljs release can retire it in one edit.
 *
 * ## Runtime is untouched
 *
 * exceljs has always accepted the values these two paths hand it — that is what
 * the `any` bindings were doing, and passing. This module changes only what tsc
 * is told; it does not convert, copy or reshape any bytes.
 */

import type { Xlsx } from 'exceljs';

/**
 * exceljs's own types, re-exported so this stays the only production file in
 * the package that names the dependency.
 */
export type { Workbook, Worksheet, Row, CellValue } from 'exceljs';

/** The exceljs module namespace, as exceljs's own declarations describe it. */
export type ExcelJsModule = typeof import('exceljs');

/**
 * The parameter type `Xlsx.load` actually declares, read off the dependency's
 * own signature rather than spelled by hand. Naming it this way means that if
 * exceljs ever drops the shim, this alias resolves to Node's `Buffer` and
 * {@link asXlsxLoadInput} quietly becomes a no-op rather than a lie.
 */
export type XlsxLoadInput = Parameters<Xlsx['load']>[0];

/**
 * Assert ONE arm of `parseXlsxToRows`'s `Buffer | ArrayBuffer` parameter — the
 * Node `Buffer` one — into what `Xlsx.load` declares.
 *
 * ⛔ The parameter below is `Buffer`, NOT `Buffer | ArrayBuffer`, and that is the
 * whole point. `ArrayBuffer` is already assignable to exceljs's module-local
 * shim, so the `ArrayBuffer` arm must keep reaching `load` unasserted and stay
 * genuinely checked. A blanket assertion over the union would switch off type
 * checking that works today — patching a small hole with a bigger one.
 */
export function asXlsxLoadInput(bytes: Buffer): XlsxLoadInput {
    return bytes as unknown as XlsxLoadInput;
}

/**
 * Load `exceljs` lazily and hand back its namespace TYPED.
 *
 * The single binding site the two production paths share. `.default ??
 * namespace` is the CommonJS interop the callers already performed: exceljs is
 * a CJS package, so an ESM `import()` puts the real namespace on `.default`
 * while a bundled/transpiled consumer receives it directly. The expression is
 * awaited once instead of twice — the second `await import('exceljs')` in the
 * code this replaces resolved from the module cache to the identical record.
 */
export async function loadExcelJs(): Promise<ExcelJsModule> {
    const mod: ExcelJsModule & { default?: ExcelJsModule } = await import('exceljs');
    return mod.default ?? mod;
}
