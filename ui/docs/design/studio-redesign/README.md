# Studio design surface — reference artboards

These eight pages are the visual contract for the Studio design-surface layout redesign tracked by objectstack-ai/objectui#12446 and its ten child cards. Each child card restates its artboard in numbers; the artboard shows the same thing as pixels. Where a card and an artboard disagree, the card's numbers win and the disagreement is reported on the card.

This folder is documentation. Nothing in the app imports it, and no build step reads it.

## How to view

Open an `.html` file in a browser and give the window at least 1280 px of width; every artboard is laid out for 1280 × 820 and scrolls below that. The matching `.png` is a 1280 px render of the same file, for reading on GitHub without a browser tab. The pages load Inter from Google Fonts; offline they fall back to the system sans.

The HTML is plain markup with inline styles, written so that each declaration maps to one Tailwind utility (`height:32px` → `h-8`, `font-size:13px` → `text-[13px]`, `border-radius:6px` → `rounded-md`, `background:var(--primary-soft)` → `bg-primary/10`, and so on). Colors are the console's existing tokens: `--primary` is the indigo primary, `--muted-fg` the muted foreground, `--border` the border, `--sidebar` the sidebar surface. No new colors are introduced.

The sample data is the HotCRM example app (`app.objectstack.hotcrm`) as served by `objectstack serve --dev` on 2026-10-15: its objects, flows, navigation tree, permission sets and the first rows of its records. Copy is literal and in English.

## Artboards and the cards they serve

| File | Shows | Card(s) |
| --- | --- | --- |
| `data-records.html` | Data pillar, Records tab, writable package: shell header, Objects rail, object header inside the content column, seven flat tabs, toolbar, flush grid, footer | #12447 shell header · #12448 rail · #12450 Data pillar |
| `data-form.html` | Data pillar, Form tab, a field selected: form toolbar, section card, field cards, field inspector | #12451 Form tab · #12449 inspector aside |
| `data-records-readonly.html` | The same Records view with a read-only package: the two read-only signals, outline Publish, no rail add button | #12453 read-only posture |
| `automations.html` | Automations pillar: rail grouped by trigger object with glyphs, status dots and a legend; item header with the Enabled switch; Canvas / Variables / Runs / Problems / Debug tabs; flow canvas; node configuration aside | #12454 Automations · #12448 rail · #12449 inspector aside |
| `access.html` | Access pillar: pinned "Record sharing (OWD)" row, permission-set rail, set header, five tabs, Objects matrix with OWD chips, 18 px checkboxes and the hovered-row bulk strip | #12456 Access · #12448 rail |
| `interfaces-page.html` | Interfaces pillar with a page entry selected: navigation-tree rail with the ten-kind "+" picker open, item header with Design / Run, page regions designer, nav-item inspector | #12455 Interfaces · #12448 rail · #12449 inspector aside |
| `interfaces-object.html` | Interfaces pillar with an object entry selected: runtime list preview, "Open in Data", nav-item inspector with Landing / View / URL filters | #12455 Interfaces |
| `interfaces-dashboard.html` | Interfaces pillar with a dashboard entry selected: widget canvas with a selected widget, widget properties | #12455 Interfaces |

The pillar nav card #12452 (Access as a fourth segment, More retired) is visible in every artboard's header; it is held on decision A of the epic.

## The shared numbers

| Thing | Value |
| --- | --- |
| Shell header | 48 px; grid `1fr auto 1fr`; 12 px side padding |
| Pillar segmented control | 3 px padded muted track; 28 px items; active item on the card surface with a 1 px shadow and its icon in the primary color |
| App chip | 24 px icon tile; name 13 px / 600; chevron |
| Rail | 240 px; header row 44 px; search 32 px; rows 32 px; group header 28 px; children indent 12 px; empty-group row 28 px |
| Item header row | 18 px top padding, 24 px side padding; 32 px icon tile; title 18 px / 600; api name as an 11 px mono chip; meta 12 px muted |
| Tab row | 36 px; 13 px; 2 px primary underline on the active tab |
| Toolbar | 12 px vertical padding; chips 28 px with a 14 px glyph and 12 px text |
| Table | header row 36 px on the sidebar surface, 12 px / 500 muted; body rows 40 px; 1 px dividers; row-number column 48 px with 24 px left padding |
| Inspector aside | 300 px; header with an 11 px uppercase eyebrow, 15 px / 600 title, 11 px mono id, 28 px close; body 16 px padding, 14 px gaps; footer sentence 12 px muted |
| Type scale | 18 / 13 / 12 / 11 px — title / body / meta / label; labels uppercase with 0.06 em tracking |
| Radii | 8 px for cards, tiles and the segmented track; 6 px for rows, chips and inputs; 4 px for small chips and checkboxes |
| Switch | 36 × 20 px, 16 px knob |
| Checkbox | 18 px, 4 px radius, primary fill with a white check when on |

## What a pull request against a card must show

1. Two screenshots per artboard it touches, taken from the local console at 1280 px — light and dark — cropped to the same region as the artboard's `.png`.
2. A deviation list: every place the result differs from the artboard, with the reason (a pinned test, a runtime constraint, a decision on the epic). An empty list is a line that says so.
3. The tests the card names as "stay green" green, and the tests it names as "updated" updated and ablated once.

Acceptance compares the screenshots to the `.png` with the card's own Acceptance section as the checklist; the deviation list is read first.
