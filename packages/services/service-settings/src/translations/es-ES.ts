// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PlatformTranslationData } from '@objectstack/spec/system';
import { countryOptionLabels } from '../manifests/company.manifest.js';

/**
 * Español (es-ES) — built-in settings manifest translations.
 */
export const esES: PlatformTranslationData = {
  settingsCommon: {
    sourceLabels: {
      env: 'Entorno',
      global: 'Global',
      tenant: 'Organización',
      user: 'Usuario',
      default: 'Predeterminado',
    },
  },
  settings: {
    mail: {
      title: 'Envío de correo',
      description: 'Configuración de SMTP y del proveedor de correo transaccional.',
      groups: {
        provider: { title: 'Proveedor', description: 'Elige cómo envía correo saliente este sistema.' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'Clave de API' },
        from_address: { title: 'Dirección de remitente' },
        delivery: { title: 'Entrega', description: 'Cómo se entrega el correo saliente al proveedor.' },
      },
      keys: {
        provider: {
          label: 'Proveedor',
          help: 'Solo se muestran los proveedores con los que este servidor puede entregar realmente. '
            + 'SendGrid y Amazon SES se configuran como SMTP.',
          options: {
            smtp: 'SMTP',
            resend: 'Resend',
            postmark: 'Postmark',
            log: 'Ninguno (solo registro — sin entrega real)',
          },
        },
        smtp_host: { label: 'Host', help: 'Ejemplo: smtp.example.com' },
        smtp_port: { label: 'Puerto' },
        smtp_secure: { label: 'Usar TLS' },
        smtp_user: { label: 'Usuario' },
        smtp_password: { label: 'Contraseña' },
        api_key: { label: 'Clave de API' },
        from_email: { label: 'Correo del remitente', help: 'Ejemplo: no-reply@example.com' },
        from_name: { label: 'Nombre del remitente' },
        queue_delivery: {
          label: 'Entrega mediante cola duradera',
          help: 'Entrega cada mensaje a la cola de trabajos en lugar de enviarlo en línea, de modo que una '
            + 'entrega fallida se reintenta con retroceso y sobrevive a un reinicio. Requiere la capacidad de '
            + 'cola con un adaptador duradero. "Enviar correo de prueba" siempre envía en línea.',
        },
      },
      actions: {
        test: { label: 'Enviar correo de prueba' },
      },
    },

    branding: {
      title: 'Marca',
      description:
        'El nombre, el logotipo y el color que muestran la consola y la página de inicio de sesión. ' +
        'Un valor sin definir usa la marca propia de la implementación.',
      groups: {
        identity: { title: 'Identidad' },
        appearance: { title: 'Apariencia' },
      },
      keys: {
        workspace_name: {
          label: 'Nombre del producto',
          help:
            'El nombre del producto en la consola, en la página de inicio de sesión y en el título del navegador, ' +
            'y en los correos de inicio de sesión, la aplicación de autenticación y el inicio de sesión de MCP. ' +
            'Déjelo vacío para usar el nombre con el que se configuró esta implantación. ' +
            'No es el nombre propio de la organización, que es el Nombre del registro de la organización.',
        },
        accent_color: {
          label: 'Color de acento',
          help: 'El color de tema del navegador y de la aplicación instalada. Cada aplicación conserva sus propios colores.',
        },
        logo_url: {
          label: 'URL del logotipo',
          help: 'Se muestra en la página de inicio de sesión, la pantalla de carga y el encabezado de inicio. Ejemplo: https://…/logo.svg',
        },
      },
    },

    auth: {
      title: 'Autenticación',
      description: 'Inicio de sesión, registro y controles de las funciones de autenticación integradas.',
      groups: {
        email_password: {
          title: 'Correo y contraseña',
          description: 'Controla el inicio de sesión local con correo/contraseña y el registro de autoservicio.',
        },
        membership: {
          title: 'Pertenencia',
          description: 'A qué se une un usuario recién creado. Complementa el registro de autoservicio anterior.',
        },
        audience: {
          title: 'Audiencia',
          description: 'Quién puede convertirse en usuario de las aplicaciones de este sistema. «Dominios de correo» siempre fuerza la verificación de correo. «Abierto» también la fuerza, salvo que el despliegue la desactive; un valor guardado en esta consola no puede hacerlo. Las invitaciones, los usuarios creados por administradores, el aprovisionamiento SCIM y el SSO empresarial se admiten bajo cualquier postura.',
        },
        password_policy: {
          title: 'Política de contraseñas',
          description: 'Límites de longitud que el proveedor de autenticación exige en el registro y el restablecimiento de contraseña.',
        },
        anti_abuse: {
          title: 'Antiabuso',
          description: 'Protección contra fuerza bruta: bloqueo de cuenta por identidad y límite de tasa por IP en los endpoints de autenticación.',
        },
        multi_factor: {
          title: 'Multifactor',
          description: 'Exige a los miembros proteger su cuenta con una aplicación de autenticación (TOTP).',
        },
        sessions: {
          title: 'Sesiones',
          description: 'Cuánto tiempo permanece válida una sesión iniciada.',
        },
        network: {
          title: 'Red',
          description: 'Restringe desde dónde pueden autenticarse los usuarios.',
        },
        api_keys: {
          title: 'Claves de API',
          description: 'Cuánto duran las claves de API personales. Una clave que caduca, que pasa sin usarse el plazo de inactividad o que se revoca se rechaza con su propio código de error, y la solución es siempre crear una clave nueva.',
        },
        social: {
          title: 'Inicio de sesión social',
          description:
            'Configura el proveedor de inicio de sesión de Google integrado. Las credenciales definidas en la configuración del servidor siguen teniendo prioridad.',
        },
      },
      keys: {
        email_password_enabled: { label: 'Habilitar inicio de sesión con correo/contraseña' },
        signup_enabled: {
          label: 'Permitir el registro por correo',
          help: 'Abre el formulario de registro con correo y contraseña. A quién admite lo decide la «Audiencia de autorregistro» inferior: con «Solo por invitación», solo a una dirección con una invitación pendiente; con «Dominios de correo», a los dominios de la lista y a las direcciones invitadas; con «Abierto», a cualquiera. Desactivado, cierra el formulario con cualquier audiencia, invitaciones incluidas.',
        },
        require_email_verification: { label: 'Requerir verificación de correo' },
        membership_policy: {
          label: 'Pertenencia de los usuarios nuevos',
          help: 'La opción automática vincula cada usuario nuevo a la organización predeterminada del despliegue. «Solo por invitación» concede la pertenencia únicamente mediante un acto explícito: crear una organización, aceptar una invitación, que un administrador lo añada o el aprovisionamiento just-in-time por SSO.',
          options: {
            auto: 'Unirse automáticamente a la organización predeterminada',
            'invite-only': 'Solo por invitación: nunca se une automáticamente',
          },
        },
        audience_posture: {
          label: 'Audiencia de autorregistro',
          help: '«Solo por invitación» cierra el autorregistro: los usuarios solo se crean mediante un acto del operador (invitación, creación/importación por un administrador, SCIM o SSO empresarial). «Dominios de correo» lo abre solo a los dominios de la lista inferior; «Abierto» admite a cualquiera. «Dominios de correo» y «Abierto» requieren el conjunto de permisos de autorregistro inferior. «Dominios de correo» siempre fuerza la verificación de correo. «Abierto» también la fuerza, salvo que la configuración del servidor la desactive; desactivarla en esta consola se rechaza bajo «Abierto».',
          options: {
            invite_only: 'Solo por invitación — sin autorregistro (predeterminado)',
            email_domain: 'Solo dominios de correo permitidos',
            open: 'Abierto — cualquiera puede registrarse',
          },
        },
        audience_allowed_email_domains: {
          label: 'Dominios de correo permitidos',
          help: 'Dominios simples, uno por línea o separados por comas (p. ej. acme.com). Coincidencia exacta sin distinguir mayúsculas; los subdominios necesitan su propia entrada; sin comodines.',
        },
        audience_self_registration_permission_set: {
          label: 'Conjunto de permisos de autorregistro',
          help: 'Nombre del conjunto de permisos que recibe cada usuario autorregistrado. El conjunto estándar de miembro es válido; el conjunto de administrador completo se rechaza. Obligatorio cuando la audiencia permite el autorregistro.',
        },
        password_min_length: { label: 'Longitud mínima de contraseña' },
        password_max_length: { label: 'Longitud máxima de contraseña', help: 'Un límite superior protege frente a la denegación de servicio por el hasheo de contraseñas muy largas.' },
        password_reject_breached: {
          label: 'Rechazar contraseñas filtradas',
          help: 'Bloquea contraseñas presentes en corpus públicos de filtraciones mediante Have I Been Pwned (comprobación de rango con k-anonimato; la contraseña nunca se envía completa).',
        },
        password_require_complexity: {
          label: 'Requerir contraseñas complejas',
          help: 'Exige que las contraseñas combinen clases de caracteres (mayúsculas, minúsculas, dígitos, símbolos) en el registro y al cambiar/restablecer la contraseña.',
        },
        password_min_classes: {
          label: 'Clases de caracteres mínimas',
          help: 'Cuántas de las cuatro clases (mayúscula / minúscula / dígito / símbolo) debe incluir una contraseña.',
        },
        password_history_count: {
          label: 'Historial de contraseñas (sin reutilización)',
          help: 'Impide reutilizar este número de contraseñas anteriores al cambiar/restablecer. 0 desactiva la comprobación.',
        },
        password_expiry_days: {
          label: 'Caducidad de contraseña (días)',
          help: 'Fuerza un cambio de contraseña tras este número de días. 0 desactiva la caducidad. Mientras está caducada, el usuario no puede acceder a los datos hasta que la cambie.',
        },
        lockout_threshold: {
          label: 'Umbral de bloqueo de cuenta',
          help: 'Bloquea una cuenta tras este número de intentos de inicio de sesión fallidos consecutivos, tanto contraseñas incorrectas como códigos de doble factor incorrectos. Mientras está bloqueada, el inicio de sesión se rechaza incluso con las credenciales correctas. 0 desactiva el bloqueo en la etapa de contraseña; la verificación en dos pasos conserva entonces su límite integrado (10 intentos cada 15 minutos), por ser la última comprobación antes de emitir una sesión.',
        },
        lockout_duration_minutes: {
          label: 'Duración del bloqueo (minutos)',
          help: 'Cuánto permanece bloqueada una cuenta una vez superado el umbral, en cualquiera de las dos etapas de inicio de sesión.',
        },
        rate_limit_max: {
          label: 'Límite de tasa de autenticación: máx. solicitudes',
          help: 'Máximo de solicitudes por IP y ventana a los endpoints de inicio de sesión / registro / restablecimiento de contraseña.',
        },
        rate_limit_window_seconds: {
          label: 'Límite de tasa de autenticación: ventana (segundos)',
          help: 'Ventana deslizante durante la cual se cuenta el tope de solicitudes anterior.',
        },
        mfa_required: {
          label: 'Requerir autenticación multifactor',
          help: 'Los usuarios sin un autenticador registrado quedan bloqueados del acceso a los datos al terminar su periodo de gracia. Activarlo también habilita la función de dos factores para que los usuarios puedan registrarse.',
        },
        mfa_grace_period_days: {
          label: 'Periodo de gracia de MFA (días)',
          help: 'Cuánto pueden aplazar el registro los usuarios antes del bloqueo definitivo. 0 bloquea de inmediato.',
        },
        session_expiry_days: { label: 'Duración de la sesión (días)', help: 'Una sesión caduca este número de días después del inicio de sesión.' },
        session_refresh_days: { label: 'Umbral de renovación (días)', help: 'Una sesión activa se extiende cuando es más antigua que esto.' },
        session_idle_timeout_minutes: {
          label: 'Tiempo de inactividad (minutos)',
          help: 'Cierra la sesión del usuario tras este número de minutos de inactividad. 0 desactiva.',
        },
        session_absolute_max_hours: {
          label: 'Duración absoluta de la sesión (horas)',
          help: 'Fuerza una reautenticación este número de horas después del inicio de sesión, independientemente de la actividad. 0 desactiva.',
        },
        max_concurrent_sessions_per_user: {
          label: 'Máx. sesiones simultáneas por usuario',
          help: 'Limita las sesiones iniciadas simultáneas por usuario; las más antiguas se cierran al superar el límite. 0 = ilimitado.',
        },
        allowed_ip_ranges: {
          label: 'Rangos de IP permitidos',
          help: 'Rangos CIDR o IP exactas (una por línea o separadas por comas), p. ej. 203.0.113.0/24. Cuando se define, se rechaza el inicio de sesión desde fuera de estos rangos, y también cualquier solicitud cuya dirección de cliente el servidor no pueda determinar. Vacío = sin restricción. Se evalúa la dirección de origen de la conexión; detrás de un proxy inverso, la configuración del servidor debe confiar en ese proxy para que se evalúe en su lugar la dirección original del cliente.',
        },
        api_key_default_expiry_days: {
          label: 'Duración predeterminada de la clave (días)',
          help: 'Una clave creada sin fecha de caducidad caduca este número de días después de crearse. Nunca supera la duración máxima de abajo.',
        },
        api_key_max_expiry_days: {
          label: 'Duración máxima de la clave (días)',
          help: 'La fecha de caducidad más lejana que puede pedir una clave nueva, contada desde su creación. Una más lejana se rechaza; exactamente este número de días se acepta.',
        },
        api_key_inactivity_days: {
          label: 'Caducidad por inactividad (días)',
          help: 'Una clave sin uso registrado durante este número de días se rechaza. No se revoca; cree una clave nueva. Una clave nunca usada cuenta desde su creación, o desde el inicio de la política de abajo si es anterior. 0 desactiva la caducidad por inactividad.',
        },
        api_key_policy_started_at: {
          label: 'Inicio de la política de claves',
          help: 'Se registra automáticamente (UTC, ISO 8601) la primera vez que el servidor se ejecuta con esta política. Las claves creadas antes sin fecha de caducidad caducan un año después; las claves sin uso registrado cuentan su inactividad desde aquí. Cambiarlo mueve ambas fechas de las claves que aún no tienen una.',
        },
        google_enabled: {
          label: 'Habilitar inicio de sesión con Google',
          help: 'Ofrece el inicio de sesión con Google cuando están disponibles tanto un ID de cliente como un secreto de cliente: los guardados abajo, o los definidos en la configuración del servidor, que tienen prioridad sobre los valores guardados. Hasta que ambos estén disponibles, la página de inicio de sesión no muestra el botón de Google, aunque esta opción esté activada. Desactivada, retira el inicio de sesión con Google aunque el servidor defina ambos. Crea el cliente OAuth en Google Cloud Console.',
        },
        google_client_id: {
          label: 'ID de cliente de Google',
          help: 'ID de cliente de OAuth desde Google Cloud Console. También se puede definir en la configuración del servidor.',
        },
        google_client_secret: {
          label: 'Secreto de cliente de Google',
          help: 'Se almacena cifrado en reposo. También se puede definir en la configuración del servidor.',
        },
      },
    },

    sms: {
      title: 'Envío de SMS',
      description: 'Configuración del proveedor de SMS para inicio de sesión con OTP, invitaciones y notificaciones.',
      groups: {
        provider: { title: 'Proveedor', description: 'Elige cómo envía este sistema los SMS salientes.' },
        aliyun: { title: 'Aliyun SMS' },
        twilio: { title: 'Twilio' },
        limits: { title: 'Límites de gasto', description: 'Limita el volumen de SMS salientes del despliegue. El SMS es un canal de pago y cada envío cuesta dinero real.' },
      },
      keys: {
        provider: {
          label: 'Proveedor',
          options: { log: 'Ninguno (solo registro — sin envío real)', aliyun: 'Aliyun SMS', twilio: 'Twilio' },
        },
        aliyun_access_key_id: { label: 'AccessKey ID' },
        aliyun_access_key_secret: { label: 'AccessKey Secret' },
        aliyun_sign_name: { label: 'Nombre de firma (短信签名)' },
        aliyun_template_code: {
          label: 'Código de plantilla predeterminado',
          help: 'Se usa cuando un envío no lleva una plantilla explícita. Una plantilla genérica con una sola variable ${content} permite enviar SMS de notificación genéricos.',
        },
        twilio_account_sid: { label: 'Account SID' },
        twilio_auth_token: { label: 'Token de autenticación' },
        twilio_from_number: {
          label: 'Número de origen',
          help: 'Remitente en formato E.164, p. ej. +15005550006. Se necesita esto o un Messaging Service SID.',
        },
        twilio_messaging_service_sid: { label: 'Messaging Service SID' },
        daily_quota: {
          label: 'Límite de envíos diarios',
          help: 'Número máximo de SMS que este despliegue puede enviar por día UTC, contando inicio de sesión con OTP, invitaciones y notificaciones. 0 significa sin límite. Los envíos que superen el límite se rechazan hasta las 00:00 UTC.',
        },
      },
      actions: { test: { label: 'Enviar SMS de prueba' } },
    },

    company: {
      title: 'Empresa',
      description: 'Identidad de la entidad legal: nombre registrado, dirección, identificadores fiscales y contacto principal.',
      groups: {
        identity: { title: 'Identidad' },
        address: { title: 'Domicilio registrado' },
        contact: { title: 'Contacto' },
      },
      keys: {
        legal_name: { label: 'Razón social', help: 'Nombre legal registrado de la organización, tal como aparece en contratos y facturas.' },
        registration_number: { label: 'Número de registro', help: 'Número de registro / constitución de la empresa (p. ej. EIN, n.º de sociedad).' },
        tax_id: { label: 'ID fiscal / IVA', help: 'Identificador fiscal que aparece en las facturas (p. ej. IVA, GST, ABN).' },
        address_line1: { label: 'Dirección línea 1' },
        address_line2: { label: 'Dirección línea 2' },
        city: { label: 'Ciudad' },
        state: { label: 'Provincia / Estado' },
        postal_code: { label: 'Código postal' },
        country: {
          label: 'País',
          help: 'País de la dirección registrada. Escribe el nombre de un país y elígelo de la lista.',
          options: countryOptionLabels('es-ES'),
        },
        phone: { label: 'Teléfono', help: 'Teléfono principal de la empresa (se recomienda E.164, p. ej. +1 415 555 0100).' },
        website: { label: 'Sitio web', help: 'Ejemplo: https://example.com' },
        primary_contact_name: { label: 'Nombre del contacto principal' },
        primary_contact_email: { label: 'Correo del contacto principal', help: 'Ejemplo: ops@example.com' },
      },
    },

    localization: {
      title: 'Localización',
      description: 'Zona horaria, idioma, país, moneda y año fiscal predeterminados.',
      groups: {
        region: { title: 'Región' },
        finance: { title: 'Finanzas' },
      },
      keys: {
        timezone: { label: 'Zona horaria predeterminada', help: 'Determina qué significa «hoy» en las fórmulas, cómo agrupan las fechas los informes y cómo se muestran las fechas y horas. Acepta cualquier nombre de zona horaria IANA (p. ej. Europe/Madrid). Es la zona horaria vigente para la organización: el campo Zona horaria del registro de la organización no la cambia.' },
        locale: { label: 'Idioma predeterminado', help: 'Configuración regional BCP-47 para los catálogos de mensajes y el formato de números/fechas.' },
        default_country: {
          label: 'País predeterminado',
          help: 'Se usa para los valores por defecto de dirección y teléfono. Escribe el nombre de un país y elígelo de la lista.',
          options: countryOptionLabels('es-ES'),
        },
        currency: { label: 'Moneda predeterminada', help: 'Código ISO 4217 aplicado cuando un campo de moneda no indica la suya.' },
        fiscal_year_start: { label: 'Inicio del año fiscal', help: 'Primer mes del año fiscal: determina «este trimestre / año fiscal» en los informes.' },
      },
    },

    feature_flags: {
      title: 'Indicadores de función',
      description: 'Activa funciones experimentales y en beta para esta organización.',
      groups: {
        productivity: { title: 'Productividad' },
        collaboration: { title: 'Colaboración' },
      },
      keys: {
        ai_enabled: {
          label: 'Asistente de IA',
          help: 'Habilita el panel del asistente de IA dentro de la aplicación.',
        },
        kanban_swimlanes: { label: 'Carriles de Kanban' },
        realtime_cursors: { label: 'Cursores en tiempo real' },
        inline_comments: { label: 'Comentarios en línea' },
      },
      banners: {
        beta_notice: { title: 'Atención',
          text: 'Las funciones beta pueden cambiar sin previo aviso. Una función definida en la configuración del servidor queda fijada, activada o desactivada, en todo el despliegue y no se puede cambiar aquí.' },
      },
    },

    storage: {
      title: 'Almacenamiento de archivos',
      description: 'Backend usado para adjuntos, exportaciones y subidas de usuarios.',
      groups: {
        adapter: { title: 'Backend', description: 'Elige dónde se almacenan los archivos subidos.' },
        local: { title: 'Local' },
        s3: { title: 'S3' },
        limits: { title: 'Límites' },
      },
      keys: {
        adapter: {
          label: 'Adaptador',
          options: { local: 'Sistema de archivos local', s3: 'S3 / compatible con S3' },
        },
        local_root: { label: 'Directorio raíz',
          help: 'Ruta del sistema de archivos donde se almacenan los archivos. Las rutas relativas se resuelven desde el directorio de trabajo del servidor.' },
        s3_bucket: { label: 'Bucket',
          help: 'Bucket compartido del host. Los archivos de cada entorno se aíslan mediante el prefijo projects/<environmentId>/.' },
        s3_region: { label: 'Región', help: 'Ejemplo: us-east-1' },
        s3_endpoint: { label: 'Endpoint',
          help: 'Endpoint personalizado para proveedores compatibles con S3 (R2, MinIO, Wasabi). Déjalo en blanco para AWS S3.' },
        s3_access_key_id: { label: 'Access Key ID' },
        s3_secret_access_key: { label: 'Secret Access Key' },
        s3_force_path_style: { label: 'Forzar URLs de tipo path',
          help: 'Actívalo para MinIO y la mayoría de proveedores compatibles con S3; desactívalo para AWS S3.' },
        presigned_ttl: { label: 'TTL de URL prefirmada (segundos)' },
        session_ttl: { label: 'TTL de sesión de subida (segundos)',
          help: 'Tiempo durante el cual una sesión de subida por fragmentos sigue siendo reanudable.' },
        max_upload_mb: { label: 'Tamaño máximo de subida (MB)' },
      },
      actions: {
        test: { label: 'Probar conexión' },
      },
      banners: {
        adapter_switch_warning: { title: 'Los archivos existentes no se migran',
          text: 'Cambiar de adaptador no migra los archivos existentes: los archivos '
            + 'subidos con el adaptador anterior dejan de ser accesibles a través del nuevo.' },
      },
    },

    ai: {
      title: 'IA y Embedder',
      description:
        'Proveedor de LLM, modelo, credenciales y configuración del embedder usados por ' +
        'los servicios de IA y de conocimiento de la plataforma.',
      groups: {
        provider: { title: 'Proveedor',
          description: 'Elige el backend de LLM. El modo Memory repite la entrada: útil para pruebas, nunca para producción.' },
        gateway: { title: 'Vercel AI Gateway',
          description: 'Enrutador multiproveedor. La especificación del modelo sigue `provider/model`, p. ej. `openai/gpt-4o`.' },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        deepseek: { title: 'DeepSeek', description: 'API compatible con OpenAI en https://api.deepseek.com. La Base URL se rellena automáticamente.' },
        dashscope: { title: '阿里通义 DashScope', description: 'Endpoint compatible con OpenAI en dashscope.aliyuncs.com/compatible-mode/v1. La Base URL se rellena automáticamente.' },
        cloudflare: { title: 'Cloudflare AI Gateway', description: 'Proxy de modelos compatibles con OpenAI a través de Cloudflare AI Gateway.' },
        siliconflow: { title: '硅基流动 SiliconFlow', description: 'Endpoint compatible con OpenAI en api.siliconflow.cn/v1. La Base URL se rellena automáticamente.' },
        openrouter: { title: 'OpenRouter', description: 'Enrutador multiproveedor en openrouter.ai/api/v1. La Base URL se rellena automáticamente.' },
        titles: { title: 'Títulos de conversación', description: 'Genera automáticamente un título de resumen breve para las conversaciones nuevas.' },
        defaults: { title: 'Valores predeterminados de generación',
          description: 'Se aplican cuando un agente o una solicitud de chat no especifica su propio valor.' },
        observability: { title: 'Observabilidad' },
        embedder: { title: 'Embedder',
          description:
            'Proveedor de texto → vector usado por las fuentes de conocimiento y RAG. ' +
            'Independiente del proveedor de chat anterior.' },
      },
      keys: {
        provider: {
          label: 'Proveedor',
          options: {
            memory: 'Memory (eco — solo pruebas)',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
            deepseek: 'DeepSeek (compatible con OpenAI)',
            dashscope: '阿里通义 DashScope (compatible con OpenAI)',
            cloudflare: 'Cloudflare AI Gateway (compatible con OpenAI)',
            siliconflow: '硅基流动 SiliconFlow (compatible con OpenAI)',
            openrouter: 'OpenRouter (compatible con OpenAI)',
          },
        },
        gateway_model: { label: 'Modelo de Gateway',
          help: 'Se reenvía como AI_GATEWAY_MODEL. Ejemplo: openai/gpt-4o' },
        gateway_api_key: { label: 'Clave de API de Gateway',
          help: 'Opcional: solo se requiere si el gateway exige autenticación.' },
        openai_api_key: { label: 'Clave de API de OpenAI',
          help: 'Se reenvía como OPENAI_API_KEY. Se almacena cifrada en reposo.' },
        openai_model: { label: 'Modelo',
          help: 'ID de modelo predeterminado. Las anulaciones por agente tienen prioridad.' },
        openai_base_url: { label: 'Base URL',
          help: 'Anulación para Azure OpenAI o gateways autoalojados. Déjalo en blanco para api.openai.com.' },
        anthropic_api_key: { label: 'Clave de API de Anthropic',
          help: 'Se reenvía como ANTHROPIC_API_KEY. Se almacena cifrada en reposo.' },
        anthropic_model: { label: 'Modelo' },
        google_api_key: { label: 'Clave de API de Google',
          help: 'Se reenvía como GOOGLE_GENERATIVE_AI_API_KEY. Se almacena cifrada en reposo.' },
        google_model: { label: 'Modelo' },
        deepseek_api_key: { label: 'Clave de API de DeepSeek', help: 'sk-…, emitida en platform.deepseek.com.' },
        deepseek_model: { label: 'Modelo', help: 'Ejemplos: deepseek-chat (V3), deepseek-reasoner (razonamiento R1).' },
        dashscope_api_key: { label: 'Clave de API de DashScope', help: 'sk-…, emitida en dashscope.console.aliyun.com.' },
        dashscope_model: { label: 'Modelo' },
        cloudflare_account_id: { label: 'ID de cuenta de Cloudflare', help: 'El ID hexadecimal de 32 caracteres de la URL de tu panel de Cloudflare.' },
        cloudflare_gateway_id: { label: 'ID de gateway', help: 'Nombre del gateway configurado en Cloudflare → AI Gateway. Por defecto `default`.' },
        cloudflare_api_key: { label: 'Token de Cloudflare AI Gateway', help: 'Emitido en AI Gateway → pestaña «API tokens» (cfut_… o sk_…).' },
        cloudflare_model: { label: 'Modelo' },
        siliconflow_api_key: { label: 'Clave de API de SiliconFlow' },
        siliconflow_model: { label: 'Modelo', help: 'Ejemplos: Qwen/Qwen2.5-72B-Instruct, deepseek-ai/DeepSeek-V3, meta-llama/Meta-Llama-3.1-8B-Instruct.' },
        openrouter_api_key: { label: 'Clave de API de OpenRouter', help: 'sk-or-…' },
        openrouter_model: { label: 'Modelo', help: 'Formato: provider/model (p. ej. anthropic/claude-3.5-sonnet, deepseek/deepseek-chat).' },
        title_generation_enabled: { label: 'Resumir automáticamente los títulos de conversación' },
        title_max_length: { label: 'Longitud máx. del título (caracteres)', help: 'Tope estricto del título generado. Todo lo que exceda se trunca en el servidor.' },
        temperature: { label: 'Temperatura',
          help: '0 = determinista, 2 = muy creativo.' },
        max_tokens: { label: 'Máximo de tokens de salida',
          help: 'Límite estricto de tokens generados por respuesta.' },
        request_timeout_ms: { label: 'Tiempo de espera de la solicitud (ms)' },
        trace_enabled: { label: 'Registrar trazas',
          help: 'Persiste las trazas de prompt/respuesta en sys_ai_trace para depuración y reproducción.' },
        log_prompts: { label: 'Registrar prompts completos',
          help: 'Incluye los prompts renderizados (no solo metadatos) en las filas de traza.' },
        embedder_provider: {
          label: 'Proveedor',
          options: {
            none: 'Deshabilitado (sin embeddings)',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama (local)',
            custom: 'Personalizado (compatible con OpenAI)',
          },
        },
        embedder_api_key: { label: 'Clave de API del embedder',
          help: 'Token bearer enviado en la cabecera Authorization. Para Ollama sirve cualquier valor no vacío.' },
        embedder_model: { label: 'Modelo',
          help: 'Ejemplos — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3' },
        embedder_base_url: { label: 'Base URL',
          help: 'Raíz del endpoint (sin /embeddings). Se autocompleta desde el preset; anúlalo para proxys o gateways autoalojados.' },
        embedder_dimensions: { label: 'Dimensiones',
          help: 'Anula la dimensionalidad de salida (solo modelos Matryoshka). Déjalo en blanco para usar el valor predeterminado del modelo.' },
        embedder_batch_size: { label: 'Tamaño de lote',
          help: 'Fragmentos por llamada a embed(). Redúcelo si alcanzas los límites de tasa o tamaño del proveedor.' },
      },
      actions: {
        test: { label: 'Probar conexión' },
        test_embedder: { label: 'Probar embedder' },
        reset: { label: 'Restablecer a los valores predeterminados del entorno' },
      },
      banners: {
        log_prompts_warning: { title: 'Los prompts pueden contener PII',
          text: 'Puede filtrar PII: desactívalo en entornos regulados.' },
      },
    },

    knowledge: {
      title: 'Conocimiento',
      description: 'Backend de almacén de vectores para RAG / fuentes de conocimiento.',
      groups: {
        adapter: { title: 'Backend',
          description: 'Elige dónde se almacenan los fragmentos de documento y sus vectores.' },
        turso: { title: 'Turso / libSQL',
          description: 'Funciona con Turso gestionado, archivo local o en memoria.' },
        ragflow: { title: 'RAGFlow',
          description: 'Despliegue externo de RAGFlow. Consulta https://ragflow.io para instrucciones de autoalojamiento.' },
        indexing: { title: 'Valores predeterminados de indexación',
          description: 'Los valores por fuente en KnowledgeSource.adapterConfig tienen prioridad.' },
        permissions: { title: 'Permisos' },
      },
      keys: {
        adapter: {
          label: 'Adaptador',
          options: {
            memory: 'En memoria (solo desarrollo / pruebas)',
            turso: 'Turso / libSQL (nube o local)',
            ragflow: 'RAGFlow (externo)',
          },
        },
        turso_url: { label: 'URL de conexión',
          help: 'Ejemplos: libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:' },
        turso_auth_token: { label: 'Token de autenticación',
          help: 'Solo se requiere para URLs de Turso gestionado.' },
        ragflow_base_url: { label: 'Base URL', help: 'Ejemplo: http://localhost:9380' },
        ragflow_api_key: { label: 'Clave de API' },
        ragflow_default_dataset: { label: 'ID de dataset predeterminado',
          help: 'Se usa cuando una KnowledgeSource no especifica su propio dataset de RAGFlow.' },
        chunk_target: { label: 'Tamaño objetivo de fragmento (caracteres)',
          help: 'Límite flexible del tamaño de fragmento antes de que actúe la división consciente de tokens.' },
        chunk_overlap: { label: 'Solapamiento de fragmentos (caracteres)',
          help: 'Caracteres conservados del fragmento anterior para que el contexto sobreviva al límite.' },
        over_fetch: { label: 'Multiplicador de sobre-obtención',
          help: 'Se obtienen topK × overFetch candidatos internos para que el filtrado de metadatos en JS siga teniendo filas.' },
        enforce_rls: { label: 'Aplicar RLS en la búsqueda',
          help: 'Vuelve a comprobar cada resultado contra los permisos a nivel de registro del solicitante.' },
      },
      actions: {
        test: { label: 'Probar conexión' },
      },
      banners: {
        adapter_switch_warning: { title: 'Los índices existentes no se migran',
          text: 'Cambiar de adaptador NO migra los índices existentes.' },
        enforce_rls_warning: { title: 'Mantenlo activado en producción',
          text: 'Desactivarlo omite la salvaguarda exclusiva de la plataforma.' },
      },
    },

    lifecycle: {
      title: 'Ciclo de vida de los datos',
      description: 'Cuánto tiempo se conservan los datos del sistema: sustituye las ventanas de retención, limita el número de filas por tabla y recibe una alerta cuando una tabla crece de forma inesperada. La plataforma los aplica en su barrido de limpieza periódico.',
      keys: {
        enabled: {
          label: 'Aplicar las políticas de ciclo de vida',
          help: 'Interruptor general del barrido periódico. Desactivado, las políticas de retención, TTL y rotación declaradas dejan de aplicarse (los datos vuelven a crecer sin límite).',
        },
        retention_overrides: {
          label: 'Sustituciones de retención',
          help: 'Sustituciones de la ventana por objeto: { "<object>": { "maxAge": "1y", "expireAfter": "30d" } }. Las duraciones usan h/d/w/y. '
            + 'Se define por organización, de modo que una organización regulada puede conservar años y una de desarrollo, días. '
            + 'Una sustitución más corta que el mínimo que necesita una función de la plataforma (por ejemplo, la ventana de detección de duplicados de la cola de trabajos) '
            + 'se ignora y se registra como error, y se sigue aplicando la ventana predeterminada.',
        },
        quotas: {
          label: 'Cuotas de filas',
          help: 'Número máximo de filas por objeto: { "<object>": 1000000 }. Superarlo genera una alerta de gobernanza: las cuotas nunca eliminan más allá de la política declarada.',
        },
        quota_defaults: {
          label: 'Cuotas predeterminadas por clase',
          help: 'Cuotas de respaldo por clase de ciclo de vida: { "telemetry": 1000000, "transient": 500000, "event": 100000, "audit": 5000000 }.',
        },
        growth_alert_rows: {
          label: 'Umbral de alerta de crecimiento (filas por barrido)',
          help: 'Avisa cuando una tabla con ciclo de vida declarado crece más de este número de filas entre dos barridos. 0 desactiva las alertas de crecimiento.',
        },
      },
    },
  },
};
