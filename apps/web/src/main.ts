import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { Quasar, Notify, Dialog, Loading } from 'quasar';
import quasarLang from 'quasar/lang/ru';
import '@quasar/extras/material-icons/material-icons.css';
import 'quasar/src/css/index.sass';
import './css/app.scss';
import App from './App.vue';
import { router } from './router';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(Quasar, {
  plugins: { Notify, Dialog, Loading },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lang: quasarLang as any,
});
app.mount('#app');
