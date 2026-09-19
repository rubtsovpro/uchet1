<template>
  <q-layout view="hHh Lpr lFf" class="sb-layout">
    <q-header class="sb-header text-dark">
      <q-toolbar class="sb-toolbar">
        <q-btn flat dense round icon="menu" class="lt-lg sb-icon-btn" aria-label="Меню" @click="drawer = !drawer" />
        <div class="sb-brand sb-brand-bar lt-lg">Учёт №1</div>
        <q-input
          v-model="searchQ"
          dense
          borderless
          placeholder="Поиск"
          class="sb-search"
        >
          <template #prepend><q-icon name="search" /></template>
        </q-input>
        <q-space />
        <div v-if="meLabel" class="sb-user">
          <div class="sb-user-name">{{ meLabel }}</div>
          <div v-if="meHint" class="sb-user-hint">{{ meHint }}</div>
        </div>
        <q-btn
          flat
          class="sb-icon-btn"
          icon="logout"
          aria-label="Выйти"
          :loading="loggingOut"
          @click="logout"
        />
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="drawer"
      show-if-above
      :breakpoint="1025"
      :width="268"
      class="sb-drawer"
    >
      <q-list class="sb-nav">
        <q-item
          v-for="item in nav"
          :key="item.label"
          clickable
          v-bind="item.to ? { to: item.to } : { href: item.href }"
          active-class="sb-nav-active"
          @click="closeIfNarrow"
        >
          <q-item-section avatar>
            <q-icon :name="item.icon" />
          </q-item-section>
          <q-item-section>{{ item.label }}</q-item-section>
        </q-item>
      </q-list>
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
const searchQ = ref('');
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

const nav: { label: string; icon: string; to?: { name: string }; href?: string }[] = [
  { label: 'Главное', icon: 'home', to: { name: 'home' } },
  { label: 'CRM', icon: 'groups', href: '/crm' },
  { label: 'Сделки', icon: 'handshake', to: { name: 'deals' } },
  { label: 'Продажи', icon: 'shopping_bag', href: '/sales' },
  { label: 'Документы', icon: 'description', href: '/documents' },
  { label: 'Закупки', icon: 'shopping_cart', href: '/purchases' },
  { label: 'Склад', icon: 'warehouse', href: '/warehouses' },
  { label: 'Задания складу', icon: 'inventory_2', to: { name: 'pick' } },
  { label: 'Курьер', icon: 'local_shipping', to: { name: 'courier' } },
  { label: 'Работы', icon: 'handyman', href: '/works' },
  { label: 'Производство', icon: 'precision_manufacturing', to: { name: 'production' } },
  { label: 'Деньги', icon: 'payments', href: '/money' },
  { label: 'Налоги', icon: 'account_balance', href: '/tax' },
  { label: 'Касса', icon: 'point_of_sale', href: '/kassa' },
  { label: 'Персонал', icon: 'badge', href: '/staff' },
  { label: 'Компания', icon: 'apartment', href: '/company' },
  { label: 'Настройки', icon: 'settings', href: '/settings' },
  { label: 'Идеи и ошибки', icon: 'lightbulb', href: '/ideas' },
  { label: 'Помощь', icon: 'help', href: '/help' },
];

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
