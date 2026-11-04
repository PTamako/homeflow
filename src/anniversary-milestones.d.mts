export interface AnniversaryMilestoneEvent {
  event_date?: string | null
  nextOn?: string | null
  repeat_mode?: string | null
  source?: string | null
  title?: string | null
}
export declare function anniversaryMilestoneLabel(event: AnniversaryMilestoneEvent, asOf: string): string
