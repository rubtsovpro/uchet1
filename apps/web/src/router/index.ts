import { createRouter, createWebHistory } from 'vue-router';
import MainLayout from '@/layouts/MainLayout.vue';
import PickPage from '@/pages/PickPage.vue';
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
      ],
    },
  ],
});
