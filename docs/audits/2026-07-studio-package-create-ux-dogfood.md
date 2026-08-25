# Studio "create a package and build in it" UX dogfood (browser)

Goal: walk the **whole first-run authoring loop a new admin actually experiences** —
boot the showcase example, log in, create a writable package in Studio, model an
object with fields, enter a record, create an app with navigation, publish, and
use the result as an end user — driving a real Chromium against `/_console`
(vendored console build `7782698`, matching the `.objectui-sha` pin, so findings
are not stale-bundle artifacts). Both sides of the read-only gate were exercised
per ADR-0124 D5.

Run: `objectstack dev --ui --seed-admin` on the showcase example, fresh SQLite DB,
`admin@objectos.ai` seeded admin, headless Chromium via CDP with screenshots at
every step.

## The loop closes

Home → **Build an app** → Studio landing → **+ 新建软件包** (`维修中心` /
`com.example.repairs`) → Data pillar → object `Repair Ticket` (identifier
auto-suggested from the English display name) → picklist field `Status` with 3
values → **Save draft** → Changes panel → **Publish** → record created in the
runtime-faithful Records grid → **Create app** `Repair Center` (identifier
auto-suggested) → Interfaces pillar → nav item bound to the object → **Publish**
→ app appears in the Home launcher → end-user list renders the record with the
picklist label chip. **Zero code, no dead ends, minutes end-to-end.** The
draft→publish model reads consistently everywhere ("Unpublished draft" badge,
`Changes · n` counter, "Published all drafts in this package (one atomic
release)").

Other things that hold up well:

- **Empty states teach the next step at every level** (object list, nav editor,
  records grid hint bar).
- **Previews are the runtime renderer** ("Preview = runtime · same renderer") —
  nothing to un-learn between builder and app.
- **Field type catalog** is deep (40+ types, grouped) and the properties panel
  covers advanced needs (CEL conditional-required, track history, indexed).
- **Server enforces the writable/read-only gate**: creating an object in the
  source-loaded showcase package is rejected server-side even though the client
  let the gesture through (see finding 1).
- Package switcher clearly badges **Read-only vs Writable** and offers "+ New
  package (writable base)".

## Findings (ordered by user pain)

### 1. Read-only packages accept edit gestures client-side, then fail late — P1

On `com.example.showcase` (Read-only badge shown), **"+ Add field" actually
mutates the canvas** (header count went 16 → 17 fields, Field properties panel
opened on `field_17`), and **"New object" opens the inline create form**. Only on
the eventual server write does the user learn it was all futile — via a toast
whose copy is developer-facing: *"read-only code/installed package… See
docs/adr/0070-package-first-authoring.md"*. An internal ADR path is not an
end-user remediation.

Fix: client-side courtesy gating (disable/hide `Add field`, `New object`,
`Save draft`, `Publish`, field-property inputs when the package is read-only,
with a tooltip "Read-only package — create a writable package to edit"), and
rewrite the server error copy to say what to *do* ("Switch to a writable package
(top-left selector) or create one"), keeping the ADR pointer out of the UI.

### 2. Field API name doesn't follow the label before first save — P1

"Add field" creates `field_2` / label "New field". Renaming the label to
`Status` leaves the API name `field_2`, and the data column is then `field_2`
forever (verified: the saved record stores `"field_2": "in_progress"`). Object
and app identifiers *do* auto-suggest from the display name, so authors expect
the same here and won't look at the API name input.

Fix: sync API name from label while the field is new/unsaved (exactly the
object-identifier behavior), lock it after first save.

### 3. Publish is one click, no confirmation, and the Changes panel is too thin — P1

Publish fires immediately (toast: "Published all drafts in this package (one
atomic release)") with no confirm step, and the Changes panel shows only
`repair_ticket · New` — no field-level diff, no drill-in. Review-before-release
is the panel's whole job (ADR-0016 §3.6 step 4), and one mis-click currently
releases everything.

Fix: Publish opens the pending-changes list with a confirm button; give the
panel per-item detail (fields added/changed, updates that overwrite live).

### 4. Mixed languages within single screens — P2

Login/Home are English; the Studio landing is Chinese (应用构建 / 新建软件包);
the builder is English chrome with embedded Chinese strings (添加字段 / 未分组 /
请选择… / 拖动字段排序…); the record form placeholder is 请选择… inside an
otherwise-English dialog. Whatever the intended locale, half-translated screens
read as unfinished. Audit the console's i18n keys for both locales; make the
studio landing and canvas hint strings go through the same locale resolution as
the rest of the console.

### 5. New-package wizard: no ID suggestion, silent input munging, unexplained disabled button — P2

- Typing the name (维修中心) suggests nothing for the package ID (object/app
  identifiers do get suggestions — inconsistent).
- Chinese names produce **no** identifier suggestion anywhere (no pinyin, no
  fallback), so zh-first users must guess the allowed charset.
- Illegal characters are silently stripped while typing (`bad id!!` → `badid`).
- With an invalid ID the create button is just disabled — no inline message
  explaining the required reverse-domain format (`com.example.repairs`).

Fix: suggest an ID from the name (transliterate or fall back to `com.<tenant>.appN`),
show the format rule inline when the button is disabled, and don't silently eat
keystrokes — show what's invalid.

### 6. A new app scaffolds no navigation — P2

"Create app" produces an app with zero nav items; the object the user just
built isn't offered. The user must discover Interfaces → Edit → Add nav item →
Label → Link to object. The create-app popover could offer "add existing
objects as menu items" (checked by default) and pre-label the item with the
object's plural label — that single step would have saved the entire manual
wiring in this run.

### 7. Records grid shows a duplicated "Actions" column in Studio — P3

The Studio Records tab (and its Interfaces preview) renders an `Actions` data
column *and* the pinned row-actions column, both headed "Actions"
(`#/Name/Status/Actions/Actions/+`). The end-user app shows only one. Likely the
grid injects its own actions column without deduping against the runtime one.

### 8. Verb/label inconsistencies around record creation — P3

Studio Records uses a big blue **Create** button adjacent to top-bar **Create
app**; the runtime app calls the same action **New**. The record dialog's submit
is **Create**. Pick one verb ("New" for records, keep "Create app" for apps) to
de-collide the two adjacent buttons.

### 9. Cold `/_console` load sits on a bare "Loading…" for ~8s — P3

First hit renders unbranded "Loading…" before redirecting to login. A logo +
skeleton (or a faster auth probe) would make the first impression match the
otherwise polished login screen.

### 10. Small polish — P3

- Picklist value-editor inputs are so narrow their placeholders truncate
  ("valu" / "Labe"), and CJK labels show ~3 chars (待处理 → 待处…).
- The read-only toast can appear twice for one gesture.
- Interfaces canvas showed a ghost gray rectangle artifact below the fold on an
  empty app.
- "Save draft" disables after a successful save (good) but there's no "last
  saved" timestamp anywhere.

## Verdict

The MVP loop of ADR-0016 §9 genuinely works first-try, and the
draft→publish→run mental model comes across. The pain concentrates in three
places: **read-only gating happens too late and speaks ADR** (finding 1),
**identifier ergonomics** (findings 2 & 5, worst for CJK-named things), and
**publish/review confidence** (finding 3). All are console-side (objectui)
except the read-only error copy, which is the framework's dispatcher message.
