export interface SavingsPeriodGoal {
  goal_mode?: string | null
  start_on?: string | null
  target_on?: string | null
}
export interface SavingsPeriodResult {
  start: string
  end: string
  status: string
  finished: boolean
}
export function savingsPeriodDisplay(
  goal: SavingsPeriodGoal | null | undefined,
  key: string,
  today: string
): SavingsPeriodResult | null
