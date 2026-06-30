// Allowance math. $20 lands in the shared bank at midnight Vancouver time,
// every day. The bank was reset to $0 on the reset date below: that day banks
// nothing, and $20 lands at each following midnight (so the day after the reset
// reads $20).
//
//   bank = 20 * (midnights since the reset) - (spending on/after the reset)

export const DAILY_ALLOWANCE = 20;

// The day the shared bank was last reset to $0, as a civil date in
// America/Vancouver. Reset day banks $0; every following midnight adds $20.
// Spending before this date is historical and no longer counts against the
// bank (see countsAgainstBank / BankApp).
const RESET = { year: 2026, month: 6, day: 30 };

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

// How many $20 drops have landed since the reset. Reset day = 0 (the bank reads
// $0 that day); each Vancouver midnight after it adds one.
export function allowanceDays(now: Date = new Date()): number {
  return Math.max(0, dayNumber(vancouverToday(now)) - dayNumber(RESET));
}

export function totalAllowance(now: Date = new Date()): number {
  return allowanceDays(now) * DAILY_ALLOWANCE;
}

// The headline number: accrued allowance minus everything spent.
export function bankBalance(totalSpent: number, now: Date = new Date()): number {
  return totalAllowance(now) - totalSpent;
}

// True once a transaction counts against the post-reset bank: its civil date in
// Vancouver is on or after the reset day. Older spending stays visible in
// activity and analytics but no longer moves the balance.
export function countsAgainstBank(createdAt: string | Date): boolean {
  return dayNumber(vancouverToday(new Date(createdAt))) >= dayNumber(RESET);
}

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}
