// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The one place this package asserts around `exceljs`'s broken `load` signature
 * (#13378). Test layer only — nothing in `src/index.ts` reaches it, so tsup
 * (entry: `src/index.ts`) never emits it into `dist` and it is not published.
 *
 * ## Why the assertion below is unavoidable, in the dependency's own bytes
 *
 * `exceljs@4.4.0/index.d.ts` opens, at line 1, with:
 *
 * ```ts
 * declare interface Buffer extends ArrayBuffer { }
 * ```
 *
 * That file carries 106 top-level `export` declarations, so it **is a module** —
 * which makes this `Buffer` module-local, and it therefore SHADOWS Node's global
 * `Buffer` inside every exceljs signature. The one that matters here is the
 * `Xlsx.load` at `index.d.ts:1490`:
 *
 * ```ts
 * load(buffer: Buffer, options?: Partial<XlsxReadOptions>): Promise<Workbook>;
 * ```
 *
 * ⇒ `Workbook.xlsx.load` does not ask for a Node `Buffer`. It asks for something
 * structurally identical to `ArrayBuffer`. A Node `Buffer` is a `Uint8Array`, so
 * it is not assignable, and tsc says so precisely:
 *
 * ```
 * src/rest.test.ts(1267,26): error TS2345: Argument of type 'Buffer<ArrayBuffer>' is not assignable to parameter of type 'Buffer'.
 *   The types of 'slice(...)[Symbol.toStringTag]' are incompatible between these types.
 *     Type '"Uint8Array"' is not assignable to type '"ArrayBuffer"'.
 * ```
 *
 * ⭐ There is NO Node `Buffer` value that satisfies that parameter. The defect is
 * in the published declaration, not at any call site — so this is not laziness,
 * and no amount of care at a call site can remove it. What a call site CAN do is
 * not restate it: before #13378 the package paid this at 6 anonymous `as any`s
 * and left a 7th site as a ledgered `TS2345`. Now it is stated once, here.
 *
 * ## Why option C (upgrade) is not the answer — measured 2026-08-30
 *
 * `exceljs` `dist-tags.latest` IS 4.4.0 (published 2023-10-19). The only publish
 * after it in the package's whole 166-version history is `4.4.1-prerelease.0`
 * (2024-12-20), and its `index.d.ts` carries the identical declaration at the
 * identical lines: shim at line 1, 106 exports, `load(buffer: Buffer, …)` at
 * 1490. The registry's `time.modified` is that same date. There is no later line
 * to pin to. (4.3.0 ships the shim too, so this is not a 4.4.0 regression that a
 * bump could undo.)
 *
 * ## Why not a declaration override (option B)
 *
 * The `Buffer` above is module-local, so it cannot be reached by interface
 * augmentation from outside; an override would have to redeclare the module,
 * replacing the package's entire typing surface. Far more surface than the one
 * assertion it would remove.
 *
 * ## Runtime is untouched
 *
 * exceljs's `load` has always accepted the Node `Buffer` these tests hand it —
 * that is what every one of those 6 `as any` sites was doing, and passing. This
 * helper changes only what tsc is told; it does not convert, copy or reshape the
 * bytes.
 */

import ExcelJS from 'exceljs';
import type { Workbook, Xlsx } from 'exceljs';

/**
 * The parameter type `Xlsx.load` actually declares, read off the dependency's
 * own signature instead of spelled by hand. Naming it this way means that if
 * exceljs ever drops the shim, this alias resolves to Node's `Buffer` and the
 * assertion below quietly becomes a no-op rather than a lie.
 */
type XlsxLoadInput = Parameters<Xlsx['load']>[0];

/**
 * Load .xlsx bytes into a fresh {@link Workbook}.
 *
 * The single site in this package where the exceljs declaration defect above is
 * asserted away. Callers pass the Node `Buffer` their fixture produced and get
 * back a workbook; no call site needs to know about any of this.
 */
export async function loadXlsxWorkbook(bytes: Buffer): Promise<Workbook> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as XlsxLoadInput);
    return wb;
}
