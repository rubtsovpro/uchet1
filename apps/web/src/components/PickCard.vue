<template>
  <div class="pick-move">
    <div class="pick-move-head">
      <div>
        <div class="pick-move-title">{{ row.number || row.deal_id }} · {{ title }}</div>
        <div class="pick-move-caption">
          <template v-if="mode === 'handoff'">Перемещение</template>
          <span v-if="row.route_label || row.purpose_label || row.channel">
            <template v-if="mode === 'handoff'"> · </template>{{ row.route_label || row.purpose_label || row.channel }}
          </span>
          <span v-if="row.deal_id"> · {{ row.deal_id }}</span>
          <span v-if="row.cdek_number"> · СДЭК {{ row.cdek_number }}</span>
        </div>
      </div>
      <q-btn
        v-if="mode === 'handoff' || (mode === 'open' && row.id && !String(row.id).startsWith('return:'))"
        color="primary"
        unelevated
        dense
        no-caps
        label="Собрано"
        :loading="busyId === String(row.id)"
        @click="$emit('complete', String(row.id))"
      />
      <q-btn
        v-else-if="mode === 'return'"
        color="orange"
        unelevated
        dense
        no-caps
        label="Вернуть"
        :loading="busyId === `ret:${row.deal_id}`"
        @click="$emit('complete-return', String(row.deal_id))"
      />
    </div>

    <q-markup-table v-if="lines.length" flat dense>
      <thead>
        <tr>
          <th class="text-left">Артикул</th>
          <th class="text-left">Наименование</th>
          <th class="text-right">Кол-во</th>
          <th class="text-left">Ячейка</th>
          <th class="text-left">Склад</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(ln, i) in lines" :key="i">
          <td>{{ ln.article || ln.sku || '—' }}</td>
          <td>{{ ln.name || '—' }}</td>
          <td class="text-right">{{ ln.qty }}</td>
          <td>{{ ln.cells_label || ln.done_cell || ln.cell_code || '—' }}</td>
          <td>
            <q-select
              v-if="whOptions(ln).length > 1 && row.id"
              dense
              outlined
              emit-value
              map-options
              :model-value="String(ln.warehouse_id || ln.from_warehouse_id || '')"
              :options="whOptions(ln)"
              style="min-width: 140px"
              @update:model-value="(v) => onWh(ln, String(v))"
            />
            <span v-else>{{ ln.from_warehouse_name || ln.warehouse_name || '—' }}</span>
          </td>
        </tr>
      </tbody>
    </q-markup-table>
    <div v-else class="text-grey-6 text-caption q-pa-sm">Нет строк / ячеек</div>

    <div class="row q-gutter-sm q-pa-sm">
      <q-btn
        v-if="printHref"
        outline
        dense
        color="primary"
        icon="print"
        :label="String(row.print_label || 'Печать')"
        :href="printHref + '?autoprint=1'"
        target="_blank"
      />
      <q-btn
        v-if="showCdek"
        outline
        dense
        color="orange"
        icon="local_shipping"
        :label="row.cdek_number ? `СДЭК ${row.cdek_number}` : 'СДЭК места'"
        @click="$emit('cdek', String(row.deal_id))"
      />
      <q-btn
        v-if="mode === 'handoff' || mode === 'open'"
        flat
        dense
        color="negative"
        label="Отмена"
        :loading="busyId === `cancel:${row.id}`"
        @click="$emit('cancel', String(row.id))"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    row: Record<string, unknown>;
    mode?: 'open' | 'handoff' | 'return';
    busyId?: string;
  }>(),
  { mode: 'open', busyId: '' }
);

const emit = defineEmits<{
  complete: [id: string];
  cancel: [id: string];
  'complete-return': [dealId: string];
  cdek: [dealId: string];
  'line-source': [payload: { id: string; product_id: string; warehouse_id: string }];
}>();

const title = computed(() => {
  const d = props.row.deal as Record<string, unknown> | undefined;
  return String(d?.title || d?.buyer_name || props.row.buyer_name || '').trim() || '—';
});

const lines = computed(() =>
  Array.isArray(props.row.lines) ? (props.row.lines as Array<Record<string, unknown>>) : []
);

const printHref = computed(() => String(props.row.print_href || '').trim());

const showCdek = computed(() => {
  const d = props.row.deal as Record<string, unknown> | undefined;
  if (props.row.is_ship || props.row.cdek_number) return !!props.row.deal_id;
  const ch = String(d?.ship_channel || d?.amo_shipment || '');
  return /cdek|сдэк/i.test(ch) && !!props.row.deal_id;
});

function whOptions(ln: Record<string, unknown>) {
  const stock = Array.isArray(ln.stock_wh) ? (ln.stock_wh as Array<Record<string, unknown>>) : [];
  return stock
    .map((w) => ({
      label: `${w.name || w.warehouse_name || w.id} · ${w.qty ?? ''}`,
      value: String(w.id || w.warehouse_id || ''),
    }))
    .filter((o) => o.value);
}

function onWh(ln: Record<string, unknown>, warehouse_id: string) {
  emit('line-source', {
    id: String(props.row.id),
    product_id: String(ln.product_id || ''),
    warehouse_id,
  });
}
</script>

<style scoped>
.pick-move {
  padding: 10px 12px 8px;
  background: #fff;
}
.pick-move-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.pick-move-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.pick-move-caption {
  margin-top: 2px;
  font-size: 12px;
  color: #64748b;
}
</style>
