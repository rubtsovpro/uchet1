<template>
  <q-page class="q-pa-md pick-page">
    <div class="row items-center q-mb-sm q-gutter-sm">
      <div class="text-h6 text-weight-bold">Склад · задачи</div>
      <q-space />
      <q-btn-toggle
        v-model="site"
        toggle-color="primary"
        :options="siteOptions"
        dense
        unelevated
      />
      <q-btn flat dense icon="open_in_new" href="/pick" target="_blank" label="Классика" />
      <q-btn flat icon="refresh" :loading="loading" @click="load" />
    </div>

    <q-tabs v-model="tab" dense class="text-primary" active-color="primary" indicator-color="primary" align="left">
      <q-tab name="open" :label="`Задачи · ${board?.counts?.open ?? 0}`" />
      <q-tab name="handoffs" :label="`Расходные · ${handoffs.length}`" />
      <q-tab name="returns" :label="`Возвраты · ${returns.length}`" />
      <q-tab name="done" :label="`Закрытые · ${completedTotal}`" />
    </q-tabs>
    <q-separator />

    <q-banner v-if="error" class="bg-negative text-white q-mt-md" rounded>
      {{ error }}
      <template #action>
        <q-btn flat color="white" label="Ещё раз" @click="load" />
      </template>
    </q-banner>

    <q-tab-panels v-model="tab" animated class="q-mt-md bg-transparent">
      <q-tab-panel name="open" class="q-pa-none">
        <q-list bordered separator class="rounded-borders bg-white">
          <q-item v-for="row in openRows" :key="String(row.id || row.number)">
            <q-item-section>
              <q-item-label>{{ row.buyer_name || row.number || row.deal_id }}</q-item-label>
              <q-item-label caption>
                {{ row.route_label || row.channel || row.purpose_label }} · {{ row.deal_id }}
              </q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-badge color="primary">{{ row.number }}</q-badge>
            </q-item-section>
          </q-item>
          <q-item v-if="!loading && !openRows.length">
            <q-item-section class="text-grey-6">Нет открытых задач · {{ siteLabel }}</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <q-tab-panel name="handoffs" class="q-pa-none">
        <q-list bordered separator class="rounded-borders bg-white">
          <q-item v-for="row in handoffs" :key="String(row.id)">
            <q-item-section>
              <q-item-label>
                {{ row.number }} · {{ dealTitle(row) }}
              </q-item-label>
              <q-item-label caption>
                {{ row.route_label || row.purpose_label }} · сделка {{ row.deal_id }}
              </q-item-label>
            </q-item-section>
            <q-item-section side top>
              <q-btn
                color="primary"
                unelevated
                dense
                label="Собрано"
                :loading="busyId === String(row.id)"
                @click="completeHandoff(String(row.id))"
              />
            </q-item-section>
          </q-item>
          <q-item v-if="!loading && !handoffs.length">
            <q-item-section class="text-grey-6">Нет расходных</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <q-tab-panel name="returns" class="q-pa-none">
        <q-list bordered separator class="rounded-borders bg-white">
          <q-item v-for="row in returns" :key="String(row.deal_id || row.id)">
            <q-item-section>
              <q-item-label>{{ row.number || row.deal_id }} · {{ dealTitle(row) }}</q-item-label>
              <q-item-label caption>
                {{ row.route_label }} · {{ row.qty_sum || row.lines_count }} поз.
              </q-item-label>
            </q-item-section>
            <q-item-section side top>
              <q-btn
                color="orange"
                unelevated
                dense
                label="Вернуть"
                :loading="busyId === `ret:${row.deal_id}`"
                @click="completeReturn(String(row.deal_id))"
              />
            </q-item-section>
          </q-item>
          <q-item v-if="!loading && !returns.length">
            <q-item-section class="text-grey-6">Нет возвратов</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>

      <q-tab-panel name="done" class="q-pa-none">
        <q-list bordered separator class="rounded-borders bg-white">
          <q-item v-for="row in completed" :key="String(row.id)">
            <q-item-section>
              <q-item-label>{{ row.number }} · {{ dealTitle(row) }}</q-item-label>
              <q-item-label caption>{{ row.route_label }} · {{ row.deal_id }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item v-if="!loading && !completed.length">
            <q-item-section class="text-grey-6">Пусто · всего {{ completedTotal }}</q-item-section>
          </q-item>
        </q-list>
      </q-tab-panel>
    </q-tab-panels>

    <div class="text-caption text-grey-6 q-mt-md">
      Quasar · те же API что /pick · poll {{ pollSec }}с · Redis кэш списков на бэке
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Notify } from 'quasar';
import { api } from '@/boot/api';

type Board = {
  counts?: { open?: number };
  open?: Array<Record<string, unknown>>;
  handoffs_completed_total?: number;
};
type ListResp = { items?: Array<Record<string, unknown>>; completed_total?: number };
type PageResp = { items?: Array<Record<string, unknown>>; total?: number };

const site = ref<'msk' | 'strela' | 'fogel'>('msk');
const tab = ref('open');
const siteOptions = [
  { label: 'МСК', value: 'msk' },
  { label: 'Стрела', value: 'strela' },
  { label: 'Фогель', value: 'fogel' },
];
const siteLabel = computed(
  () => siteOptions.find((o) => o.value === site.value)?.label || site.value
);

const loading = ref(false);
const error = ref('');
const busyId = ref('');
const board = ref<Board | null>(null);
const handoffs = ref<Array<Record<string, unknown>>>([]);
const returns = ref<Array<Record<string, unknown>>>([]);
const completed = ref<Array<Record<string, unknown>>>([]);
const completedTotal = ref(0);
const pollSec = 25;
let timer: ReturnType<typeof setInterval> | null = null;

const openRows = computed(() => {
  const open = board.value?.open || [];
  const extra = handoffs.value.slice(0, 20);
  // Как /pick: задачи производства + расходные в одном обзоре
  return [...open, ...extra.map((h) => ({ ...h, channel: h.purpose_label || 'handoff' }))];
});

function dealTitle(row: Record<string, unknown>): string {
  const d = row.deal as Record<string, unknown> | undefined;
  return String(d?.title || d?.buyer_name || row.buyer_name || '').trim() || '—';
}

async function load() {
  loading.value = true;
  error.value = '';
  const q = encodeURIComponent(site.value);
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

watch(site, () => void load());
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), pollSec * 1000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<style scoped>
.pick-page :deep(.q-tab-panels) {
  background: transparent;
}
</style>
