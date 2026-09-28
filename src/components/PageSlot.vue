<script setup lang="ts">
import { computed, provide, type Component } from 'vue'
import { useRouter, type RouteLocationNormalizedLoaded } from 'vue-router'
import { PAGE_SHOWN, VIEW_ROUTE, pageLocation } from '@/app/paging'

/** Один экран ленты: даёт экрану его собственный адрес и признак «на месте» */
const props = defineProps<{ index: number; shown: boolean; view: Component }>()
const router = useRouter()

provide(VIEW_ROUTE, router.resolve(pageLocation(props.index)) as unknown as RouteLocationNormalizedLoaded)
provide(
  PAGE_SHOWN,
  computed(() => props.shown),
)
</script>

<template>
  <component :is="view" />
</template>
