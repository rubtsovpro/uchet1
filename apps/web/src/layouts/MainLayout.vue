<template>
  <q-layout view="lHh Lpr lFf" class="sb-layout">
    <q-header class="sb-header text-dark">
      <q-toolbar class="sb-toolbar">
        <label class="sb-org">
          <span class="sr-only">Филиал</span>
          <select v-model="companyId" class="sb-org-select" aria-label="Филиал" @change="saveCompany">
            <option v-if="allBranchesLabel" value="">{{ allBranchesLabel }}</option>
            <option v-for="c in companies" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <q-space />
        <div v-if="meLabel" class="sb-user-plain">{{ meLabel }}</div>
        <q-btn flat no-caps class="sb-logout" label="Выйти" :loading="loggingOut" @click="logout" />
      </q-toolbar>
    </q-header>

    <q-drawer
      v-model="drawer"
      v-model:mini="drawerMini"
      show-if-above
      :breakpoint="1025"
      :width="236"
      :mini-width="72"
      class="sb-drawer"
    >
      <div class="sb-drawer-inner">
      <div class="sb-brand">Учёт №1</div>
      <q-list class="sb-nav">
        <q-item
          v-for="item in nav"
          :key="item.label"
          clickable
          v-bind="item.to ? { to: item.to } : { href: item.href }"
          :exact="!!item.exact"
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
        <q-btn
          flat
          class="sb-icon-btn"
          :icon="drawerMini ? 'sym_o_chevron_right' : 'sym_o_chevron_left'"
          aria-label="Меню"
          @click="toggleMenu"
        />
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
  isSystemAdmin?: boolean;
  rights?: { company_ids?: string[] };
};

type Company = { id: string; name: string; code?: string; is_active?: number };

const CONTOUR_KEY = 'wms.contour-company.v1';

const $q = useQuasar();
const drawer = ref(false);
const drawerMini = ref(false);
const menuOpener = computed(() => $q.screen.width <= 1024 && !drawer.value);
const health = ref<Health | null>(null);
const me = ref<Me | null>(null);
const companies = ref<Company[]>([]);
const companyId = ref('');
const allBranchesLabel = ref('Все филиалы');
const loggingOut = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const meLabel = computed(() => {
  const m = me.value;
  if (!m) return '';
  return String(m.name || m.login || '').trim();
});

const nav: { label: string; icon: string; to?: { name: string }; href?: string; exact?: boolean }[] = [
  { label: 'Главное', icon: 'sym_o_home', to: { name: 'home' }, exact: true },
  { label: 'Склад', icon: 'sym_o_warehouse', to: { name: 'warehouse' } },
  { label: 'Сделки', icon: 'sym_o_handshake', to: { name: 'deals' } },
  { label: 'Продажи', icon: 'sym_o_shopping_bag', href: '/sales' },
  { label: 'Документы', icon: 'sym_o_description', href: '/documents' },
  { label: 'Закупки', icon: 'sym_o_shopping_cart', href: '/purchases' },
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
  { label: 'CRM', icon: 'sym_o_groups', href: '/crm' },
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

function saveCompany() {
  try {
    localStorage.setItem(CONTOUR_KEY, companyId.value || '');
  } catch {
    /* ignore */
  }
}

async function loadCompanies() {
  try {
    const data = await api.get<{ items?: Company[] }>('/api/company/companies');
    let items = (data.items || []).filter((c) => Number(c.is_active) !== 0);
    const meCos =
      me.value &&
      !me.value.isSystemAdmin &&
      me.value.role !== 'admin' &&
      Array.isArray(me.value.rights?.company_ids) &&
      me.value.rights.company_ids.length
        ? me.value.rights.company_ids.map(String)
        : null;
    if (meCos) items = items.filter((c) => meCos.includes(String(c.id)));
    companies.value = items;
    allBranchesLabel.value = meCos ? (items.length > 1 ? 'Все доступные' : '') : 'Все филиалы';
    let cur = '';
    try {
      cur = String(localStorage.getItem(CONTOUR_KEY) || '').trim();
    } catch {
      cur = '';
    }
    const pnevmo =
      items.find((c) => String(c.code || '').toUpperCase() === 'PNEVMO') ||
      items.find((c) => /пневмо/i.test(String(c.name || '')));
    if (!cur && pnevmo && !meCos) cur = String(pnevmo.id);
    if (meCos && items.length === 1) cur = String(items[0].id);
    else if (cur && !items.some((c) => String(c.id) === cur)) cur = meCos && items[0] ? String(items[0].id) : String(pnevmo?.id || '');
    companyId.value = cur;
    saveCompany();
  } catch {
    companies.value = [];
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
  void (async () => {
    await loadMe();
    await loadCompanies();
  })();
  timer = setInterval(() => void refreshHealth(), 15000);
});
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
