<template>
  <q-layout view="lHh Lpr lFf" class="sb-layout">
    <q-header class="sb-header text-dark">
      <q-toolbar class="sb-toolbar">
        <div class="sb-brand sb-brand-bar lt-lg">Учёт №1</div>
        <q-input
          v-model="searchQ"
          dense
          borderless
          placeholder="Поиск"
          class="sb-search"
        >
          <template #prepend><q-icon name="sym_o_search" /></template>
        </q-input>
        <q-space />
        <div v-if="meLabel" class="sb-user">
          <div class="sb-user-name">{{ meLabel }}</div>
          <div v-if="meHint" class="sb-user-hint">{{ meHint }}</div>
        </div>
        <q-btn
          flat
          class="sb-icon-btn"
          icon="sym_o_logout"
          aria-label="Выйти"
          :loading="loggingOut"
          @click="logout"
        />
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="drawer"
      v-model:mini="drawerMini"
      show-if-above
      :breakpoint="1025"
      :width="268"
      :mini-width="72"
      class="sb-drawer"
    >
      <div class="sb-drawer-inner">
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
      <div class="sb-drawer-toggle">
        <q-btn flat class="sb-icon-btn" icon="sym_o_menu" aria-label="Меню" @click="toggleMenu" />
      </div>
      </div>
    </q-drawer>

    <q-btn
      v-if="menuOpener"
      flat
      class="sb-icon-btn sb-menu-fab"
      icon="sym_o_menu"
      aria-label="Меню"
      @click="drawer = true"
    />

    <q-page-container>
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useQuasar } from 'quasar';
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

const $q = useQuasar();
const drawer = ref(false);
const drawerMini = ref(false);
const menuOpener = computed(() => $q.screen.width <= 1024 && !drawer.value);
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
  { label: 'Главное', icon: 'sym_o_home', to: { name: 'home' } },
  { label: 'CRM', icon: 'sym_o_groups', href: '/crm' },
  { label: 'Сделки', icon: 'sym_o_handshake', to: { name: 'deals' } },
  { label: 'Продажи', icon: 'sym_o_shopping_bag', href: '/sales' },
  { label: 'Документы', icon: 'sym_o_description', href: '/documents' },
  { label: 'Закупки', icon: 'sym_o_shopping_cart', href: '/purchases' },
  { label: 'Склад', icon: 'sym_o_warehouse', href: '/warehouses' },
  { label: 'Задания складу', icon: 'sym_o_inventory_2', to: { name: 'pick' } },
  { label: 'Курьер', icon: 'sym_o_local_shipping', to: { name: 'courier' } },
  { label: 'Работы', icon: 'sym_o_handyman', href: '/works' },
  { label: 'Производство', icon: 'sym_o_precision_manufacturing', to: { name: 'production' } },
  { label: 'Деньги', icon: 'sym_o_payments', href: '/money' },
  { label: 'Налоги', icon: 'sym_o_account_balance', href: '/tax' },
  { label: 'Касса', icon: 'sym_o_point_of_sale', href: '/kassa' },
  { label: 'Персонал', icon: 'sym_o_badge', href: '/staff' },
  { label: 'Компания', icon: 'sym_o_apartment', href: '/company' },
  { label: 'Настройки', icon: 'sym_o_settings', href: '/settings' },
  { label: 'Идеи и ошибки', icon: 'sym_o_lightbulb', href: '/ideas' },
  { label: 'Помощь', icon: 'sym_o_help', href: '/help' },
];

function toggleMenu() {
  if (window.innerWidth <= 1024) {
    drawer.value = !drawer.value;
    return;
  }
  drawerMini.value = !drawerMini.value;
}

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
