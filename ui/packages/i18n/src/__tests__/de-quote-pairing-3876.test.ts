/**
 * objectui#3876 — the `de` pack paired the German **opening** quote
 * `„` („, low-9) with an **ASCII straight quote** `"` (") as its
 * closer, so German users read a typewriter quote where the typography of the
 * rest of the pack (and of German orthography, DUDEN R11) puts `“` (“).
 *
 * ## Census taken at landing (main@2937bcf7d), not inherited
 *
 * The card said "20 values"; the triage re-scan on an earlier main said "22
 * mismatched pairs". **Both are right about different units** and this file
 * exists partly to stop that ambiguity from recurring:
 *
 *   - **20 keys** carried a mismatch, and
 *   - **22 mismatch occurrences** lived in them — `navigationSync.renamedPage`
 *     and `navigationSync.renamedDashboard` each quote *two* names in one
 *     sentence ("Seite „alt“ in „neu“ umbenannt"), so they contribute two each.
 *
 * Full-file counts, before → after: `„` 45 → 45, `“` 25 → 47,
 * `”` 2 → 2, `"` 28 → 6.
 *
 * ## Why the invariant is NOT `count(„) === count(“)`
 *
 * The card proposed that assertion. It was **false on the file objectui#3876
 * left behind** (45 vs 47) and would have sent the next reader hunting a bug
 * that isn't there. Two values in this pack were still untranslated English
 * prose and quoted in the *English* style — `“…”`:
 *
 *   - `grid.import.savedMappingHint`
 *   - `grid.import.savedMappingPreviewNote`
 *
 * Their two `“` were legitimate **openers**, not German closers, which was
 * the whole 45/47 gap. The durable form that survives both that fix and a later
 * translation of those two values is
 *
 *     count(“) === count(„) + count(”)
 *
 * — every German `„` is closed by a `“`, and every *extra* `“` is
 * an English opener answered by a `”`; re-introducing one mismatch breaks it
 * (46 !== 47). The scan below is the primary check; the identity is the cheap
 * arithmetic backstop that also notices a `„` closed by nothing at all.
 *
 * ## objectui#3920 translated those two values — the numbers moved as predicted
 *
 * This header used to say "Germanising those two values keeps it true
 * (47 === 47 + 0)". objectui#3920 did exactly that (the five
 * `grid.import` saved-mapping keys were English in seven packs, not just de),
 * so the census is now `„` 47, `“` 47, `”` 0, `"` 6 and the identity holds in
 * its degenerate-looking but still non-vacuous form: 47 openers, all paired,
 * zero English closers left in the pack. The three literal counts below were
 * updated with that change and the two keys are pinned by name in a dedicated
 * `it` below — because `rdqKeys === []` on its own would stop naming *which*
 * values used to be the surplus, and an assertion that passes because nothing
 * is produced is exactly the shape this suite exists to avoid.
 *
 * ## objectui#3919 took the last straight quotes out — the pin is now "zero"
 *
 * Three `approvalsInbox` values (`rejectOneTitle`, `inlineApproved`,
 * `inlineRejected`) quoted with ASCII on **both** sides. Being self-consistent,
 * they were a second defect shape that the pairing scan below structurally cannot
 * see: there is no `„` in them to scan forward from. This file recorded them as
 * an explicit three-key list while that finding waited its turn, and a German
 * approver meanwhile read two typographies on one screen — `„…“` on the approve
 * confirmation, `"…"` on the reject one and on both inline toasts.
 *
 * objectui#3919 germanised the three, which takes the census to `„` 50, `“` 50,
 * `”` 0, `"` **0** and lets that list become the strictly stronger invariant it
 * now is: **no value in the de pack holds a U+0022 at all**. Stronger because it
 * catches both defect shapes — one side of a mismatched pair and both sides of a
 * self-consistent ASCII pair — and it needs no per-key maintenance: a new value
 * arriving with a typewriter quote fails by key name without anyone editing a
 * list. The three counts below moved 47 → 50 with that change.
 *
 * ## Why the three i18n gates cannot see any of this
 *
 * `all-locales-key-parity` compares key sets and placeholder shapes,
 * `check-i18n-call-site-keys.mjs` only asks whether a key resolves, and
 * `check-i18n-en-drift.mjs` fires on **`en` value changes** — these values were
 * wrong from the day they landed, so no drift event ever existed. All three are
 * value-blind by design, which is why the invariant has to live in a test.
 */
import { describe, expect, it } from 'vitest';

import { builtInLocales } from '../locales/index';

// The four quote characters this file is about, each named next to its literal
// so a reader can tell them apart at a glance — U+201E and U+201C in particular
// are one pixel apart in most editor fonts, which is how the bug survived.
const OPEN = '„'; // „ U+201E German opening quote (low-9)
const CLOSE = '“'; // “ U+201C German closing quote
const RDQ = '”'; // ” U+201D English closing quote
const STRAIGHT = '"'; // " U+0022 ASCII straight quote
const QUOTEISH = [OPEN, CLOSE, RDQ, STRAIGHT];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** Every string leaf of a pack, as `[dotted.path, value]`. */
function flatten(pack: unknown, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(pack as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push([path, v]);
    else if (v && typeof v === 'object') out.push(...flatten(v, path));
  }
  return out;
}

const count = (s: string, ch: string) => [...s].filter((c) => c === ch).length;

/**
 * For every `„` in `value`, the first quote-ish character that follows it —
 * `null` when the opener is never closed. Deliberately a scanner and not a
 * `„.*"` regex: a greedy/lazy dot can hop over an intervening correct
 * closer and mis-attribute the pair.
 */
function closersOf(value: string): Array<string | null> {
  const out: Array<string | null> = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== OPEN) continue;
    let closer: string | null = null;
    for (let j = i + 1; j < value.length; j++) {
      if (QUOTEISH.includes(value[j])) {
        closer = value[j];
        break;
      }
    }
    out.push(closer);
  }
  return out;
}

const DE = flatten(builtInLocales.de);

/**
 * The 20 keys the fix touched, with the exact quoted span each must now carry.
 * Byte-exact on the span under test rather than on the whole sentence, so a
 * legitimate German copy edit does not have to fight this file — while any
 * change to the *quotes* still fails here by key name. Four whole values are
 * additionally pinned byte-for-byte below.
 */
const FIXED: Array<[string, string[]]> = [
  ['lookup.createNamed', ['„{{name}}“']],
  ['console.objectView.objectNotFoundDescription', ['„{{objectName}}“']],
  ['console.objectView.deleteViewConfirm', ['„{{name}}“']],
  ['console.objectView.viewTypeUnavailable', ['„{{field}}“']],
  ['console.objectView.ufShowAllRecords', ['„Alle Datensätze“']],
  ['home.gettingStarted.description', ['„Zuletzt geöffnet“']],
  ['search.resultsCount', ['„{{query}}“']],
  // objectui#11445 folded `search.resultsCountPlural` into the `resultsCount`
  // count family: the value objectui#3876 fixed, and this span, live in `_other`.
  ['search.resultsCount_other', ['„{{query}}“']],
  ['empty.objectNotFoundDescription', ['„{{name}}“']],
  ['empty.pageNotFoundDescription', ['„{{name}}“']],
  ['empty.dashboardNotFoundDescription', ['„{{name}}“']],
  ['empty.reportNotFoundDescription', ['„{{name}}“']],
  ['navigationSync.addedPage', ['„{{name}}“']],
  ['navigationSync.addedDashboard', ['„{{name}}“']],
  ['navigationSync.removedPage', ['„{{name}}“']],
  ['navigationSync.removedDashboard', ['„{{name}}“']],
  ['navigationSync.renamedPage', ['„{{oldName}}“', '„{{newName}}“']],
  ['navigationSync.renamedDashboard', ['„{{oldName}}“', '„{{newName}}“']],
  ['marketplace.install.localSuccess', ['„{{name}}“']],
  ['preview.empty.notReadyTitle', ['„{{app}}“']],
];

describe('objectui#3876 — de pack closes „ with “ and not with a straight quote', () => {
  it('pins the 20 fixed keys: 22 spans, each byte-exact, none holding a straight quote', () => {
    expect(FIXED).toHaveLength(20);
    expect(FIXED.reduce((n, [, spans]) => n + spans.length, 0)).toBe(22);

    for (const [key, spans] of FIXED) {
      const value = at(builtInLocales.de, key);
      // presence: a renamed or removed key must fail loudly here rather than
      // let `toContain` run against undefined and read as "nothing to check".
      expect(typeof value, `de ${key} missing`).toBe('string');
      const v = value as string;
      for (const span of spans) {
        expect(v.includes(span), `de ${key} lost the paired span ${span}`).toBe(true);
      }
      expect(count(v, OPEN), `de ${key} opener count`).toBe(spans.length);
      expect(count(v, CLOSE), `de ${key} closer count`).toBe(spans.length);
      expect(v.includes(STRAIGHT), `de ${key} still holds a straight quote`).toBe(false);
    }
  });

  it('pins the four values the issue showcased, whole and byte-for-byte', () => {
    // The sentences a German user actually reads on the empty states, the tab
    // toggle, the search header and the home hint.
    expect(at(builtInLocales.de, 'empty.pageNotFoundDescription')).toBe(
      'Die Seite „{{name}}“ wurde nicht gefunden. Sie wurde möglicherweise entfernt oder umbenannt.',
    );
    expect(at(builtInLocales.de, 'console.objectView.ufShowAllRecords')).toBe(
      'Registerkarte „Alle Datensätze“ anzeigen',
    );
    expect(at(builtInLocales.de, 'search.resultsCount')).toBe('{{count}} Ergebnis für „{{query}}“');
    expect(at(builtInLocales.de, 'home.gettingStarted.description')).toBe(
      'Markieren Sie eine App, um sie hier anzuheften und mit einem Klick darauf zuzugreifen. ' +
        'Alles, was Sie öffnen, wird automatisch unter „Zuletzt geöffnet“ angezeigt.',
    );
  });

  it('holds pack-wide: no „ in de is closed by anything but “ (the durable invariant)', () => {
    const offenders: string[] = [];
    let openers = 0;
    let paired = 0;
    for (const [key, value] of DE) {
      for (const closer of closersOf(value)) {
        openers++;
        if (closer === CLOSE) {
          paired++;
          continue;
        }
        const label =
          closer === null ? 'never closed' : `closed by U+${closer.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;
        offenders.push(`${key}: „ ${label} — ${JSON.stringify(value)}`);
      }
    }

    // Anti-vacuous presence guard: a broken import, an emptied pack or a
    // renamed file would otherwise scan nothing and pass. Measured at landing:
    // 2914 string values, 45 openers, all 45 correctly paired; after
    // objectui#3920 translated the two English `grid.import` sentences, 47
    // openers, all 47 correctly paired.
    expect(DE.length, 'de pack looks empty — the scan would be vacuous').toBeGreaterThan(2000);
    expect(openers, 'no „ found at all — the scan would be vacuous').toBeGreaterThanOrEqual(40);
    // Offenders first: this is the assertion that names the key and shows the
    // sentence. The arithmetic below only counts, so it must not fire ahead of it.
    expect(offenders, `de values closing „ with the wrong character:\n${offenders.join('\n')}`).toEqual([]);
    expect(paired).toBe(openers);
  });

  it('holds under an independent \\p{L}-aware regex formulation (objectui#3866 lesson)', () => {
    // #3866's lesson: a census regex written with `\w`/`[A-Za-z]` silently
    // skips the umlauts and ß that German quoted spans are full of
    // ("Alle Datensätze", "Zuletzt geöffnet"), so the method under-reports and
    // the file reads clean. The class below is unicode-property based and the
    // `u` flag is mandatory for `\p{…}` to mean anything at all.
    const INNER = '[\\p{L}\\p{M}\\p{N}\\p{P}\\p{Zs}]*?';
    const mismatch = new RegExp(`${OPEN}${INNER}${STRAIGHT}`, 'gu');
    const ok = new RegExp(`${OPEN}${INNER}${CLOSE}`, 'gu');

    // The formulation itself must be able to see a mismatch, or its zero below
    // proves nothing. Umlaut inside the span on purpose.
    expect('Registerkarte „Alle Datensätze" anzeigen'.match(mismatch)).toHaveLength(1);
    expect('Registerkarte „Alle Datensätze“ anzeigen'.match(mismatch)).toBeNull();

    const found: string[] = [];
    let okSpans = 0;
    for (const [key, value] of DE) {
      const bad = value.match(mismatch);
      if (bad) found.push(`${key}: ${bad.join(' | ')}`);
      okSpans += (value.match(ok) ?? []).length;
    }
    expect(found, `„…" mismatches:\n${found.join('\n')}`).toEqual([]);
    // 45 at objectui#3876's landing, 47 once objectui#3920 gave
    // `grid.import.savedMappingHint` / `savedMappingPreviewNote` German quotes,
    // 50 once objectui#3919 germanised the three `approvalsInbox` values,
    // 51 once objectstack#8270 added `home.build.noCapability`, which names the
    // withheld „Metadaten verwalten“ permission in the gate's reason line,
    // 52 once objectui#5417 added `flowRunner.completed`, which names the flow
    // it just finished — „{{flow}}“, an interpolated span, so the pairing is
    // asserted around a hole rather than around literal prose,
    // 53 once objectui#5232 added `console.objectView.viewConfigPermissionDenied`,
    // which names the same withheld „Metadaten verwalten“ permission as
    // `home.build.noCapability` above — the org-wide view-config gate's refusal,
    // 54 once objectui#6301 added `packagedAutomation.cloneCreated`, which names
    // the flow a clone just produced — „{{name}}“, an interpolated span like
    // `flowRunner.completed` above, so the pairing is again asserted around a
    // hole rather than around literal prose,
    // 55 once objectui#6655 added `timeline.unsupported.objectBoundGantt`, the
    // object-bound timeline's refusal of `variant: gantt`, which names the
    // refused variant — „gantt“, a literal span, because the quoted thing is an
    // authoring value the author typed rather than data the runtime filled in,
    // 58 once objectui#7149 gave `ActivityTimeline`'s assembled sentences pack
    // keys: `detail.activityFieldChanged` quotes the OLD and NEW field values
    // („{{old}}“ / „{{new}}“, two spans in one value, like `navigationSync.
    // renamedPage` above) and `detail.activityStatusChanged` the new status
    // („{{value}}“) — three interpolated spans, all runtime data,
    // 59 once objectui#7173 gave `AiPendingActionsInbox` pack keys:
    // `aiApprovals.rejectPlaceholder` quotes the EXAMPLE rejection reason the
    // placeholder suggests („Falsche Datensatz-ID — …“) — one LITERAL span, like
    // `timeline.unsupported.objectBoundGantt` above rather than the interpolated
    // ones, because the quoted thing is sample prose this pack authored.
    // 62 once objectui#6888 keyed `LocationField`'s residue refusal: the
    // one-half sentence quotes the offending text („{{text}}“) and the two-half
    // one quotes both („{{text}}“ / „{{otherText}}“) — three interpolated
    // spans, all runtime data, like the `ActivityTimeline` pair above. The two
    // new coordinate NOUN keys (`fields.location.latitude`/`longitude`) carry
    // no quotes at all: they are interpolated INTO those spans, not around them.
    // 63 once objectui#4191 added `actions.notAvailableHere`, the refused
    // auto-trigger notice, which quotes the action's label („{{action}}“) —
    // one interpolated span, runtime data.
    // 64 once objectui#10474 added `fields.dateTime.impossibleDay`, which quotes
    // the stored value („{{value}}“) — one interpolated span, runtime data.
    // 65 once objectui#10567 added its date-only sibling `fields.date.impossibleDay`,
    // which quotes the same stored value — one more interpolated span.
    // 66 once objectui#7699 added `fields.file.uploadIncomplete`, the refusal of
    // an upload that returned no file id, which quotes the pick's name
    // („{{name}}“) — one interpolated span, runtime data.
    // 68 once objectui#11000 added `form.noPermissionToCreate` and
    // `form.noPermissionToEdit`, the notice on a form locked for a closed
    // affordance, which each quote the object's label („{{object}}“-Datensätze)
    // — two interpolated spans, runtime data.
    // 69 once objectui#11131 added `fields.grid.noItemsAddHint`, the list-mode
    // line-items grid's empty text, which quotes the Add button's label
    // („{{label}}“) — one interpolated span, runtime data.
    // 70 once objectui#11445 made `search.resultsCount` a count family — its
    // `_one` and `_other` slots quote the query, and `resultsCountPlural` left.
    // 71 once objectui#11695 added `objectActions.deleteConfirmTitle`, the
    // delete confirmation's title, which quotes the record's name
    // („{{name}}“) — one interpolated span, runtime data.
    // 75 once objectui#11810 added `filterBuilder.emptyCheckHint.text` and
    // `.list`, the filter builder's note on how its two empty checks differ,
    // which each quote both operator labels („{{isEmpty}}“ / „{{isNull}}“) —
    // four interpolated spans, the dropdown's own labels.
    // 76 once objectui#11913 added `grid.import.invalidTime`, the import
    // preview's refusal of a time cell, which quotes the cell („{{value}}“) —
    // one interpolated span, runtime data.
    // 77 once objectui#12098 added `marketplace.install.localLoadsAtRestart`,
    // the install-local answer that loads at the next restart, which quotes
    // the package name („{{name}}“) — one interpolated span, runtime data.
    // 84 once objectui#7611 added the suggested-bindings panel's states:
    // `marketplace.suggestedBindings.acceptedState` and `.notInForceState`
    // quote the set („{{set}}“) and the position („Everyone“) — two spans
    // each; `.dismissedState` and `.revokedToast` quote the set — one each;
    // `.guestUnsupported` quotes the position („Guest“) — one.
    // 85 once objectui#12248 added `detail.deleteAttachmentConfirm`, the
    // attachment delete's confirm question, which quotes the file name
    // („{{name}}“) — one interpolated span, runtime data.
    // 87 once objectui#12288 added `marketplace.install.unmanagedSuccess` and
    // `.unmanagedIgnored`, the unmanaged install's answer and the runtime that
    // ignored it, which each quote the package name („{{name}}“) — two
    // interpolated spans, runtime data.
    // 86 once objectui#12504 retired `console.objectView.viewConfigPermissionDenied`
    // (its producer, the toolbar's view write, retired with the adapter's gate),
    // taking its one literal span („Metadaten verwalten“) with it.
    // 87 once objectui#12622 added `fields.datePicker.invalid`, the record
    // form date picker's notice for typed text that names no date, which
    // quotes that text („{{value}}“) — one interpolated span, runtime data.
    // 88 once objectui#12724 added `chatbot.build.nextStepQuote`, the finished
    // build's quote around each next step („{{step}}“) — one interpolated span,
    // runtime data.
    // 90 once objectui#12910 added `element.metadataViewer.noStateMachineNamed`
    // and `.unknownTypeNamed`, one paired span each.
    // 91 once objectui#13052 added `console.objectView.objectPackageDisabled`
    // („{{objectName}}“) — one interpolated span, runtime data.
    // 92 once objectui#13333 named the row in `detail.deleteRowConfirmation`
    // („{{name}}“) — one interpolated span, runtime data.
    // 93 once objectui#13330 added `console.objectView.managedUsers.inviteLine`,
    // which names the „Nicht berechtigt“ marker it explains.
    // 94 once objectui#13355 added `connectAgent.apiKey.confirmTitle`, the
    // API-key confirm that names the key („{{name}}“) — one interpolated span,
    // runtime data.
    expect(okSpans, 'correctly paired spans').toBe(94);
  });

  it('keeps the count identity that replaces the card’s count(„) === count(“)', () => {
    const whole = DE.map(([, v]) => v).join(String.fromCharCode(10));
    const open = count(whole, OPEN);
    const close = count(whole, CLOSE);
    const rdq = count(whole, RDQ);

    // 45 / 47 / 2 at objectui#3876's landing; 47 / 47 / 0 after objectui#3920
    // translated the two English values; 50 / 50 / 0 after objectui#3919 gave the
    // three `approvalsInbox` values German quotes; 51 / 51 / 0 after
    // objectstack#8270 added `home.build.noCapability`; 52 / 52 / 0 after
    // objectui#5417 added `flowRunner.completed`. See the header for why the
    // naive equality was false on the file #3876 left behind — and note that it is
    // now true for a *different* reason (rdq went to zero), which is why the
    // identity below is asserted as arithmetic rather than as `close === open`.
    // 53 / 53 / 0 after objectui#5232 added
    // `console.objectView.viewConfigPermissionDenied`; 54 / 54 / 0 after
    // objectui#6301 added `packagedAutomation.cloneCreated`; 55 / 55 / 0 after
    // objectui#6655 added `timeline.unsupported.objectBoundGantt`; 58 / 58 / 0
    // after objectui#7149 added the two quoted `ActivityTimeline` sentences
    // (three spans between them). `rdq` staying at 0 is the load-bearing half:
    // each new value added a MATCHED „…“ pair, not a stray closer that would
    // have made `close === open` true for the wrong reason. 59 / 59 / 0 after
    // objectui#7173 added `aiApprovals.rejectPlaceholder`, one more matched pair.
    // 62 / 62 / 0 after objectui#6888 keyed `LocationField`'s residue refusal —
    // three more matched pairs across its two arity siblings, and `rdq` still 0.
    // 63 / 63 / 0 after objectui#4191 added `actions.notAvailableHere`, one
    // more matched pair. 64 / 64 / 0 after objectui#10474 added
    // `fields.dateTime.impossibleDay`, one more matched pair. 65 / 65 / 0 after
    // objectui#10567 added `fields.date.impossibleDay`, one more matched pair.
    // 66 / 66 / 0 after objectui#7699 added `fields.file.uploadIncomplete`, one
    // more matched pair. 68 / 68 / 0 after objectui#11000 added
    // `form.noPermissionToCreate` and `form.noPermissionToEdit`, one matched
    // pair each. 69 / 69 / 0 after objectui#11131 added
    // `fields.grid.noItemsAddHint`, one more matched pair. 70 / 70 / 0 after
    // objectui#11445 made `search.resultsCount` a count family: `_one` and
    // `_other` carry one matched pair each and `resultsCountPlural` left.
    // 71 / 71 / 0 after objectui#11695 added `objectActions.deleteConfirmTitle`,
    // one more matched pair. 75 / 75 / 0 after objectui#11810 added the two
    // `filterBuilder.emptyCheckHint` values, two matched pairs each. 76 / 76 / 0
    // after objectui#11913 added `grid.import.invalidTime`, one more matched pair.
    // 77 / 77 / 0 after objectui#12098 added
    // `marketplace.install.localLoadsAtRestart`, one more matched pair.
    // 84 / 84 / 0 after objectui#7611 added five suggested-bindings values,
    // seven matched pairs between them. 85 / 85 / 0 after objectui#12248 added
    // `detail.deleteAttachmentConfirm`, one more matched pair. 87 / 87 / 0 after
    // objectui#12288 added `marketplace.install.unmanagedSuccess` and
    // `.unmanagedIgnored`, one matched pair each. 86 / 86 / 0 after
    // objectui#12504 retired `console.objectView.viewConfigPermissionDenied`,
    // one matched pair fewer. 87 / 87 / 0 after objectui#12622 added
    // `fields.datePicker.invalid`, one more matched pair. 88 / 88 / 0 after
    // objectui#12724 added `chatbot.build.nextStepQuote`, one more matched pair.
    // 90 / 90 / 0 after objectui#12910 added
    // `element.metadataViewer.noStateMachineNamed` and `.unknownTypeNamed`, one
    // matched pair each. 91 / 91 / 0 after objectui#13052 added
    // `console.objectView.objectPackageDisabled`, one more matched pair.
    // 92 / 92 / 0 after objectui#13333 named the row in
    // `detail.deleteRowConfirmation`, one more matched pair. 93 / 93 / 0 after
    // objectui#13330 added `console.objectView.managedUsers.inviteLine`, one
    // more matched pair. 94 / 94 / 0 after objectui#13355 added
    // `connectAgent.apiKey.confirmTitle`, one more matched pair.
    expect({ open, close, rdq }).toEqual({ open: 94, close: 94, rdq: 0 });
    // The durable shape: every „ closed by a “, every surplus “ an English
    // opener answered by a ”. Survived translating the two English values.
    expect(close).toBe(open + rdq);

    // The surplus is gone because the two English values are gone, not because
    // a German value lost a closer: `open` above is the proof that this pack
    // still quotes, and the `it` below names the two keys that changed.
    const rdqKeys = DE.filter(([, v]) => v.includes(RDQ)).map(([k]) => k);
    expect(rdqKeys).toEqual([]);
  });

  it('names the two values objectui#3920 moved out of the surplus, byte-exact on their spans', () => {
    // These two were the entire 45/47 gap, and `rdqKeys === []` above no longer
    // mentions them. This is where they are named: German prose, German quotes,
    // `{{name}}` intact. Their `„…“` are also what took `okSpans` 45 → 47.
    //
    // Deliberately NOT added to the FIXED table above: that table is
    // objectui#3876's census (20 keys / 22 spans, asserted as such), and folding
    // a later fix into it would destroy the record of what #3876 actually
    // touched. Same reason the counts above carry both numbers.
    for (const key of ['grid.import.savedMappingHint', 'grid.import.savedMappingPreviewNote']) {
      const value = at(builtInLocales.de, key);
      expect(typeof value, `de ${key} missing`).toBe('string');
      const v = value as string;
      expect(v.includes('„{{name}}“'), `de ${key} lost the paired span`).toBe(true);
      expect(count(v, OPEN), `de ${key} opener count`).toBe(1);
      expect(count(v, CLOSE), `de ${key} closer count`).toBe(1);
      expect(count(v, RDQ), `de ${key} still holds an English closing quote`).toBe(0);
      expect(v.includes(STRAIGHT), `de ${key} holds a straight quote`).toBe(false);
      // …and it is German, not the English sentence it used to be. `en` still
      // says what it said, so a byte-equality check against `en` is the cheap
      // proof that this pack is not serving the English prose any more —
      // the objectui#3920 defect in one line.
      expect(v, `de ${key} is still the en value`).not.toBe(at(builtInLocales.en, key));
    }
    expect(at(builtInLocales.de, 'grid.import.savedMapping')).toBe('Gespeicherte Zuordnung:');
  });

  it('leaves `en` alone — the fix must not leak across packs', () => {
    // en quotes with ASCII on both sides; the drift gate only fires on en
    // changes, so this is the cheap local proof that none happened.
    expect(at(builtInLocales.en, 'empty.pageNotFoundDescription')).toContain('"{{name}}"');
    expect(at(builtInLocales.en, 'console.objectView.ufShowAllRecords')).toContain('"All records"');
    expect(count(JSON.stringify(builtInLocales.en), OPEN)).toBe(0);
  });

  it('holds pack-wide: no de value quotes with a U+0022 at all (objectui#3919)', () => {
    // This used to be an explicit three-key list of the `approvalsInbox` values
    // that were still ASCII-quoted on both sides. objectui#3919 fixed them, so the
    // list collapses to the strictly stronger form: `„…“` is this pack's
    // convention, therefore ANY U+0022 in a German value is the defect — whether
    // it is one side of a mismatched pair (the objectui#3876 shape, which the
    // scanner above also catches) or both sides of a self-consistent ASCII pair
    // (the objectui#3919 shape, which the scanner structurally cannot catch).
    // No per-key list to maintain: the next such value fails here by name.
    const straight = DE.filter(([, v]) => v.includes(STRAIGHT)).map(([k]) => k);
    expect(straight, `de values still quoting with U+0022:\n${straight.join('\n')}`).toEqual([]);

    // `toEqual([])` is precisely the assertion shape that also passes when nothing
    // was produced, so the predicate must be shown to still be able to find
    // something. `en` quotes with ASCII by design (pinned in the `leaves en alone`
    // `it` above), so the same filter over `en` returns a long list; a broken
    // `flatten`, an emptied pack or a renamed export would take that to zero and
    // fail here instead of reading green above. 40 en values at #3919's landing.
    expect(DE.length, 'de pack looks empty — the scan would be vacuous').toBeGreaterThan(2000);
    const enStraight = flatten(builtInLocales.en).filter(([, v]) => v.includes(STRAIGHT));
    expect(
      enStraight.length,
      'the U+0022 predicate finds nothing in en either — it is broken, not the pack clean',
    ).toBeGreaterThan(20);
  });

  it('pins the approvalsInbox quartet objectui#3919 converged, byte-for-byte', () => {
    // The four sentences a German approver meets in one screen: the approve and
    // reject confirmation titles, and the twin inline toasts. Three were ASCII on
    // both sides while `approveOneTitle` alone was correct — one operation pair,
    // two typographies, which is the whole substance of the card. Pinned whole
    // here because the `it` above deliberately no longer names any key, and an
    // invariant that names nothing would stop recording what this fix touched.
    expect(at(builtInLocales.de, 'approvalsInbox.approveOneTitle')).toBe('„{{title}}“ genehmigen?');
    expect(at(builtInLocales.de, 'approvalsInbox.rejectOneTitle')).toBe('„{{title}}“ ablehnen?');
    expect(at(builtInLocales.de, 'approvalsInbox.inlineApproved')).toBe('„{{title}}“ genehmigt');
    expect(at(builtInLocales.de, 'approvalsInbox.inlineRejected')).toBe('„{{title}}“ abgelehnt');

    // The fix was value-domain typography only. `{{title}}` is what makes these
    // sentences work at runtime and `all-locales-key-parity` compares placeholder
    // shapes, so losing one would break far more than typography.
    for (const key of ['approveOneTitle', 'rejectOneTitle', 'inlineApproved', 'inlineRejected']) {
      const v = at(builtInLocales.de, `approvalsInbox.${key}`) as string;
      expect(v.includes('{{title}}'), `de approvalsInbox.${key} lost {{title}}`).toBe(true);
      expect(v.includes('„{{title}}“'), `de approvalsInbox.${key} span is not paired`).toBe(true);
    }

    // `en` is untouched and still ASCII on both sides — the shape de diverges from
    // on purpose, and the cheap local proof this fix did not leak across packs.
    expect(at(builtInLocales.en, 'approvalsInbox.rejectOneTitle')).toBe('Reject "{{title}}"?');
    expect(at(builtInLocales.en, 'approvalsInbox.inlineApproved')).toBe('Approved "{{title}}"');
    expect(at(builtInLocales.en, 'approvalsInbox.inlineRejected')).toBe('Rejected "{{title}}"');
  });
});
