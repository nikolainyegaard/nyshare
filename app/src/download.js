import { createApp, h } from 'vue'
import { OhVueIcon } from 'oh-vue-icons'
import './icons.js'

import Download from './Download.vue'
import { httpGet } from './common/util'

const app = createApp({
  data() {
    return {
      baseURI: document.head.getElementsByTagName('base')[0].href.replace(/\/$/),
      lang: {},
    }
  },
  render: () => h(Download),
  async beforeCreate() {
    try {
      this.lang = await httpGet('lang.json')
    } catch (e) {
      alert(e)
    }
  }
})

app.component('icon', OhVueIcon)
app.mount('#download')

window.PSITRANSFER_VERSION = PSITRANSFER_VERSION
