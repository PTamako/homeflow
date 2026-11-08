<script setup lang="ts">
withDefaults(defineProps<{
  name: 'sun'|'clipboard-check'|'images'|'house'|'paw'|'users'|'calendar-heart'|'repeat'|
    'heart'|'wallet'|'shopping'|'plane'|'book-heart'|'bell'|'archive'|'plus'|'shield'|'check'|'chevron-down'|'ellipsis'|'settings'|'gift'|'award'|'handshake'|'ticket'|'link'
  size?: number
}>(), {size:22})
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    focusable="false" aria-hidden="true" class="app-icon">
    <template v-if="name==='sun'">
      <circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>
    </template>
    <template v-else-if="name==='clipboard-check'">
      <rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="m9 14 2.2 2.2L16 11"/>
    </template>
    <template v-else-if="name==='images'">
      <rect x="3" y="3" width="14" height="14" rx="2"/><path d="m3 12 3-3 4 4 2-2 5 5"/><path d="M8 21h11a2 2 0 0 0 2-2V8"/>
      <circle cx="12.5" cy="7.5" r="1"/>
    </template>
    <template v-else-if="name==='house'">
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M9 21v-8h6v8"/>
    </template>
    <template v-else-if="name==='paw'">
      <ellipse cx="12" cy="16.7" rx="5.2" ry="3.6"/><ellipse cx="4.9" cy="10.3" rx="1.5" ry="2"/><ellipse cx="9.1" cy="6.9" rx="1.5" ry="2"/><ellipse cx="14.9" cy="6.9" rx="1.5" ry="2"/><ellipse cx="19.1" cy="10.3" rx="1.5" ry="2"/>
    </template>
    <template v-else-if="name==='users'">
      <circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2H3z"/><path d="M16 5.5a3 3 0 0 1 0 5.8M18 15.5a5 5 0 0 1 3 4.5v1"/>
    </template>
    <template v-else-if="name==='calendar-heart'">
      <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/><path d="M12 18s-3-1.6-3-3.6c0-1.7 2-2.3 3-.7 1-1.6 3-1 3 .7 0 2-3 3.6-3 3.6"/>
    </template>
    <template v-else-if="name==='repeat'">
      <path d="M18 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h14M6 22l-3-3 3-3m15-3v2a4 4 0 0 1-4 4H3"/>
    </template>
    <template v-else-if="name==='heart'">
      <path d="M20.8 5.8a5.5 5.5 0 0 0-7.8 0L12 6.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 22l8.8-8.4a5.5 5.5 0 0 0 0-7.8z"/>
    </template>
    <template v-else-if="name==='wallet'">
      <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18m-5 5h5v4h-5a2 2 0 0 1 0-4z"/>
    </template>
    <template v-else-if="name==='shopping'">
      <path d="m3 9 2 12h14l2-12H3zm5 0 4-7 4 7M2 9h20"/><path d="M9 14v3m6-3v3"/>
    </template>
    <template v-else-if="name==='plane'">
      <path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/>
    </template>
    <template v-else-if="name==='book-heart'">
      <path d="M12 6a9 9 0 0 0-9-2v15a9 9 0 0 1 9 2 9 9 0 0 1 9-2V4a9 9 0 0 0-9 2zM12 6v15"/><path d="M16 11c-2-2-4 1 0 3 4-2 2-5 0-3"/>
    </template>
    <template v-else-if="name==='bell'">
      <path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 21a2 2 0 0 0 4 0"/>
    </template>
    <template v-else-if="name==='archive'">
      <rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v12h14V9M10 14h4"/>
    </template>
    <template v-else-if="name==='plus'">
      <path d="M12 5v14M5 12h14"/>
    </template>
    <template v-else-if="name==='shield'">
      <path d="M12 2 4 5v6c0 5 3 8 8 11 5-3 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>
    </template>
    <template v-else-if="name==='check'">
      <path d="m5 12 5 5L20 7"/>
    </template>
    <template v-else-if="name==='chevron-down'"><path d="m6 9 6 6 6-6"/></template>
    <template v-else-if="name==='settings'">
      <circle cx="12" cy="12" r="3"/>
      <path d="m19.4 15 .8 1.5-2.3 2.3-1.5-.8-1.5.6-.5 2.4h-3.2l-.5-2.4-1.5-.6-1.5.8-2.3-2.3.8-1.5-.6-1.5L3 13v-2l2.4-.5.6-1.5-.8-1.5 2.3-2.3 1.5.8 1.5-.6L11 3h3.2l.5 2.4 1.5.6 1.5-.8L20 7.5l-.8 1.5.6 1.5L22 11v2l-2.4.5z"/>
    </template>
    <template v-else-if="name==='gift'">
      <rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 12h18M12 9v12M12 9H8a3 3 0 1 1 3-4c1 1 1 4 1 4zm0 0h4a3 3 0 1 0-3-4c-1 1-1 4-1 4z"/>
    </template>
    <template v-else-if="name==='award'">
      <circle cx="12" cy="8" r="5"/><path d="m8.5 12-2 9 5.5-3 5.5 3-2-9"/>
    </template>
    <template v-else-if="name==='ticket'">
      <path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6V5z"/>
      <path d="M12 5v3m0 3v2m0 3v3"/>
    </template>
    <template v-else-if="name==='handshake'">
      <path d="m11 17 2 2a1 1 0 1 0 3-3"/>
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/>
      <path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8"/>
    </template>
    <template v-else-if="name==='link'">
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </template>
    <template v-else-if="name==='ellipsis'">
      <circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>
    </template>
  </svg>
</template>
<style scoped>
.app-icon{flex:none;display:block;vertical-align:middle}
</style>
