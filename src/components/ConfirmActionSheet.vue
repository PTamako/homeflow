<script setup lang="ts">
import EditBottomSheet from './EditBottomSheet.vue'
import type {ConfirmActionRequest} from '../use-confirm-action'

defineProps<{request:ConfirmActionRequest}>()
const emit=defineEmits<{confirm:[];cancel:[]}>()
</script>

<template>
 <EditBottomSheet :title="request.title" @close="emit('cancel')" priority="confirmation">
  <div class="confirm-action">
   <p class="confirm-action-message">{{ request.message }}</p>
   <div class="confirm-action-buttons">
    <button type="button" class="confirm-action-cancel" @click="emit('cancel')">返回</button>
    <button type="button" class="confirm-action-accept"
      :class="{'confirm-action-danger':request.danger}" @click="emit('confirm')">
      {{ request.confirmLabel }}
    </button>
   </div>
  </div>
 </EditBottomSheet>
</template>

<style scoped>
.confirm-action{display:grid;gap:18px;min-width:0}
.confirm-action-message{margin:0;white-space:pre-line;overflow-wrap:anywhere;
 font-size:14px;line-height:1.75;color:#435b4b}
.confirm-action-buttons{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);
 gap:10px;position:sticky;bottom:calc(-20px - env(safe-area-inset-bottom));
 background:linear-gradient(to bottom,#fff9,#fff 18px);
 padding:10px 0 calc(12px + env(safe-area-inset-bottom))}
.confirm-action-buttons button{min-width:0;min-height:48px;border-radius:11px;
 border:1px solid #c7ddce;font-size:14px;font-weight:700;touch-action:manipulation}
.confirm-action-cancel{background:#f6faf7;color:#4b7761}
.confirm-action-accept{background:#43866a;color:white;border-color:#43866a!important}
.confirm-action-danger{background:#b6474d;border-color:#b6474d!important}
.confirm-action-buttons button:focus-visible{outline:2px solid #317253;outline-offset:2px}
@media(max-width:350px){.confirm-action{gap:12px}.confirm-action-buttons{gap:7px}}
</style>
