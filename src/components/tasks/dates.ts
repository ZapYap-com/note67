/** Whether an open task's due date is before today (local time). */
export function isOverdue(date: string | null, done = false): boolean {
  if (!date || done) return false;
  return date < new Date().toLocaleDateString("en-CA");
}
