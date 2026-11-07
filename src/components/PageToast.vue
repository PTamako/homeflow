<script setup lang="ts">
import type {PageToast} from '../page-toast'
defineProps<{toast:PageToast|null}>()
</script>
<template>
  <!-- Bottom sheets are teleported to body at z-index 10000.
       Render status toasts in the same root stacking context above them. -->
  <Teleport to="body">
    <Transition name="page-toast">
      <div v-if="toast" :key="toast.message" class="page-toast-notice"
        :class="'page-toast-'+toast.kind"
        :role="toast.kind==='success'?'status':'alert'"
        :aria-live="toast.kind==='success'?'polite':'assertive'" aria-atomic="true">
        <span class="page-toast-symbol" aria-hidden="true">{{ toast.kind==='warning'?'!':toast.kind==='error'?'×':'✓' }}</span>
        <span>{{ toast.message }}</span>
      </div>
    </Transition>
  </Teleport>
</template>
<style scoped>
.page-toast-notice{
 position:fixed;z-index:12000;top:50%;left:50%;transform:translate(-50%,-50%);
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
.page-toast-error{background:#a0443b}
.page-toast-enter-active,.page-toast-leave-active{transition:opacity .18s ease}
.page-toast-enter-from,.page-toast-leave-to{opacity:0}
@media(prefers-reduced-motion:reduce){.page-toast-enter-active,.page-toast-leave-active{transition:none}}
</style>
