// Pure, dependency-free option matching shared by all mobile selection sheets.
// This never makes a network request or changes the underlying form value.
export const normalizeMobileSelectSearch=value=>String(value??'').normalize('NFKC')
  .toLocaleLowerCase().trim().replace(/\s+/g,' ')

export function filterMobileSelectOptions(options,term){
 const search=normalizeMobileSelectSearch(term)
 if(!search)return options
 const parts=search.split(' ').filter(Boolean)
 return options.filter(option=>{
  const haystack=normalizeMobileSelectSearch(option.label+' '+(option.group||''))
  return parts.every(part=>haystack.includes(part))
 })
}

export const shouldSearchMobileSelect=(options,forced=false)=>
 forced||options.length>=7
