<template>
  <q-page class="section-page">
    <div class="section-title q-mb-md">Главная</div>

    <q-card flat bordered v-if="status">
      <q-card-section>
        <div class="text-subtitle2">Статус</div>
        <div class="text-body2">
          SoT: <strong>{{ status.source_of_truth }}</strong>
          · dual_run: {{ status.dual_run ? 'да' : 'нет' }}
        </div>
        <div class="text-body2">
          PG mirror:
          {{ status.pg_mirror.enabled ? 'вкл' : 'выкл' }}
          · lag {{ status.pg_mirror.lag_sec ?? '—' }}с
          · tables {{ status.pg_mirror.tables_synced }}
          · rows {{ status.pg_mirror.rows_upserted }}
        </div>
        <div v-if="status.pg_mirror.last_error" class="text-negative text-caption">
          {{ status.pg_mirror.last_error }}
        </div>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '@/boot/api';

type Dual = {
  dual_run: boolean;
  source_of_truth: string;
  pg_mirror: {
    enabled: boolean;
    lag_sec: number | null;
    tables_synced: number;
    rows_upserted: number;
    last_error: string;
  };
};

const status = ref<Dual | null>(null);

onMounted(async () => {
  try {
    const h = await api.get<{ dual_run?: Dual }>('/api/health');
    status.value = (h.dual_run as Dual) || null;
  } catch {
    status.value = null;
  }
});
</script>
