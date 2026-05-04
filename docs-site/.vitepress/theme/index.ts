import DefaultTheme from 'vitepress/theme'
import HomeLayout from './HomeLayout.vue'
import './style.css'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('HomeLayout', HomeLayout)
  },
} satisfies Theme
