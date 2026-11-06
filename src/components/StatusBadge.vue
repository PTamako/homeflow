<script setup lang="ts">
import {computed} from 'vue'
import {statusPresentation} from '../status-presentation.mjs'
const props=withDefaults(defineProps<{code:string;label?:string;variant?:'soft'|'text'}>(),{variant:'soft'})
const presentation=computed(()=>statusPresentation(props.code))
</script>
<template>
 <span :class="['hf-status','hf-status-'+presentation.tone,{'hf-status-text':variant==='text'}]">
  {{ label??presentation.label }}
 </span>
</template>
<style scoped>
.hf-status{display:inline-flex;align-items:center;max-width:100%;min-width:0;vertical-align:baseline;
 border-radius:6px;padding:2px 6px;font-size:11px;line-height:1.3;font-weight:700;
 white-space:nowrap;flex:none}
.hf-status-success{color:var(--hf-success-text);background:var(--hf-success-bg)}
.hf-status-info{color:var(--hf-info-text);background:var(--hf-info-bg)}
.hf-status-warning{color:var(--hf-warning-text);background:var(--hf-warning-bg)}
.hf-status-danger{color:var(--hf-danger-text);background:var(--hf-danger-bg)}
.hf-status-muted{color:var(--hf-muted-text);background:var(--hf-muted-bg)}
.hf-status-text{padding:0;background:transparent}
</style>
