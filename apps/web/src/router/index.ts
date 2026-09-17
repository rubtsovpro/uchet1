import { createRouter, createWebHistory } from 'vue-router';
import MainLayout from '@/layouts/MainLayout.vue';
import PickPage from '@/pages/PickPage.vue';
import CourierPage from '@/pages/CourierPage.vue';
import ProductionPage from '@/pages/ProductionPage.vue';
import DealsPage from '@/pages/DealsPage.vue';
import HomePage from '@/pages/HomePage.vue';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: MainLayout,
      children: [
        { path: '', name: 'home', component: HomePage },
        { path: 'pick', name: 'pick', component: PickPage },
        { path: 'courier', name: 'courier', component: CourierPage },
        { path: 'production', name: 'production', component: ProductionPage },
        { path: 'crm/deals', name: 'deals', component: DealsPage },
      ],
    },
  ],
});
