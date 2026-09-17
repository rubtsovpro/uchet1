<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm q-gutter-sm">
      <div class="text-h6 text-weight-bold">Производство</div>
      <q-space />
      <q-btn-toggle
        v-model="site"
        toggle-color="primary"
        :options="siteOptions"
        dense
        unelevated
      />
      <q-btn flat icon="refresh" :loading="loading" @click="load" />
    </div>

    <div class="row q-gutter-sm q-mb-md">
      <q-btn
        v-for="opt in statusOptions"
        :key="opt.value"
        dense
        unelevated
        :color="status === opt.value ? 'primary' : 'grey-3'"
        :text-color="status === opt.value ? 'white' : 'dark'"
        :label="opt.label"
        @click="status = opt.value"
      />
    </div>

    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
      {{ error }}
    </q-banner>

    <q-list bordered separator class="rounded-borders bg-white">
      <q-expansion-item
        v-for="row in items"
        :key="String(row.id)"
        dense
        header-class="bg-white"
      >
        <template #header>
          <q-item-section>
            <q-item-label>{{ row.number }} · {{ row.kind_label || row.kind }}</q-item-label>
            <q-item-label caption>
              {{ row.status_label || row.status }}
              <span v-if="row.deal_id"> · сделка {{ row.deal_id }}</span>
              <span v-if="row.summary"> · {{ row.summary }}</span>
            </q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-badge color="primary">{{ row.status_label || row.status }}</q-badge>
          </q-item-section>
        </template>

        <div class="q-pa-md">
          <q-markup-table flat dense v-if="Array.isArray(row.lines) && row.lines.length">
            <thead>
              <tr>
                <th class="text-left">Направление</th>
                <th class="text-left">Артикул</th>
                <th class="text-left">Наименование</th>
                <th class="text-right">Кол-во</th>
                <th class="text-left">Ячейка</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(ln, i) in row.lines" :key="i">
                <td>{{ ln.direction === 'produce' ? '→ выход' : '← расход' }}</td>
                <td>{{ ln.sku || '—' }}</td>
                <td>{{ ln.name || '—' }}</td>
                <td class="text-right">{{ ln.qty }}</td>
                <td>{{ ln.cell_code || '—' }}</td>
              </tr>
            </tbody>
          </q-markup-table>
          <div v-else class="text-grey-6 text-caption">Нет строк</div>

          <div class="row q-gutter-sm q-mt-md">
            <q-btn
              v-if="row.status === 'draft' || row.status === 'await_send'"
              color="primary"
              unelevated
              dense
              label="На участок"
              :loading="busyId === String(row.id)"
              @click="sendJob(String(row.id))"
            />
            <q-btn
              v-if="row.status === 'await_receive' || row.status === 'at_production'"
              color="positive"
              unelevated
              dense
              label="Закрыть"
              :loading="busyId === String(row.id)"
              @click="doneJob(String(row.id))"
            />
            <q-btn
              v-if="row.status !== 'closed' && row.status !== 'cancelled'"
              flat
              dense
              color="negative"
              label="Отмена"
              :loading="busyId === String(row.id)"
              @click="cancelJob(String(row.id))"
            />
          </div>
        </div>
      </q-expansion-item>
      <q-item v-if="!loading && !items.length">
        <q-item-section class="text-grey-6">Нет заданий</q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { Notify } from 'quasar';
import { api } from '@/boot/api';

type Job = Record<string, unknown> & {
  id?: string;
  lines?: Array<Record<string, unknown>>;
};
type Resp = { items?: Job[]; status_labels?: Record<string, string> };

const site = ref('msk');
const status = ref('');
const siteOptions = [
  { label: 'МСК', value: 'msk' },
  { label: 'Стрела', value: 'strela' },
  { label: 'Фогель', value: 'fogel' },
];
const statusOptions = [
  { label: 'Все', value: '' },
  { label: 'Черновик', value: 'draft' },
  { label: 'Ждёт отправки', value: 'await_send' },
  { label: 'В производстве', value: 'at_production' },
  { label: 'Ждёт оприходования', value: 'await_receive' },
  { label: 'Закрыто', value: 'closed' },
];

const loading = ref(false);
const error = ref('');
const busyId = ref('');
const items = ref<Job[]>([]);
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({ site: site.value, limit: '60' });
    if (status.value) params.set('status', status.value);
    const data = await api.get<Resp>(`/api/production/jobs?${params}`);
    items.value = data.items || [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка';
  } finally {
    loading.value = false;
  }
}

async function sendJob(id: string) {
  busyId.value = id;
  try {
    await api.post(`/api/production/jobs/${encodeURIComponent(id)}/send`, {});
    Notify.create({ type: 'positive', message: 'Отправлено на участок' });
    await load();
  } catch (e) {
    Notify.create({ type: 'negative', message: e instanceof Error ? e.message : 'Ошибка' });
  } finally {
    busyId.value = '';
  }
}

async function doneJob(id: string) {
  busyId.value = id;
  try {
    await api.post(`/api/production/jobs/${encodeURIComponent(id)}/done`, {});
    Notify.create({ type: 'positive', message: 'Закрыто' });
    await load();
  } catch (e) {
    Notify.create({ type: 'negative', message: e instanceof Error ? e.message : 'Ошибка' });
  } finally {
    busyId.value = '';
  }
}

async function cancelJob(id: string) {
  busyId.value = id;
  try {
    await api.post(`/api/production/jobs/${encodeURIComponent(id)}/cancel`, {});
    Notify.create({ type: 'positive', message: 'Отменено' });
    await load();
  } catch (e) {
    Notify.create({ type: 'negative', message: e instanceof Error ? e.message : 'Ошибка' });
  } finally {
    busyId.value = '';
  }
}

watch([site, status], () => void load());
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 30_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
