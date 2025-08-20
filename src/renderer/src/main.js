import 'element-plus/dist/index.css'
import './assets/index.css'

import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import App from './App.vue'
import router from './router/index.js'

createApp(App)
  .use(ElementPlus)
  .use(router)
  .mount('#app')
