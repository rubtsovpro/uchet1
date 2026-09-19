<template>
  <component :is="embedded ? 'div' : 'q-page'" :class="embedded ? '' : 'section-page'">
    <div v-if="!embedded" class="section-title q-mb-md">Задания складу</div>

    <div class="section-card">
    <div class="row items-center q-gutter-sm q-pa-sm">
      <q-input
        v-model="filterQ"
        dense
        outlined
        rounded
        clearable
        placeholder="Номер, сделка, клиент"
        class="col-grow"
        style="max-width: 360px"
      >
        <template #prepend><q-icon name="search" /></template>
      </q-input>
    </div>

    <q-tabs v-model="tab" no-caps class="text-grey-8" active-color="primary" indicator-color="primary" align="left">
      <q-tab name="handoffs" :label="`Перемещения · ${filteredHandoffs.length}`" />
      <q-tab name="open" :label="`Производство · ${filteredOpen.length}`" />
      <q-tab name="returns" :label="`Возвраты · ${filteredReturns.length}`" />
      <q-tab name="done" :label="`Закрытые · ${completedTotal}`" />
    </q-tabs>
    <q-separator />

    <div class="pick-pager">
      <q-btn
        flat
        dense
        round
        icon="sym_o_chevron_left"
        color="grey-7"
        :disable="currentPage <= 1"
        @click="shiftPage(-1)"
      />
      <span class="pick-pager-n">{{ currentPage }} / {{ currentPages }}</span>
      <q-btn
        flat
        dense
        round
        icon="sym_o_chevron_right"
        color="grey-7"
        :disable="currentPage >= currentPages"
        @click="shiftPage(1)"
      />
    </div>

    <q-banner v-if="error" class="bg-negative text-white q-mt-md" rounded>
      {{ error }}
      <template #action>
        <q-btn flat color="white" label="Ещё раз" @click="load" />
      </template>
    </q-banner>

    <q-tab-panels v-model="tab" class="pick-panels bg-transparent">
      <q-tab-panel name="open" class="q-pa-none">
        <div v-for="g in openGroups" :key="g.key" class="q-mb-md">
          <div class="text-subtitle2 q-mb-xs">{{ g.label }} · {{ g.tasks.length }}</div>
          <q-list class="q-gutter-y-sm">
            <PickCard
              v-for="row in g.tasks"
              :key="String(row.id || row.number)"
              :row="row"
              :busy-id="busyId"
              @complete="completeHandoff"
              @cancel="cancelHandoff"
              @cdek="openCdek"
              @line-source="setLineSource"
            />
            <q-item v-if="!g.tasks.length">
              <q-item-section class="text-grey-6">Пусто</q-item-section>
            </q-item>
          </q-list>
        </div>
        <q-item v-if="!loading && !filteredOpen.length" class="text-grey-6">
          Нет заданий на производство
        </q-item>
      </q-tab-panel>

      <q-tab-panel name="handoffs" class="q-pa-none">
        <q-list class="q-gutter-y-sm">
          <PickCard
            v-for="row in pagedHandoffs"
            :key="String(row.id)"
            :row="row"
            mode="handoff"
            :busy-id="busyId"
            @complete="completeHandoff"
            @cancel="cancelHandoff"
            @cdek="openCdek"
            @line-source="setLineSource"
          />
          <q-item v-if="!loading && !filteredHandoffs.length">
            <q-item-section class="text-grey-6">Нет перемещений</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <q-tab-panel name="returns" class="q-pa-none">
        <q-list class="q-gutter-y-sm">
          <PickCard
            v-for="row in pagedReturns"
            :key="String(row.deal_id || row.id)"
            :row="row"
            mode="return"
            :busy-id="busyId"
            @complete-return="completeReturn"
          />
          <q-item v-if="!loading && !filteredReturns.length">
            <q-item-section class="text-grey-6">Нет возвратов</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <q-tab-panel name="done" class="q-pa-none">
        <q-list class="q-gutter-y-sm">
          <PickCard
            v-for="row in completed"
            :key="String(row.id)"
            :row="row"
            mode="done"
            :busy-id="busyId"
            @cancel="cancelHandoff"
            @cdek="openCdek"
            @line-source="setLineSource"
          />
          <q-item v-if="!loading && !completed.length">
            <q-item-section class="text-grey-6">Нет закрытых</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>
    </q-tab-panels>
    </div>

    <q-dialog v-model="cdekOpen" persistent maximized-mobile>
      <q-card class="cdek-card" :class="{ 'is-wide': cdekMulti }">
        <q-card-section class="row items-center">
          <div class="text-h6">СДЭК · места · {{ cdekDealId }}</div>
          <q-space />
          <q-btn flat round icon="close" v-close-popup />
        </q-card-section>
        <q-card-section>
          <div v-if="cdekErr" class="text-negative q-mb-sm">{{ cdekErr }}</div>
          <div class="row q-gutter-sm items-center q-mb-md">
            <div class="text-subtitle2">Мест: {{ cdekBoxes }}</div>
            <q-btn dense flat icon="remove" :disable="cdekBoxes <= 1" @click="cdekBoxes--" />
            <q-btn dense flat icon="add" :disable="cdekBoxes >= cdekMax" @click="cdekBoxes++" />
          </div>
          <div v-if="cdekMulti" class="cdek-places">
            <div
              v-for="(box, bi) in cdekDims"
              :key="bi"
              class="cdek-place"
              :class="{ 'is-over': cdekOver === bi + 1 }"
              @dragover.prevent="cdekOver = bi + 1"
              @dragleave="cdekOver = 0"
              @drop="dropUnit(bi + 1, $event)"
            >
              <div class="cdek-place-h">Место {{ bi + 1 }}</div>
              <div class="cdek-chips">
                <div
                  v-for="u in unitsIn(bi + 1)"
                  :key="u.unit_key"
                  class="cdek-chip"
                  draggable="true"
                  @dragstart="dragUnit(u.unit_key, $event)"
                >
                  <b>{{ u.sku || '—' }}</b>
                  <span>{{ u.title }}</span>
                  <span v-if="u.qty_total > 1" class="cdek-chip-n">{{ u.unit_index }}/{{ u.qty_total }}</span>
                </div>
                <div v-if="!unitsIn(bi + 1).length" class="cdek-empty">Перетащите товар сюда</div>
              </div>
              <div class="row q-gutter-xs">
                <q-input v-model.number="box.l" type="number" dense outlined label="Д, см" class="cdek-dim" />
                <q-input v-model.number="box.w" type="number" dense outlined label="Ш, см" class="cdek-dim" />
                <q-input v-model.number="box.h" type="number" dense outlined label="В, см" class="cdek-dim" />
                <q-input v-model.number="box.weight" type="number" dense outlined label="Вес, кг" class="cdek-dim" />
              </div>
            </div>
          </div>
          <div v-else v-for="(box, bi) in cdekDims" :key="bi" class="row q-gutter-sm q-mb-sm">
            <q-input v-model.number="box.l" type="number" dense outlined label="Д, см" style="width: 90px" />
            <q-input v-model.number="box.w" type="number" dense outlined label="Ш, см" style="width: 90px" />
            <q-input v-model.number="box.h" type="number" dense outlined label="В, см" style="width: 90px" />
            <q-input v-model.number="box.weight" type="number" dense outlined label="Вес, кг" style="width: 100px" />
          </div>
        </q-card-section>
        <q-card-actions align="right" class="cdek-actions">
          <q-btn class="btn-cancel" flat dense no-caps label="Отмена" v-close-popup />
          <q-btn outline dense no-caps label="Пересоздать" :loading="cdekBusy" @click="regenCdek" />
          <q-btn class="cdek-save" unelevated dense no-caps label="Сохранить" :loading="cdekBusy" @click="saveCdek" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </component>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, reactive, ref, watch, type ComputedRef, type Ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/api';
import PickCard from '@/components/PickCard.vue';

withDefaults(
  defineProps<{
    embedded?: boolean;
  }>(),
  { embedded: false }
);

type Board = {
  counts?: { open?: number };
  open?: Array<Record<string, unknown>>;
  groups?: Array<{ key?: string; label?: string; tasks?: Array<Record<string, unknown>> }>;
  handoffs_completed_total?: number;
};
type ListResp = { items?: Array<Record<string, unknown>>; completed_total?: number };
type PageResp = {
  items?: Array<Record<string, unknown>>;
  total?: number;
  page?: number;
  pages?: number;
};
const siteRef = inject<ComputedRef<string> | Ref<string>>('contourSite', ref('msk'));
const sectionRef = inject<Ref<string>>('warehouseSection', ref('tasks'));
const site = computed(() => {
  const v = String(siteRef.value || 'msk');
  return v === 'strela' || v === 'fogel' ? v : 'msk';
});
const PICK_TABS = ['handoffs', 'open', 'returns', 'done'] as const;
type PickTab = (typeof PICK_TABS)[number];
const route = useRoute();
const router = useRouter();

function pickTab(raw: unknown): PickTab {
  const v = String(raw || '').trim();
  return (PICK_TABS as readonly string[]).includes(v) ? (v as PickTab) : 'handoffs';
}
function pickPage(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const tab = ref<PickTab>(pickTab(route.query.tab));
const filterQ = ref('');

const loading = ref(false);
const error = ref('');
const busyId = ref('');
const board = ref<Board | null>(null);
const handoffs = ref<Array<Record<string, unknown>>>([]);
const returns = ref<Array<Record<string, unknown>>>([]);
const completed = ref<Array<Record<string, unknown>>>([]);
const completedTotal = ref(0);
const donePages = ref(1);
const pageSize = 15;
const startPage = pickPage(route.query.page);
const pageOf = reactive({
  handoffs: tab.value === 'handoffs' ? startPage : 1,
  open: tab.value === 'open' ? startPage : 1,
  returns: tab.value === 'returns' ? startPage : 1,
  done: tab.value === 'done' ? startPage : 1,
});

const cdekOpen = ref(false);
const cdekDealId = ref('');
const cdekErr = ref('');
const cdekBusy = ref(false);
const cdekBoxes = ref(1);
const cdekMax = ref(1);
const cdekOver = ref(0);
const cdekDrag = ref('');
type CdekUnit = {
  unit_key: string;
  title: string;
  sku: string;
  unit_index: number;
  qty_total: number;
};
type CdekDim = { l: number; w: number; h: number; weight: number };
const cdekUnits = ref<CdekUnit[]>([]);
const cdekBoxOf = ref<Record<string, number>>({});
const cdekDims = ref<CdekDim[]>([{ l: 20, w: 20, h: 20, weight: 1 }]);
const cdekMulti = computed(() => cdekUnits.value.length > 1);

function blankDim(): CdekDim {
  return { l: 20, w: 20, h: 20, weight: 1 };
}
function dimOr(n: number, fallback: number): number {
  return Number(n) > 0 ? Number(n) : fallback;
}

watch(cdekBoxes, (n) => {
  const count = Math.max(1, Math.min(n, cdekMax.value || n));
  if (count !== n) {
    cdekBoxes.value = count;
    return;
  }
  while (cdekDims.value.length < count) cdekDims.value.push(blankDim());
  if (cdekDims.value.length > count) cdekDims.value = cdekDims.value.slice(0, count);
  const next = { ...cdekBoxOf.value };
  for (const key of Object.keys(next)) {
    if (next[key] > count || next[key] < 1) next[key] = count;
  }
  cdekBoxOf.value = next;
});

function unitsIn(box: number): CdekUnit[] {
  return cdekUnits.value.filter((u) => (cdekBoxOf.value[u.unit_key] || 1) === box);
}
function dragUnit(key: string, ev: DragEvent) {
  cdekDrag.value = key;
  ev.dataTransfer?.setData('text/plain', key);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
}
function dropUnit(box: number, ev: DragEvent) {
  const key = ev.dataTransfer?.getData('text/plain') || cdekDrag.value;
  cdekOver.value = 0;
  if (!key) return;
  cdekBoxOf.value = { ...cdekBoxOf.value, [key]: box };
}
function cdekPayload(): Record<string, unknown> {
  const count = cdekDims.value.length;
  if (!cdekMulti.value || count <= 1) {
    const b = cdekDims.value[0] || blankDim();
    return {
      packages_count: 1,
      split_packages: false,
      package_length_cm: b.l,
      package_width_cm: b.w,
      package_height_cm: b.h,
      package_weight_kg: b.weight,
    };
  }
  const dims: Record<string, { weight_kg: number; length_cm: number; width_cm: number; height_cm: number }> = {};
  cdekDims.value.forEach((b, i) => {
    dims[String(i + 1)] = {
      weight_kg: Number(b.weight) || 0,
      length_cm: Number(b.l) || 0,
      width_cm: Number(b.w) || 0,
      height_cm: Number(b.h) || 0,
    };
  });
  const boxes: Record<string, number> = {};
  for (const u of cdekUnits.value) {
    const n = cdekBoxOf.value[u.unit_key] || 1;
    boxes[u.unit_key] = Math.min(count, Math.max(1, n));
  }
  return {
    packages_count: count,
    split_packages: true,
    package_item_boxes: boxes,
    package_boxes_dims: dims,
  };
}
function cdekSplitError(): string {
  if (!cdekMulti.value || cdekDims.value.length <= 1) return '';
  for (let i = 1; i <= cdekDims.value.length; i++) {
    if (!unitsIn(i).length) return `В месте ${i} нет товаров`;
  }
  return '';
}

const openRows = computed(() => board.value?.open || []);

function matchRow(row: Record<string, unknown>): boolean {
  const q = filterQ.value.trim().toLowerCase();
  if (!q) return true;
  const d = row.deal as Record<string, unknown> | undefined;
  const hay = [row.number, row.deal_id, row.buyer_name, row.route_label, row.purpose_label, d?.title, d?.buyer_name, row.cdek_number]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
  return hay.includes(q);
}

const filteredOpen = computed(() => openRows.value.filter(matchRow));
const filteredHandoffs = computed(() => handoffs.value.filter(matchRow));
const filteredReturns = computed(() => returns.value.filter(matchRow));

function pageCount(n: number): number {
  return Math.max(1, Math.ceil(Math.max(0, n) / pageSize));
}
function pageSlice<T>(rows: T[], page: number): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

const pagedHandoffs = computed(() => pageSlice(filteredHandoffs.value, pageOf.handoffs));
const pagedReturns = computed(() => pageSlice(filteredReturns.value, pageOf.returns));
const pagedOpen = computed(() => pageSlice(filteredOpen.value, pageOf.open));

const currentPage = computed({
  get() {
    if (tab.value === 'open') return pageOf.open;
    if (tab.value === 'returns') return pageOf.returns;
    if (tab.value === 'done') return pageOf.done;
    return pageOf.handoffs;
  },
  set(n: number) {
    if (tab.value === 'open') pageOf.open = n;
    else if (tab.value === 'returns') pageOf.returns = n;
    else if (tab.value === 'done') pageOf.done = n;
    else pageOf.handoffs = n;
  },
});
const currentPages = computed(() => {
  if (tab.value === 'open') return pageCount(filteredOpen.value.length);
  if (tab.value === 'returns') return pageCount(filteredReturns.value.length);
  if (tab.value === 'done') return donePages.value;
  return pageCount(filteredHandoffs.value.length);
});

function shiftPage(delta: number) {
  currentPage.value = Math.min(currentPages.value, Math.max(1, currentPage.value + delta));
}

let urlLock = false;
function writeUrl() {
  const page = String(pageOf[tab.value]);
  const section = sectionRef.value === 'places' ? 'places' : 'tasks';
  if (
    String(route.query.tab || '') === tab.value &&
    String(route.query.page || '') === page &&
    String(route.query.section || '') === section
  ) {
    return;
  }
  urlLock = true;
  void router.replace({ query: { ...route.query, section, tab: tab.value, page } }).finally(() => {
    urlLock = false;
  });
}

watch(
  () => [tab.value, pageOf.handoffs, pageOf.open, pageOf.returns, pageOf.done] as const,
  () => {
    if (!urlLock) writeUrl();
  },
  { immediate: true }
);

watch(
  () => [String(route.query.tab || ''), String(route.query.page || '')] as const,
  ([qTab, qPage]) => {
    if (urlLock) return;
    const nextTab = pickTab(qTab);
    const nextPage = pickPage(qPage);
    if (tab.value !== nextTab) tab.value = nextTab;
    if (pageOf[nextTab] !== nextPage) pageOf[nextTab] = nextPage;
  }
);

function clampClientPages() {
  pageOf.handoffs = Math.min(pageOf.handoffs, pageCount(filteredHandoffs.value.length));
  pageOf.open = Math.min(pageOf.open, pageCount(filteredOpen.value.length));
  pageOf.returns = Math.min(pageOf.returns, pageCount(filteredReturns.value.length));
}

const openGroups = computed(() => {
  const source = pagedOpen.value;
  const groups = board.value?.groups;
  if (Array.isArray(groups) && groups.length) {
    const allowed = new Set(source.map((row) => String(row.id || row.number || '')));
    return groups
      .map((g) => ({
        key: String(g.key || g.label || 'g'),
        label: String(g.label || g.key || 'Задачи'),
        tasks: (g.tasks || []).filter((row) => allowed.has(String(row.id || row.number || '')) && matchRow(row)),
      }))
      .filter((g) => g.tasks.length);
  }
  const byType = new Map<string, Array<Record<string, unknown>>>();
  for (const row of source) {
    const key = String(row.pick_type || row.channel || 'other');
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(row);
  }
  return [...byType.entries()].map(([key, tasks]) => ({
    key,
    label: key === 'production' ? 'Производство' : key,
    tasks,
  }));
});

async function loadDone() {
  const q = encodeURIComponent(site.value);
  const search = filterQ.value.trim();
  const searchQ = search ? `&q=${encodeURIComponent(search)}` : '';
  const done = await api.get<PageResp>(
    `/api/warehouse/pick/handoffs/completed?site=${q}&page=${pageOf.done}&limit=${pageSize}${searchQ}`
  );
  completed.value = done.items || [];
  completedTotal.value = Number(done.total || 0);
  donePages.value = Math.max(1, Number(done.pages) || pageCount(completedTotal.value));
  const safe = Math.max(1, Number(done.page) || 1);
  if (pageOf.done > donePages.value) pageOf.done = safe;
}

async function load() {
  loading.value = true;
  error.value = '';
  const q = encodeURIComponent(site.value);
  try {
    const [today, ho, ret] = await Promise.all([
      api.get<Board>(`/api/warehouse/pick/today?site=${q}`),
      api.get<ListResp>(`/api/warehouse/pick/handoffs?site=${q}&limit=40`),
      api.get<ListResp>(`/api/warehouse/pick/returns?site=${q}`),
      loadDone(),
    ]);
    board.value = today;
    handoffs.value = ho.items || [];
    returns.value = ret.items || [];
    clampClientPages();
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

watch(
  () => pageOf.done,
  () => {
    void loadDone().catch((e) => {
      error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
    });
  }
);

let filterTimer: ReturnType<typeof setTimeout> | undefined;
watch(filterQ, () => {
  pageOf.handoffs = 1;
  pageOf.open = 1;
  pageOf.returns = 1;
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    if (pageOf.done !== 1) pageOf.done = 1;
    else {
      void loadDone().catch((e) => {
        error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
      });
    }
  }, 300);
});

watch([filteredHandoffs, filteredOpen, filteredReturns], clampClientPages);

async function completeHandoff(id: string) {
  busyId.value = id;
  try {
    await api.post(`/api/warehouse/pick/handoffs/${encodeURIComponent(id)}/complete`, {});
    Notify.create({ type: 'positive', message: 'Расходная проведена' });
    await load();
  } catch (e) {
    Notify.create({ type: 'negative', message: e instanceof Error ? e.message : 'Ошибка' });
  } finally {
    busyId.value = '';
  }
}

async function cancelHandoff(id: string) {
  Dialog.create({
    title: 'Не собрали',
    prompt: { model: '', type: 'text', label: 'Комментарий' },
    cancel: true,
    persistent: true,
  }).onOk(async (comment: string) => {
    if (!String(comment || '').trim()) {
      Notify.create({ type: 'warning', message: 'Нужен комментарий' });
      return;
    }
    busyId.value = `cancel:${id}`;
    try {
      await api.post(`/api/warehouse/pick/handoffs/${encodeURIComponent(id)}/cancel`, {
        comment: String(comment).trim(),
      });
      Notify.create({ type: 'positive', message: 'Отменено' });
      await load();
    } catch (e) {
      Notify.create({ type: 'negative', message: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      busyId.value = '';
    }
  });
}

async function completeReturn(dealId: string) {
  busyId.value = `ret:${dealId}`;
  try {
    await api.post(`/api/warehouse/pick/returns/${encodeURIComponent(dealId)}/complete`, {});
    Notify.create({ type: 'positive', message: 'Возврат проведён' });
    await load();
  } catch (e) {
    Notify.create({ type: 'negative', message: e instanceof Error ? e.message : 'Ошибка' });
  } finally {
    busyId.value = '';
  }
}

async function setLineSource(payload: { id: string; product_id: string; warehouse_id: string }) {
  busyId.value = `ls:${payload.id}:${payload.product_id}`;
  try {
    await api.post(`/api/warehouse/pick/handoffs/${encodeURIComponent(payload.id)}/line-source`, {
      product_id: payload.product_id,
      warehouse_id: payload.warehouse_id,
    });
    Notify.create({ type: 'positive', message: 'Склад-источник обновлён' });
    await load();
  } catch (e) {
    Notify.create({ type: 'negative', message: e instanceof Error ? e.message : 'Ошибка' });
  } finally {
    busyId.value = '';
  }
}

async function openCdek(dealId: string) {
  cdekDealId.value = dealId;
  cdekErr.value = '';
  cdekOpen.value = true;
  cdekBusy.value = true;
  cdekUnits.value = [];
  cdekBoxOf.value = {};
  cdekMax.value = 1;
  try {
    const pack = await api.get<Record<string, unknown>>(
      `/api/warehouse/pick/handoffs/${encodeURIComponent(dealId)}/cdek-pack`
    );
    const units = Array.isArray(pack.units) ? (pack.units as Array<Record<string, unknown>>) : [];
    cdekUnits.value = units
      .map((u) => ({
        unit_key: String(u.unit_key || '').trim(),
        title: String(u.title || u.sku || 'Позиция'),
        sku: String(u.sku || '').trim(),
        unit_index: Number(u.unit_index) || 1,
        qty_total: Number(u.qty_total) || 1,
      }))
      .filter((u) => u.unit_key);
    const max = Number(pack.packages_max) || cdekUnits.value.length || 1;
    cdekMax.value = Math.max(1, max);
    const savedBoxes = (pack.package_item_boxes || {}) as Record<string, number>;
    const assigned: Record<string, number> = {};
    cdekUnits.value.forEach((u, i) => {
      const n = Number(savedBoxes[u.unit_key]) || 0;
      assigned[u.unit_key] = n >= 1 ? n : (i % cdekMax.value) + 1;
    });
    const dimsRaw = (pack.package_boxes_dims || {}) as Record<
      string,
      { weight_kg?: number; length_cm?: number; width_cm?: number; height_cm?: number }
    >;
    const count = Math.max(1, Math.min(cdekMax.value, Number(pack.packages_count) || 1));
    const fallback: CdekDim = {
      l: dimOr(Number(pack.package_length_cm), 20),
      w: dimOr(Number(pack.package_width_cm), 20),
      h: dimOr(Number(pack.package_height_cm), 20),
      weight: dimOr(Number(pack.package_weight_kg), 1),
    };
    const dims: CdekDim[] = [];
    for (let i = 1; i <= count; i++) {
      const box = dimsRaw[String(i)] || {};
      dims.push({
        l: dimOr(Number(box.length_cm), fallback.l),
        w: dimOr(Number(box.width_cm), fallback.w),
        h: dimOr(Number(box.height_cm), fallback.h),
        weight: dimOr(Number(box.weight_kg), fallback.weight),
      });
    }
    cdekBoxOf.value = assigned;
    cdekDims.value = dims;
    cdekBoxes.value = count;
  } catch (e) {
    cdekErr.value = e instanceof Error ? e.message : 'Не удалось загрузить';
  } finally {
    cdekBusy.value = false;
  }
}

async function saveCdek() {
  const splitErr = cdekSplitError();
  if (splitErr) {
    cdekErr.value = splitErr;
    return;
  }
  cdekBusy.value = true;
  cdekErr.value = '';
  try {
    await api.post(`/api/warehouse/pick/handoffs/${encodeURIComponent(cdekDealId.value)}/cdek-pack`, cdekPayload());
    Notify.create({ type: 'positive', message: 'Места СДЭК сохранены' });
    cdekOpen.value = false;
  } catch (e) {
    cdekErr.value = e instanceof Error ? e.message : 'Ошибка сохранения';
  } finally {
    cdekBusy.value = false;
  }
}

async function regenCdek() {
  const splitErr = cdekSplitError();
  if (splitErr) {
    cdekErr.value = splitErr;
    return;
  }
  cdekBusy.value = true;
  cdekErr.value = '';
  try {
    await api.post(
      `/api/warehouse/pick/handoffs/${encodeURIComponent(cdekDealId.value)}/cdek-regenerate`,
      cdekPayload()
    );
    Notify.create({ type: 'positive', message: 'СДЭК пересоздан' });
  } catch (e) {
    cdekErr.value = e instanceof Error ? e.message : 'Ошибка';
  } finally {
    cdekBusy.value = false;
  }
}

watch(site, () => {
  pageOf.handoffs = 1;
  pageOf.open = 1;
  pageOf.returns = 1;
  pageOf.done = 1;
  void load();
});

onMounted(() => {
  void load();
});
</script>

<style scoped>
.pick-page :deep(.q-tab-panels) {
  background: transparent;
}
.pick-pager {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding: 4px 8px 0;
}
.pick-pager-n {
  min-width: 72px;
  text-align: center;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: #64748b;
}
.cdek-card {
  min-width: 420px;
  max-width: 640px;
}
.cdek-card.is-wide {
  min-width: 720px;
  max-width: 960px;
  width: 92vw;
}
.cdek-actions {
  gap: 8px;
}
.cdek-card :deep(.q-btn:not(.q-btn--round)) {
  border-radius: 10px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  min-height: 32px;
}
.cdek-card :deep(.cdek-save) {
  background: #0f766e !important;
  color: #fff !important;
  box-shadow: none !important;
  padding: 0 14px;
}
.cdek-card :deep(.q-btn--outline) {
  background: #f1f4f6 !important;
  color: #0f766e !important;
  padding: 0 12px;
}
.cdek-card :deep(.q-btn--outline::before) {
  border: 0;
}
.cdek-card :deep(.btn-cancel) {
  background: transparent !important;
  color: #dc2626 !important;
  box-shadow: none !important;
  min-height: 0;
  padding: 0 4px;
}
.cdek-card :deep(.btn-cancel .q-focus-helper) {
  display: none;
}
.cdek-places {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}
.cdek-place {
  border: 1px dashed #cbd5e1;
  border-radius: 10px;
  padding: 10px;
  background: #f8fafc;
}
.cdek-place.is-over {
  border-color: #0f766e;
  background: #f0fdfa;
}
.cdek-place-h {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}
.cdek-chip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  padding: 4px 8px;
  margin-bottom: 4px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: grab;
  font-size: 12px;
}
.cdek-chip b {
  color: #0f766e;
  font-weight: 700;
}
.cdek-chip-n,
.cdek-empty {
  color: #64748b;
  font-size: 12px;
}
.cdek-empty {
  padding: 8px 0;
}
.cdek-dim {
  width: 88px;
}
</style>
