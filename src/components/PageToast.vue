<script setup lang="ts">
import type {PageToast} from '../page-toast'
defineProps<{toast:PageToast|null}>()
</script>
<template>
  <Transition name="page-toast">
    <div v-if="toast" :key="toast.message" class="page-toast-notice" :class="'page-toast-'+toast.kind"
      :role="toast.kind==='warning'?'alert':'status'" aria-live="polite" aria-atomic="true">
      <span class="page-toast-symbol" aria-hidden="true">{{ toast.kind==='warning'?'!':'✓' }}</span>
      <span>{{ toast.message }}</span>
    </div>
  </Transition>
</template>
<style scoped>
.page-toast-notice{
 position:fixed;z-index:1100;top:42%;left:50%;transform:translate(-50%,-50%);
 display:flex;align-items:center;gap:10px;
 max-width:min(88vw,420px);min-width:140px;min-height:45px;
 padding:11px 15px;border-radius:14px;background:rgba(40,66,53,.96);
 box-shadow:0 10px 32px rgba(17,39,26,.23);color:white;font-size:13px;
 font-weight:600;line-height:1.5;overflow-wrap:anywhere;
 pointer-events:none;box-sizing:border-box;
}
.page-toast-symbol{border:1px solid #ffffff88;border-radius:50%;width:21px;height:21px;
 flex:none;display:grid;place-items:center;font-size:12px;font-weight:700}
.page-toast-warning{background:#8b5931}
.page-toast-enter-active,.page-toast-leave-active{transition:opacity .18s ease}
.page-toast-enter-from,.page-toast-leave-to{opacity:0}
@media(prefers-reduced-motion:reduce){.page-toast-enter-active,.page-toast-leave-active{transition:none}}
</style>
