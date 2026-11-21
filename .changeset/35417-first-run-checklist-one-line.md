---
'@object-ui/console': patch
'@object-ui/i18n': patch
---

fix(console): the first-run checklist on Home counts its done rows the way its progress line does, names the Setup app in the reader's language, and folds to one line when two rows or fewer are left

Clause-②: no
Metadata-protocol: none

The progress line counts the required rows alone, while the control that unfolds the done rows counted every done row, optional ones included, so a managed environment could read "6 of 7 done" above "Show completed (8)". Once an optional row is done the control now names the two counts apart ("Show completed (6 required · 2 optional)"); with no optional row done it reads as before.

The checklist's description, the built-in AI row's done line and the Connect an AI assistant row's line named "Setup" in English in every language; they now use the Setup app's own label in each pack (for example 系统设置, 系統設定, セットアップ, Configuración). English and German keep "Setup", which is their label.

Above the page, once two rows or fewer are left to do, the card folds to one line: its title, its progress, each row left by its title and a Set button, and the close button. A language, timezone or currency row's Set opens the full card with that row's editor, and the card folds back once the editor closes; every other row's Set opens the page its row links to. The phone placement after the apps keeps its own fold. No row, completion rule or setting write changes.

New locale key: `console.firstRunChecklist.showDoneSplit`, in all eleven packs.
