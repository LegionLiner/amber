/** Серии дней подряд с засчитанными прослушиваниями */

function dayNumber(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000)
}

export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export interface Streaks {
  current: number
  longest: number
}

/** days — отсортированные 'YYYY-MM-DD'. Текущая серия жива, если последний день сегодня или вчера. */
export function computeStreaks(days: string[], today = todayKey()): Streaks {
  if (!days.length) return { current: 0, longest: 0 }
  const nums = days.map(dayNumber)
  let longest = 1
  let run = 1
  for (let i = 1; i < nums.length; i++) {
    run = nums[i]! - nums[i - 1]! === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }
  const t = dayNumber(today)
  const last = nums[nums.length - 1]!
  let current = 0
  if (t - last <= 1) {
    current = 1
    for (let i = nums.length - 1; i > 0 && nums[i]! - nums[i - 1]! === 1; i--) current++
  }
  return { current, longest }
}
