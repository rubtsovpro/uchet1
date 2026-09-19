<template>
  <q-layout view="hHh Lpr lFf" class="sb-layout">
    <q-header class="sb-header text-dark">
      <q-toolbar class="sb-toolbar">
        <q-btn flat dense round icon="menu" class="lt-lg" aria-label="Меню" @click="drawer = !drawer" />
        <div class="sb-brand">Учёт №1</div>
        <q-space />
        <div v-if="meLabel" class="sb-user">
          <div class="sb-user-name">{{ meLabel }}</div>
          <div v-if="meHint" class="sb-user-hint">{{ meHint }}</div>
        </div>
        <q-btn flat no-caps icon="logout" label="Выйти" class="sb-logout" :loading="loggingOut" @click="logout" />
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="drawer"
      show-if-above
      :breakpoint="1025"
      :width="248"
      bordered
      class="sb-drawer"
    >
      <q-list class="sb-nav">
        <q-item
          v-for="item in nav"
          :key="item.label"
          clickable
          :to="item.to"
          active-class="sb-nav-active"
          @click="closeIfNarrow"
        >
          <q-item-section avatar>
            <q-icon :name="item.icon" />
          </q-item-section>
          <q-item-section>{{ item.label }}</q-item-section>
        </q-item>
      </q-list>
      <div v-if="healthLabel" class="sb-drawer-foot">{{ healthLabel }}</div>
    </q-drawer>

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
  redis?: { ok?: boolean; mode?: string };
};

type Me = {
  name?: string;
  login?: string;
  role?: string;
  email?: string;
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  warehouse: 'Склад',
  courier: 'Курьер',
  photographer: 'Фотограф',
  manager: 'Менеджер',
  accountant: 'Бухгалтер',
  purchaser: 'Закупки',
  sto: 'СТО',
};

const drawer = ref(false);
const health = ref<Health | null>(null);
const me = ref<Me | null>(null);
const loggingOut = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const meLabel = computed(() => {
  const m = me.value;
  if (!m) return '';
  return String(m.name || m.login || '').trim();
});

const meHint = computed(() => {
  const m = me.value;
  if (!m) return '';
  const role = ROLE_LABEL[String(m.role || '')] || '';
  const login = String(m.login || '').trim();
  if (role && login && login !== meLabel.value) return `${role} · ${login}`;
  return role || (login !== meLabel.value ? login : '');
});

const nav = [
  { label: 'Главная', icon: 'home', to: { name: 'home' } },
  { label: 'Задания складу', icon: 'inventory_2', to: { name: 'pick' } },
  { label: 'Курьер', icon: 'local_shipping', to: { name: 'courier' } },
  { label: 'Производство', icon: 'precision_manufacturing', to: { name: 'production' } },
  { label: 'Сделки', icon: 'handshake', to: { name: 'deals' } },
];

const healthLabel = computed(() => {
  const h = health.value;
  if (!h) return '';
  return h.ok ? 'Сервер на связи' : 'Сервер не отвечает';
});

function closeIfNarrow() {
  if (window.innerWidth <= 1024) drawer.value = false;
}

async function refreshHealth() {
  try {
    health.value = await api.get<Health>('/api/health');
  } catch {
    health.value = { ok: false };
  }
}

async function loadMe() {
  try {
    me.value = await api.get<Me>('/api/me');
  } catch {
    me.value = null;
  }
}

async function logout() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await api.post('/api/logout', {});
  } catch {
    /* сессию всё равно сбрасываем на экране входа */
  }
  window.location.replace('/login');
}

onMounted(() => {
  void refreshHealth();
  void loadMe();
  timer = setInterval(() => void refreshHealth(), 15000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
