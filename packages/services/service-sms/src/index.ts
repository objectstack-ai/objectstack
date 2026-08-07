// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

export {
  SmsService,
  LogSmsTransport,
  maskPhoneNumber,
  normalizeSmsRecipient,
  type SmsServiceOptions,
} from './sms-service.js';
export { SmsServicePlugin, type SmsServicePluginOptions } from './sms-plugin.js';
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
