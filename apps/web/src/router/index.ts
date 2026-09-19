import { createRouter, createWebHistory } from 'vue-router';
import MainLayout from '@/layouts/MainLayout.vue';
import CourierPage from '@/pages/CourierPage.vue';
import ProductionPage from '@/pages/ProductionPage.vue';
import DealsPage from '@/pages/DealsPage.vue';
import WarehousePage from '@/pages/WarehousePage.vue';
import HomePage from '@/pages/HomePage.vue';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: '', name: 'home', component: HomePage },
        { path: 'warehouse', name: 'warehouse', component: WarehousePage },
        { path: 'pick', redirect: { name: 'warehouse' } },
        { path: 'courier', name: 'courier', component: CourierPage },
        { path: 'production', name: 'production', component: ProductionPage },
        { path: 'crm/deals', name: 'deals', component: DealsPage },
      ],
    },
  ],
});
