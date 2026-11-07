// A Vue v-model bound to input[type=number] may yield a number rather than a
// string even when the ref starts as ''. Keep validation safe for both forms.
export function parseRoutineAssignmentBonus(raw,required){
 if(!required)return {valid:true,bonus:0}
 const value=String(raw??'').trim()
 if(!/^\d+$/.test(value))return {valid:false,bonus:0}
 const bonus=Number(value)
 if(!Number.isSafeInteger(bonus)||bonus<1||bonus>10000)
  return {valid:false,bonus:0}
 return {valid:true,bonus}
}
