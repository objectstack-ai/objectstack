/**
 * The ONE anti-vacuity floor for the size of the catalog (`allExamples()`), read
 * by every test here that guards its own sweep against an empty corpus.
 *
 * A floor, not a census: it answers "did the collector find a corpus at all?",
 * so catalog growth never moves it and neither does deleting an entry. It sits
 * at about two thirds of the 432 entries measured on objectstack `origin/main`
 * `6a7c0fe3` (the `vite-dts-wiring-ratchet` precedent: measured 22, floor 15).
 * Before it existed the same population was pinned at three different values
 * across eight call sites, the tightest one entry under the measured count.
 *
 * Re-measure only when the corpus has shrunk to near it, and then move it to
 * about two thirds of the new reading. ⛔ Never raise it to track growth.
 */
export const CATALOG_ENTRY_FLOOR = 288;
