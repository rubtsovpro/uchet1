<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="bg-primary text-white">
      <q-toolbar>
        <q-toolbar-title shrink class="text-weight-bold">Учёт №1</q-toolbar-title>
        <q-btn flat stretch :to="{ name: 'home' }" label="Главная" />
        <q-btn flat stretch :to="{ name: 'pick' }" label="Склад" />
        <q-btn flat stretch :to="{ name: 'courier' }" label="Курьер" />
        <q-btn flat stretch :to="{ name: 'production' }" label="Производство" />
        <q-btn flat stretch :to="{ name: 'deals' }" label="Сделки" />
        <q-space />
        <q-chip
          v-if="health"
          dense
          :color="health.ok ? 'positive' : 'negative'"
          text-color="white"
          :label="healthLabel"
        />
      </q-toolbar>
    </q-header>
    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { api } from '@/boot/api';

type Health = {
  ok?: boolean;
  event_loop?: { lag_ms?: number; peak_lag_ms?: number };
  ui_build?: number;
  redis?: { ok?: boolean; mode?: string; lag_ms?: number };
};

const health = ref<Health | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

const healthLabel = computed(() => {
  const h = health.value;
  if (!h) return '…';
  const lag = h.event_loop?.lag_ms ?? 0;
  const redis = h.redis?.mode === 'redis' ? '· redis' : '· mem';
  return h.ok ? `API ok · lag ${lag}ms ${redis}` : `API lag ${lag}ms`;
});

async function refreshHealth() {
  try {
    health.value = await api.get<Health>('/api/health');
  } catch {
    health.value = { ok: false };
  }
}

onMounted(() => {
  void refreshHealth();
  timer = setInterval(() => void refreshHealth(), 5000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
