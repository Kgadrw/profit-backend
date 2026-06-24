export function normalizeMoneyDate(value) {
  if (!value) return new Date();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    const parsed = new Date(`${value}T00:00:00`);
    parsed.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return parsed;
  }
  return new Date(value);
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function computeBudgetPeriodBounds(depositDate, budgetPeriod, customStart, customEnd) {
  const base = startOfDay(depositDate instanceof Date ? depositDate : new Date(depositDate));
  const year = base.getFullYear();
  const month = base.getMonth();

  if (budgetPeriod === 'custom') {
    const periodStart = customStart ? startOfDay(customStart) : base;
    const periodEnd = customEnd ? endOfDay(customEnd) : endOfDay(base);
    if (periodEnd < periodStart) {
      return { periodStart, periodEnd: endOfDay(periodStart) };
    }
    return { periodStart, periodEnd };
  }

  if (budgetPeriod === 'quarterly') {
    const quarter = Math.floor(month / 3);
    const periodStart = new Date(year, quarter * 3, 1);
    const periodEnd = endOfDay(new Date(year, quarter * 3 + 3, 0));
    return { periodStart, periodEnd };
  }

  if (budgetPeriod === 'yearly') {
    const periodStart = new Date(year, 0, 1);
    const periodEnd = endOfDay(new Date(year, 11, 31));
    return { periodStart, periodEnd };
  }

  // monthly (default)
  const periodStart = new Date(year, month, 1);
  const periodEnd = endOfDay(new Date(year, month + 1, 0));
  return { periodStart, periodEnd };
}

export function getViewPeriodBounds(viewPeriod, referenceDate = new Date()) {
  const ref = startOfDay(referenceDate);
  const year = ref.getFullYear();
  const month = ref.getMonth();

  if (viewPeriod === 'quarterly') {
    const quarter = Math.floor(month / 3);
    const periodStart = new Date(year, quarter * 3, 1);
    const periodEnd = endOfDay(new Date(year, quarter * 3 + 3, 0));
    return { periodStart, periodEnd };
  }

  if (viewPeriod === 'yearly') {
    const periodStart = new Date(year, 0, 1);
    const periodEnd = endOfDay(new Date(year, 11, 31));
    return { periodStart, periodEnd };
  }

  const periodStart = new Date(year, month, 1);
  const periodEnd = endOfDay(new Date(year, month + 1, 0));
  return { periodStart, periodEnd };
}

export function periodsOverlap(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}
