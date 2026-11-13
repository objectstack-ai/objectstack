---
'@object-ui/app-shell': patch
---

fix(studio): the dataset designer edits a dimension's and a measure's synonyms and description

Clause-②: no
Metadata-protocol: none

Studio's dataset designer replaces the generic dataset form, so the member vocabulary that dataset metadata already stores (`synonyms` and `description` on every dimension and measure, ADR-0149 D1) could be set only through the API. Each dimension and measure row's Advanced section now offers both:

- **Synonyms**: the words people use for the member in a question, typed comma-separated (an ASCII or full-width comma) and stored as a list.
- **Description**: a one- or two-sentence business definition. On a description stored as an inline locale map, the box edits the designer locale's entry and keeps the others.

Both show the label and help text of the spec's dataset form, limits included, in the designer's language. Clearing a box removes the key, so a member never stores an empty list or an empty string. The limits are not enforced in the designer: a save that breaks one (more than 20 synonyms, a synonym over 60 characters, a word that already names another member, a description over 500 characters) is refused by the dataset schema with the rule it broke.
