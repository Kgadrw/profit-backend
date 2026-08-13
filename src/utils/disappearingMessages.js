/** Allowed disappearing-message durations (seconds). */
export const DISAPPEARING_DURATIONS = {
  OFF: 0,
  HOURS_24: 24 * 60 * 60,
  WEEKS_7: 7 * 7 * 24 * 60 * 60,
};

export const DISAPPEARING_DURATION_SET = new Set(
  Object.values(DISAPPEARING_DURATIONS),
);

export function resolveExpiresAt(durationSec, fromDate = new Date()) {
  const sec = Number(durationSec) || 0;
  if (sec <= 0) return null;
  return new Date(fromDate.getTime() + sec * 1000);
}

export function isAllowedDisappearingDuration(value) {
  return DISAPPEARING_DURATION_SET.has(Number(value) || 0);
}
