export const normalizeDateStart = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const daysBetweenDates = (from, to) => {
  const a = normalizeDateStart(from);
  const b = normalizeDateStart(to);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
};

export const calculateNextDueDate = (currentDueDate, frequency, intervalDays = 30) => {
  const next = new Date(currentDueDate);
  switch (frequency) {
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + 1);
      break;
    case 'custom':
      next.setDate(next.getDate() + Math.max(1, Number(intervalDays) || 30));
      break;
    default:
      next.setMonth(next.getMonth() + 1);
  }
  return next;
};

export const frequencyLabel = (frequency, intervalDays) => {
  switch (frequency) {
    case 'weekly':
      return 'Every week';
    case 'monthly':
      return 'Every month';
    case 'yearly':
      return 'Every year';
    case 'custom':
      return `Every ${intervalDays || 30} days`;
    default:
      return frequency;
  }
};

export const shouldStopRecurring = (nextDueDate, repeatUntil) => {
  if (!repeatUntil) return false;
  return normalizeDateStart(nextDueDate) > normalizeDateStart(repeatUntil);
};

export const createExpenseFromRecurring = async (ExpenseModel, recurring, userId, date = new Date()) => {
  const expense = new ExpenseModel({
    title: recurring.title,
    amount: recurring.amount,
    category: recurring.category || 'general',
    date,
    note: recurring.note
      ? `${recurring.note} (recurring)`
      : `Recurring expense (${recurring.frequency})`,
    userId,
  });
  await expense.save();
  return expense;
};

export const advanceRecurringExpense = async (recurring) => {
  const nextDue = calculateNextDueDate(
    recurring.nextDueDate,
    recurring.frequency,
    recurring.intervalDays,
  );

  if (shouldStopRecurring(nextDue, recurring.repeatUntil)) {
    recurring.active = false;
    recurring.nextDueDate = nextDue;
  } else {
    recurring.nextDueDate = nextDue;
    recurring.active = true;
  }

  recurring.lastReminderStage = '';
  recurring.lastNotifiedAt = undefined;
  await recurring.save();
  return recurring;
};
