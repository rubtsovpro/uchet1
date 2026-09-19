<template>
  <q-page class="section-page">
    <div class="section-title q-mb-md">Склад</div>

    <div class="section-card">
      <q-tabs
        v-model="section"
        no-caps
        class="text-grey-8"
        active-color="primary"
        indicator-color="primary"
        align="left"
      >
        <q-tab name="tasks" label="Задания" />
        <q-tab name="places" label="Склады" />
      </q-tabs>
      <q-separator />

      <q-tab-panels v-model="section" class="pick-panels bg-transparent">
        <q-tab-panel name="tasks" class="q-pa-none">
          <PickPage embedded />
        </q-tab-panel>

        <q-tab-panel name="places" class="q-pa-none">
          <div class="wh-toolbar">
            <div class="wh-view-tabs" role="tablist" aria-label="Вид складов">
              <button
                type="button"
                class="wh-view-tab"
                :class="{ active: view === 'table' }"
                @click="view = 'table'"
              >
                Таблица
              </button>
              <button
                type="button"
                class="wh-view-tab"
                :class="{ active: view === 'cards' }"
                @click="view = 'cards'"
              >
                Плашки
              </button>
            </div>
          </div>

          <q-banner v-if="error" class="bg-negative text-white q-mt-md" rounded>
            {{ error }}
            <template #action>
              <q-btn flat color="white" label="Ещё раз" @click="loadPlaces" />
            </template>
          </q-banner>

          <div v-else-if="view === 'cards'" class="wh-cards">
            <article
              v-for="row in visible"
              :key="row.id"
              class="wh-card"
              :class="cardClass(row)"
            >
              <div class="wh-card-top">
                <span class="wh-card-code">{{ row.code || '—' }}</span>
                <span class="wh-badge" :class="badge(row).kind">{{ badge(row).label }}</span>
              </div>
              <h3 class="wh-card-title">{{ displayName(row) }}</h3>
              <p v-if="note(row)" class="wh-card-note">{{ note(row) }}</p>
              <div class="wh-card-metrics">
                <div>
                  <span>Позиций</span>
                  <strong>{{ metric(row, 'lines') }}</strong>
                </div>
                <div>
                  <span>Кол-во</span>
                  <strong>{{ metric(row, 'qty') }}</strong>
                </div>
                <div>
                  <span>Сделок</span>
                  <strong>{{ metric(row, 'deals') }}</strong>
                </div>
                <div>
                  <span>Площадка</span>
                  <strong>{{ row.pick_site_label || '—' }}</strong>
                </div>
              </div>
            </article>
            <p v-if="!loading && !visible.length" class="wh-empty">Нет складов</p>
          </div>

          <q-markup-table v-else class="wh-grid" flat dense separator="none" wrap-cells>
            <thead>
              <tr>
                <th class="text-left">Код</th>
                <th class="text-left">Название</th>
                <th class="text-left">Площадка</th>
                <th class="text-right">Кол-во поз.</th>
                <th class="text-right">Кол-во</th>
                <th class="text-right">Сделок</th>
                <th class="text-left">Статус</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in visible" :key="row.id">
                <td class="wh-mono">{{ row.code || '—' }}</td>
                <td>
                  {{ displayName(row) }}
                  <span class="wh-badge" :class="badge(row).kind">{{ badge(row).label }}</span>
                </td>
                <td>{{ row.pick_site_label || '—' }}</td>
                <td class="text-right wh-mono">{{ metric(row, 'lines') }}</td>
                <td class="text-right wh-mono">{{ metric(row, 'qty') }}</td>
                <td class="text-right wh-mono">{{ metric(row, 'deals') }}</td>
                <td>{{ badge(row).label }}</td>
              </tr>
              <tr v-if="!loading && !visible.length">
                <td colspan="7" class="text-grey-6">Нет складов</td>
              </tr>
            </tbody>
          </q-markup-table>
        </q-tab-panel>
      </q-tab-panels>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, inject, provide, ref, watch, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/boot/api';
import PickPage from '@/pages/PickPage.vue';

type Wh = {
  id: string;
  code: string;
  name: string;
  pick_site_label?: string;
  from_1c_podveska?: boolean;
  hs_source?: string;
};

type Tot = {
  warehouse_id: string;
  lines?: number;
  qty?: number;
  deals_count?: number;
};

const VIEW_KEY = 'wms.warehouses.view.v1';

function readSection(raw: unknown): 'tasks' | 'places' {
  return raw === 'places' ? 'places' : 'tasks';
}

function readView(): 'cards' | 'table' {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v === 'cards' || v === 'table') return v;
  } catch {
    /* ignore */
  }
  return 'cards';
}

const route = useRoute();
const router = useRouter();
const section = ref<'tasks' | 'places'>(readSection(route.query.section));
provide('warehouseSection', section);
const view = ref<'cards' | 'table'>(readView());
const contourId = inject<Ref<string>>('contourCompanyId', ref(''));
const rows = ref<Wh[]>([]);
const totals = ref<Record<string, Tot>>({});
const loading = ref(false);
const error = ref('');

watch(view, (mode) => {
  try {
    localStorage.setItem(VIEW_KEY, mode);
  } catch {
    /* ignore */
  }
});

watch(
  () => route.query.section,
  (v) => {
    const next = readSection(v);
    if (section.value !== next) section.value = next;
  }
);

watch(section, (name) => {
  if (name !== 'places') return;
  if (String(route.query.section || '') === 'places') return;
  void router.replace({ query: { ...route.query, section: 'places' } });
});

function codeOf(w: Wh) {
  return String(w.code || '').trim();
}
function nameOf(w: Wh) {
  return String(w.name || '').trim();
}
function codeUp(w: Wh) {
  return codeOf(w).toUpperCase();
}

function isStoDealReserve(w: Wh) {
  const code = codeUp(w);
  if (code === 'STO-RSV-MSK' || code.startsWith('STO-RSV-')) return true;
  return /^резерв\s*сто/i.test(nameOf(w));
}
function isStoReserve(w: Wh) {
  if (isStoDealReserve(w)) return false;
  const code = codeUp(w);
  if (code === 'STO-RES-MSK' || code === 'STO-RES-STRELA' || code.startsWith('STO-RES-')) return true;
  return /отложено\s*под\s*сто/i.test(nameOf(w));
}
function isVirtualSto(w: Wh) {
  return codeUp(w) === 'STO';
}
function isCourier(w: Wh) {
  if (codeUp(w) === 'COURIER') return true;
  return /^склад\s*курьера$/i.test(nameOf(w));
}
function isWaitPay(w: Wh) {
  const code = codeUp(w);
  return code === 'WAIT-PAY' || code.startsWith('WAIT-PAY.') || /ожидание\s*оплат/i.test(nameOf(w));
}
function isAutoSys(w: Wh) {
  if (isStoReserve(w) || isStoDealReserve(w) || isWaitPay(w)) return true;
  const code = codeUp(w);
  if (code === 'IN-TRANSIT' || code === 'WAIT-PAY') return true;
  const name = nameOf(w);
  return /^в\s*пути$/i.test(name) || /не\s*найден|недопоставк|доукомплект|ожидание\s*оплат/i.test(name);
}
function isEmptyJunk(w: Wh) {
  const code = codeUp(w);
  const name = nameOf(w);
  if (
    code === 'STO-RES-STRELA' ||
    code === 'STO-RES-FOGEL' ||
    (code.startsWith('STO-RES-') && code !== 'STO-RES-MSK')
  ) {
    return true;
  }
  if (code === 'НФ-000044' || code === 'НФ-000047') return true;
  if (isStoReserve(w) && code === 'STO-RES-MSK') return false;
  if (isStoDealReserve(w) && code === 'STO-RSV-MSK') return false;
  if (isStoReserve(w)) return true;
  if (
    code === '1C-NONE' ||
    code === 'KRD' ||
    code === 'MAIN' ||
    code === 'MSK' ||
    code === '00-000001' ||
    code === '00-000002' ||
    code === 'CDEK' ||
    code === 'BUS' ||
    code === 'IN-TRANSIT' ||
    code.startsWith('IN-TRANSIT.') ||
    code === 'WAIT-PAY' ||
    code.startsWith('WAIT-PAY.') ||
    code === 'PROD-WIP' ||
    code.startsWith('PROD-WIP.') ||
    code === 'НФ-000033' ||
    code === 'НФ-000035' ||
    code === 'НФ-000036' ||
    code === 'НФ-000043' ||
    code.startsWith('НФ-000037:')
  ) {
    return true;
  }
  if (/ожидание\s*оплат/i.test(name)) return true;
  if (/^в\s*пути/i.test(name)) return true;
  if (/сборк.*разбор|разбор.*сборк/i.test(name)) return true;
  if (/доукомплект|недопоставк|не\s*найден|основное\s*подразделение|малярк/i.test(name)) return true;
  if (/сто\s*фадеева|сто\s*стрела/i.test(name)) return true;
  return false;
}
function isMainDup(w: Wh, list: Wh[]) {
  if (codeUp(w) !== 'MAIN') return false;
  return list.some((x) => codeOf(x) === 'НФ-000032');
}
function from1c(w: Wh) {
  return !!(w.from_1c_podveska || w.hs_source === 'pnevmopodveska_2025');
}

function displayName(w: Wh) {
  const code = codeOf(w);
  const name = nameOf(w);
  if (code === 'НФ-000032' || /^филиал\s*москва$/i.test(name)) return 'Основной';
  if (code === 'STO-RSV-MSK' || /^резерв\s*сто$/i.test(name)) return 'Резерв СТО';
  if (/^STO-RSV-/i.test(code)) return /стрел/i.test(name + code) ? 'Резерв СТО · Стрела' : 'Резерв СТО';
  if (code === 'STO-RES-MSK') return 'Отложено под СТО';
  if (code === 'STO-RES-STRELA') return 'Отложено под СТО · Стрела';
  if (/^STO-RES-/i.test(code) || /^отложено\s*под\s*сто/i.test(name)) {
    if (/стрел/i.test(name) || /STRELA/i.test(code)) return 'Отложено под СТО · Стрела';
    return 'Отложено под СТО';
  }
  if (code === 'STO' || /^склад\s*сто$/i.test(name)) return 'СТО';
  if (code === '00-000001' || /склад\s*сто\s*москва/i.test(name)) return 'СТО Москва (1С)';
  if (code === 'COURIER' || /^склад\s*курьера$/i.test(name)) return 'Курьер';
  if (code === 'НФ-000037' || /склад\s*брак|брак.*рекламац|рекламац.*брак/i.test(name)) {
    return 'Брак/Рекламация';
  }
  if (code === 'НФ-000034' || /б\/?у\s*зпч|склад\s*б\/?у/i.test(name)) return 'Б/У запчасти';
  return name || '—';
}

function badge(w: Wh): { label: string; kind: string } {
  if (isStoDealReserve(w)) return { label: 'Резерв СТО', kind: 'is-hold' };
  if (isStoReserve(w)) return { label: 'Отложено', kind: 'is-hold' };
  if (isVirtualSto(w)) return { label: 'СТО · только сделки', kind: 'is-sto' };
  if (from1c(w)) {
    const sto = codeOf(w) === '00-000001' || /склад\s*сто/i.test(nameOf(w));
    return { label: sto ? '1С · СТО' : '1С · Подвеска', kind: 'is-1c' };
  }
  if (isAutoSys(w)) return { label: 'Авто', kind: 'is-sys' };
  return { label: 'Активен', kind: 'is-plain' };
}

function note(w: Wh) {
  if (isStoDealReserve(w)) return 'Товар по сделкам самовывоз / автосервис после передачи в резерв.';
  if (isStoReserve(w)) return 'Лежит на тех же стеллажах, но отложено под СТО — с обычного склада не продаём.';
  if (isVirtualSto(w)) return 'СТО: только товар по открытым сделкам.';
  if (isAutoSys(w)) return 'Системный склад: перемещения только автоматически.';
  return '';
}

function cardClass(w: Wh) {
  return {
    'is-sys': isAutoSys(w),
    'is-1c': from1c(w),
    'is-hold': isStoReserve(w) || isStoDealReserve(w),
    'is-sto': isVirtualSto(w),
  };
}

function rank(w: Wh) {
  if (!from1c(w)) return 2;
  const code = codeOf(w);
  if (code === 'НФ-000032') return 0;
  if (code === '00-000001') return 1;
  if (code === 'STO-RES-MSK' || code === 'STO-RES-STRELA' || /^STO-RES-/i.test(code)) return 3;
  if (code === 'STO') return 4;
  return 2;
}

const visible = computed(() => {
  const list = rows.value.filter((w) => !isEmptyJunk(w) && !isMainDup(w, rows.value));
  return [...list].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    return displayName(a).localeCompare(displayName(b), 'ru');
  });
});

function metric(w: Wh, kind: 'lines' | 'qty' | 'deals') {
  const t = totals.value[w.id];
  if (!t) return loading.value ? '…' : '—';
  if (kind === 'deals') {
    if (isStoReserve(w)) return '—';
    const dealWh = isVirtualSto(w) || isStoDealReserve(w) || isCourier(w);
    if (dealWh) return t.deals_count != null ? String(t.deals_count) : '0';
    return t.deals_count != null ? String(t.deals_count) : '—';
  }
  const n = kind === 'lines' ? t.lines : t.qty;
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  return Math.abs(v - Math.round(v)) < 0.0001 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

async function loadPlaces() {
  const id = String(contourId.value || '').trim();
  if (!id) {
    rows.value = [];
    totals.value = {};
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const [list, stock] = await Promise.all([
      api.get<Wh[]>(`/api/warehouses?company_id=${encodeURIComponent(id)}`),
      api.get<{ items?: Tot[] }>('/api/warehouses/stock-totals?qty_only=1').catch(() => ({ items: [] })),
    ]);
    rows.value = (Array.isArray(list) ? list : []).map((w) => ({
      ...w,
      id: String(w.id || ''),
      code: String(w.code || ''),
      name: String(w.name || ''),
    }));
    const map: Record<string, Tot> = {};
    for (const t of stock.items || []) {
      if (t.warehouse_id) map[String(t.warehouse_id)] = t;
    }
    totals.value = map;
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

watch([section, contourId], () => {
  if (section.value === 'places') void loadPlaces();
});
</script>

<style scoped>
.wh-toolbar {
  display: flex;
  align-items: center;
  padding: 10px 12px 0;
}
.wh-view-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 10px;
  background: #f1f4f6;
}
.wh-view-tab {
  border: 0;
  background: transparent;
  color: #64748b;
  font: inherit;
  font-size: 13px;
  line-height: 1;
  min-height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  cursor: pointer;
}
.wh-view-tab.active {
  background: #fff;
  color: #0f766e;
  font-weight: 600;
}
.wh-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  padding: 12px;
}
.wh-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 140px;
  padding: 14px 14px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #fff;
}
.wh-card.is-1c {
  border-color: #93c5fd;
  background: linear-gradient(180deg, #eff6ff 0%, #fff 48%);
}
.wh-card.is-sys {
  border-color: #99f6e4;
  background: linear-gradient(180deg, #f0fdfa 0%, #fff 48%);
}
.wh-card.is-hold {
  border-color: #fcd34d;
  background: linear-gradient(180deg, #fffbeb 0%, #fff 48%);
}
.wh-card.is-sto {
  border-color: #fdba74;
  background: linear-gradient(180deg, #fff7ed 0%, #fff 48%);
}
.wh-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.wh-card-code,
.wh-mono {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #64748b;
}
.wh-card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  color: #0f172a;
}
.wh-card-note {
  margin: -4px 0 0;
  font-size: 12px;
  line-height: 1.35;
  color: #64748b;
}
.wh-card-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
}
.wh-card-metrics > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.wh-card-metrics span {
  font-size: 11px;
  color: #94a3b8;
}
.wh-card-metrics strong {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.wh-badge {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  vertical-align: middle;
}
.wh-card-top .wh-badge {
  margin-left: 0;
}
.wh-badge.is-1c {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #93c5fd;
}
.wh-badge.is-hold {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fcd34d;
}
.wh-badge.is-sto {
  background: #ffedd5;
  color: #9a3412;
  border: 1px solid #fdba74;
}
.wh-badge.is-sys,
.wh-badge.is-plain {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #e2e8f0;
}
.wh-empty {
  grid-column: 1 / -1;
  margin: 0;
  color: #94a3b8;
}
.wh-grid {
  background: transparent;
}
.wh-grid :deep(th),
.wh-grid :deep(td) {
  border: 0;
  border-bottom: 1px solid #eef2f6;
  padding: 8px 12px;
}
.wh-grid :deep(th) {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 500;
}
</style>
