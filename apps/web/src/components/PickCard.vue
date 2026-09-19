<template>
  <div class="pick-move">
    <div v-if="routeFrom || routeTo" class="pick-route">
      <span class="pick-route-side is-from">{{ routeFrom || '—' }}</span>
      <span class="pick-route-track" aria-hidden="true">
        <span class="pick-route-line" />
        <span class="pick-route-arrow">→</span>
        <span class="pick-route-line" />
      </span>
      <span class="pick-route-side is-to">{{ routeTo || '—' }}</span>
    </div>
    <div class="pick-move-head">
      <div>
        <div class="pick-move-num">{{ row.number || row.deal_id }}</div>
        <div class="pick-move-title">{{ title }}</div>
        <div v-if="row.cdek_number" class="pick-move-caption">СДЭК {{ row.cdek_number }}</div>
      </div>
    </div>

    <q-markup-table v-if="lines.length" class="pick-grid" flat dense separator="cell">
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

    <div class="pick-move-foot">
      <div class="pick-move-side">
        <a
          v-if="printHref"
          class="pick-link"
          :href="printHref + '?autoprint=1'"
          target="_blank"
        >
          <q-icon name="sym_o_print" />
          <span>Печать</span>
        </a>
        <button
          v-if="showCdek"
          type="button"
          class="pick-link"
          @click="$emit('cdek', String(row.deal_id))"
        >
          <q-icon name="sym_o_local_shipping" />
          <span>СДЭК</span>
        </button>
      </div>
      <div class="pick-move-mid">
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
          color="primary"
          unelevated
          dense
          no-caps
          label="Вернуть"
          :loading="busyId === `ret:${row.deal_id}`"
          @click="$emit('complete-return', String(row.deal_id))"
        />
      </div>
      <div class="pick-move-side is-end">
        <q-btn
          v-if="mode === 'handoff' || mode === 'open'"
          class="btn-cancel"
          flat
          dense
          no-caps
          label="Отмена"
          :loading="busyId === `cancel:${row.id}`"
          @click="$emit('cancel', String(row.id))"
        />
      </div>
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

function routeSide(raw: unknown, index: number): string {
  const direct = String(raw || '').trim();
  if (direct) return direct;
  const parts = String(props.row.route_label || '')
    .split('→')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[index] || '';
}

const routeFrom = computed(() => routeSide(props.row.warehouse_name, 0));
const routeTo = computed(() =>
  routeSide(props.row.warehouse_to_name || props.row.dest_warehouse_name, 1)
);

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
.pick-move-num {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  color: #64748b;
}
.pick-move-title {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.pick-move-caption {
  margin-top: 2px;
  font-size: 12px;
  color: #64748b;
}
.pick-route {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
  padding: 8px 12px;
  background: #f1f4f6;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.pick-route-side {
  flex: 0 1 auto;
  max-width: 42%;
}
.pick-route-side.is-to {
  text-align: right;
}
.pick-route-track {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 48px;
}
.pick-route-line {
  flex: 1;
  border-top: 1px dotted #94a3b8;
}
.pick-route-arrow {
  color: #0f766e;
  line-height: 1;
}
.pick-grid {
  border: 1px solid #d7dee7;
  border-radius: 8px;
  overflow: hidden;
}
.pick-grid :deep(table) {
  border-collapse: collapse;
}
.pick-grid :deep(th),
.pick-grid :deep(td) {
  border: 1px solid #d7dee7;
}
.pick-grid :deep(thead th) {
  background: #f8fafc;
}
.pick-grid :deep(tbody tr:nth-child(even) td) {
  background: #f3f5f8;
}
.pick-move-foot {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  padding-top: 8px;
}
.pick-move-side {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.pick-move-side.is-end {
  justify-content: flex-end;
}
.pick-move-mid {
  justify-self: center;
}
.pick-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: #0f766e;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  text-decoration: none;
  cursor: pointer;
}
.pick-link .q-icon {
  color: #94a3b8;
  font-size: 18px;
  font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
}
</style>
