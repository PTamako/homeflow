// Presentation-only labels for wish_type. Persist the stable API/D1 code.
const WISH_TYPE_LABELS=Object.freeze({
  purchase:'购物',
  trip:'旅行',
  activity:'体验',
  other:'其他'
})
export function wishTypeLabel(type){
  const key=String(type??'').trim().toLowerCase()
  return WISH_TYPE_LABELS[key]||'其他'
}
