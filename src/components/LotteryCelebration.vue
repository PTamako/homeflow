<script setup lang="ts">
import {computed} from 'vue'

type PrizeKind='empty'|'five'|'ten'|'twenty'|'fifty'|'double'
type Draw={id:string;kind:PrizeKind;points:number}
const props=defineProps<{draw:Draw|null}>()
const mode=computed(()=>
 props.draw?.kind==='empty'?'empty':
 props.draw?.kind==='double'?'jackpot':
 props.draw?.kind==='fifty'||props.draw?.kind==='twenty'?'rare':'win')
const title=computed(()=>{
 switch(props.draw?.kind){
  case 'empty':return '哎呀，空手而归！'
  case 'five':return '🎉 小幸运降临！'
  case 'ten':return '🎊 好运正在靠近！'
  case 'twenty':return '💎 幸运爆棚！'
  case 'fifty':return '🌟 稀有大奖！'
  case 'double':return '👑 传说级大奖！'
  default:return ''
 }
})
const caption=computed(()=>props.draw?.kind==='empty'?'好运正在蓄力，下次再来！':
 props.draw?.kind==='double'?'积分翻倍，今天幸运值拉满！':
 props.draw?.kind==='fifty'?'金色好运，稀有奖励已到账！':'奖励已计入可用家庭积分')
// CSS-only particles have bounded counts and stable deterministic positions.
// This avoids canvas, libraries and sustained rendering loops on mobile.
const confetti=Array.from({length:60},(_,index)=>({
 left:((index*47+13)%101)+'%',
 delay:((index%11)*68)+'ms',
 duration:(1750+(index%7)*155)+'ms',
 drift:(((index*53)%181)-90)+'px',
 rotation:(((index*97)%720)-360)+'deg'
}))
const rain=Array.from({length:14},(_,index)=>({
 left:((index*31+7)%96)+'%',
 delay:((index%6)*170)+'ms',
 duration:(1050+(index%5)*160)+'ms'
}))
</script>

<template>
 <Teleport to="body">
  <Transition name="lottery-fx">
   <div v-if="draw" :key="draw.id" class="lottery-fx" :class="'lottery-fx--'+mode"
     role="status" aria-live="polite" aria-atomic="true">
    <div class="lottery-fx-backdrop" aria-hidden="true"></div>
    <div v-if="mode!=='empty'" class="lottery-fx-confetti" aria-hidden="true">
     <i v-for="(piece,index) in confetti.slice(0,mode==='jackpot'?60:mode==='rare'?44:32)"
       :key="index" class="lottery-fx-piece"
       :style="{'--left':piece.left,'--delay':piece.delay,'--duration':piece.duration,
        '--drift':piece.drift,'--rotation':piece.rotation}"></i>
    </div>
    <div v-else class="lottery-fx-rain" aria-hidden="true">
     <i v-for="(drop,index) in rain" :key="index" class="lottery-fx-drop"
       :style="{'--left':drop.left,'--delay':drop.delay,'--duration':drop.duration}"></i>
    </div>
    <div class="lottery-fx-center">
     <div v-if="mode==='jackpot'" class="lottery-fx-halo" aria-hidden="true"></div>
     <div class="lottery-fx-emblem" aria-hidden="true">
      {{ mode==='empty'?'🥀':mode==='jackpot'?'💰':mode==='rare'?'🏆':'🎁' }}
     </div>
     <strong class="lottery-fx-title">{{ title }}</strong>
     <div v-if="draw.kind!=='empty'" class="lottery-fx-award">
      <span v-if="mode==='jackpot'" class="lottery-fx-double-label">JACKPOT · 积分翻倍</span>
      <span class="lottery-fx-total">+{{ draw.points.toLocaleString('zh-CN') }}<small>积分</small></span>
     </div>
     <p>{{ caption }}</p>
    </div>
   </div>
  </Transition>
 </Teleport>
</template>

<style scoped>
.lottery-fx{position:fixed;inset:0;z-index:13000;display:grid;place-items:center;
 overflow:hidden;pointer-events:none;isolation:isolate;padding:env(safe-area-inset-top) 16px env(safe-area-inset-bottom);
 box-sizing:border-box;transform:translateZ(0)}
.lottery-fx-backdrop{position:absolute;inset:0;background:rgba(21,38,27,.59)}
.lottery-fx--empty .lottery-fx-backdrop{background:rgba(39,43,45,.74)}
.lottery-fx--rare .lottery-fx-backdrop{background:rgba(43,32,10,.73)}
.lottery-fx--jackpot .lottery-fx-backdrop{
 background:radial-gradient(circle at 50% 43%,#654311d9 0%,#25190aeb 55%,#140c08f2 100%)}
.lottery-fx-center{position:relative;z-index:2;display:grid;justify-items:center;gap:12px;
 box-sizing:border-box;max-width:min(92vw,400px);min-width:0;width:100%;padding:30px 22px;
 text-align:center;border-radius:26px;color:#fff;
 background:linear-gradient(153deg,#fffffff0 0%,#effbf5f4 100%);
 box-shadow:0 28px 65px #0b241e7d;animation:lottery-fx-pop .65s cubic-bezier(.19,1.35,.42,1) both}
.lottery-fx--empty .lottery-fx-center{background:linear-gradient(160deg,#f1f2f3f5,#c7d1d4f5);
 color:#45515b;animation:lottery-fx-loser .83s ease-out both}
.lottery-fx--rare .lottery-fx-center{background:linear-gradient(142deg,#fffdf3,#ffebaf);
 box-shadow:0 22px 70px #e9b8437d}
.lottery-fx--jackpot .lottery-fx-center{background:linear-gradient(135deg,#fff8d6 0%,#f9d577 48%,#fff4c6 100%);
 border:2px solid #fff1a7;box-shadow:0 0 35px #ffe084b5,0 0 95px #f8cc4666,0 25px 65px #26150b77;
 animation:lottery-fx-jackpot .8s cubic-bezier(.12,1.5,.35,1) both}
.lottery-fx-emblem{font-size:clamp(60px,17vw,94px);line-height:1.2;filter:drop-shadow(0 7px 5px #22222230);
 animation:lottery-fx-bounce 1.4s ease-in-out 1}
.lottery-fx--empty .lottery-fx-emblem{filter:grayscale(.65);animation:lottery-fx-sigh 1.4s ease-out both}
.lottery-fx--jackpot .lottery-fx-emblem{animation:lottery-fx-rich 1.15s ease-in-out 2}
.lottery-fx-title{font-size:clamp(20px,6vw,30px);line-height:1.35;color:#276348;letter-spacing:.02em}
.lottery-fx--empty .lottery-fx-title{color:#667078}
.lottery-fx--rare .lottery-fx-title,.lottery-fx--jackpot .lottery-fx-title{color:#805117}
.lottery-fx-award{display:grid;justify-items:center;gap:3px}
.lottery-fx-total{font-size:clamp(39px,11vw,58px);line-height:1.1;color:#d78e1d;font-weight:900;
 font-variant-numeric:tabular-nums;letter-spacing:-.04em}
.lottery-fx-total small{font-size:15px;margin-left:5px;letter-spacing:0}
.lottery-fx--jackpot .lottery-fx-total{color:#ad6100;text-shadow:0 2px 0 #ffffffbf}
.lottery-fx-double-label{font-size:11px;font-weight:900;letter-spacing:.2em;color:#a8650d}
.lottery-fx-center p{font-size:13px;line-height:1.5;margin:0;color:#54715e}
.lottery-fx--empty .lottery-fx-center p{color:#667078}
.lottery-fx--rare .lottery-fx-center p,.lottery-fx--jackpot .lottery-fx-center p{color:#96723c}
.lottery-fx-halo{position:absolute;inset:-40%;z-index:-1;border-radius:50%;
 background:repeating-conic-gradient(from 0deg,#ffe88c55 0deg 8deg,transparent 8deg 23deg);
 animation:lottery-fx-halo 10s linear infinite}
.lottery-fx-confetti,.lottery-fx-rain{position:absolute;inset:0;overflow:hidden;z-index:1}
.lottery-fx-piece{position:absolute;top:-12vh;left:var(--left);width:9px;height:17px;
 border-radius:2px;background:#ffe39a;opacity:0;
 animation:lottery-fx-fall var(--duration) ease-in var(--delay) 1 forwards;
 will-change:transform,opacity}
.lottery-fx-piece:nth-child(5n+1){background:#ef7498;width:7px;height:14px}
.lottery-fx-piece:nth-child(5n+2){background:#76cbac;width:10px;height:10px;border-radius:50%}
.lottery-fx-piece:nth-child(5n+3){background:#8dacfa;width:6px;height:19px}
.lottery-fx-piece:nth-child(5n+4){background:#f2b94c;width:12px;height:8px}
.lottery-fx--jackpot .lottery-fx-piece{background:#ffdc64;box-shadow:0 0 10px #ffdc6488}
.lottery-fx--jackpot .lottery-fx-piece:nth-child(3n){background:#fff8c5;border-radius:50%}
.lottery-fx--rare .lottery-fx-piece:nth-child(3n){background:#ffda6d}
.lottery-fx-drop{position:absolute;top:-8%;left:var(--left);width:3px;height:24px;border-radius:20px;
 background:linear-gradient(#becbd4,transparent);opacity:0;
 animation:lottery-fx-drizzle var(--duration) ease-in var(--delay) 2}
.lottery-fx-enter-active{transition:opacity .16s ease}
.lottery-fx-leave-active{transition:opacity .22s ease}
.lottery-fx-enter-from,.lottery-fx-leave-to{opacity:0}
@keyframes lottery-fx-pop{0%{opacity:0;transform:translateY(46px) scale(.65)}
 65%{opacity:1;transform:translateY(-8px) scale(1.04)}100%{transform:none}}
@keyframes lottery-fx-jackpot{0%{opacity:0;transform:scale(.24) rotate(-8deg)}
 58%{opacity:1;transform:scale(1.12) rotate(2deg)}100%{transform:none}}
@keyframes lottery-fx-loser{0%{opacity:0;transform:translateY(-20px) rotate(0deg)}
 24%{opacity:1;transform:translateX(-14px) rotate(-5deg)}
 42%{transform:translateX(11px) rotate(4deg)}
 58%{transform:translateX(-6px) rotate(-2deg)}
 100%{transform:translateY(20px) rotate(-3deg);opacity:1}}
@keyframes lottery-fx-sigh{0%{transform:translateY(-8px) rotate(8deg)}
 55%{transform:translateY(14px) rotate(-10deg)}100%{transform:translateY(12px) rotate(-9deg)}}
@keyframes lottery-fx-bounce{0%,100%{transform:translateY(0) rotate(0deg)}
 40%{transform:translateY(-14px) rotate(-12deg)}70%{transform:translateY(2px) rotate(8deg)}}
@keyframes lottery-fx-rich{0%,100%{transform:scale(1) rotate(0deg)}
 35%{transform:scale(1.28) rotate(-10deg)}70%{transform:scale(.96) rotate(9deg)}}
@keyframes lottery-fx-halo{to{transform:rotate(360deg)}}
@keyframes lottery-fx-fall{0%{opacity:0;transform:translate3d(0,-4vh,0) rotate(0deg)}
 9%{opacity:1}85%{opacity:1}
 100%{opacity:0;transform:translate3d(var(--drift),112vh,0) rotate(var(--rotation))}}
@keyframes lottery-fx-drizzle{0%{opacity:0;transform:translateY(-4vh)}
 15%,75%{opacity:.75}100%{opacity:0;transform:translateY(100vh)}}
@media (prefers-reduced-motion:reduce){
 .lottery-fx-center,.lottery-fx-emblem,.lottery-fx-halo,.lottery-fx-piece,.lottery-fx-drop{animation:none!important}
 .lottery-fx-piece,.lottery-fx-drop{display:none}
 .lottery-fx-enter-active,.lottery-fx-leave-active{transition:none}
}
</style>
