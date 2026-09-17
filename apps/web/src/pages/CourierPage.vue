<template>
  <q-page class="q-pa-md">
    <div class="row items-center q-mb-sm q-gutter-sm">
      <div class="text-h6 text-weight-bold">Курьер</div>
      <q-space />
      <q-btn-toggle
        v-model="site"
        toggle-color="primary"
        :options="siteOptions"
        dense
        unelevated
      />
      <q-btn flat dense icon="open_in_new" href="/courier.html" target="_blank" label="Классика" />
      <q-btn flat icon="refresh" :loading="loading" @click="load" />
    </div>

    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn-toggle
        v-model="scope"
        toggle-color="primary"
        dense
        unelevated
        :options="[
          { label: `Активные · ${counts.active ?? 0}`, value: 'active' },
          { label: `Закрытые · ${counts.closed ?? 0}`, value: 'closed' },
        ]"
      />
      <q-input
        v-model="q"
        dense
        outlined
        clearable
        placeholder="Поиск"
        class="col-grow"
        style="max-width: 280px"
        @keyup.enter="load"
      >
        <template #append>
          <q-btn flat dense icon="search" @click="load" />
        </template>
      </q-input>
      <q-btn
        outline
        color="primary"
        dense
        icon="print"
        label="Реестр"
        @click="openPrint(false)"
      />
      <q-btn
        outline
        color="primary"
        dense
        icon="print"
        label="Выбранные"
        :disable="!Object.keys(selected).length"
        @click="openPrint(true)"
      />
    </div>

    <q-banner v-if="error" class="bg-negative text-white q-mb-md" rounded>
      {{ error }}
    </q-banner>

    <q-list bordered separator class="rounded-borders bg-white">
      <q-item v-for="row in items" :key="String(row.id)">
        <q-item-section side top v-if="scope === 'active'">
          <q-checkbox
            :model-value="!!selected[String(row.id)]"
            @update:model-value="(v) => toggleSel(String(row.id), !!v)"
          />
        </q-item-section>
        <q-item-section>
          <q-item-label>
            {{ row.deal_id ? `С${row.deal_id}` : row.title || 'Задание' }}
            · {{ row.buyer_name || '—' }}
          </q-item-label>
          <q-item-label caption>
            {{ routeLabel(row) }}
            <span v-if="row.buyer_phone"> · {{ row.buyer_phone }}</span>
          </q-item-label>
          <div class="q-mt-xs q-gutter-xs">
            <q-badge :color="statusColor(row)">{{ statusLabel(row) }}</q-badge>
            <q-badge v-if="row.shipment_label || row.amo_shipment" outline color="grey-7">
              {{ row.shipment_label || row.amo_shipment }}
            </q-badge>
            <q-badge :color="row.is_paid ? 'positive' : 'negative'" outline>
              {{ row.payment_label || (row.is_paid ? 'Оплачено' : 'Не оплачено') }}
            </q-badge>
          </div>
        </q-item-section>
        <q-item-section side top v-if="scope === 'active'">
          <q-btn
            v-if="nextStatus(row)"
            :color="nextStatus(row) === 'delivered' ? 'primary' : 'grey-8'"
            unelevated
            dense
            :label="nextLabel(row)"
            :loading="busyId === String(row.id)"
            @click="setStatus(String(row.id), nextStatus(row)!)"
          />
        </q-item-section>
      </q-item>
      <q-item v-if="!loading && !items.length">
        <q-item-section class="text-grey-6">Нет рейсов</q-item-section>
      </q-item>
    </q-list>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Notify } from 'quasar';
import { api } from '@/boot/api';

type Run = Record<string, unknown>;
type Resp = { items?: Run[]; counts?: { active?: number; closed?: number } };

const site = ref('msk');
const scope = ref<'active' | 'closed'>('active');
const q = ref('');
const siteOptions = [
  { label: 'МСК', value: 'msk' },
  { label: 'Стрела', value: 'strela' },
  { label: 'Фогель', value: 'fogel' },
];

const loading = ref(false);
const error = ref('');
const busyId = ref('');
const items = ref<Run[]>([]);
const counts = reactive<{ active?: number; closed?: number }>({});
const selected = ref<Record<string, boolean>>({});
let timer: ReturnType<typeof setInterval> | null = null;

function isHandoff(r: Run): boolean {
  if (r.kind === 'handoff' || r.is_handoff) return true;
  const t = `${r.title || ''} ${r.route_label || ''}`;
  return /Курьер\s*→/i.test(t) || /Склад курьера/i.test(t);
}

function routeLabel(r: Run): string {
  const fromApi = String(r.route_label || '').trim();
  if (fromApi) return fromApi;
  const ship = String(r.shipment_label || r.amo_shipment || '').trim();
  if (isHandoff(r)) return ship ? `Курьер → ${ship}` : 'Курьер → отправка';
  return String(r.title || '—');
}

function statusLabel(r: Run): string {
  const st = String(r.status || '');
  if (st === 'delivered') return 'Доставил';
  if (st === 'cancelled') return 'Отмена';
  if (isHandoff(r)) return 'К доставке';
  if (st === 'picked_up') return 'Забрал';
  if (st === 'accepted') return 'Принял';
  return 'Новое';
}

function statusColor(r: Run): string {
  const st = String(r.status || '');
  if (st === 'delivered') return 'positive';
  if (st === 'cancelled') return 'grey';
  return 'orange';
}

function nextStatus(r: Run): 'accepted' | 'picked_up' | 'delivered' | null {
  const st = String(r.status || '');
  if (st === 'delivered' || st === 'cancelled') return null;
  if (isHandoff(r)) return 'delivered';
  if (st === 'new' || !st) return 'accepted';
  if (st === 'accepted') return 'picked_up';
  if (st === 'picked_up') return 'delivered';
  return null;
}

function nextLabel(r: Run): string {
  const n = nextStatus(r);
  if (n === 'accepted') return 'Принял';
  if (n === 'picked_up') return 'Забрал';
  if (n === 'delivered') return isHandoff(r) ? 'Доставил' : 'Выполнил';
  return '';
}

function toggleSel(id: string, on: boolean) {
  if (on) selected.value = { ...selected.value, [id]: true };
  else {
    const next = { ...selected.value };
    delete next[id];
    selected.value = next;
  }
}

function openPrint(onlySelected: boolean) {
  const qs = new URLSearchParams({ autoprint: '1' });
  const ids = Object.keys(selected.value);
  if (onlySelected && ids.length) qs.set('ids', ids.join(','));
  window.open(`/api/courier/runs/print?${qs}`, '_blank', 'noopener');
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = new URLSearchParams({
      scope: scope.value,
      site: site.value,
      limit: '80',
    });
    if (q.value.trim()) params.set('q', q.value.trim());
    const data = await api.get<Resp>(`/api/courier/runs?${params}`);
    items.value = data.items || [];
    Object.assign(counts, data.counts || {});
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка';
  } finally {
    loading.value = false;
  }
}

async function setStatus(id: string, status: string) {
  busyId.value = id;
  try {
    await api.post(`/api/courier/runs/${encodeURIComponent(id)}/status`, { status });
    Notify.create({ type: 'positive', message: 'Статус обновлён' });
    await load();
  } catch (e) {
    Notify.create({ type: 'negative', message: e instanceof Error ? e.message : 'Ошибка' });
  } finally {
    busyId.value = '';
  }
}

watch([site, scope], () => {
  selected.value = {};
  void load();
});
onMounted(() => {
  void load();
  timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    if (scope.value !== 'active') return;
    void load();
  }, 25_000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
