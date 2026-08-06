// True when today's month/day matches the given date of birth — year is
// ignored deliberately, this is just "is it their birthday today?".
export function isBirthdayToday(dob: string | null): boolean {
  if (!dob) return false;
  const parts = dob.split("-").map(Number);
  const month = parts[1];
  const day = parts[2];
  if (!month || !day) return false;
  const today = new Date();
  return month === today.getMonth() + 1 && day === today.getDate();
}
