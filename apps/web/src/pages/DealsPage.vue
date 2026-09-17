<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm q-gutter-sm">
      <div class="text-h6 text-weight-bold">CRM · Сделки</div>
      <q-space />
      <q-btn-toggle
        v-model="view"
        toggle-color="primary"
        dense
        unelevated
        :options="[
          { label: 'Таблица', value: 'table' },
          { label: 'Канбан', value: 'board' },
        ]"
      />
      <q-btn flat dense icon="open_in_new" href="/#/crm/deals" target="_blank" label="Legacy" />
      <q-btn flat icon="refresh" :loading="loading" @click="load" />
    </div>

    <div class="row items-center q-gutter-sm q-mb-md flex-wrap">
      <q-select
        v-if="pipelines.length"
        v-model="pipelineId"
        dense
        outlined
        emit-value
        map-options
        :options="pipelineOptions"
        label="Воронка"
        style="min-width: 200px"
      />
      <q-input
        v-model="q"
        dense
        outlined
        clearable
        placeholder="Поиск"
        style="min-width: 220px"
        class="col-grow"
        @keyup.enter="load"
      >
        <template #append>
          <q-btn flat dense icon="search" @click="load" />
        </template>
      </q-input>
    </div>

    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>{{ error }}</q-banner>

    <template v-if="view === 'table'">
      <q-markup-table flat bordered dense class="bg-white">
        <thead>
          <tr>
            <th class="text-left">Сделка</th>
            <th class="text-left">Клиент</th>
            <th class="text-left">Этап</th>
            <th class="text-right">Сумма</th>
            <th class="text-left">Канал</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in deals"
            :key="String(d.id)"
            class="cursor-pointer"
            @click="openDeal(String(d.id))"
          >
            <td>{{ d.id }} · {{ d.name || d.title || '—' }}</td>
            <td>{{ d.buyer_name || '—' }}</td>
            <td>{{ d.status_name || d.status_id || '—' }}</td>
            <td class="text-right">{{ formatMoney(d.price ?? d.amount) }}</td>
            <td>{{ d.amo_channel || '—' }}</td>
          </tr>
          <tr v-if="!loading && !deals.length">
            <td colspan="5" class="text-grey-6">Нет сделок</td>
          </tr>
        </tbody>
      </q-markup-table>
      <div class="row items-center q-mt-sm q-gutter-sm">
        <q-btn dense flat icon="chevron_left" :disable="page <= 1" @click="page--; load()" />
        <span class="text-caption">{{ page }} / {{ pages }}</span>
        <q-btn dense flat icon="chevron_right" :disable="page >= pages" @click="page++; load()" />
      </div>
    </template>

    <div v-else class="row q-gutter-md scroll" style="overflow-x: auto">
      <q-card
        v-for="col in columns"
        :key="String(col.status_id || col.id)"
        flat
        bordered
        class="bg-white"
        style="min-width: 260px; max-width: 300px"
      >
        <q-card-section class="q-pb-none">
          <div class="text-subtitle2">{{ col.status_name || col.name }} · {{ (col.deals || col.items || []).length }}</div>
        </q-card-section>
        <q-card-section class="q-gutter-sm">
          <div
            v-for="d in col.deals || col.items || []"
            :key="String(d.id)"
            class="q-pa-sm rounded-borders bg-grey-1 cursor-pointer"
            @click="openDeal(String(d.id))"
          >
            <div class="text-weight-medium">{{ d.name || d.title || d.id }}</div>
            <div class="text-caption text-grey-7">{{ d.buyer_name || '—' }} · {{ formatMoney(d.price ?? d.amount) }}</div>
          </div>
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '@/boot/api';

type Deal = Record<string, unknown>;
type Pipe = { id: string | number; name?: string; deals_count?: number; is_archive?: boolean };
type ListResp = { items?: Deal[]; total?: number; pages?: number; page?: number };
type BoardResp = {
  columns?: Array<Record<string, unknown> & { deals?: Deal[]; items?: Deal[] }>;
  pipelines?: Pipe[];
  selected_pipeline_id?: string;
};

const view = ref<'table' | 'board'>('table');
const q = ref('');
const pipelineId = ref('');
const pipelines = ref<Pipe[]>([]);
const deals = ref<Deal[]>([]);
const columns = ref<BoardResp['columns']>([]);
const page = ref(1);
const pages = ref(1);
const loading = ref(false);
const error = ref('');

const pipelineOptions = computed(() =>
  pipelines.value.map((p) => ({ label: String(p.name || p.id), value: String(p.id) }))
);

function formatMoney(v: unknown): string {
  const n = Number(v) || 0;
  return n ? `${n.toLocaleString('ru-RU')} ₽` : '—';
}

function openDeal(id: string) {
  window.open(`/#/crm/deals/${encodeURIComponent(id)}`, '_blank');
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (view.value === 'board') {
      const params = new URLSearchParams();
      if (pipelineId.value) params.set('pipeline_id', pipelineId.value);
      if (q.value.trim()) params.set('q', q.value.trim());
      const data = await api.get<BoardResp>(`/api/crm/deals/board?${params}`);
      columns.value = data.columns || [];
      pipelines.value = data.pipelines || pipelines.value;
      if (data.selected_pipeline_id) pipelineId.value = String(data.selected_pipeline_id);
    } else {
      const params = new URLSearchParams({
        page: String(page.value),
        limit: '50',
      });
      if (pipelineId.value) params.set('pipeline_id', pipelineId.value);
      if (q.value.trim()) params.set('q', q.value.trim());
      const data = await api.get<ListResp>(`/api/crm/deals?${params}`);
      deals.value = data.items || [];
      pages.value = Number(data.pages) || 1;
      if (!pipelines.value.length) {
        const board = await api.get<BoardResp>('/api/crm/deals/board');
        pipelines.value = board.pipelines || [];
        if (!pipelineId.value && board.selected_pipeline_id) {
          pipelineId.value = String(board.selected_pipeline_id);
        }
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка';
  } finally {
    loading.value = false;
  }
}

watch([view, pipelineId], () => {
  page.value = 1;
  void load();
});
onMounted(() => void load());
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
