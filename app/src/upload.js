import { createApp, h } from 'vue'
import { OhVueIcon } from 'oh-vue-icons'
import './icons.js'

import Upload from './Upload.vue'
import store from './Upload/store.js'
import { httpGet } from './common/util'

const app = createApp({
  data() {
    return {
      baseURI: document.head.getElementsByTagName('base')[0].href.replace(/\/$/),
      configFetched: false,
      lang: {},
    }
  },
  render: () => h(Upload),
  async beforeCreate() {
    try {
      this.lang = await httpGet('lang.json')
      this.$store.commit('LANG', this.lang)
    } catch (e) {
      alert(e)
    }
    try {
      await this.$store.dispatch('config/fetch')
    } catch (e) {
      if (e.code !== 'PWDREQ') console.error(e)
    }
    this.configFetched = true
  }
})

app.component('icon', OhVueIcon)
app.use(store)
app.mount('#upload')

window.PSITRANSFER_VERSION = PSITRANSFER_VERSION
