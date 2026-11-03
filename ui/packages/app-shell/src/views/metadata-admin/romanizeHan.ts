/**
 * romanizeHan — the one Chinese step every Studio create door takes before it
 * derives an identifier from a display name.
 *
 * A Chinese-speaking administrator names things in Chinese. Every door that
 * derives a machine name from a label (new package, new object and the other
 * new-item dialogs, Add field, the generic create form, a picklist option)
 * used to keep only `[a-z0-9]`, so `维修中心` derived nothing and the door
 * waited for a hand-typed English identifier. This module turns each Chinese
 * WORD of the text into its toneless pinyin, as its own space-separated word,
 * and leaves every other character where it was; the door's own sanitizer
 * then does exactly what it did before. So `维修中心` reaches a field-name
 * sanitizer as ` weixiu  zhongxin ` and leaves it as `weixiu_zhongxin`, and a
 * package-id segment sanitizer turns the same text into `weixiu-zhongxin`. The
 * namespace prefix, the `__c` pair suffix and the taken-name refusal are the
 * sanitizers' and the doors' rules, untouched here.
 *
 * ⛔ Never an opaque generated name such as `field_3`: these identifiers are
 * written into formulas and APIs, so a person and an AI must be able to read
 * them. The derived name is a suggestion; every door keeps it editable.
 *
 * ## Words, not syllables
 *
 * Word boundaries come from `Intl.Segmenter`'s word granularity (the
 * runtime's own dictionary), so `客户等级` is `kehu dengji`, not
 * `ke hu deng ji`. A runtime without `Intl.Segmenter` has no word
 * boundaries to offer, so each character's reading is its own word
 * (`ke_hu_deng_ji`): longer, still readable, still valid. Either way the
 * readings are taken over the whole run, so a polyphone reads by its
 * neighbours (`银行` → `yinhang`, `行动` → `xingdong`).
 * `ü` is written `v` (`绿` → `lv`), the usual keyboard spelling, so no
 * sanitizer splits a syllable on it.
 *
 * ## Japanese is left alone
 *
 * Text that carries kana is Japanese, and Chinese pinyin of its kanji is not a
 * name a Japanese administrator would recognise; it is returned unchanged, so
 * such a door keeps asking for the identifier as it did before.
 *
 * ## Why the dictionary loads lazily
 *
 * `pinyin-pro` (the library the server's pinyin search recall already uses,
 * so both romanise alike) carries its dictionary: its `pinyin` export alone
 * is several hundred kilobytes minified. It is never in the Console's main
 * bundle. A door calls {@link useHanRomanizer} with the text it derives from;
 * the first time that text holds a Chinese character the chunk is fetched,
 * and every subscribed door re-renders once it lands. Until then
 * {@link romanizeHan} returns its input unchanged and
 * {@link romanizerPending} answers `true`, so a door holds back its
 * "no identifier could be derived" hint rather than flash it. If the chunk
 * cannot be fetched (offline, a stale deploy) the doors fall back to that
 * hint and the hand-typed identifier: a visible, functional degradation.
 */

import * as React from 'react';

type PinyinFn = (text: string, options: { toneType: 'none'; type: 'array'; v: true }) => string[];

/** A Chinese (Han) character, anywhere in the text. */
const HAN = /\p{Script=Han}/u;
/** Kana: the text is Japanese, which this module does not romanise. */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * The language whose word boundaries are wanted. This is the language of the
 * TEXT being romanised (Chinese, which is what pinyin spells), not the
 * viewer's display locale, so it is fixed rather than read from the session.
 */
const CHINESE_WORDS = 'zh';

interface WordSegmenter {
  segment(text: string): Iterable<{ segment: string }>;
}
type SegmenterCtor = new (locale: string, options: { granularity: 'word' }) => WordSegmenter;

let pinyinFn: PinyinFn | null = null;
let failed = false;
let loading: Promise<void> | null = null;
let version = 0;
let segmenter: WordSegmenter | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Does deriving an identifier from `text` need the pinyin dictionary? */
function needsRomanizer(text: string): boolean {
  return HAN.test(text) && !KANA.test(text);
}

function wordSegmenter(): WordSegmenter | null {
  const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (!Ctor) return null;
  segmenter ??= new Ctor(CHINESE_WORDS, { granularity: 'word' });
  return segmenter;
}

/**
 * Fetch the pinyin dictionary chunk (once; later calls share the request).
 * Resolves when it is ready; never rejects — a failed fetch leaves Chinese
 * text underivable, which the doors already explain.
 */
export function loadHanRomanizer(): Promise<void> {
  if (pinyinFn) return Promise.resolve();
  loading ??= import('pinyin-pro').then(
    (mod) => {
      pinyinFn = mod.pinyin as unknown as PinyinFn;
      failed = false;
      notify();
    },
    (err: unknown) => {
      // A later door may try again; until one succeeds, the doors ask for the
      // identifier by hand, as they did before this module existed.
      loading = null;
      failed = true;
      console.warn(
        'Studio could not load the pinyin dictionary, so identifiers are not derived from Chinese names; type the identifier instead.',
        err,
      );
      notify();
    },
  );
  return loading;
}

/**
 * `text` with each Chinese word replaced by ` <pinyin> ` (toneless, the word's
 * syllables joined). Text with no Chinese, Japanese text, and any text while
 * the dictionary has not loaded come back unchanged.
 */
export function romanizeHan(text: string): string {
  if (!pinyinFn || !needsRomanizer(text)) return text;
  const toPinyin = pinyinFn;
  const readings = (run: string): string[] => toPinyin(run, { toneType: 'none', type: 'array', v: true });
  const seg = wordSegmenter();
  if (seg) {
    let out = '';
    for (const { segment } of seg.segment(text)) out += HAN.test(segment) ? ` ${readings(segment).join('')} ` : segment;
    return out;
  }
  return text.replace(/\p{Script=Han}+/gu, (run) => ` ${readings(run).join(' ')} `);
}

/**
 * True while `text` needs the dictionary and it has neither loaded nor
 * failed: the door's identifier is about to be derived, so a "could not
 * derive" hint would be wrong for that moment.
 */
export function romanizerPending(text: string): boolean {
  return !pinyinFn && !failed && needsRomanizer(text);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getVersion(): number {
  return version;
}

/**
 * Subscribe a door to the dictionary: when any of `texts` holds Chinese, the
 * chunk is fetched, and the component re-renders when it lands (or fails).
 * Returns a counter that changes at that moment, for a door whose identifier
 * lives in state and must be re-derived then.
 */
export function useHanRomanizer(...texts: string[]): number {
  const current = React.useSyncExternalStore(subscribe, getVersion, getVersion);
  const wanted = !pinyinFn && texts.some(needsRomanizer);
  React.useEffect(() => {
    if (wanted) void loadHanRomanizer();
  }, [wanted]);
  return current;
}

/**
 * Runs `onLand` once each time the pinyin dictionary lands after this
 * component mounted, and on no other render. A door whose identifier was left
 * empty by a Chinese name typed before the chunk arrived fills it here; a
 * person who later clears the identifier to type their own is not refilled,
 * because the dictionary does not land twice.
 */
export function useWhenRomanizerLands(onLand: () => void, ...texts: string[]): void {
  const version = useHanRomanizer(...texts);
  const seen = React.useRef(version);
  const latest = React.useRef(onLand);
  React.useEffect(() => {
    latest.current = onLand;
  });
  React.useEffect(() => {
    if (version === seen.current) return;
    seen.current = version;
    latest.current();
  }, [version]);
}
