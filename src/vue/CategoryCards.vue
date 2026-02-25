<template>
  <div class="vue-cat-grid">
    <TransitionGroup name="card" tag="div" class="cat-container">
      <div
        v-for="cat in categories"
        :key="cat.category"
        class="cat-card"
        :class="{ active: selected === cat.category }"
        @click="$emit('select', cat.category)"
        :style="{ '--accent': colors[cat.category] || '#6B7280' }"
      >
        <div class="cat-icon">{{ cat.icon }}</div>
        <div class="cat-label">{{ cat.label }}</div>
        <div class="cat-count">{{ formatCount(cat.count) }} 件</div>
        <div class="cat-bar">
          <div class="cat-bar-fill" :style="{ width: barWidth(cat) + '%' }"></div>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue';

const props = defineProps({
  categories: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
  totalSize: { type: Number, default: 0 }
});

defineEmits(['select']);

const colors = {
  document: '#3B82F6', image: '#EC4899', video: '#8B5CF6',
  audio: '#06B6D4', code: '#10B981', archive: '#F59E0B',
  font: '#6366F1', data: '#EF4444', other: '#6B7280'
};

function formatCount(n) { return (n || 0).toLocaleString(); }

function barWidth(cat) {
  if (!props.totalSize || !cat.total_size) return 0;
  return Math.max(3, (cat.total_size / props.totalSize) * 100);
}
</script>

<style scoped>
.cat-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}

.cat-card {
  background: var(--surface, #fff);
  border-radius: 16px;
  padding: 20px 12px 16px;
  text-align: center;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s ease;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  user-select: none;
}

.cat-card:hover {
  border-color: var(--accent);
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.1);
}

.cat-card.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, white);
}

.cat-icon { font-size: 36px; margin-bottom: 8px; }
.cat-label { font-size: 14px; font-weight: 600; margin-bottom: 3px; color: var(--text, #1A1A1A); }
.cat-count { font-size: 12px; color: var(--text-secondary, #6B6B6B); margin-bottom: 10px; }

.cat-bar {
  height: 4px;
  background: var(--border, #E8E4DF);
  border-radius: 2px;
  overflow: hidden;
}

.cat-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-enter-active, .card-leave-active { transition: all 0.3s ease; }
.card-enter-from, .card-leave-to { opacity: 0; transform: translateY(12px) scale(0.95); }
</style>
