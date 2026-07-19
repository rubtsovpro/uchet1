/**
 * OpenAPI 3.0 for WMS Hono API (`/api/*`).
 * Kept as a hand-maintained map of the main surface — not codegen from Zod.
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Учёт №1 — WMS API',
    description: [
      'Складской и CRM API Пневмоподвески (Hono + SQLite).',
      '',
      '**Auth:** cookie-сессия `wms_sid` после `POST /api/login`.',
      'Публичные: `/api/health`, `/api/public/*`, ingest сделок (ключ).',
      '',
      '**Swagger:** `/api/swagger` — только при `SWAGGER_ENABLED=1`,',
      'доступ админу (сессия) или Basic Auth (`SWAGGER_BASIC_USER` / `SWAGGER_BASIC_PASS`).',
      'Try-it-out для мутаций ограничен (только GET) — полный write через UI приложения.',
      '',
      '**Не путать:** `/api/docs` — CRUD складских документов, не эта документация.',
    ].join('\n'),
    version: '0.1.0',
  },
  servers: [{ url: '/', description: 'Same origin (1c.pnevmopodveska1.ru)' }],
  tags: [
    { name: 'health' },
    { name: 'auth' },
    { name: 'me' },
    { name: 'products' },
    { name: 'counterparties' },
    { name: 'crm' },
    { name: 'payments' },
    { name: 'fiscal' },
    { name: 'warehouse-tasks' },
    { name: 'docs', description: 'Складские документы (приход/расход) — путь /api/docs' },
    { name: 'sales-docs' },
    { name: 'sync' },
    { name: 'staff' },
    { name: 'dicts' },
    { name: 'ops' },
    { name: 'marking' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'wms_sid',
        description: 'Сессия после POST /api/login',
      },
      ingestKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-wms-ingest-key',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      Health: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          service: { type: 'string', example: 'warehouse-1c' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          login: { type: 'string' },
          role: { type: 'string' },
          rights: { type: 'object', additionalProperties: true },
          isSystemAdmin: { type: 'boolean' },
        },
      },
      ProductList: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          limit: { type: 'integer' },
        },
      },
    },
  },
  security: [{ cookieAuth: [] }],
  paths: {
    '/api/health': {
      get: {
        tags: ['health'],
        summary: 'Health check',
        security: [],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
          },
        },
      },
    },
    '/api/login': {
      post: {
        tags: ['auth'],
        summary: 'Вход (логин/пароль)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string', format: 'password' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Сессия в cookie wms_sid',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          '401': { description: 'Неверные учётные данные' },
        },
      },
    },
    '/api/register': {
      post: {
        tags: ['auth'],
        summary: 'Первичная установка пароля сотрудника (по email из Amo)',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                  password2: { type: 'string' },
                  login: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'OK + cookie' },
          '400': { description: 'Ошибка валидации' },
        },
      },
    },
    '/api/logout': {
      post: {
        tags: ['auth'],
        summary: 'Выход',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
              },
            },
          },
        },
      },
    },
    '/api/me': {
      get: {
        tags: ['me'],
        summary: 'Текущий пользователь',
        responses: {
          '200': {
            description: 'Профиль',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
        },
      },
    },
    '/api/me/password': {
      post: {
        tags: ['me'],
        summary: 'Смена своего пароля',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  old_password: { type: 'string' },
                  new_password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'OK' },
          '400': { description: 'Ошибка' },
        },
      },
    },
    '/api/products': {
      get: {
        tags: ['products'],
        summary: 'Список номенклатуры',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'category_id', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
        ],
        responses: {
          '200': {
            description: 'Список',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductList' } } },
          },
        },
      },
      post: {
        tags: ['products'],
        summary: 'Создать товар',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: {
          '200': { description: 'Создан' },
          '403': { description: 'Нет права can_edit_products' },
        },
      },
    },
    '/api/products/{id}': {
      get: {
        tags: ['products'],
        summary: 'Карточка товара',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Товар + свойства/цены' },
          '404': { description: 'Не найден' },
        },
      },
      patch: {
        tags: ['products'],
        summary: 'Обновить товар',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/categories': {
      get: {
        tags: ['products'],
        summary: 'Категории (плоский список)',
        responses: { '200': { description: 'Список' } },
      },
    },
    '/api/categories/tree': {
      get: {
        tags: ['products'],
        summary: 'Дерево категорий',
        responses: { '200': { description: 'Дерево' } },
      },
    },
    '/api/balances': {
      get: {
        tags: ['products'],
        summary: 'Остатки',
        parameters: [
          { name: 'product_id', in: 'query', schema: { type: 'string' } },
          { name: 'warehouse_id', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Остатки' } },
      },
    },
    '/api/counterparties': {
      get: {
        tags: ['counterparties'],
        summary: 'Контрагенты',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Список' } },
      },
      post: {
        tags: ['counterparties'],
        summary: 'Создать контрагента',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: { '200': { description: 'Создан' } },
      },
    },
    '/api/counterparties/{id}': {
      get: {
        tags: ['counterparties'],
        summary: 'Контрагент',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Карточка' }, '404': { description: 'Не найден' } },
      },
      patch: {
        tags: ['counterparties'],
        summary: 'Обновить контрагента',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/crm/pipelines': {
      get: {
        tags: ['crm'],
        summary: 'Воронки Amo',
        responses: { '200': { description: 'pipelines + meta' } },
      },
    },
    '/api/crm/deals': {
      get: {
        tags: ['crm'],
        summary: 'Сделки',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'pipeline_id', in: 'query', schema: { type: 'string' } },
          { name: 'status_id', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Список сделок' } },
      },
    },
    '/api/crm/deals/{id}': {
      get: {
        tags: ['crm'],
        summary: 'Сделка',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Карточка' }, '404': { description: 'Не найдена' } },
      },
    },
    '/api/crm/deals/{id}/sbp-qr': {
      post: {
        tags: ['payments'],
        summary: 'Создать СБП QR по сделке',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  amount: { type: 'number' },
                  purpose: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'QR / платёж' }, '403': { description: 'Нет прав' } },
      },
    },
    '/api/crm/deals/{id}/payments': {
      get: {
        tags: ['payments'],
        summary: 'Платежи сделки',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Список' } },
      },
    },
    '/api/crm/deals/sync': {
      post: {
        tags: ['crm', 'sync'],
        summary: 'Синк сделок из Amo1c',
        responses: { '200': { description: 'Результат синка' } },
      },
    },
    '/api/crm/deals/ingest': {
      post: {
        tags: ['crm'],
        summary: 'Ingest сделки (webhook / ключ)',
        security: [{ ingestKey: [] }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: { '200': { description: 'Принято' }, '401': { description: 'Неверный ключ' } },
      },
    },
    '/api/crm/deals/{id}/warehouse-task': {
      post: {
        tags: ['warehouse-tasks', 'crm'],
        summary: 'Создать складскую задачу из сделки',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: { '200': { description: 'Задача' } },
      },
    },
    '/api/payments/{id}': {
      get: {
        tags: ['payments'],
        summary: 'Платёж',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Платёж' }, '404': { description: 'Не найден' } },
      },
      delete: {
        tags: ['payments'],
        summary: 'Удалить платёж',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '403': { description: 'Нет прав' } },
      },
    },
    '/api/payments/{id}/image.png': {
      get: {
        tags: ['payments'],
        summary: 'PNG QR платежа',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'image/png' } },
      },
    },
    '/api/fiscal/status': {
      get: {
        tags: ['fiscal'],
        summary: 'Статус АТОЛ',
        responses: { '200': { description: 'Конфиг/статус' } },
      },
    },
    '/api/crm/deals/{id}/fiscal': {
      get: {
        tags: ['fiscal'],
        summary: 'Чеки по сделке',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Список чеков' } },
      },
    },
    '/api/crm/deals/{id}/fiscal/{kind}': {
      post: {
        tags: ['fiscal'],
        summary: 'Подготовить/отправить чек (prepay|full)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['prepay', 'full'] } },
        ],
        responses: { '200': { description: 'Чек' }, '403': { description: 'Нет прав' } },
      },
    },
    '/api/warehouse/tasks/meta': {
      get: {
        tags: ['warehouse-tasks'],
        summary: 'Мета статусов/каналов отгрузки',
        responses: { '200': { description: 'meta' } },
      },
    },
    '/api/warehouse/tasks': {
      get: {
        tags: ['warehouse-tasks'],
        summary: 'Складские задачи',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Список' } },
      },
    },
    '/api/warehouse/tasks/{id}': {
      get: {
        tags: ['warehouse-tasks'],
        summary: 'Задача',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Карточка' }, '404': { description: 'Не найдена' } },
      },
    },
    '/api/warehouse/tasks/{id}/status': {
      patch: {
        tags: ['warehouse-tasks'],
        summary: 'Сменить статус задачи',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { status: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/warehouse/tasks/from-deal': {
      post: {
        tags: ['warehouse-tasks'],
        summary: 'Создать задачу из сделки (body.deal_id)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deal_id: { type: 'string' },
                  channel: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Задача' } },
      },
    },
    '/api/warehouse/tasks/scan-hand': {
      post: {
        tags: ['warehouse-tasks'],
        summary: 'Скан выдачи',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/docs': {
      get: {
        tags: ['docs'],
        summary: 'Складские документы (НЕ Swagger)',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Список документов' } },
      },
      post: {
        tags: ['docs'],
        summary: 'Создать складской документ',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: { '200': { description: 'Документ' } },
      },
    },
    '/api/docs/{id}': {
      get: {
        tags: ['docs'],
        summary: 'Складской документ',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Документ + строки' }, '404': { description: 'Не найден' } },
      },
    },
    '/api/sales-docs': {
      get: {
        tags: ['sales-docs'],
        summary: 'Документы продажи (счёт/УПД/СФ/ЗН)',
        parameters: [
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'deal_id', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Список' } },
      },
    },
    '/api/sales-docs/{id}': {
      get: {
        tags: ['sales-docs'],
        summary: 'Документ продажи',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Документ' } },
      },
    },
    '/api/sales-docs/{id}/pdf': {
      get: {
        tags: ['sales-docs'],
        summary: 'PDF документа продажи',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'application/pdf' } },
      },
    },
    '/api/sales-docs/from-deal': {
      post: {
        tags: ['sales-docs'],
        summary: 'Создать документ продажи из сделки',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  deal_id: { type: 'string' },
                  type: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Документ' }, '403': { description: 'Нет прав' } },
      },
    },
    '/api/org-profile': {
      get: {
        tags: ['sales-docs'],
        summary: 'Профиль организации',
        responses: { '200': { description: 'Профиль' } },
      },
      put: {
        tags: ['sales-docs'],
        summary: 'Сохранить профиль организации',
        requestBody: {
          content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
        },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/sync/odata': {
      post: {
        tags: ['sync'],
        summary: 'Синк каталогов OData',
        responses: { '200': { description: 'Результат' } },
      },
    },
    '/api/sync/hs': {
      post: {
        tags: ['sync'],
        summary: 'Синк применимости/свойств HS',
        responses: { '200': { description: 'Результат' } },
      },
    },
    '/api/sync/prices': {
      post: {
        tags: ['sync'],
        summary: 'Синк цен',
        responses: { '200': { description: 'Результат' } },
      },
    },
    '/api/sync/rests': {
      post: {
        tags: ['sync'],
        summary: 'Синк остатков',
        responses: { '200': { description: 'Результат' } },
      },
    },
    '/api/sync/docs': {
      post: {
        tags: ['sync'],
        summary: 'Синк документов из 1С',
        responses: { '200': { description: 'Результат' } },
      },
    },
    '/api/sync/media': {
      post: {
        tags: ['sync'],
        summary: 'Синк медиа в S3',
        responses: { '200': { description: 'Результат' } },
      },
    },
    '/api/staff': {
      get: {
        tags: ['staff'],
        summary: 'Персонал',
        parameters: [{ name: 'role', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Список + roles meta' } },
      },
    },
    '/api/staff/sync': {
      post: {
        tags: ['staff', 'sync'],
        summary: 'Загрузить персонал из Amo и 1С',
        responses: { '200': { description: 'Результат' } },
      },
    },
    '/api/dicts/meta': {
      get: {
        tags: ['dicts'],
        summary: 'Мета справочников',
        responses: { '200': { description: 'meta' } },
      },
    },
    '/api/dicts/brands': {
      get: {
        tags: ['dicts'],
        summary: 'Бренды',
        responses: { '200': { description: 'Список' } },
      },
    },
    '/api/ops/dashboard': {
      get: {
        tags: ['ops'],
        summary: 'Операционный дашборд',
        responses: { '200': { description: 'Сводка' } },
      },
    },
    '/api/marking/meta': {
      get: {
        tags: ['marking'],
        summary: 'Мета маркировки',
        responses: { '200': { description: 'meta' } },
      },
    },
    '/api/stats': {
      get: {
        tags: ['ops'],
        summary: 'Счётчики на главной',
        responses: { '200': { description: 'stats' } },
      },
    },
    '/api/public/product/{ref}': {
      get: {
        tags: ['products'],
        summary: 'Публичный JSON товара (ключ)',
        security: [],
        parameters: [{ name: 'ref', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Товар' }, '401': { description: 'Нет ключа' } },
      },
    },
    '/api/openapi.json': {
      get: {
        tags: ['health'],
        summary: 'Эта OpenAPI-спека (сырой JSON)',
        security: [],
        description: 'Доступен при SWAGGER_ENABLED=1 + admin/basic',
        responses: { '200': { description: 'OpenAPI 3 JSON' }, '404': { description: 'Выключено' } },
      },
    },
    '/api/swagger': {
      get: {
        tags: ['health'],
        summary: 'Swagger UI',
        security: [],
        description: 'Не путать с /api/docs (складские документы)',
        responses: { '200': { description: 'HTML UI' }, '404': { description: 'Выключено' } },
      },
    },
  },
} as const;
