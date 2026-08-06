import { Hono, type Context } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run } from './db.js';
import { newGuid, nextCode, ensureSeqAtLeast } from './ids.js';
import {
  allocateStockDocDatamatrix,
  createDocument,
  createTransferRequestFromBalances,
  isServiceProduct,
  previewStockMarks,
  stockDocDmExcelCsv,
  stockDocDmLabelsHtml,
  stockDocDmLabelsPdf,
  type DocType,
} from './stock.js';
import { purgeServiceLinesFromOutDocs, reclassifyAllProductKinds } from './product-kind.js';
import {
  dmCodesForBalanceRows,
  listDealLineSources,
  listProductUnits,
  listUnitSources,
  normalizeSerials,
  parseSerialsJson,
  receiveUnits,
  traceSerial,
  UNIT_STATUS_RU,
  unitsForDoc,
} from './product-units.js';
import {
  getSupplierProductApps,
  parseAppsJson,
  setSupplierProductApps,
  setUnitApps,
} from './applicability-party.js';
import { buildDocLinks } from './doc-links.js';
import { catalogCounts, odataConfigFromEnv, syncCatalogsFromOdata } from './odata.js';
import {
  archiveCompany,
  companiesListPayload,
  companyDetailPayload,
  ensureCompaniesSchema,
  ensureCompanySysWarehouses,
  listCompanies,
  resolveCompanyId,
  restoreCompany,
  setDefaultCompany,
  upsertCompany,
} from './companies.js';
import {
  deactivateOrganization,
  getOrganization,
  listOrganizations,
  resolveOrganizationId,
  setDefaultOrganization,
  syncOrganizationsFromOdata,
  syncOrganizationsFromTochka,
  upsertOrganization,
} from './organizations.js';
import {
  LINKED_DELETE_MSG,
  archiveBankAccount,
  archiveCounterparty,
  archiveProduct,
  archiveWarehouse,
  bankAccountLinkInfo,
  categoryLinkInfo,
  counterpartyLinkInfo,
  hardDeleteBankAccount,
  hardDeleteCategory,
  hardDeleteOrganization,
  hardDeleteProduct,
  hardDeleteWarehouse,
  organizationLinkInfo,
  priceTypeLinkInfo,
  productLinkInfo,
  warehouseLinkInfo,
  withDeleteMeta,
} from './entity-delete.js';
import {
  hsConfigured,
  hsSyncMeta,
  syncApplicabilityAndProperties,
  syncPricesOnly,
  syncRestsOnly,
} from './hs.js';
import { mediaSyncMeta, syncMediaFrom1c, backfillMediaOrientation, uploadManualProductPhoto } from './media.js';
import { listMediaProducts, listPhotographerQueue, mediaCoverageByCategory } from './media-coverage.js';
import { s3ConfigFromEnv } from './s3.js';
import { withCatalogSyncLock } from './sync-lock.js';
import { dictMeta, rebuildDictionaries } from './dicts.js';
import {
  accessMatrixSnapshot,
  canAccessPickScreen,
  canAccessPhotoScreen as canAccessPhotoBySection,
  canAccessSection,
  createStaffManual,
  deleteDepartmentConfig,
  emptyDeptOverlay,
  listDepartments,
  normDepartmentName,
  parseDeptOverlay,
  parseRights,
  resolveListCompanyFilter,
  rightsForRole,
  rolesCatalog,
  roleSortRank,
  setStaffSectionAccess,
  staffMeta,
  STAFF_ROLES,
  STAFF_SECTIONS,
  syncStaffFromAmoAnd1c,
  upsertDepartment,
  type DeptRightsOverlay,
  type StaffRole,
} from './staff.js';
import {
  actorFromContext,
  canDo,
  changeOwnPassword,
  publicStaffRow,
  setStaffPassword,
  type Actor,
} from './auth.js';
import { homePathForLogin } from './host-screens.js';
import {
  assertPickShiftForOps,
  clearStaffPin,
  endPickShift,
  getPickShiftSettings,
  listPickShifts,
  pickShiftStatusPayload,
  reauthPickShift,
  savePickShiftSettings,
  setStaffPin,
  startPickShift,
  touchPickShiftActivity,
} from './pick-shifts.js';
import {
  assertPhotoShiftForUpload,
  canAccessPhotoScreen,
  canManagePhotoReport,
  endPhotoShift,
  listPhotoShifts,
  photoShiftStatusPayload,
  photoShiftsReport,
  recordPhotoShiftUpload,
  startPhotoShift,
} from './photo-shifts.js';
import {
  addMaterial,
  addWoWork,
  assignToLift,
  canAccessLiftScreen,
  canAccessReceptionScreen,
  createAppointment,
  createWorkLog,
  endLiftShift,
  freeLift,
  getWorkOrderDetail,
  liftShiftStatusPayload,
  listAppointments,
  listLiftsBoard,
  listWorkCatalog,
  listWorkLogs,
  markAppointmentArrived,
  patchAppointment,
  patchWorkLog,
  searchStoVehicles,
  startLiftShift,
  todayArrivedQueue,
} from './sto-ops.js';
import { auditFromContext, auditKpi, listAudit, listAuditForDeal, writeAudit } from './audit.js';
import { enrichClientMeta } from './client-meta.js';
import { listOnlinePresence, touchPresence } from './presence.js';
import {
  docsSyncMeta,
  enrichOutDocBasis,
  probeOrderChainOdata,
  setOutDocDeal,
  syncDocsFromOdata,
} from './docs-sync.js';
import { diskStats } from './disk.js';
import {
  addDealItem,
  assignDealUnitByScan,
  dealSalesDocPackTypes,
  dealsMeta,
  deleteDealItem,
  getDeal,
  listDealResponsibles,
  listDeals,
  listDealsBoard,
  listPipelines,
  pushDealStageToAmo,
  setDealIsSto,
  setDealOrgCompany,
  setDealVehicle,
  syncDealsFromAmo1c,
  updateDealBuyer,
  updateDealItem,
  updateDealStage,
  upsertDealRecord,
} from './deals.js';
import {
  amoCounterpartiesMeta,
  listLinkedCounterparties,
  syncCounterpartiesFromAmo,
} from './amo-counterparties.js';
import { pushContractBuyerToAmoContact, pushCounterpartyToAmo } from './amo-contact-buyer.js';
import {
  createContractDoc,
  createSalesDocFromDeal,
  createSalesDocPackFromDeal,
  createUpdAndWriteOffFromDeal,
  fillContractBuyerFromDeal,
  getOrgProfile,
  getSalesDoc,
  listSalesDocs,
  renderSalesDocPrintHtml,
  saveOrgProfile,
  salesDocTypeLabel,
  updateSalesDocBuyer,
  renameSalesDocBuyerName,
  updateSalesDocVehicle,
  type SalesDocType,
} from './sales-docs.js';
import { listContractTemplates, renderSaleContractHtml, CONTRACT_TEMPLATE_ID } from './sale-contract.js';
import { ensureClientOrgContours, listClientOrgSnapshot } from './ensure-client-orgs.js';
import {
  applyDocNumberingPatch,
  getDocNumberingState,
  syncDocNumberingFrom1c,
} from './doc-numbering.js';
import {
  getUiSettings,
  normalizePhoneForStorage,
  PHONE_FORMAT_LABELS,
  PHONE_FORMATS,
  saveUiSettings,
  type PhoneFormat,
} from './phone.js';
import { renderSalesDocPdf } from './sales-docs-pdf.js';
import { buildInvoicePaymentPurpose, renderPaymentQrPng } from './payment-qr.js';
import {
  deleteOrgPrintAsset,
  orgPrintAssetsMeta,
  parseOrgFacsimileFlags,
  resolveOrgSignPngPath,
  resolveOrgStampPngPath,
  runWithOrgFacsimile,
  saveOrgPrintAsset,
  type OrgPrintAssetKind,
} from './org-stamp.js';
import {
  createDealSbpQr,
  deleteDealPayment,
  getDealPayment,
  listDealPayments,
  markDealPaymentPaid,
  pollPendingSbpPayments,
  acceptDealCashPayment,
} from './payments.js';
import {
  ensureWarehouseTaskAfterPaid,
  promoteDealToSuccessAfterHanded,
} from './sales-pipeline.js';
import {
  buildOrderDocTree,
  ensureOrderDocChain,
  getDealTransferOrderDetail,
  linkTransferToOrder,
  listDealTransferOrdersDetailed,
} from './order-doc-tree.js';
import {
  createPaymentLinkFromDeal,
  DEFAULT_PAYMENT_LINK_TIMER_MINUTES,
  ensureAcquiringForPublicToken,
  ensureWaitingPaymentWarehouse,
  expireDuePaymentLinks,
  getPaymentLinkSettings,
  getPublicPaymentLinkView,
  getPublicPaymentQrPng,
  listPaymentLinksForDeal,
  paymentLinkPublicUrl,
  planDealStockNeeds,
  pollPublicPaymentLink,
  savePaymentLinkSettings,
  submitPublicPayQuestion,
  updatePublicPaymentLinkItems,
  renewPublicPaymentReserve,
} from './payment-links.js';
import {
  bankSettingsApiUrl,
  fetchTochkaBankAppSettings,
  fetchTochkaOverview,
  saveTochkaBankAppSettings,
} from './bank-tochka.js';
import {
  atolStatusInfo,
  getFiscalReceipt,
  listFiscalReceipts,
  prepareOrSendFiscalReceipt,
  testAtolConnection,
} from './atol.js';
import { listKassaJournal, getKassaOverview } from './kassa.js';
import {
  atolSettingsPublic,
  cdekBridgePublic,
  dadataPublic,
  deepseekPublic,
  deleteYandexPayProfile,
  getDeepseekSettings,
  saveAtolSettings,
  saveCdekBridgeSettings,
  saveDadataSettings,
  saveDeepseekSettings,
  saveTochkaBridgeSettings,
  saveYandexPaySettings,
  tochkaBridgePublic,
  yandexPaySettingsPublic,
} from './integration-settings.js';
import {
  decodeStsImages,
  deepseekConfigured,
  deepseekVisionEndpointOk,
  deepseekVisionHint,
  mergeStsVehicleOcr,
  recognizeStsFromImages,
  sanitizeStsVehicle,
} from './sts-ocr.js';
import {
  deleteCounterpartyVehicle,
  ensureCounterpartyForDeal,
  garageForDeal,
  listCounterpartyVehicles,
  upsertCounterpartyVehicle,
} from './counterparty-vehicles.js';
import {
  assignStsSides,
  ensureStsJpeg,
  readStsImageNormalized,
  saveStsImage,
  stsMediaInfo,
  type StsSide,
} from './sts-media.js';
import {
  applyYandexPayPaymentEvent,
  ensureYandexPayForPublicToken,
} from './yandex-pay.js';
import {
  amoBridgePublic,
  saveAmoIntegrationSettings,
  saveStaffAmoMappings,
} from './amo-settings.js';
import {
  checkAmoSaleConfigDrift,
  markAllAmoIntegrationAlertsSeen,
  markAmoIntegrationAlertSeen,
  saveAmoSaleRulesConfig,
} from './amo-sale-config.js';
import {
  amoWebhookSecret,
  isAmoWebhookEnabled,
  parseAmoWebhookPayload,
  recordAmoWebhookHit,
  setAmoWebhookEnabled,
} from './amo-webhook.js';
import { findPartyByInn, suggestParty, suggestFio, suggestAddress, testDadataConnection, enrichCounterpartiesFromDadata, dadataEnrichStats } from './dadata.js';
import {
  createAggregate,
  createLot,
  listCodes,
  listLots,
  markingMeta,
  parseMarkingLabel,
  productMarkingSummary,
  registerCode,
  scanCode,
} from './marking.js';
import { buildCategoryTree, idsForCategoryFilter } from './category-tree.js';
import { suggestCategoriesForProducts } from './category-suggest.js';
import {
  channelLabel,
  createTaskFromDeal,
  createTaskFromInboundReceive,
  createTaskFromReturnReceive,
  createTaskFromTransfer,
  getTask,
  listTasks,
  markTaskDone,
  packingSlip,
  pickerBoard,
  scanHandOver,
  scanMarkDone,
  setTaskStatus,
  SHIP_CHANNELS,
  statusLabel,
  TASK_STATUSES,
  tasksKpdReport,
} from './warehouse-tasks.js';
import {
  aboutProgram,
  allDictionariesIndex,
  cashBook,
  companyAnalytics,
  companyOrganizations,
  createBankDocLocal,
  createCardOp,
  createCashDoc,
  createCrmEvent,
  createCrmTask,
  createGtdNumber,
  createHrDoc,
  createInventorySheet,
  createMarketplaceOrder,
  createMoneyTransfer,
  createPaymentOrder,
  createPaymentPlanItem,
  createProductionOrder,
  createStoWorkOrder,
  deleteCashRegister,
  getInventorySheet,
  homeKpi,
  listBankDocsLocal,
  listCardOps,
  listCashArticles,
  listCashDocs,
  listCashRegisters,
  listCompanyBankAccounts,
  listCrmCalendar,
  listCrmEvents,
  listCrmTasks,
  listCrmTasksForDeal,
  listGtdNumbers,
  listHrDocs,
  listInventorySheets,
  listJobTitles,
  listMarketplaceOrders,
  listMoneyTransfers,
  listOrderStatusTypes,
  listPayQuestionsForDeal,
  listPaymentOrders,
  listPersons,
  listProductionOrders,
  listStoResources,
  listStoWorkOrders,
  listTimeKinds,
  listWorkSchedules,
  listWorkShifts,
  lowStockReport,
  marketplaceChannelMeta,
  patchCrmTask,
  patchGtdNumber,
  patchProductionOrder,
  patchStoWorkOrder,
  paymentCalendar,
  postInventorySheet,
  priceListMatrix,
  salesAnalysis,
  settingsCalendars,
  settingsEquipment,
  settingsMyProfile,
  settingsReportsIndex,
  settingsSalesChannels,
  settingsYookassa,
  upsertCashArticle,
  upsertCashRegister,
  upsertCompanyBankAccount,
  upsertJobTitle,
  upsertTimeKind,
  upsertWorkSchedule,
  upsertWorkShift,
} from './menu-parity.js';
import {
  addThinJournalLine,
  allocateThinJournalDatamatrix,
  createThinJournalDoc,
  deleteThinJournalDoc,
  demandCalculation,
  ensureThinJournalMarks,
  getThinJournalDoc,
  getThinJournalMeta,
  listThinJournalDocs,
  listThinJournalKeys,
  listTransfers,
  listWriteOffs,
  patchThinJournalDoc,
  purchasesInboundReport,
  purchasesReportsHub,
  removeThinJournalLine,
  thinJournalDmExcelCsv,
  thinJournalDmLabelsHtml,
  thinJournalDmLabelsPdf,
  warehouseReportsHub,
} from './parity-batch-a.js';
import {
  companyReportsHub,
  crmReportsHub,
  moneyReportsHub,
  reportsCatalog,
  retailSalesReport,
  salesReportsHub,
  worksReportsHub,
} from './reports-hub.js';
import {
  cdekWidgetUrl,
  listIncomeMirror,
  opsDashboard,
  productInboundLayers,
  productPurchaseHistory,
  stockValuation,
  warehouseStockMoneyTotals,
} from './ops.js';
import {
  callCdekWidgetAction,
  cdekConfigured,
  fetchCdekDeal,
  fetchCdekSettings,
  fetchCdekShipment,
  listCdekDeals,
  refreshCdekShipment,
  saveCdekSettings,
  syncTaskCdekTrack,
} from './cdek.js';
import {
  currenciesCatalog,
  getCurrency,
  headerRates,
  listCurrencies,
  listCurrencyRates,
  syncRatesFromCbr,
  upsertCurrency,
  upsertCurrencyRate,
  upsertRubPair,
} from './currencies.js';
import { mountSwagger } from './swagger.js';
import { telegram2faConfigStatus } from './telegram.js';
import { mountChatRoutes } from './chat.js';
import { mountSupplyChainRoutes } from './supply-chain.js';
import { renderDataMatrixPng, renderDataMatrixSvg } from './datamatrix.js';

export const api = new Hono();

api.get('/health', (c) => {
  const twofa = telegram2faConfigStatus();
  return c.json({
    ok: true,
    service: 'warehouse-1c',
    auth_2fa: {
      channel: twofa.channel,
      mode: twofa.mode,
      ready: twofa.ready,
      token_set: twofa.token_set,
      default_chat_set: twofa.default_chat_set,
      worker_set: twofa.worker_set,
      ...(twofa.ask ? { ask: twofa.ask } : {}),
    },
  });
});

/** OpenAPI + Swagger UI — not /docs (warehouse documents CRUD). */
mountSwagger(api);
mountChatRoutes(api);
mountSupplyChainRoutes(api);

/** Data Matrix PNG/SVG — для этикеток и маркировки */
api.get('/datamatrix.png', async (c) => {
  try {
    const text = c.req.query('text') || c.req.query('code') || '';
    const scale = Number(c.req.query('scale') || 4) || 4;
    const png = await renderDataMatrixPng(text, { scale });
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'private, max-age=3600');
    return c.body(new Uint8Array(png));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'datamatrix failed' }, 400);
  }
});

api.get('/datamatrix.svg', async (c) => {
  try {
    const text = c.req.query('text') || c.req.query('code') || '';
    const scale = Number(c.req.query('scale') || 4) || 4;
    const svg = await renderDataMatrixSvg(text, { scale });
    c.header('Content-Type', 'image/svg+xml; charset=utf-8');
    c.header('Cache-Control', 'private, max-age=3600');
    return c.body(svg);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'datamatrix failed' }, 400);
  }
});

api.post('/datamatrix', async (c) => {
  try {
    const body = await c.req.json<{ text?: string; code?: string; format?: string; scale?: number }>();
    const text = body.text || body.code || '';
    const scale = Number(body.scale) || 4;
    if (String(body.format || 'png').toLowerCase() === 'svg') {
      const svg = await renderDataMatrixSvg(text, { scale });
      return c.json({ format: 'svg', text, svg });
    }
    const png = await renderDataMatrixPng(text, { scale });
    return c.json({
      format: 'png',
      text,
      data_url: `data:image/png;base64,${png.toString('base64')}`,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'datamatrix failed' }, 400);
  }
});

/** Путь внутри /api (mount strip). */
function apiPath(c: { req: { path: string } }): string {
  let p = c.req.path || '';
  if (p.startsWith('/api/')) p = p.slice(4);
  else if (p === '/api') p = '/';
  return p.startsWith('/') ? p : `/${p}`;
}

/** Prefix → раздел меню. Более специфичные пути — выше. Запись дополнительно режется can_*. */
const SECTION_PREFIXES: Array<{ prefix: string; section: string }> = [
  { prefix: '/supply/', section: 'purchases' },
  { prefix: '/warehouse/pick', section: 'pick' },
  { prefix: '/media/photo-queue', section: 'photo' },
  { prefix: '/media/photo', section: 'photo' },
  { prefix: '/media/coverage', section: 'photo' },
  { prefix: '/media/', section: 'media' },
  { prefix: '/sto/lift', section: 'lift' },
  { prefix: '/sto/reception', section: 'reception' },
  { prefix: '/sto/work-logs', section: 'lift' },
  { prefix: '/sto/work-catalog', section: 'lift' },
  { prefix: '/ops/cdek', section: 'delivery' },
  { prefix: '/cdek/', section: 'delivery' },
  { prefix: '/money/', section: 'money' },
  { prefix: '/staff', section: 'staff' },
  { prefix: '/crm/', section: 'crm' },
  { prefix: '/sales-docs', section: 'sales' },
  { prefix: '/org-profile', section: 'company' },
  { prefix: '/doc-numbering', section: 'company' },
  { prefix: '/audit', section: 'settings' },
  { prefix: '/ui-settings', section: 'settings' },
  { prefix: '/integration', section: 'integrations' },
  { prefix: '/reports', section: 'reports' },
  { prefix: '/balances', section: 'warehouse' },
  { prefix: '/stock/', section: 'warehouse' },
  { prefix: '/docs', section: 'warehouse' },
  { prefix: '/warehouses', section: 'warehouse' },
  { prefix: '/warehouse/', section: 'warehouse' },
  { prefix: '/lots', section: 'warehouse' },
  { prefix: '/marking/', section: 'warehouse' },
  { prefix: '/works/', section: 'works' },
  { prefix: '/production/', section: 'production' },
  { prefix: '/marketplaces/', section: 'crm' },
  { prefix: '/feedback', section: 'ideas' },
];

function sectionForApiPath(path: string): string | null {
  for (const { prefix, section } of SECTION_PREFIXES) {
    if (prefix.endsWith('/')) {
      if (path.startsWith(prefix)) return section;
    } else if (path === prefix || path.startsWith(`${prefix}/`)) {
      return section;
    }
  }
  return null;
}

api.use('*', async (c, next) => {
  const path = apiPath(c);
  if (path === '/health' || path.startsWith('/public/') || path === '/me' || path.startsWith('/me/')) {
    return next();
  }
  if (path.startsWith('/sync/') && c.req.method !== 'GET') {
    const actor = actorFromContext(c);
    if (!canDo(actor, 'can_sync')) {
      return c.json({ error: 'Недостаточно прав: синхронизация 1С' }, 403);
    }
  }
  // Загрузка фото товара — экран фотографа (не весь раздел media)
  if (c.req.method === 'POST' && /^\/media\/products\/[^/]+\/photo\/?$/.test(path)) {
    const actor = actorFromContext(c);
    if (!canAccessPhotoBySection(actor)) {
      return c.json({ error: 'Недостаточно прав: экран фотографа' }, 403);
    }
    return next();
  }
  const section = sectionForApiPath(path);
  if (section) {
    const actor = actorFromContext(c);
    if (section === 'photo') {
      if (!canAccessPhotoBySection(actor)) {
        return c.json({ error: 'Недостаточно прав: экран фотографа' }, 403);
      }
    } else if (section === 'lift') {
      if (!canAccessLiftScreen(actor)) {
        return c.json({ error: 'Недостаточно прав: экран подъёмника' }, 403);
      }
    } else if (section === 'reception') {
      if (!canAccessReceptionScreen(actor)) {
        return c.json({ error: 'Недостаточно прав: экран приёмщика' }, 403);
      }
    } else if (!canAccessSection(actor, section)) {
      return c.json({ error: `Недостаточно прав: раздел` }, 403);
    }
  }
  return next();
});

/** Кладовщик / СТО / курьер / руководитель — задания склада без полного can_edit_docs. */
function canOperateWarehouseTasks(
  actor: ReturnType<typeof actorFromContext>
): boolean {
  if (!actor) return true;
  if (actor.isSystemAdmin || actor.role === 'admin') return true;
  if (['manager', 'warehouse', 'sto', 'courier'].includes(actor.role)) return true;
  return canDo(actor, 'can_edit_docs');
}

function publicJsonKeyOk(c: { req: { query: (k: string) => string | undefined; header: (n: string) => string | undefined } }): boolean {
  const expect = (process.env.WMS_JSON_KEY || process.env.WMS_INGEST_KEY || '').trim();
  if (!expect) return false;
  const key =
    (c.req.query('key') || '').trim()
    || (c.req.header('x-wms-json-key') || '').trim()
    || (c.req.header('x-wms-ingest-key') || '').trim();
  return key === expect;
}

function findProductForExport(ref: string) {
  const q = String(ref || '').trim();
  if (!q) return null;
  return (
    get(
      `SELECT p.id, p.sku, p.code, p.name, p.brand, p.barcode, p.array_sku, p.is_active,
              p.package_width_cm, p.package_height_cm, p.package_length_cm, p.package_weight_g,
              u.short_name AS unit, c.name AS category, p.category_id
       FROM products p
       LEFT JOIN units u ON u.id = p.unit_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.sku = ? OR p.code = ? OR p.barcode = ? OR p.id = ?
       LIMIT 1`,
      [q, q, q, q]
    ) || null
  );
}

function buildProductExportJson(product: Record<string, unknown>) {
  const id = String(product.id);
  const prices = all<{ price_type: string; price: number }>(
    `SELECT price_type, price FROM product_prices WHERE product_id = ?
     ORDER BY
       CASE price_type
         WHEN 'Розничная цена' THEN 0
         WHEN 'ОПТ1' THEN 1
         WHEN 'ОПТ2' THEN 2
         WHEN 'Цена снятие/установки' THEN 3
         WHEN 'Цена Маркетплейс' THEN 4
         ELSE 10
       END,
       price_type`,
    [id]
  );
  const lastPurchase = get<{
    price: number;
    qty: number;
    doc_date: string;
    number: string;
    amount: number;
  }>(
    `SELECT l.price, l.qty, d.doc_date, d.number, l.amount
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     WHERE d.doc_type = 'in' AND l.product_id = ? AND IFNULL(l.price, 0) > 0
     ORDER BY d.doc_date DESC, d.number DESC
     LIMIT 1`,
    [id]
  );
  const properties = all<{ property: string; value: string }>(
    `SELECT property, value FROM product_properties WHERE product_id = ? ORDER BY property`,
    [id]
  );
  const rests = all<{ warehouse: string; qty: number }>(
    `SELECT IFNULL(w.name, r.warehouse_id) AS warehouse, r.qty
     FROM product_store_rests r
     LEFT JOIN warehouses w ON w.id = r.warehouse_id
     WHERE r.product_id = ? AND r.qty != 0
     ORDER BY warehouse`,
    [id]
  );
  const pricesMap: Record<string, number> = {};
  for (const row of prices) {
    pricesMap[row.price_type] = Number(row.price) || 0;
  }
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    product: {
      id: product.id,
      sku: product.sku,
      code: product.code,
      name: product.name,
      brand: product.brand,
      barcode: product.barcode,
      array_sku: product.array_sku,
      category: product.category,
      unit: product.unit,
      is_active: Boolean(product.is_active),
      package: {
        width_cm: product.package_width_cm,
        height_cm: product.package_height_cm,
        length_cm: product.package_length_cm,
        weight_g: product.package_weight_g,
      },
    },
    prices: prices.map((p) => ({ type: p.price_type, price: Number(p.price) || 0 })),
    prices_map: pricesMap,
    purchase: lastPurchase
      ? {
          last_price: Number(lastPurchase.price) || 0,
          qty: Number(lastPurchase.qty) || 0,
          date: lastPurchase.doc_date,
          doc_number: lastPurchase.number,
          line_amount: Number(lastPurchase.amount) || 0,
        }
      : null,
    properties,
    rests,
  };
}

/** Постоянная JSON-ссылка: товар + цены (+ последняя цена закупа).
 *  Без сессии нужен key=WMS_JSON_KEY|WMS_INGEST_KEY
 *  Примеры:
 *    /api/public/product.json?sku=MRAE21065&key=...
 *    /api/public/product/MRAE21065.json?key=...
 */
api.get('/public/product.json', (c) => {
  if (!publicJsonKeyOk(c) && !actorFromContext(c)) {
    return c.json({ error: 'forbidden', hint: 'нужен ?key= или вход в Учёт №1' }, 403);
  }
  const ref =
    c.req.query('sku')
    || c.req.query('code')
    || c.req.query('barcode')
    || c.req.query('id')
    || '';
  const product = findProductForExport(ref);
  if (!product) return c.json({ ok: false, error: 'not found' }, 404);
  return c.json(buildProductExportJson(product as Record<string, unknown>));
});

api.get('/public/product/:ref', (c) => {
  if (!publicJsonKeyOk(c) && !actorFromContext(c)) {
    return c.json({ error: 'forbidden', hint: 'нужен ?key= или вход в Учёт №1' }, 403);
  }
  let ref = decodeURIComponent(c.req.param('ref') || '');
  if (ref.toLowerCase().endsWith('.json')) ref = ref.slice(0, -5);
  const product = findProductForExport(ref);
  if (!product) return c.json({ ok: false, error: 'not found' }, 404);
  return c.json(buildProductExportJson(product as Record<string, unknown>));
});

/** Для карточки товара: постоянная ссылка с key (нужна сессия). */
api.get('/products/:id/json-link', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  const product = get<{ id: string; sku: string; code: string }>(
    `SELECT id, sku, code FROM products WHERE id = ?`,
    [id]
  );
  if (!product) return c.json({ error: 'not found' }, 404);
  const key = (process.env.WMS_JSON_KEY || process.env.WMS_INGEST_KEY || '').trim();
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || '1c.pnevmopodveska1.ru';
  const proto = c.req.header('x-forwarded-proto') || 'https';
  const base = `${proto}://${host}`;
  const sku = encodeURIComponent(product.sku || product.id);
  const q = key ? `?key=${encodeURIComponent(key)}` : '';
  return c.json({
    ok: true,
    sku: product.sku,
    code: product.code,
    url: `${base}/api/public/product/${sku}.json${q}`,
    url_query: `${base}/api/public/product.json?sku=${sku}${key ? '&key=' + encodeURIComponent(key) : ''}`,
  });
});

api.get('/money/tochka', async (c) => {
  const actor = actorFromContext(c);
  if (!canAccessSection(actor, 'money')) {
    return c.json({ error: 'Недостаточно прав: раздел Деньги' }, 403);
  }
  try {
    const data = await fetchTochkaOverview();
    return c.json(data);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'tochka failed' }, 502);
  }
});

/** Журнал кассы: чеки АТОЛ, оплаты СБП, ссылки на оплату. */
api.get('/kassa/journal', (c) => {
  const actor = actorFromContext(c);
  if (
    !isAdminActor(actor) &&
    !canAccessSection(actor, 'kassa') &&
    !canAccessSection(actor, 'money')
  ) {
    return c.json({ error: 'Недостаточно прав: раздел Касса' }, 403);
  }
  const q = c.req.query('q') || '';
  const source = c.req.query('source') || 'all';
  const day = c.req.query('day') || '';
  const page = Number(c.req.query('page') || 1);
  const limit = Number(c.req.query('limit') || 50);
  return c.json(listKassaJournal({ q, source, day, page, limit }));
});

/** Дашборд кассы: остатки по кассам + статусы АТОЛ/ОФД/Точка. */
api.get('/kassa/overview', async (c) => {
  const actor = actorFromContext(c);
  if (
    !isAdminActor(actor) &&
    !canAccessSection(actor, 'kassa') &&
    !canAccessSection(actor, 'money')
  ) {
    return c.json({ error: 'Недостаточно прав: раздел Касса' }, 403);
  }
  const probe = c.req.query('probe') !== '0';
  const force = c.req.query('force') === '1';
  const forceAtol = force || c.req.query('force_atol') === '1';
  const forceTochka = force || c.req.query('force_tochka') === '1';
  const organization_id = c.req.query('organization_id') || '';
  const company_id = c.req.query('company_id') || '';
  return c.json(
    await getKassaOverview({
      probe_atol: probe,
      force_atol: forceAtol,
      probe_tochka: probe,
      force_tochka: forceTochka,
      organization_id: organization_id || undefined,
      company_id: company_id || undefined,
    })
  );
});

api.get('/me', (c) => {
  const host = c.req.header('x-forwarded-host') || c.req.header('host');
  const actor = actorFromContext(c);
  if (!actor) {
    // legacy cookie
    return c.json({
      id: '__admin__',
      name: 'Админ (системный)',
      email: '',
      login: 'admin',
      role: 'admin',
      rights: rightsForRole('admin'),
      isSystemAdmin: true,
      home_path: homePathForLogin(host, { isSystemAdmin: true, role: 'admin' }),
      picker_only: false,
    });
  }
  const secs = actor.rights?.sections || [];
  const hasPick = secs.includes('pick');
  const hasPhoto = secs.includes('photo') || secs.includes('media');
  const mainUi = secs.some((s) =>
    ['crm', 'sales', 'purchases', 'money', 'staff', 'company', 'settings', 'reports'].includes(s)
  );
  // Роль photographer — всегда на /photo; иначе эвристика по разделам (без ломки pick)
  const photographerOnly =
    !actor.isSystemAdmin &&
    actor.role !== 'admin' &&
    (actor.role === 'photographer' || (hasPhoto && !mainUi && !hasPick && actor.role !== 'warehouse'));
  const pickerOnly =
    !actor.isSystemAdmin &&
    actor.role !== 'admin' &&
    !photographerOnly &&
    (actor.role === 'warehouse' ||
      actor.role === 'courier' ||
      (hasPick && !mainUi && !hasPhoto));
  return c.json({
    id: actor.id,
    name: actor.name,
    email: actor.email,
    login: actor.login,
    role: actor.role,
    rights: actor.rights,
    isSystemAdmin: actor.isSystemAdmin,
    home_path: homePathForLogin(host, actor),
    picker_only: pickerOnly,
    photographer_only: photographerOnly,
  });
});

api.post('/me/password', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ old_password?: string; new_password?: string }>();
  try {
    changeOwnPassword(actor.id, String(body.old_password || ''), String(body.new_password || ''));
    auditFromContext(c, {
      action: 'auth.password_change',
      entity: 'staff',
      entityId: actor.id,
      summary: `Смена своего пароля: ${actor.name}`,
    });
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

function bookmarkUserId(actor: ReturnType<typeof actorFromContext>): string {
  return actor?.id || '__admin__';
}

api.get('/me/bookmarks', (c) => {
  const userId = bookmarkUserId(actorFromContext(c));
  const items = all<{
    id: string;
    title: string;
    path: string;
    tab_id: string;
    created_at: string;
  }>(
    `SELECT id, title, path, tab_id, created_at FROM user_bookmarks
     WHERE user_id = ? ORDER BY created_at ASC LIMIT 40`,
    [userId]
  );
  return c.json({ items });
});

api.post('/me/bookmarks', async (c) => {
  const userId = bookmarkUserId(actorFromContext(c));
  let body: { title?: string; path?: string; tab_id?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const path = String(body.path || '').trim().slice(0, 500);
  const title = String(body.title || 'Закладка').trim().slice(0, 120) || 'Закладка';
  const tabId = String(body.tab_id || '').trim().slice(0, 200);
  if (!path || !path.startsWith('/')) return c.json({ error: 'path required' }, 400);
  const existing = get<{ id: string }>(
    `SELECT id FROM user_bookmarks WHERE user_id = ? AND path = ?`,
    [userId, path]
  );
  if (existing) {
    run(`UPDATE user_bookmarks SET title = ?, tab_id = ? WHERE id = ?`, [title, tabId, existing.id]);
    return c.json({
      ok: true,
      item: get(`SELECT id, title, path, tab_id, created_at FROM user_bookmarks WHERE id = ?`, [existing.id]),
    });
  }
  const count = get<{ n: number }>(`SELECT COUNT(*) AS n FROM user_bookmarks WHERE user_id = ?`, [userId]);
  if ((count?.n || 0) >= 40) return c.json({ error: 'Слишком много закладок (лимит 40)' }, 400);
  const id = newGuid();
  run(
    `INSERT INTO user_bookmarks (id, user_id, title, path, tab_id) VALUES (?, ?, ?, ?, ?)`,
    [id, userId, title, path, tabId]
  );
  return c.json({
    ok: true,
    item: get(`SELECT id, title, path, tab_id, created_at FROM user_bookmarks WHERE id = ?`, [id]),
  });
});

api.delete('/me/bookmarks/:id', (c) => {
  const userId = bookmarkUserId(actorFromContext(c));
  const id = c.req.param('id');
  const row = get<{ id: string }>(`SELECT id FROM user_bookmarks WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!row) return c.json({ error: 'not found' }, 404);
  run(`DELETE FROM user_bookmarks WHERE id = ? AND user_id = ?`, [id, userId]);
  return c.json({ ok: true });
});

api.delete('/me/bookmarks', async (c) => {
  const userId = bookmarkUserId(actorFromContext(c));
  const path = String(c.req.query('path') || '').trim();
  if (!path) return c.json({ error: 'path required' }, 400);
  run(`DELETE FROM user_bookmarks WHERE user_id = ? AND path = ?`, [userId, path]);
  return c.json({ ok: true });
});

api.get('/audit', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const canSettings = isAdminActor(actor) || canAccessSection(actor, 'settings');
  const canStaff = isAdminActor(actor) || canAccessSection(actor, 'staff');
  const entity = (c.req.query('entity') || '').trim();
  const entityId = (c.req.query('entity_id') || '').trim();
  const actorId = (c.req.query('actor_id') || '').trim();
  const dealId = (c.req.query('deal_id') || '').trim();
  // Карточка сущности / цепочка заказа: любой авторизованный.
  // История сотрудника / полный журнал: персонал или настройки.
  const entityScoped = Boolean(entity && entityId);
  const dealScoped = Boolean(dealId);
  if (!entityScoped && !dealScoped && !canSettings && !canStaff) {
    return c.json({ error: 'Недостаточно прав: история действий' }, 403);
  }
  if (!entityScoped && !dealScoped && actorId && !canSettings && !canStaff) {
    return c.json({ error: 'Недостаточно прав: история сотрудника' }, 403);
  }
  const page = Number(c.req.query('page') || 1);
  const limit = Number(c.req.query('limit') || 50);
  if (dealScoped) {
    return c.json(
      listAuditForDeal(dealId, {
        page,
        limit: Math.min(limit || 80, 200),
      })
    );
  }
  return c.json(
    listAudit({
      q: canSettings || canStaff ? c.req.query('q') || '' : '',
      action: canSettings || canStaff ? c.req.query('action') || '' : '',
      entity,
      entityId,
      actorId: canSettings || canStaff ? actorId : '',
      day: canSettings || canStaff ? c.req.query('day') || '' : '',
      from: canSettings || canStaff ? c.req.query('from') || '' : '',
      to: canSettings || canStaff ? c.req.query('to') || '' : '',
      page,
      limit: entityScoped ? Math.min(limit, 40) : limit,
    })
  );
});

/** KPI активности: действия по сотруднику / дню (из audit_log). */
api.get('/audit/kpi', (c) => {
  const actor = actorFromContext(c);
  if (
    !isAdminActor(actor)
    && !canAccessSection(actor, 'settings')
    && !canAccessSection(actor, 'staff')
    && !canAccessSection(actor, 'reports')
  ) {
    return c.json({ error: 'Недостаточно прав: KPI истории' }, 403);
  }
  return c.json(
    auditKpi({
      from: c.req.query('from') || '',
      to: c.req.query('to') || '',
      actorId: c.req.query('actor_id') || '',
      days: Number(c.req.query('days') || 14) || 14,
    })
  );
});

function isAdminActor(actor: ReturnType<typeof actorFromContext>): boolean {
  return !!(actor && (actor.isSystemAdmin || actor.role === 'admin'));
}

/** Heartbeat: кто где сидит (для всех авторизованных) + IP/UA/регион. */
api.post('/presence/heartbeat', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json().catch(() => ({})) as {
    path?: string;
    title?: string;
    section?: string;
  };
  const client = await enrichClientMeta(c);
  touchPresence({
    actor,
    path: body.path,
    title: body.title,
    section: body.section,
    client,
  });
  return c.json({ ok: true });
});

/** Список онлайн — только админам. */
api.get('/presence/online', (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor)) {
    return c.json({ error: 'Только для администраторов' }, 403);
  }
  const items = listOnlinePresence();
  return c.json({ items, total: items.length, online_sec: 120 });
});

api.get('/stats', (c) => {
  const products = get<{ c: number }>('SELECT COUNT(*) AS c FROM products WHERE is_active = 1')?.c ?? 0;
  const warehouses = get<{ c: number }>('SELECT COUNT(*) AS c FROM warehouses WHERE is_active = 1')?.c ?? 0;
  const docs = get<{ c: number }>('SELECT COUNT(*) AS c FROM stock_docs')?.c ?? 0;
  const skuQty = get<{ s: number }>('SELECT COALESCE(SUM(qty),0) AS s FROM stock_balances')?.s ?? 0;
  const counts = catalogCounts();
  return c.json({
    products,
    warehouses,
    docs,
    skuQty,
    odata: counts,
    hs: hsSyncMeta(),
    media: mediaSyncMeta(),
    dicts: dictMeta(),
    staff: staffMeta(),
    docs1c: docsSyncMeta(),
    crm: dealsMeta(),
    disk: diskStats(process.env.WMS_DATA_DIR || '/'),
  });
});

api.get('/crm/pipelines', (c) => c.json({ items: listPipelines(), meta: dealsMeta() }));

/** Список ответственных для фильтра заказов (до /crm/deals/:id). */
api.get('/crm/deals/responsibles', (c) => {
  const pipelineId = (c.req.query('pipeline_id') || '').trim();
  const orgCompanyId = (c.req.query('company_id') || '').trim();
  const queuedRaw = (c.req.query('queued_to_1c') || '').trim();
  return c.json(
    listDealResponsibles({
      pipelineId: pipelineId || undefined,
      orgCompanyId: orgCompanyId || undefined,
      queuedTo1c: queuedRaw === '1' || queuedRaw === 'true',
    })
  );
});

api.get('/crm/deals', (c) => {
  const q = (c.req.query('q') || '').trim();
  const pipelineId = (c.req.query('pipeline_id') || '').trim();
  const statusId = (c.req.query('status_id') || '').trim();
  const orgCompanyId = (c.req.query('company_id') || '').trim();
  const responsibleUserId = (c.req.query('responsible_user_id') || '').trim();
  const amoChannel = (c.req.query('amo_channel') || c.req.query('channel') || '').trim();
  const queuedRaw = (c.req.query('queued_to_1c') || '').trim();
  const queueStatus = (c.req.query('queue_status') || '').trim();
  const sort = (c.req.query('sort') || '').trim();
  const dirRaw = (c.req.query('dir') || '').trim().toLowerCase();
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || 50) || 50));
  return c.json(
    listDeals({
      q,
      pipelineId: pipelineId || undefined,
      statusId: statusId || undefined,
      orgCompanyId: orgCompanyId || undefined,
      responsibleUserId: responsibleUserId || undefined,
      amoChannel: amoChannel || undefined,
      queuedTo1c: queuedRaw === '1' || queuedRaw === 'true',
      queueStatus: queueStatus || undefined,
      sort: sort || undefined,
      dir: dirRaw === 'asc' ? 'asc' : 'desc',
      page,
      limit,
    })
  );
});

/** Канбан-доска: колонки = этапы воронки. */
api.get('/crm/deals/board', (c) => {
  const pipelineId = (c.req.query('pipeline_id') || '').trim();
  const q = (c.req.query('q') || '').trim();
  const orgCompanyId = (c.req.query('company_id') || '').trim();
  const responsibleUserId = (c.req.query('responsible_user_id') || '').trim();
  const amoChannel = (c.req.query('amo_channel') || c.req.query('channel') || '').trim();
  const queuedRaw = (c.req.query('queued_to_1c') || '').trim();
  const queueStatus = (c.req.query('queue_status') || '').trim();
  const boardOpts = {
    q: q || undefined,
    orgCompanyId: orgCompanyId || undefined,
    responsibleUserId: responsibleUserId || undefined,
    amoChannel: amoChannel || undefined,
    queuedTo1c: queuedRaw === '1' || queuedRaw === 'true',
    queueStatus: queueStatus || undefined,
  };
  if (!pipelineId) {
    const pipes = listPipelines();
    const first =
      pipes.find((p) => Number(p.deals_count) > 0) || pipes.find((p) => !p.is_archive) || pipes[0];
    if (!first) return c.json({ pipeline: null, columns: [], total: 0, pipelines: pipes });
    return c.json({
      ...listDealsBoard({ pipelineId: String(first.id), ...boardOpts }),
      pipelines: pipes,
      selected_pipeline_id: String(first.id),
    });
  }
  return c.json({
    ...listDealsBoard({ pipelineId, ...boardOpts }),
    pipelines: listPipelines(),
    selected_pipeline_id: pipelineId,
  });
});

api.get('/crm/deals/:id', (c) => {
  const deal = getDeal(c.req.param('id'));
  if (!deal) return c.json({ error: 'not found' }, 404);
  return c.json(deal);
});

/** Структура подчинения документов по заказу покупателя (сделка). */
api.get('/crm/deals/:id/doc-tree', (c) => {
  const tree = buildOrderDocTree(c.req.param('id'));
  if (!tree) return c.json({ error: 'not found' }, 404);
  return c.json(tree);
});

/** Готовность к расходной / УПД+списание: структура цепочки + остатки. */
api.get('/crm/deals/:id/ship-readiness', (c) => {
  const dealId = String(c.req.param('id') || '').trim();
  const deal = getDeal(dealId) as Record<string, unknown> | null;
  if (!deal) return c.json({ error: 'not found' }, 404);
  const tree = buildOrderDocTree(dealId);
  const preferred = String(c.req.query('warehouse_id') || '').trim();
  const { needs, missing } = planDealStockNeeds(deal, preferred);
  const structureMissing = Array.isArray(tree?.missing) ? tree!.missing.map(String) : [];
  return c.json({
    deal_id: dealId,
    structure: {
      complete: !!(tree && tree.complete),
      missing: structureMissing,
      note: tree?.note || '',
    },
    stock: {
      needs_count: needs.length,
      missing,
      ok: missing.length === 0,
    },
  });
});

/** Заказы на перемещение по заказу покупателя (для вкладки цепочки). */
api.get('/crm/deals/:id/transfer-orders', (c) => {
  const items = listDealTransferOrdersDetailed(c.req.param('id'));
  return c.json({ items, total: items.length });
});

api.get('/transfer-orders/:id', (c) => {
  const row = getDealTransferOrderDetail(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

/** Досоздать недостающие документы цепочки (перемещение-черновик, операция по карте). */
api.post('/crm/deals/:id/doc-chain/ensure', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const result = ensureOrderDocChain(c.req.param('id'));
    if (!result.tree) return c.json({ error: 'not found' }, 404);
    auditFromContext(c, {
      action: 'crm.doc_chain_ensure',
      entity: 'deal',
      entityId: c.req.param('id'),
      summary: `Цепочка документов: создано ${result.created.length}`,
      after: { created: result.created, complete: result.tree.complete },
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'ensure failed' }, 400);
  }
});

/** Добавить позицию в заказ (по product_id / sku / code). */
api.post('/crm/deals/:id/items', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    product_id?: string;
    sku?: string;
    code?: string;
    qty?: number;
    price?: number;
    warehouse_id?: string;
    supplier_id?: string;
    in_doc_id?: string;
    mark?: string;
    model?: string;
    generation?: string;
  };
  const result = addDealItem(dealId, body);
  if (!result.ok) {
    const status = result.error === 'not found' ? 404 : 400;
    return c.json({ error: result.error }, status);
  }
  auditFromContext(c, {
    action: 'crm.deal_item_add',
    entity: 'crm_deal',
    entityId: dealId,
    summary: `Позиция: ${String(result.item.sku || result.item.code || '')} × ${result.item.qty}`,
    after: {
      item_id: result.item.id,
      sku: result.item.sku,
      code: result.item.code,
      qty: result.item.qty,
      price: result.item.price,
    },
  });
  return c.json({ ok: true, item: result.item, deal: result.deal });
});

api.patch('/crm/deals/:id/items/:itemId', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const body = (await c.req.json().catch(() => ({}))) as { qty?: number; price?: number };
  const result = updateDealItem(dealId, itemId, body);
  if (!result.ok) return c.json({ error: result.error }, 404);
  auditFromContext(c, {
    action: 'crm.deal_item_update',
    entity: 'crm_deal',
    entityId: dealId,
    summary: `Позиция ${itemId}: qty=${result.item.qty}, price=${result.item.price}`,
    after: { item_id: itemId, qty: result.item.qty, price: result.item.price },
  });
  return c.json({ ok: true, item: result.item, deal: result.deal });
});

api.delete('/crm/deals/:id/items/:itemId', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const result = deleteDealItem(dealId, itemId);
  if (!result.ok) return c.json({ error: result.error }, 404);
  auditFromContext(c, {
    action: 'crm.deal_item_delete',
    entity: 'crm_deal',
    entityId: dealId,
    summary: `Удалена позиция ${itemId}`,
    before: { item_id: itemId },
  });
  return c.json({ ok: true, deal: result.deal });
});

/** Скан марки на сборке: сверка артикула с позицией заказа → запись марки/склада/поставщика. */
api.post('/crm/deals/:id/scan-unit', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    serial?: string;
    barcode?: string;
    code?: string;
    item_id?: string;
  };
  const serial = String(body.serial || body.barcode || body.code || '').trim();
  try {
    const row = assignDealUnitByScan(c.req.param('id'), serial, {
      item_id: body.item_id,
    });
    auditFromContext(c, {
      action: 'crm.deal_scan_unit',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: `Скан ${row.serial} → ${row.sku} · ${row.warehouse_name || 'склад'} · ${row.supplier_name || 'поставщик'}`,
      after: { serial: row.serial, item_id: row.item.id, matched_by: row.matched_by },
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Перенос сделки на другой этап + синк в AmoCRM. */
api.patch('/crm/deals/:id/stage', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    status_id?: string;
    status_name?: string;
    pipeline_id?: string;
  };
  const statusId = String(body.status_id || '').trim();
  if (!statusId) return c.json({ error: 'status_id required' }, 400);
  const dealId = c.req.param('id');
  const before = getDeal(dealId);
  if (!before) return c.json({ error: 'not found' }, 404);
  const b = before as Record<string, unknown>;

  const pipelineId = String(body.pipeline_id || b.pipeline_id || '').trim();
  const amoId = String(dealId).replace(/\D/g, '');
  let amoSynced = false;
  if (amoId) {
    const amo = await pushDealStageToAmo({
      dealId: amoId,
      statusId,
      pipelineId,
    });
    if (!amo.ok) {
      return c.json(
        {
          error: `Amo: ${amo.error}`,
          amo_http: amo.http ?? null,
        },
        502
      );
    }
    amoSynced = true;
  }

  const result = updateDealStage(dealId, {
    statusId,
    statusName: body.status_name,
    pipelineId,
  });
  if (!result.ok) return c.json({ error: result.error }, 404);
  auditFromContext(c, {
    action: 'crm.deal_stage',
    entity: 'crm_deal',
    entityId: dealId,
    summary: `Этап заказа ${dealId}: ${String(b.status_name || b.status_id || '—')} → ${String(result.deal.status_name || statusId)}${amoSynced ? ' (Amo)' : ''}`,
    before: { status_id: b.status_id, status_name: b.status_name },
    after: {
      status_id: result.deal.status_id,
      status_name: result.deal.status_name,
      amo_synced: amoSynced,
    },
  });
  return c.json({ ok: true, deal: result.deal, amo_synced: amoSynced });
});

/** QR СБП на оплату заказа (Точка через bank). */
api.post('/crm/deals/:id/sbp-qr', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    amount?: number;
    purpose?: string;
    account?: string;
    ttl_sec?: number;
  };
  try {
    const payment = await createDealSbpQr({
      dealId: c.req.param('id'),
      amount: body.amount,
      purpose: body.purpose,
      account: body.account,
      ttlSec: body.ttl_sec,
    });
    auditFromContext(c, {
      action: 'deal.sbp_qr',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: `QR СБП по заказу ${c.req.param('id')} на ${payment?.amount}`,
      after: { payment_id: payment?.id, qrc_id: payment?.qrc_id, amount: payment?.amount },
    });
    return c.json({ ok: true, payment });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'qr failed' }, 400);
  }
});

api.get('/crm/deals/:id/payments', (c) =>
  c.json({ items: listDealPayments(c.req.param('id')) })
);

api.get('/payments/:id', (c) => {
  const row = getDealPayment(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

api.delete('/payments/:id', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const id = c.req.param('id');
  const row = deleteDealPayment(id);
  if (!row) return c.json({ error: 'not found' }, 404);
  auditFromContext(c, {
    action: 'deal.payment_delete',
    entity: 'deal_payment',
    entityId: id,
    summary: `Удалён QR/оплата ${row.qrc_id || id} по заказу ${row.deal_id} на ${row.amount}`,
    before: {
      payment_id: row.id,
      deal_id: row.deal_id,
      qrc_id: row.qrc_id,
      amount: row.amount,
      status: row.status,
    },
  });
  return c.json({ ok: true, id, deal_id: row.deal_id });
});

api.get('/payments/:id/image.png', (c) => {
  const row = getDealPayment(c.req.param('id'));
  if (!row || !row.image_png_base64) return c.json({ error: 'not found' }, 404);
  const buf = Buffer.from(String(row.image_png_base64), 'base64');
  c.header('Content-Type', 'image/png');
  c.header('Cache-Control', 'no-store');
  return c.body(buf);
});

/** Пометить оплату оплаченной → сделка paid (шлюз склада). */
api.post('/payments/:id/mark-paid', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const r = markDealPaymentPaid({ paymentId: c.req.param('id'), source: 'manual' });
    auditFromContext(c, {
      action: 'deal.payment_paid',
      entity: 'deal_payment',
      entityId: c.req.param('id'),
      summary: `Оплата помечена paid · заказ ${r.deal_id}`,
      after: r,
    });
    return c.json(r);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'mark failed' }, 400);
  }
});

api.post('/crm/deals/:id/mark-paid', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const r = markDealPaymentPaid({ dealId: c.req.param('id'), source: 'manual' });
    auditFromContext(c, {
      action: 'deal.mark_paid',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: `Сделка ${c.req.param('id')} помечена оплаченной`,
      after: r,
    });
    return c.json(r);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'mark failed' }, 400);
  }
});

/** Покупатель заказа (ИНН / ФИО) — для УПД и документов, с пушем имени в Amo. */
api.patch('/crm/deals/:id/buyer', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    buyer_name?: string;
    buyer_inn?: string;
    company_name?: string;
    is_legal_entity?: boolean | number;
    buyer_kind?: string;
  };
  try {
    updateDealBuyer(dealId, body);
    const deal = getDeal(dealId);
    const cpId = ensureCounterpartyForDeal(deal as Record<string, unknown> | null);
    if (cpId) {
      const name = String(body.buyer_name || body.company_name || '').trim();
      const inn = String(body.buyer_inn || '').replace(/\D/g, '');
      const sets: string[] = [];
      const params: string[] = [];
      if (name) {
        sets.push('name = ?');
        params.push(name);
      }
      if (inn) {
        sets.push('inn = ?');
        params.push(inn);
      }
      if (sets.length) {
        params.push(cpId);
        run(`UPDATE counterparties SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      if (name) {
        await pushCounterpartyToAmo({
          counterpartyId: cpId,
          buyer: { name, inn },
          forceName: true,
        });
      }
    }
    const pushName = String(body.buyer_name || body.company_name || '').trim();
    if (pushName) {
      await pushContractBuyerToAmoContact({
        dealId,
        buyer: {
          name: pushName,
          inn: String(body.buyer_inn || '').replace(/\D/g, ''),
        },
        forceName: true,
      });
    }
    auditFromContext(c, {
      action: 'deal.buyer_update',
      entity: 'crm_deal',
      entityId: dealId,
      summary: `Покупатель заказа: ${pushName || '—'} · ИНН ${
        String(body.buyer_inn || '').replace(/\D/g, '') || '—'
      }`,
      after: body,
    });
    return c.json({ ok: true, deal: getDeal(dealId), counterparty_id: cpId });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Приём наличных (СТО / самовывоз): оплата kind=cash + сделка paid + приход в кассу. */
api.post('/crm/deals/:id/accept-cash', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    amount?: number;
    covers?: string;
    cash_register_id?: string;
    skip_cash_doc?: boolean;
  };
  try {
    const r = acceptDealCashPayment({
      dealId: c.req.param('id'),
      amount: body.amount,
      covers: body.covers,
      cash_register_id: body.cash_register_id,
      skip_cash_doc: body.skip_cash_doc === true,
      actorName: actor?.name || actor?.login || '',
    });
    auditFromContext(c, {
      action: 'deal.accept_cash',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: `Принято налом (${r.covers || 'all'}) · сделка ${c.req.param('id')} · ${r.payment?.amount ?? ''}`,
      after: {
        payment_id: r.payment?.id,
        amount: r.payment?.amount,
        covers: r.covers,
        cash_doc_id: r.cash_doc?.id,
        cash_doc_error: r.cash_doc_error,
        payment_status: r.payment_status,
        fully_paid: r.fully_paid,
      },
    });
    return c.json(r);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'accept cash failed' }, 400);
  }
});

/**
 * Webhook / poll ingest: банк или cron помечает оплату по qrc_id / deal_id.
 * Auth: X-Wms-Key = BANK_SBP_KEY | WMS_BANK_API_KEY | INGEST_KEY.
 */
api.post('/webhooks/payment-paid', async (c) => {
  const key = (c.req.header('X-Wms-Key') || c.req.query('key') || '').trim();
  const expect = (
    process.env.BANK_SBP_KEY ||
    process.env.WMS_BANK_API_KEY ||
    process.env.INGEST_KEY ||
    ''
  ).trim();
  if (!expect || key !== expect) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    payment_id?: string;
    deal_id?: string;
    qrc_id?: string;
  };
  try {
    const r = markDealPaymentPaid({
      paymentId: body.payment_id,
      dealId: body.deal_id,
      qrcId: body.qrc_id,
      source: 'webhook',
    });
    return c.json(r);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'webhook failed' }, 400);
  }
});

/**
 * Хук AmoCRM: изменения сделок / контактов (товары — SQL amo1c).
 * Auth: ?key= или X-Wms-Key / x-wms-ingest-key = WMS_INGEST_KEY.
 * Amo шлёт form-urlencoded — отвечаем быстро «OK».
 */
api.post('/webhooks/amo', async (c) => {
  const expect = amoWebhookSecret();
  const key = (
    c.req.query('key') ||
    c.req.header('X-Wms-Key') ||
    c.req.header('x-wms-ingest-key') ||
    ''
  ).trim();
  if (!expect || key !== expect) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const ct = (c.req.header('content-type') || '').toLowerCase();
  let body: unknown = {};
  const formKeys: string[] = [];
  try {
    if (ct.includes('application/json')) {
      body = await c.req.json().catch(() => ({}));
    } else {
      const parsed = await c.req.parseBody({ all: true });
      body = parsed;
      formKeys.push(...Object.keys(parsed || {}));
    }
  } catch {
    body = {};
  }

  if (!isAmoWebhookEnabled()) {
    // ключ верный, но переключатель выкл — Amo не должен отписывать (200)
    return c.text('OK', 200, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
  const parsed = parseAmoWebhookPayload(body, formKeys);
  recordAmoWebhookHit(parsed);
  // Amo отключает медленные хуки — короткий ответ
  return c.text('OK', 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

api.get('/webhooks/amo', (c) => {
  const expect = amoWebhookSecret();
  const key = (c.req.query('key') || c.req.header('X-Wms-Key') || '').trim();
  if (!expect || key !== expect) return c.json({ error: 'unauthorized' }, 401);
  return c.json({
    ok: true,
    enabled: isAmoWebhookEnabled(),
    hint: 'POST webhook for leads/contacts (products from amo1c SQL)',
  });
});

/** Опрос Точки по незакрытым QR → auto mark paid (Accepted). Для UI сделки. */
api.post('/payments/poll-tochka', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { deal_id?: string; limit?: number };
  try {
    const r = await pollPendingSbpPayments({
      dealId: body.deal_id || undefined,
      limit: body.limit,
    });
    if (r.marked > 0) {
      auditFromContext(c, {
        action: 'deal.payment_poll',
        entity: 'deal_payment',
        entityId: body.deal_id || '',
        summary: `Poll Точки: проверено ${r.checked}, оплачено ${r.marked}`,
        after: r,
      });
    }
    return c.json(r);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'poll failed' }, 502);
  }
});

/**
 * Cron: опрос всех незакрытых QR за 14 дней.
 * Auth: X-Wms-Key = BANK_SBP_KEY | WMS_BANK_API_KEY | INGEST_KEY | WMS_INGEST_KEY.
 */
api.post('/cron/poll-sbp', async (c) => {
  const key = (c.req.header('X-Wms-Key') || c.req.query('key') || '').trim();
  const expect = (
    process.env.BANK_SBP_KEY ||
    process.env.WMS_BANK_API_KEY ||
    process.env.WMS_INGEST_KEY ||
    process.env.INGEST_KEY ||
    ''
  ).trim();
  if (!expect || key !== expect) return c.json({ error: 'unauthorized' }, 401);
  try {
    const r = await pollPendingSbpPayments({ limit: 50 });
    return c.json(r);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'poll failed' }, 502);
  }
});
api.get('/cron/poll-sbp', async (c) => {
  const key = (c.req.header('X-Wms-Key') || c.req.query('key') || '').trim();
  const expect = (
    process.env.BANK_SBP_KEY ||
    process.env.WMS_BANK_API_KEY ||
    process.env.WMS_INGEST_KEY ||
    process.env.INGEST_KEY ||
    ''
  ).trim();
  if (!expect || key !== expect) return c.json({ error: 'unauthorized' }, 401);
  try {
    const r = await pollPendingSbpPayments({ limit: 50 });
    return c.json(r);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'poll failed' }, 502);
  }
});

/** Cron: истечение ссылок на оплату → возврат резерва со склада «Ожидание оплаты». */
function cronAuthOk(c: {
  req: {
    header: (n: string) => string | undefined;
    query: (n: string) => string | undefined;
  };
}): boolean {
  const key = (c.req.header('X-Wms-Key') || c.req.query('key') || '').trim();
  const expect = (
    process.env.BANK_SBP_KEY ||
    process.env.WMS_BANK_API_KEY ||
    process.env.WMS_INGEST_KEY ||
    process.env.INGEST_KEY ||
    ''
  ).trim();
  return Boolean(expect && key && key === expect);
}

api.post('/cron/expire-payment-reserves', (c) => {
  if (!cronAuthOk(c)) return c.json({ error: 'unauthorized' }, 401);
  return c.json(expireDuePaymentLinks(100));
});
api.get('/cron/expire-payment-reserves', (c) => {
  if (!cronAuthOk(c)) return c.json({ error: 'unauthorized' }, 401);
  return c.json(expireDuePaymentLinks(100));
});

/** Ежедневная подтяжка курсов ЦБ РФ (USD/CNY и internet-валюты). */
api.post('/cron/sync-cbr-rates', async (c) => {
  if (!cronAuthOk(c)) return c.json({ error: 'unauthorized' }, 401);
  try {
    const force = c.req.query('force') === '1';
    const r = await syncRatesFromCbr({ force });
    return c.json(r);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'cbr sync failed' }, 502);
  }
});
api.get('/cron/sync-cbr-rates', async (c) => {
  if (!cronAuthOk(c)) return c.json({ error: 'unauthorized' }, 401);
  try {
    const force = c.req.query('force') === '1';
    const r = await syncRatesFromCbr({ force });
    return c.json(r);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'cbr sync failed' }, 502);
  }
});

/** Создать / получить активную промежуточную ссылку на оплату по сделке. */
api.post('/crm/deals/:id/payment-link', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    timer_minutes?: number;
    reserve?: boolean;
    source_warehouse_id?: string;
    organization_id?: string;
  };
  try {
    const r = await createPaymentLinkFromDeal({
      dealId: c.req.param('id'),
      timerMinutes: body.timer_minutes,
      reserve: body.reserve,
      sourceWarehouseId: body.source_warehouse_id,
      organizationId: body.organization_id,
    });
    auditFromContext(c, {
      action: 'deal.payment_link',
      entity: 'payment_link',
      entityId: String(r.link.id || ''),
      summary: `Ссылка на оплату по заказу ${c.req.param('id')}: ${r.url}`,
      after: { url: r.url, token: r.link.token, expires_at: r.link.expires_at },
    });
    return c.json({
      ok: true,
      url: r.url,
      link: r.link,
      payment: r.payment,
      reserves: r.reserves,
      acquiring: r.acquiring,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'payment-link failed' }, 400);
  }
});

api.get('/crm/deals/:id/payment-links', (c) => {
  const items = listPaymentLinksForDeal(c.req.param('id')).map((row) => ({
    ...row,
    url: paymentLinkPublicUrl(String((row as { token: string }).token)),
  }));
  return c.json({ items });
});

/** Публичная страница оплаты (JSON). */
api.get('/public/pay/:token', (c) => {
  const view = getPublicPaymentLinkView(c.req.param('token'));
  if (!view) return c.json({ error: 'not found' }, 404);
  return c.json(view);
});

api.get('/public/pay/:token/qr.png', (c) => {
  const buf = getPublicPaymentQrPng(c.req.param('token'));
  if (!buf) return c.json({ error: 'not found' }, 404);
  c.header('Content-Type', 'image/png');
  c.header('Cache-Control', 'no-store');
  return c.body(new Uint8Array(buf));
});

api.post('/public/pay/:token/poll', async (c) => {
  try {
    const view = await pollPublicPaymentLink(c.req.param('token'));
    if (!view) return c.json({ error: 'not found' }, 404);
    return c.json(view);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'poll failed' }, 502);
  }
});

api.get('/public/pay/:token/poll', async (c) => {
  try {
    const view = await pollPublicPaymentLink(c.req.param('token'));
    if (!view) return c.json({ error: 'not found' }, 404);
    return c.json(view);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'poll failed' }, 502);
  }
});

/** Кнопка «Оплатить картой» — создать / вернуть ссылку эквайринга. */
api.post('/public/pay/:token/acquiring', async (c) => {
  try {
    const r = await ensureAcquiringForPublicToken(c.req.param('token'));
    if (!r) return c.json({ error: 'not found' }, 404);
    if (!r.ok) {
      return c.json({ ok: false, error: r.error || 'эквайринг не подключён', url: r.url }, 400);
    }
    return c.json({ ok: true, url: r.url });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : 'эквайринг не подключён' },
      400
    );
  }
});

/** Кнопка «Яндекс Пэй / Сплит» — создать / вернуть paymentUrl. */
api.post('/public/pay/:token/yandex-pay', async (c) => {
  try {
    const r = await ensureYandexPayForPublicToken(c.req.param('token'));
    if (r.error === 'not found') return c.json({ error: 'not found' }, 404);
    if (!r.ok) {
      return c.json({ ok: false, error: r.error || 'Яндекс Пэй не подключён', url: r.url }, 400);
    }
    return c.json({ ok: true, url: r.url, order_id: r.order_id });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : 'Яндекс Пэй не подключён' },
      400
    );
  }
});

/** Callback URL для кабинета Яндекс Пэй (Настройки → Callback URL). */
api.post('/public/yandex-pay/webhook', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (body.data || body.event || body) as Record<string, unknown>;
  const orderId = String(
    body.orderId || data.orderId || (data as { order?: { orderId?: string } }).order?.orderId || ''
  ).trim();
  const status = String(
    body.paymentStatus ||
      data.paymentStatus ||
      body.status ||
      data.status ||
      ''
  ).trim();
  try {
    const r = await applyYandexPayPaymentEvent({ orderId, status, event: body });
    return c.json(r);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'webhook failed' }, 400);
  }
});

/** Клиент меняет qty / убирает товары из наличия на странице оплаты. */
api.patch('/public/pay/:token/items', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; qty?: number }>;
  };
  try {
    const r = await updatePublicPaymentLinkItems(c.req.param('token'), body.items || []);
    if (!r.ok) {
      const status = (r.status || 400) as 400 | 404 | 502;
      return c.json({ ok: false, error: r.error }, status);
    }
    return c.json({ ok: true, ...r.view });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** После снятия резерва: проверить остатки и снова зарезервировать (новая /pay). */
api.post('/public/pay/:token/renew-reserve', async (c) => {
  try {
    const r = await renewPublicPaymentReserve(c.req.param('token'));
    if (!r.ok) {
      const status = (r.status || 400) as 400 | 404 | 429 | 500;
      return c.json({ ok: false, error: r.error }, status);
    }
    if (!r.available) {
      return c.json({
        ok: true,
        available: false,
        missing: r.missing,
        message: r.message,
        ...((r.view as object) || {}),
      });
    }
    return c.json({
      ok: true,
      available: true,
      url: r.url,
      renew_token: r.token,
      ...r.view,
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Вопрос клиента со страницы оплаты → примечание + задача ответственному. */
api.post('/public/pay/:token/question', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    text?: string;
    contact_name?: string;
    contact_phone?: string;
  };
  try {
    const r = await submitPublicPayQuestion(c.req.param('token'), body);
    if (!r.ok) {
      const status = (r.status || 400) as 400 | 404 | 429;
      return c.json({ ok: false, error: r.error }, status);
    }
    return c.json({
      ok: true,
      message: 'Вопрос отправлен менеджеру. Ответим в ближайшее время.',
      task_id: r.task_id,
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/fiscal/status', (c) => c.json(atolStatusInfo()));

api.get('/crm/deals/:id/fiscal', (c) =>
  c.json({ items: listFiscalReceipts(c.req.param('id')), atol: atolStatusInfo() })
);

/** Чек 1 / 2 / возврат. send по умолчанию true. */
api.post('/crm/deals/:id/fiscal/:kind', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const kind = c.req.param('kind');
  const allowed = ['advance', 'full', 'refund', 'refund_advance'] as const;
  if (!(allowed as readonly string[]).includes(kind)) {
    return c.json({ error: 'kind: advance | full | refund | refund_advance' }, 400);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    send?: boolean;
    parent_receipt_id?: string;
  };
  try {
    const receipt = await prepareOrSendFiscalReceipt({
      dealId: c.req.param('id'),
      kind: kind as (typeof allowed)[number],
      send: body.send !== false,
      parent_receipt_id: body.parent_receipt_id,
    });
    auditFromContext(c, {
      action: 'fiscal.receipt',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: `Чек ${kind} по заказу ${c.req.param('id')}: ${receipt?.status}`,
      after: {
        receipt_id: receipt?.id,
        status: receipt?.status,
        amount: receipt?.amount,
        parent_receipt_id: body.parent_receipt_id || null,
      },
    });
    return c.json({ ok: true, receipt, atol: atolStatusInfo() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'fiscal failed' }, 400);
  }
});

api.get('/fiscal/receipts/:id', (c) => {
  const row = getFiscalReceipt(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

api.post('/crm/deals/sync', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_sync')) {
    return c.json({ error: 'Недостаточно прав: синхронизация' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    days?: number;
    limit?: number;
    deal_id?: string;
  };
  try {
    const result = syncDealsFromAmo1c({
      days: body.days ?? 60,
      limit: body.limit ?? 800,
      dealId: body.deal_id,
    });
    auditFromContext(c, {
      action: 'crm.deals_sync',
      entity: 'crm_deal',
      entityId: body.deal_id ? String(body.deal_id) : '',
      summary: body.deal_id
        ? `Обновление сделки Amo ${body.deal_id}`
        : `Синк сделок Amo: ${result.deals}, воронок ${result.pipelines}`,
      after: result,
    });
    return c.json({ ok: true, ...result, meta: dealsMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'deals sync failed' }, 500);
  }
});

/** Компании + контакты Amo (+ связи) → counterparties. */
api.post('/crm/counterparties/sync', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_sync')) {
    return c.json({ error: 'Недостаточно прав: синхронизация' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    limit?: number;
    pages?: number;
  };
  try {
    const result = await syncCounterpartiesFromAmo({
      limit: body.limit ?? 5000,
      pages: body.pages ?? 40,
    });
    auditFromContext(c, {
      action: 'crm.counterparties_sync',
      entity: 'counterparty',
      summary: `Синк Amo компаний/контактов: компаний ${result.upsertedCompanies}, контактов ${result.upsertedContacts}, связей ${result.upsertedLinks}`,
      after: result,
    });
    return c.json({ ok: true, ...result, meta: amoCounterpartiesMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'counterparties sync failed' }, 500);
  }
});

api.get('/crm/counterparties/sync/meta', (c) => c.json(amoCounterpartiesMeta()));

/** Dual-write из amo1c при «Отправить в 1С» (ключ WMS_INGEST_KEY). */
api.post('/crm/deals/ingest', async (c) => {
  const key = c.req.query('key') || c.req.header('x-wms-ingest-key') || '';
  const expect = process.env.WMS_INGEST_KEY || '';
  if (!expect || key !== expect) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    deal?: Record<string, unknown>;
    pipelines?: Array<Record<string, unknown>>;
  };
  if (!body.deal || !body.deal.id) {
    return c.json({ error: 'deal required' }, 400);
  }
  const dealId = String(body.deal.id);
  const before = getDeal(dealId);
  upsertDealRecord(body.deal);

  // Кто нажал «в 1С» в Amo — queued_by; иначе ответственный.
  const queuedBy = String(body.deal.queued_by || '').replace(/\u00a0/g, ' ').trim();
  const respAmoId = String(body.deal.responsible_user_id || '').trim();
  let ingestActor: { id: string; login: string; name: string } | null = null;
  if (queuedBy) {
    const st = get<{ id: string; login: string; name: string }>(
      `SELECT id, IFNULL(login,'') AS login, name FROM staff
       WHERE replace(name, char(160), ' ') = ? OR name = ?
       ORDER BY CASE WHEN IFNULL(login,'') != '' THEN 0 ELSE 1 END
       LIMIT 1`,
      [queuedBy, queuedBy]
    );
    ingestActor = st
      ? { id: st.id, login: st.login, name: st.name }
      : { id: '', login: '', name: queuedBy };
  } else if (respAmoId) {
    const st = get<{ id: string; login: string; name: string }>(
      `SELECT id, IFNULL(login,'') AS login, name FROM staff WHERE amo_id = ? LIMIT 1`,
      [respAmoId]
    );
    if (st) ingestActor = { id: st.id, login: st.login, name: st.name };
  }

  const dealName = String(body.deal.name || dealId).replace(/\s+/g, ' ').trim();
  const whoBit = queuedBy ? ` · отправил ${queuedBy}` : '';
  writeAudit({
    action: 'crm.deal_ingest',
    entity: 'crm_deal',
    entityId: dealId,
    summary: before
      ? `Обновление из Amo («в 1С»${whoBit}): ${dealName}`
      : `Новая сделка из Amo («в 1С»${whoBit}): ${dealName}`,
    before: before || undefined,
    after: {
      id: dealId,
      name: body.deal.name,
      price: body.deal.price,
      queued_by: queuedBy,
      items_count: Array.isArray(body.deal.items) ? body.deal.items.length : undefined,
    },
    actor: ingestActor
      ? ({
          id: ingestActor.id,
          login: ingestActor.login,
          name: ingestActor.name,
          email: '',
          role: 'staff',
          rights: {},
          isSystemAdmin: false,
        } as Actor)
      : null,
  });
  return c.json({ ok: true, id: dealId });
});

api.get('/org-profile', (c) => {
  const profile = getOrgProfile();
  return c.json({ ...profile, ...orgPrintAssetsMeta(profile.inn) });
});

api.put('/org-profile', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as Record<string, string | number>;
  if (typeof body.phone === 'string') {
    body.phone = normalizePhoneForStorage(body.phone);
  }
  const saved = saveOrgProfile(body as Record<string, string>);
  auditFromContext(c, {
    action: 'org.profile_save',
    entity: 'org_profile',
    summary: 'Реквизиты организации для печати счетов/УПД',
    after: saved,
  });
  return c.json({ ...saved, ...orgPrintAssetsMeta(saved.inn) });
});

async function readImageUploadBody(c: Context): Promise<Buffer | null> {
  const contentType = (c.req.header('content-type') || '').toLowerCase();
  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody({ all: true });
    const file = body.file ?? body.photo ?? body.image ?? body.stamp ?? body.signature;
    if (file && typeof file === 'object' && 'arrayBuffer' in file) {
      return Buffer.from(await (file as File).arrayBuffer());
    }
    return null;
  }
  if (contentType.includes('application/json')) {
    const body = await c.req.json<{ image_base64?: string; data_url?: string }>();
    let raw = String(body.image_base64 || body.data_url || '').trim();
    const m = raw.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
    if (m) raw = m[1]!;
    if (raw) return Buffer.from(raw, 'base64');
    return null;
  }
  const ab = await c.req.arrayBuffer();
  return ab.byteLength ? Buffer.from(ab) : null;
}

/** Загрузить скан печати (М.П.) для текущего org-profile (по ИНН). */
api.post('/org-profile/stamp', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const profile = getOrgProfile();
  let buf: Buffer | null = null;
  try {
    buf = await readImageUploadBody(c);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Не удалось прочитать файл' }, 400);
  }
  if (!buf?.length) return c.json({ error: 'Нужен файл изображения (file) или image_base64' }, 400);
  try {
    const r = saveOrgPrintAsset(profile.inn, 'stamp', buf);
    auditFromContext(c, {
      action: 'org.stamp_upload',
      entity: 'org_profile',
      summary: `Печать загружена · ИНН ${r.inn}`,
    });
    return c.json({ ok: true, ...orgPrintAssetsMeta(r.inn) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'upload failed' }, 400);
  }
});

/** Загрузить скан подписи (факсимиле) для текущего org-profile. */
api.post('/org-profile/signature', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const profile = getOrgProfile();
  let buf: Buffer | null = null;
  try {
    buf = await readImageUploadBody(c);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Не удалось прочитать файл' }, 400);
  }
  if (!buf?.length) return c.json({ error: 'Нужен файл изображения (file) или image_base64' }, 400);
  try {
    const r = saveOrgPrintAsset(profile.inn, 'sign', buf);
    auditFromContext(c, {
      action: 'org.signature_upload',
      entity: 'org_profile',
      summary: `Подпись загружена · ИНН ${r.inn}`,
    });
    return c.json({ ok: true, ...orgPrintAssetsMeta(r.inn) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'upload failed' }, 400);
  }
});

api.delete('/org-profile/stamp', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const profile = getOrgProfile();
  deleteOrgPrintAsset(profile.inn, 'stamp');
  return c.json({ ok: true, ...orgPrintAssetsMeta(profile.inn) });
});

api.delete('/org-profile/signature', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const profile = getOrgProfile();
  deleteOrgPrintAsset(profile.inn, 'sign');
  return c.json({ ok: true, ...orgPrintAssetsMeta(profile.inn) });
});

/** Публичная раздача печати/подписи для HTML-бланков. */
api.get('/public/org-assets/:inn/:kind', (c) => {
  const inn = String(c.req.param('inn') || '').replace(/\D/g, '');
  const kindRaw = String(c.req.param('kind') || '').toLowerCase();
  const kind: OrgPrintAssetKind | null =
    kindRaw.startsWith('stamp') ? 'stamp' : kindRaw.startsWith('sign') ? 'sign' : null;
  if (!inn || !kind) return c.json({ error: 'not found' }, 404);
  const filePath =
    kind === 'stamp' ? resolveOrgStampPngPath(inn) : resolveOrgSignPngPath(inn);
  if (!filePath) return c.json({ error: 'not found' }, 404);
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const ct =
      ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/png';
    return c.body(buf, 200, {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=300',
    });
  } catch {
    return c.json({ error: 'not found' }, 404);
  }
});

api.get('/ui-settings', (c) => {
  const s = getUiSettings();
  const waitWh = ensureWaitingPaymentWarehouse();
  return c.json({
    ...s,
    phone_formats: PHONE_FORMATS.map((id) => ({
      id,
      label: PHONE_FORMAT_LABELS[id],
    })),
    payment_link_defaults: {
      timer_minutes: DEFAULT_PAYMENT_LINK_TIMER_MINUTES,
    },
    waiting_payment_warehouse: waitWh,
  });
});

api.put('/ui-settings', async (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'settings')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    phone_format?: string;
    payment_link_timer_minutes?: number;
    payment_link_reserve_enabled?: boolean;
    payment_link_default_warehouse_id?: string;
    payment_link_default_organization_id?: string;
  };
  const saved = saveUiSettings({
    phone_format: body.phone_format as PhoneFormat | undefined,
    payment_link_timer_minutes: body.payment_link_timer_minutes,
    payment_link_reserve_enabled: body.payment_link_reserve_enabled,
    payment_link_default_warehouse_id: body.payment_link_default_warehouse_id,
    payment_link_default_organization_id: body.payment_link_default_organization_id,
  });
  auditFromContext(c, {
    action: 'ui.settings_save',
    entity: 'ui_settings',
    summary: `Настройки UI: телефоны ${PHONE_FORMAT_LABELS[saved.phone_format]}, таймер оплаты ${saved.payment_link_timer_minutes} мин`,
    after: saved,
  });
  const waitWh = ensureWaitingPaymentWarehouse();
  return c.json({
    ...saved,
    phone_formats: PHONE_FORMATS.map((id) => ({
      id,
      label: PHONE_FORMAT_LABELS[id],
    })),
    payment_link_defaults: {
      timer_minutes: DEFAULT_PAYMENT_LINK_TIMER_MINUTES,
    },
    waiting_payment_warehouse: waitWh,
  });
});

/** Настройки ссылки на оплату (алиас под раздел настроек). */
api.get('/payment-link-settings', (c) => {
  const s = getPaymentLinkSettings();
  return c.json({
    ...s,
    waiting_payment_warehouse: ensureWaitingPaymentWarehouse(),
    default_timer_minutes: DEFAULT_PAYMENT_LINK_TIMER_MINUTES,
  });
});

api.put('/payment-link-settings', async (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'settings')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    payment_link_timer_minutes?: number;
    payment_link_reserve_enabled?: boolean;
    payment_link_default_warehouse_id?: string;
    payment_link_default_organization_id?: string;
  };
  const saved = savePaymentLinkSettings(body);
  ensureWaitingPaymentWarehouse();
  auditFromContext(c, {
    action: 'payment_link.settings',
    entity: 'ui_settings',
    summary: `Ссылка на оплату: таймер ${saved.payment_link_timer_minutes} мин, резерв ${saved.payment_link_reserve_enabled ? 'вкл' : 'выкл'}`,
    after: saved,
  });
  return c.json({
    ...saved,
    waiting_payment_warehouse: ensureWaitingPaymentWarehouse(),
    default_timer_minutes: DEFAULT_PAYMENT_LINK_TIMER_MINUTES,
  });
});

/* ——— Интеграции: СДЭК / АТОЛ / Точка (ключи в UI, секреты в meta / bank) ——— */

api.get('/settings/integrations/atol', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'settings')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  return c.json({ ok: true, ...atolSettingsPublic(), status: atolStatusInfo() });
});

api.get('/settings/integrations/yandex-pay', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'settings')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const orgs = listOrganizations({ activeOnly: true }).map((o) => ({
    id: o.id,
    name: o.name,
    short_name: o.short_name,
    inn: o.inn,
    is_default: o.is_default,
  }));
  const pub = yandexPaySettingsPublic();
  return c.json({
    ok: true,
    ...pub,
    live_configured: (pub.profiles || []).some((p) => p.enabled && p.configured),
    organizations: orgs,
  });
});

api.put('/settings/integrations/yandex-pay', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Сохранять Яндекс Сплит может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const saved = saveYandexPaySettings(body);
    auditFromContext(c, {
      action: 'integrations.yandex_pay_save',
      entity: 'integration_yandex_pay',
      summary: `Яндекс Сплит: юрлицо ${saved.organization_id}, merchant ${saved.merchant_id ? 'задан' : 'нет'}, env ${saved.env}`,
      after: {
        organization_id: saved.organization_id,
        merchant_id: saved.merchant_id,
        env: saved.env,
        enabled: saved.enabled,
      },
    });
    const orgs = listOrganizations({ activeOnly: true }).map((o) => ({
      id: o.id,
      name: o.name,
      short_name: o.short_name,
      inn: o.inn,
      is_default: o.is_default,
    }));
    const pub = yandexPaySettingsPublic(saved);
    return c.json({
      ok: true,
      ...pub,
      live_configured: (pub.profiles || []).some((p) => p.enabled && p.configured),
      organizations: orgs,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'save failed' }, 400);
  }
});

api.delete('/settings/integrations/yandex-pay/:organizationId', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Удалять профиль может админ или менеджер' }, 403);
  }
  try {
    const r = deleteYandexPayProfile(c.req.param('organizationId'));
    auditFromContext(c, {
      action: 'integrations.yandex_pay_delete',
      entity: 'integration_yandex_pay',
      entityId: r.organization_id,
      summary: `Яндекс Сплит: удалён профиль юрлица ${r.organization_id}`,
    });
    return c.json({ ...yandexPaySettingsPublic(), ...r, ok: true });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'delete failed' }, 400);
  }
});

api.put('/settings/integrations/atol', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Сохранять АТОЛ может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const saved = saveAtolSettings(body);
  auditFromContext(c, {
    action: 'integrations.atol_save',
    entity: 'integration_atol',
    summary: `АТОЛ: ${saved.login ? 'логин задан' : 'без логина'}, группа ${saved.group_code || '—'}`,
    after: { group_code: saved.group_code, inn: saved.inn, sno: saved.sno, configured: Boolean(saved.login && saved.pass && saved.group_code) },
  });
  return c.json({ ok: true, ...atolSettingsPublic(saved), status: atolStatusInfo() });
});

api.post('/settings/integrations/atol/test', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'settings')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const result = await testAtolConnection();
  return c.json(result, result.ok ? 200 : 400);
});

api.get('/settings/integrations/tochka', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'settings')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const bridge = tochkaBridgePublic();
  let bank = await fetchTochkaBankAppSettings();
  if (bank.ok === false && !bridge.configured) {
    bank = {
      ok: false,
      error: bank.error || 'Сначала задайте ключ моста Учёт №1 → bank',
    };
  }
  return c.json({
    ok: true,
    bridge,
    bank,
    bank_settings_url: bankSettingsApiUrl(),
  });
});

api.put('/settings/integrations/tochka', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Сохранять Точку может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const bridgePatch = (body.bridge || body) as Record<string, unknown>;
  const bankPatch = (body.bank || {}) as Record<string, unknown>;
  const bridgeSaved = saveTochkaBridgeSettings(bridgePatch);
  let bank = await fetchTochkaBankAppSettings();
  if (Object.keys(bankPatch).length > 0) {
    bank = await saveTochkaBankAppSettings(bankPatch);
  }
  auditFromContext(c, {
    action: 'integrations.tochka_save',
    entity: 'integration_tochka',
    summary: `Точка: мост ${bridgeSaved.bank_sbp_key ? 'ключ задан' : 'без ключа'}`,
    after: {
      bridge_configured: Boolean(bridgeSaved.bank_sbp_key),
      bank_ok: bank.ok,
      client_id_set: bank.client_id_set,
    },
  });
  return c.json({
    ok: true,
    bridge: tochkaBridgePublic(bridgeSaved),
    bank,
    bank_settings_url: bankSettingsApiUrl(),
  });
});

api.post('/settings/integrations/tochka/test', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'settings')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const data = await fetchTochkaOverview();
    return c.json({
      ok: true,
      message: `Точка отвечает · счетов ${data.totals?.accounts ?? data.accounts?.length ?? 0}`,
      totals: data.totals || null,
    });
  } catch (e) {
    return c.json(
      { ok: false, message: e instanceof Error ? e.message : 'tochka failed' },
      400
    );
  }
});

api.get('/settings/integrations/cdek', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'settings')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const bridge = cdekBridgePublic();
  let widget: Awaited<ReturnType<typeof fetchCdekSettings>> | { ok: false; error: string };
  try {
    widget = await fetchCdekSettings();
  } catch (e) {
    widget = { ok: false, error: e instanceof Error ? e.message : 'cdek settings failed' };
  }
  return c.json({
    ok: true,
    bridge,
    widget,
    configured: cdekConfigured(),
  });
});

api.put('/settings/integrations/cdek', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Сохранять СДЭК может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const bridgePatch = (body.bridge || {}) as Record<string, unknown>;
  const widgetPatch = (body.widget || {}) as Record<string, unknown>;
  let bridgeSaved = cdekBridgePublic();
  if (Object.keys(bridgePatch).length > 0) {
    bridgeSaved = cdekBridgePublic(saveCdekBridgeSettings(bridgePatch));
  }
  let widget: Awaited<ReturnType<typeof saveCdekSettings>> | { ok: false; error: string } = {
    ok: false,
    error: 'Виджет не обновлялся',
  };
  if (Object.keys(widgetPatch).length > 0) {
    try {
      widget = await saveCdekSettings(widgetPatch);
    } catch (e) {
      widget = { ok: false, error: e instanceof Error ? e.message : 'cdek save failed' };
    }
  } else {
    try {
      widget = await fetchCdekSettings();
    } catch (e) {
      widget = { ok: false, error: e instanceof Error ? e.message : 'cdek settings failed' };
    }
  }
  auditFromContext(c, {
    action: 'integrations.cdek_save',
    entity: 'integration_cdek',
    summary: `СДЭК: мост ${bridgeSaved.configured ? 'ключ задан' : 'без ключа'}`,
    after: {
      bridge_configured: bridgeSaved.configured,
      widget_ok: widget.ok !== false,
      accounts: (widget as { accounts?: Array<{ id: string }> }).accounts?.map((a) => a.id),
    },
  });
  return c.json({
    ok: true,
    bridge: bridgeSaved,
    widget,
    configured: cdekConfigured(),
  });
});

api.get('/settings/integrations/dadata', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  return c.json(dadataPublic());
});

api.put('/settings/integrations/dadata', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Сохранять DaData может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const saved = dadataPublic(saveDadataSettings(body));
  auditFromContext(c, {
    action: 'integrations.dadata_save',
    entity: 'integration_dadata',
    summary: `DaData: ${saved.configured ? 'ключ задан' : 'без ключа'}`,
    after: { configured: saved.configured, secret_set: saved.secret_set },
  });
  return c.json({ ok: true, ...saved });
});

api.get('/settings/integrations/deepseek', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  return c.json(deepseekPublic());
});

api.put('/settings/integrations/deepseek', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Сохранять DeepSeek может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const saved = deepseekPublic(saveDeepseekSettings(body));
  auditFromContext(c, {
    action: 'integrations.deepseek_save',
    entity: 'integration_deepseek',
    summary: `DeepSeek: ${saved.configured ? 'ключ задан' : 'без ключа'}`,
    after: { configured: saved.configured, base_url: saved.base_url, vision_model: saved.vision_model },
  });
  return c.json({ ok: true, ...saved });
});

api.post('/settings/integrations/deepseek/test', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const s = getDeepseekSettings();
  if (!s.api_key) return c.json({ ok: false, error: 'Нет API-ключа' }, 400);
  let base = String(s.base_url || '').replace(/\/+$/, '');
  if (!base) return c.json({ ok: false, error: 'Не задан Base URL' }, 400);
  if (!/\/v\d+$/i.test(base) && /openrouter\.ai/i.test(base)) {
    base = base.replace(/\/api$/i, '') + '/api/v1';
  }
  const url = `${base}/models`;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${s.api_key}`,
    };
    if (/openrouter\.ai/i.test(base)) {
      headers['HTTP-Referer'] = process.env.OPENROUTER_REFERER || 'https://uchetn1.ru';
      headers['X-Title'] = process.env.OPENROUTER_TITLE || 'Uchet1 STS OCR';
    }
    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    if (res.ok) return c.json({ ok: true, http: res.status, base });
    let detail = text.slice(0, 240);
    try {
      const j = JSON.parse(text) as { error?: string | { message?: string } };
      if (typeof j.error === 'string') detail = j.error;
      else if (j.error && typeof j.error === 'object') detail = String(j.error.message || detail);
    } catch {
      /* keep */
    }
    if (/access denied by security policy/i.test(detail)) {
      detail =
        'OpenRouter блокирует IP VPS (Cloudflare). Ключ может быть верным — нужен прокси или другой шлюз.';
    }
    return c.json({ ok: false, http: res.status, error: detail, base }, 400);
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e), base }, 400);
  }
});

api.post('/settings/integrations/dadata/test', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const r = await testDadataConnection();
  return c.json(r, r.ok ? 200 : 400);
});

api.get('/settings/integrations/amo', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'integrations') && !canAccessSection(actor, 'crm')) {
    return c.json({ error: 'Нет доступа' }, 403);
  }
  return c.json(amoBridgePublic());
});

api.put('/settings/integrations/amo', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Сохранять Amo может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    stages?: { success_after_handed?: Record<string, string> };
    pipeline_company?: Record<string, string>;
    staff_mappings?: Array<{ staff_id: string; amo_id: string }>;
  };
  const saved = saveAmoIntegrationSettings({
    stages: body.stages,
    pipeline_company: body.pipeline_company,
  });
  let staffUpdated = 0;
  if (Array.isArray(body.staff_mappings)) {
    staffUpdated = saveStaffAmoMappings(body.staff_mappings).updated;
  }
  const pub = amoBridgePublic();
  auditFromContext(c, {
    action: 'integrations.amo_save',
    entity: 'integration_amo',
    summary: `Amo: этапы ${Object.keys(saved.stages.success_after_handed).length}, воронок→орг ${Object.keys(saved.pipeline_company).length}, сотрудников ${staffUpdated}`,
    after: {
      stages: saved.stages,
      pipeline_company: saved.pipeline_company,
      staff_updated: staffUpdated,
    },
  });
  return c.json({ ok: true, ...pub, staff_updated: staffUpdated });
});

/** Вкл/выкл хук Amo (сделки · контакты) + подписка в AmoCRM. Товары — SQL amo1c. */
api.put('/settings/integrations/amo/webhook', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Переключать хук может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: boolean };
  const enabled = Boolean(body.enabled);
  const r = await setAmoWebhookEnabled(enabled);
  if (!r.ok) return c.json({ error: r.error || 'failed' }, 400);
  auditFromContext(c, {
    action: 'integrations.amo_webhook',
    entity: 'integration_amo',
    summary: enabled
      ? `Amo хук включён${r.amo_ok ? '' : ' (подписка Amo: ' + (r.error || 'ошибка') + ')'}`
      : 'Amo хук выключен',
    after: {
      enabled: r.enabled,
      amo_ok: r.amo_ok,
      amo_subscribed: r.amo_subscribed,
    },
  });
  return c.json({ ...r, bridge: amoBridgePublic().bridge });
});

api.get('/settings/integrations/amo/sale-rules', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'integrations') && !canAccessSection(actor, 'crm')) {
    return c.json({ error: 'Нет доступа' }, 403);
  }
  return c.json(amoBridgePublic().sale_rules);
});

api.put('/settings/integrations/amo/sale-rules', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Сохранять правила Amo может админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const saved = saveAmoSaleRulesConfig(body as Parameters<typeof saveAmoSaleRulesConfig>[0]);
  auditFromContext(c, {
    action: 'integrations.amo_sale_rules_save',
    entity: 'integration_amo',
    summary: `Amo правила: полей ${saved.fields.length}, сценариев ${saved.scenarios.length}, lock=${saved.lock_fields ? 1 : 0}`,
    after: {
      fields: saved.fields.length,
      scenarios: saved.scenarios.length,
      lock_fields: saved.lock_fields,
    },
  });
  return c.json({ ok: true, ...amoBridgePublic().sale_rules });
});

api.post('/settings/integrations/amo/sale-rules/check', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'integrations') && !canAccessSection(actor, 'crm')) {
    return c.json({ error: 'Нет доступа' }, 403);
  }
  const result = checkAmoSaleConfigDrift();
  return c.json({ ...result, sale_rules: amoBridgePublic().sale_rules });
});

api.post('/settings/integrations/amo/sale-rules/alerts/seen', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { id?: string; all?: boolean };
  if (body.all) markAllAmoIntegrationAlertsSeen();
  else if (body.id) markAmoIntegrationAlertSeen(String(body.id));
  return c.json({ ok: true, sale_rules: amoBridgePublic().sale_rules });
});

api.get('/dadata/party', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const q = String(c.req.query('q') || '').trim();
  const count = Math.min(20, Math.max(1, Number(c.req.query('count')) || 8));
  try {
    const items = await suggestParty(q, count);
    return c.json({ items });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'dadata failed' }, 400);
  }
});

api.get('/dadata/fio', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const q = String(c.req.query('q') || '').trim();
  const count = Math.min(20, Math.max(1, Number(c.req.query('count')) || 8));
  try {
    const items = await suggestFio(q, count);
    return c.json({ items });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'dadata failed' }, 400);
  }
});

api.get('/dadata/address', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const q = String(c.req.query('q') || '').trim();
  const count = Math.min(20, Math.max(1, Number(c.req.query('count')) || 8));
  try {
    const items = await suggestAddress(q, count);
    return c.json({ items });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'dadata failed' }, 400);
  }
});

api.post('/dadata/party/find', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { inn?: string; query?: string };
  const inn = String(body.inn || body.query || '').replace(/\D/g, '');
  try {
    const party = await findPartyByInn(inn);
    if (!party) return c.json({ error: 'Организация не найдена' }, 404);
    return c.json({ party });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'dadata failed' }, 400);
  }
});

api.post('/counterparties/:id/dadata-fill', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const id = c.req.param('id');
  const row = get<Record<string, unknown>>('SELECT * FROM counterparties WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    inn?: string;
    party?: Record<string, unknown>;
  };
  try {
    let party = body.party as
      | {
          inn?: string;
          kpp?: string;
          ogrn?: string;
          name?: string;
          name_full?: string;
          address?: string;
        }
      | null;
    if (!party) {
      const inn = String(body.inn || row.inn || '').replace(/\D/g, '');
      const found = await findPartyByInn(inn);
      if (!found) return c.json({ error: 'Организация не найдена в DaData' }, 404);
      party = found;
    }
    const name = String(party.name || '').trim();
    const nameFull = String(party.name_full || name).trim();
    const inn = String(party.inn || '').replace(/\D/g, '');
    const kpp = String(party.kpp || '').replace(/\D/g, '');
    const ogrn = String(party.ogrn || '').replace(/\D/g, '');
    const address = String(party.address || '').trim();
    if (name) run('UPDATE counterparties SET name = ? WHERE id = ?', [name, id]);
    if (nameFull) run('UPDATE counterparties SET name_full = ? WHERE id = ?', [nameFull, id]);
    if (inn) run('UPDATE counterparties SET inn = ? WHERE id = ?', [inn, id]);
    run('UPDATE counterparties SET kpp = ? WHERE id = ?', [kpp, id]);
    run('UPDATE counterparties SET ogrn = ? WHERE id = ?', [ogrn, id]);
    run('UPDATE counterparties SET address = ? WHERE id = ?', [address, id]);
    run('UPDATE counterparties SET dadata_synced_at = datetime(?) WHERE id = ?', [
      new Date().toISOString(),
      id,
    ]);
    const after = get('SELECT * FROM counterparties WHERE id = ?', [id]);
    auditFromContext(c, {
      action: 'counterparty.dadata_fill',
      entity: 'counterparty',
      entityId: id,
      summary: `DaData: ${(after as { name?: string })?.name || id}`,
      before: { name: row.name, inn: row.inn },
      after: { name: (after as { name?: string })?.name, inn: (after as { inn?: string })?.inn },
    });
    return c.json({ ok: true, counterparty: after, party });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'dadata fill failed' }, 400);
  }
});

api.get('/counterparties/dadata/stats', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  return c.json(dadataEnrichStats());
});

api.post('/counterparties/dadata/enrich', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor?.role !== 'manager') {
    return c.json({ error: 'Массовое обогащение — админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    limit?: number;
    overwrite_name?: boolean;
  };
  try {
    const result = await enrichCounterpartiesFromDadata({
      limit: body.limit,
      overwriteName: body.overwrite_name === true,
    });
    auditFromContext(c, {
      action: 'counterparties.dadata_enrich',
      entity: 'counterparty',
      summary: `DaData пакет: обновлено ${result.updated} из ${result.scanned}`,
      after: {
        updated: result.updated,
        scanned: result.scanned,
        not_found: result.not_found,
        errors: result.errors,
      },
    });
    return c.json({ ok: true, ...result, stats: dadataEnrichStats() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'enrich failed' }, 400);
  }
});

api.get('/doc-numbering', (c) => c.json(getDocNumberingState()));

api.post('/doc-numbering/sync-from-1c', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const state = await syncDocNumberingFrom1c();
    auditFromContext(c, {
      action: 'doc.numbering_sync',
      entity: 'doc_numbering',
      summary: `Нумерация из 1С: расход ${state.last_out_1c}, приход ${state.last_in_1c}`,
      after: state,
    });
    return c.json({ ok: true, ...state });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'sync failed' }, 500);
  }
});

api.put('/doc-numbering', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    last_out?: string | number;
    last_in?: string | number;
    last_invoice?: string | number;
  };
  try {
    const state = applyDocNumberingPatch(body);
    auditFromContext(c, {
      action: 'doc.numbering_set',
      entity: 'doc_numbering',
      summary: 'Ручная установка последних номеров документов',
      after: state,
    });
    return c.json({ ok: true, ...state });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'bad numbering' }, 400);
  }
});

api.get('/sales-docs', (c) => {
  const type = (c.req.query('type') || '').trim() as SalesDocType | '';
  const q = (c.req.query('q') || '').trim();
  const dealId = (c.req.query('deal_id') || '').trim();
  const companyId = (c.req.query('company_id') || '').trim();
  const { page, limit } = parsePage(c, 50);
  const coFilter = resolveListCompanyFilter(actorFromContext(c), companyId);
  if (coFilter.mode === 'none') {
    return c.json({
      items: [],
      total: 0,
      page: 1,
      limit,
      pages: 1,
      labels: { invoice: 'Счёт', upd: 'УПД', sf: 'СФ', workorder: 'Заказ-наряд' },
    });
  }
  const result = listSalesDocs({
    type:
      type === 'invoice' ||
      type === 'upd' ||
      type === 'sf' ||
      type === 'workorder' ||
      type === 'contract'
        ? type
        : '',
    q,
    dealId: dealId || undefined,
    companyId: coFilter.mode === 'one' ? coFilter.id : companyId || undefined,
    companyIds: coFilter.mode === 'in' ? coFilter.ids : undefined,
    page,
    limit,
  });
  return c.json({
    ...result,
    labels: {
      invoice: 'Счёт',
      upd: 'УПД',
      sf: 'СФ',
      workorder: 'Заказ-наряд',
      contract: 'Договор',
    },
  });
});

/** Каталог шаблонов договоров (БМП и др.). */
api.get('/contract-templates', (c) => {
  return c.json({ items: listContractTemplates() });
});

/** Превью бланка договора (без записи в БД). */
api.get('/contract-templates/:id/preview', (c) => {
  const id = c.req.param('id');
  if (id !== CONTRACT_TEMPLATE_ID) return c.html('<p>Шаблон не найден</p>', 404);
  const orgId = resolveOrganizationId(c.req.query('organization_id'));
  const org = getOrgProfile(orgId);
  const html = renderSaleContractHtml({
    number: '____',
    docDate: new Date().toISOString().slice(0, 10),
    org,
    buyer: {
      name: c.req.query('buyer_name') || '',
      inn: c.req.query('buyer_inn') || '',
    },
    city: 'Краснодар',
  });
  return c.html(html);
});

/** Создать договор (из сделки или бланк). */
api.post('/contracts', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав на документы' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    deal_id?: string;
    organization_id?: string;
    buyer_name?: string;
    buyer_inn?: string;
    buyer_address?: string;
    buyer_phone?: string;
    comment?: string;
  };
  try {
    const doc = createContractDoc({
      dealId: body.deal_id,
      organizationId: body.organization_id,
      buyerName: body.buyer_name,
      buyerInn: body.buyer_inn,
      buyerAddress: body.buyer_address,
      buyerPhone: body.buyer_phone,
      comment: body.comment,
      createdBy: actor?.login || actor?.name || '',
    });
    auditFromContext(c, {
      action: 'sales_doc.create',
      entity: 'sales_doc',
      entityId: String(doc?.id || ''),
      summary: `Договор ${doc?.number || ''}`,
      after: { id: doc?.id, number: doc?.number },
    });
    return c.json({ ok: true, doc });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

api.post('/company/ensure-client-orgs', (c) => {
  const actor = actorFromContext(c);
  if (actor?.role !== 'admin' && !canDo(actor, 'can_edit_docs')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const result = ensureClientOrgContours();
  return c.json({ ok: true, ...result, snapshot: listClientOrgSnapshot() });
});

api.get('/sales-docs/:id', (c) => {
  const id = c.req.param('id');
  let doc = getSalesDoc(id);
  if (!doc) return c.json({ error: 'not found' }, 404);
  if (String(doc.doc_type) === 'contract') {
    doc = fillContractBuyerFromDeal(id) || doc;
  }
  const dealId = String((doc as { deal_id?: string }).deal_id || '').trim();
  const garage = dealId ? garageForDeal(dealId) : { counterparty_id: '', vehicles: [] };
  return c.json({
    ...doc,
    buyer_counterparty_id: garage.counterparty_id,
    garage_vehicles: garage.vehicles,
  });
});

api.get('/sales-docs/:id/print', (c) => {
  const id = c.req.param('id');
  const preview = getSalesDoc(id);
  if (preview && String(preview.doc_type) === 'contract') {
    fillContractBuyerFromDeal(id);
  }
  const facsimile = parseOrgFacsimileFlags({
    stamps: c.req.query('stamps'),
    seal: c.req.query('seal'),
    facsimile: c.req.query('facsimile'),
    signs: c.req.query('signs'),
    sign: c.req.query('sign'),
  });
  let html = runWithOrgFacsimile(facsimile, () => renderSalesDocPrintHtml(id));
  if (!html) return c.html('<p>Документ не найден</p>', 404);
  const autoprint =
    c.req.query('autoprint') === '1' || c.req.query('autoprint') === 'true';
  if (autoprint) {
    html = html.replace(
      '</body>',
      `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},200)});</script></body>`
    );
    if (!html.includes('window.print()')) {
      html += `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},200)});</script>`;
    }
  }
  return c.html(html);
});

/** QR оплаты по ГОСТ ST00012 (PNG) для счёта. */
api.get('/sales-docs/:id/payment-qr.png', async (c) => {
  const doc = getSalesDoc(c.req.param('id'));
  if (!doc) return c.json({ error: 'not found' }, 404);
  if (String(doc.doc_type) !== 'invoice') {
    return c.json({ error: 'QR оплаты только для счёта' }, 400);
  }
  const org = doc.org;
  if (!org?.rs || !org?.bik) {
    return c.json({ error: 'У юрлица не заполнены р/с или БИК' }, 400);
  }
  const purpose = buildInvoicePaymentPurpose({
    number: String(doc.number || ''),
    docDate: String(doc.doc_date || ''),
    amountNoVat: Number(doc.amount) || 0,
    vatAmount: Number(doc.vat_amount) || 0,
    vatRate: Number(doc.vat_rate) || 0,
    total: Number(doc.total) || 0,
  });
  try {
    const png = await renderPaymentQrPng(org, {
      sum: Number(doc.total) || 0,
      purpose,
      scale: 4,
    });
    c.header('Content-Type', 'image/png');
    c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(png));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'qr failed' }, 500);
  }
});

/** Настоящий PDF: ?download=1, ?stamps=0, ?signs=0 — без печати / без подписи. */
api.get('/sales-docs/:id/pdf', async (c) => {
  try {
    const docId = c.req.param('id');
    const docRow = getSalesDoc(docId);
    if (!docRow) return c.json({ error: 'not found' }, 404);
    if (
      String(docRow.doc_type || '') === 'workorder' &&
      !String(docRow.car_plate || '').trim()
    ) {
      return c.json(
        { error: 'Сначала укажите гос. номер автомобиля на заказ-наряде — затем можно скачать PDF' },
        400
      );
    }
    const facsimile = parseOrgFacsimileFlags({
      stamps: c.req.query('stamps'),
      seal: c.req.query('seal'),
      facsimile: c.req.query('facsimile'),
      signs: c.req.query('signs'),
      sign: c.req.query('sign'),
    });
    const result = await renderSalesDocPdf(docId, { facsimile });
    if (!result) return c.json({ error: 'not found' }, 404);
    const download = c.req.query('download') === '1' || c.req.query('download') === 'true';
    const asciiName = result.filename.replace(/[^\x20-\x7E]+/g, '_');
    c.header('Content-Type', 'application/pdf');
    c.header(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`
    );
    c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(result.buffer));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'pdf failed' }, 500);
  }
});

api.post('/sales-docs/from-deal', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав на документы' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    deal_id?: string;
    doc_type?: string;
    vat_rate?: number;
    buyer_name?: string;
    buyer_inn?: string;
    comment?: string;
    organization_id?: string;
  };
  const dealId = String(body.deal_id || '').trim();
  const docType = String(body.doc_type || '').trim() as SalesDocType;
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  if (!['invoice', 'upd', 'sf', 'workorder', 'contract'].includes(docType)) {
    return c.json({ error: 'doc_type: invoice | upd | sf | workorder | contract' }, 400);
  }
  try {
    const doc =
      docType === 'contract'
        ? createContractDoc({
            dealId,
            organizationId: body.organization_id,
            buyerName: body.buyer_name,
            buyerInn: body.buyer_inn,
            comment: body.comment,
            createdBy: actor?.login || actor?.name || '',
          })
        : createSalesDocFromDeal({
            dealId,
            docType,
            vatRate: body.vat_rate,
            buyerName: body.buyer_name,
            buyerInn: body.buyer_inn,
            comment: body.comment,
            createdBy: actor?.login || actor?.name || '',
            organizationId: body.organization_id,
          });
    auditFromContext(c, {
      action: 'sales_doc.create',
      entity: 'sales_doc',
      entityId: String(doc?.id || ''),
      summary: `${salesDocTypeLabel(docType)} из заказа ${dealId}`,
      after: { id: doc?.id, number: doc?.number, total: doc?.total },
    });
    return c.json({ ok: true, doc });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

/**
 * Пакет документов из заказа.
 * Если types не переданы — по признаку СТО / юрлицо:
 * СТО физлицо → ЗН; СТО юрлицо → счёт+ЗН+УПД; продажа юрлицо → счёт+УПД; продажа физлицо → счёт.
 */
api.post('/sales-docs/pack-from-deal', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав на документы' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    deal_id?: string;
    types?: string[];
    vat_rate?: number;
    buyer_name?: string;
    buyer_inn?: string;
    organization_id?: string;
  };
  const dealId = String(body.deal_id || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  const deal = getDeal(dealId);
  if (!deal) return c.json({ error: 'Сделка не найдена' }, 404);
  const allowed = new Set(['invoice', 'upd', 'sf', 'workorder']);
  const types = (body.types || [])
    .map((t) => String(t).trim())
    .filter((t): t is SalesDocType => allowed.has(t));
  const resolvedTypes = types.length
    ? types
    : (dealSalesDocPackTypes(deal as Record<string, unknown>) as SalesDocType[]);
  try {
    const docs = createSalesDocPackFromDeal({
      dealId,
      types: resolvedTypes,
      vatRate: body.vat_rate,
      buyerName: body.buyer_name,
      buyerInn: body.buyer_inn,
      createdBy: actor?.login || actor?.name || '',
      organizationId: body.organization_id,
    });
    for (const doc of docs) {
      if (!doc) continue;
      auditFromContext(c, {
        action: 'sales_doc.create',
        entity: 'sales_doc',
        entityId: String(doc.id || ''),
        summary: `${salesDocTypeLabel(doc.doc_type as SalesDocType)} из заказа ${dealId} (пакет)`,
        after: { id: doc.id, number: doc.number, total: doc.total },
      });
    }
    return c.json({
      ok: true,
      docs: docs.filter(Boolean),
      types: resolvedTypes,
      is_sto: Number((deal as { is_sto?: number }).is_sto) === 1 ? 1 : 0,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create pack failed' }, 400);
  }
});

/** Признак СТО на заказе покупателя (какие документы печатать). */
api.patch('/crm/deals/:id/sto', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { is_sto?: boolean | number | string };
  const raw = body.is_sto;
  const isSto =
    raw === true || raw === 1 || raw === '1' || String(raw).toLowerCase() === 'true';
  try {
    setDealIsSto(c.req.param('id'), isSto);
    const deal = getDeal(c.req.param('id'));
    auditFromContext(c, {
      action: 'crm.deal_set_sto',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: isSto ? 'Заказ помечен как СТО' : 'Заказ помечен как продажа (не СТО)',
      after: { is_sto: isSto ? 1 : 0 },
    });
    return c.json({ ok: true, deal });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Контур (организация) на заказе — только до выписки счёта. */
api.patch('/crm/deals/:id/org-company', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { org_company_id?: string };
  try {
    const dealId = c.req.param('id');
    setDealOrgCompany(dealId, String(body.org_company_id || ''));
    const deal = getDeal(dealId);
    auditFromContext(c, {
      action: 'crm.deal_org_company',
      entity: 'crm_deal',
      entityId: dealId,
      summary: `Организация заказа: ${body.org_company_id || '—'}`,
      after: { org_company_id: body.org_company_id || '' },
    });
    return c.json({ ok: true, deal });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Автомобиль на заказе (для заказ-наряда: гос. номер, VIN, СТС…). */
api.patch('/crm/deals/:id/vehicle', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    setDealVehicle(c.req.param('id'), body);
    const deal = getDeal(c.req.param('id'));
    auditFromContext(c, {
      action: 'crm.deal_vehicle',
      entity: 'crm_deal',
      entityId: c.req.param('id'),
      summary: `Авто: ${body.car_plate || '—'} / VIN ${body.car_vin || '—'}`,
      after: {
        car_plate: body.car_plate,
        car_vin: body.car_vin,
        car_year: body.car_year,
        car_mileage: body.car_mileage,
        car_brand: body.car_brand,
        car_model: body.car_model,
      },
    });
    return c.json({ ok: true, deal });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Фото СТС (лицевая / оборот) — просмотр сохранённого файла. */
api.get('/crm/deals/:id/vehicle/sts/:side', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const dealId = c.req.param('id');
  const sideRaw = String(c.req.param('side') || '').toLowerCase();
  const side: StsSide | null =
    sideRaw === 'front' || sideRaw === 'back' ? sideRaw : null;
  if (!side) return c.json({ error: 'side = front|back' }, 400);
  if (!getDeal(dealId)) return c.json({ error: 'Заказ покупателя не найден' }, 404);
  const file = await readStsImageNormalized(dealId, side);
  if (!file) return c.json({ error: 'Фото не найдено' }, 404);
  return new Response(new Uint8Array(file.buf), {
    headers: {
      'Content-Type': file.mime,
      'Cache-Control': 'private, max-age=120',
    },
  });
});

/**
 * Загрузить фото СТС (1–2 шт.) — сторона определяется автоматически (OCR) или по порядку.
 * Опционально распознать поля и сохранить на сделку.
 */
api.post('/crm/deals/:id/vehicle/ocr', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const dealId = c.req.param('id');
  const deal = getDeal(dealId);
  if (!deal) return c.json({ error: 'Заказ покупателя не найден' }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    images?: Array<{ mime?: string; data_base64?: string }>;
    apply?: boolean;
    /** false = только сохранить фото без OCR полей */
    recognize?: boolean;
    /** true = взять уже сохранённые front/back с диска (без новых файлов) */
    from_saved?: boolean;
  };
  const images = (body.images || [])
    .map((img) => ({
      mime: img.mime,
      data_base64: String(img.data_base64 || ''),
    }))
    .filter((img) => img.data_base64);
  try {
    let buffers: Array<{ mime: string; buf: Buffer }> = [];
    let vehicle = {
      car_plate: '',
      car_vin: '',
      car_brand: '',
      car_model: '',
      car_year: '',
      car_color: '',
      car_category: '',
      car_pts: '',
      car_owner: '',
      car_owner_street: '',
      car_owner_house: '',
      car_owner_flat: '',
      car_sts_date: '',
      car_sts_number: '',
    };
    let model = '';
    let labels: Array<'front' | 'back' | 'unknown'> = [];
    const wantRecognize = body.recognize !== false;
    let warn = '';
    let fromSaved = false;

    if (images.length) {
      buffers = decodeStsImages(images);
      // iPhone HEIC → JPEG до OCR и сохранения (иначе превью в браузере пустое)
      buffers = await Promise.all(
        buffers.map(async (b) => {
          const n = await ensureStsJpeg(b.buf, b.mime);
          return { mime: n.mime, buf: n.buf };
        })
      );
      labels = buffers.map(() => 'unknown' as const);
    } else {
      // повторное распознавание по уже загруженным лицевая/оборот
      fromSaved = true;
      for (const side of ['front', 'back'] as const) {
        const img = await readStsImageNormalized(dealId, side);
        if (!img) continue;
        buffers.push(img);
        labels.push(side);
      }
      if (!buffers.length) {
        throw new Error('Прикрепите фото СТС (1–2 снимка) или сначала загрузите лицевую/оборот');
      }
    }

    let recognized = false;
    if (wantRecognize) {
      if (!deepseekConfigured()) {
        warn =
          'Фото на месте, но ключ не задан: Настройки → DeepSeek / СТС (OpenRouter + deepseek/deepseek-vl2).';
      } else if (!deepseekVisionEndpointOk()) {
        warn = deepseekVisionHint();
      } else {
        try {
          const jpegImages = buffers.map((b) => ({
            mime: b.mime,
            data_base64: b.buf.toString('base64'),
          }));
          const result = await recognizeStsFromImages(jpegImages);
          buffers = result.buffers;
          vehicle = result.vehicle;
          model = result.model;
          if (!fromSaved) labels = result.image_sides;
          recognized = Object.values(vehicle).some((v) => Boolean(v));
          if (!recognized) {
            warn = 'Vision ответил, но поля СТС пустые — переснимите ближе / без бликов или проверьте модель.';
          }
        } catch (e) {
          warn = e instanceof Error ? e.message : String(e);
        }
      }
    }

    const sides = fromSaved
      ? (labels.map((l) => (l === 'front' || l === 'back' ? l : null)) as Array<StsSide | null>)
      : assignStsSides(labels, buffers.length);
    const savedSides: Array<{ side: StsSide; size: number }> = [];
    // новые файлы — сохраняем; from_saved — на диске уже лежат
    if (!fromSaved) {
      for (let i = 0; i < buffers.length; i++) {
        const side = sides[i];
        if (!side) continue;
        const saved = await saveStsImage(dealId, side, buffers[i].buf, buffers[i].mime);
        savedSides.push({ side: saved.side, size: saved.size });
      }
    } else {
      for (let i = 0; i < buffers.length; i++) {
        const side = sides[i];
        if (!side) continue;
        savedSides.push({ side, size: buffers[i].buf.length });
      }
    }

    let saved = false;
    const hasFields = Object.values(vehicle).some((v) => v);
    if (body.apply !== false && hasFields) {
      const cur = deal as Record<string, unknown>;
      // OCR + scrub: пустой OCR не сохраняет старый мусор (KYA / Moscow / Touring)
      const merged = {
        ...mergeStsVehicleOcr(cur, vehicle),
        car_mileage: String(cur.car_mileage || ''),
      };
      setDealVehicle(dealId, merged);
      vehicle = sanitizeStsVehicle(merged);
      saved = true;
    }

    const photos = stsMediaInfo(dealId);

    auditFromContext(c, {
      action: 'crm.deal_vehicle_ocr',
      entity: 'crm_deal',
      entityId: dealId,
      summary: `СТС: ${vehicle.car_plate || (recognized ? 'OCR' : 'фото')} · ${savedSides.map((s) => s.side).join('+') || '—'}${warn ? ' · warn' : ''}`,
      after: { ...vehicle, model, saved, recognized, fromSaved, warn, sides: savedSides, photos },
    });

    // если просили распознать, а полей нет — явная ошибка (фото при новых upload уже сохранены)
    if (wantRecognize && !hasFields) {
      return c.json(
        {
          ok: false,
          error: warn || 'Не удалось распознать СТС',
          vehicle,
          model,
          saved,
          recognized: false,
          sides: savedSides,
          photos,
          warn,
          deal: getDeal(dealId),
        },
        422
      );
    }

    return c.json({
      ok: true,
      vehicle,
      model,
      saved,
      recognized,
      sides: savedSides,
      photos,
      warn,
      deal: getDeal(dealId),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Наименование покупателя (ЗН/счёт/УПД…) → документы сделки + контрагент + AmoCRM name. */
api.patch('/sales-docs/:id/counterparty-name', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  try {
    const id = c.req.param('id');
    const renamed = renameSalesDocBuyerName(id, String(body.name || ''));
    // если карточки ещё не было (физлицо) — создать и переименовать
    if (!renamed.counterparty_id && renamed.deal_id) {
      const deal = getDeal(renamed.deal_id);
      const cpId = ensureCounterpartyForDeal(deal as Record<string, unknown> | null);
      if (cpId) {
        run(`UPDATE counterparties SET name = ? WHERE id = ?`, [renamed.name, cpId]);
        renamed.counterparty_id = cpId;
      }
    }
    let amo: Awaited<ReturnType<typeof pushContractBuyerToAmoContact>> | null = null;
    if (renamed.deal_id) {
      amo = await pushContractBuyerToAmoContact({
        dealId: renamed.deal_id,
        buyer: { name: renamed.name },
        forceName: true,
      });
    }
    if (renamed.counterparty_id) {
      await pushCounterpartyToAmo({
        counterpartyId: renamed.counterparty_id,
        buyer: { name: renamed.name },
        forceName: true,
      });
    }
    const doc = getSalesDoc(id);
    auditFromContext(c, {
      action: 'sales.doc_counterparty_name',
      entity: 'sales_doc',
      entityId: id,
      summary: `Покупатель: ${renamed.name} · docs ${renamed.docs_updated}${
        amo && amo.ok === false
          ? ' · Amo: ' + amo.error
          : amo && amo.ok && amo.filled?.includes('name')
            ? ' · Amo name'
            : amo && amo.ok
              ? ' · Amo ok'
              : ''
      }`,
      after: { ...renamed, amo },
    });
    return c.json({ ok: true, doc, ...renamed, amo });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Реквизиты покупателя в договоре (в лице, ИНН, КПП, банк…). */
api.patch('/sales-docs/:id/buyer', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    inn?: string;
    kpp?: string;
    ogrn?: string;
    address?: string;
    phone?: string;
    email?: string;
    director?: string;
    bank?: string;
    bik?: string;
    rs?: string;
    ks?: string;
  };
  try {
    const id = c.req.param('id');
    updateSalesDocBuyer(id, body);
    const doc = getSalesDoc(id);
    const dealId = String(doc?.deal_id || '').trim();
    let amo: Awaited<ReturnType<typeof pushContractBuyerToAmoContact>> | null = null;
    if (dealId) {
      amo = await pushContractBuyerToAmoContact({
        dealId,
        buyer: {
          name: body.name,
          inn: body.inn,
          kpp: body.kpp,
          ogrn: body.ogrn,
          address: body.address,
          phone: body.phone,
          email: body.email,
          director: body.director,
          bank: body.bank,
          bik: body.bik,
          rs: body.rs,
          ks: body.ks,
        },
      });
    }
    auditFromContext(c, {
      action: 'sales.doc_buyer',
      entity: 'sales_doc',
      entityId: id,
      summary: `Покупатель договора: ${body.name || doc?.counterparty_name || '—'}${
        amo && amo.ok === false
          ? ' · Amo: ' + amo.error
          : amo && amo.ok
            ? ' · Amo контакт ' +
              (amo.contact_id || '') +
              (amo.filled?.length ? ' +' + amo.filled.join(',') : '')
            : ''
      }`,
      after: { ...body, amo },
    });
    return c.json({ ok: true, doc, amo });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Автомобиль в заказ-наряде (правка перед печатью). */
api.patch('/sales-docs/:id/vehicle', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const scrubbed = sanitizeStsVehicle({
      car_plate: String(body.car_plate || ''),
      car_vin: String(body.car_vin || ''),
      car_brand: String(body.car_brand || ''),
      car_model: String(body.car_model || ''),
      car_year: String(body.car_year || ''),
      car_color: String(body.car_color || ''),
      car_category: String(body.car_category || ''),
      car_pts: String(body.car_pts || ''),
      car_owner: String(body.car_owner || ''),
      car_owner_street: String(body.car_owner_street || ''),
      car_owner_house: String(body.car_owner_house || ''),
      car_owner_flat: String(body.car_owner_flat || ''),
      car_sts_date: String(body.car_sts_date || ''),
      car_sts_number: String(body.car_sts_number || ''),
    });
    const docId = c.req.param('id');
    updateSalesDocVehicle(docId, {
      ...body,
      ...scrubbed,
      car_mileage: String(body.car_mileage || ''),
    });
    let garageVehicle = null as ReturnType<typeof upsertCounterpartyVehicle> | null;
    const saveGarage = body.save_garage !== false;
    if (saveGarage && (scrubbed.car_plate || scrubbed.car_vin)) {
      const docRow = getSalesDoc(docId);
      const dealId = String(docRow?.deal_id || '').trim();
      const deal = dealId ? getDeal(dealId) : null;
      const cpId = ensureCounterpartyForDeal(deal as Record<string, unknown> | null);
      if (cpId) {
        garageVehicle = upsertCounterpartyVehicle(cpId, {
          id: String(body.garage_vehicle_id || ''),
          ...scrubbed,
        });
      }
    }
    const doc = getSalesDoc(docId);
    const garage = doc?.deal_id
      ? garageForDeal(String(doc.deal_id), { ensure: true })
      : { counterparty_id: '', vehicles: [] };
    auditFromContext(c, {
      action: 'sales.doc_vehicle',
      entity: 'sales_doc',
      entityId: docId,
      summary: `Авто ЗН: ${scrubbed.car_plate || '—'} / VIN ${scrubbed.car_vin || '—'}`,
      after: { ...scrubbed, car_mileage: body.car_mileage, garage_vehicle_id: garageVehicle?.id },
    });
    return c.json({
      ok: true,
      doc: {
        ...doc,
        buyer_counterparty_id: garage.counterparty_id,
        garage_vehicles: garage.vehicles,
      },
      garage_vehicle: garageVehicle,
      garage_vehicles: garage.vehicles,
      buyer_counterparty_id: garage.counterparty_id,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Гараж авто контрагента */
api.get('/counterparties/:id/vehicles', (c) => {
  const id = c.req.param('id');
  if (!get('SELECT id FROM counterparties WHERE id = ?', [id])) {
    return c.json({ error: 'Контрагент не найден' }, 404);
  }
  return c.json({ items: listCounterpartyVehicles(id) });
});

api.post('/counterparties/:id/vehicles', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const scrubbed = sanitizeStsVehicle({
      car_plate: String(body.car_plate || ''),
      car_vin: String(body.car_vin || ''),
      car_brand: String(body.car_brand || ''),
      car_model: String(body.car_model || ''),
      car_year: String(body.car_year || ''),
      car_color: String(body.car_color || ''),
      car_category: String(body.car_category || ''),
      car_pts: String(body.car_pts || ''),
      car_owner: String(body.car_owner || ''),
      car_owner_street: String(body.car_owner_street || ''),
      car_owner_house: String(body.car_owner_house || ''),
      car_owner_flat: String(body.car_owner_flat || ''),
      car_sts_date: String(body.car_sts_date || ''),
      car_sts_number: String(body.car_sts_number || ''),
    });
    const item = upsertCounterpartyVehicle(c.req.param('id'), {
      id: String(body.id || ''),
      ...scrubbed,
    });
    auditFromContext(c, {
      action: 'counterparty.vehicle_upsert',
      entity: 'counterparty',
      entityId: c.req.param('id'),
      summary: `Авто контрагента: ${item.car_plate || item.car_vin || item.id}`,
      after: item,
    });
    return c.json({ ok: true, item, items: listCounterpartyVehicles(c.req.param('id')) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.delete('/counterparties/:id/vehicles/:vehicleId', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    deleteCounterpartyVehicle(c.req.param('id'), c.req.param('vehicleId'));
    auditFromContext(c, {
      action: 'counterparty.vehicle_delete',
      entity: 'counterparty',
      entityId: c.req.param('id'),
      summary: `Удалено авто ${c.req.param('vehicleId')}`,
    });
    return c.json({ ok: true, items: listCounterpartyVehicles(c.req.param('id')) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/crm/deals/:id/garage', (c) => {
  const dealId = c.req.param('id');
  if (!getDeal(dealId)) return c.json({ error: 'Заказ покупателя не найден' }, 404);
  return c.json(garageForDeal(dealId));
});

/** УПД (товары+услуги) + проведённая расходная (только товары → склад). */
api.post('/sales-docs/upd-and-writeoff-from-deal', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав на документы' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    deal_id?: string;
    vat_rate?: number;
    buyer_name?: string;
    buyer_inn?: string;
    organization_id?: string;
    warehouse_id?: string;
  };
  const dealId = String(body.deal_id || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  try {
    const result = createUpdAndWriteOffFromDeal({
      dealId,
      vatRate: body.vat_rate,
      buyerName: body.buyer_name,
      buyerInn: body.buyer_inn,
      createdBy: actor?.login || actor?.name || '',
      organizationId: body.organization_id,
      preferredWarehouseId: body.warehouse_id,
    });
    auditFromContext(c, {
      action: 'sales_doc.create',
      entity: 'sales_doc',
      entityId: String(result.upd?.id || ''),
      summary: `УПД + списание из заказа ${dealId}`,
      after: {
        upd_id: result.upd?.id,
        upd_number: result.upd?.number,
        stock_doc_id: result.stock_doc_id,
        stock_doc_number: result.stock_doc_number,
      },
    });
    if (result.stock_doc_id) {
      auditFromContext(c, {
        action: 'doc.create',
        entity: 'stock_doc',
        entityId: result.stock_doc_id,
        summary: `Расходная ${result.stock_doc_number || ''} · списание по заказу ${dealId}`,
      });
    }
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'upd+writeoff failed' }, 400);
  }
});

api.post('/sync/docs', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { kinds?: Array<'in' | 'out'> };
  const kinds = body.kinds?.length ? body.kinds : (['in', 'out'] as Array<'in' | 'out'>);
  try {
    const result = await withCatalogSyncLock('docs', () => syncDocsFromOdata(kinds));
    let order_chain_odata = null as Awaited<ReturnType<typeof probeOrderChainOdata>> | null;
    try {
      order_chain_odata = await probeOrderChainOdata();
    } catch {
      order_chain_odata = null;
    }
    auditFromContext(c, {
      action: 'sync.docs',
      entity: 'stock_doc',
      summary: `Документы 1С: приход ${result.inHeaders}/${result.inLines} стр., расход ${result.outHeaders}/${result.outLines} стр.`,
      after: { ...result, order_chain_odata },
    });
    return c.json({ ok: true, ...result, order_chain_odata, meta: docsSyncMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'docs sync failed' }, 500);
  }
});

api.get('/sync/docs/order-chain', async (c) => {
  try {
    return c.json(await probeOrderChainOdata());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'probe failed' }, 500);
  }
});

api.post('/sync/odata', async (c) => {
  const cfg = odataConfigFromEnv();
  if (!cfg) {
    return c.json({ error: 'OData не настроен (ODATA_BASE_URL / USER / PASSWORD)' }, 500);
  }
  try {
    const result = await withCatalogSyncLock('odata', async () => {
      const odata = await syncCatalogsFromOdata(cfg);
      let organizations = 0;
      try {
        organizations = await syncOrganizationsFromOdata(cfg);
      } catch (e) {
        console.warn('[sync] organizations', e);
      }
      let hs = null as Awaited<ReturnType<typeof syncApplicabilityAndProperties>> | null;
      let hsError: string | null = null;
      if (hsConfigured()) {
        try {
          hs = await syncApplicabilityAndProperties();
        } catch (e) {
          hsError = e instanceof Error ? e.message : 'hs sync failed';
        }
      }
      return { odata: { ...odata, organizations }, hs, hsError };
    });
    auditFromContext(c, {
      action: 'sync.odata',
      entity: 'sync',
      summary: `OData: складов ${result.odata.warehouses}, категорий ${result.odata.categories}, товаров ${result.odata.products}, орг ${result.odata.organizations}`,
      after: result.odata,
    });
    return c.json({
      ok: true,
      ...result.odata,
      hs: result.hs,
      hsError: result.hsError,
      counts: catalogCounts(),
      hsMeta: hsSyncMeta(),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'sync failed' }, 500);
  }
});

api.post('/sync/hs', async (c) => {
  if (!hsConfigured()) {
    return c.json({ error: 'HS не настроен (HS_BASE_URL / HS_USER / HS_PASS)' }, 500);
  }
  try {
    const result = await withCatalogSyncLock('hs', () => syncApplicabilityAndProperties());
    auditFromContext(c, {
      action: 'sync.hs',
      entity: 'sync',
      summary: `HS полный: товаров ${result.productsUpserted}, цен ${result.prices}, остатков ${result.restRows}`,
      after: result,
    });
    return c.json({ ok: true, ...result, hsMeta: hsSyncMeta(), dicts: dictMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'hs sync failed' }, 500);
  }
});

api.post('/sync/prices', async (c) => {
  if (!hsConfigured()) {
    return c.json({ error: 'HS не настроен (HS_BASE_URL / HS_USER / HS_PASS)' }, 500);
  }
  try {
    const result = await withCatalogSyncLock('prices', () => syncPricesOnly());
    auditFromContext(c, {
      action: 'sync.prices',
      entity: 'price',
      summary: `Синк цен из 1С: ${result.prices} строк`,
      after: result,
    });
    return c.json({ ok: true, ...result, hsMeta: hsSyncMeta(), dicts: dictMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'prices sync failed' }, 500);
  }
});

api.post('/sync/rests', async (c) => {
  if (!hsConfigured()) {
    return c.json({ error: 'HS не настроен (HS_BASE_URL / HS_USER / HS_PASS)' }, 500);
  }
  try {
    const result = await withCatalogSyncLock('rests', () => syncRestsOnly());
    auditFromContext(c, {
      action: 'sync.rests',
      entity: 'stock',
      summary: `Синк остатков из 1С: ${result.restRows} строк`,
      after: result,
    });
    return c.json({ ok: true, ...result, hsMeta: hsSyncMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'rests sync failed' }, 500);
  }
});

api.get('/employees', (c) => c.json(all('SELECT * FROM employees ORDER BY name')));

api.get('/staff', (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor) && !canAccessSection(actor, 'staff')) {
    return c.json({ error: 'Недостаточно прав: персонал' }, 403);
  }
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const role = (c.req.query('role') || '').trim();
  let rows = all<Record<string, unknown>>(`SELECT * FROM staff`);
  rows.sort((a, b) => {
    const ra = roleSortRank(String(a.role || ''));
    const rb = roleSortRank(String(b.role || ''));
    if (ra !== rb) return ra - rb;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
  });
  if (role) rows = rows.filter((r) => String(r.role) === role);
  if (q) {
    rows = rows.filter((r) => {
      const hay = [r.name, r.email, r.amo_id, r.one_c_name, r.one_c_code, r.auth_login, r.department, r.login]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }
  ensureCompaniesSchema();
  return c.json({
    items: rows.map(publicStaffRow),
    meta: staffMeta(),
    roles: STAFF_ROLES,
    role_catalog: rolesCatalog(),
    sections: STAFF_SECTIONS,
    departments: listDepartments(),
    companies: listCompanies({ activeOnly: true }).map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
    })),
  });
});

api.get('/staff/roles', (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor) && !canAccessSection(actor, 'staff')) {
    return c.json({ error: 'Недостаточно прав: персонал' }, 403);
  }
  return c.json({ roles: STAFF_ROLES, role_catalog: rolesCatalog(), sections: STAFF_SECTIONS });
});

/** Матрица доступов: сотрудники × разделы. */
api.get('/staff/access-matrix', (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor) && !canAccessSection(actor, 'staff')) {
    return c.json({ error: 'Недостаточно прав: персонал' }, 403);
  }
  return c.json(accessMatrixSnapshot());
});

/** Галочка в матрице: открыть / закрыть раздел сотруднику. */
api.patch('/staff/access-matrix', async (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor)) {
    return c.json({ error: 'Только администратор может менять матрицу доступов' }, 403);
  }
  const body = await c.req.json<{
    staff_id?: string;
    section?: string;
    allowed?: boolean;
  }>();
  const staffId = String(body.staff_id || '').trim();
  const section = String(body.section || '').trim();
  if (!staffId || !section) {
    return c.json({ error: 'Нужны staff_id и section' }, 400);
  }
  try {
    const row = setStaffSectionAccess(staffId, section, body.allowed !== false);
    auditFromContext(c, {
      action: 'staff.access_matrix',
      entity: 'staff',
      entityId: staffId,
      summary: `${body.allowed !== false ? 'Открыт' : 'Закрыт'} раздел «${section}»: ${row.name}`,
      after: { section, allowed: body.allowed !== false, sections: row.sections },
    });
    return c.json({ ok: true, row });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/staff/departments', (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor) && !canAccessSection(actor, 'staff')) {
    return c.json({ error: 'Недостаточно прав: персонал' }, 403);
  }
  return c.json({
    items: listDepartments(),
    sections: STAFF_SECTIONS,
  });
});

api.post('/staff/departments', async (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor)) {
    return c.json({ error: 'Только администратор может менять отделы' }, 403);
  }
  const body = await c.req.json<{ name?: string; notes?: string }>();
  try {
    const row = upsertDepartment(String(body.name || ''), {
      overlay: emptyDeptOverlay(),
      notes: body.notes,
    });
    auditFromContext(c, {
      action: 'staff.dept.create',
      entity: 'staff_department',
      entityId: row.name,
      summary: `Отдел добавлен в справочник: ${row.name}`,
      after: row,
    });
    return c.json(row, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

api.put('/staff/departments/:name', async (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor)) {
    return c.json({ error: 'Только администратор может менять права отделов' }, 403);
  }
  const name = decodeURIComponent(c.req.param('name') || '');
  const body = await c.req.json<{
    overlay?: Partial<DeptRightsOverlay>;
    notes?: string;
    rename?: string;
  }>();
  try {
    const prevList = listDepartments();
    const prev = prevList.find((d) => d.name === normDepartmentName(name));
    if (!prev && !normDepartmentName(name)) {
      return c.json({ error: 'Укажите отдел' }, 400);
    }
    const baseName = normDepartmentName(name);
    const renameTo = body.rename !== undefined ? normDepartmentName(body.rename) : '';
    let target = baseName;

    if (renameTo && renameTo !== baseName) {
      // перенос overlay + массовое переименование у сотрудников
      const overlay = body.overlay
        ? parseDeptOverlay(JSON.stringify({ ...prev?.overlay, ...body.overlay }))
        : prev?.overlay || emptyDeptOverlay();
      const notes = body.notes !== undefined ? body.notes : prev?.notes || '';
      upsertDepartment(renameTo, { overlay, notes });
      run(`UPDATE staff SET department = ? WHERE trim(department) = ?`, [renameTo, baseName]);
      deleteDepartmentConfig(baseName);
      target = renameTo;
    } else {
      const overlay = body.overlay
        ? parseDeptOverlay(
            JSON.stringify({
              ...(prev?.overlay || emptyDeptOverlay()),
              ...body.overlay,
              grant: { ...(prev?.overlay?.grant || {}), ...(body.overlay.grant || {}) },
              revoke: { ...(prev?.overlay?.revoke || {}), ...(body.overlay.revoke || {}) },
            })
          )
        : prev?.overlay || emptyDeptOverlay();
      // если передали overlay целиком — использовать нормализованный из body
      const finalOverlay =
        body.overlay !== undefined
          ? parseDeptOverlay(JSON.stringify(body.overlay))
          : overlay;
      upsertDepartment(target, {
        overlay: finalOverlay,
        notes: body.notes,
      });
    }

    const after = listDepartments().find((d) => d.name === target)!;
    auditFromContext(c, {
      action: 'staff.dept.update',
      entity: 'staff_department',
      entityId: target,
      summary: `Права отдела: ${target}`,
      before: prev || null,
      after,
    });
    return c.json(after);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'update failed' }, 400);
  }
});

api.delete('/staff/departments/:name', (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor)) {
    return c.json({ error: 'Только администратор может удалять настройки отделов' }, 403);
  }
  const name = decodeURIComponent(c.req.param('name') || '');
  const before = listDepartments().find((d) => d.name === normDepartmentName(name));
  deleteDepartmentConfig(name);
  auditFromContext(c, {
    action: 'staff.dept.delete',
    entity: 'staff_department',
    entityId: normDepartmentName(name),
    summary: `Сброшены права отдела: ${normDepartmentName(name)}`,
    before: before || null,
  });
  return c.json({ ok: true, items: listDepartments() });
});

api.post('/staff', async (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor)) {
    return c.json({ error: 'Только администратор может добавлять сотрудников' }, 403);
  }
  const body = await c.req.json<{
    name?: string;
    email?: string;
    login?: string;
    role?: string;
    can_login?: boolean;
    password?: string;
    notes?: string;
    department?: string;
  }>();
  try {
    const row = createStaffManual({
      name: String(body.name || ''),
      email: body.email,
      login: body.login,
      role: body.role,
      can_login: body.can_login,
      notes: body.notes,
      department: body.department,
    });
    if (body.password) {
      setStaffPassword(String(row.id), String(body.password));
      row.has_password = true;
      row.password_hash = undefined;
    }
    const after = publicStaffRow(
      get<Record<string, unknown>>('SELECT * FROM staff WHERE id = ?', [String(row.id)])!
    );
    auditFromContext(c, {
      action: 'staff.create',
      entity: 'staff',
      entityId: String(after.id),
      summary: `Сотрудник добавлен: ${after.name} → ${after.role}`,
      after,
    });
    return c.json(after, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

api.post('/staff/sync', (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor)) {
    return c.json({ error: 'Только администратор может синхронизировать персонал' }, 403);
  }
  try {
    const result = syncStaffFromAmoAnd1c();
    auditFromContext(c, {
      action: 'staff.sync',
      entity: 'staff',
      summary: `Синк персонала: Amo ${result.amoUsers}, 1С ${result.hsEmployees}, записей ${result.upserted}`,
      after: result,
    });
    return c.json({ ok: true, ...result, meta: staffMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'staff sync failed' }, 500);
  }
});

api.patch('/staff/:id', async (c) => {
  const actor = actorFromContext(c);
  if (actor && !isAdminActor(actor)) {
    return c.json({ error: 'Только администратор может менять права' }, 403);
  }
  const id = c.req.param('id');
  const row = get<Record<string, unknown>>('SELECT * FROM staff WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'Не найдено' }, 404);
  const body = await c.req.json<{
    role?: string;
    can_login?: boolean | number;
    notes?: string;
    password?: string;
    pin?: string | null;
    login?: string;
    name?: string;
    email?: string;
    department?: string;
    rights?: {
      sections?: string[];
      can_sync?: boolean;
      can_edit_products?: boolean;
      can_edit_prices?: boolean;
      can_edit_docs?: boolean;
      company_ids?: string[];
    };
    apply_role_defaults?: boolean;
  }>();

  const before = publicStaffRow(row);

  let role = String(row.role || 'none');
  if (body.role !== undefined) {
    if (!STAFF_ROLES.includes(body.role as StaffRole)) {
      return c.json({ error: 'Неизвестная роль' }, 400);
    }
    role = body.role;
  }

  let rights = parseRights(String(row.rights_json || ''), role);
  const prevCompanyIds = [...(rights.company_ids || [])];
  if (body.apply_role_defaults || (body.role !== undefined && body.rights === undefined)) {
    rights = rightsForRole(role as StaffRole);
    rights.company_ids = prevCompanyIds;
  }
  if (body.rights) {
    if (Array.isArray(body.rights.sections)) {
      rights.sections = body.rights.sections.map(String).filter((s) =>
        (STAFF_SECTIONS as readonly string[]).includes(s)
      );
    }
    if (body.rights.can_sync !== undefined) rights.can_sync = Boolean(body.rights.can_sync);
    if (body.rights.can_edit_products !== undefined) {
      rights.can_edit_products = Boolean(body.rights.can_edit_products);
    }
    if (body.rights.can_edit_prices !== undefined) {
      rights.can_edit_prices = Boolean(body.rights.can_edit_prices);
    }
    if (body.rights.can_edit_docs !== undefined) {
      rights.can_edit_docs = Boolean(body.rights.can_edit_docs);
    }
    if (body.rights.company_ids !== undefined) {
      const allowedCos = new Set(listCompanies({ activeOnly: false }).map((c) => c.id));
      rights.company_ids = body.rights.company_ids
        .map((x) => String(x || '').trim())
        .filter((id) => allowedCos.has(id));
    }
  }
  if (role === 'admin') rights.company_ids = [];

  let canLogin = Number(row.can_login) ? 1 : 0;
  if (body.can_login !== undefined) canLogin = body.can_login ? 1 : 0;

  const notes = body.notes !== undefined ? String(body.notes).slice(0, 500) : String(row.notes || '');
  let login = String(row.login || '');
  if (body.login !== undefined) login = String(body.login).trim().slice(0, 80);
  let name = String(row.name || '');
  if (body.name !== undefined) {
    name = String(body.name).trim().slice(0, 200);
    if (!name) return c.json({ error: 'ФИО не может быть пустым' }, 400);
  }
  let email = String(row.email || '');
  if (body.email !== undefined) email = String(body.email).trim().toLowerCase().slice(0, 200);
  let department = String(row.department || '');
  if (body.department !== undefined) department = normDepartmentName(body.department);

  run(
    `UPDATE staff SET role = ?, rights_json = ?, can_login = ?, notes = ?, login = ?, name = ?, email = ?, department = ? WHERE id = ?`,
    [role, JSON.stringify(rights), canLogin, notes, login, name, email, department, id]
  );

  if (body.password) {
    try {
      setStaffPassword(id, body.password);
      auditFromContext(c, {
        action: 'auth.password_set',
        entity: 'staff',
        entityId: id,
        summary: `Пароль задан админом: ${name}`,
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'password error' }, 400);
    }
  }

  if (body.pin !== undefined) {
    try {
      if (body.pin === null || String(body.pin).trim() === '') {
        clearStaffPin(id);
        auditFromContext(c, {
          action: 'auth.pin_clear',
          entity: 'staff',
          entityId: id,
          summary: `PIN смены сброшен: ${name}`,
        });
      } else {
        setStaffPin(id, String(body.pin));
        auditFromContext(c, {
          action: 'auth.pin_set',
          entity: 'staff',
          entityId: id,
          summary: `PIN смены задан админом: ${name}`,
        });
      }
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'pin error' }, 400);
    }
  }

  const after = publicStaffRow(get<Record<string, unknown>>('SELECT * FROM staff WHERE id = ?', [id])!);
  auditFromContext(c, {
    action: 'staff.update',
    entity: 'staff',
    entityId: id,
    summary: `Права/роль: ${after.name} → ${after.role}, вход=${after.can_login ? 'да' : 'нет'}`,
    before,
    after,
  });
  return c.json(after);
});

api.post('/sync/dicts', (c) => {
  try {
    const result = rebuildDictionaries();
    return c.json({ ok: true, ...result, dicts: dictMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'dicts rebuild failed' }, 500);
  }
});

api.get('/dicts/properties', (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q) {
    const like = `%${q}%`;
    return c.json(
      all(
        `SELECT * FROM dict_properties WHERE name LIKE ? ORDER BY name`,
        [like]
      )
    );
  }
  return c.json(all('SELECT * FROM dict_properties ORDER BY name'));
});

api.get('/dicts/properties/:id/values', (c) => {
  const id = c.req.param('id');
  return c.json(
    all(
      `SELECT * FROM dict_property_values WHERE property_id = ? ORDER BY value`,
      [id]
    )
  );
});

api.get('/dicts/marks', (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q) {
    return c.json(
      all(`SELECT * FROM dict_marks WHERE name LIKE ? ORDER BY name`, [`%${q}%`])
    );
  }
  return c.json(all('SELECT * FROM dict_marks ORDER BY name'));
});

api.get('/dicts/marks/:id/models', (c) => {
  const id = c.req.param('id');
  return c.json(
    all(`SELECT * FROM dict_models WHERE mark_id = ? ORDER BY name`, [id])
  );
});

/** Поколения из применимости (каскад после марки/модели). */
api.get('/dicts/applicability/generations', (c) => {
  const mark = (c.req.query('mark') || '').trim();
  const model = (c.req.query('model') || '').trim();
  if (!mark) return c.json([]);
  const where = [`IFNULL(generation,'') != ''`, 'mark = ?'];
  const params: string[] = [mark];
  if (model) {
    where.push('(model = ? OR only_model = ?)');
    params.push(model, model);
  }
  return c.json(
    all<{ name: string; products_count: number }>(
      `SELECT generation AS name, COUNT(DISTINCT product_id) AS products_count
       FROM product_applicability
       WHERE ${where.join(' AND ')}
       GROUP BY generation
       ORDER BY generation`,
      params
    )
  );
});

api.get('/dicts/brands', (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q) {
    return c.json(
      all(`SELECT * FROM dict_brands WHERE name LIKE ? ORDER BY name`, [`%${q}%`])
    );
  }
  return c.json(all('SELECT * FROM dict_brands ORDER BY name'));
});

api.get('/dicts/generations', (c) =>
  c.json(all('SELECT * FROM dict_generations ORDER BY name'))
);

api.get('/dicts/price-types', (c) => {
  const q = (c.req.query('q') || '').trim();
  if (q) {
    return c.json(
      all(`SELECT * FROM dict_price_types WHERE name LIKE ? ORDER BY name`, [`%${q}%`])
    );
  }
  return c.json(all('SELECT * FROM dict_price_types ORDER BY name'));
});

api.post('/dicts/price-types', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  const exists = get('SELECT id FROM dict_price_types WHERE name = ?', [name]);
  if (exists) return c.json({ error: 'Такой тип цены уже есть' }, 409);
  const id = newGuid();
  run('INSERT INTO dict_price_types (id, name, products_count) VALUES (?, ?, 0)', [id, name]);
  auditFromContext(c, {
    action: 'price_type.create',
    entity: 'price_type',
    entityId: id,
    summary: `Тип цены добавлен: ${name}`,
  });
  return c.json({ id, name, products_count: 0 }, 201);
});

api.patch('/dicts/price-types/:id', async (c) => {
  const id = c.req.param('id');
  const row = get<{ id: string; name: string }>('SELECT * FROM dict_price_types WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'name required' }, 400);
  if (name === row.name) return c.json(row);
  const clash = get('SELECT id FROM dict_price_types WHERE name = ? AND id != ?', [name, id]);
  if (clash) return c.json({ error: 'Такой тип цены уже есть' }, 409);
  run('BEGIN');
  try {
    run('UPDATE product_prices SET price_type = ? WHERE price_type = ?', [name, row.name]);
    run('UPDATE dict_price_types SET name = ? WHERE id = ?', [name, id]);
    const count =
      get<{ c: number }>(
        'SELECT COUNT(DISTINCT product_id) AS c FROM product_prices WHERE price_type = ?',
        [name]
      )?.c ?? 0;
    run('UPDATE dict_price_types SET products_count = ? WHERE id = ?', [count, id]);
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }
  auditFromContext(c, {
    action: 'price_type.rename',
    entity: 'price_type',
    entityId: id,
    summary: `Тип цены: «${row.name}» → «${name}»`,
    before: { name: row.name },
    after: { name },
  });
  return c.json(get('SELECT * FROM dict_price_types WHERE id = ?', [id]));
});

api.delete('/dicts/price-types/:id', async (c) => {
  const id = c.req.param('id');
  const row = get<{ id: string; name: string }>('SELECT * FROM dict_price_types WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const links = priceTypeLinkInfo(row.name);
  if (links.linked) {
    return c.json({ error: LINKED_DELETE_MSG, has_links: true, link_counts: links.counts }, 409);
  }
  run('DELETE FROM dict_price_types WHERE id = ?', [id]);
  auditFromContext(c, {
    action: 'price_type.delete',
    entity: 'price_type',
    entityId: id,
    summary: `Тип цены удалён: ${row.name}`,
    before: row,
  });
  return c.json({ ok: true });
});

api.get('/dicts/meta', (c) => c.json(dictMeta()));

api.post('/sync/media', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_sync')) {
    return c.json({ error: 'Недостаточно прав: синхронизация 1С' }, 403);
  }
  if (!hsConfigured() || !s3ConfigFromEnv()) {
    return c.json({ error: 'Нужны HS_* и S3_* в окружении сервиса' }, 500);
  }
  const body = await c.req.json().catch(() => ({})) as {
    limit?: number;
    onlyMissing?: boolean;
    replace?: boolean;
    product_id?: string;
  };
  try {
    const result = await syncMediaFrom1c({
      limit: body.limit ?? 100,
      onlyMissing: body.onlyMissing !== false,
      replace: !!body.replace,
      productIds: body.product_id ? [body.product_id] : undefined,
    });
    auditFromContext(c, {
      action: 'media.sync',
      entity: body.product_id ? 'product' : 'media',
      entityId: body.product_id ? String(body.product_id) : '',
      summary: body.product_id
        ? `Фото из 1С для товара ${body.product_id}: +${result.uploaded || 0}`
        : `Синк фото: загружено ${result.uploaded || 0}, пусто ${result.empty || 0}`,
      after: result,
    });
    return c.json({ ok: true, ...result, media: mediaSyncMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'media sync failed' }, 500);
  }
});

api.post('/sync/media-orient', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_sync')) {
    return c.json({ error: 'Недостаточно прав: синхронизация 1С' }, 403);
  }
  const body = await c.req.json().catch(() => ({})) as {
    limit?: number;
    product_id?: string;
  };
  try {
    const result = await backfillMediaOrientation({
      limit: body.limit ?? 300,
      productId: body.product_id,
    });
    return c.json({ ok: true, ...result, media: mediaSyncMeta() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'orient backfill failed' }, 500);
  }
});

api.get('/sync/odata/status', (c) =>
  c.json({ ...catalogCounts(), hs: hsSyncMeta(), media: mediaSyncMeta() })
);

/* ——— фото / медиа покрытие ——— */
api.get('/media/coverage', (c) => c.json(mediaCoverageByCategory()));

api.get('/media/products', (c) => {
  const statusRaw = (c.req.query('status') || 'all').trim();
  const status =
    statusRaw === 'with' ||
    statusRaw === 'without' ||
    statusRaw === 'stock_without'
      ? statusRaw
      : 'all';
  return c.json(
    listMediaProducts({
      q: (c.req.query('q') || '').trim() || undefined,
      category_id: (c.req.query('category_id') || '').trim() || undefined,
      status,
      page: Number(c.req.query('page') || 1) || 1,
      limit: Number(c.req.query('limit') || 50) || 50,
    })
  );
});

/** Очередь фотографа: остаток > 0 и нет фото. */
api.get('/media/photo-queue', (c) => {
  const actor = actorFromContext(c);
  if (!canAccessPhotoScreen(actor)) {
    return c.json({ error: 'Недостаточно прав: экран фотографа' }, 403);
  }
  return c.json(
    listPhotographerQueue({
      q: (c.req.query('q') || '').trim() || undefined,
      warehouse_id: (c.req.query('warehouse_id') || '').trim() || undefined,
      category_id: (c.req.query('category_id') || '').trim() || undefined,
      offset: Number(c.req.query('offset') || 0) || 0,
      limit: Number(c.req.query('limit') || 1) || 1,
    })
  );
});

function canUploadProductPhoto(actor: ReturnType<typeof actorFromContext>): boolean {
  if (!actor) return true;
  if (canDo(actor, 'can_edit_products')) return true;
  if (canAccessPhotoBySection(actor) || canAccessSection(actor, 'media')) return true;
  if (['admin', 'manager', 'warehouse', 'sto', 'photographer'].includes(actor.role)) {
    return true;
  }
  return false;
}

/** Ручная загрузка фото (камера / файл) → S3. */
api.post('/media/products/:id/photo', async (c) => {
  const actor = actorFromContext(c);
  if (!canUploadProductPhoto(actor)) {
    return c.json({ error: 'Недостаточно прав: загрузка фото' }, 403);
  }
  const id = c.req.param('id');
  let buf: Buffer | null = null;
  const contentType = (c.req.header('content-type') || '').toLowerCase();
  try {
    if (contentType.includes('multipart/form-data')) {
      const body = await c.req.parseBody({ all: true });
      const file = body.file ?? body.photo ?? body.image;
      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        buf = Buffer.from(await (file as File).arrayBuffer());
      }
    } else if (contentType.includes('application/json')) {
      const body = await c.req.json<{ image_base64?: string; data_url?: string }>();
      let raw = String(body.image_base64 || body.data_url || '').trim();
      const m = raw.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
      if (m) raw = m[1];
      if (raw) buf = Buffer.from(raw, 'base64');
    } else {
      const ab = await c.req.arrayBuffer();
      if (ab.byteLength) buf = Buffer.from(ab);
    }
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Не удалось прочитать файл' }, 400);
  }
  if (!buf?.length) return c.json({ error: 'Нужен файл фото (поле file) или image_base64' }, 400);

  try {
    assertPhotoShiftForUpload(actor);
    const result = await uploadManualProductPhoto(id, buf);
    let shift = null;
    if (actor) {
      shift = recordPhotoShiftUpload(actor.id, { newFile: result.new_file });
    }
    auditFromContext(c, {
      action: 'media.upload',
      entity: 'product',
      entityId: id,
      summary: `Фото товара загружено (${Math.round(result.size / 1024)} КБ)`,
      after: { url: result.url, size: result.size, mime: result.mime },
    });
    return c.json({ ok: true, ...result, shift });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload failed';
    const status = /не найден|некорректн|нужно изображение|маленьк|больше|начните смену/i.test(msg)
      ? 400
      : 500;
    return c.json({ error: msg }, status);
  }
});

/** Статус смены фотографа. */
api.get('/media/photo/shift', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canAccessPhotoScreen(actor)) {
    return c.json({ error: 'Недостаточно прав: экран фотографа' }, 403);
  }
  return c.json(photoShiftStatusPayload(actor));
});

api.post('/media/photo/shift/start', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canAccessPhotoScreen(actor)) {
    return c.json({ error: 'Недостаточно прав: экран фотографа' }, 403);
  }
  try {
    const shift = startPhotoShift(actor);
    auditFromContext(c, {
      action: 'photo_shift.start',
      entity: 'photo_shift',
      entityId: shift.id,
      summary: `Смена фотографа начата: ${actor.name}`,
      after: shift,
    });
    return c.json({ ok: true, ...photoShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'start failed' }, 400);
  }
});

api.post('/media/photo/shift/end', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canAccessPhotoScreen(actor)) {
    return c.json({ error: 'Недостаточно прав: экран фотографа' }, 403);
  }
  try {
    const ended = endPhotoShift(actor);
    if (ended) {
      auditFromContext(c, {
        action: 'photo_shift.end',
        entity: 'photo_shift',
        entityId: ended.id,
        summary: `Смена фотографа завершена: ${actor.name}`,
        after: ended,
      });
    }
    return c.json({ ok: true, ended, ...photoShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'end failed' }, 400);
  }
});

/** Отчёт по сменам фотографа: по сотруднику и дню. */
api.get('/media/photo/report', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canManagePhotoReport(actor)) {
    return c.json({ error: 'Недостаточно прав: отчёт фотографа' }, 403);
  }
  let staffId = (c.req.query('staff_id') || '').trim() || undefined;
  // фотограф видит только себя; админ/менеджер — всех
  if (
    actor.role === 'photographer' &&
    !actor.isSystemAdmin
  ) {
    staffId = actor.id;
  }
  return c.json(
    photoShiftsReport({
      from: (c.req.query('from') || '').trim() || undefined,
      to: (c.req.query('to') || '').trim() || undefined,
      staff_id: staffId,
      limit: Number(c.req.query('limit') || 200),
    })
  );
});

api.get('/media/photo/shifts', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'staff') && actor.role !== 'photographer') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  let staffId = (c.req.query('staff_id') || '').trim() || undefined;
  if (actor.role === 'photographer' && !actor.isSystemAdmin && !isAdminActor(actor)) {
    staffId = actor.id;
  }
  return c.json({
    items: listPhotoShifts({
      day: (c.req.query('day') || '').trim() || undefined,
      staff_id: staffId,
      limit: Number(c.req.query('limit') || 100),
    }),
  });
});

/* ——— catalogs ——— */
api.get('/categories', (c) => {
  const wantAll = c.req.query('all') === '1' || c.req.query('all') === 'true';
  const rows = all<{
    id: string;
    name: string;
    parent_id: string | null;
    created_at?: string;
    products_count: number;
  }>(
    `SELECT c.id, c.name, c.parent_id, c.created_at,
            COALESCE(pc.cnt, 0) AS products_count
     FROM categories c
     LEFT JOIN (
       SELECT category_id, COUNT(*) AS cnt FROM products GROUP BY category_id
     ) pc ON pc.category_id = c.id
     ORDER BY c.name COLLATE NOCASE, products_count DESC, c.created_at DESC`
  );
  if (wantAll) return c.json(rows);
  // Одноимённые папки (пустая оболочка + рабочая) — в UI одна строка. Фогель не синчим.
  const seen = new Set<string>();
  const deduped: typeof rows = [];
  for (const row of rows) {
    const key = String(row.name || '')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return c.json(deduped);
});

api.get('/categories/tree', (c) => c.json(buildCategoryTree()));

api.post('/categories', async (c) => {
  const body = await c.req.json<{ name: string; parent_id?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  const id = newGuid();
  run('INSERT INTO categories (id, name, parent_id) VALUES (?, ?, ?)', [
    id,
    body.name.trim(),
    body.parent_id ?? null,
  ]);
  return c.json({ id }, 201);
});

api.delete('/categories/:id', (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM categories WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const links = categoryLinkInfo(id);
  if (links.linked) {
    return c.json({ error: LINKED_DELETE_MSG, has_links: true, link_counts: links.counts }, 409);
  }
  try {
    hardDeleteCategory(id);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 409);
  }
  auditFromContext(c, {
    action: 'category.delete',
    entity: 'category',
    entityId: id,
    summary: `Категория удалена: ${(row as { name?: string }).name || id}`,
    before: row,
  });
  return c.json({ ok: true });
});

api.get('/units', (c) => c.json(all('SELECT * FROM units ORDER BY name')));
api.post('/units', async (c) => {
  const body = await c.req.json<{ name: string; short_name: string }>();
  const id = newGuid();
  run('INSERT INTO units (id, name, short_name) VALUES (?, ?, ?)', [
    id,
    body.name.trim(),
    body.short_name.trim(),
  ]);
  return c.json({ id }, 201);
});

api.get('/warehouses', (c) => {
  ensureCompaniesSchema();
  const archived = (c.req.query('archived') || '0').trim();
  const companyId = (c.req.query('company_id') || '').trim();
  const withTotals =
    (c.req.query('totals') || '').trim() === '1' ||
    (c.req.query('totals') || '').trim().toLowerCase() === 'true';
  const params: string[] = [];
  let where = '1=1';
  const coFilter = resolveListCompanyFilter(actorFromContext(c), companyId);
  if (coFilter.mode === 'none') {
    return c.json([]);
  }
  if (coFilter.mode === 'one') {
    where += ' AND company_id = ?';
    params.push(coFilter.id);
  } else if (coFilter.mode === 'in') {
    where += ` AND company_id IN (${coFilter.ids.map(() => '?').join(',')})`;
    params.push(...coFilter.ids);
  }
  if (archived === '1') where += ' AND is_active = 0';
  else if (archived !== 'all') where += ' AND is_active = 1';
  let rows: Array<Record<string, unknown>> = all(
    `SELECT * FROM warehouses WHERE ${where} ORDER BY is_active DESC, name`,
    params
  );
  rows = rows.map((w) => {
    const id = String(w.id);
    const links = warehouseLinkInfo(id);
    return {
      ...w,
      has_links: links.linked,
      can_delete: !links.linked,
      link_counts: links.counts,
    };
  });
  if (!withTotals) return c.json(rows);

  const totals = warehouseStockMoneyTotals();
  const byId = new Map(totals.map((t) => [t.warehouse_id, t]));
  return c.json(
    rows.map((w) => {
      const id = String(w.id);
      const t = byId.get(id);
      return {
        ...w,
        value_purchase: t?.value_purchase ?? 0,
        value_retail: t?.value_retail ?? 0,
        value_last_purchase: t?.value_last_purchase ?? 0,
        stock_qty: t?.qty ?? 0,
        stock_lines: t?.lines ?? 0,
        stock_lines_without_price: t?.lines_without_price ?? 0,
      };
    })
  );
});

/** Суммы остатков по складам: закуп (FIFO) + розница. */
api.get('/warehouses/stock-totals', (c) => {
  return c.json({
    method: 'fifo_inbound',
    currency: 'RUB',
    items: warehouseStockMoneyTotals(),
  });
});

api.post('/warehouses', async (c) => {
  ensureCompaniesSchema();
  const actor = actorFromContext(c);
  const body = await c.req.json<{ name: string; code?: string; company_id?: string }>();
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  const id = newGuid();
  // Код как в 1С: авто WH-000001 (ручной код — только если явно передали)
  const code = (body.code || '').trim() || nextCode('WH');
  const companyId = resolveCompanyId(body.company_id);
  const createdBy = actor?.id || '';
  try {
    run(
      `INSERT INTO warehouses (id, name, code, is_active, company_id, created_at, created_by, updated_at)
       VALUES (?, ?, ?, 1, ?, datetime('now'), ?, datetime('now'))`,
      [id, body.name.trim(), code, companyId, createdBy]
    );
  } catch {
    return c.json({ error: 'Код склада уже существует' }, 409);
  }
  const created = get(`SELECT * FROM warehouses WHERE id = ?`, [id]);
  auditFromContext(c, {
    action: 'warehouse.create',
    entity: 'warehouse',
    entityId: id,
    summary: `Склад создан: ${body.name.trim()} (${code})`,
    after: created,
  });
  return c.json(created, 201);
});

function warehouseDetail(id: string) {
  ensureCompaniesSchema();
  const row = get(
    `SELECT w.*,
            IFNULL(c.name,'') AS company_name,
            CASE
              WHEN IFNULL(w.created_by,'') = '__admin__' THEN 'Админ (системный)'
              WHEN IFNULL(s.name,'') != '' THEN s.name
              ELSE ''
            END AS created_by_name
     FROM warehouses w
     LEFT JOIN companies c ON c.id = w.company_id
     LEFT JOIN staff s ON s.id = w.created_by
     WHERE w.id = ?`,
    [id]
  ) as Record<string, unknown> | undefined;
  if (!row) return null;
  let createdAt = String(row.created_at || '');
  let createdByName = String(row.created_by_name || '');
  if (!createdAt || !createdByName) {
    const audit = get<{ created_at: string; actor_name: string; actor_id: string }>(
      `SELECT created_at, IFNULL(actor_name,'') AS actor_name, IFNULL(actor_id,'') AS actor_id
       FROM audit_log
       WHERE entity = 'warehouse' AND entity_id = ? AND action = 'warehouse.create'
       ORDER BY datetime(created_at) ASC
       LIMIT 1`,
      [id]
    );
    if (audit) {
      if (!createdAt) createdAt = String(audit.created_at || '');
      if (!createdByName) {
        createdByName =
          audit.actor_id === '__admin__'
            ? 'Админ (системный)'
            : String(audit.actor_name || '') || 'неизвестно';
      }
    }
  }
  return {
    ...row,
    created_at: createdAt,
    created_by_name: createdByName || (createdAt ? 'неизвестно' : '—'),
  };
}

api.get('/warehouses/:id', (c) => {
  const id = c.req.param('id');
  if (id === 'stock-totals') return c.json({ error: 'not found' }, 404);
  const detail = warehouseDetail(id);
  if (!detail) return c.json({ error: 'not found' }, 404);
  const links = warehouseLinkInfo(id);
  return c.json({
    ...detail,
    has_links: links.linked,
    can_delete: !links.linked,
    link_counts: links.counts,
  });
});

api.get('/warehouses/:id/movements', (c) => {
  const id = c.req.param('id');
  const wh = get(`SELECT id FROM warehouses WHERE id = ?`, [id]);
  if (!wh) return c.json({ error: 'not found' }, 404);
  const { page, limit, offset } = parsePage(c, 50);
  const type = (c.req.query('type') || '').trim();
  const where = [`(d.warehouse_id = ? OR IFNULL(d.warehouse_to_id,'') = ?)`];
  const params: Array<string | number> = [id, id];
  if (type === 'in' || type === 'out' || type === 'transfer' || type === 'return') {
    where.push('d.doc_type = ?');
    params.push(type);
  }
  const whereSql = where.join(' AND ');
  const total =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM stock_docs d WHERE ${whereSql}`,
      params
    )?.c ?? 0;
  const items = all(
    `SELECT d.id, d.doc_type, d.number, d.doc_date, d.posted, d.comment, d.amount, d.created_at,
            d.warehouse_id, d.warehouse_to_id,
            IFNULL(w.name,'') AS warehouse,
            IFNULL(wt.name,'') AS warehouse_to,
            IFNULL(c.name,'') AS counterparty,
            (SELECT COUNT(*) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS lines_count,
            (SELECT IFNULL(SUM(l.qty),0) FROM stock_doc_lines l WHERE l.doc_id = d.id) AS qty_sum
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     WHERE ${whereSql}
     ORDER BY d.doc_date DESC, datetime(d.created_at) DESC, d.number DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return c.json({
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

api.patch('/warehouses/:id', async (c) => {
  ensureCompaniesSchema();
  const id = c.req.param('id');
  const row = get('SELECT * FROM warehouses WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ name?: string; is_active?: boolean | number }>();
  if (body.name?.trim()) {
    run(
      `UPDATE warehouses SET name = ?, updated_at = datetime('now') WHERE id = ?`,
      [body.name.trim(), id]
    );
  }
  if (body.is_active != null) {
    const active = body.is_active === true || body.is_active === 1 ? 1 : 0;
    if (active === 0) {
      try {
        archiveWarehouse(id);
      } catch (e) {
        const err = e as Error & { status?: number; stock_qty?: number; has_stock?: boolean };
        if (err.status === 409) {
          return c.json(
            {
              error: err.message,
              has_stock: true,
              stock_qty: err.stock_qty ?? 0,
            },
            409
          );
        }
        throw e;
      }
    } else {
      run('UPDATE warehouses SET is_active = ? WHERE id = ?', [active, id]);
    }
  }
  const next = get('SELECT * FROM warehouses WHERE id = ?', [id]);
  auditFromContext(c, {
    action:
      body.is_active === false || body.is_active === 0
        ? 'warehouse.archive'
        : body.is_active === true || body.is_active === 1
          ? 'warehouse.restore'
          : 'warehouse.update',
    entity: 'warehouse',
    entityId: id,
    summary: `Склад: ${(next as { name?: string } | undefined)?.name || id}`,
    before: row,
    after: next,
  });
  return c.json(withDeleteMeta('warehouse', next as Record<string, unknown>));
});

api.post('/warehouses/:id/archive', (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM warehouses WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  let next;
  try {
    next = archiveWarehouse(id);
  } catch (e) {
    const err = e as Error & { status?: number; stock_qty?: number; has_stock?: boolean };
    if (err.status === 409) {
      return c.json(
        {
          error: err.message,
          has_stock: true,
          stock_qty: err.stock_qty ?? 0,
        },
        409
      );
    }
    throw e;
  }
  auditFromContext(c, {
    action: 'warehouse.archive',
    entity: 'warehouse',
    entityId: id,
    summary: `Склад в архив: ${(row as { name?: string }).name || id}`,
    before: row,
    after: next,
  });
  return c.json(withDeleteMeta('warehouse', next as Record<string, unknown>));
});

api.delete('/warehouses/:id', (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM warehouses WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const links = warehouseLinkInfo(id);
  if (links.linked) {
    return c.json({ error: LINKED_DELETE_MSG, has_links: true, link_counts: links.counts }, 409);
  }
  try {
    hardDeleteWarehouse(id);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 409);
  }
  auditFromContext(c, {
    action: 'warehouse.delete',
    entity: 'warehouse',
    entityId: id,
    summary: `Склад удалён: ${(row as { name?: string }).name || id}`,
    before: row,
  });
  return c.json({ ok: true });
});

function parsePage(c: { req: { query: (k: string) => string | undefined } }, defLimit = 50) {
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || defLimit) || defLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

api.get('/counterparties', (c) => {
  const q = (c.req.query('q') || '').trim();
  const kind = (c.req.query('kind') || '').trim(); // supplier | buyer | both | ''
  const partyKind = (c.req.query('party_kind') || '').trim().toLowerCase(); // legal | ip | person | partner(legacy) | ''
  const isPartnerQ = (c.req.query('is_partner') || '').trim().toLowerCase(); // 1 | 0 | yes | no | ''
  const archived = (c.req.query('archived') || '0').trim();
  const sort = (c.req.query('sort') || 'created').trim().toLowerCase();
  const dir = (c.req.query('dir') || 'desc').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const { page, limit, offset } = parsePage(c, 50);
  const where: string[] = [];
  const params: Array<string | number> = [];
  // Юр/ИП/физ: явный party_kind или вывод по длине ИНН (в импорте party_kind часто пуст)
  const partyKindExpr = `CASE
      WHEN LOWER(TRIM(IFNULL(cp.party_kind,''))) IN ('legal','ip','person') THEN LOWER(TRIM(cp.party_kind))
      WHEN length(replace(replace(replace(IFNULL(cp.inn,''),' ',''),'-',''),char(9),'')) = 10 THEN 'legal'
      WHEN length(replace(replace(replace(IFNULL(cp.inn,''),' ',''),'-',''),char(9),'')) = 12 THEN 'ip'
      ELSE 'person'
    END`;
  if (archived === '1') {
    where.push(`IFNULL(cp.is_active,1) = 0`);
  } else if (archived === 'all') {
    /* no filter */
  } else {
    where.push(`IFNULL(cp.is_active,1) = 1`);
  }
  if (kind === 'supplier') {
    where.push(`(cp.kind = 'supplier' OR cp.kind = 'both')`);
  } else if (kind === 'buyer') {
    where.push(`(cp.kind = 'buyer' OR cp.kind = 'both')`);
  } else if (kind === 'both') {
    where.push(`cp.kind = 'both'`);
  }
  if (partyKind === 'legal' || partyKind === 'ip' || partyKind === 'person') {
    where.push(`(${partyKindExpr}) = ?`);
    params.push(partyKind);
  } else if (partyKind === 'partner') {
    // legacy: раньше «партнёр» был значением party_kind
    where.push(`IFNULL(cp.is_partner,0) = 1`);
  }
  if (isPartnerQ === '1' || isPartnerQ === 'yes' || isPartnerQ === 'true') {
    where.push(`IFNULL(cp.is_partner,0) = 1`);
  } else if (isPartnerQ === '0' || isPartnerQ === 'no' || isPartnerQ === 'false') {
    where.push(`IFNULL(cp.is_partner,0) = 0`);
  }
  if (q) {
    where.push(`(cp.name LIKE ? OR IFNULL(cp.inn,'') LIKE ? OR IFNULL(cp.phone,'') LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Только складские — как вкладка «Документы» на карточке (касса/договоры — отдельные вкладки).
  const docsCountExpr = `IFNULL(sd.cnt,0)`;
  // Роль по факту документов: приход → поставщик, расход/возврат → покупатель.
  // kind в карточке из 1С часто «both» по умолчанию и врёт.
  const kindEffectiveExpr = `CASE
      WHEN IFNULL(sd.has_in,0) > 0 AND IFNULL(sd.has_buy,0) > 0 THEN 'both'
      WHEN IFNULL(sd.has_in,0) > 0 THEN 'supplier'
      WHEN IFNULL(sd.has_buy,0) > 0 THEN 'buyer'
      ELSE cp.kind
    END`;
  const orderMap: Record<string, string> = {
    name: `cp.name COLLATE NOCASE ${dir}`,
    inn: `IFNULL(cp.inn,'') ${dir}, cp.name COLLATE NOCASE`,
    phone: `IFNULL(cp.phone,'') ${dir}, cp.name COLLATE NOCASE`,
    party: `CASE (${partyKindExpr}) WHEN 'legal' THEN 1 WHEN 'ip' THEN 2 ELSE 3 END ${dir}, cp.name COLLATE NOCASE`,
    kind: `(${kindEffectiveExpr}) ${dir}, cp.name COLLATE NOCASE`,
    created: `CASE WHEN IFNULL(TRIM(cp.created_at),'') = '' THEN 1 ELSE 0 END, cp.created_at ${dir}, cp.name COLLATE NOCASE`,
    docs: `${docsCountExpr} ${dir}, cp.name COLLATE NOCASE`,
  };
  const orderBy = `IFNULL(cp.is_active,1) DESC, ${orderMap[sort] || orderMap.created}`;
  const fromSql = `
     FROM counterparties cp
     LEFT JOIN (
       SELECT counterparty_id AS cid,
              COUNT(*) AS cnt,
              SUM(CASE WHEN doc_type = 'in' THEN 1 ELSE 0 END) AS has_in,
              SUM(CASE WHEN doc_type IN ('out','return') THEN 1 ELSE 0 END) AS has_buy
       FROM stock_docs
       WHERE IFNULL(TRIM(counterparty_id),'') != ''
       GROUP BY counterparty_id
     ) sd ON sd.cid = cp.id`;
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c ${fromSql} ${whereSql}`, params)?.c ?? 0;
  const items = all(
    `SELECT cp.*, (${partyKindExpr}) AS party_kind_effective,
            (${kindEffectiveExpr}) AS kind_effective,
            ${docsCountExpr} AS docs_count
     ${fromSql}
     ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return c.json({
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    sort,
    dir: dir.toLowerCase(),
  });
});
api.post('/counterparties', async (c) => {
  const body = await c.req.json<{
    name: string;
    inn?: string;
    phone?: string;
    kind?: string;
    party_kind?: string;
    is_partner?: boolean | number | string;
    kpp?: string;
    ogrn?: string;
    address?: string;
    name_full?: string;
    email?: string;
  }>();
  if (!body.name?.trim()) return c.json({ error: 'name required' }, 400);
  const id = newGuid();
  const kind = ['supplier', 'buyer', 'both'].includes(String(body.kind || ''))
    ? String(body.kind)
    : 'supplier';
  const partyKindRaw = String(body.party_kind || '').trim().toLowerCase();
  const partyKind = ['person', 'ip', 'legal'].includes(partyKindRaw)
    ? partyKindRaw
    : String(body.inn || '').replace(/\D/g, '').length === 10
      ? 'legal'
      : String(body.inn || '').replace(/\D/g, '').length === 12
        ? 'ip'
        : '';
  const phone = normalizePhoneForStorage(body.phone ?? '');
  const inn = String(body.inn ?? '').trim();
  const kpp = partyKind === 'legal' ? String(body.kpp ?? '').trim() : '';
  const ogrn = String(body.ogrn ?? '').trim();
  const address = String(body.address ?? '').trim();
  const nameFull = String(body.name_full ?? '').trim();
  const email = String(body.email ?? '').trim();
  const fromDadata = Boolean(kpp || ogrn || address || nameFull);
  const isPartner =
    body.is_partner === true || body.is_partner === 1 || body.is_partner === '1' ? 1 : 0;
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  run(
    `INSERT INTO counterparties (id, name, inn, phone, kind, party_kind, is_partner, kpp, ogrn, address, name_full, email, dadata_synced_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      body.name.trim(),
      inn,
      phone,
      kind,
      partyKind,
      isPartner,
      kpp,
      ogrn,
      address,
      nameFull,
      email,
      fromDadata ? new Date().toISOString() : '',
      createdAt,
    ]
  );
  const created = get('SELECT * FROM counterparties WHERE id = ?', [id]);
  auditFromContext(c, {
    action: 'counterparty.create',
    entity: 'counterparty',
    entityId: id,
    summary: `Контрагент создан: ${body.name.trim()}`,
    after: {
      name: body.name.trim(),
      inn,
      phone,
      kind,
      kpp,
      ogrn,
      email,
    },
  });
  return c.json(created || { id, name: body.name.trim(), inn, phone, kind, email }, 201);
});

api.get('/counterparties/:id', (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM counterparties WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const docsTotal =
    get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM stock_docs WHERE counterparty_id = ?',
      [id]
    )?.c ?? 0;
  const docsLimit = Math.min(200, Math.max(1, Number(c.req.query('docs_limit')) || 50));
  const docsPages = Math.max(1, Math.ceil(docsTotal / docsLimit));
  let docsPage = Math.max(1, Number(c.req.query('docs_page')) || 1);
  if (docsPage > docsPages) docsPage = docsPages;
  const docsOffset = (docsPage - 1) * docsLimit;
  const docs = all(
    `SELECT d.id, d.doc_type, d.number, d.doc_date, d.posted, d.amount, d.source,
            w.name AS warehouse
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     WHERE d.counterparty_id = ?
     ORDER BY d.doc_date DESC, d.number DESC
     LIMIT ? OFFSET ?`,
    [id, docsLimit, docsOffset]
  );
  const links = counterpartyLinkInfo(id);
  const amoLinks = listLinkedCounterparties(id);
  return c.json({
    ...row,
    docs,
    docs_total: docsTotal,
    docs_page: docsPage,
    docs_pages: docsPages,
    docs_limit: docsLimit,
    has_links: links.linked,
    can_delete: !links.linked,
    link_counts: links.counts,
    amo_companies: amoLinks.companies,
    amo_contacts: amoLinks.contacts,
  });
});

api.patch('/counterparties/:id', async (c) => {
  const id = c.req.param('id');
  const row = get<Record<string, unknown>>('SELECT * FROM counterparties WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    name?: string;
    inn?: string;
    phone?: string;
    kind?: string;
    lead_time_days?: number;
    is_active?: boolean | number;
    kpp?: string;
    ogrn?: string;
    address?: string;
    name_full?: string;
    email?: string;
    party_kind?: string;
    is_partner?: boolean | number | string;
    barcode_prefix?: string;
  }>();
  const before = {
    name: row.name,
    inn: row.inn,
    phone: row.phone,
    kind: row.kind,
    lead_time_days: row.lead_time_days,
    is_active: row.is_active,
    party_kind: row.party_kind,
    is_partner: row.is_partner,
  };
  if (body.name != null) {
    const name = body.name.trim();
    if (!name) return c.json({ error: 'name не может быть пустым' }, 400);
    run('UPDATE counterparties SET name = ? WHERE id = ?', [name, id]);
  }
  if (body.inn != null) {
    run('UPDATE counterparties SET inn = ? WHERE id = ?', [body.inn.trim(), id]);
  }
  if (body.kpp != null) {
    run('UPDATE counterparties SET kpp = ? WHERE id = ?', [body.kpp.trim(), id]);
  }
  if (body.ogrn != null) {
    run('UPDATE counterparties SET ogrn = ? WHERE id = ?', [body.ogrn.trim(), id]);
  }
  if (body.address != null) {
    run('UPDATE counterparties SET address = ? WHERE id = ?', [body.address.trim(), id]);
  }
  if (body.name_full != null) {
    run('UPDATE counterparties SET name_full = ? WHERE id = ?', [body.name_full.trim(), id]);
  }
  if (body.email != null) {
    run('UPDATE counterparties SET email = ? WHERE id = ?', [body.email.trim(), id]);
  }
  if (body.phone != null) {
    run('UPDATE counterparties SET phone = ? WHERE id = ?', [
      normalizePhoneForStorage(body.phone),
      id,
    ]);
  }
  if (body.kind != null) {
    const kind = String(body.kind).trim();
    if (!['supplier', 'buyer', 'both'].includes(kind)) {
      return c.json({ error: 'kind: supplier | buyer | both' }, 400);
    }
    run('UPDATE counterparties SET kind = ? WHERE id = ?', [kind, id]);
  }
  if (body.party_kind != null) {
    const pk = String(body.party_kind).trim().toLowerCase();
    if (pk && !['person', 'ip', 'legal'].includes(pk)) {
      return c.json({ error: 'party_kind: person | ip | legal' }, 400);
    }
    run('UPDATE counterparties SET party_kind = ? WHERE id = ?', [pk, id]);
    if (pk === 'person' || pk === 'ip') {
      run('UPDATE counterparties SET kpp = ? WHERE id = ?', ['', id]);
    }
  }
  if (body.is_partner != null) {
    const partner = body.is_partner === true || body.is_partner === 1 || body.is_partner === '1' ? 1 : 0;
    run('UPDATE counterparties SET is_partner = ? WHERE id = ?', [partner, id]);
  }
  if (body.lead_time_days != null) {
    const days = Math.max(0, Math.floor(Number(body.lead_time_days) || 0));
    run('UPDATE counterparties SET lead_time_days = ? WHERE id = ?', [days, id]);
  }
  if (body.barcode_prefix != null) {
    const pref = String(body.barcode_prefix || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8);
    run('UPDATE counterparties SET barcode_prefix = ? WHERE id = ?', [pref, id]);
  }
  if (body.is_active != null) {
    const active = body.is_active === true || body.is_active === 1 ? 1 : 0;
    run('UPDATE counterparties SET is_active = ? WHERE id = ?', [active, id]);
  }
  // банковские / директор — если пришли с формы
  const bankBody = body as {
    director?: string;
    bank?: string;
    bik?: string;
    rs?: string;
    ks?: string;
  };
  if (bankBody.director != null) {
    run('UPDATE counterparties SET director = ? WHERE id = ?', [String(bankBody.director).trim(), id]);
  }
  if (bankBody.bank != null) {
    run('UPDATE counterparties SET bank = ? WHERE id = ?', [String(bankBody.bank).trim(), id]);
  }
  if (bankBody.bik != null) {
    run('UPDATE counterparties SET bik = ? WHERE id = ?', [
      String(bankBody.bik).replace(/\D/g, ''),
      id,
    ]);
  }
  if (bankBody.rs != null) {
    run('UPDATE counterparties SET rs = ? WHERE id = ?', [
      String(bankBody.rs).replace(/\D/g, ''),
      id,
    ]);
  }
  if (bankBody.ks != null) {
    run('UPDATE counterparties SET ks = ? WHERE id = ?', [
      String(bankBody.ks).replace(/\D/g, ''),
      id,
    ]);
  }
  const after = get('SELECT name, inn, phone, kind, is_active FROM counterparties WHERE id = ?', [id]);
  const amoPush = await pushCounterpartyToAmo({
    counterpartyId: id,
    buyer: {
      name: body.name,
      inn: body.inn,
      kpp: body.kpp,
      ogrn: body.ogrn,
      address: body.address,
      phone: body.phone,
      email: body.email,
      director: bankBody.director,
      bank: bankBody.bank,
      bik: bankBody.bik,
      rs: bankBody.rs,
      ks: bankBody.ks,
    },
  });
  auditFromContext(c, {
    action: 'counterparty.update',
    entity: 'counterparty',
    entityId: id,
    summary: `Контрагент изменён: ${(after as { name?: string })?.name || id}${
      amoPush.error === 'no_amo_link'
        ? ''
        : amoPush.ok
          ? ' · Amo дозаполнен'
          : ' · Amo: ' + (amoPush.error || 'ошибка')
    }`,
    before,
    after: { ...after, amo: amoPush },
  });
  return c.json({ ok: true, amo: amoPush });
});

api.post('/counterparties/:id/archive', (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM counterparties WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const next = archiveCounterparty(id);
  auditFromContext(c, {
    action: 'counterparty.archive',
    entity: 'counterparty',
    entityId: id,
    summary: `Контрагент в архив: ${(row as { name?: string }).name || id}`,
    before: row,
    after: next,
  });
  return c.json(withDeleteMeta('counterparty', next as Record<string, unknown>));
});

api.delete('/counterparties/:id', (c) => {
  return c.json(
    {
      error: 'Удаление контрагентов запрещено. Перенесите в архив.',
      archive_only: true,
    },
    405
  );
});

api.get('/products', (c) => {
  const q = (c.req.query('q') || '').trim();
  const categoryId = (c.req.query('category_id') || '').trim();
  const categoryName = (c.req.query('category') || '').trim();
  const mark = (c.req.query('mark') || '').trim();
  const model = (c.req.query('model') || '').trim();
  const generation = (c.req.query('generation') || '').trim();
  const archived = (c.req.query('archived') || '0').trim();
  const itemKind = (c.req.query('item_kind') || '').trim().toLowerCase();
  const sort = (c.req.query('sort') || 'name').trim().toLowerCase();
  const dir = (c.req.query('dir') || 'asc').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const { page, limit, offset } = parsePage(c, 50);
  // Остаток по всем складам (stock_balances + Get/Rests без дублей)
  const stockJoin = `
    LEFT JOIN (
      SELECT x.product_id AS product_id, SUM(x.qty) AS stock_qty
      FROM (
        SELECT b.product_id AS product_id, b.qty AS qty
        FROM stock_balances b
        WHERE b.qty != 0
        UNION ALL
        SELECT r.product_id, r.qty
        FROM product_store_rests r
        WHERE r.qty != 0
          AND NOT EXISTS (
            SELECT 1 FROM stock_balances b2
            WHERE b2.product_id = r.product_id
              AND b2.warehouse_id = r.warehouse_id
              AND b2.qty != 0
          )
      ) x
      GROUP BY x.product_id
    ) st ON st.product_id = p.id`;
  const select = `SELECT p.*, u.short_name AS unit, c.name AS category,
            CASE WHEN IFNULL(p.item_kind,'product') = 'service' THEN 'service' ELSE 'product' END AS item_kind,
            IFNULL(st.stock_qty, 0) AS stock_qty
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     ${stockJoin}`;

  let where =
    archived === '1'
      ? 'WHERE IFNULL(p.is_active,1) = 0'
      : archived === 'all'
        ? 'WHERE 1=1'
        : 'WHERE IFNULL(p.is_active,1) = 1';
  const params: Array<string | number> = [];

  if (itemKind === 'service' || itemKind === 'product') {
    where +=
      itemKind === 'service'
        ? ` AND IFNULL(p.item_kind,'product') = 'service'`
        : ` AND IFNULL(p.item_kind,'product') != 'service'`;
  }

  if (q) {
    const like = `%${q}%`;
    // Артикул / код / штрихкод / название / бренд; применимость (марка/модель) при q ≥ 2
    if (q.length >= 2) {
      where += ` AND (
        p.name LIKE ? OR p.sku LIKE ? OR IFNULL(p.code,'') LIKE ?
        OR IFNULL(p.barcode,'') LIKE ? OR IFNULL(p.array_sku,'') LIKE ?
        OR IFNULL(p.brand,'') LIKE ? OR IFNULL(c.name,'') LIKE ?
        OR p.id IN (
          SELECT a.product_id FROM product_applicability a
          WHERE a.mark LIKE ? OR a.model LIKE ? OR a.only_model LIKE ?
          LIMIT 2000
        )
      )`;
      params.push(like, like, like, like, like, like, like, like, like, like);
    } else {
      where += ` AND (
        p.name LIKE ? OR p.sku LIKE ? OR IFNULL(p.code,'') LIKE ?
        OR IFNULL(p.brand,'') LIKE ? OR IFNULL(c.name,'') LIKE ?
      )`;
      params.push(like, like, like, like, like);
    }
  }

  if (mark || model || generation) {
    const appParts: string[] = [];
    const appParams: string[] = [];
    if (mark) {
      appParts.push('a.mark = ?');
      appParams.push(mark);
    }
    if (model) {
      appParts.push('(a.model = ? OR a.only_model = ?)');
      appParams.push(model, model);
    }
    if (generation) {
      appParts.push('a.generation = ?');
      appParams.push(generation);
    }
    where += ` AND p.id IN (
      SELECT a.product_id FROM product_applicability a
      WHERE ${appParts.join(' AND ')}
    )`;
    params.push(...appParams);
  }

  if (categoryId === '__none__' || categoryName === '__none__') {
    where += ' AND (p.category_id IS NULL OR p.category_id = \'\')';
  } else if (categoryId) {
    // Категория + все подкатегории (и дубли GUID с тем же именем)
    const ids = idsForCategoryFilter(categoryId);
    if (ids.length === 1) {
      where += ' AND p.category_id = ?';
      params.push(ids[0]);
    } else if (ids.length > 1) {
      where += ` AND p.category_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
  } else if (categoryName) {
    where += ' AND IFNULL(c.name,\'\') = ?';
    params.push(categoryName);
  }

  const orderMap: Record<string, string> = {
    name: 'p.name COLLATE NOCASE',
    sku: 'p.sku COLLATE NOCASE',
    code: "IFNULL(p.code,'') COLLATE NOCASE",
    brand: "IFNULL(p.brand,'') COLLATE NOCASE",
    unit: "IFNULL(u.short_name,'') COLLATE NOCASE",
    category: "IFNULL(c.name,'') COLLATE NOCASE",
    kind: "CASE WHEN IFNULL(p.item_kind,'product') = 'service' THEN 1 ELSE 0 END",
    site: 'IFNULL(p.notupload, 0)',
    stock: 'IFNULL(st.stock_qty, 0)',
  };
  const orderExpr = orderMap[sort] || orderMap.name;
  const orderBy = `${orderExpr} ${dir}, p.name COLLATE NOCASE ASC`;

  const total =
    get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       ${where}`,
      params
    )?.c ?? 0;
  const items = all(
    `${select} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return c.json({
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    sort,
    dir: dir.toLowerCase(),
  });
});

api.get('/products/:id', (c) => {
  const id = c.req.param('id');
  const product = get(
    `SELECT p.*, u.short_name AS unit, c.name AS category
     FROM products p
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.id = ?`,
    [id]
  );
  if (!product) return c.json({ error: 'not found' }, 404);
  const applicabilityRaw = all<{
    id: string;
    mark: string;
    model: string;
    only_model: string;
    generation: string;
    years: string;
  }>(
    `SELECT id, mark, model, only_model, generation, years
     FROM product_applicability WHERE product_id = ?
     ORDER BY mark, model, years`,
    [id]
  );
  const appCombos = all<{
    mark: string;
    model: string;
    generation: string;
    years: string;
  }>(
    `SELECT mark, model, generation, years
     FROM product_applicability
     WHERE IFNULL(mark,'') != ''
     GROUP BY mark, model, generation, years
     ORDER BY mark, COUNT(*) DESC, model, generation, years`
  );
  const markSet = new Set<string>();
  for (const row of appCombos) {
    if (row.mark) markSet.add(row.mark);
  }
  for (const row of applicabilityRaw) {
    if (row.mark) markSet.add(row.mark);
  }
  const applicability = applicabilityRaw;
  const applicability_options = {
    marks: [...markSet].sort((a, b) => a.localeCompare(b, 'ru')),
    combos: appCombos,
  };
  const propertiesRaw = all<{ property: string; value: string }>(
    `SELECT property, value FROM product_properties WHERE product_id = ? ORDER BY property`,
    [id]
  );
  const propNames = [...new Set(propertiesRaw.map((p) => p.property).filter(Boolean))];
  const optionsByProp = new Map<string, string[]>();
  if (propNames.length) {
    const placeholders = propNames.map(() => '?').join(',');
    const optionRows = all<{ property: string; value: string }>(
      `SELECT property, value
       FROM product_properties
       WHERE property IN (${placeholders}) AND IFNULL(value,'') != ''
       GROUP BY property, value
       ORDER BY property, COUNT(*) DESC, value`,
      propNames
    );
    for (const row of optionRows) {
      const list = optionsByProp.get(row.property) || [];
      list.push(row.value);
      optionsByProp.set(row.property, list);
    }
  }
  const properties = propertiesRaw.map((p) => {
    const options = optionsByProp.get(p.property) || [];
    if (p.value && !options.includes(p.value)) options.unshift(p.value);
    return { ...p, options };
  });
  const existingPrices = all<{ price_type: string; price: number }>(
    `SELECT price_type, price FROM product_prices WHERE product_id = ?`,
    [id]
  );
  const priceByType = new Map(
    existingPrices.map((p) => [String(p.price_type || '').trim(), Number(p.price) || 0])
  );
  const dictTypes = all<{ name: string }>(
    `SELECT name FROM dict_price_types
     WHERE IFNULL(TRIM(name),'') != ''
     ORDER BY
       CASE name
         WHEN 'Розничная цена' THEN 0
         WHEN 'ОПТ1' THEN 1
         WHEN 'ОПТ2' THEN 2
         WHEN 'Цена снятие/установки' THEN 3
         WHEN 'Цена Маркетплейс' THEN 4
         ELSE 10
       END,
       name`
  ).map((r) => String(r.name || '').trim());
  // Все типы из справочника + любые цены товара, которых нет в справочнике
  const typeNames = [...dictTypes];
  for (const t of priceByType.keys()) {
    if (t && !typeNames.includes(t)) typeNames.push(t);
  }
  const prices =
    typeNames.length > 0
      ? typeNames.map((price_type) => ({
          price_type,
          price: priceByType.has(price_type) ? priceByType.get(price_type)! : 0,
          has_value: priceByType.has(price_type),
        }))
      : existingPrices
          .map((p) => ({
            price_type: String(p.price_type || ''),
            price: Number(p.price) || 0,
            has_value: true,
          }))
          .sort((a, b) => a.price_type.localeCompare(b.price_type, 'ru'));
  const media = all(
    `SELECT id, kind, mime, ext, url, size, sort_order, width, height, orientation
     FROM product_media WHERE product_id = ?
     ORDER BY sort_order, synced_at`,
    [id]
  );
  const rests = all(
    `SELECT x.warehouse_id,
            IFNULL(w.name, x.warehouse_id) AS warehouse,
            IFNULL(w.code, '') AS warehouse_code,
            x.qty,
            CASE WHEN w.code = 'WAIT-PAY' OR w.name = 'Ожидание оплаты' THEN 1 ELSE 0 END AS is_reserve,
            IFNULL((
              SELECT SUM(sr.qty) FROM stock_reserves sr
              WHERE sr.product_id = x.product_id
                AND sr.reserve_warehouse_id = x.warehouse_id
                AND sr.status = 'active'
            ), 0) AS reserved_qty
     FROM (
       SELECT b.warehouse_id AS warehouse_id, b.product_id AS product_id, b.qty AS qty
       FROM stock_balances b
       WHERE b.product_id = ? AND b.qty != 0
       UNION ALL
       SELECT r.warehouse_id, r.product_id, r.qty
       FROM product_store_rests r
       WHERE r.product_id = ? AND r.qty != 0
         AND NOT EXISTS (
           SELECT 1 FROM stock_balances b2
           WHERE b2.product_id = r.product_id
             AND b2.warehouse_id = r.warehouse_id
             AND b2.qty != 0
         )
     ) x
     LEFT JOIN warehouses w ON w.id = x.warehouse_id
     ORDER BY
       CASE WHEN w.code = 'WAIT-PAY' OR w.name = 'Ожидание оплаты' THEN 0 ELSE 1 END,
       IFNULL(w.name, x.warehouse_id)`,
    [id, id]
  );
  const related = all(
    `SELECT p.id, p.sku, p.name
     FROM product_related r
     JOIN products p ON p.id = r.related_id
     WHERE r.product_id = ?
     ORDER BY p.name`,
    [id]
  );
  const inbound_layers = productInboundLayers(id);
  const purchase_history = productPurchaseHistory(id, 50);
  const links = productLinkInfo(id);
  return c.json({
    ...product,
    item_kind:
      String((product as { item_kind?: string }).item_kind || '').toLowerCase() === 'service'
        ? 'service'
        : 'product',
    notupload: Number((product as { notupload?: number }).notupload) ? 1 : 0,
    applicability,
    applicability_options,
    properties,
    prices,
    media,
    rests,
    related,
    inbound_layers,
    purchase_history,
    has_links: links.linked,
    can_delete: !links.linked,
    link_counts: links.counts,
  });
});

api.post('/products', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const body = await c.req.json<{
    sku?: string;
    name: string;
    unit_id?: string;
    category_id?: string;
    barcode?: string;
    code?: string;
    item_kind?: string;
  }>();
  if (!body.name?.trim()) {
    return c.json({ error: 'name required' }, 400);
  }
  const id = newGuid();
  const itemKind =
    String(body.item_kind || '').toLowerCase() === 'service' ? 'service' : 'product';
  const prefix = itemKind === 'service' ? 'УСЛ' : 'НФ';
  // не пересекаться с уже импортированными кодами 1С
  if (!(body.sku || '').trim()) {
    const mx = get<{ m: number }>(
      `SELECT MAX(CAST(substr(v, instr(v, '-') + 1) AS INTEGER)) AS m FROM (
         SELECT sku AS v FROM products WHERE sku LIKE ?
         UNION ALL
         SELECT code AS v FROM products WHERE code LIKE ?
       )`,
      [prefix + '-%', prefix + '-%']
    )?.m;
    if (mx && Number.isFinite(Number(mx))) ensureSeqAtLeast(prefix, Number(mx));
  }
  const sku = (body.sku || '').trim() || nextCode(prefix);
  const code = (body.code || '').trim() || sku;
  let unitId = (body.unit_id || '').trim();
  if (!unitId) {
    unitId =
      get<{ id: string }>('SELECT id FROM units WHERE short_name = ? LIMIT 1', ['шт'])?.id ||
      get<{ id: string }>('SELECT id FROM units LIMIT 1')?.id ||
      '';
  }
  if (!unitId) return c.json({ error: 'нет единиц измерения — синхронизируйте справочники' }, 400);
  try {
    run(
      `INSERT INTO products (id, sku, name, category_id, unit_id, barcode, item_kind, code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        sku,
        body.name.trim(),
        body.category_id ?? null,
        unitId,
        body.barcode ?? '',
        itemKind,
        code,
      ]
    );
  } catch {
    return c.json({ error: 'SKU уже существует' }, 409);
  }
  auditFromContext(c, {
    action: 'product.create',
    entity: 'product',
    entityId: id,
    summary: `${itemKind === 'service' ? 'Услуга' : 'Товар'} добавлен: ${body.name.trim()} (${sku})`,
    after: { id, sku, code, name: body.name.trim(), item_kind: itemKind },
  });
  return c.json({ id, sku, code, item_kind: itemKind }, 201);
});

/** Автопредложение категорий для товаров без category_id. */
api.post('/products/suggest-categories', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body.ids) ? body.ids : [];
  try {
    const suggestions = suggestCategoriesForProducts(ids);
    return c.json({ suggestions, total: suggestions.length });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.patch('/products/:id', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    sku?: string;
    brand?: string;
    barcode?: string;
    category_id?: string | null;
    is_active?: boolean;
    code?: string;
    array_sku?: string;
    package_width_cm?: number | null;
    package_height_cm?: number | null;
    package_length_cm?: number | null;
    package_weight_g?: number | null;
    gtin?: string;
    requires_marking?: boolean | number;
    serial_tracked?: boolean | number;
    min_stock?: number | null;
    item_kind?: string;
    notupload?: boolean | number;
  }>();
  const row = get<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const before = {
    name: row.name,
    sku: row.sku,
    brand: row.brand,
    barcode: row.barcode,
    category_id: row.category_id,
    is_active: row.is_active,
    code: row.code,
    array_sku: row.array_sku,
    package_width_cm: row.package_width_cm,
    package_height_cm: row.package_height_cm,
    package_length_cm: row.package_length_cm,
    package_weight_g: row.package_weight_g,
    gtin: row.gtin,
    requires_marking: row.requires_marking,
    serial_tracked: row.serial_tracked,
    min_stock: row.min_stock,
    item_kind: row.item_kind || 'product',
    notupload: row.notupload || 0,
  };
  if (body.name != null) {
    run('UPDATE products SET name = ? WHERE id = ?', [body.name.trim(), id]);
  }
  if (body.sku != null) {
    const sku = body.sku.trim();
    if (!sku) return c.json({ error: 'sku не может быть пустым' }, 400);
    const clash = get<{ id: string }>(
      'SELECT id FROM products WHERE sku = ? AND id != ? LIMIT 1',
      [sku, id]
    );
    if (clash) return c.json({ error: 'SKU уже занят' }, 409);
    run('UPDATE products SET sku = ? WHERE id = ?', [sku, id]);
  }
  if (body.brand != null) {
    run('UPDATE products SET brand = ? WHERE id = ?', [body.brand.trim(), id]);
  }
  if (body.barcode != null) {
    run('UPDATE products SET barcode = ? WHERE id = ?', [body.barcode.trim(), id]);
  }
  if (body.code != null) {
    run('UPDATE products SET code = ? WHERE id = ?', [body.code.trim(), id]);
  }
  if (body.array_sku != null) {
    run('UPDATE products SET array_sku = ? WHERE id = ?', [body.array_sku.trim(), id]);
  }
  if (body.category_id !== undefined) {
    const cat = body.category_id ? String(body.category_id).trim() : '';
    if (cat) {
      const exists = get('SELECT id FROM categories WHERE id = ?', [cat]);
      if (!exists) return c.json({ error: 'категория не найдена' }, 400);
      run('UPDATE products SET category_id = ? WHERE id = ?', [cat, id]);
    } else {
      run('UPDATE products SET category_id = NULL WHERE id = ?', [id]);
    }
  }
  if (body.is_active != null) {
    run('UPDATE products SET is_active = ? WHERE id = ?', [body.is_active ? 1 : 0, id]);
  }
  const numOrNull = (v: number | null | undefined) => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const pw = numOrNull(body.package_width_cm);
  const ph = numOrNull(body.package_height_cm);
  const pl = numOrNull(body.package_length_cm);
  const pwg = numOrNull(body.package_weight_g);
  if (pw !== undefined) run('UPDATE products SET package_width_cm = ? WHERE id = ?', [pw, id]);
  if (ph !== undefined) run('UPDATE products SET package_height_cm = ? WHERE id = ?', [ph, id]);
  if (pl !== undefined) run('UPDATE products SET package_length_cm = ? WHERE id = ?', [pl, id]);
  if (pwg !== undefined) run('UPDATE products SET package_weight_g = ? WHERE id = ?', [pwg, id]);
  if (body.gtin != null) {
    run('UPDATE products SET gtin = ? WHERE id = ?', [String(body.gtin).trim(), id]);
  }
  if (body.requires_marking != null) {
    run('UPDATE products SET requires_marking = ? WHERE id = ?', [
      body.requires_marking ? 1 : 0,
      id,
    ]);
  }
  if (body.serial_tracked != null) {
    run('UPDATE products SET serial_tracked = ? WHERE id = ?', [
      body.serial_tracked ? 1 : 0,
      id,
    ]);
  }
  if (body.min_stock !== undefined) {
    const ms =
      body.min_stock === null ? 0 : Math.max(0, Number(body.min_stock) || 0);
    run('UPDATE products SET min_stock = ? WHERE id = ?', [ms, id]);
  }
  if (body.item_kind != null) {
    const kind =
      String(body.item_kind).toLowerCase() === 'service' ? 'service' : 'product';
    run('UPDATE products SET item_kind = ? WHERE id = ?', [kind, id]);
  }
  if (body.notupload != null) {
    run('UPDATE products SET notupload = ? WHERE id = ?', [body.notupload ? 1 : 0, id]);
  }

  const after = get(
    `SELECT name, sku, brand, barcode, category_id, is_active, code, array_sku,
            package_width_cm, package_height_cm, package_length_cm, package_weight_g,
            IFNULL(gtin,'') AS gtin, IFNULL(requires_marking,0) AS requires_marking,
            IFNULL(serial_tracked,0) AS serial_tracked,
            IFNULL(min_stock,0) AS min_stock,
            CASE WHEN IFNULL(item_kind,'product') = 'service' THEN 'service' ELSE 'product' END AS item_kind,
            IFNULL(notupload,0) AS notupload
     FROM products WHERE id = ?`,
    [id]
  );
  auditFromContext(c, {
    action: 'product.update',
    entity: 'product',
    entityId: id,
    summary: `Товар изменён: ${(after as { name?: string })?.name || id}`,
    before,
    after,
  });
  return c.json({ ok: true });
});

api.post('/products/reclassify-kinds', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products') && !isAdminActor(actor)) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const result = reclassifyAllProductKinds();
  const purged = purgeServiceLinesFromOutDocs();
  auditFromContext(c, {
    action: 'product.reclassify_kinds',
    entity: 'product',
    entityId: '',
    summary: `Классификация номенклатуры: услуг ${result.service}, товаров ${result.product}, изменено ${result.changed}; из расходных убрано услуг ${purged.deleted}`,
    after: { ...result, ...purged },
  });
  return c.json({ ok: true, ...result, out_services_purged: purged.deleted });
});

api.post('/products/:id/archive', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const id = c.req.param('id');
  const row = get('SELECT * FROM products WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const next = archiveProduct(id);
  auditFromContext(c, {
    action: 'product.archive',
    entity: 'product',
    entityId: id,
    summary: `Товар в архив: ${(row as { name?: string }).name || id}`,
    before: row,
    after: next,
  });
  return c.json(withDeleteMeta('product', next as Record<string, unknown>));
});

api.delete('/products/:id', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const id = c.req.param('id');
  const row = get('SELECT * FROM products WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const links = productLinkInfo(id);
  if (links.linked) {
    return c.json({ error: LINKED_DELETE_MSG, has_links: true, link_counts: links.counts }, 409);
  }
  try {
    hardDeleteProduct(id);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 409);
  }
  auditFromContext(c, {
    action: 'product.delete',
    entity: 'product',
    entityId: id,
    summary: `Товар удалён: ${(row as { name?: string }).name || id}`,
    before: row,
  });
  return c.json({ ok: true });
});

api.put('/products/:id/properties', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const id = c.req.param('id');
  const product = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    properties?: Array<{ property: string; value: string }>;
  }>();
  const list = Array.isArray(body.properties) ? body.properties : null;
  if (!list) return c.json({ error: 'properties required' }, 400);

  const before = all<{ property: string; value: string }>(
    `SELECT property, value FROM product_properties WHERE product_id = ? ORDER BY property`,
    [id]
  );
  const byProp = new Map(before.map((r) => [r.property, r]));
  for (const item of list) {
    const property = String(item.property || '').trim();
    if (!property) continue;
    const value = String(item.value ?? '').trim();
    const existing = byProp.get(property);
    if (existing) {
      run(`UPDATE product_properties SET value = ? WHERE product_id = ? AND property = ?`, [
        value,
        id,
        property,
      ]);
    } else {
      const rowId = newGuid();
      run(
        `INSERT INTO product_properties (id, product_id, property, value) VALUES (?, ?, ?, ?)`,
        [rowId, id, property, value]
      );
    }
  }
  const after = all<{ property: string; value: string }>(
    `SELECT property, value FROM product_properties WHERE product_id = ? ORDER BY property`,
    [id]
  );
  auditFromContext(c, {
    action: 'product.properties.update',
    entity: 'product',
    entityId: id,
    summary: `Характеристики обновлены: ${id}`,
    before,
    after,
  });
  return c.json({ ok: true, properties: after });
});

api.put('/products/:id/applicability', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав: редактирование номенклатуры' }, 403);
  }
  const id = c.req.param('id');
  const product = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{
    applicability?: Array<{
      id?: string;
      mark?: string;
      model?: string;
      only_model?: string;
      generation?: string;
      years?: string;
      _delete?: boolean;
    }>;
  }>();
  const list = Array.isArray(body.applicability) ? body.applicability : null;
  if (!list) return c.json({ error: 'applicability required' }, 400);

  const before = all(
    `SELECT id, mark, model, only_model, generation, years
     FROM product_applicability WHERE product_id = ? ORDER BY mark, model, years`,
    [id]
  );

  // Полная замена списка: у товара бывает несколько применимостей
  run('DELETE FROM product_applicability WHERE product_id = ?', [id]);
  for (const item of list) {
    if (item._delete) continue;
    const mark = String(item.mark || '').trim();
    const model = String(item.model || '').trim();
    const generation = String(item.generation || '').trim();
    const years = String(item.years || '').trim();
    const onlyModel = String(
      item.only_model != null && String(item.only_model).trim()
        ? item.only_model
        : model
          ? model.replace(/\s+[IVX]+(\s*\(.*\))?$/i, '').trim() || model
          : ''
    ).trim();
    if (!mark && !model && !onlyModel && !generation && !years) continue;
    const rowId = `${id}|${mark}|${model}|${onlyModel}|${generation}|${years}`;
    run(
      `INSERT OR IGNORE INTO product_applicability
        (id, product_id, mark, model, only_model, generation, years)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [rowId, id, mark, model, onlyModel, generation, years]
    );
  }

  const after = all(
    `SELECT id, mark, model, only_model, generation, years
     FROM product_applicability WHERE product_id = ? ORDER BY mark, model, years`,
    [id]
  );
  auditFromContext(c, {
    action: 'product.applicability.update',
    entity: 'product',
    entityId: id,
    summary: `Применимости: ${before.length} → ${after.length} у ${id}`,
    before,
    after,
  });
  return c.json({ ok: true, applicability: after });
});

api.put('/products/:id/prices', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_prices')) {
    return c.json({ error: 'Недостаточно прав: редактирование цен' }, 403);
  }
  const id = c.req.param('id');
  const product = get<{ id: string; name: string; sku: string }>(
    'SELECT id, name, sku FROM products WHERE id = ?',
    [id]
  );
  if (!product) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ prices?: Array<{ price_type: string; price: number }> }>();
  const prices = Array.isArray(body.prices) ? body.prices : [];
  if (!prices.length) return c.json({ error: 'prices[] required' }, 400);

  const before = all(
    'SELECT price_type, price FROM product_prices WHERE product_id = ? ORDER BY price_type',
    [id]
  );
  const beforeMap = new Map(before.map((p) => [String(p.price_type), Number(p.price)]));

  run('BEGIN');
  try {
    for (const p of prices) {
      const type = String(p.price_type || '').trim();
      const price = Number(p.price);
      if (!type || !Number.isFinite(price)) continue;
      const existing = get<{ id: string }>(
        'SELECT id FROM product_prices WHERE product_id = ? AND price_type = ? LIMIT 1',
        [id, type]
      );
      if (existing) {
        run('UPDATE product_prices SET price = ? WHERE id = ?', [price, existing.id]);
      } else {
        run(
          `INSERT INTO product_prices (id, product_id, price_type, price) VALUES (?, ?, ?, ?)`,
          [newGuid(), id, type, price]
        );
      }
    }
    run('COMMIT');
  } catch (e) {
    try {
      run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw e;
  }

  const after = all(
    'SELECT price_type, price FROM product_prices WHERE product_id = ? ORDER BY price_type',
    [id]
  );
  const changes: string[] = [];
  for (const p of after) {
    const t = String(p.price_type);
    const old = beforeMap.get(t);
    const neu = Number(p.price);
    if (old === undefined) changes.push(`${t}: (нет) → ${neu}`);
    else if (old !== neu) changes.push(`${t}: ${old} → ${neu}`);
  }
  auditFromContext(c, {
    action: 'price.change',
    entity: 'product',
    entityId: id,
    summary:
      `Цена изменена: ${product.name} (${product.sku})` +
      (changes.length ? ` — ${changes.join('; ')}` : ''),
    before,
    after,
  });
  return c.json({ ok: true, prices: after, changes });
});

/* ——— stock ——— */
api.get('/balances', (c) => {
  const warehouseId = c.req.query('warehouse_id');
  const productId = (c.req.query('product_id') || '').trim();
  const companyId = (c.req.query('company_id') || '').trim();
  const q = (c.req.query('q') || '').trim();
  const sort = (c.req.query('sort') || '').trim().toLowerCase();
  const dir = (c.req.query('dir') || 'asc').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const { page, limit, offset } = parsePage(c, 50);
  const where: string[] = ['x.qty != 0'];
  const params: Array<string | number> = [];
  if (warehouseId) {
    where.push('x.warehouse_id = ?');
    params.push(warehouseId);
  }
  {
    const coFilter = resolveListCompanyFilter(actorFromContext(c), companyId);
    if (coFilter.mode === 'none') {
      return c.json({ items: [], total: 0, page: 1, limit, pages: 1, totals: {} });
    }
    if (coFilter.mode === 'one') {
      where.push("IFNULL(w.company_id,'') = ?");
      params.push(coFilter.id);
    } else if (coFilter.mode === 'in') {
      where.push(`IFNULL(w.company_id,'') IN (${coFilter.ids.map(() => '?').join(',')})`);
      params.push(...coFilter.ids);
    }
  }
  if (productId) {
    where.push('x.product_id = ?');
    params.push(productId);
  }
  if (q) {
    const like = `%${q}%`;
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR IFNULL(p.code,\'\') LIKE ?)');
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // stock_balances приоритетнее; если по паре товар+склад нет движений — берём Get/Rests из 1С
  const from = `
    FROM (
      SELECT b.warehouse_id AS warehouse_id, b.product_id AS product_id, b.qty AS qty
      FROM stock_balances b
      WHERE b.qty != 0
      UNION ALL
      SELECT r.warehouse_id, r.product_id, r.qty
      FROM product_store_rests r
      WHERE r.qty != 0
        AND NOT EXISTS (
          SELECT 1 FROM stock_balances b2
          WHERE b2.product_id = r.product_id
            AND b2.warehouse_id = r.warehouse_id
            AND b2.qty != 0
        )
    ) x
    JOIN products p ON p.id = x.product_id
    JOIN warehouses w ON w.id = x.warehouse_id
    LEFT JOIN units u ON u.id = p.unit_id
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereSql}`;
  const reservedExpr = `IFNULL((
              SELECT SUM(sr.qty) FROM stock_reserves sr
              WHERE sr.product_id = x.product_id
                AND sr.reserve_warehouse_id = x.warehouse_id
                AND sr.status = 'active'
            ), 0)`;
  const kindExpr = `CASE WHEN IFNULL(p.item_kind,'product') = 'service' THEN 'service' ELSE 'product' END`;
  const orderMap: Record<string, string> = {
    qty: 'x.qty',
    sku: 'p.sku COLLATE NOCASE',
    name: 'p.name COLLATE NOCASE',
    warehouse: 'w.name COLLATE NOCASE',
    unit: "IFNULL(u.short_name,'') COLLATE NOCASE",
    category: "IFNULL(c.name,'') COLLATE NOCASE",
    kind: kindExpr,
    reserved: reservedExpr,
    marks: `(SELECT COUNT(*) FROM product_units pu
             WHERE pu.product_id = x.product_id
               AND pu.warehouse_id = x.warehouse_id
               AND pu.status IN ('in_stock', 'reserved'))`,
  };
  const orderBy = orderMap[sort]
    ? `${orderMap[sort]} ${dir}, p.name COLLATE NOCASE ASC`
    : `CASE WHEN w.code = 'WAIT-PAY' OR w.name = 'Ожидание оплаты' THEN 0 ELSE 1 END,
       w.name, p.name`;
  const total = get<{ c: number }>(`SELECT COUNT(*) AS c ${from}`, params)?.c ?? 0;
  const itemsRaw = all(
    `SELECT x.qty, p.id AS product_id, p.sku, p.name, w.id AS warehouse_id, w.name AS warehouse,
            w.code AS warehouse_code, IFNULL(u.short_name, '') AS unit,
            IFNULL(c.name, '') AS category,
            ${kindExpr} AS item_kind,
            CASE WHEN w.code = 'WAIT-PAY' OR w.name = 'Ожидание оплаты' THEN 1 ELSE 0 END AS is_reserve,
            ${reservedExpr} AS reserved_qty
     ${from}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const dmMap = dmCodesForBalanceRows(
    itemsRaw.map((r) => ({
      product_id: String((r as { product_id?: string }).product_id || ''),
      warehouse_id: String((r as { warehouse_id?: string }).warehouse_id || ''),
    }))
  );
  const items = itemsRaw.map((r) => {
    const row = r as {
      product_id: string;
      warehouse_id: string;
      [k: string]: unknown;
    };
    const bucket = dmMap.get(`${row.product_id}\0${row.warehouse_id}`);
    const codes = bucket?.codes || [];
    const dmTotal = bucket?.total || 0;
    return {
      ...row,
      dm_codes: codes,
      dm_count: dmTotal,
      dm_more: Math.max(0, dmTotal - codes.length),
    };
  });
  const qtySums = get<{ qty: number; reserved: number }>(
    `SELECT COALESCE(SUM(x.qty), 0) AS qty,
            COALESCE(SUM((
              SELECT COALESCE(SUM(sr.qty), 0) FROM stock_reserves sr
              WHERE sr.product_id = x.product_id
                AND sr.reserve_warehouse_id = x.warehouse_id
                AND sr.status = 'active'
            )), 0) AS reserved
     ${from}`,
    params
  );
  let valuePurchase = 0;
  let valueRetail = 0;
  try {
    const val = stockValuation({
      warehouseId: warehouseId || undefined,
      q: q || undefined,
      includeItems: false,
      page: 1,
      limit: 1,
    });
    valuePurchase = Number(val.total_value_purchase ?? val.total_value) || 0;
    valueRetail = Number(val.total_value_retail) || 0;
  } catch {
    /* оценка необязательна для списка */
  }
  return c.json({
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    sort: sort || null,
    dir: sort ? dir.toLowerCase() : null,
    totals: {
      lines: total,
      qty: Number(qtySums?.qty) || 0,
      reserved_qty: Number(qtySums?.reserved) || 0,
      value_purchase: valuePurchase,
      value_retail: valueRetail,
    },
  });
});

/** Стоимость склада: FIFO по ценам приходных (не себестоимость 1С). */
api.get('/stock/valuation', (c) => {
  const warehouseId = (c.req.query('warehouse_id') || '').trim() || undefined;
  const q = (c.req.query('q') || '').trim() || undefined;
  const { page, limit } = parsePage(c, 50);
  const itemsParam = (c.req.query('items') || '').trim().toLowerCase();
  const includeItems = !(itemsParam === '0' || itemsParam === 'false' || itemsParam === 'no');
  return c.json(
    stockValuation({
      warehouseId,
      q,
      page,
      limit,
      includeItems,
    })
  );
});

/** Остаток номенклатуры, разложенный по приходам (FIFO-слои). */
api.get('/products/:id/inbound-layers', (c) => {
  const id = c.req.param('id');
  const product = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  return c.json(productInboundLayers(id));
});

/** История закупок номенклатуры: все строки приходных (поставщик, дата, qty, цена). */
api.get('/products/:id/purchase-history', (c) => {
  const id = c.req.param('id');
  const product = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  const limitRaw = Number(c.req.query('limit') || 50);
  return c.json(productPurchaseHistory(id, limitRaw));
});

api.get('/docs', (c) => {
  const type = (c.req.query('type') || '').trim();
  const q = (c.req.query('q') || '').trim();
  const dealId = (c.req.query('deal_id') || '').trim();
  const companyId = (c.req.query('company_id') || '').trim();
  const sort = (c.req.query('sort') || 'date').trim();
  const dir = (c.req.query('dir') || 'desc').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const { page, limit, offset } = parsePage(c, 50);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (type === 'in' || type === 'out' || type === 'transfer' || type === 'return') {
    where.push('d.doc_type = ?');
    params.push(type);
  }
  if (dealId) {
    where.push(`(IFNULL(d.deal_id,'') = ? OR IFNULL(d.basis_order_id,'') = ?)`);
    params.push(dealId, dealId);
  }
  {
    const coFilter = resolveListCompanyFilter(actorFromContext(c), companyId);
    if (coFilter.mode === 'none') {
      return c.json({ items: [], total: 0, page: 1, limit, pages: 1 });
    }
    if (coFilter.mode === 'one') {
      where.push(
        `(IFNULL(w.company_id,'') = ? OR IFNULL(wt.company_id,'') = ? OR IFNULL(o.company_id,'') = ?)`
      );
      params.push(coFilter.id, coFilter.id, coFilter.id);
    } else if (coFilter.mode === 'in') {
      const ph = coFilter.ids.map(() => '?').join(',');
      where.push(
        `(IFNULL(w.company_id,'') IN (${ph}) OR IFNULL(wt.company_id,'') IN (${ph}) OR IFNULL(o.company_id,'') IN (${ph}))`
      );
      params.push(...coFilter.ids, ...coFilter.ids, ...coFilter.ids);
    }
  }
  if (q) {
    where.push('(d.number LIKE ? OR IFNULL(c.name,"") LIKE ? OR IFNULL(w.name,"") LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderMap: Record<string, string> = {
    number: `d.number ${dir}`,
    type: `d.doc_type ${dir}, d.doc_date DESC`,
    date: `d.doc_date ${dir}, d.number ${dir}`,
    counterparty: `IFNULL(c.name,'') ${dir}, d.doc_date DESC`,
    warehouse: `IFNULL(w.name,'') ${dir}, d.doc_date DESC`,
    amount: `d.amount ${dir}, d.doc_date DESC`,
    status: `d.posted ${dir}, d.doc_date DESC`,
  };
  const orderBy = orderMap[sort] || orderMap.date;
  const docsFrom = `
       FROM stock_docs d
       LEFT JOIN warehouses w ON w.id = d.warehouse_id
       LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
       LEFT JOIN counterparties c ON c.id = d.counterparty_id
       LEFT JOIN organizations o ON o.id = d.organization_id
       ${whereSql}`;
  const total =
    get<{ c: number }>(`SELECT COUNT(*) AS c ${docsFrom}`, params)?.c ?? 0;
  const items = all(
    `SELECT d.*, w.name AS warehouse, wt.name AS warehouse_to, c.name AS counterparty,
            IFNULL(o.name,'') AS organization_name
     ${docsFrom}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return c.json({
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

api.get('/docs/:id', async (c) => {
  const id = c.req.param('id');
  const existing = get<{ doc_type: string; deal_id: string; basis_order_id: string }>(
    `SELECT doc_type, IFNULL(deal_id,'') AS deal_id, IFNULL(basis_order_id,'') AS basis_order_id
     FROM stock_docs WHERE id = ?`,
    [id]
  );
  if (!existing) return c.json({ error: 'not found' }, 404);
  // Нет номера сделки Amo — пробуем comment / УПД / марки / OData / парную продажу
  if (existing.doc_type === 'out' && !String(existing.deal_id || '').trim()) {
    try {
      await enrichOutDocBasis(id);
    } catch {
      /* открытие карточки не должно падать из‑за OData */
    }
  }
  // Заказ покупателя в Учёте = сделка Amo; подтянуть, если ещё нет в зеркале
  const dealIdNow = String(
    get<{ deal_id: string }>(
      `SELECT IFNULL(deal_id,'') AS deal_id FROM stock_docs WHERE id = ?`,
      [id]
    )?.deal_id ||
      existing.deal_id ||
      ''
  ).trim();
  if (dealIdNow && !get('SELECT id FROM crm_deals WHERE id = ?', [dealIdNow])) {
    try {
      syncDealsFromAmo1c({ dealId: dealIdNow });
    } catch (e) {
      console.warn('docs/:id ensure deal', dealIdNow, e instanceof Error ? e.message : e);
    }
  }
  const doc = get(
    `SELECT d.*, w.name AS warehouse, wt.name AS warehouse_to, c.name AS counterparty,
            IFNULL(c.inn,'') AS counterparty_inn,
            IFNULL(c.party_kind,'') AS counterparty_party_kind,
            IFNULL(c.phone,'') AS counterparty_phone,
            IFNULL(c.kpp,'') AS counterparty_kpp,
            IFNULL(c.ogrn,'') AS counterparty_ogrn,
            IFNULL(c.address,'') AS counterparty_address,
            IFNULL(c.name_full,'') AS counterparty_name_full,
            IFNULL(c.email,'') AS counterparty_email,
            IFNULL(c.kind,'') AS counterparty_kind,
            IFNULL(o.name,'') AS organization_name,
            IFNULL(o.short_name,'') AS organization_short_name,
            IFNULL(o.inn,'') AS organization_inn,
            IFNULL(o.kpp,'') AS organization_kpp,
            IFNULL(o.ogrnip,'') AS organization_ogrnip,
            IFNULL(o.address,'') AS organization_address,
            IFNULL(o.phone,'') AS organization_phone,
            IFNULL(o.bank,'') AS organization_bank,
            IFNULL(o.bik,'') AS organization_bik,
            IFNULL(o.rs,'') AS organization_rs,
            IFNULL(o.ks,'') AS organization_ks,
            IFNULL(o.director,'') AS organization_director,
            IFNULL(o.vat_rate,0) AS organization_vat_rate,
            IFNULL(o.is_default,0) AS organization_is_default,
            IFNULL(deal.name,'') AS deal_name,
            IFNULL(deal.status_name,'') AS deal_status_name,
            IFNULL(deal.price,0) AS deal_price,
            IFNULL(deal.amo_url,'') AS deal_amo_url
     FROM stock_docs d
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     LEFT JOIN warehouses wt ON wt.id = d.warehouse_to_id
     LEFT JOIN counterparties c ON c.id = d.counterparty_id
     LEFT JOIN organizations o ON o.id = d.organization_id
     LEFT JOIN crm_deals deal ON deal.id = NULLIF(TRIM(IFNULL(d.deal_id,'')), '')
     WHERE d.id = ?`,
    [id]
  );
  if (!doc) return c.json({ error: 'not found' }, 404);
  const lines = all(
    `SELECT l.*, p.sku, p.name AS product_name,
            IFNULL(p.serial_tracked, 0) AS serial_tracked,
            IFNULL(p.item_kind,'product') AS item_kind_raw,
            IFNULL(u.short_name,'') AS unit,
            IFNULL(lw.name, IFNULL(w.name, '')) AS warehouse,
            COALESCE(NULLIF(TRIM(IFNULL(l.warehouse_id,'')), ''), d.warehouse_id) AS warehouse_id_effective
     FROM stock_doc_lines l
     JOIN stock_docs d ON d.id = l.doc_id
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN units u ON u.id = p.unit_id
     LEFT JOIN warehouses lw ON lw.id = NULLIF(TRIM(IFNULL(l.warehouse_id,'')), '')
     LEFT JOIN warehouses w ON w.id = d.warehouse_id
     WHERE l.doc_id = ?
     ORDER BY l.line_no, p.name`,
    [id]
  ).map((l) => {
    const row = l as Record<string, unknown>;
    const serials = parseSerialsJson(String(row.serials_json || '[]'));
    const productId = String(row.product_id || '');
    const looksService = isServiceProduct(productId);
    const item_kind = looksService ? 'service' : 'product';
    return {
      ...row,
      serials,
      item_kind,
      writes_off_stock: item_kind !== 'service',
    };
  });
  const allMapped = lines;
  const goodsLines = allMapped.filter((l) => (l as { item_kind?: string }).item_kind !== 'service');
  const serviceLines = allMapped.filter((l) => (l as { item_kind?: string }).item_kind === 'service');
  const units = unitsForDoc(id);
  const { links, note: links_note } = buildDocLinks(id);
  const isOut = String((doc as { doc_type?: string }).doc_type || '') === 'out';
  // Расходные в UI — только товары (услуги живут в заказе / УПД)
  const visibleLines = isOut ? goodsLines : allMapped;
  return c.json({
    ...doc,
    lines: visibleLines,
    units,
    links,
    links_note,
    goods_lines_count: goodsLines.length,
    service_lines_count: serviceLines.length,
    services_omitted: isOut ? serviceLines.length : 0,
    writes_off_stock: goodsLines.length > 0,
  });
});

/** Привязать заказ покупателя (сделку Amo) к расходной. */
api.patch('/docs/:id/deal', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { deal_id?: string };
  try {
    const result = setOutDocDeal(c.req.param('id'), String(body.deal_id || ''));
    if (!get('SELECT id FROM crm_deals WHERE id = ?', [result.deal_id])) {
      try {
        syncDealsFromAmo1c({ dealId: result.deal_id });
      } catch (e) {
        console.warn(
          'docs/:id/deal ensure deal',
          result.deal_id,
          e instanceof Error ? e.message : e
        );
      }
    }
    auditFromContext(c, {
      action: 'doc.link_deal',
      entity: 'stock_doc',
      entityId: c.req.param('id'),
      summary: `Расходная привязана к заказу покупателя ${result.deal_id}`,
      after: result,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.post('/docs', async (c) => {
  const body = await c.req.json<{
    doc_type: DocType;
    warehouse_id: string;
    warehouse_to_id?: string;
    counterparty_id?: string;
    comment?: string;
    organization_id?: string;
    deal_id?: string;
    basis_order_id?: string;
    source_supplier_order_id?: string;
    serials_optional?: boolean;
    lines: Array<{
      product_id: string;
      qty: number;
      price?: number;
      serials?: string[] | string;
      warehouse_id?: string;
      apps?: unknown;
    }>;
    post?: boolean;
  }>();
  if (body.doc_type === 'out' && !String(body.deal_id || '').trim()) {
    return c.json(
      { error: 'Расходная создаётся на основании заказа покупателя — укажите номер заказа' },
      400
    );
  }
  try {
    const id = createDocument({
      ...body,
      lines: (body.lines || []).map((l) => ({
        ...l,
        price: l.price,
        apps: l.apps as string | undefined,
      })),
    });
    const doc = get('SELECT * FROM stock_docs WHERE id = ?', [id]);
    auditFromContext(c, {
      action: 'doc.create',
      entity: 'stock_doc',
      entityId: id,
      summary: `Документ ${body.doc_type}: ${doc?.number || id}, строк ${body.lines?.length || 0}`,
      after: doc,
    });
    return c.json(doc, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.post('/docs/marks/preview', async (c) => {
  let body: { count?: number; prefix?: string } = {};
  try {
    body = (await c.req.json()) as { count?: number; prefix?: string };
  } catch {
    body = {};
  }
  try {
    return c.json(previewStockMarks(body));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.post('/docs/:id/datamatrix/allocate', async (c) => {
  let body: { prefix?: string; force?: boolean } = {};
  try {
    body = (await c.req.json()) as { prefix?: string; force?: boolean };
  } catch {
    body = {};
  }
  try {
    const row = allocateStockDocDatamatrix(c.req.param('id'), {
      prefix: body.prefix,
      force: !!body.force,
    });
    auditFromContext(c, {
      action: 'doc.marks.allocate',
      entity: 'stock_doc',
      entityId: c.req.param('id'),
      summary: `Марки: +${row.dm_created} (префикс ${row.dm_prefix})`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/docs/:id/datamatrix/labels.html', (c) => {
  try {
    return c.html(stockDocDmLabelsHtml(c.req.param('id')));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/docs/:id/datamatrix/labels.pdf', async (c) => {
  try {
    const id = c.req.param('id');
    const buf = await stockDocDmLabelsPdf(id);
    const num = get<{ number: string }>('SELECT number FROM stock_docs WHERE id = ?', [id])?.number || 'dm';
    const asciiName = `dm-${String(num).replace(/[^\x20-\x7E]+/g, '_')}.pdf`;
    c.header('Content-Type', 'application/pdf');
    c.header(
      'Content-Disposition',
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(`dm-${num}.pdf`)}`
    );
    c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(buf));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/docs/:id/datamatrix/excel.csv', (c) => {
  try {
    const id = c.req.param('id');
    const csv = stockDocDmExcelCsv(id);
    const num = get<{ number: string }>('SELECT number FROM stock_docs WHERE id = ?', [id])?.number || 'dm';
    const asciiName = `dm-${String(num).replace(/[^\x20-\x7E]+/g, '_')}.csv`;
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(`dm-${num}.csv`)}`
    );
    return c.body(csv);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/product-units', (c) => {
  const productId = (c.req.query('product_id') || '').trim();
  const warehouseId = (c.req.query('warehouse_id') || '').trim();
  const status = (c.req.query('status') || '').trim();
  const supplierId = c.req.query('supplier_id');
  const inDocId = c.req.query('in_doc_id');
  const q = (c.req.query('q') || '').trim();
  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 50) || 50, 1), 200);
  const { items, total } = listProductUnits({
    productId: productId || undefined,
    warehouseId: warehouseId || undefined,
    status: status || undefined,
    supplierId: supplierId != null ? String(supplierId) : undefined,
    inDocId: inDocId != null ? String(inDocId) : undefined,
    q: q || undefined,
    limit,
    offset: (page - 1) * limit,
  });
  return c.json({
    items,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    status_labels: UNIT_STATUS_RU,
  });
});

/** История экземпляра по Data Matrix / серийнику. */
api.get('/product-units/trace', (c) => {
  const serial = (c.req.query('serial') || c.req.query('code') || '').trim();
  if (!serial) return c.json({ error: 'Укажите serial' }, 400);
  const data = traceSerial(serial);
  if (!data.found) return c.json({ ...data, error: 'Код не найден' }, 404);
  return c.json(data);
});

api.get('/product-units/trace/:code', (c) => {
  let serial = '';
  try {
    serial = decodeURIComponent(c.req.param('code') || '').trim();
  } catch {
    serial = String(c.req.param('code') || '').trim();
  }
  if (!serial) return c.json({ error: 'Укажите код' }, 400);
  const data = traceSerial(serial);
  if (!data.found) return c.json({ ...data, error: 'Код не найден' }, 404);
  return c.json(data);
});

api.get('/product-units/sources', (c) => {
  const productId = (c.req.query('product_id') || '').trim();
  const warehouseId = (c.req.query('warehouse_id') || '').trim();
  if (!productId) return c.json({ error: 'product_id required' }, 400);
  const forDeal = (c.req.query('for_deal') || '').trim() === '1';
  if (forDeal) {
    return c.json(
      listDealLineSources({ productId, warehouseId: warehouseId || undefined })
    );
  }
  return c.json(listUnitSources({ productId, warehouseId: warehouseId || undefined }));
});

api.get('/products/:id/units', (c) => {
  const id = c.req.param('id');
  const status = (c.req.query('status') || '').trim();
  const { items, total } = listProductUnits({
    productId: id,
    status: status || undefined,
    limit: 200,
    offset: 0,
  });
  return c.json({ items, total, status_labels: UNIT_STATUS_RU });
});

/** Ручная регистрация экземпляров на остатке (без документа) — инвентаризация / набивка. */
api.post('/product-units', async (c) => {
  const body = await c.req.json<{
    product_id?: string;
    warehouse_id?: string;
    serials?: string[] | string;
    comment?: string;
    apps?: unknown;
    supplier_id?: string;
  }>();
  const productId = String(body.product_id || '').trim();
  const warehouseId = String(body.warehouse_id || '').trim();
  const serials = normalizeSerials(body.serials);
  if (!productId || !warehouseId || !serials.length) {
    return c.json({ error: 'Нужны product_id, warehouse_id и серийные номера' }, 400);
  }
  if (!get('SELECT id FROM products WHERE id = ?', [productId])) {
    return c.json({ error: 'Товар не найден' }, 404);
  }
  if (!get('SELECT id FROM warehouses WHERE id = ?', [warehouseId])) {
    return c.json({ error: 'Склад не найден' }, 404);
  }
  try {
    receiveUnits({
      productId,
      warehouseId,
      serials,
      docId: '',
      lineId: '',
      apps: body.apps as string | undefined,
      supplierId: String(body.supplier_id || '').trim() || undefined,
    });
    // qty-остаток не трогаем автоматически при ручной набивке — только реестр экземпляров
    run('UPDATE products SET serial_tracked = 1 WHERE id = ?', [productId]);
    return c.json({ ok: true, count: serials.length }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Применимость партии у экземпляра (куда годится именно эта штука). Пустой массив = как в каталоге. */
api.patch('/product-units/apps', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    serial?: string;
    apps?: unknown;
  };
  const serial = String(body.serial || '').trim();
  if (!serial) return c.json({ error: 'Укажите serial' }, 400);
  try {
    const row = setUnitApps(serial, parseAppsJson(body.apps));
    auditFromContext(c, {
      action: 'product_unit.set_apps',
      entity: 'product_unit',
      entityId: serial,
      summary: `Применимость партии ${serial}: ${row.apps_label}`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Дефолт применимости «поставщик × товар» (подставляется при приходе, если в строке не задано). */
api.get('/supplier-product-apps', (c) => {
  const productId = (c.req.query('product_id') || '').trim();
  const supplierId = (c.req.query('supplier_id') || '').trim();
  if (!productId || !supplierId) {
    return c.json({ error: 'Нужны product_id и supplier_id' }, 400);
  }
  const apps = getSupplierProductApps(productId, supplierId);
  return c.json({ product_id: productId, supplier_id: supplierId, apps });
});

api.put('/supplier-product-apps', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    product_id?: string;
    supplier_id?: string;
    apps?: unknown;
    comment?: string;
  };
  try {
    const row = setSupplierProductApps(
      String(body.product_id || ''),
      String(body.supplier_id || ''),
      parseAppsJson(body.apps),
      body.comment
    );
    auditFromContext(c, {
      action: 'supplier_product_apps.set',
      entity: 'supplier_product_apps',
      entityId: `${row.product_id}:${row.supplier_id}`,
      summary: `Применимость поставщика×товар`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

const FEEDBACK_KINDS = new Set(['idea', 'bug']);
const FEEDBACK_STATUSES = new Set(['new', 'planned', 'done', 'rejected']);

api.get('/feedback', (c) => {
  const status = (c.req.query('status') || '').trim();
  if (status && FEEDBACK_STATUSES.has(status)) {
    return c.json(
      all(
        `SELECT * FROM feedback_items WHERE status = ? ORDER BY datetime(created_at) DESC LIMIT 200`,
        [status]
      )
    );
  }
  return c.json(all(`SELECT * FROM feedback_items ORDER BY datetime(created_at) DESC LIMIT 200`));
});

api.post('/feedback', async (c) => {
  const body = await c.req.json<{
    kind?: string;
    title?: string;
    body?: string;
    author?: string;
  }>();
  const kind = (body.kind || 'idea').trim();
  const title = (body.title || '').trim();
  const text = (body.body || '').trim();
  const author = (body.author || '').trim().slice(0, 120);
  if (!FEEDBACK_KINDS.has(kind)) {
    return c.json({ error: 'kind: idea или bug' }, 400);
  }
  if (!title) {
    return c.json({ error: 'Укажите заголовок' }, 400);
  }
  if (title.length > 200) {
    return c.json({ error: 'Заголовок слишком длинный (макс. 200)' }, 400);
  }
  if (text.length > 5000) {
    return c.json({ error: 'Текст слишком длинный (макс. 5000)' }, 400);
  }
  const id = newGuid();
  run(
    `INSERT INTO feedback_items (id, kind, title, body, author, status) VALUES (?, ?, ?, ?, ?, 'new')`,
    [id, kind, title, text, author]
  );
  const row = get('SELECT * FROM feedback_items WHERE id = ?', [id]);
  auditFromContext(c, {
    action: 'feedback.create',
    entity: 'feedback',
    entityId: id,
    summary: `${kind}: ${title}`,
    after: row,
  });
  return c.json(row, 201);
});

api.patch('/feedback/:id', async (c) => {
  const id = c.req.param('id');
  const existing = get('SELECT * FROM feedback_items WHERE id = ?', [id]);
  if (!existing) return c.json({ error: 'Не найдено' }, 404);
  const body = await c.req.json<{ status?: string }>();
  const status = (body.status || '').trim();
  if (!FEEDBACK_STATUSES.has(status)) {
    return c.json({ error: 'status: new | planned | done | rejected' }, 400);
  }
  run(`UPDATE feedback_items SET status = ? WHERE id = ?`, [status, id]);
  auditFromContext(c, {
    action: 'feedback.status',
    entity: 'feedback',
    entityId: id,
    summary: `Идея/ошибка «${existing.title}»: ${existing.status} → ${status}`,
    before: { status: existing.status },
    after: { status },
  });
  return c.json(get('SELECT * FROM feedback_items WHERE id = ?', [id]));
});

/* ——— Маркировка / партии / DataMatrix (Этапы 4–5) ——— */

api.get('/marking/meta', (c) => c.json(markingMeta()));

api.get('/marking/parse-label', (c) => {
  const raw = (c.req.query('raw') || '').trim();
  return c.json(parseMarkingLabel(raw));
});

api.get('/lots', (c) => {
  return c.json(
    listLots({
      product_id: (c.req.query('product_id') || '').trim() || undefined,
      warehouse_id: (c.req.query('warehouse_id') || '').trim() || undefined,
      status: (c.req.query('status') || '').trim() || undefined,
      q: (c.req.query('q') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 100) || 100,
    })
  );
});

api.post('/lots', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{
    product_id?: string;
    lot_number?: string;
    factory?: string;
    production_date?: string;
    arrived_at?: string;
    warehouse_id?: string;
    gtin?: string;
    qty_planned?: number;
    status?: string;
    comment?: string;
  }>();
  try {
    const lot = createLot({
      product_id: String(body.product_id || ''),
      lot_number: String(body.lot_number || ''),
      factory: body.factory,
      production_date: body.production_date,
      arrived_at: body.arrived_at,
      warehouse_id: body.warehouse_id,
      gtin: body.gtin,
      qty_planned: body.qty_planned,
      status: body.status as 'draft' | 'in_transit' | 'received' | 'closed' | undefined,
      comment: body.comment,
      actor_id: actor?.id,
    });
    auditFromContext(c, {
      action: 'lot.create',
      entity: 'product_lot',
      entityId: lot.id,
      summary: `Партия ${lot.lot_number}`,
      after: lot,
    });
    return c.json(lot, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'lot create failed' }, 400);
  }
});

api.get('/lots/:id', (c) => {
  const id = c.req.param('id');
  const lot = get(
    `SELECT l.*, p.sku AS product_sku, p.name AS product_name, w.name AS warehouse_name
     FROM product_lots l
     LEFT JOIN products p ON p.id = l.product_id
     LEFT JOIN warehouses w ON w.id = l.warehouse_id
     WHERE l.id = ?`,
    [id]
  );
  if (!lot) return c.json({ error: 'not found' }, 404);
  const codes = listCodes({ lot_id: id, limit: 500 });
  return c.json({ ...lot, codes });
});

api.get('/marking/codes', (c) => {
  return c.json(
    listCodes({
      product_id: (c.req.query('product_id') || '').trim() || undefined,
      lot_id: (c.req.query('lot_id') || '').trim() || undefined,
      status: (c.req.query('status') || '').trim() || undefined,
      deal_id: (c.req.query('deal_id') || '').trim() || undefined,
      q: (c.req.query('q') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 100) || 100,
    })
  );
});

api.post('/marking/codes', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{
    code?: string;
    product_id?: string;
    lot_id?: string;
    warehouse_id?: string;
    status?: string;
  }>();
  try {
    const row = registerCode({
      code: String(body.code || ''),
      product_id: String(body.product_id || ''),
      lot_id: body.lot_id,
      warehouse_id: body.warehouse_id,
      status: body.status as import('./marking.js').DmStatus | undefined,
      actor_id: actor?.id,
    });
    return c.json(row, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'register failed' }, 400);
  }
});

api.post('/marking/scan', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{
    code?: string;
    action?: 'receive' | 'sale' | 'withdraw' | 'return' | 'defect';
    product_id?: string;
    lot_id?: string;
    warehouse_id?: string;
    deal_id?: string;
    stock_doc_id?: string;
  }>();
  try {
    const result = scanCode({
      code: String(body.code || ''),
      action: body.action || 'receive',
      product_id: body.product_id,
      lot_id: body.lot_id,
      warehouse_id: body.warehouse_id,
      deal_id: body.deal_id,
      stock_doc_id: body.stock_doc_id,
      actor_id: actor?.id,
    });
    auditFromContext(c, {
      action: `marking.scan.${body.action || 'receive'}`,
      entity: 'datamatrix',
      entityId: result.code.id,
      summary: `Скан ${body.action || 'receive'}: ${String(body.code || '').slice(0, 24)}…`,
      after: result.code,
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'scan failed' }, 400);
  }
});

api.post('/marking/aggregate', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{ codes?: string[]; parent_code?: string }>();
  try {
    const result = createAggregate({
      codes: Array.isArray(body.codes) ? body.codes : [],
      parent_code: body.parent_code,
      actor_id: actor?.id,
    });
    return c.json(result, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'aggregate failed' }, 400);
  }
});

api.get('/products/:id/marking', (c) => {
  const id = c.req.param('id');
  const product = get('SELECT id FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  return c.json(productMarkingSummary(id));
});

api.patch('/products/:id/marking-flags', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_products')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const id = c.req.param('id');
  const product = get('SELECT id, gtin, requires_marking FROM products WHERE id = ?', [id]);
  if (!product) return c.json({ error: 'not found' }, 404);
  const body = await c.req.json<{ gtin?: string; requires_marking?: boolean | number }>();
  if (body.gtin !== undefined) {
    run('UPDATE products SET gtin = ? WHERE id = ?', [String(body.gtin).trim(), id]);
  }
  if (body.requires_marking !== undefined) {
    run('UPDATE products SET requires_marking = ? WHERE id = ?', [
      body.requires_marking ? 1 : 0,
      id,
    ]);
  }
  return c.json(
    get(
      `SELECT id, sku, name, IFNULL(gtin,'') AS gtin, IFNULL(requires_marking,0) AS requires_marking
       FROM products WHERE id = ?`,
      [id]
    )
  );
});

/* ——— Э1: задания склада ——— */

api.get('/warehouse/tasks/meta', (c) =>
  c.json({
    statuses: TASK_STATUSES,
    status_labels: Object.fromEntries(TASK_STATUSES.map((s) => [s, statusLabel(s)])),
    channels: SHIP_CHANNELS,
    channel_labels: Object.fromEntries(SHIP_CHANNELS.map((ch) => [ch, channelLabel(ch)])),
  })
);

/** КПД склада: avg / P50 / P90 по этапам created→picked→packed→handed. */
api.get('/warehouse/tasks/kpd', (c) => {
  return c.json(
    tasksKpdReport({
      days: Number(c.req.query('days') || 14) || 14,
      limit: Number(c.req.query('limit') || 200) || 200,
    })
  );
});

api.get('/warehouse/tasks', (c) => {
  return c.json(
    listTasks({
      status: (c.req.query('status') || '').trim() || undefined,
      q: (c.req.query('q') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 80) || 80,
    })
  );
});

api.get('/warehouse/tasks/:id', (c) => {
  const row = getTask(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

api.get('/warehouse/tasks/:id/slip', (c) => {
  try {
    return c.json(packingSlip(c.req.param('id')));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'slip failed' }, 404);
  }
});

api.post('/warehouse/tasks/from-deal', async (c) => {
  const actor = actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) || actor?.role === 'courier') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{
    deal_id?: string;
    channel?: string;
    payment_required?: boolean;
    comment?: string;
  }>();
  try {
    const task = createTaskFromDeal({
      deal_id: String(body.deal_id || ''),
      channel: body.channel,
      payment_required: body.payment_required,
      comment: body.comment,
      actor_id: actor?.id,
    });
    try {
      ensureOrderDocChain(String(body.deal_id || ''));
    } catch {
      /* */
    }
    auditFromContext(c, {
      action: 'warehouse_task.create',
      entity: 'warehouse_task',
      entityId: String(task?.id || ''),
      summary: `Задание складу ${task?.number} по заказу ${body.deal_id}`,
      after: task,
    });
    return c.json(task, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

api.patch('/warehouse/tasks/:id/status', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor)) {
    return c.json({ error: 'Недостаточно прав: задания склада' }, 403);
  }
  const body = await c.req.json<{ status?: string; track_number?: string; block_reason?: string }>();
  try {
    assertPickShiftForOps(actor);
    const row = setTaskStatus({
      id: c.req.param('id'),
      status: body.status as import('./warehouse-tasks.js').TaskStatus,
      track_number: body.track_number,
      block_reason: body.block_reason,
      actor_id: actor.id,
    });
    touchPickShiftActivity(actor.id);
    let dealPromote: Awaited<ReturnType<typeof promoteDealToSuccessAfterHanded>> | null = null;
    if (String((row as { status?: string } | null)?.status) === 'handed') {
      dealPromote = await promoteDealToSuccessAfterHanded({
        dealId: String((row as { deal_id?: string }).deal_id || ''),
        taskId: c.req.param('id'),
      });
      if (dealPromote.ok && !dealPromote.skipped) {
        auditFromContext(c, {
          action: 'crm.deal_stage_auto',
          entity: 'crm_deal',
          entityId: String((row as { deal_id?: string }).deal_id || ''),
          summary: `Авто этап «${dealPromote.status_name}» после отгрузки/выдачи`,
          after: dealPromote,
        });
      }
    }
    auditFromContext(c, {
      action: 'warehouse_task.status',
      entity: 'warehouse_task',
      entityId: c.req.param('id'),
      summary: `Задание → ${body.status}${body.block_reason ? ' · ' + body.block_reason : ''}`,
      after: { status: body.status, block_reason: body.block_reason, deal_promote: dealPromote },
    });
    return c.json({ ...row, deal_promote: dealPromote });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'status failed' }, 400);
  }
});

api.post('/warehouse/tasks/scan-hand', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor)) {
    return c.json({ error: 'Недостаточно прав: задания склада' }, 403);
  }
  const body = await c.req.json<{ barcode?: string }>();
  try {
    const row = scanHandOver({ barcode: String(body.barcode || ''), actor_id: actor.id });
    const dealPromote = await promoteDealToSuccessAfterHanded({
      dealId: String((row as { deal_id?: string } | null)?.deal_id || ''),
      taskId: String((row as { id?: string } | null)?.id || ''),
    });
    if (dealPromote.ok && !dealPromote.skipped) {
      auditFromContext(c, {
        action: 'crm.deal_stage_auto',
        entity: 'crm_deal',
        entityId: String((row as { deal_id?: string } | null)?.deal_id || ''),
        summary: `Авто этап «${dealPromote.status_name}» после скана выдачи`,
        after: dealPromote,
      });
    }
    return c.json({ ...row, deal_promote: dealPromote });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'scan failed' }, 400);
  }
});

/** Скан на /pick: «Сделал» по штрихкоду / номеру задания. */
api.post('/warehouse/tasks/scan-done', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor)) {
    return c.json({ error: 'Недостаточно прав: задания склада' }, 403);
  }
  const body = await c.req.json<{ barcode?: string }>();
  try {
    assertPickShiftForOps(actor);
    const row = scanMarkDone({ barcode: String(body.barcode || ''), actor_id: actor.id });
    touchPickShiftActivity(actor.id);
    let dealPromote: Awaited<ReturnType<typeof promoteDealToSuccessAfterHanded>> | null = null;
    if (String((row as { status?: string } | null)?.status) === 'handed') {
      dealPromote = await promoteDealToSuccessAfterHanded({
        dealId: String((row as { deal_id?: string } | null)?.deal_id || ''),
        taskId: String((row as { id?: string } | null)?.id || ''),
      });
      if (dealPromote.ok && !dealPromote.skipped) {
        auditFromContext(c, {
          action: 'crm.deal_stage_auto',
          entity: 'crm_deal',
          entityId: String((row as { deal_id?: string } | null)?.deal_id || ''),
          summary: `Авто этап «${dealPromote.status_name}» после скана «Сделал»`,
          after: dealPromote,
        });
      }
    }
    auditFromContext(c, {
      action: 'warehouse_task.status',
      entity: 'warehouse_task',
      entityId: String((row as { id?: string } | null)?.id || ''),
      summary: `Скан сделано → ${(row as { status?: string } | null)?.status || ''}`,
      after: {
        status: (row as { status?: string } | null)?.status,
        number: (row as { number?: string } | null)?.number,
        deal_promote: dealPromote,
      },
    });
    return c.json({ ...row, deal_promote: dealPromote });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'scan failed' }, 400);
  }
});

api.post('/crm/deals/:id/warehouse-task', async (c) => {
  const actor = actorFromContext(c);
  if (!canOperateWarehouseTasks(actor) || actor?.role === 'courier') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<{ channel?: string; comment?: string }>().catch(() => ({}));
  try {
    const dealId = c.req.param('id');
    const task = createTaskFromDeal({
      deal_id: dealId,
      channel: (body as { channel?: string }).channel,
      comment: (body as { comment?: string }).comment,
      actor_id: actor?.id,
    });
    try {
      ensureOrderDocChain(dealId);
    } catch {
      /* */
    }
    auditFromContext(c, {
      action: 'deal.warehouse_task',
      entity: 'crm_deal',
      entityId: dealId,
      summary: `Задание склада ${(task as { number?: string }).number || ''} по заказу ${dealId}`,
      after: { task_id: (task as { id?: string }).id, number: (task as { number?: string }).number },
    });
    return c.json(task, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'create failed' }, 400);
  }
});

/* ——— Э1: дашборд дня / СДЭК / зеркало Доход ——— */

api.get('/ops/dashboard', (c) => c.json(opsDashboard()));

api.get('/ops/income', (c) => {
  return c.json(
    listIncomeMirror({
      q: (c.req.query('q') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 80) || 80,
    })
  );
});

api.get('/ops/cdek-url', (c) => {
  const dealId = (c.req.query('deal_id') || c.req.query('lead_id') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  return c.json({
    url: cdekWidgetUrl(dealId),
    deal_id: dealId,
    native: cdekConfigured(),
  });
});

api.get('/warehouse/tasks/:id/cdek', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor)) {
    return c.json({ error: 'Недостаточно прав: задания склада' }, 403);
  }
  const task = getTask(c.req.param('id'));
  if (!task) return c.json({ error: 'not found' }, 404);
  const dealId = String(task.deal_id || '').trim();
  if (!dealId) return c.json({ error: 'no deal_id' }, 400);
  try {
    const cdek = await fetchCdekShipment(dealId);
    return c.json({ task_id: task.id, deal_id: dealId, cdek });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cdek failed' }, 502);
  }
});

api.post('/warehouse/tasks/:id/cdek/sync', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor)) {
    return c.json({ error: 'Недостаточно прав: задания склада' }, 403);
  }
  const body = await c.req.json<{ refresh?: boolean }>().catch(() => ({ refresh: true }));
  try {
    const result = await syncTaskCdekTrack({
      taskId: c.req.param('id'),
      refresh: body.refresh !== false,
      actor_id: actor.id,
    });
    auditFromContext(c, {
      action: 'warehouse_task.cdek_sync',
      entity: 'warehouse_task',
      entityId: c.req.param('id'),
      summary: `СДЭК sync трек ${result.cdek.cdek_number || '—'}`,
      after: {
        track: result.cdek.cdek_number,
        status: result.cdek.cdek_status_name,
      },
    });
    const detail = getTask(c.req.param('id'));
    return c.json({ ...result, detail, cdek_configured: cdekConfigured() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cdek sync failed' }, 400);
  }
});

api.get('/ops/cdek-shipment', async (c) => {
  const dealId = (c.req.query('deal_id') || c.req.query('lead_id') || '').trim();
  if (!dealId) return c.json({ error: 'deal_id required' }, 400);
  const refresh = (c.req.query('refresh') || '') === '1';
  try {
    const cdek = refresh
      ? await refreshCdekShipment(dealId)
      : await fetchCdekShipment(dealId);
    return c.json(cdek);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cdek failed' }, 502);
  }
});

/* ——— СДЭК: настройки и сделки (bridge к виджету) ——— */

api.get('/ops/cdek/settings', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor) && !isAdminActor(actor)) {
    return c.json({ error: 'Недостаточно прав: СДЭК' }, 403);
  }
  try {
    const settings = await fetchCdekSettings();
    if (settings.ok === false) {
      return c.json(settings, 502);
    }
    return c.json({ ...settings, configured: cdekConfigured() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cdek settings failed' }, 502);
  }
});

api.put('/ops/cdek/settings', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor.role !== 'manager') {
    return c.json({ error: 'Сохранять настройки СДЭК может админ или менеджер' }, 403);
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const settings = await saveCdekSettings(body);
    if (settings.ok === false) {
      return c.json(settings, 400);
    }
    auditFromContext(c, {
      action: 'cdek.settings_save',
      entity: 'cdek_settings',
      entityId: 'widget',
      summary: 'Сохранены настройки СДЭК (виджет)',
      after: {
        accounts: (settings.accounts || []).map((a) => a.id),
        updated_at: settings.updated_at,
      },
    });
    return c.json({ ...settings, configured: cdekConfigured() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cdek settings save failed' }, 502);
  }
});

api.post('/ops/cdek/action', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!isAdminActor(actor) && actor.role !== 'manager') {
    return c.json({ error: 'Действия СДЭК — админ или менеджер' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    action?: string;
  } & Record<string, unknown>;
  const action = String(body.action || '').trim();
  const allowed = new Set([
    'load_branches',
    'check_api',
    'refresh_pvz_cache',
    'load_category_defaults',
    'save_category_defaults',
  ]);
  if (!allowed.has(action)) {
    return c.json({ error: 'Неизвестное действие' }, 400);
  }
  try {
    const rest = { ...body };
    delete rest.action;
    const result = await callCdekWidgetAction(
      action as
        | 'load_branches'
        | 'check_api'
        | 'refresh_pvz_cache'
        | 'load_category_defaults'
        | 'save_category_defaults',
      rest
    );
    if (result.ok === false) {
      return c.json(result, 400);
    }
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cdek action failed' }, 502);
  }
});

api.get('/ops/cdek/deals', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor) && !isAdminActor(actor)) {
    return c.json({ error: 'Недостаточно прав: СДЭК' }, 403);
  }
  const limit = Number(c.req.query('limit') || 300) || 300;
  const q = (c.req.query('q') || '').trim().toLowerCase();
  try {
    const result = await listCdekDeals(limit);
    if (result.ok === false) {
      return c.json(result, 502);
    }
    let items = result.items;
    if (q) {
      items = items.filter((row) => {
        const hay = [
          row.lead_id,
          row.cdek_number,
          row.recipient_name,
          row.delivery_city,
          row.account_title,
          row.cdek_status_name,
          row.shipment_method_title,
        ]
          .map((x) => String(x || '').toLowerCase())
          .join(' ');
        return hay.includes(q);
      });
    }
    return c.json({
      ok: true,
      items,
      count: items.length,
      total: result.count,
      source: result.source,
      configured: cdekConfigured(),
      widget_index: 'https://widget.pnevmopodveska1.ru/cdek/',
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cdek deals failed' }, 502);
  }
});

api.get('/ops/cdek/deals/:leadId', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor) && !isAdminActor(actor)) {
    return c.json({ error: 'Недостаточно прав: СДЭК' }, 403);
  }
  const leadId = c.req.param('leadId').trim();
  if (!leadId) return c.json({ error: 'lead_id required' }, 400);
  try {
    const deal = await fetchCdekDeal(leadId);
    if (deal.ok === false) {
      return c.json(deal, deal.error?.includes('not found') ? 404 : 502);
    }
    return c.json({ ok: true, deal, configured: cdekConfigured() });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'cdek deal failed' }, 502);
  }
});

/* ——— Валюты (каталог + курсы ЦБ РФ) ——— */

api.get('/currencies', (c) => {
  const allFlag = (c.req.query('all') || '') === '1';
  return c.json({ items: listCurrencies(!allFlag) });
});

api.get('/currencies/catalog', (c) => c.json(currenciesCatalog()));

api.get('/currencies/header', (c) => c.json(headerRates()));

api.get('/currencies/rates', (c) =>
  c.json({
    items: listCurrencyRates({
      base: (c.req.query('base') || '').trim() || undefined,
      quote: (c.req.query('quote') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 50) || 50,
    }),
  })
);

api.put('/currencies/rates', async (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor)) return c.json({ error: 'Только admin' }, 403);
  const body = await c.req.json<{
    base_code?: string;
    quote_code?: string;
    code?: string;
    rate?: number;
    rate_to_rub?: number;
    rate_date?: string;
    source?: string;
  }>();
  try {
    const rateToRub = body.rate_to_rub != null ? Number(body.rate_to_rub) : null;
    const code = String(body.code || body.base_code || '')
      .trim()
      .toUpperCase();
    if (rateToRub != null && code && code !== 'RUB') {
      const row = upsertRubPair({
        code,
        rateToRub,
        rate_date: body.rate_date,
        source: body.source || 'manual',
      });
      return c.json(row);
    }
    const row = upsertCurrencyRate({
      base_code: body.base_code,
      quote_code: String(body.quote_code || ''),
      rate: Number(body.rate),
      rate_date: body.rate_date,
      source: body.source || 'manual',
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'rate failed' }, 400);
  }
});

api.post('/currencies/rates/sync-cbr', async (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor)) return c.json({ error: 'Только admin' }, 403);
  const qForce = (c.req.query('force') || '') === '1';
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  try {
    const result = await syncRatesFromCbr({ force: qForce || Boolean(body.force) });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'CBR sync failed' }, 502);
  }
});

api.post('/currencies', async (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor)) return c.json({ error: 'Только admin' }, 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const row = upsertCurrency(body as Parameters<typeof upsertCurrency>[0]);
    return c.json(row, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'currency create failed' }, 400);
  }
});

api.get('/currencies/:code', (c) => {
  const row = getCurrency(c.req.param('code'));
  if (!row) return c.json({ error: 'not found' }, 404);
  const history = listCurrencyRates({
    base: row.code,
    limit: Number(c.req.query('history') || 60) || 60,
  });
  return c.json({
    ...row,
    rates: history,
    latest_to_rub: headerRates().items.find((i) => i.code === row.code) || null,
  });
});

api.put('/currencies/:code', async (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor)) return c.json({ error: 'Только admin' }, 403);
  const code = c.req.param('code');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const row = upsertCurrency({ ...body, code } as Parameters<typeof upsertCurrency>[0]);
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'currency save failed' }, 400);
  }
});

/* ——— Паритет меню / экран сборщика (без правок ops UI) ——— */

api.get('/warehouse/pick/today', (c) => {
  return c.json(pickerBoard((c.req.query('day') || '').trim() || undefined));
});

/** Статус смены сборщика + утренний автостарт. */
api.get('/warehouse/pick/shift', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  return c.json(pickShiftStatusPayload(actor));
});

api.post('/warehouse/pick/shift/start', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    kind?: string;
    pin?: string;
    password?: string;
    auto?: boolean;
  };
  try {
    const shift = startPickShift(actor, {
      kind: body.kind,
      pin: body.pin,
      password: body.password,
      auto: Boolean(body.auto),
    });
    auditFromContext(c, {
      action: 'pick_shift.start',
      entity: 'pick_shift',
      entityId: shift.id,
      summary: `Смена ${shift.kind === 'evening' ? 'вечерняя' : 'дневная'}${shift.auto_started ? ' (утро)' : ''}: ${actor.name}`,
      after: shift,
    });
    return c.json({ ok: true, ...pickShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'start failed' }, 400);
  }
});

api.post('/warehouse/pick/shift/end', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  try {
    const ended = endPickShift(actor);
    if (ended) {
      auditFromContext(c, {
        action: 'pick_shift.end',
        entity: 'pick_shift',
        entityId: ended.id,
        summary: `Смена завершена: ${actor.name}`,
        after: ended,
      });
    }
    return c.json({ ok: true, ended, ...pickShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'end failed' }, 400);
  }
});

api.post('/warehouse/pick/shift/reauth', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    pin?: string;
    password?: string;
  };
  try {
    reauthPickShift(actor, { pin: body.pin, password: body.password });
    return c.json({ ok: true, ...pickShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'reauth failed' }, 400);
  }
});

api.get('/warehouse/pick/shift/settings', (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor)) return c.json({ error: 'Только администратор' }, 403);
  return c.json(getPickShiftSettings());
});

api.patch('/warehouse/pick/shift/settings', async (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor)) return c.json({ error: 'Только администратор' }, 403);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const next = savePickShiftSettings(body as Parameters<typeof savePickShiftSettings>[0]);
  auditFromContext(c, {
    action: 'pick_shift.settings',
    entity: 'meta',
    entityId: 'pick_shift_settings',
    summary: `Настройки смен сборщика: ${next.morning_from}–${next.morning_to}, авто=${next.auto_morning ? 'да' : 'нет'}`,
    after: next,
  });
  return c.json(next);
});

api.get('/warehouse/pick/shifts', (c) => {
  const actor = actorFromContext(c);
  if (!isAdminActor(actor) && !canAccessSection(actor, 'staff')) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  return c.json({
    items: listPickShifts({
      day: (c.req.query('day') || '').trim() || undefined,
      staff_id: (c.req.query('staff_id') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 100),
    }),
    settings: getPickShiftSettings(),
  });
});

/** Примитив кладовщика: «сделал» → handed (или ready при шлюзе оплаты). */
api.post('/warehouse/tasks/:id/done', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (!canOperateWarehouseTasks(actor)) {
    return c.json({ error: 'Недостаточно прав: задания склада' }, 403);
  }
  try {
    assertPickShiftForOps(actor);
    const row = markTaskDone({ id: c.req.param('id'), actor_id: actor.id });
    touchPickShiftActivity(actor.id);
    let dealPromote: Awaited<ReturnType<typeof promoteDealToSuccessAfterHanded>> | null = null;
    if (String((row as { status?: string } | null)?.status) === 'handed') {
      dealPromote = await promoteDealToSuccessAfterHanded({
        dealId: String((row as { deal_id?: string } | null)?.deal_id || ''),
        taskId: c.req.param('id'),
      });
      if (dealPromote.ok && !dealPromote.skipped) {
        auditFromContext(c, {
          action: 'crm.deal_stage_auto',
          entity: 'crm_deal',
          entityId: String((row as { deal_id?: string } | null)?.deal_id || ''),
          summary: `Авто этап «${dealPromote.status_name}» после «Сделал» на сборке`,
          after: dealPromote,
        });
      }
    }
    auditFromContext(c, {
      action: 'warehouse_task.status',
      entity: 'warehouse_task',
      entityId: c.req.param('id'),
      summary: `Задание сделано → ${(row as { status?: string } | null)?.status || ''}`,
      after: { status: (row as { status?: string } | null)?.status, deal_promote: dealPromote },
    });
    return c.json({ ...row, deal_promote: dealPromote });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'done failed' }, 400);
  }
});

api.get('/gtd', (c) => c.json(listGtdNumbers(c.req.query('q') || '', Number(c.req.query('limit') || 200))));
api.post('/gtd', async (c) => {
  const body = await c.req.json<{ code?: string; description?: string }>();
  try {
    return c.json(createGtdNumber({ code: String(body.code || ''), description: body.description }), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.patch('/gtd/:id', async (c) => {
  const body = await c.req.json<{ code?: string; description?: string }>();
  const row = patchGtdNumber(c.req.param('id'), body);
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

api.get('/stock/low', (c) => c.json(lowStockReport(Number(c.req.query('limit') || 300))));

api.get('/money/cash-articles', (c) => c.json(listCashArticles()));
api.post('/money/cash-articles', async (c) => {
  const body = await c.req.json<{ id?: string; name?: string; kind?: string; is_active?: number }>();
  try {
    return c.json(upsertCashArticle({ id: body.id, name: String(body.name || ''), kind: body.kind, is_active: body.is_active }), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/money/cash', (c) => {
  const registerId = c.req.query('cash_register_id') || c.req.query('register_id') || '';
  return c.json(
    listCashDocs(Number(c.req.query('limit') || 200), {
      cash_register_id: registerId || undefined,
    })
  );
});
api.post('/money/cash', async (c) => {
  const body = await c.req.json<{
    doc_type?: 'in' | 'out';
    amount?: number;
    article_id?: string;
    counterparty_id?: string;
    cash_register_id?: string;
    comment?: string;
    doc_date?: string;
  }>();
  try {
    return c.json(
      createCashDoc({
        doc_type: body.doc_type || 'in',
        amount: Number(body.amount),
        article_id: body.article_id,
        counterparty_id: body.counterparty_id,
        cash_register_id: body.cash_register_id,
        comment: body.comment,
        doc_date: body.doc_date,
      }),
      201
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/money/payment-orders', (c) => c.json(listPaymentOrders(Number(c.req.query('limit') || 200))));
api.post('/money/payment-orders', async (c) => {
  const body = await c.req.json<{
    amount?: number;
    payee?: string;
    purpose?: string;
    doc_date?: string;
    status?: string;
  }>();
  try {
    return c.json(createPaymentOrder(body as Parameters<typeof createPaymentOrder>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/staff/job-titles', (c) => c.json(listJobTitles()));
api.post('/staff/job-titles', async (c) => {
  const body = await c.req.json<{ id?: string; name?: string; is_active?: number }>();
  try {
    return c.json(upsertJobTitle({ id: body.id, name: String(body.name || ''), is_active: body.is_active }), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/staff/schedules', (c) => c.json(listWorkSchedules()));
api.post('/staff/schedules', async (c) => {
  const body = await c.req.json<{ id?: string; name?: string; hours_json?: string; is_active?: number }>();
  try {
    return c.json(
      upsertWorkSchedule({
        id: body.id,
        name: String(body.name || ''),
        hours_json: body.hours_json,
        is_active: body.is_active,
      }),
      201
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/production/orders', (c) => c.json(listProductionOrders(Number(c.req.query('limit') || 200))));
api.post('/production/orders', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(createProductionOrder(body as Parameters<typeof createProductionOrder>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.patch('/production/orders/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    const row = patchProductionOrder(c.req.param('id'), body as Parameters<typeof patchProductionOrder>[1]);
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/crm/events', (c) => c.json(listCrmEvents(Number(c.req.query('limit') || 200))));
api.post('/crm/events', async (c) => {
  const body = await c.req.json<{ title?: string; kind?: string; deal_id?: string; comment?: string }>();
  try {
    return c.json(createCrmEvent({ title: String(body.title || ''), kind: body.kind, deal_id: body.deal_id, comment: body.comment }), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/crm/tasks', (c) => c.json(listCrmTasks(Number(c.req.query('limit') || 200))));
api.post('/crm/tasks', async (c) => {
  const body = await c.req.json<{
    title?: string;
    status?: string;
    due_at?: string;
    deal_id?: string;
    comment?: string;
    assignee_amo_id?: string;
    source?: string;
  }>();
  try {
    return c.json(
      createCrmTask({
        title: String(body.title || ''),
        status: body.status,
        due_at: body.due_at,
        deal_id: body.deal_id,
        comment: body.comment,
        assignee_amo_id: body.assignee_amo_id,
        source: body.source,
      }),
      201
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.patch('/crm/tasks/:id', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { status?: string; comment?: string };
  try {
    const row = patchCrmTask(c.req.param('id'), body);
    if (!row) return c.json({ error: 'not found' }, 404);
    auditFromContext(c, {
      action: 'crm.task_patch',
      entity: 'crm_task',
      entityId: c.req.param('id'),
      summary: `Задача: ${String(body.status || row.status || '')}`,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/crm/deals/:id/tasks', (c) =>
  c.json({ items: listCrmTasksForDeal(c.req.param('id'), 50) })
);

api.get('/crm/calendar', (c) => c.json(listCrmCalendar(Number(c.req.query('limit') || 100))));
api.get('/crm/order-statuses', (c) => c.json(listOrderStatusTypes(String(c.req.query('kind') || ''))));

api.get('/works/orders', (c) => c.json(listStoWorkOrders(Number(c.req.query('limit') || 200))));
api.post('/works/orders', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(createStoWorkOrder(body as Parameters<typeof createStoWorkOrder>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.patch('/works/orders/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    const row = patchStoWorkOrder(c.req.param('id'), body as Parameters<typeof patchStoWorkOrder>[1]);
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/works/resources', (c) => c.json(listStoResources()));
api.get('/works/order-statuses', (c) => c.json(listOrderStatusTypes('sto')));

/* ——— СТО: подъёмник (/lift) + приёмщик (/reception) ——— */

api.get('/sto/lift/shift', (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  return c.json(liftShiftStatusPayload(actor));
});

api.post('/sto/lift/shift/start', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { pin?: string; password?: string };
  try {
    const shift = startLiftShift(actor, body);
    auditFromContext(c, {
      action: 'sto_lift_shift.start',
      entity: 'sto_lift_shift',
      entityId: shift.id,
      summary: `Смена мастера СТО: ${actor.name}`,
      after: shift,
    });
    return c.json({ ok: true, ...liftShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'start failed' }, 400);
  }
});

api.post('/sto/lift/shift/end', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  try {
    const ended = endLiftShift(actor);
    if (ended) {
      auditFromContext(c, {
        action: 'sto_lift_shift.end',
        entity: 'sto_lift_shift',
        entityId: ended.id,
        summary: `Смена мастера СТО завершена: ${actor.name}`,
        after: ended,
      });
    }
    return c.json({ ok: true, ended, ...liftShiftStatusPayload(actor) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'end failed' }, 400);
  }
});

api.get('/sto/lift/board', (c) => c.json(listLiftsBoard()));

api.get('/sto/lift/search', (c) =>
  c.json(searchStoVehicles(String(c.req.query('q') || ''), Number(c.req.query('limit') || 20)))
);

api.get('/sto/lift/orders/:id', (c) => {
  const row = getWorkOrderDetail(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});

api.post('/sto/lift/assign', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  try {
    const row = assignToLift(actor, {
      lift_id: String(body.lift_id || ''),
      work_order_id: body.work_order_id ? String(body.work_order_id) : undefined,
      appointment_id: body.appointment_id ? String(body.appointment_id) : undefined,
      plate: body.plate ? String(body.plate) : undefined,
      vin: body.vin ? String(body.vin) : undefined,
      model: body.model ? String(body.model) : undefined,
      client_name: body.client_name ? String(body.client_name) : undefined,
      works: Array.isArray(body.works)
        ? (body.works as Array<{ name: string; qty?: number }>)
        : undefined,
    });
    auditFromContext(c, {
      action: 'sto_lift.assign',
      entity: 'sto_work_order',
      entityId: String((row as { id?: string })?.id || ''),
      summary: `На подъёмник: ${(row as { plate?: string; number?: string })?.plate || ''} ${(row as { number?: string })?.number || ''}`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'assign failed' }, 400);
  }
});

api.post('/sto/lift/:liftId/free', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ mark_done?: boolean }>().catch((): { mark_done?: boolean } => ({}));
  try {
    const res = freeLift(actor, c.req.param('liftId'), Boolean(body.mark_done));
    auditFromContext(c, {
      action: 'sto_lift.free',
      entity: 'sto_resource',
      entityId: c.req.param('liftId'),
      summary: `Освобождён подъёмник`,
      after: res,
    });
    return c.json(res);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'free failed' }, 400);
  }
});

api.post('/sto/lift/orders/:id/works', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<{ name?: string; qty?: number }>().catch((): { name?: string; qty?: number } => ({}));
  try {
    return c.json(addWoWork(actor, c.req.param('id'), String(body.name || ''), Number(body.qty) || 1), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.post('/sto/lift/orders/:id/materials', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  try {
    const row = addMaterial(actor, {
      work_order_id: c.req.param('id'),
      product_id: String(body.product_id || ''),
      qty: Number(body.qty) || 0,
      work_log_id: body.work_log_id ? String(body.work_log_id) : undefined,
      write_off: body.write_off !== false,
    });
    auditFromContext(c, {
      action: 'sto_lift.material',
      entity: 'sto_wo_material',
      entityId: String((row as { id?: string })?.id || ''),
      summary: `Материал на ЗН: ${(row as { name?: string })?.name || ''} ×${(row as { qty?: number })?.qty || ''}`,
      after: row,
    });
    return c.json(row, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/sto/work-catalog', (c) => c.json(listWorkCatalog()));

api.get('/sto/work-logs', (c) =>
  c.json(
    listWorkLogs({
      day: (c.req.query('day') || '').trim() || undefined,
      staff_id: (c.req.query('staff_id') || '').trim() || undefined,
      work_order_id: (c.req.query('work_order_id') || '').trim() || undefined,
      limit: Number(c.req.query('limit') || 100),
    })
  )
);

api.post('/sto/work-logs', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));
  try {
    const row = createWorkLog(actor, {
      work_order_id: String(body.work_order_id || ''),
      lift_id: body.lift_id ? String(body.lift_id) : undefined,
      work_name: body.work_name ? String(body.work_name) : undefined,
      catalog_id: body.catalog_id ? String(body.catalog_id) : undefined,
      qty: body.qty != null ? Number(body.qty) : undefined,
      hours: body.hours != null ? Number(body.hours) : undefined,
      status: body.status ? String(body.status) : undefined,
      note: body.note ? String(body.note) : undefined,
    });
    auditFromContext(c, {
      action: 'sto_work_log.create',
      entity: 'sto_work_log',
      entityId: String((row as { id?: string })?.id || ''),
      summary: `Работа слесаря: ${actor.name} — ${(row as { work_name?: string })?.work_name || ''}`,
      after: row,
    });
    return c.json(row, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.patch('/sto/work-logs/:id', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const id = c.req.param('id');
    const row = patchWorkLog(actor, id, body as Parameters<typeof patchWorkLog>[2]);
    if (!row) return c.json({ error: 'not found' }, 404);
    auditFromContext(c, {
      action: 'sto_work_log.update',
      entity: 'sto_work_log',
      entityId: id,
      summary: `Работа слесаря обновлена: ${actor.name}`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/sto/reception/today', (c) => {
  const day = (c.req.query('day') || '').trim();
  return c.json(listAppointments(day || undefined));
});

api.get('/sto/reception/queue', (c) => c.json(todayArrivedQueue()));

api.post('/sto/reception/appointments', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const row = createAppointment(body as Parameters<typeof createAppointment>[0]);
    auditFromContext(c, {
      action: 'sto_appointment.create',
      entity: 'sto_appointment',
      entityId: String((row as { id?: string })?.id || ''),
      summary: `Запись СТО: ${(row as { plate?: string })?.plate || ''} ${(row as { client_name?: string })?.client_name || ''}`,
      after: row,
    });
    return c.json(row, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.patch('/sto/reception/appointments/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const row = patchAppointment(c.req.param('id'), body as Parameters<typeof patchAppointment>[1]);
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.post('/sto/reception/appointments/:id/arrive', async (c) => {
  try {
    const row = markAppointmentArrived(c.req.param('id'));
    auditFromContext(c, {
      action: 'sto_appointment.arrive',
      entity: 'sto_appointment',
      entityId: c.req.param('id'),
      summary: `Прибыл на СТО: ${(row as { plate?: string })?.plate || ''}`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/marketplaces/meta', (c) => c.json({ channels: marketplaceChannelMeta() }));
api.get('/marketplaces/orders', (c) =>
  c.json(listMarketplaceOrders(String(c.req.query('channel') || ''), Number(c.req.query('limit') || 200)))
);
api.post('/marketplaces/orders', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(createMarketplaceOrder(body as Parameters<typeof createMarketplaceOrder>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/prices/matrix', (c) => c.json(priceListMatrix(Number(c.req.query('limit') || 200))));
api.get('/sales/analysis', (c) => c.json(salesAnalysis()));
api.get('/inventory', (c) => c.json(listInventorySheets(Number(c.req.query('limit') || 100))));
api.get('/inventory/:id', (c) => {
  const row = getInventorySheet(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});
api.post('/inventory', async (c) => {
  const body = await c.req.json<{
    warehouse_id?: string;
    comment?: string;
    lines?: Array<{ product_id: string; counted_qty: number }>;
    post?: boolean;
  }>();
  try {
    return c.json(
      createInventorySheet({
        warehouse_id: String(body.warehouse_id || ''),
        comment: body.comment,
        lines: body.lines || [],
        post: body.post,
      }),
      201
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.post('/inventory/:id/post', async (c) => {
  try {
    return c.json(postInventorySheet(c.req.param('id')));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/help/about', (c) => c.json(aboutProgram()));

api.get('/money/cash-book', (c) => c.json(cashBook(Number(c.req.query('limit') || 200))));
api.get('/money/transfers', (c) => c.json(listMoneyTransfers(Number(c.req.query('limit') || 200))));
api.post('/money/transfers', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(createMoneyTransfer(body as Parameters<typeof createMoneyTransfer>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/money/bank-docs', (c) =>
  c.json(listBankDocsLocal(Number(c.req.query('limit') || 200), c.req.query('type') || ''))
);
api.post('/money/bank-docs', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(createBankDocLocal(body as Parameters<typeof createBankDocLocal>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/money/cash-registers', (c) =>
  c.json(
    listCashRegisters({
      organization_id: c.req.query('organization_id') || undefined,
      company_id: c.req.query('company_id') || undefined,
    })
  )
);
api.post('/money/cash-registers', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(
      upsertCashRegister({
        id: body.id != null ? String(body.id) : undefined,
        name: String(body.name || ''),
        kind: body.kind != null ? String(body.kind) : undefined,
        organization_id: body.organization_id != null ? String(body.organization_id) : undefined,
        is_active: body.is_active == null ? undefined : Number(body.is_active) ? 1 : 0,
      }),
      201
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.delete('/money/cash-registers/:id', async (c) => {
  const actor = actorFromContext(c);
  if (!actor) return c.json({ error: 'unauthorized' }, 401);
  if (
    !isAdminActor(actor) &&
    !canAccessSection(actor, 'kassa') &&
    !canAccessSection(actor, 'money')
  ) {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    return c.json(deleteCashRegister(c.req.param('id')));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/money/card-ops', (c) => c.json(listCardOps(Number(c.req.query('limit') || 200))));
api.post('/money/card-ops', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(createCardOp(body as Parameters<typeof createCardOp>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/money/payment-calendar', (c) =>
  c.json(paymentCalendar(c.req.query('from') || '', c.req.query('to') || ''))
);
api.post('/money/payment-calendar', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(createPaymentPlanItem(body as Parameters<typeof createPaymentPlanItem>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/staff/hr-docs', (c) =>
  c.json(listHrDocs(Number(c.req.query('limit') || 200), c.req.query('type') || ''))
);
api.post('/staff/hr-docs', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(createHrDoc(body as Parameters<typeof createHrDoc>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/staff/persons', (c) => c.json(listPersons()));
api.get('/staff/shifts', (c) => c.json(listWorkShifts()));
api.post('/staff/shifts', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(upsertWorkShift(body as Parameters<typeof upsertWorkShift>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/staff/time-kinds', (c) => c.json(listTimeKinds()));
api.post('/staff/time-kinds', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(upsertTimeKind(body as Parameters<typeof upsertTimeKind>[0]), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/company/companies', (c) => {
  ensureCompaniesSchema();
  return c.json(companiesListPayload());
});
api.get('/company/companies/:id', (c) => {
  ensureCompaniesSchema();
  const detail = companyDetailPayload(c.req.param('id'));
  if (!detail) return c.json({ error: 'not found' }, 404);
  return c.json(detail);
});
api.post('/company/companies', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const row = upsertCompany(body as Parameters<typeof upsertCompany>[0]);
    ensureCompanySysWarehouses(row.id);
    auditFromContext(c, {
      action: 'company.create',
      entity: 'company',
      entityId: row.id,
      summary: `Организация (контур): ${row.name}`,
      after: row,
    });
    return c.json(companyDetailPayload(row.id), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.put('/company/companies/:id', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const row = upsertCompany({
      ...(body as Parameters<typeof upsertCompany>[0]),
      id: c.req.param('id'),
    });
    auditFromContext(c, {
      action: 'company.update',
      entity: 'company',
      entityId: row.id,
      summary: `Организация (контур): ${row.name}`,
      after: row,
    });
    return c.json(companyDetailPayload(row.id));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.post('/company/companies/:id/default', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const row = setDefaultCompany(c.req.param('id'));
    auditFromContext(c, {
      action: 'company.default',
      entity: 'company',
      entityId: row.id,
      summary: `Контур по умолчанию: ${row.name}`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.post('/company/companies/:id/archive', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const row = archiveCompany(c.req.param('id'));
    auditFromContext(c, {
      action: 'company.archive',
      entity: 'company',
      entityId: row.id,
      summary: `Контур в архив: ${row.name}`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.post('/company/companies/:id/restore', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const row = restoreCompany(c.req.param('id'));
    auditFromContext(c, {
      action: 'company.restore',
      entity: 'company',
      entityId: row.id,
      summary: `Контур из архива: ${row.name}`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/company/organizations', (c) => c.json(companyOrganizations()));
api.post('/company/organizations/sync-from-tochka', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const result = await syncOrganizationsFromTochka();
    auditFromContext(c, {
      action: 'org.sync_tochka',
      entity: 'organization',
      summary: `Из Точки: +${result.created} / upd ${result.updated} (всего ${result.customers_in_tochka})`,
      after: {
        created: result.created,
        updated: result.updated,
        customers: result.customers_in_tochka,
      },
    });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'tochka sync failed' }, 502);
  }
});
api.get('/company/organizations/:id', (c) => {
  const row = getOrganization(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ ...row, ...orgPrintAssetsMeta(row.inn) });
});
api.post('/company/organizations', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const row = upsertOrganization(body as Parameters<typeof upsertOrganization>[0]);
    auditFromContext(c, {
      action: 'org.create',
      entity: 'organization',
      entityId: row.id,
      summary: `Организация: ${row.name}`,
      after: row,
    });
    return c.json({ ...row, ...orgPrintAssetsMeta(row.inn) }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.put('/company/organizations/:id', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const row = upsertOrganization({
      ...(body as Parameters<typeof upsertOrganization>[0]),
      id: c.req.param('id'),
    });
    auditFromContext(c, {
      action: 'org.update',
      entity: 'organization',
      entityId: row.id,
      summary: `Организация: ${row.name}`,
      after: row,
    });
    return c.json({ ...row, ...orgPrintAssetsMeta(row.inn) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

async function orgPrintUploadForId(
  c: Context,
  organizationId: string,
  kind: OrgPrintAssetKind
) {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const row = getOrganization(organizationId);
  if (!row) return c.json({ error: 'not found' }, 404);
  const inn = String(row.inn || '').replace(/\D/g, '');
  if (!inn) {
    return c.json({ error: 'Сначала укажите и сохраните ИНН юрлица' }, 400);
  }
  let buf: Buffer | null = null;
  try {
    buf = await readImageUploadBody(c);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'Не удалось прочитать файл' }, 400);
  }
  if (!buf?.length) return c.json({ error: 'Нужен файл изображения (file) или image_base64' }, 400);
  try {
    const r = saveOrgPrintAsset(inn, kind, buf);
    auditFromContext(c, {
      action: kind === 'stamp' ? 'org.stamp_upload' : 'org.signature_upload',
      entity: 'organization',
      entityId: organizationId,
      summary: `${kind === 'stamp' ? 'Печать' : 'Подпись'} · ${row.short_name || row.name} · ИНН ${r.inn}`,
    });
    return c.json({ ok: true, ...row, ...orgPrintAssetsMeta(r.inn) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'upload failed' }, 400);
  }
}

api.post('/company/organizations/:id/stamp', (c) =>
  orgPrintUploadForId(c, c.req.param('id'), 'stamp')
);
api.post('/company/organizations/:id/signature', (c) =>
  orgPrintUploadForId(c, c.req.param('id'), 'sign')
);
api.delete('/company/organizations/:id/stamp', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const row = getOrganization(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  deleteOrgPrintAsset(row.inn, 'stamp');
  return c.json({ ok: true, ...row, ...orgPrintAssetsMeta(row.inn) });
});
api.delete('/company/organizations/:id/signature', (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const row = getOrganization(c.req.param('id'));
  if (!row) return c.json({ error: 'not found' }, 404);
  deleteOrgPrintAsset(row.inn, 'sign');
  return c.json({ ok: true, ...row, ...orgPrintAssetsMeta(row.inn) });
});
api.post('/company/organizations/:id/default', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  try {
    const row = setDefaultOrganization(c.req.param('id'));
    auditFromContext(c, {
      action: 'org.default',
      entity: 'organization',
      entityId: row.id,
      summary: `Организация по умолчанию: ${row.name}`,
      after: row,
    });
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.delete('/company/organizations/:id', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const id = c.req.param('id');
  const hard = (c.req.query('hard') || '').trim() === '1';
  try {
    if (hard) {
      const links = organizationLinkInfo(id);
      if (links.linked) {
        return c.json({ error: LINKED_DELETE_MSG, has_links: true, link_counts: links.counts }, 409);
      }
      const before = getOrganization(id);
      if (!before) return c.json({ error: 'Организация не найдена' }, 404);
      hardDeleteOrganization(id);
      auditFromContext(c, {
        action: 'org.delete',
        entity: 'organization',
        entityId: id,
        summary: `Удалена: ${before.name}`,
        before,
      });
      return c.json({ ok: true });
    }
    const row = deactivateOrganization(id);
    auditFromContext(c, {
      action: 'org.deactivate',
      entity: 'organization',
      entityId: row.id,
      summary: `В архив: ${row.name}`,
      after: row,
    });
    const links = organizationLinkInfo(row.id);
    return c.json({
      ...row,
      has_links: links.linked,
      can_delete: !links.linked,
      link_counts: links.counts,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
/** Компактный список для выпадающих списков. */
api.get('/organizations', (c) => {
  const activeOnly = c.req.query('all') !== '1';
  const companyId = (c.req.query('company_id') || '').trim();
  const coFilter = resolveListCompanyFilter(actorFromContext(c), companyId);
  if (coFilter.mode === 'none') return c.json([]);
  if (coFilter.mode === 'one') {
    return c.json(listOrganizations({ activeOnly, companyId: coFilter.id }));
  }
  if (coFilter.mode === 'in') {
    return c.json(
      listOrganizations({ activeOnly }).filter((o) =>
        coFilter.ids.includes(String(o.company_id || ''))
      )
    );
  }
  return c.json(listOrganizations({ activeOnly, companyId: companyId || undefined }));
});
api.get('/company/bank-accounts', (c) => c.json(listCompanyBankAccounts()));
api.post('/company/bank-accounts', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  try {
    return c.json(
      upsertCompanyBankAccount(body as Parameters<typeof upsertCompanyBankAccount>[0]),
      201
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.post('/company/bank-accounts/:id/archive', (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM company_bank_accounts WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const next = archiveBankAccount(id);
  auditFromContext(c, {
    action: 'bank_account.archive',
    entity: 'bank_account',
    entityId: id,
    summary: `Счёт в архив: ${(row as { name?: string }).name || id}`,
    before: row,
    after: next,
  });
  return c.json(withDeleteMeta('bank_account', next as Record<string, unknown>));
});
api.delete('/company/bank-accounts/:id', (c) => {
  const id = c.req.param('id');
  const row = get('SELECT * FROM company_bank_accounts WHERE id = ?', [id]);
  if (!row) return c.json({ error: 'not found' }, 404);
  const links = bankAccountLinkInfo(id);
  if (links.linked) {
    return c.json({ error: LINKED_DELETE_MSG, has_links: true, link_counts: links.counts }, 409);
  }
  try {
    hardDeleteBankAccount(id);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 409);
  }
  auditFromContext(c, {
    action: 'bank_account.delete',
    entity: 'bank_account',
    entityId: id,
    summary: `Счёт удалён: ${(row as { name?: string }).name || id}`,
    before: row,
  });
  return c.json({ ok: true });
});
api.get('/company/dicts', (c) => c.json(allDictionariesIndex()));
api.get('/company/analytics', (c) => c.json(companyAnalytics()));

api.get('/home/kpi', (c) => {
  const base = homeKpi();
  const activity = auditKpi({ days: 14 });
  return c.json({
    ...base,
    staff_activity: {
      note: activity.note,
      totals: activity.totals,
      by_staff_day: activity.by_staff_day.slice(0, 30),
      by_action: activity.by_action.slice(0, 15),
    },
  });
});

api.get('/settings/my', (c) => c.json(settingsMyProfile(actorFromContext(c))));
api.get('/settings/calendars', (c) => c.json(settingsCalendars()));
api.get('/settings/equipment', (c) => c.json(settingsEquipment()));
api.get('/settings/sales-channels', (c) => c.json(settingsSalesChannels()));
api.get('/settings/yookassa', (c) => c.json(settingsYookassa()));
api.get('/settings/reports', (c) => c.json(settingsReportsIndex()));

/** Batch A: Закупки / Продажи / складские отчёты — тонкие журналы + хабы. */
api.get('/parity/journals', (c) => c.json({ items: listThinJournalKeys() }));
api.get('/parity/journals/:key', (c) => {
  try {
    return c.json(
      listThinJournalDocs(
        c.req.param('key'),
        Number(c.req.query('limit') || 200),
        c.req.query('q') || ''
      )
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/parity/journals/:key/:id', (c) => {
  try {
    const key = c.req.param('key');
    const id = c.req.param('id');
    // Заказ поставщику: при открытии догенерируем марки (по 1 на каждую шт. qty)
    const row =
      key === 'supplier_orders'
        ? ensureThinJournalMarks(key, id)
        : getThinJournalDoc(key, id);
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.post('/parity/journals/:key', async (c) => {
  const body = await c.req.json<{
    counterparty_name?: string;
    amount?: number;
    comment?: string;
    doc_date?: string;
    status?: string;
    payload_json?: string;
  }>();
  try {
    if (!getThinJournalMeta(c.req.param('key'))) {
      return c.json({ error: 'unknown journal' }, 404);
    }
    return c.json(createThinJournalDoc(c.req.param('key'), body), 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.patch('/parity/journals/:key/:id', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const row = patchThinJournalDoc(c.req.param('id'), body as Parameters<typeof patchThinJournalDoc>[1]);
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(row);
});
api.post('/parity/journals/:key/:id/lines', async (c) => {
  const body = await c.req.json<{ product_id?: string; qty?: number; price?: number }>();
  try {
    if (!getThinJournalMeta(c.req.param('key'))) {
      return c.json({ error: 'unknown journal' }, 404);
    }
    const row = addThinJournalLine(c.req.param('key'), c.req.param('id'), {
      product_id: String(body.product_id || ''),
      qty: body.qty,
      price: body.price,
    });
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.delete('/parity/journals/:key/:id/lines/:idx', (c) => {
  try {
    if (!getThinJournalMeta(c.req.param('key'))) {
      return c.json({ error: 'unknown journal' }, 404);
    }
    const row = removeThinJournalLine(
      c.req.param('key'),
      c.req.param('id'),
      Number(c.req.param('idx'))
    );
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.post('/parity/journals/:key/:id/datamatrix/allocate', async (c) => {
  let body: { prefix?: string; force?: boolean } = {};
  try {
    body = (await c.req.json()) as { prefix?: string; force?: boolean };
  } catch {
    body = {};
  }
  try {
    if (!getThinJournalMeta(c.req.param('key'))) {
      return c.json({ error: 'unknown journal' }, 404);
    }
    const row = allocateThinJournalDatamatrix(c.req.param('key'), c.req.param('id'), {
      prefix: body.prefix,
      force: !!body.force,
    });
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/parity/journals/:key/:id/datamatrix/labels.html', (c) => {
  try {
    if (!getThinJournalMeta(c.req.param('key'))) {
      return c.json({ error: 'unknown journal' }, 404);
    }
    const html = thinJournalDmLabelsHtml(c.req.param('key'), c.req.param('id'));
    return c.html(html);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/parity/journals/:key/:id/datamatrix/labels.pdf', async (c) => {
  try {
    if (!getThinJournalMeta(c.req.param('key'))) {
      return c.json({ error: 'unknown journal' }, 404);
    }
    const buf = await thinJournalDmLabelsPdf(c.req.param('key'), c.req.param('id'));
    const num = getThinJournalDoc(c.req.param('key'), c.req.param('id'))?.number || 'dm';
    const asciiName = `dm-${String(num).replace(/[^\x20-\x7E]+/g, '_')}.pdf`;
    c.header('Content-Type', 'application/pdf');
    c.header(
      'Content-Disposition',
      `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(`dm-${num}.pdf`)}`
    );
    c.header('Cache-Control', 'no-store');
    return c.body(new Uint8Array(buf));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.get('/parity/journals/:key/:id/datamatrix/excel.csv', (c) => {
  try {
    if (!getThinJournalMeta(c.req.param('key'))) {
      return c.json({ error: 'unknown journal' }, 404);
    }
    const csv = thinJournalDmExcelCsv(c.req.param('key'), c.req.param('id'));
    const num = getThinJournalDoc(c.req.param('key'), c.req.param('id'))?.number || 'dm';
    const asciiName = `dm-${String(num).replace(/[^\x20-\x7E]+/g, '_')}.csv`;
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(`dm-${num}.csv`)}`
    );
    return c.body(csv);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});
api.delete('/parity/journals/:key/:id', (c) => {
  try {
    const ok = deleteThinJournalDoc(c.req.param('key'), c.req.param('id'));
    if (!ok) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

api.get('/purchases/reports', (c) => c.json(purchasesReportsHub()));
api.get('/purchases/inbound-report', (c) =>
  c.json(
    purchasesInboundReport(
      Number(c.req.query('limit') || 100),
      c.req.query('gtd') === '1' || c.req.query('gtd_only') === '1'
    )
  )
);
api.get('/purchases/demand', (c) => c.json(demandCalculation(Number(c.req.query('limit') || 200))));
api.get('/warehouse/reports', (c) => c.json(warehouseReportsHub()));
api.get('/stock/writeoffs', (c) => c.json(listWriteOffs(Number(c.req.query('limit') || 200))));
api.get('/stock/transfers', (c) => c.json(listTransfers(Number(c.req.query('limit') || 200))));

/** Требование на возврат: сделка → задание кладовщику + ТВД (компенсация) в Деньгах. */
api.post('/supply/return-request', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    /** Основание возврата — расходная накладная. */
    out_doc_id?: string;
    out_doc_number?: string;
    deal_id?: string;
    deal_number?: string;
    buyer_name?: string;
    warehouse_id?: string;
    comment?: string;
    lines?: Array<{
      product_id?: string;
      qty?: number;
      sku?: string;
      name?: string;
      price?: number;
      serials?: string[];
    }>;
  };
  try {
    const outDocId = String(body.out_doc_id || '').trim();
    if (!outDocId) return c.json({ error: 'Укажите расходную накладную' }, 400);
    const outDoc = get<{
      id: string;
      number: string;
      doc_type: string;
      deal_id: string;
      counterparty_id: string;
    }>(
      `SELECT id, IFNULL(number,'') AS number, doc_type,
              IFNULL(deal_id,'') AS deal_id, IFNULL(counterparty_id,'') AS counterparty_id
       FROM stock_docs WHERE id = ?`,
      [outDocId]
    );
    if (!outDoc) return c.json({ error: 'Расходная не найдена' }, 404);
    if (outDoc.doc_type !== 'out') {
      return c.json({ error: 'Основание должно быть расходной накладной' }, 400);
    }
    const dealId = String(body.deal_id || outDoc.deal_id || '').trim();
    const outNum = String(body.out_doc_number || outDoc.number || '').trim();
    const whId = String(body.warehouse_id || '').trim();
    if (!whId) return c.json({ error: 'Укажите склад прихода' }, 400);
    const wh = get<{ name: string }>(
      `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [whId]
    );
    if (!wh) return c.json({ error: 'Склад не найден' }, 400);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return c.json({ error: 'Выберите товары для возврата' }, 400);

    const { createMoneyRefundFromReturn } = await import('./return-money.js');
    const { getLastSalePrice } = await import('./return-money.js');

    const enriched = lines.map((l) => {
      const productId = String(l.product_id || '').trim();
      const serials = Array.isArray(l.serials)
        ? l.serials.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      const qty = serials.length || Number(l.qty) || 0;
      let price = Math.max(0, Number(l.price) || 0);
      if (!(price > 0) && productId) {
        // цена из строки этой расходной
        const fromOut = get<{ price: number }>(
          `SELECT IFNULL(price,0) AS price FROM stock_doc_lines
           WHERE doc_id = ? AND product_id = ? AND IFNULL(price,0) > 0
           ORDER BY line_no LIMIT 1`,
          [outDocId, productId]
        );
        if (fromOut && Number(fromOut.price) > 0) {
          price = Number(fromOut.price);
        } else {
          const sale = getLastSalePrice({
            productId,
            serial: serials[0] || '',
            dealId,
          });
          price = Math.max(0, Number(sale.price) || 0);
        }
      }
      return {
        product_id: productId,
        qty,
        sku: String(l.sku || ''),
        name: String(l.name || ''),
        price,
        serials,
      };
    });
    const amount = enriched.reduce(
      (s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0),
      0
    );
    const serialsAll = enriched.flatMap((l) => l.serials);
    const buyerName =
      String(body.buyer_name || '').trim() ||
      get<{ name: string }>(
        `SELECT IFNULL(name,'') AS name FROM counterparties WHERE id = ?`,
        [outDoc.counterparty_id]
      )?.name ||
      '';

    const task = createTaskFromReturnReceive({
      out_doc_id: outDocId,
      out_doc_number: outNum,
      deal_id: dealId,
      deal_number: body.deal_number,
      buyer_name: buyerName,
      warehouse_id: whId,
      warehouse_name: wh.name,
      comment: body.comment,
      actor_id: actor?.id,
      lines: enriched,
    });

    const money = createMoneyRefundFromReturn({
      warehouseTaskId: String(task?.id || ''),
      warehouseTaskNumber: String(task?.number || ''),
      amount: Math.round(amount * 100) / 100,
      dealId,
      counterpartyName: buyerName,
      counterpartyId: outDoc.counterparty_id,
      serials: serialsAll,
      lines: enriched,
      comment:
        String(body.comment || '').trim() ||
        `Компенсация возврата · расходная ${outNum || outDocId.slice(0, 8)} · задание ${
          task?.number || ''
        }`,
    });

    auditFromContext(c, {
      action: 'warehouse_task.create',
      entity: 'warehouse_task',
      entityId: String(task?.id || ''),
      summary: `Требование возврата ${task?.number || ''}: расходная ${
        outNum || outDocId.slice(0, 8)
      } → ${wh.name}${money?.number ? ` · ТВД ${money.number}` : ''}`,
      after: { warehouse_task: task, money_refund: money },
    });
    return c.json(
      {
        ok: true,
        warehouse_task: task,
        money_refund: money,
        amount: Math.round(amount * 100) / 100,
        message: `Возврат · задание ${task?.number || ''}${
          money?.number ? ` · ТВД ${money.number}` : ''
        } — передано на склад`,
      },
      201
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Требование на оприходование: заказ поставщику → задание кладовщику (без проводки прихода). */
api.post('/supply/inbound-request', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    supplier_order_id?: string;
    supplier_order_number?: string;
    supplier_name?: string;
    warehouse_id?: string;
    comment?: string;
    lines?: Array<{
      product_id?: string;
      qty?: number;
      sku?: string;
      name?: string;
      price?: number;
      serials?: string[];
      apps?: unknown;
      serial_apps?: Record<string, unknown>;
    }>;
  };
  try {
    const orderId = String(body.supplier_order_id || '').trim();
    if (!orderId) return c.json({ error: 'Укажите заказ поставщику' }, 400);
    const whId = String(body.warehouse_id || '').trim();
    if (!whId) return c.json({ error: 'Укажите склад прихода' }, 400);
    const wh = get<{ name: string }>(
      `SELECT IFNULL(name,'') AS name FROM warehouses WHERE id = ?`,
      [whId]
    );
    if (!wh) return c.json({ error: 'Склад не найден' }, 400);
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return c.json({ error: 'Нет строк заказа' }, 400);

    // Сохраняем override применимости в payload заказа — подхватит приход по скану
    try {
      const row = get<{ payload_json: string }>(
        `SELECT IFNULL(payload_json,'') AS payload_json FROM thin_journal_docs WHERE id = ?`,
        [orderId]
      );
      if (row) {
        const payload = row.payload_json
          ? (JSON.parse(row.payload_json) as Record<string, unknown>)
          : {};
        const lineApps: Record<string, unknown> = {};
        const serialApps: Record<string, unknown> = {};
        for (const l of lines) {
          const pid = String(l.product_id || '').trim();
          if (pid && l.apps != null && String(l.apps) !== '') {
            lineApps[pid] = l.apps;
          }
          if (l.serial_apps && typeof l.serial_apps === 'object') {
            for (const [ser, apps] of Object.entries(l.serial_apps)) {
              const s = String(ser || '').trim();
              if (s) serialApps[s] = apps;
            }
          }
        }
        if (Object.keys(lineApps).length) payload.inbound_line_apps = lineApps;
        if (Object.keys(serialApps).length) payload.inbound_serial_apps = serialApps;
        payload.inbound_apps_at = new Date().toISOString();
        run(
          `UPDATE thin_journal_docs SET payload_json = ?, updated_at = datetime('now') WHERE id = ?`,
          [JSON.stringify(payload), orderId]
        );
      }
    } catch {
      /* не блокируем требование */
    }

    const task = createTaskFromInboundReceive({
      supplier_order_id: orderId,
      supplier_order_number: body.supplier_order_number,
      supplier_name: body.supplier_name,
      warehouse_id: whId,
      warehouse_name: wh.name,
      comment: body.comment,
      actor_id: actor?.id,
      lines,
    });
    auditFromContext(c, {
      action: 'warehouse_task.create',
      entity: 'warehouse_task',
      entityId: String(task?.id || ''),
      summary: `Требование на оприходование ${task?.number || ''}: заказ ${
        body.supplier_order_number || orderId.slice(0, 8)
      } → ${wh.name}`,
      after: task || {},
    });
    return c.json(
      {
        ok: true,
        warehouse_task: task,
        message: `Создано требование ${task?.number || ''} — передано на склад`,
      },
      201
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Заказ на перемещение: остатки склада → другой склад + задание кладовщику. */
api.post('/stock/transfer-request', async (c) => {
  const actor = actorFromContext(c);
  if (!canDo(actor, 'can_edit_docs') && actor?.role !== 'admin') {
    return c.json({ error: 'Недостаточно прав' }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as {
    warehouse_from_id?: string;
    warehouse_to_id?: string;
    comment?: string;
    post?: boolean;
    deal_id?: string;
    lines?: Array<{ product_id?: string; qty?: number }>;
  };
  try {
    if (!String(body.comment || '').trim()) {
      return c.json({ error: 'Укажите комментарий к заказу на перемещение' }, 400);
    }
    const dealId = String(body.deal_id || '').trim();
    const result = createTransferRequestFromBalances({
      warehouseFromId: String(body.warehouse_from_id || ''),
      warehouseToId: String(body.warehouse_to_id || ''),
      comment: body.comment,
      post: !!body.post,
      deal_id: dealId || undefined,
      lines: Array.isArray(body.lines) ? body.lines : undefined,
    });
    if (dealId) {
      try {
        linkTransferToOrder(dealId, result.id);
      } catch {
        /* */
      }
    }
    let warehouse_task: Record<string, unknown> | null = null;
    try {
      warehouse_task = createTaskFromTransfer({
        stock_doc_id: result.id,
        stock_doc_number: result.number,
        from_label: result.from_label,
        to_label: result.to_label,
        comment: result.user_comment,
        actor_id: actor?.id,
        deal_id: dealId || undefined,
        lines: result.line_details,
      });
    } catch (e) {
      console.warn('transfer warehouse_task', e instanceof Error ? e.message : e);
    }
    let history: Record<string, unknown> | null = null;
    try {
      const lineRows = result.line_details.map((l, i) => ({
        product_id: l.product_id,
        name: l.name,
        article: l.sku,
        qty: l.qty,
        price: 0,
        amount: 0,
        line_no: i + 1,
      }));
      history = createThinJournalDoc('transfer_orders', {
        counterparty_name: `${result.from_label} → ${result.to_label}`,
        comment: dealId
          ? `${result.user_comment} · сделка ${dealId}`
          : result.user_comment,
        status: result.posted ? 'done' : 'new',
        amount: 0,
        payload_json: JSON.stringify({
          kind: 'transfer_request',
          deal_id: dealId,
          stock_doc_id: result.id,
          stock_doc_number: result.number,
          warehouse_from_id: body.warehouse_from_id,
          warehouse_to_id: body.warehouse_to_id,
          from_label: result.from_label,
          to_label: result.to_label,
          user_comment: result.user_comment,
          lines: lineRows,
          line_details: result.line_details,
          warehouse_task_id: warehouse_task?.id || '',
          warehouse_task_number: warehouse_task?.number || '',
          created_by: actor?.id || '',
          created_by_name: actor?.name || '',
        }),
      }) as Record<string, unknown> | null;
    } catch (e) {
      console.warn('transfer_orders thin', e instanceof Error ? e.message : e);
    }
    auditFromContext(c, {
      action: 'doc.transfer_request',
      entity: 'stock_doc',
      entityId: result.id,
      summary: `Заказ на перемещение ${result.number}: ${result.from_label} → ${result.to_label}, ${result.lines} поз. · ${result.user_comment}${
        warehouse_task?.number ? ` · задание ${warehouse_task.number}` : ''
      }${history?.number ? ` · история ${history.number}` : ''}`,
      after: { ...result, warehouse_task, history },
    });
    return c.json({ ...result, warehouse_task, history }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'error' }, 400);
  }
});

/** Каталог + хабы отчётов (MAP → live SQLite / stub). */
api.get('/reports/catalog', (c) => c.json(reportsCatalog()));
api.get('/sales/reports', (c) => c.json(salesReportsHub()));
api.get('/sales/retail-reports', (c) =>
  c.json(retailSalesReport(Number(c.req.query('days') || 60)))
);
api.get('/crm/reports', (c) => c.json(crmReportsHub()));
api.get('/money/reports', (c) => c.json(moneyReportsHub()));
api.get('/company/reports', (c) => c.json(companyReportsHub()));
api.get('/works/reports', (c) => c.json(worksReportsHub()));
