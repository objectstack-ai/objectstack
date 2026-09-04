// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14676 — `integration/ErrorMappingRule` (`sourceCode`, `sourceMessage`,
// `targetCode`, `targetCategory`, `severity`, `retryable`, `userMessage`) leaves
// with `integration/ErrorMappingConfig`, whose `rules[]` was its only carrier.
// The `userMessage` member is the reason the census filed the card: its
// `describe` read, to the letter, like the LIVE `ApiError.userMessage` channel
// (the user-facing refusal text a thrown HTTP error declares), while no code
// path ever read this one — two keys meaning different things under one
// spelling in the same spec package. Deletion resolves the collision without a
// rename. See `retired-keys/18.integration__Connector__errorMapping.ts` for the
// retirement record.
export const entry = 'integration/ErrorMappingRule';
