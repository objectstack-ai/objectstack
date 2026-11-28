---
"@objectstack/scenarios": patch
---

Clause-②: no
Metadata-protocol: none

The scenario-card Run grader now reads a count the reply spells as a word: an English number word from zero to twenty ("Two invoices are no longer drafts") and a Chinese numeral from 零 to 十, or 两, standing before a measure word (「两张发票」). Such an answer was right but failed with "missing figure". The words count for the correctness axis only; the leak scans, the unsupported-figure check of a decline and `numbersIn` still read digits only, so no answer gains a leak. A word inside a longer word ("someone", 「一些」), the pronoun "one" ("one of them", "no one"), a hyphenated larger number or fraction ("twenty-one", "two-thirds") and an ordinal (「第一」) are not read. A missing-figure problem now names its asker: the persona's id, or `admin` for an admin question (it read `persona` for both).
