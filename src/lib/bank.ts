// Allowance math. $20 lands in the shared bank at midnight Vancouver time,
// every day. Day 1 is the launch day (you get $20 the moment it starts).
//
//   bank = 20 * (days since launch, inclusive) - (everything spent)

export const DAILY_ALLOWANCE = 20;

// Launch day, as a civil date in America/Vancouver. Today = 2026-05-30.
const LAUNCH = { year: 2026, month: 5, day: 30 };

const VANCOUVER = "America/Vancouver";

// The current calendar date *in Vancouver*, regardless of the viewer's own
// timezone, broken into civil y/m/d parts.
function vancouverToday(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VANCOUVER,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Treat a civil date as a count of days, so we can subtract two of them
// without any DST / timezone drift. Uses a UTC anchor purely as arithmetic.
function dayNumber(d: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(d.year, d.month - 1, d.day) / 86_400_000);
}

// How many $20 drops have landed so far (launch day counts as 1).
export function allowanceDays(now: Date = new Date()): number {
  const elapsed = dayNumber(vancouverToday(now)) - dayNumber(LAUNCH);
  return Math.max(0, elapsed) + 1;
}

export function totalAllowance(now: Date = new Date()): number {
  return allowanceDays(now) * DAILY_ALLOWANCE;
}

// The headline number: accrued allowance minus everything spent.
export function bankBalance(totalSpent: number, now: Date = new Date()): number {
  return totalAllowance(now) - totalSpent;
}

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}
