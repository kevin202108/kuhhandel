import { createApp } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import App from './App.vue';
import './assets/main.css';

// App bootstrap only. Networking is started by SetupForm (via startNetworking()).
const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.mount('#app');
setActivePinia(pinia);

