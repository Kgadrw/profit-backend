/** Lightweight task activity helpers for project contribution graphs. */

export const TASK_ACTIVITY_KINDS = ['created', 'started', 'progress', 'completed'];

const ACTIVITY_WEIGHT = {
  created: 1,
  started: 1,
  progress: 1,
  completed: 2,
};

export function dayKeyFromDate(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Append an activity event onto a mongoose task document (mutates in place).
 * `progress` is capped to one event per calendar day.
 */
export function pushTaskActivity(task, kind) {
  if (!TASK_ACTIVITY_KINDS.includes(kind)) return;
  if (!Array.isArray(task.activityEvents)) task.activityEvents = [];

  const now = new Date();
  if (kind === 'progress') {
    const todayKey = dayKeyFromDate(now);
    const already = task.activityEvents.some(
      (event) => event?.kind === 'progress' && dayKeyFromDate(event.at) === todayKey,
    );
    if (already) return;
  }

  task.activityEvents.push({ at: now, kind });
  if (task.activityEvents.length > 120) {
    task.activityEvents = task.activityEvents.slice(-120);
  }

  if (kind === 'started' && !task.startedAt) {
    task.startedAt = now;
  }
}

export function initialTaskActivityFields(status) {
  const now = new Date();
  const events = [{ at: now, kind: 'created' }];
  const fields = {
    activityEvents: events,
  };

  if (status === 'in_progress') {
    events.push({ at: now, kind: 'started' });
    fields.startedAt = now;
  }
  if (status === 'done') {
    events.push({ at: now, kind: 'started' });
    events.push({ at: now, kind: 'completed' });
    fields.startedAt = now;
    fields.completedAt = now;
  }

  return fields;
}

/**
 * Apply status-transition activity onto a task document after fields are updated.
 */
export function applyTaskStatusActivity(task, prevStatus) {
  const next = task.status;
  if (next === prevStatus) return;

  if (next === 'in_progress') {
    pushTaskActivity(task, 'started');
  } else if (next === 'done') {
    if (!task.startedAt && prevStatus !== 'in_progress') {
      pushTaskActivity(task, 'started');
    }
    pushTaskActivity(task, 'completed');
  } else if (prevStatus === 'in_progress' || prevStatus === 'done') {
    // Moving back / sideways still counts as a small team move.
    pushTaskActivity(task, 'progress');
  }
}

/**
 * Non-status field edits while a task is actively worked count as progress.
 */
export function applyTaskProgressTouch(task, prevStatus, statusChanged) {
  if (statusChanged) return;
  if (task.status === 'in_progress' || prevStatus === 'in_progress') {
    pushTaskActivity(task, 'progress');
  }
}

/** Derive graph events from stored log or fallback timestamps. */
export function deriveTaskActivityEvents(task) {
  if (Array.isArray(task.activityEvents) && task.activityEvents.length > 0) {
    return task.activityEvents
      .filter((event) => event?.at && TASK_ACTIVITY_KINDS.includes(event.kind))
      .map((event) => ({
        at: event.at,
        kind: event.kind,
        weight: ACTIVITY_WEIGHT[event.kind] || 1,
        projectId: task.projectId,
      }));
  }

  const events = [];
  if (task.createdAt) {
    events.push({ at: task.createdAt, kind: 'created', weight: ACTIVITY_WEIGHT.created });
  }
  if (task.startedAt) {
    events.push({ at: task.startedAt, kind: 'started', weight: ACTIVITY_WEIGHT.started });
  } else if (task.status === 'in_progress' && task.updatedAt) {
    events.push({ at: task.updatedAt, kind: 'started', weight: ACTIVITY_WEIGHT.started });
  } else if (
    task.status === 'done' &&
    task.updatedAt &&
    task.completedAt &&
    dayKeyFromDate(task.updatedAt) !== dayKeyFromDate(task.completedAt)
  ) {
    events.push({ at: task.updatedAt, kind: 'progress', weight: ACTIVITY_WEIGHT.progress });
  }
  if (task.completedAt) {
    events.push({ at: task.completedAt, kind: 'completed', weight: ACTIVITY_WEIGHT.completed });
  }

  return events.map((event) => ({ ...event, projectId: task.projectId }));
}

export function activityWeight(kind) {
  return ACTIVITY_WEIGHT[kind] || 1;
}
