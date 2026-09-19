<template>
  <q-page class="section-page">
    <div class="section-title q-mb-md">Задания складу</div>

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
            v-for="row in filteredHandoffs"
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
            v-for="row in filteredReturns"
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
            v-for="row in filteredDone"
            :key="String(row.id)"
            :row="row"
            mode="done"
            :busy-id="busyId"
            @cancel="cancelHandoff"
            @cdek="openCdek"
            @line-source="setLineSource"
          />
          <q-item v-if="!loading && !filteredDone.length">
            <q-item-section class="text-grey-6">Нет закрытых</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>
    </q-tab-panels>
    </div>

    <q-dialog v-model="cdekOpen" persistent maximized-mobile>
      <q-card style="min-width: 420px; max-width: 640px">
        <q-card-section class="row items-center">
          <div class="text-h6">СДЭК · места · {{ cdekDealId }}</div>
          <q-space />
          <q-btn flat round icon="close" v-close-popup />
        </q-card-section>
        <q-card-section>
          <div v-if="cdekErr" class="text-negative q-mb-sm">{{ cdekErr }}</div>
          <div class="row q-gutter-sm items-center q-mb-md">
            <div class="text-subtitle2">Коробок: {{ cdekBoxes }}</div>
            <q-btn dense flat icon="remove" :disable="cdekBoxes <= 1" @click="cdekBoxes--" />
            <q-btn dense flat icon="add" @click="cdekBoxes++" />
          </div>
          <div v-for="(box, bi) in cdekDims" :key="bi" class="row q-gutter-sm q-mb-sm">
            <q-input v-model.number="box.l" type="number" dense outlined label="Д, см" style="width: 90px" />
            <q-input v-model.number="box.w" type="number" dense outlined label="Ш, см" style="width: 90px" />
            <q-input v-model.number="box.h" type="number" dense outlined label="В, см" style="width: 90px" />
            <q-input v-model.number="box.weight" type="number" dense outlined label="Вес, кг" style="width: 100px" />
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Отмена" v-close-popup />
          <q-btn flat color="orange" label="Пересоздать" :loading="cdekBusy" @click="regenCdek" />
          <q-btn color="primary" unelevated label="Сохранить" :loading="cdekBusy" @click="saveCdek" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Dialog, Notify } from 'quasar';
import { api } from '@/boot/api';
import PickCard from '@/components/PickCard.vue';

type Board = {
  counts?: { open?: number };
  open?: Array<Record<string, unknown>>;
  groups?: Array<{ key?: string; label?: string; tasks?: Array<Record<string, unknown>> }>;
  handoffs_completed_total?: number;
};
type ListResp = { items?: Array<Record<string, unknown>>; completed_total?: number };
type PageResp = { items?: Array<Record<string, unknown>>; total?: number };
const site = 'msk';
const tab = ref('handoffs');
const filterQ = ref('');

const loading = ref(false);
const error = ref('');
const busyId = ref('');
const board = ref<Board | null>(null);
const handoffs = ref<Array<Record<string, unknown>>>([]);
const returns = ref<Array<Record<string, unknown>>>([]);
const completed = ref<Array<Record<string, unknown>>>([]);
const completedTotal = ref(0);

const cdekOpen = ref(false);
const cdekDealId = ref('');
const cdekErr = ref('');
const cdekBusy = ref(false);
const cdekBoxes = ref(1);
const cdekDims = ref<Array<{ l: number; w: number; h: number; weight: number }>>([
  { l: 20, w: 20, h: 20, weight: 1 },
]);

watch(cdekBoxes, (n) => {
  while (cdekDims.value.length < n) cdekDims.value.push({ l: 20, w: 20, h: 20, weight: 1 });
  if (cdekDims.value.length > n) cdekDims.value = cdekDims.value.slice(0, n);
});

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
const filteredDone = computed(() => completed.value.filter(matchRow));

const openGroups = computed(() => {
  const groups = board.value?.groups;
  if (Array.isArray(groups) && groups.length) {
    return groups
      .map((g) => ({
        key: String(g.key || g.label || 'g'),
        label: String(g.label || g.key || 'Задачи'),
        tasks: (g.tasks || []).filter(matchRow),
      }))
      .filter((g) => g.tasks.length);
  }
  const byType = new Map<string, Array<Record<string, unknown>>>();
  for (const row of filteredOpen.value) {
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

async function load() {
  loading.value = true;
  error.value = '';
  const q = encodeURIComponent(site);
  try {
    const [today, ho, ret, done] = await Promise.all([
      api.get<Board>(`/api/warehouse/pick/today?site=${q}`),
      api.get<ListResp>(`/api/warehouse/pick/handoffs?site=${q}&limit=40`),
      api.get<ListResp>(`/api/warehouse/pick/returns?site=${q}`),
      api.get<PageResp>(`/api/warehouse/pick/handoffs/completed?site=${q}&page=1&limit=15`),
    ]);
    board.value = today;
    handoffs.value = ho.items || [];
    returns.value = ret.items || [];
    completed.value = done.items || [];
    completedTotal.value = Number(ho.completed_total ?? today.handoffs_completed_total ?? done.total ?? 0);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

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
  try {
    const pack = await api.get<Record<string, unknown>>(
      `/api/warehouse/pick/handoffs/${encodeURIComponent(dealId)}/cdek-pack`
    );
    const packages = Array.isArray(pack.packages)
      ? (pack.packages as Array<Record<string, unknown>>)
      : Array.isArray(pack.places)
        ? (pack.places as Array<Record<string, unknown>>)
        : [];
    if (packages.length) {
      cdekBoxes.value = packages.length;
      cdekDims.value = packages.map((p) => ({
        l: Number(p.length || p.l || 20) || 20,
        w: Number(p.width || p.w || 20) || 20,
        h: Number(p.height || p.h || 20) || 20,
        weight: Number(p.weight || 1) || 1,
      }));
    }
  } catch (e) {
    cdekErr.value = e instanceof Error ? e.message : 'Не удалось загрузить';
  } finally {
    cdekBusy.value = false;
  }
}

async function saveCdek() {
  cdekBusy.value = true;
  cdekErr.value = '';
  try {
    await api.post(`/api/warehouse/pick/handoffs/${encodeURIComponent(cdekDealId.value)}/cdek-pack`, {
      packages: cdekDims.value.map((b) => ({
        length: b.l,
        width: b.w,
        height: b.h,
        weight: b.weight,
      })),
    });
    Notify.create({ type: 'positive', message: 'Места СДЭК сохранены' });
    cdekOpen.value = false;
  } catch (e) {
    cdekErr.value = e instanceof Error ? e.message : 'Ошибка сохранения';
  } finally {
    cdekBusy.value = false;
  }
}

async function regenCdek() {
  cdekBusy.value = true;
  cdekErr.value = '';
  try {
    await api.post(
      `/api/warehouse/pick/handoffs/${encodeURIComponent(cdekDealId.value)}/cdek-regenerate`,
      {
        packages: cdekDims.value.map((b) => ({
          length: b.l,
          width: b.w,
          height: b.h,
          weight: b.weight,
        })),
      }
    );
    Notify.create({ type: 'positive', message: 'СДЭК пересоздан' });
  } catch (e) {
    cdekErr.value = e instanceof Error ? e.message : 'Ошибка';
  } finally {
    cdekBusy.value = false;
  }
}

onMounted(() => {
  void load();
});
</script>

<style scoped>
.pick-page :deep(.q-tab-panels) {
  background: transparent;
}
</style>
