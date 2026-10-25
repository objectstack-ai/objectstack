// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every `content/docs/components/**` page that documents a schema INHERITING
 * `disabled` spells it the way `BaseSchema` declares it (objectui#7239, the
 * docs half of the objectui#7087 ruling of 2026-09-01) — `boolean | string`
 * then, `boolean | string | { dialect?: string; source: string }` since
 * objectui#7530 declared the CEL envelope on all three predicate keys (ruled
 * 2026-09-04) — the same flat spelling `button-group-doc-surface-6347.test.ts`
 * reads off the mirror, and the one that is valid TypeScript inside a `ts`
 * fence (`box.mdx`), so every page carries one spelling whatever its fence.
 *
 * ## Why a pin rather than "the docs gates went green"
 *
 * No gate can see this drift. These pages declare their own illustrative
 * `interface` blocks (objectui#6143): `check-doc-component-types` reads only the
 * `type` STRING LITERALS out of docs code blocks, and `check-doc-snippet-types`
 * compiles `ts`/`tsx` fences — a `plaintext` fence is not one. So a member row
 * in those fences may name any type at all and every gate stays green. That is
 * the same hole `button-group-doc-surface-6347.test.ts` records one page over,
 * and it is why the correction this file accompanies could not be verified by
 * running CI.
 *
 * ## The defect this pins shut
 *
 * objectui#7087 removed 18 `disabled?: boolean` narrowings from the concrete
 * schemas, so the member is now inherited from `BaseSchema` as
 * `boolean | string` — a boolean, or a predicate expression on the same
 * evaluated path as `visible`. 13 component pages went on spelling the removed
 * narrowing, teaching a type the shipped tree no longer has. A reader copying
 * those rows would conclude `disabled: "${data.status === 'locked'}"` is
 * invalid, which is exactly the capability the ruling restored.
 *
 * ## What this file asserts, and why in this shape
 *
 *   1. INHERITED (14 rows) — the page's `disabled` row reads `boolean | string`,
 *      AND the shipped interface of the same name still extends `BaseSchema`
 *      without redeclaring `disabled`. The second half is what keeps this pin
 *      honest in the other direction: if someone re-narrows the type, the pin
 *      goes red pointing at `packages/types`, not at the page — the page would
 *      then be the thing that is right. A doc-only assertion could not tell
 *      those two worlds apart.
 *   2. INDEPENDENT (8 rows) — the item/option shapes that declare their own
 *      `disabled?: boolean` and do NOT extend `BaseSchema` still read exactly
 *      `boolean`. This is the blanket-replace control: a sweep that rewrote
 *      every `disabled?: boolean` under `content/docs/components` turns these
 *      red, and nothing else in the repo would have caught it.
 *   3. COMPLETENESS — the two tables together account for EVERY `disabled?:`
 *      row under `content/docs/components`, by measurement rather than by the
 *      counts being restated. A new page carrying the stale spelling fails here
 *      instead of sitting unclassified, which is the failure mode a
 *      hand-enumerated pin has by construction.
 *
 * ## Boundary, stated rather than implied
 *
 * The three overlay menu-item rows are doc-local names with NO shipped
 * counterpart (`ContextMenuCommandItem` / `DropdownMenuCommandItem` /
 * `MenubarCommandItem` against a shipped `MenuCommandItem`), so only their doc
 * text is asserted; that is recorded here so a later reader does not mistake
 * the missing shipped half for an oversight. `ButtonGroupSchema` is listed
 * INHERITED although objectui#6347 had already corrected its page — it is the
 * spelling all 13 others converged on, and pinning it here keeps the model row
 * from drifting away from the rows that copy it.
 *
 * ## Predictions, written before the first run (red-first)
 *
 * With the 13 corrected pages reverted to their `origin/main` @ `ebc05b4d6`
 * blobs and this file in place:
 *
 *   - the 13 INHERITED cases fail, each naming its own page and the type text
 *     it actually found (`boolean`);
 *   - the `ButtonGroupSchema` INHERITED case stays green (objectui#6347 fixed
 *     that page earlier, so it is untouched by the revert);
 *   - all 8 INDEPENDENT cases stay green — the revert does not touch them;
 *   - COMPLETENESS stays green: reverting changes the type text of a row, not
 *     which rows exist.
 *
 * That last pair is the point of the control: a failure that reddened the
 * independent rows too would mean the sweep was indiscriminate, not that the
 * inherited rows were wrong.
 *
 * ## Amendments
 *
 * The population is a ledger, not a constant: it moves when a page gains or
 * loses a real `disabled` row. Each move is recorded here with its cause, so a
 * later reader can tell a deliberate claim from a number someone bumped to get
 * back to green.
 *
 *   - **22 -> 23 rows, INDEPENDENT 8 -> 9 (objectui#7687).** `ComboboxOption`
 *     joins the independent table. Its `disabled` was always DECLARED by
 *     `packages/types/src/form.ts` and validated by `ComboboxOptionSchema`, but
 *     the combobox component never read it, so an option authored
 *     `disabled: true` rendered selectable; #7687 makes the component honour it
 *     and documents the member on `form/combobox.mdx`, which is the row this
 *     census then measured. It classifies INDEPENDENT on this file's own
 *     criterion, not by resemblance to its neighbours: the shipped
 *     `ComboboxOption` declares `disabled` itself and does NOT extend
 *     `BaseSchema`, so the narrow `boolean` is the correct spelling and the
 *     second INDEPENDENT assertion holds for it unchanged.
 *
 *     ⚠️ Note for the class, since the #7687 card recorded the opposite: that
 *     page's `interface` block sits in a `plaintext` fence and the card
 *     concluded no CI gate could see it. True of the doc-type gates named
 *     above, and false overall — THIS census reads those `.mdx` files as text
 *     and caught the new row. A doc edit under `content/docs/components` that
 *     touches a `disabled` row is answerable to `packages/types`, so a run
 *     narrowed to the package the code fix lives in cannot see it.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const DOC_DIR = join(REPO_ROOT, 'content', 'docs', 'components');
const TYPES_DIR = join(REPO_ROOT, 'packages', 'types', 'src');

const DECL_RE = /^\s*(?:export\s+)?(?:interface|type)\s+([A-Za-z0-9_]+)/;
// Up to the `;` that ENDS the row: the inline object type carries its own `;`
// between members (`{ dialect?: string; source: string }`, objectui#7530).
const DISABLED_RE = /^\s*disabled\?:\s*(.+?);(?=\s*(?:\/\/.*)?$)/;

/** Every `disabled?:` row under `content/docs/components`, with its owner. */
interface DocRow {
  readonly page: string;
  readonly iface: string;
  readonly line: number;
  readonly type: string;
}

function mdxPages(): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.name.endsWith('.mdx')) out.push(rel);
    }
  };
  walk(DOC_DIR, '');
  return out;
}

function docRows(): DocRow[] {
  const rows: DocRow[] = [];
  for (const page of mdxPages()) {
    const lines = readFileSync(join(DOC_DIR, page), 'utf8').split('\n');
    lines.forEach((raw, idx) => {
      const hit = DISABLED_RE.exec(raw);
      if (!hit) return;
      let iface = '(unattributed)';
      for (let i = idx - 1; i >= 0; i -= 1) {
        const decl = DECL_RE.exec(lines[i]);
        if (decl) {
          iface = decl[1];
          break;
        }
      }
      rows.push({ page, iface, line: idx + 1, type: hit[1].trim() });
    });
  }
  return rows;
}

/** The shipped interface of that name, if `packages/types/src` declares one. */
function shipped(name: string): { extendsBase: boolean; declaresDisabled: boolean } | null {
  for (const file of readdirSync(TYPES_DIR).filter((f) => f.endsWith('.ts')).sort()) {
    const lines = readFileSync(join(TYPES_DIR, file), 'utf8').split('\n');
    const head = lines.findIndex((l) =>
      new RegExp(`^\\s*(?:export\\s+)?interface\\s+${name}\\b`).test(l),
    );
    if (head === -1) continue;
    let declaresDisabled = false;
    for (let i = head + 1; i < lines.length; i += 1) {
      if (/^\}/.test(lines[i])) break;
      if (DISABLED_RE.test(lines[i])) declaresDisabled = true;
    }
    return { extendsBase: /\bextends\s+BaseSchema\b/.test(lines[head]), declaresDisabled };
  }
  return null;
}

const ROWS = docRows();
const rowFor = (page: string, iface: string): DocRow | undefined =>
  ROWS.find((r) => r.page === page && r.iface === iface);

/** Schemas that INHERIT `disabled` from `BaseSchema` — the page must be wide. */
const INHERITED = [
  { page: 'basic/button-group.mdx', iface: 'ButtonGroupSchema' },
  { page: 'disclosure/toggle-group.mdx', iface: 'ToggleGroupSchema' },
  { page: 'form/button.mdx', iface: 'ButtonSchema' },
  { page: 'form/calendar.mdx', iface: 'CalendarSchema' },
  { page: 'form/checkbox.mdx', iface: 'CheckboxSchema' },
  { page: 'form/combobox.mdx', iface: 'ComboboxSchema' },
  { page: 'form/date-picker.mdx', iface: 'DatePickerSchema' },
  { page: 'form/file-upload.mdx', iface: 'FileUploadSchema' },
  { page: 'form/input-otp.mdx', iface: 'InputOTPSchema' },
  { page: 'form/input.mdx', iface: 'InputSchema' },
  { page: 'form/radio-group.mdx', iface: 'RadioGroupSchema' },
  { page: 'form/select.mdx', iface: 'SelectSchema' },
  { page: 'form/switch.mdx', iface: 'SwitchSchema' },
  { page: 'form/textarea.mdx', iface: 'TextareaSchema' },
] as const;

/** Independent item/option shapes — they declare `disabled` and stay narrow. */
const INDEPENDENT = [
  { page: 'basic/button-group.mdx', iface: 'ButtonGroupButton', shippedName: 'ButtonGroupButton' },
  { page: 'disclosure/accordion.mdx', iface: 'AccordionItem', shippedName: 'AccordionItem' },
  { page: 'disclosure/toggle-group.mdx', iface: 'ToggleGroupItem', shippedName: 'ToggleGroupItem' },
  // Added by objectui#7687, which made the member real — see `## Amendments`.
  { page: 'form/combobox.mdx', iface: 'ComboboxOption', shippedName: 'ComboboxOption' },
  { page: 'form/form.mdx', iface: 'FormField', shippedName: 'FormField' },
  { page: 'form/radio-group.mdx', iface: 'RadioOption', shippedName: 'RadioOption' },
  // Doc-local names; the shipped shape they illustrate is `MenuCommandItem`.
  { page: 'overlay/context-menu.mdx', iface: 'ContextMenuCommandItem', shippedName: null },
  { page: 'overlay/dropdown-menu.mdx', iface: 'DropdownMenuCommandItem', shippedName: null },
  { page: 'overlay/menubar.mdx', iface: 'MenubarCommandItem', shippedName: null },
] as const;

describe('component pages spell the INHERITED `disabled` as the base union (objectui#7239, widened by objectui#7530)', () => {
  it.each(INHERITED)('$page documents $iface with the inherited union', ({ page, iface }) => {
    const row = rowFor(page, iface);
    expect(row, `no \`disabled?:\` row attributed to ${iface} in ${page}`).toBeDefined();
    expect(`${page} ${iface} -> ${row?.type}`).toBe(`${page} ${iface} -> boolean | string | { dialect?: string; source: string }`);
  });

  it.each(INHERITED)('$iface still inherits `disabled` in the shipped tree', ({ iface }) => {
    const decl = shipped(iface);
    expect(decl, `packages/types/src declares no interface ${iface}`).not.toBeNull();
    // Re-narrowing the type would make the PAGE right and this pin's premise
    // wrong; it must fail here rather than silently keep asserting the union.
    expect({ iface, ...decl }).toEqual({ iface, extendsBase: true, declaresDisabled: false });
  });
});

describe('independent shapes stay `boolean` — the blanket-replace control (objectui#7239)', () => {
  it.each(INDEPENDENT)('$page documents $iface as a plain boolean', ({ page, iface }) => {
    const row = rowFor(page, iface);
    expect(row, `no \`disabled?:\` row attributed to ${iface} in ${page}`).toBeDefined();
    expect(`${page} ${iface} -> ${row?.type}`).toBe(`${page} ${iface} -> boolean`);
  });

  it.each(INDEPENDENT.filter((e) => e.shippedName !== null))(
    '$iface declares its own `disabled` and does not extend BaseSchema',
    ({ shippedName }) => {
      const decl = shipped(shippedName as string);
      expect(decl, `packages/types/src declares no interface ${shippedName}`).not.toBeNull();
      expect({ name: shippedName, ...decl }).toEqual({
        name: shippedName,
        extendsBase: false,
        declaresDisabled: true,
      });
    },
  );
});

describe('the two tables account for every documented `disabled` row (objectui#7239)', () => {
  it('classifies every `disabled?:` row under content/docs/components', () => {
    const claimed = new Set(
      [...INHERITED, ...INDEPENDENT].map((e) => `${e.page}#${e.iface}`),
    );
    const measured = ROWS.map((r) => `${r.page}#${r.iface}`);
    // Reported as sorted arrays so a failure names the stray row, not a count.
    expect(measured.filter((k) => !claimed.has(k)).sort()).toEqual([]);
    expect([...claimed].filter((k) => !measured.includes(k)).sort()).toEqual([]);
  });

  it('finds no unattributed row (the walk-back parser reached a declaration)', () => {
    expect(ROWS.filter((r) => r.iface === '(unattributed)')).toEqual([]);
  });

  it('sees exactly the population this card measured', () => {
    expect({ rows: ROWS.length, inherited: INHERITED.length, independent: INDEPENDENT.length }).toEqual(
      { rows: 23, inherited: 14, independent: 9 },
    );
  });
});
