import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import './ui-system.css'

// Only the installed HomeFlow PWA locks layout zoom. Ordinary Safari retains
// pinch-to-zoom and iOS accessibility gestures for readable web content.
const installed=window.matchMedia('(display-mode: standalone)').matches||
  (navigator as Navigator & {standalone?:boolean}).standalone===true
if(installed){
  document.documentElement.classList.add('homeflow-installed')
  document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    ?.setAttribute('content',
      'width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover')
  const preventGesture=(event:Event)=>event.preventDefault()
  document.addEventListener('gesturestart',preventGesture,{passive:false})
  document.addEventListener('gesturechange',preventGesture,{passive:false})
  // touch-action:manipulation prevents accidental double-tap enlargement,
  // but normal one-finger vertical scroll and horizontal row swipes still work.
}
createApp(App).mount('#app')

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js').catch(()=>{/* offline cache is optional */})
  })
}
