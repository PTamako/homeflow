<script setup lang="ts">
import DateField from './DateField.vue'
import {reactive,ref} from 'vue'
import EditBottomSheet from './EditBottomSheet.vue'
type Profile={
  id:string;type:'person'|'pet';displayName:string;birthday:string|null;
  relation:string;adoptedOn:string|null;weightGrams:number|null;notes:string
}
const props=defineProps<{profile:Profile}>()
const emit=defineEmits<{saved:[];close:[]}>()
const busy=ref(false),error=ref('')
const form=reactive({
  displayName:props.profile.displayName,
  birthday:props.profile.birthday||'',
  relation:props.profile.relation||'',
  adoptedOn:props.profile.adoptedOn||'',
  weightGrams:props.profile.weightGrams==null?'':String(props.profile.weightGrams),
  notes:props.profile.notes||''
})
async function save(){
  busy.value=true;error.value=''
  try{
    const weight=form.weightGrams.trim()===''?null:Number(form.weightGrams)
    if(weight!==null && (!Number.isInteger(weight)||weight<1||weight>=100000)){
      error.value='体重请输入 1～99999 克，或留空';return
    }
    const response=await fetch('/api/family/profiles/'+encodeURIComponent(props.profile.id),{
      method:'PATCH',credentials:'same-origin',cache:'no-store',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        type:props.profile.type,displayName:form.displayName.trim(),
        birthday:form.birthday||null,relation:form.relation.trim(),
        adoptedOn:props.profile.type==='pet'?(form.adoptedOn||null):null,
        weightGrams:props.profile.type==='pet'?weight:null,
        notes:form.notes.trim()
      })
    })
    const data=await response.json()
    if(!response.ok)throw Error(data.error==='forbidden'?'无权修改此档案':'档案保存失败，请检查输入')
    emit('saved')
  }catch(e){error.value=(e as Error).message}
  finally{busy.value=false}
}
</script>
<template>
  <EditBottomSheet :title="'编辑'+(profile.type==='pet'?'宠物':'家庭成员')+'资料'" :close-disabled="busy" @close="emit('close')">
  <form class="profile-editor" @submit.prevent="save">
    <div class="profile-editor-grid">
      <label class="wide">昵称或名字
        <input v-model="form.displayName" required maxlength="60" placeholder="姓名或昵称"/>
      </label>
      <label>生日
        <DateField v-model="form.birthday" />
      </label>
      <label v-if="profile.type==='pet'">到家日
        <DateField v-model="form.adoptedOn" />
      </label>
      <label v-if="profile.type==='person'">关系（可选）
        <input v-model="form.relation" maxlength="40" placeholder="例如：自己、伴侣"/>
      </label>
      <label v-if="profile.type==='pet'">目前体重（克，可选）
        <input v-model="form.weightGrams" type="number" min="1" max="99999" inputmode="numeric" placeholder="例如 5500"/>
      </label>
      <label class="wide">备注（可选）
        <textarea v-model="form.notes" rows="2" maxlength="500" placeholder="补充信息"/>
      </label>
    </div>
    <p v-if="error" class="profile-error" role="alert">{{ error }}</p>
    <div class="profile-actions">
      <button type="button" class="secondary" :disabled="busy" @click="emit('close')">取消</button>
      <button class="primary" :disabled="busy">{{ busy?'保存中…':'保存修改' }}</button>
    </div>
  </form>
  </EditBottomSheet>
</template>
<style scoped>
.profile-editor{margin:0;background:transparent;border:0;border-radius:0;padding:0;min-width:0;max-width:100%}
.profile-editor h3{font-size:15px;display:flex;align-items:center;gap:8px;margin:0 0 8px}
.profile-editor-hint{font-size:12px;line-height:1.7;color:#769182;margin:0 0 14px}
.profile-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
.profile-editor-grid label{display:grid;gap:6px;font-size:12px;font-weight:600;color:#637b6c;min-width:0;max-width:100%}
.profile-editor-grid .wide{grid-column:1/-1}
.profile-editor :is(input,textarea){width:100%;max-width:100%;min-width:0;box-sizing:border-box;border:1px solid #d8e4d9;border-radius:10px;background:#fff;padding:10px 12px;min-height:42px;font-size:14px;color:#293d30}
.profile-editor input[type="date"]{min-inline-size:0}
.profile-editor textarea{resize:vertical;line-height:1.5}
.profile-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}
.profile-actions button{min-width:86px;border-radius:10px;padding:10px 14px;font-weight:700;font-size:13px}
.profile-actions .secondary{border:1px solid #bdd4c2;color:#528066;background:#fff}
.profile-actions .primary{border:0;background:#43866a;color:white}
.profile-actions button:disabled{opacity:.6}
.profile-error{font-size:12px;color:#a14d36}
@media(max-width:720px){.profile-editor-grid{grid-template-columns:minmax(0,1fr)}.profile-editor-grid .wide{grid-column:1}}
</style>
