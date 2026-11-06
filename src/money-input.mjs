// Integer-yen form values are stored without separators; grouping is display-only.
// The same pure helpers are used for typing, paste, and caret calculations.
export function cleanMoneyInput(text,allowNegative=false){
 const source=String(text??'').normalize('NFKC').replace(/[−﹣–—]/g,'-')
 const negative=allowNegative&&/^\s*-/.test(source)
 const digits=source.replace(/\D/g,'')
 return (negative?'-':'')+digits
}
export function formatMoneyInput(text,allowNegative=false){
 const canonical=cleanMoneyInput(text,allowNegative)
 const negative=canonical.startsWith('-')
 const digits=(negative?canonical.slice(1):canonical).replace(/\B(?=(\d{3})+(?!\d))/g,',')
 return (negative?'-':'')+digits
}
export function moneyInputNumber(text){
 const canonical=cleanMoneyInput(text,true)
 return canonical===''||canonical==='-'?0:Number(canonical)
}
export function moneyCaretPosition(original,position,formatted){
 const raw=String(original??'')
 const before=raw.slice(0,Math.max(0,position??raw.length)).normalize('NFKC')
 const digits=(before.match(/\d/g)||[]).length
 if(digits===0)return formatted.startsWith('-')?1:0
 let count=0
 for(let i=0;i<formatted.length;i++){
  if(/\d/.test(formatted[i])&&++count===digits)return i+1
 }
 return formatted.length
}
