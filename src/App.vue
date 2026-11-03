<script setup lang="ts">
import { onMounted, ref } from 'vue'
const api = ref('正在检查环境…')
onMounted(async () => {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' })
    const result = await response.json() as { ok?: boolean }
    api.value = response.ok && result.ok ? 'API 与 D1 连接正常' : 'API 尚未连接'
  } catch {
    api.value = '本地预览模式 · 尚未连接 Worker'
  }
})
const navigation = [
  { icon: '☀', label: '今天' },
  { icon: '✓', label: '计划' },
  { icon: '▧', label: '时光轴' },
  { icon: '🐾', label: '豆沙' },
  { icon: '⌂', label: '家庭' },
]
const sections = [
  { icon: '✓', name: '今日必做', sub: '个人与家庭任务，支持每日/周期重复', flag: '下一阶段' },
  { icon: '🎂', name: '纪念日与提醒', sub: '生日、周年、自定义日期与豆沙驱虫', flag: '规划中' },
  { icon: '✈', name: '旅行与心愿', sub: '心愿转计划、行李清单与 JSON 导入', flag: '规划中' },
  { icon: '▧', name: '我们的时光轴', sub: '照片、旅行回忆、豆沙成长与日记', flag: '规划中' },
]
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand"><span class="brand-icon">⌂</span><span>HomeFlow</span></div>
      <span class="phase">阶段 0 · 初始化</span>
    </header>
    <main class="content">
      <div class="eyebrow">OUR LITTLE HOME</div>
      <h1>我们的小家 <span aria-hidden="true">♡</span></h1>
      <p class="lead">生活里的重要小事，都有一个温暖的家。</p>
      <section class="hero" aria-label="项目状态">
        <div><span class="hero-kicker">准备就绪</span><h2>从今天，开始记录生活。</h2>
        <p>私人的待办、家人的纪念日、豆沙的日常，以及一起实现的旅行心愿。</p></div>
        <span class="hero-mark" aria-hidden="true">✿</span>
      </section>
      <div class="section-title"><h2>即将开放</h2><span>功能骨架预览</span></div>
      <div class="tiles">
        <article v-for="section in sections" :key="section.name" class="tile">
          <div class="tile-top"><span class="tile-icon">{{ section.icon }}</span><span class="tag">{{ section.flag }}</span></div>
          <h3>{{ section.name }}</h3>
          <p>{{ section.sub }}</p>
        </article>
      </div>
      <div class="status" role="status"><span aria-hidden="true">●</span> {{ api }} · 个人数据功能尚未启用</div>
    </main>
    <nav class="nav" aria-label="主要导航，功能建设中">
      <div v-for="item in navigation" :key="item.label" class="nav-item" aria-disabled="true">
        <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span><span>{{ item.label }}</span>
      </div>
    </nav>
  </div>
</template>
