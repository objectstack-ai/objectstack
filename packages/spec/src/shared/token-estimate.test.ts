// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ASCII_RUN_CHARS_PER_TOKEN, estimateTokens, TOKEN_ESTIMATE_MARGIN } from './token-estimate';

describe('estimateTokens — the formula', () => {
  it('estimates an empty or all-whitespace text at 0', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(' \n\t  ')).toBe(0);
  });

  it('counts the ideographic space U+3000 as whitespace, 0', () => {
    expect(estimateTokens('\u3000')).toBe(0);
    expect(estimateTokens('\u3000\u3000 \n')).toBe(0);
    // 第七条(4.5) + 纳税人(4.5), the indent between them 0 → 9 → 9.9 → 10
    expect(estimateTokens('第七条\u3000纳税人')).toBe(10);
  });

  it('counts a CJK character 1.5, then × 1.1 rounded up', () => {
    // 2 × 1.5 = 3 → 3.3 → 4
    expect(estimateTokens('数据')).toBe(4);
    // 10 × 1.5 = 15 → 16.5 → 17
    expect(estimateTokens('数据安全法第二十一条')).toBe(Math.ceil(10 * 1.5 * TOKEN_ESTIMATE_MARGIN));
  });

  it('counts full-width punctuation 1.5', () => {
    // 。，（）： — 5 × 1.5 = 7.5 → 8.25 → 9
    expect(estimateTokens('。，（）：')).toBe(9);
  });

  it('does not round an exact product up an extra token', () => {
    // 10 runs → 10 × 1.1 = 11 exactly (11.000000000000002 in binary floating point)
    expect(estimateTokens('a b c d e f g h i j')).toBe(11);
  });

  it('counts an ASCII run by what it holds: letters ceil(n/4), digits ceil(n/3), mixed ceil(n/2)', () => {
    expect(ASCII_RUN_CHARS_PER_TOKEN).toEqual({ letters: 4, digits: 3, mixed: 2 });
    // letters only: 20 → 5 → 5.5 → 6
    expect(estimateTokens('internationalization')).toBe(6);
    // digits only: 8 → 3 → 3.3 → 4
    expect(estimateTokens('12345678')).toBe(4);
    // mixed: 8 → 4 → 4.4 → 5; a 24-char mixed run → 12 → 13.2 → 14
    expect(estimateTokens('a1b2c3d4')).toBe(5);
    expect(estimateTokens('internationalization2026')).toBe(14);
    // alpha(2) + beta(1) + gamma(2) = 5 → 5.5 → 6
    expect(estimateTokens('alpha beta gamma')).toBe(6);
    // a 4-char run is 1, a 5-char run is 2: 1 → 2, 2 → 3
    expect(estimateTokens('abcd')).toBe(2);
    expect(estimateTokens('abcde')).toBe(3);
  });

  it('counts other punctuation 1 each and breaks a run', () => {
    // text(1) + -(1) + embedding(3) + -(1) + 3(1) = 7 → 7.7 → 8
    expect(estimateTokens('text-embedding-3')).toBe(8);
  });

  it('counts a mixed text term by term', () => {
    // 使用(3) + OpenAI(2) + 模型(3) + ，(1.5) + 8192(2) + 个(1.5) + token(2) + 。(1.5) = 16.5 → 18.15 → 19
    expect(estimateTokens('使用 OpenAI 模型，8192 个 token。')).toBe(19);
  });
});

/**
 * Reference counts under OpenAI's `cl100k_base` encoding, sampled 2026-11-24
 * with `js-tiktoken` 1.0.21 (`getEncoding('cl100k_base').encode(text).length`)
 * run outside this repository: no tokenizer is a workspace dependency, and
 * none is added for one test. Re-measure the same way when a sample changes.
 * Other tokenizers (DashScope, BigModel, BGE) are not sampled here — they
 * cannot run in CI.
 */
const CL100K_SAMPLES: ReadonlyArray<readonly [id: string, cl100k: number, text: string]> = [
  ['zh-regulation-1', 69, '第一条 为了规范数据处理活动，保障数据安全，促进数据开发利用，保护个人、组织的合法权益，维护国家主权、安全和发展利益，制定本法。'],
  ['zh-regulation-2', 159, '第二十一条 国家建立数据分类分级保护制度，根据数据在经济社会发展中的重要程度，以及一旦遭到篡改、破坏、泄露或者非法获取、非法利用，对国家安全、公共利益或者个人、组织合法权益造成的危害程度，对数据实行分类分级保护。国家数据安全工作协调机制统筹协调有关部门制定重要数据目录，加强对重要数据的保护。'],
  ['zh-regulation-3', 198, '第四十五条 开展数据处理活动的组织、个人不履行本法第二十七条、第二十九条、第三十条规定的数据安全保护义务的，由有关主管部门责令改正，给予警告，可以并处五万元以上五十万元以下罚款，对直接负责的主管人员和其他直接责任人员可以处一万元以上十万元以下罚款；拒不改正或者造成大量数据泄露等严重后果的，处五十万元以上二百万元以下罚款，并可以责令暂停相关业务、停业整顿、吊销相关业务许可证或者吊销营业执照。'],
  ['zh-regulation-4', 144, '（一）劳动者在本单位连续工作满十年的；（二）连续订立二次固定期限劳动合同，且劳动者没有本法第三十九条和第四十条第一项、第二项规定的情形，续订劳动合同的。用人单位自用工之日起满一年不与劳动者订立书面劳动合同的，视为用人单位与劳动者已订立无固定期限劳动合同。'],
  ['zh-regulation-5', 92, '第七条　纳税人应当依照本条例规定，按月或者按季申报缴纳税款；具体纳税期限由主管税务机关根据纳税人应纳税额的大小分别核定。不能按照固定期限纳税的，可以按次纳税。'],
  ['mixed-1', 48, '使用 OpenAI 的 text-embedding-3-small 模型时，每条输入最多 8192 个 token；超过上限会被拒绝，而不是被截断。'],
  ['mixed-2', 58, '在 ObjectStack 中，service-knowledge 通过 IEmbedder 接口调用 embedder-openai，把 chunk 写入 vector store。若 embed() 抛出 error，同步任务会记录失败并在下一次 sync 时重试。'],
  ['mixed-3', 86, '根据《个人信息保护法》（PIPL）第 38 条，向境外提供个人信息应当通过 CAC 组织的安全评估，或者经专业机构进行 personal information protection certification，或按照标准合同（SCC）与境外接收方订立合同。'],
  ['mixed-4', 85, '部署步骤：1. 运行 pnpm install；2. 设置 OS_DATABASE_URL=postgres://user@localhost:5432/app；3. 执行 os migrate meta --stored --apply；4. 启动服务 pnpm dev -- --fresh -p 38421，然后访问 http://localhost:38421/api/v1/discovery 确认。'],
  ['mixed-5', 81, 'Q3 营收同比增长 23.5%，达到 RMB 1,280 万元；其中 SaaS 订阅收入占比 67%，ARR 突破 USD 2.1M。CEO 表示 2027 年将重点投入 AI Agent 与 RAG 能力建设。'],
];

/**
 * English-heavy reference counts — long words, identifiers, code, URLs, figures
 * and digit runs — sampled the same way and on the same date as
 * {@link CL100K_SAMPLES}. They pin the ASCII-run rule: one token per run, the
 * rule this module first shipped with, falls below cl100k on six of the first
 * eight. The last two pin the run classes — a 20-digit run is below cl100k
 * unless digits count ceil(n/3), a URL carrying a 32-hex id unless a mixed run
 * counts ceil(n/2).
 */
const CL100K_ENGLISH_SAMPLES: ReadonlyArray<readonly [id: string, cl100k: number, text: string]> = [
  ['en-long-words', 22, 'Internationalization, telecommunications infrastructure, counterrevolutionaries and electroencephalography characterize interdisciplinary microarchitectures.'],
  ['en-identifiers', 25, 'SELECT customerAccountIdentifier, organizationSubscriptionTier FROM sys_organization_subscription WHERE subscriptionRenewalTimestamp > 1732492800000'],
  ['en-code', 45, 'export async function reconcileSubscriptionEntitlements(organizationIdentifier: string, entitlementSnapshot: EntitlementSnapshot): Promise<ReconciliationOutcome> { return await entitlementReconciler.reconcile(organizationIdentifier, entitlementSnapshot); }'],
  ['en-url', 40, 'See https://docs.siliconflow.com/en/api-reference/embeddings/create-embeddings and https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api for the limits.'],
  ['en-numbers', 45, 'Revenue grew 23.5% to 12,800,000 in Q3 2026; ARR reached 2,100,000 and churn fell to 1.8% across 4,215 accounts.'],
  ['en-digits-12', 8, 'Order 123456789012 shipped.'],
  ['en-digits-8', 7, 'Order 12345678 shipped.'],
  ['en-prose', 25, 'The embedder refuses an input whose estimate exceeds the model\'s documented limit, so the provider never silently truncates the text.'],
  ['en-digits-20', 36, 'Account 4532015112830366 transferred 98765432109876543210 units at 20261125013045 under ledger 31415926535897932384.'],
  ['en-url-hex-id', 58, 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings?model=text-embedding-v3&requestIdentifier=a7f3c9e2b4d8f1e6a0c5b9d3e7f2a4c8'],
];

describe('estimateTokens — never below cl100k on Chinese, mixed and English-heavy text', () => {
  it.each(CL100K_SAMPLES)('%s (cl100k %i)', (_id, cl100k, text) => {
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(cl100k);
  });

  it.each(CL100K_ENGLISH_SAMPLES)('%s (cl100k %i)', (_id, cl100k, text) => {
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(cl100k);
  });

  it('covers both Chinese regulation-like and mixed Chinese/English samples', () => {
    const ids = CL100K_SAMPLES.map(([id]) => id);
    expect(ids.filter((id) => id.startsWith('zh-regulation-')).length).toBeGreaterThanOrEqual(5);
    expect(ids.filter((id) => id.startsWith('mixed-')).length).toBeGreaterThanOrEqual(5);
  });
});
