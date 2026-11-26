// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { pickSentenceLocale } from '@objectstack/core';

/**
 * [ADR-0160 D3, ADR-0149 M1] The executor's sentences: every note an answer
 * carries, and every refusal it throws, is written here, one per language,
 * and picked for the caller's locale ladder by the shared picker. The spec
 * declares the slots and fixes no wording.
 *
 * ⛔ A sentence never carries record text, and the only names it takes are
 * names the caller's served schema shows (or the names the caller sent).
 */

export const SENTENCE_LOCALES = ['en', 'zh-Hans'] as const;
type Locale = (typeof SENTENCE_LOCALES)[number];

/** One pack of the "several" answer: its AI face and its label. */
export interface PackListing {
  face: string;
  label: string;
}

/** One candidate a refusal names: its AI face, and its holder (absent for an environment pack). */
export interface PackCandidate {
  face: string;
  packageId?: string;
}

/**
 * [ADR-0160 D4 step 3, as amended 2026-11-25] A pack of the "several" answer:
 * its face (`NS-NAME` for a package's pack, ADR-0150's addendum) with its
 * `label` — a machine name alone does not tell a model which audience a pack
 * serves. The fallback: a pack with no label (blank) is listed by its face
 * alone. `AiContextSchema` requires a label, so no parsed pack reaches it
 * today; the fallback keeps the sentence whole should that change.
 */
const listed = (packs: readonly PackListing[], spell: (face: string, label: string) => string) =>
  packs.map((p) => (p.label.trim() !== '' ? spell(p.face, p.label) : p.face)).join(', ');

/** Every candidate's face; each holder named only where two candidates derive one face. */
const candidatesOf = (
  candidates: readonly PackCandidate[],
  holder: (face: string, packageId: string | undefined) => string,
) => {
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.face, (counts.get(c.face) ?? 0) + 1);
  return candidates.map((c) => ((counts.get(c.face) ?? 0) > 1 ? holder(c.face, c.packageId) : c.face)).join(', ');
};

/** Whether every candidate derives its own face, so `context` can name each. */
const facesApart = (candidates: readonly PackCandidate[]) => new Set(candidates.map((c) => c.face)).size === candidates.length;

export type Sentences = ReturnType<typeof sentencesFor>;

const WRITTEN = {
  en: {
    withheldFields: (fields: readonly string[]) =>
      `These fields are not visible to you, so their values are not given: ${fields.join(', ')}. Say they are not `
      + 'visible to you; never say they are empty or blank.',
    notVisible:
      'Some of the material this pack covers is not visible to you, so it is not given. Do not treat it as empty or '
      + 'absent, and do not guess it.',
    bodyOutline: (field: string) =>
      `The body (${field}) is long, so only its outline is given. To read a section, call get_record_context again `
      + 'with the same arguments and that section\'s anchor.',
    bodyTruncated: (field: string) =>
      `The text of ${field} was cut at the length this tool returns; what follows the cut is not given.`,
    relatedTruncated: (object: string, cap: number) =>
      `The related list on ${object} has more rows than the ${cap} given; the rest are not given.`,
    outlineTruncated: (field: string, listed: number, total: number, next: number | undefined, unlistable: number) =>
      `This page of the outline of ${field} lists ${listed} of its ${total} headings; the pages run shallowest levels `
      + `first, then in body order, and the other ${total - listed} are not listed on this page. `
      + (next === undefined
        ? 'No later page lists more.'
        : `To list the next page, call get_record_context again with the same arguments and outlineFrom ${next}. `
          + 'Each heading\'s anchor is given on the page that lists it.')
      + (unlistable > 0
        ? ` ${unlistable} of the headings are too long for any page to list, so their anchors are not given.`
        : ''),
    // Refusals.
    noPackNamed: (context: string, object: string) =>
      `No context pack named '${context}' reads object '${object}', so nothing was read. Omit 'context' to use the `
      + 'object\'s one pack, or read the record with get_record.',
    noPack: (object: string) =>
      `Object '${object}' has no context pack, so nothing was read. Read the record with get_record.`,
    severalPacks: (object: string, packs: readonly PackListing[]) =>
      `Object '${object}' has several context packs: ${listed(packs, (face, label) => `${face} ("${label}")`)}. `
      + 'Name the one to read with \'context\', spelt as listed here. Nothing was read.',
    duplicatePack: (object: string, name: string, candidates: readonly PackCandidate[]) =>
      facesApart(candidates)
        ? `Object '${object}' has more than one context pack named '${name}' `
          + `(${candidatesOf(candidates, (face) => face)}), so none of them was read. Name the one to read with `
          + '\'context\', spelt as listed here.'
        : `Object '${object}' has more than one context pack named '${name}' (${candidatesOf(candidates, (face, id) =>
          `${face} of ${id === undefined ? 'the environment' : `package ${id}`}`)}), so none of them was read. `
          + 'Name another of its packs with \'context\', or read the record with get_record.',
    objectRefusedNamed: (pack: string, root: string, object: string) =>
      `Context pack '${pack}' on '${root}' reads object '${object}', which this door does not serve you, so the `
      + 'pack cannot be read for you. Nothing was returned. Read the record with get_record.',
    objectRefusedUnnamed: (pack: string, root: string) =>
      `Context pack '${pack}' on '${root}' reads an object you cannot read, so the pack cannot be read for you. `
      + 'Nothing was returned. Read the record with get_record.',
    anchorUnresolved: (anchor: string) =>
      `No section '${anchor}' can be read through this pack for this record. Call get_record_context without `
      + '\'anchor\' to read the current outline.',
    outlineFromUnresolved: (from: number) =>
      `No page of the body outline starts at ${from} through this pack for this record. Call get_record_context `
      + 'without \'outlineFrom\' to read the current outline.',
    outlineFromWithAnchor:
      '\'anchor\' reads one section and \'outlineFrom\' lists a page of the outline, so a call names one of them, '
      + 'not both. Nothing was read.',
  },
  'zh-Hans': {
    withheldFields: (fields: readonly string[]) =>
      `以下字段对你不可见，因此没有给出它们的值：${fields.join(', ')}。请说明它们对你不可见，不要说它们是空的。`,
    notVisible: '这个资料包涵盖的部分内容对你不可见，因此没有给出。不要把它当作空的或不存在，也不要猜测它。',
    bodyOutline: (field: string) =>
      `正文（${field}）较长，因此只给出了大纲。要读其中一节，请用相同的参数和该节的 anchor 再调用一次 get_record_context。`,
    bodyTruncated: (field: string) => `${field} 的文本在本工具返回的长度处被截断，截断之后的内容没有给出。`,
    relatedTruncated: (object: string, cap: number) =>
      `${object} 上的相关列表超过已给出的 ${cap} 行，其余的行没有给出。`,
    outlineTruncated: (field: string, listed: number, total: number, next: number | undefined, unlistable: number) =>
      `${field} 的大纲本页列出了全部 ${total} 个标题中的 ${listed} 个；各页先按层级从高到低、再按正文顺序排列，`
      + `其余 ${total - listed} 个没有在本页列出。`
      + (next === undefined
        ? '之后没有再列出标题的页。'
        : `要列出下一页，请用相同的参数加上 outlineFrom ${next} 再调用一次 get_record_context。每个标题的 anchor 在列出它的那一页给出。`)
      + (unlistable > 0 ? `其中有 ${unlistable} 个标题太长，任何一页都无法列出，因此没有给出它们的 anchor。` : ''),
    noPackNamed: (context: string, object: string) =>
      `没有名为 '${context}' 的资料包读取对象 '${object}'，因此没有读取任何内容。省略 'context' 以使用该对象唯一的资料包，或用 get_record 读取记录。`,
    noPack: (object: string) => `对象 '${object}' 没有资料包，因此没有读取任何内容。请用 get_record 读取记录。`,
    severalPacks: (object: string, packs: readonly PackListing[]) =>
      `对象 '${object}' 有多个资料包：${listed(packs, (face, label) => `${face}（“${label}”）`)}。`
      + '请用 \'context\' 按这里列出的写法指定要读取的那个。没有读取任何内容。',
    duplicatePack: (object: string, name: string, candidates: readonly PackCandidate[]) =>
      facesApart(candidates)
        ? `对象 '${object}' 有不止一个名为 '${name}' 的资料包（${candidatesOf(candidates, (face) => face)}），`
          + '因此一个都没有读取。请用 \'context\' 按这里列出的写法指定要读取的那个。'
        : `对象 '${object}' 有不止一个名为 '${name}' 的资料包（${candidatesOf(candidates, (face, id) =>
          `${face}（${id === undefined ? '环境的' : `包 ${id} 的`}）`)}），因此一个都没有读取。`
          + '请用 \'context\' 指定它的另一个资料包，或用 get_record 读取记录。',
    objectRefusedNamed: (pack: string, root: string, object: string) =>
      `'${root}' 上的资料包 '${pack}' 会读取对象 '${object}'，而本入口不向你提供它，因此无法为你读取这个资料包。没有返回任何内容。请用 get_record 读取记录。`,
    objectRefusedUnnamed: (pack: string, root: string) =>
      `'${root}' 上的资料包 '${pack}' 会读取一个你无权读取的对象，因此无法为你读取这个资料包。没有返回任何内容。请用 get_record 读取记录。`,
    anchorUnresolved: (anchor: string) =>
      `无法通过这个资料包为这条记录读取章节 '${anchor}'。请不带 'anchor' 调用 get_record_context 以读取当前大纲。`,
    outlineFromUnresolved: (from: number) =>
      `通过这个资料包，这条记录的正文大纲没有从 ${from} 开始的一页。请不带 'outlineFrom' 调用 get_record_context 以读取当前大纲。`,
    outlineFromWithAnchor:
      '\'anchor\' 读取一个章节，\'outlineFrom\' 列出大纲的一页，一次调用只能指定其中一个，不能同时指定。没有读取任何内容。',
  },
} satisfies Record<Locale, Record<string, unknown>>;

/** The executor's sentences for the caller's locale ladder, `en` below all. */
export function sentencesFor(locales: readonly (string | undefined)[]) {
  return WRITTEN[pickSentenceLocale(locales, SENTENCE_LOCALES)];
}
