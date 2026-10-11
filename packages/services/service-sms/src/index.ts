// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export {
  SmsService,
  LogSmsTransport,
  maskPhoneNumber,
  normalizeSmsRecipient,
  type SmsServiceOptions,
} from './sms-service.js';
export { SmsServicePlugin, type SmsServicePluginOptions } from './sms-plugin.js';
// [#22301] What a served boot constructs `SmsServicePlugin` with, from the
// deployment's SMS configuration — read by `@objectstack/core`'s
// `resolveCapabilityArgument` off this module, for `os serve` and for
// `@objectstack/verify`'s `bootStack` alike.
export { resolveSmsCapabilityArg, type SmsCapabilityArg } from './capability-arg.js';
export {
  SmsDailyQuota,
  SMS_QUOTA_EXCEEDED_CODE,
  SMS_QUOTA_EXCEEDED_ERROR,
  normalizeDailyQuota,
  secondsUntilNextUtcMidnight,
  utcDayStamp,
  type SmsDailyQuotaDecision,
  type SmsDailyQuotaOptions,
  type NormalizedDailyQuota,
} from './sms-daily-quota.js';
export {
  makeSmsTransport,
  SMS_TRANSPORT_PROVIDERS,
  isSmsTransportProvider,
  AliyunSmsTransport,
  TwilioSmsTransport,
  type SmsProviderTag,
  type MakeSmsTransportOptions,
  type AliyunSmsTransportOptions,
  type TwilioSmsTransportOptions,
} from './transports/index.js';
