// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { PlatformTranslationData } from '@objectstack/spec/system';
import { countryOptionLabels } from '../manifests/company.manifest.js';

/**
 * العربية (ar) — built-in settings manifest translations.
 */
export const ar: PlatformTranslationData = {
  settingsCommon: {
    sourceLabels: { env: 'متغير بيئة', global: 'عام', tenant: 'المؤسسة', user: 'المستخدم', default: 'افتراضي' },
  },
  settings: {
    mail: {
      title: 'إرسال البريد',
      description: 'إعداد SMTP ومزوّد البريد الإلكتروني للمعاملات.',
      groups: {
        provider: { title: 'المزوّد', description: 'اختر طريقة إرسال هذا النظام للبريد الصادر.' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'مفتاح API' },
        from_address: { title: 'عنوان المرسِل' },
        delivery: { title: 'التسليم', description: 'كيف يُسلَّم البريد الصادر إلى المزوّد.' },
      },
      keys: {
        provider: {
          label: 'المزوّد',
          help: 'لا تُعرض إلا المزوّدات التي يستطيع هذا الخادم الإرسال عبرها فعلًا. يُضبط SendGrid وAmazon SES على أنهما SMTP.',
          options: { smtp: 'SMTP', resend: 'Resend', postmark: 'Postmark', log: 'لا شيء (تسجيل فقط — دون إرسال فعلي)' },
        },
        smtp_host: { label: 'المضيف', help: 'مثال: smtp.example.com' },
        smtp_port: { label: 'المنفذ' },
        smtp_secure: { label: 'استخدام TLS' },
        smtp_user: { label: 'اسم المستخدم' },
        smtp_password: { label: 'كلمة المرور' },
        api_key: { label: 'مفتاح API' },
        from_email: { label: 'بريد المرسِل', help: 'مثال: no-reply@example.com' },
        from_name: {
          label: 'اسم المرسِل',
          help: 'اتركه فارغًا لاستخدام اسم المنتج (العلامة التجارية)، أو الاسم الذي أُعِدّ به هذا النشر.',
        },
        queue_delivery: {
          label: 'التسليم عبر قائمة انتظار دائمة',
          help: 'تُسلَّم كل رسالة إلى قائمة انتظار المهام بدل إرسالها مباشرةً، فيعيد العامل (worker) محاولة التسليم الفاشل مع تأخير متزايد، ويبقى التسليم بعد إعادة التشغيل. يتطلب قدرة قائمة الانتظار مع محوّل دائم. يُرسَل «إرسال بريد تجريبي» مباشرةً دائمًا.',
        },
      },
      actions: {
        test: { label: 'إرسال بريد تجريبي' },
      },
    },
    sms: {
      title: 'إرسال الرسائل النصية',
      description: 'إعداد مزوّد الرسائل النصية لتسجيل الدخول برمز OTP والدعوات والإشعارات.',
      groups: {
        provider: { title: 'المزوّد', description: 'اختر طريقة إرسال هذا النظام للرسائل النصية الصادرة.' },
        aliyun: { title: 'Aliyun SMS' },
        twilio: { title: 'Twilio' },
        limits: {
          title: 'حدود الإنفاق',
          description: 'يحدّ من حجم الرسائل النصية الصادرة من هذا النشر. الرسائل النصية قناة مدفوعة، وكل إرسال له تكلفة حقيقية.',
        },
      },
      keys: {
        provider: {
          label: 'المزوّد',
          options: { log: 'لا شيء (تسجيل فقط — دون إرسال فعلي)', aliyun: 'Aliyun SMS (阿里云短信)', twilio: 'Twilio' },
        },
        aliyun_access_key_id: { label: 'AccessKey ID' },
        aliyun_access_key_secret: { label: 'AccessKey Secret' },
        aliyun_sign_name: { label: 'اسم التوقيع (短信签名)' },
        aliyun_template_code: {
          label: 'رمز القالب الافتراضي (短信模板)',
          help: 'يُستخدم عندما لا يحدد الإرسال قالبًا صريحًا. يتيح قالب عام بمتغير ${content} واحد إرسال رسائل إشعارات عامة.',
        },
        twilio_account_sid: { label: 'Account SID' },
        twilio_auth_token: { label: 'رمز المصادقة (Auth token)' },
        twilio_from_number: {
          label: 'رقم المرسِل',
          help: 'المرسِل بصيغة E.164، مثل +15005550006. إمّا هذا وإمّا Messaging Service SID.',
        },
        twilio_messaging_service_sid: { label: 'Messaging Service SID' },
        daily_quota: {
          label: 'حد الإرسال اليومي',
          help: 'الحد الأقصى للرسائل النصية التي يرسلها هذا النشر في اليوم بتوقيت UTC، عبر تسجيل الدخول برمز OTP والدعوات والإشعارات. القيمة 0 تعني بلا حد. يُرفض الإرسال الذي يتجاوز الحد حتى الساعة 00:00 UTC.',
        },
      },
      actions: {
        test: { label: 'إرسال رسالة نصية تجريبية' },
      },
    },
    branding: {
      title: 'العلامة التجارية',
      description: 'الاسم والشعار واللون الذي تعرضه وحدة التحكم وصفحة تسجيل الدخول. القيمة غير المضبوطة ترجع إلى العلامة التجارية للنشر نفسه.',
      groups: {
        identity: { title: 'الهوية' },
        appearance: { title: 'المظهر' },
      },
      keys: {
        workspace_name: {
          label: 'اسم المنتج',
          help: 'اسم المنتج في وحدة التحكم وصفحة تسجيل الدخول وعنوان المتصفح، وفي رسائل تسجيل الدخول وتطبيق المصادقة وتسجيل الدخول عبر MCP. اتركه فارغًا لاستخدام الاسم الذي أُعِدّ به هذا النشر. هذا ليس اسم المؤسسة نفسها، وهو «الاسم» في سجل المؤسسة.',
        },
        accent_color: {
          label: 'لون التمييز',
          help: 'لون سمة المتصفح والتطبيق المثبّت. يحتفظ كل تطبيق بألوانه الخاصة.',
        },
        logo_url: {
          label: 'رابط الشعار',
          help: 'يظهر في صفحة تسجيل الدخول وشاشة التحميل ورأس الصفحة الرئيسية. مثال: https://…/logo.svg',
        },
      },
    },
    company: {
      title: 'الشركة',
      description: 'هوية الكيان القانوني — الاسم المسجَّل والعنوان والأرقام الضريبية وجهة الاتصال الرئيسية.',
      groups: {
        identity: { title: 'الهوية' },
        address: { title: 'العنوان المسجَّل' },
        contact: { title: 'جهة الاتصال' },
      },
      keys: {
        legal_name: { label: 'الاسم القانوني', help: 'الاسم القانوني المسجَّل للمؤسسة كما يظهر في العقود والفواتير.' },
        registration_number: { label: 'رقم التسجيل', help: 'رقم تسجيل الشركة أو تأسيسها (مثل EIN).' },
        tax_id: { label: 'الرقم الضريبي / ضريبة القيمة المضافة', help: 'يظهر في الفواتير (مثل VAT وGST وABN).' },
        address_line1: { label: 'سطر العنوان 1' },
        address_line2: { label: 'سطر العنوان 2' },
        city: { label: 'المدينة' },
        state: { label: 'الولاية / المقاطعة' },
        postal_code: { label: 'الرمز البريدي' },
        country: {
          label: 'البلد',
          help: 'بلد العنوان المسجَّل. اكتب اسم البلد واختره من القائمة.',
          options: countryOptionLabels('ar'),
        },
        phone: { label: 'الهاتف', help: 'يُفضَّل تنسيق E.164، مثل +1 415 555 0100.' },
        website: { label: 'الموقع الإلكتروني', help: 'مثال: https://example.com' },
        primary_contact_name: { label: 'اسم جهة الاتصال الرئيسية' },
        primary_contact_email: { label: 'بريد جهة الاتصال الرئيسية', help: 'مثال: ops@example.com' },
      },
    },
    localization: {
      title: 'الترجمة والإعدادات المحلية',
      description: 'المنطقة الزمنية واللغة والبلد والعملة والسنة المالية الافتراضية.',
      groups: {
        region: { title: 'المنطقة' },
        finance: { title: 'المالية' },
      },
      keys: {
        timezone: {
          label: 'المنطقة الزمنية الافتراضية',
          help: 'تحدد معنى «اليوم» في الصيغ، وكيف تجمّع التقارير التواريخ، وكيف تُعرض التواريخ والأوقات. تقبل أي اسم منطقة زمنية من IANA (مثل Asia/Dubai). هذه هي المنطقة الزمنية السارية للمؤسسة: حقل «المنطقة الزمنية» في سجل المؤسسة لا يغيّرها.',
          options: {
            UTC: 'UTC',
            'America/Los_Angeles': '(UTC−08/−07) لوس أنجلوس',
            'America/Denver': '(UTC−07/−06) دنفر',
            'America/Chicago': '(UTC−06/−05) شيكاغو',
            'America/New_York': '(UTC−05/−04) نيويورك',
            'America/Sao_Paulo': '(UTC−03) ساو باولو',
            'Europe/London': '(UTC±00/+01) لندن',
            'Europe/Paris': '(UTC+01/+02) باريس',
            'Europe/Berlin': '(UTC+01/+02) برلين',
            'Europe/Moscow': '(UTC+03) موسكو',
            'Asia/Dubai': '(UTC+04) دبي',
            'Asia/Kolkata': '(UTC+05:30) كولكاتا',
            'Asia/Singapore': '(UTC+08) سنغافورة',
            'Asia/Shanghai': '(UTC+08) شنغهاي',
            'Asia/Tokyo': '(UTC+09) طوكيو',
            'Australia/Sydney': '(UTC+10/+11) سيدني',
            'Pacific/Auckland': '(UTC+12/+13) أوكلاند',
          },
        },
        locale: { label: 'اللغة الافتراضية', help: 'لغة BCP-47 لكتالوجات الرسائل وتنسيق الأرقام والتواريخ.' },
        default_country: {
          label: 'البلد الافتراضي',
          help: 'يُستخدم قيمةً افتراضية للعناوين والهواتف. اكتب اسم البلد واختره من القائمة.',
          options: countryOptionLabels('ar'),
        },
        currency: {
          label: 'العملة الافتراضية',
          help: 'رمز ISO 4217 يُطبَّق عندما لا يحدد حقل العملة رمزه الخاص. اتركه غير مضبوط لعرض المبالغ التي بلا رمز أرقامًا عادية.',
          options: {
            USD: 'USD — دولار أمريكي',
            EUR: 'EUR — يورو',
            GBP: 'GBP — جنيه إسترليني',
            JPY: 'JPY — ين ياباني',
            CNY: 'CNY — يوان صيني',
            INR: 'INR — روبية هندية',
            AUD: 'AUD — دولار أسترالي',
            CAD: 'CAD — دولار كندي',
            BRL: 'BRL — ريال برازيلي',
          },
        },
        fiscal_year_start: {
          label: 'بداية السنة المالية',
          help: 'الشهر الأول من السنة المالية — يحدد «هذا الربع / هذه السنة المالية» في التقارير.',
          options: {
            january: 'يناير',
            february: 'فبراير',
            march: 'مارس',
            april: 'أبريل',
            may: 'مايو',
            june: 'يونيو',
            july: 'يوليو',
            august: 'أغسطس',
            september: 'سبتمبر',
            october: 'أكتوبر',
            november: 'نوفمبر',
            december: 'ديسمبر',
          },
        },
      },
    },
    auth: {
      title: 'المصادقة',
      description: 'عناصر التحكم في تسجيل الدخول والتسجيل وميزات المصادقة المدمجة.',
      groups: {
        email_password: {
          title: 'البريد الإلكتروني وكلمة المرور',
          description: 'التحكم في تسجيل الدخول المحلي بالبريد الإلكتروني وكلمة المرور وفي التسجيل الذاتي.',
        },
        membership: {
          title: 'العضوية',
          description: 'ما الذي ينضم إليه المستخدم الجديد. يُضبط مع التسجيل الذاتي أعلاه.',
        },
        audience: {
          title: 'الجمهور',
          description: 'من يمكنه أن يصبح مستخدمًا لتطبيقات هذا النظام. نطاقات البريد المسموح بها تفرض التحقق من البريد دائمًا. الوضع «مفتوح» يفرضه ما لم يُعطِّله النشر؛ ولا يمكن لقيمة محفوظة في وحدة التحكم هذه تعطيله. تُقبل الدعوات والمستخدمون الذين ينشئهم المسؤول وتزويد SCIM وتسجيل الدخول الموحَّد للمؤسسات (SSO) في كل الأوضاع.',
        },
        password_policy: {
          title: 'سياسة كلمات المرور',
          description: 'حدود الطول التي يفرضها مزوّد المصادقة عند التسجيل وإعادة تعيين كلمة المرور.',
        },
        anti_abuse: {
          title: 'مكافحة إساءة الاستخدام',
          description: 'الحماية من هجمات القوة الغاشمة: قفل الحساب لكل هوية وتحديد معدل الطلبات لكل عنوان IP على نقاط نهاية المصادقة.',
        },
        multi_factor: { title: 'متعدد العوامل', description: 'إلزام الأعضاء بحماية حساباتهم بتطبيق مصادقة (TOTP).' },
        sessions: { title: 'الجلسات', description: 'مدة بقاء جلسة تسجيل الدخول صالحة.' },
        network: { title: 'الشبكة', description: 'تقييد الأماكن التي يمكن للمستخدمين المصادقة منها.' },
        api_keys: {
          title: 'مفاتيح API',
          description: 'مدة صلاحية مفاتيح API الشخصية. يُرفض المفتاح الذي انتهت صلاحيته أو ظل دون استخدام بعد فترة عدم النشاط أو أُلغي، برمز خطأ خاص به، والعلاج دائمًا مفتاح جديد.',
        },
        social: {
          title: 'تسجيل الدخول عبر الشبكات الاجتماعية',
          description: 'إعداد مزوّد تسجيل الدخول المدمج عبر Google. بيانات الاعتماد المضبوطة في إعدادات الخادم تبقى لها الأولوية.',
        },
      },
      keys: {
        email_password_enabled: {
          label: 'تفعيل تسجيل الدخول بالبريد الإلكتروني وكلمة المرور',
          confirmOffText: 'سيحتاج من يسجّلون الدخول بكلمة مرور إلى طريقة أخرى للدخول.',
        },
        signup_enabled: {
          label: 'السماح بالتسجيل بالبريد الإلكتروني',
          help: 'يفتح نموذج التسجيل بالبريد الإلكتروني وكلمة المرور. ومن يقبلهم يحدده «جمهور التسجيل الذاتي» أدناه: في وضع «بالدعوة فقط» لا يُقبل إلا عنوان لديه دعوة معلّقة؛ وفي «نطاقات البريد المسموح بها» تُقبل النطاقات المسموح بها والعناوين المدعوّة؛ وفي «مفتوح» يُقبل أي شخص. الإيقاف يغلق النموذج في كل الأوضاع، بما في ذلك الدعوات.',
        },
        require_email_verification: { label: 'طلب التحقق من البريد الإلكتروني' },
        membership_policy: {
          label: 'عضوية المستخدم الجديد',
          help: '«تلقائي» يربط كل مستخدم جديد بالمؤسسة الافتراضية. «بالدعوة فقط» يمنح العضوية بإجراء صريح فقط — إنشاء مؤسسة، أو قبول دعوة، أو إضافته من قِبل مسؤول، أو التزويد الفوري عبر SSO.',
          options: {
            auto: 'الانضمام إلى المؤسسة الافتراضية تلقائيًا',
            'invite-only': 'بالدعوة فقط — لا انضمام تلقائي أبدًا',
          },
        },
        audience_posture: {
          label: 'جمهور التسجيل الذاتي',
          help: '«بالدعوة فقط» يغلق التسجيل الذاتي: لا يصبح الأشخاص مستخدمين إلا عندما يدعوهم مسؤول أو ينشئهم أو يستوردهم، أو عبر تزويد الدليل (SCIM) أو تسجيل الدخول الموحَّد للمؤسسات. «نطاقات البريد المسموح بها» يفتحه للنطاقات المدرجة أدناه. «مفتوح» يقبل أي شخص. يحتاج كلٌّ من «نطاقات البريد المسموح بها» و«مفتوح» إلى ضبط مجموعة أذونات التسجيل الذاتي أدناه. «نطاقات البريد المسموح بها» يتطلب التحقق من البريد دائمًا. «مفتوح» يتطلبه ما لم تُعطِّله إعدادات الخادم؛ ويُرفض تعطيله من وحدة التحكم هذه في وضع «مفتوح».',
          options: {
            invite_only: 'بالدعوة فقط — دون تسجيل ذاتي (افتراضي)',
            email_domain: 'نطاقات البريد المسموح بها فقط',
            open: 'مفتوح — يمكن لأي شخص التسجيل ذاتيًا',
          },
        },
        audience_allowed_email_domains: {
          label: 'نطاقات البريد المسموح بها',
          help: 'نطاقات مجردة، واحد في كل سطر أو مفصولة بفواصل (مثل acme.com). المطابقة تامة ولا تراعي حالة الأحرف؛ تحتاج النطاقات الفرعية إلى إدخالات خاصة بها؛ ولا أحرف بدل.',
        },
        audience_self_registration_permission_set: {
          label: 'مجموعة أذونات التسجيل الذاتي',
          help: 'اسم مجموعة الأذونات التي يحصل عليها كل مستخدم سجّل ذاتيًا. مجموعة الأعضاء القياسية مناسبة؛ وتُرفض مجموعة المسؤول الكاملة. مطلوب كلما سمح الجمهور بالتسجيل الذاتي.',
        },
        password_min_length: { label: 'الحد الأدنى لطول كلمة المرور' },
        password_max_length: {
          label: 'الحد الأقصى لطول كلمة المرور',
          help: 'يحمي من حجب الخدمة عبر تجزئة كلمات مرور طويلة جدًا.',
        },
        password_reject_breached: {
          label: 'رفض كلمات المرور المسرَّبة',
          help: 'حظر كلمات المرور الموجودة في مجموعات التسريبات العامة عبر Have I Been Pwned (فحص نطاق بإخفاء الهوية k؛ لا تُرسَل كلمة المرور كاملةً أبدًا).',
        },
        password_require_complexity: {
          label: 'طلب كلمات مرور معقدة',
          help: 'إلزام كلمات المرور بالجمع بين فئات أحرف (كبيرة وصغيرة وأرقام ورموز) عند التسجيل وتغيير كلمة المرور أو إعادة تعيينها.',
        },
        password_min_classes: {
          label: 'الحد الأدنى لفئات الأحرف',
          help: 'كم فئة من الفئات الأربع (كبيرة / صغيرة / رقم / رمز) يجب أن تتضمنها كلمة المرور.',
        },
        password_history_count: {
          label: 'سجل كلمات المرور (دون إعادة استخدام)',
          help: 'منع إعادة استخدام هذا العدد من كلمات المرور السابقة عند التغيير أو إعادة التعيين. القيمة 0 تعطّل الفحص.',
        },
        password_expiry_days: {
          label: 'انتهاء صلاحية كلمة المرور (أيام)',
          help: 'فرض تغيير كلمة المرور بعد هذا العدد من الأيام. القيمة 0 تعطّل الانتهاء. أثناء انتهاء الصلاحية يُمنع المستخدم من الوصول إلى البيانات حتى يغيّر كلمة المرور.',
        },
        lockout_threshold: {
          label: 'حد قفل الحساب',
          help: 'قفل الحساب بعد هذا العدد من محاولات تسجيل الدخول الفاشلة المتتالية — كلمات المرور الخاطئة ورموز التحقق الثنائي الخاطئة على حدٍّ سواء. أثناء القفل يُرفض تسجيل الدخول حتى ببيانات اعتماد صحيحة. القيمة 0 تعطّل قفل مرحلة كلمة المرور؛ ويحتفظ التحقق الثنائي حينها بحده المدمج البالغ 10 محاولات كل 15 دقيقة، لأنه آخر فحص قبل إصدار الجلسة.',
        },
        lockout_duration_minutes: {
          label: 'مدة القفل (دقائق)',
          help: 'مدة بقاء الحساب مقفلًا بعد تجاوز الحد، في أي من مرحلتي تسجيل الدخول.',
        },
        rate_limit_max: {
          label: 'تحديد معدل المصادقة: الحد الأقصى للطلبات',
          help: 'الحد الأقصى للطلبات لكل IP في كل نافذة زمنية إلى نقاط نهاية تسجيل الدخول / التسجيل / إعادة تعيين كلمة المرور.',
        },
        rate_limit_window_seconds: {
          label: 'تحديد معدل المصادقة: النافذة (ثوانٍ)',
          help: 'النافذة المنزلقة التي يُحسب خلالها حد الطلبات أعلاه.',
        },
        mfa_required: {
          label: 'طلب المصادقة متعددة العوامل',
          options: { off: 'متوقف', administrators: 'المسؤولون', everyone: 'الجميع' },
          help: 'يُمنع المستخدمون الذين لم يسجّلوا تطبيق مصادقة من الوصول إلى البيانات بعد انتهاء فترة السماح. تفعيل هذا الخيار يشغّل أيضًا ميزة التحقق الثنائي ليتمكن المستخدمون من التسجيل.',
        },
        mfa_grace_period_days: {
          label: 'فترة السماح لـ MFA (أيام)',
          help: 'المدة التي يمكن للمستخدمين خلالها تأجيل التسجيل قبل الحظر الصارم. القيمة 0 تحظر فورًا.',
        },
        session_expiry_days: {
          label: 'مدة الجلسة (أيام)',
          help: 'تنتهي الجلسة بعد هذا العدد من الأيام من تسجيل الدخول.',
        },
        session_refresh_days: {
          label: 'حد التجديد (أيام)',
          help: 'تُمدَّد الجلسة النشطة عندما يتجاوز عمرها هذه المدة.',
        },
        session_idle_timeout_minutes: {
          label: 'مهلة الخمول (دقائق)',
          help: 'تسجيل خروج المستخدم بعد هذا العدد من دقائق عدم النشاط. القيمة 0 تعطّل ذلك.',
        },
        session_absolute_max_hours: {
          label: 'المدة المطلقة للجلسة (ساعات)',
          help: 'فرض إعادة المصادقة بعد هذا العدد من الساعات من تسجيل الدخول، بغض النظر عن النشاط. القيمة 0 تعطّل ذلك.',
        },
        max_concurrent_sessions_per_user: {
          label: 'الحد الأقصى للجلسات المتزامنة لكل مستخدم',
          help: 'تحديد عدد الجلسات المتزامنة لكل مستخدم؛ ويُسجَّل خروج الأقدم عند تجاوز الحد. 0 = بلا حد.',
        },
        allowed_ip_ranges: {
          label: 'نطاقات IP المسموح بها',
          help: 'نطاقات CIDR أو عناوين IP محددة (واحد في كل سطر أو مفصولة بفواصل)، مثل 203.0.113.0/24. عند ضبطها يُرفض تسجيل الدخول من خارج هذه النطاقات، وكذلك أي طلب لا يستطيع الخادم تحديد عنوان عميله. فارغ = بلا تقييد. العنوان الذي يُحكم عليه هو عنوان مصدر الاتصال؛ وخلف وكيل عكسي يجب ضبط الخادم ليثق بذلك الوكيل حتى يُحكم على عنوان العميل الأصلي بدلًا منه.',
        },
        api_key_default_expiry_days: {
          label: 'المدة الافتراضية للمفتاح (أيام)',
          help: 'المفتاح الذي يُنشأ دون تاريخ انتهاء تنتهي صلاحيته بعد هذا العدد من الأيام من إنشائه. ولا يتجاوز أبدًا المدة القصوى أدناه.',
        },
        api_key_max_expiry_days: {
          label: 'المدة القصوى للمفتاح (أيام)',
          help: 'أبعد تاريخ انتهاء يمكن أن يطلبه مفتاح جديد، محسوبًا من إنشائه. يُرفض الأطول؛ ويُقبل هذا العدد من الأيام تمامًا.',
        },
        api_key_inactivity_days: {
          label: 'انتهاء بسبب عدم النشاط (أيام)',
          help: 'يُرفض المفتاح الذي لا يوجد له استخدام مسجَّل طوال هذا العدد من الأيام. لا يُلغى؛ أنشئ مفتاحًا جديدًا. المفتاح الذي لم يُستخدم قط يُحسب من إنشائه، أو من بدء السياسة أدناه إن كان أقدم. القيمة 0 تعطّل الانتهاء بسبب عدم النشاط.',
        },
        api_key_policy_started_at: {
          label: 'بدء سياسة المفاتيح في',
          help: 'يُسجَّل تلقائيًا (UTC، ISO 8601) في أول مرة يعمل فيها الخادم بهذه السياسة. المفاتيح التي أُنشئت قبله دون تاريخ انتهاء تنتهي بعده بسنة؛ والمفاتيح التي لا استخدام مسجَّل لها تحسب عدم نشاطها منه. تغييره ينقل كلا التاريخين للمفاتيح التي لم تحصل عليهما بعد.',
        },
        google_enabled: {
          label: 'تفعيل تسجيل الدخول عبر Google',
          help: 'يتيح تسجيل الدخول عبر Google متى توفر معرّف العميل وسر العميل معًا: محفوظَين أدناه، أو مضبوطَين في إعدادات الخادم التي لها الأولوية على القيم المحفوظة. وحتى يتوفرا لا تعرض صفحة تسجيل الدخول زر Google، حتى مع تشغيل هذا الخيار. الإيقاف يسحب تسجيل الدخول عبر Google حتى لو ضبطهما الخادم. أنشئ عميل OAuth في Google Cloud Console.',
        },
        google_client_id: {
          label: 'معرّف عميل Google',
          help: 'معرّف عميل OAuth من Google Cloud Console. ويمكن ضبطه أيضًا في إعدادات الخادم.',
        },
        google_client_secret: { label: 'سر عميل Google', help: 'يُخزَّن مشفّرًا. ويمكن ضبطه أيضًا في إعدادات الخادم.' },
      },
    },
    access_policy: {
      title: 'سياسة الوصول',
      description: 'قيود تسجيل الدخول لهذه المؤسسة. تنطبق إعدادات المصادقة في النشر دائمًا؛ ولا يمكن لهذه الإعدادات إلا أن تضيف إليها.',
      groups: {
        network: { title: 'الشبكة', description: 'من أين يمكن لأعضاء هذه المؤسسة تسجيل الدخول.' },
        sessions: { title: 'الجلسات', description: 'مدة صلاحية جلسة العضو. لا يمكن لأي حد إلا أن يكون أقصر من حد النشر.' },
        multi_factor: { title: 'المصادقة متعددة العوامل', description: 'من في هذه المؤسسة يجب أن يحمي حسابه بتطبيق مصادقة (TOTP).' },
      },
      keys: {
        allowed_ip_ranges: { label: 'نطاقات IP المسموح بها' },
        session_idle_timeout_minutes: { label: 'مهلة الخمول (بالدقائق)' },
        session_absolute_max_hours: { label: 'الحد الأقصى لعمر الجلسة (بالساعات)' },
        max_concurrent_sessions_per_user: { label: 'الحد الأقصى للجلسات المتزامنة لكل مستخدم' },
        mfa_required: {
          label: 'اشتراط المصادقة متعددة العوامل',
          options: { off: 'متوقف', administrators: 'المسؤولون', everyone: 'الجميع' },
        },
      },
    },

    storage: {
      title: 'تخزين الملفات',
      description: 'الواجهة الخلفية المستخدمة للمرفقات والتصديرات وملفات المستخدمين المرفوعة.',
      groups: {
        adapter: { title: 'الواجهة الخلفية', description: 'اختر مكان تخزين الملفات المرفوعة.' },
        local: { title: 'محلي' },
        s3: { title: 'S3' },
        limits: { title: 'الحدود' },
      },
      keys: {
        adapter: {
          label: 'المحوّل',
          options: { local: 'نظام الملفات المحلي', s3: 'S3 / متوافق مع S3' },
        },
        local_root: {
          label: 'الدليل الجذر',
          help: 'مسار نظام الملفات الذي تُخزَّن الملفات تحته. تُحلّ المسارات النسبية انطلاقًا من دليل العمل الحالي (CWD) للخادم.',
        },
        s3_bucket: {
          label: 'الحاوية (Bucket)',
          help: 'حاوية المضيف المشتركة. تُفصل ملفات كل بيئة عبر البادئة projects/<environmentId>/.',
        },
        s3_region: { label: 'المنطقة', help: 'مثال: us-east-1' },
        s3_endpoint: {
          label: 'نقطة النهاية',
          help: 'نقطة نهاية مخصصة للمزوّدات المتوافقة مع S3 (R2 وMinIO وWasabi). اتركها فارغة لـ AWS S3.',
        },
        s3_access_key_id: { label: 'معرّف مفتاح الوصول' },
        s3_secret_access_key: { label: 'مفتاح الوصول السري' },
        s3_force_path_style: {
          label: 'فرض عناوين URL بنمط المسار',
          help: 'فعّله لـ MinIO ومعظم المزوّدات المتوافقة مع S3؛ وعطّله لـ AWS S3.',
        },
        presigned_ttl: { label: 'مدة صلاحية عنوان URL الموقَّع مسبقًا (ثوانٍ)' },
        session_ttl: { label: 'مدة صلاحية جلسة الرفع (ثوانٍ)', help: 'مدة بقاء جلسة الرفع المجزَّأ قابلة للاستئناف.' },
        max_upload_mb: { label: 'الحد الأقصى لحجم الرفع (ميغابايت)' },
      },
      actions: {
        test: { label: 'اختبار الاتصال' },
      },
      banners: {
        adapter_switch_warning: {
          title: 'لا تُنقل الملفات الموجودة',
          text: 'تبديل المحوّل لا ينقل الملفات الموجودة — الملفات المرفوعة عبر المحوّل السابق يتعذّر الوصول إليها عبر المحوّل الجديد.',
        },
      },
    },
    ai: {
      title: 'الذكاء الاصطناعي والتضمين (Embedder)',
      description: 'مزوّد LLM والنموذج وبيانات الاعتماد وإعداد التضمين التي تستخدمها خدمات الذكاء الاصطناعي والمعرفة في المنصة.',
      groups: {
        provider: {
          title: 'المزوّد',
          description: 'اختر الواجهة الخلفية لـ LLM. وضع Memory يعيد صدى المدخلات — مفيد للاختبارات ولا يصلح للإنتاج أبدًا.',
        },
        gateway: {
          title: 'Vercel AI Gateway',
          description: 'موجّه متعدد المزوّدات. يُكتب النموذج بصيغة provider/model، مثل openai/gpt-4o.',
        },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        deepseek: {
          title: 'DeepSeek',
          description: 'واجهة API متوافقة مع OpenAI على https://api.deepseek.com. يُملأ Base URL تلقائيًا.',
        },
        dashscope: {
          title: '阿里通义 DashScope',
          description: 'نقطة نهاية متوافقة مع OpenAI على dashscope.aliyuncs.com/compatible-mode/v1. يُملأ Base URL تلقائيًا.',
        },
        cloudflare: {
          title: 'Cloudflare AI Gateway',
          description: 'يستخدم نقطة النهاية /compat، لذا يُكتب النموذج بصيغة provider/model (مثل openai/gpt-4o-mini وanthropic/claude-3-5-sonnet وdeepseek/deepseek-chat). ملاحظة: لا يدعم Cloudflare /compat النماذج alibaba/qwen* — استخدم مزوّد DashScope لـ Qwen.',
        },
        siliconflow: {
          title: '硅基流动 SiliconFlow',
          description: 'نقطة نهاية متوافقة مع OpenAI على api.siliconflow.cn/v1. يُملأ Base URL تلقائيًا.',
        },
        openrouter: {
          title: 'OpenRouter',
          description: 'موجّه متعدد المزوّدات على openrouter.ai/api/v1. يُملأ Base URL تلقائيًا.',
        },
        titles: { title: 'عناوين المحادثات', description: 'إنشاء عنوان ملخّص قصير للمحادثات الجديدة تلقائيًا.' },
        defaults: {
          title: 'الإعدادات الافتراضية للتوليد',
          description: 'تُطبَّق عندما لا يحدد طلب الوكيل أو الدردشة قيمته الخاصة.',
        },
        observability: { title: 'قابلية المراقبة' },
        embedder: {
          title: 'Embedder',
          description: 'مزوّد تحويل النص → متجه الذي تستخدمه مصادر المعرفة وRAG. مستقل عن مزوّد الدردشة أعلاه.',
        },
      },
      keys: {
        provider: {
          label: 'المزوّد',
          options: {
            memory: 'Memory (صدى — للاختبار فقط)',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
            deepseek: 'DeepSeek (متوافق مع OpenAI)',
            dashscope: '阿里通义 DashScope (متوافق مع OpenAI)',
            cloudflare: 'Cloudflare AI Gateway (متوافق مع OpenAI)',
            siliconflow: '硅基流动 SiliconFlow (متوافق مع OpenAI)',
            openrouter: 'OpenRouter (متوافق مع OpenAI)',
          },
        },
        gateway_model: {
          label: 'نموذج Gateway',
          help: 'يُستخدم بدل النموذج المضبوط في إعدادات الخادم. مثال: openai/gpt-4o',
        },
        gateway_api_key: { label: 'مفتاح API لـ Gateway', help: 'اختياري — مطلوب فقط إذا فرضت Gateway المصادقة.' },
        openai_api_key: {
          label: 'مفتاح API لـ OpenAI',
          help: 'يُستخدم بدل المفتاح المضبوط في إعدادات الخادم. يُخزَّن مشفّرًا.',
        },
        openai_model: { label: 'النموذج', help: 'معرّف النموذج الافتراضي. تتقدّم التجاوزات الخاصة بكل وكيل.' },
        openai_base_url: {
          label: 'Base URL',
          help: 'تجاوز لـ Azure OpenAI أو البوابات المستضافة ذاتيًا. اتركه فارغًا لـ api.openai.com.',
        },
        anthropic_api_key: {
          label: 'مفتاح API لـ Anthropic',
          help: 'يُستخدم بدل المفتاح المضبوط في إعدادات الخادم. يُخزَّن مشفّرًا.',
        },
        anthropic_model: { label: 'النموذج' },
        google_api_key: {
          label: 'مفتاح API لـ Google',
          help: 'يُستخدم بدل المفتاح المضبوط في إعدادات الخادم. يُخزَّن مشفّرًا.',
        },
        google_model: { label: 'النموذج' },
        deepseek_api_key: { label: 'مفتاح API لـ DeepSeek', help: 'sk-... — يصدر من platform.deepseek.com.' },
        deepseek_model: { label: 'النموذج', help: 'أمثلة: deepseek-chat (V3)، وdeepseek-reasoner (التفكير R1).' },
        dashscope_api_key: { label: 'مفتاح API لـ DashScope', help: 'sk-... — يصدر من dashscope.console.aliyun.com.' },
        dashscope_model: { label: 'النموذج' },
        cloudflare_account_id: {
          label: 'معرّف حساب Cloudflare',
          help: 'المعرّف السداسي العشري المكوَّن من 32 حرفًا في عنوان URL للوحة تحكم Cloudflare.',
        },
        cloudflare_gateway_id: {
          label: 'معرّف Gateway',
          help: 'اسم البوابة المضبوط في Cloudflare → AI Gateway. القيمة الافتراضية "default".',
        },
        cloudflare_api_key: {
          label: 'رمز Cloudflare AI Gateway',
          help: 'يصدر في AI Gateway ← تبويب "API tokens" (cfut_… أو sk_…).',
        },
        cloudflare_model: { label: 'النموذج' },
        siliconflow_api_key: { label: 'مفتاح API لـ SiliconFlow' },
        siliconflow_model: {
          label: 'النموذج',
          help: 'أمثلة: Qwen/Qwen2.5-72B-Instruct، وdeepseek-ai/DeepSeek-V3، وmeta-llama/Meta-Llama-3.1-8B-Instruct.',
        },
        openrouter_api_key: { label: 'مفتاح API لـ OpenRouter', help: 'sk-or-...' },
        openrouter_model: {
          label: 'النموذج',
          help: 'الصيغة: provider/model (مثل anthropic/claude-3.5-sonnet وdeepseek/deepseek-chat).',
        },
        title_generation_enabled: { label: 'تلخيص عناوين المحادثات تلقائيًا' },
        title_max_length: {
          label: 'الحد الأقصى لطول العنوان (أحرف)',
          help: 'حد صارم لطول العنوان المُنشأ. أي زيادة تُقتطع على الخادم.',
        },
        temperature: { label: 'درجة الحرارة', help: '0 = حتمي، 2 = إبداعي جدًا.' },
        max_tokens: { label: 'الحد الأقصى لرموز الإخراج', help: 'حد صارم لعدد الرموز المولَّدة في كل استجابة.' },
        request_timeout_ms: { label: 'مهلة الطلب (ملّي ثانية)' },
        trace_enabled: {
          label: 'تسجيل التتبعات',
          help: 'الاحتفاظ بسجل لكل طلب ذكاء اصطناعي واستجابته، حتى يمكن فحص المحادثة وإعادة تشغيلها عند حدوث خطأ.',
        },
        log_prompts: {
          label: 'تسجيل المطالبات كاملة',
          help: 'تضمين المطالبات المعروضة (لا البيانات الوصفية فقط) في صفوف التتبع.',
        },
        embedder_provider: {
          label: 'المزوّد',
          options: {
            none: 'معطّل (دون تضمينات)',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama (محلي)',
            custom: 'مخصص (متوافق مع OpenAI)',
          },
        },
        embedder_api_key: {
          label: 'مفتاح API لـ Embedder',
          help: 'رمز Bearer يُرسَل في ترويسة Authorization. مع Ollama تصلح أي قيمة غير فارغة.',
        },
        embedder_model: {
          label: 'النموذج',
          help: 'أمثلة — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3',
        },
        embedder_base_url: {
          label: 'Base URL',
          help: 'جذر نقطة النهاية (دون /embeddings). يُملأ تلقائيًا من الإعداد المسبق؛ ويمكن تجاوزه للوكلاء أو البوابات المستضافة ذاتيًا.',
        },
        embedder_dimensions: {
          label: 'الأبعاد',
          help: 'تجاوز عدد أبعاد الإخراج (لنماذج Matryoshka فقط). اتركه فارغًا لاستخدام القيمة الافتراضية للنموذج.',
        },
        embedder_batch_size: {
          label: 'حجم الدفعة',
          help: 'عدد المقاطع المرسلة إلى مزوّد التضمين في طلب واحد. قلّله إذا بلغت حدود المعدل أو الحجم لدى المزوّد.',
        },
      },
      actions: {
        test: { label: 'اختبار الاتصال' },
        test_embedder: { label: 'اختبار التضمين (Embedder)' },
        reset: { label: 'إعادة التعيين إلى افتراضيات البيئة' },
      },
      banners: {
        log_prompts_warning: {
          title: 'قد تحتوي المطالبات على بيانات شخصية',
          text: 'قد يسرّب بيانات شخصية — عطّله في البيئات الخاضعة للتنظيم.',
        },
      },
    },
    knowledge: {
      title: 'المعرفة',
      description: 'الواجهة الخلفية لمخزن المتجهات لـ RAG ومصادر المعرفة.',
      groups: {
        adapter: { title: 'الواجهة الخلفية', description: 'اختر مكان تخزين مقاطع المستندات ومتجهاتها.' },
        turso: { title: 'Turso / libSQL', description: 'يعمل مع Turso المُدار أو ملف محلي أو في الذاكرة.' },
        ragflow: {
          title: 'RAGFlow',
          description: 'نشر RAGFlow خارجي. راجع https://ragflow.io لتعليمات الاستضافة الذاتية.',
        },
        indexing: {
          title: 'افتراضيات الفهرسة',
          description: 'القيمة المضبوطة على مصدر المعرفة نفسه تتقدّم على هذه الافتراضيات.',
        },
        permissions: { title: 'الأذونات' },
      },
      keys: {
        adapter: {
          label: 'المحوّل',
          options: {
            memory: 'في الذاكرة (للتطوير / الاختبار فقط)',
            turso: 'Turso / libSQL (سحابي أو محلي)',
            ragflow: 'RAGFlow (خارجي)',
          },
        },
        turso_url: {
          label: 'عنوان URL للاتصال',
          help: 'أمثلة: libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:',
        },
        turso_auth_token: { label: 'رمز المصادقة', help: 'مطلوب فقط لعناوين Turso المُدارة.' },
        ragflow_base_url: { label: 'Base URL', help: 'مثال: http://localhost:9380' },
        ragflow_api_key: { label: 'مفتاح API' },
        ragflow_default_dataset: {
          label: 'معرّف مجموعة البيانات الافتراضية',
          help: 'يُستخدم عندما لا يحدد مصدر المعرفة مجموعة بيانات RAGFlow الخاصة به.',
        },
        chunk_target: {
          label: 'الحجم المستهدف للمقطع (أحرف)',
          help: 'حد مرن لحجم المقطع قبل أن يبدأ التقسيم المراعي للرموز.',
        },
        chunk_overlap: {
          label: 'تداخل المقاطع (أحرف)',
          help: 'الأحرف المحتفَظ بها من المقطع السابق كي يبقى السياق عبر الحدّ الفاصل.',
        },
        over_fetch: {
          label: 'مضاعف الجلب الزائد',
          help: 'يجلب البحث هذا المضاعف من عدد النتائج المطلوبة، حتى يبقى منها ما يكفي لإرجاعه بعد تصفيتها حسب تفاصيل المستند.',
        },
        enforce_rls: { label: 'فرض RLS عند البحث', help: 'إعادة فحص كل نتيجة وفق أذونات المستدعي على مستوى السجل.' },
      },
      actions: {
        test: { label: 'اختبار الاتصال' },
      },
      banners: {
        adapter_switch_warning: {
          title: 'لا تُنقل الفهارس الموجودة',
          text: 'تبديل المحوّل لا ينقل الفهارس الموجودة — المستندات المفهرسة عبر المحوّل السابق يتعذّر الوصول إليها حتى تُعاد فهرستها.',
        },
        enforce_rls_warning: {
          title: 'أبقِ RLS مفعّلًا في الإنتاج',
          text: 'التعطيل يتخطى ضمانة المنصة الفريدة ضد تسرّب بيانات مخزن المتجهات — أبقِه مفعّلًا في الإنتاج.',
        },
      },
    },
    lifecycle: {
      title: 'دورة حياة البيانات',
      description: 'مدة الاحتفاظ ببيانات النظام: تجاوز فترات الاحتفاظ، وتحديد عدد الصفوف لكل جدول، وتلقّي تنبيه عندما ينمو جدول على نحو غير متوقع. تطبّق المنصة هذه الإعدادات في جولة التنظيف الدورية.',
      keys: {
        enabled: {
          label: 'فرض سياسات دورة الحياة',
          help: 'المفتاح الرئيسي لجولة التنظيف الدورية. الإيقاف = تتوقف سياسات الاحتفاظ/TTL/التدوير المعلنة عن التطبيق (وتعود البيانات إلى النمو بلا حد).',
        },
        retention_overrides: {
          label: 'تجاوزات الاحتفاظ',
          help: 'تجاوزات النافذة لكل كائن. تستخدم المدد h/d/w/y. تُضبط لكل مؤسسة، فتحتفظ المؤسسة الخاضعة للتنظيم بسنوات بينما تحتفظ مؤسسة التطوير بأيام. يُتجاهَل التجاوز الأقصر من الحد الأدنى الذي تحتاجه ميزة في المنصة (مثل نافذة كشف التكرار في قائمة انتظار المهام) ويُسجَّل خطأً، وتظل النافذة الافتراضية سارية.',
        },
        quotas: {
          label: 'حصص الصفوف',
          help: 'الحد الأقصى لعدد الصفوف لكل كائن. يؤدي التجاوز إلى تنبيه حوكمة — ولا تحذف الحصص أبدًا ما يتجاوز السياسة المعلنة.',
        },
        quota_defaults: {
          label: 'الحصص الافتراضية حسب الفئة',
          help: 'حصص احتياطية حسب فئة دورة الحياة (telemetry, transient, event, audit).',
        },
        growth_alert_rows: {
          label: 'حد تنبيه النمو (صفوف لكل جولة)',
          help: 'التنبيه عندما ينمو جدول معلَن له دورة حياة بأكثر من هذا العدد من الصفوف بين جولتين. القيمة 0 تعطّل تنبيهات النمو.',
        },
      },
    },
  },
};
