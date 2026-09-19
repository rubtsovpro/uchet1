<template>
  <q-page class="section-page">
    <div class="section-title q-mb-md">Склад</div>

    <div class="section-card">
      <q-tabs
        v-model="section"
        no-caps
        class="text-grey-8"
        active-color="primary"
        indicator-color="primary"
        align="left"
      >
        <q-tab name="tasks" label="Задания" />
        <q-tab name="places" label="Склады" />
      </q-tabs>
      <q-separator />

      <q-tab-panels v-model="section" class="pick-panels bg-transparent">
        <q-tab-panel name="tasks" class="q-pa-none">
          <PickPage embedded />
        </q-tab-panel>

        <q-tab-panel name="places" class="q-pa-none">
          <q-banner v-if="error" class="bg-negative text-white q-mt-md" rounded>
            {{ error }}
            <template #action>
              <q-btn flat color="white" label="Ещё раз" @click="loadPlaces" />
            </template>
          </q-banner>
          <q-markup-table v-else class="wh-grid" flat dense separator="none" wrap-cells>
            <thead>
              <tr>
                <th class="text-left">Название</th>
                <th class="text-left">Код</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="String(row.id)">
                <td>{{ row.name || '—' }}</td>
                <td>{{ row.code || '—' }}</td>
              </tr>
              <tr v-if="!loading && !rows.length">
                <td colspan="2" class="text-grey-6">Нет складов</td>
              </tr>
            </tbody>
          </q-markup-table>
        </q-tab-panel>
      </q-tab-panels>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { inject, ref, watch, type Ref } from 'vue';
import { api } from '@/boot/api';
import PickPage from '@/pages/PickPage.vue';

const section = ref('tasks');
const contourId = inject<Ref<string>>('contourCompanyId', ref(''));
const rows = ref<Array<Record<string, unknown>>>([]);
const loading = ref(false);
const error = ref('');

async function loadPlaces() {
  const id = String(contourId.value || '').trim();
  if (!id) {
    rows.value = [];
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const data = await api.get<Array<Record<string, unknown>>>(
      `/api/warehouses?company_id=${encodeURIComponent(id)}`
    );
    rows.value = Array.isArray(data) ? data : [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ошибка загрузки';
  } finally {
    loading.value = false;
  }
}

watch([section, contourId], () => {
  if (section.value === 'places') void loadPlaces();
});
</script>

<style scoped>
.wh-grid {
  background: transparent;
}
.wh-grid :deep(th),
.wh-grid :deep(td) {
  border: 0;
  border-bottom: 1px solid #eef2f6;
  padding: 8px;
}
.wh-grid :deep(th) {
  color: #94a3b8;
  font-size: 12px;
  font-weight: 500;
}
</style>
