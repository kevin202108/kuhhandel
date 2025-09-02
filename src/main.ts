import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './assets/main.css';

const app = createApp(App);

// 掛 Pinia（之後 stores 會在這裡註冊並被元件使用）
app.use(createPinia());

app.mount('#app');
