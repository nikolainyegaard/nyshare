import { createApp, h } from 'vue'
import { OhVueIcon } from 'oh-vue-icons'
import './icons.js'

import Admin from './Admin.vue'

const app = createApp({
  data() {
    return {
      baseURI: document.head.getElementsByTagName('base')[0].href
    }
  },
  render: () => h(Admin)
})

app.component('icon', OhVueIcon)
app.mount('#admin')

window.PSITRANSFER_VERSION = PSITRANSFER_VERSION
