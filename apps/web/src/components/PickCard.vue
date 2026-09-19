<template>
  <div class="pick-move">
    <div class="pick-route-row">
      <div v-if="routeFrom || routeTo" class="pick-route">
        <span class="pick-route-side is-from">{{ routeFrom || '—' }}</span>
        <span class="pick-route-track" aria-hidden="true">
          <span class="pick-route-line" />
          <span class="pick-route-arrow">→</span>
          <span class="pick-route-line" />
        </span>
        <span class="pick-route-side is-to">{{ routeTo || '—' }}</span>
      </div>
      <q-btn
        v-if="mode === 'handoff' || (mode === 'open' && row.id && !String(row.id).startsWith('return:'))"
        class="pick-done"
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
        class="pick-done"
        color="primary"
        unelevated
        dense
        no-caps
        label="Вернуть"
        :loading="busyId === `ret:${row.deal_id}`"
        @click="$emit('complete-return', String(row.deal_id))"
      />
    </div>
    <div class="pick-move-head">
      <div class="pick-move-meta">
        <button v-if="headNum" type="button" class="pick-move-num pick-open" @click="copyNum">{{ headNum }}</button>
        <div v-if="taskWhen" class="pick-move-when">{{ taskWhen }}</div>
        <div v-if="mode === 'done' && (moveNum || collectedWhen)" class="pick-move-tail">
          <div v-if="moveNum" class="pick-move-num">{{ moveNum }}</div>
          <div v-if="collectedWhen" class="pick-move-when">{{ collectedWhen }}</div>
        </div>
      </div>
      <div class="pick-move-title">{{ title }}</div>
    </div>

    <q-markup-table v-if="lines.length" class="pick-grid" flat dense separator="none" wrap-cells>
      <thead>
        <tr>
          <th class="pick-chk"></th>
          <th class="text-left">Мастер</th>
          <th class="text-left">Наименование</th>
          <th class="text-right">Кол-во</th>
          <th class="text-left">Ячейка</th>
          <th class="text-left">К перемещению</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(ln, i) in lines" :key="i">
          <td class="pick-chk">
            <span class="pick-box" :class="{ 'is-on': ln.already_moved }">{{ ln.already_moved ? '✓' : '' }}</span>
          </td>
          <td>{{ masterSku(ln) }}</td>
          <td>
            <div>{{ ln.name || '—' }}</div>
            <div v-if="lotMeta(ln).length" class="pick-lot">
              <template v-for="(bit, bi) in lotMeta(ln)" :key="bi">
                <span v-if="bi"> · </span>
                <span>{{ bit.label }}: </span><b>{{ bit.value }}</b>
              </template>
            </div>
          </td>
          <td class="text-right">{{ ln.qty }}</td>
          <td>{{ cellLabel(ln) }}</td>
          <td>{{ moveSku(ln) }}</td>
        </tr>
      </tbody>
    </q-markup-table>
    <div v-else class="text-grey-6 text-caption q-pa-sm">Нет строк / ячеек</div>

    <div v-if="mode !== 'done'" class="pick-move-foot">
      <div class="pick-move-side">
        <q-btn
          v-if="printHref"
          outline
          dense
          no-caps
          icon="sym_o_print"
          label="Печать"
          :href="printHref + '?autoprint=1'"
          target="_blank"
        />
        <button
          v-if="showCdek && cdekNumber"
          type="button"
          class="pick-link"
          @click="$emit('cdek', String(row.deal_id))"
        >
          <q-icon name="sym_o_local_shipping" />
          <span>СДЭК</span>
        </button>
        <span v-else-if="showCdek" class="pick-note">Трек не создан</span>
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
import { Notify } from 'quasar';

const props = withDefaults(
  defineProps<{
    row: Record<string, unknown>;
    mode?: 'open' | 'handoff' | 'return' | 'done';
    busyId?: string;
  }>(),
  { mode: 'open', busyId: '' }
);

const emit = defineEmits<{
  complete: [id: string];
  cancel: [id: string];
  'complete-return': [dealId: string];
  cdek: [dealId: string];
}>();

const title = computed(() => {
  const d = props.row.deal as Record<string, unknown> | undefined;
  return String(d?.title || d?.buyer_name || props.row.buyer_name || '').trim() || '—';
});

function stamp(raw: unknown): string {
  const s = String(raw || '').trim();
  const ru = s.match(/(\d{2}\.\d{2}\.\d{4})[,\s]+(\d{2}:\d{2})/);
  if (ru) return `${ru[1]} ${ru[2]}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]} ${iso[4]}:${iso[5]}`;
  return '';
}

function datesIn(raw: string): string[] {
  const out: string[] = [];
  const re = /(\d{2}\.\d{2}\.\d{4})[,\s]+(\d{2}:\d{2})/g;
  for (const m of raw.matchAll(re)) out.push(`${m[1]} ${m[2]}`);
  return out;
}

const collectedWhen = computed(() => {
  if (props.mode !== 'done') return '';
  const comment = String(props.row.comment || '');
  const ready = comment.match(/Склад ГОТОВО\s*·\s*([^·]+)/i)?.[1] || props.row.completed_label;
  return stamp(ready);
});

const taskWhen = computed(() => {
  if (props.mode !== 'done') return stamp(props.row.created_at);
  const head = String(props.row.comment || '').split(/Склад ГОТОВО/i)[0] || '';
  const dates = datesIn(head);
  return dates.length ? dates[dates.length - 1] : '';
});

const dealId = computed(() => {
  const id = String(props.row.deal_id || '').trim();
  if (id) return id;
  const num = String(props.row.number || '').trim();
  const m = num.match(/^р(\d+)$/i);
  return m ? m[1] : '';
});

const headNum = computed(() => dealId.value);

async function copyNum() {
  const text = headNum.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    Notify.create({ type: 'positive', message: 'Скопировано', timeout: 800 });
  } catch {
    Notify.create({ type: 'negative', message: 'Не удалось скопировать', timeout: 1200 });
  }
}

const moveNum = computed(() => {
  if (props.mode !== 'done') return '';
  const num = String(props.row.number || '').trim();
  if (!num || num === headNum.value || num === `Р${headNum.value}`) return '';
  return num;
});

function lotMeta(ln: Record<string, unknown>) {
  const master = String(ln.master_sku || ln.article || ln.sku || '').trim();
  const fact = String(ln.fact_sku || '').trim() || master;
  const supplier = String(ln.supplier || '').trim();
  const lotCell = String(ln.lot_cell_code || ln.cells_label || ln.cell_code || '').trim();
  const brand = String(ln.brand || ln.deal_brand || ln.product_brand || '').trim();
  const bits: Array<{ label: string; value: string }> = [];
  if (brand) bits.push({ label: 'Бренд', value: brand });
  if (master) bits.push({ label: 'Мастер', value: master });
  if (fact) bits.push({ label: 'На складе', value: fact });
  if (supplier) bits.push({ label: 'Поставщик', value: supplier });
  if (lotCell) bits.push({ label: 'Яч.', value: lotCell });
  return bits;
}

function cellLabel(ln: Record<string, unknown>) {
  return String(ln.cells_label || ln.lot_cell_code || ln.done_cell || ln.cell_code || '').trim() || '—';
}

function masterSku(ln: Record<string, unknown>) {
  return String(ln.master_sku || ln.article || ln.sku || '').trim() || '—';
}

function moveSku(ln: Record<string, unknown>) {
  return String(ln.fact_sku || '').trim() || '—';
}

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

const cdekNumber = computed(() => {
  const d = props.row.deal as Record<string, unknown> | undefined;
  return String(props.row.cdek_number || d?.cdek_number || '').trim();
});

const showCdek = computed(() => {
  const d = props.row.deal as Record<string, unknown> | undefined;
  if (props.row.is_ship || cdekNumber.value) return !!props.row.deal_id;
  const ch = String(d?.ship_channel || d?.amo_shipment || '');
  return /cdek|сдэк/i.test(ch) && !!props.row.deal_id;
});
</script>

<style scoped>
.pick-move {
  padding: 12px;
  background: #fff;
}
.pick-move-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin-bottom: 12px;
}
.pick-move-meta {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
}
.pick-move-tail {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-left: auto;
}
.pick-open {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
.pick-open:hover {
  color: #0f766e;
}
.pick-move-num {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #64748b;
  white-space: nowrap;
}
.pick-move-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.pick-move-when {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #64748b;
  white-space: nowrap;
}
.pick-chk {
  width: 28px;
  text-align: center;
}
.pick-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  font-size: 12px;
  line-height: 1;
  color: #0f766e;
}
.pick-box.is-on {
  border-color: #0f766e;
}
.pick-lot {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  font-weight: 600;
  color: #0f766e;
}
.pick-lot b {
  color: #134e4a;
  font-weight: 700;
}
.pick-move-caption {
  margin-top: 2px;
  font-size: 12px;
  color: #64748b;
}
.pick-route-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.pick-route {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding: 8px 12px;
  background: #f1f4f6;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.pick-done {
  flex: 0 0 auto;
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
  margin: 0;
}
.pick-grid :deep(th),
.pick-grid :deep(td) {
  border: 0;
  border-bottom: 1px solid #eef2f6;
  padding: 8px;
  white-space: normal;
}
.pick-grid :deep(th:first-child),
.pick-grid :deep(td:first-child) {
  padding-left: 0;
}
.pick-grid :deep(th:last-child),
.pick-grid :deep(td:last-child) {
  padding-right: 0;
}
.pick-grid :deep(thead th) {
  background: transparent;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 500;
  padding-top: 0;
  padding-bottom: 6px;
}
.pick-grid :deep(tbody tr:last-child td) {
  border-bottom: 0;
  padding-bottom: 0;
}
.pick-move-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 20px;
}
.pick-move-side {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.pick-move-side.is-end {
  justify-content: flex-end;
  margin-left: auto;
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
.pick-note {
  font-size: 13px;
  line-height: 1;
  color: #64748b;
}
</style>
