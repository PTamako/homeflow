export declare function upcomingWithinDays<T extends {nextOn?: string | null}>(
  items: T[], today: string, days?: number
): T[]

export declare function additionalReminders<T extends {kind: string; id: string}>(
  items: T[], todayEntryKeys: string[]
): T[]
