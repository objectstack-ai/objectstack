---
"@objectstack/platform-objects": patch
---

fix(platform-objects): the System Overview by-action table serves its declared title again, and the default locale bundle is now pinned to the source string (#8721)

`widget_recent_events` was converted into an ADR-0021 single-form — a
dataset-bound breakdown of `sys_audit_log` events by action — but all four
hand-authored locale bundles kept serving the title the widget had *before* the
conversion (`Recent Audit Events` / `最近审计事件` / `最近の監査イベント` /
`Eventos de Auditoría Recientes`). The translation is what renders, so the
declared string reached nobody in any locale. Its `description` had drifted the
same way and in the same direction, one field over.

**The duplicate the stale translation was hiding.** With the source string
restored, the board carried the same label twice: `widget_events_by_type` (a
pie) and `widget_recent_events` (a table) both declared `Audit Events by
Action`, over the same dataset and the same dimension. They looked distinct in a
running instance only because one of them was serving a stale translation. The
pair now splits on what each adds — the pie keeps `Audit Events by Action` (the
share picture), the table becomes **`Event Volume by Action`** (the exact
per-action count, which is what its `values: ['event_count']` produces and what
its description already said). All four locales are translated to the new
strings; the widget **ids are unchanged**, so no translation key, persisted
widget state or dataset binding moves.

**Why nothing caught it, and what now does.** This package's `apps` /
`dashboards` / `pages` i18n is hand-authored and cannot be regenerated —
regenerating would delete ~40 runtime-contributed nav translations per locale —
so it never had the source-tracking the generated half gets from the extractor.
Every gate over it made a **key-set** claim (`app-nav-translation-parity.test.ts`
asserts a translation exists and does not outlive its declaration;
`check:i18n-coverage` ratchets *untranslated* labels; `check:app-nav-i18n` judges
the merged nav tree), and a key whose value is stale satisfies all of them.

`app-nav-translation-parity.test.ts` now also asserts the **default locale's
content**: every statically declared app label, description and nav label, plus
the dashboard's label, description and every widget title/description, must
appear in `en.ts` **verbatim**. That claim is available for `en` alone because
`en` is a copy of the source rather than a translation of it — the same
invariant the generated half already enforces by rewriting its `en` bundle on
every extract. What a *translated* locale should do when its source string
changes is a separate product decision and is deliberately not decided here.
