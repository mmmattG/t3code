// @effect-diagnostics globalDate:off -- UI snooze presets use local calendar boundaries and Intl labels.
import {
  MAX_SNOOZE_PRESET_AMOUNT,
  MAX_SNOOZE_PRESETS,
  SnoozePresetRule,
  type SnoozePresetUnit,
} from "@t3tools/contracts/settings";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

interface SettlementRunLike {
  readonly turnId?: unknown;
  readonly assistantMessageId?: unknown;
  readonly status?: string;
  readonly state?: string;
  readonly requestedAt?: string | null;
  readonly startedAt?: string | null;
  readonly completedAt?: string | null;
}

interface SettlementRuntimeLike {
  readonly threadId?: unknown;
  readonly providerName?: unknown;
  readonly runtimeMode?: unknown;
  readonly activeTurnId?: unknown;
  readonly lastError?: unknown;
  readonly status: string;
  readonly updatedAt?: string;
}

interface QueuedThreadShell {
  readonly latestUserMessageAt?: string | null;
  readonly latestTurn?: SettlementRunLike | null;
  readonly latestRun?: SettlementRunLike | null;
  readonly session?: SettlementRuntimeLike | null;
  readonly runtime?: SettlementRuntimeLike | null;
}

/**
 * A queued turn start lives for at most this long: session adoption takes
 * seconds, so a user message still unadopted after the grace window is a
 * failed start (or stale data — shells from older servers can carry user
 * messages with no latestTurn at all), not pending work. Without this bound
 * such threads would be permanently unsettleable.
 */
export const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * A user message no turn has picked up yet: the turn.start command was
 * dispatched (message-sent + turn-start-requested) but no session has
 * adopted it, so `session` is still null and the pending work is invisible
 * to the session-status checks. Detectable as a user message strictly newer
 * than every timestamp on the latest turn — on adoption the new turn's
 * requestedAt equals the message time, clearing the condition — and only
 * within the adoption grace window.
 */
export function hasQueuedTurnStart(
  shell: QueuedThreadShell,
  options: { readonly now: string },
): boolean {
  if (
    shell.runtime?.status === "preparing" ||
    shell.runtime?.status === "queued" ||
    shell.runtime?.status === "starting"
  ) {
    return true;
  }
  if (shell.latestUserMessageAt == null) return false;
  // A failed session start clears the queued state: the failure is already
  // visible (status edge / error).
  if (shell.session?.status === "error") return false;
  const messageAt = Date.parse(shell.latestUserMessageAt);
  if (Number.isNaN(messageAt)) return false;
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(nowMs)) return false;
  // Bounded on both sides: message timestamps originate on whichever device
  // sent the message, so a clock ahead of this one yields a negative age
  // that would otherwise hold the queued state for the whole skew. Mirrors
  // the decider's guard.
  if (Math.abs(nowMs - messageAt) > QUEUED_TURN_START_GRACE_MS) return false;
  const turn = shell.latestRun ?? shell.latestTurn ?? null;
  if (turn === null) return true;
  return [turn.requestedAt, turn.startedAt, turn.completedAt].every(
    (candidate) => candidate == null || Date.parse(candidate) < messageAt,
  );
}

/**
 * The snooze lifecycle fields plus everything needed to detect a raised
 * hand. Snooze is an overlay on the active state: a snoozed thread stays
 * "active" in the data model and is only suppressed from the inbox until
 * its wake time passes or the thread demands attention.
 */
export interface ThreadSnoozeShell extends QueuedThreadShell {
  readonly snoozedUntil?: string | null;
  readonly snoozedAt?: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}

/**
 * A snoozed thread "raises its hand" when something happens that outranks
 * the user's snooze: the agent is blocked on them (approval / user input),
 * the session failed, or a run completed after the snooze was set — the
 * v1 taste of event-based snooze ("something happened" wakes early).
 * Raising a hand never clears the server-side snooze fields; it only stops
 * the thread from classifying as snoozed.
 */
export function threadRaisedHandWhileSnoozed(shell: ThreadSnoozeShell): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return true;
  const runtime = shell.runtime ?? shell.session ?? null;
  const latestRun = shell.latestRun ?? shell.latestTurn ?? null;
  // Only a FRESH failure raises the hand: a thread snoozed while already
  // failed stays snoozed — that snooze was the user saying "I saw it, not
  // now". session.updatedAt stamps the status edge, so an error newer than
  // the snooze is new information.
  if (
    (runtime?.status === "error" || runtime?.status === "failed") &&
    (shell.snoozedAt == null ||
      (runtime.updatedAt != null && Date.parse(runtime.updatedAt) > Date.parse(shell.snoozedAt)))
  ) {
    return true;
  }
  if (
    shell.snoozedAt != null &&
    (latestRun?.state === "completed" || latestRun?.status === "completed") &&
    latestRun.completedAt != null &&
    Date.parse(latestRun.completedAt) > Date.parse(shell.snoozedAt)
  ) {
    return true;
  }
  return false;
}

/**
 * A thread may be snoozed unless the agent is blocked on the user: hiding a
 * pending approval or user-input request defeats the request, and a queued
 * turn start (a message no turn has adopted yet) is invisible pending work
 * the same way it is for settle. A running session IS snoozable — snooze
 * only affects visibility, never the agent. Client-side twin of the server
 * invariants so the UI can reject before a round trip.
 */
export function canSnooze(
  shell: Pick<
    ThreadSnoozeShell,
    | "hasPendingApprovals"
    | "hasPendingUserInput"
    | "latestUserMessageAt"
    | "latestTurn"
    | "latestRun"
    | "session"
    | "runtime"
  >,
  options: { readonly now: string },
): boolean {
  if (shell.hasPendingApprovals || shell.hasPendingUserInput) return false;
  if (hasQueuedTurnStart(shell, options)) return false;
  return true;
}

/**
 * Snoozed resolution: hidden from the inbox while the wake time is in the
 * future and the thread has not raised its hand. Timer wakes are derived —
 * no server event fires when snoozedUntil passes; the stale fields simply
 * stop classifying as snoozed (and feed the woke indicator until the user
 * visits or re-engages).
 */
export function effectiveSnoozed(
  shell: ThreadSnoozeShell,
  options: { readonly now: string },
): boolean {
  if (shell.snoozedUntil == null) return false;
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  // Malformed data never hides a thread.
  if (Number.isNaN(wakeAtMs)) return false;
  if (wakeAtMs <= Date.parse(options.now)) return false;
  return !threadRaisedHandWhileSnoozed(shell);
}

/**
 * When a previously-snoozed thread woke, or null if it never snoozed / is
 * still snoozed. Used for the "Woke" indicator: the thread reappears in its
 * original sort position (the inbox sort is deliberately static), so the
 * wake signal has to carry the weight. Compare against the client's
 * lastVisitedAt — visiting clears the indicator like it clears unread.
 *
 * Timer wakes report the wake time itself; raised-hand wakes report the
 * triggering timestamp so a visit BEFORE the early wake doesn't suppress
 * the indicator.
 */
export function threadWokeAt(
  shell: ThreadSnoozeShell,
  options: { readonly now: string },
): string | null {
  if (shell.snoozedUntil == null) return null;
  const wakeAtMs = Date.parse(shell.snoozedUntil);
  if (Number.isNaN(wakeAtMs)) return null;
  // An early hand-raise wake stays authoritative even after the scheduled
  // wake time passes: reporting snoozedUntil then would resurface a Woke
  // indicator the user already cleared by visiting (snoozedUntil is newer
  // than that visit's lastVisitedAt).
  if (threadRaisedHandWhileSnoozed(shell)) {
    const latestRun = shell.latestRun ?? shell.latestTurn ?? null;
    const runtime = shell.runtime ?? shell.session ?? null;
    if (
      shell.snoozedAt != null &&
      (latestRun?.state === "completed" || latestRun?.status === "completed") &&
      latestRun.completedAt != null &&
      Date.parse(latestRun.completedAt) > Date.parse(shell.snoozedAt)
    ) {
      return latestRun.completedAt;
    }
    return runtime?.updatedAt ?? shell.snoozedAt ?? null;
  }
  // No raised hand: woke iff the timer elapsed (still-snoozed → null).
  return wakeAtMs <= Date.parse(options.now) ? shell.snoozedUntil : null;
}

const HOUR_MS = 60 * 60 * 1_000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 9;
const SNOOZE_UNIT_MS: Record<SnoozePresetUnit, number> = {
  minutes: 60_000,
  hours: HOUR_MS,
  days: DAY_MS,
};
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
// The schema bounds weekdays to 0-6; the fallback only satisfies the index type.
function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? "";
}
/** Weekday choices for preset forms, Monday first. */
export const SNOOZE_PRESET_WEEKDAYS = ([1, 2, 3, 4, 5, 6, 0] as const).map((weekday) => ({
  weekday,
  label: WEEKDAY_NAMES[weekday],
}));

type BuiltInSnoozePresetId = "hour" | "three-hours" | "evening" | "tomorrow" | "next-week";
/** A built-in choice, or `saved:<rule key>` for a preset saved in settings. */
export type SnoozePresetId = BuiltInSnoozePresetId | `saved:${string}`;

export interface SnoozePreset {
  readonly id: SnoozePresetId;
  readonly label: string;
  /** Menu-row time column. Built-ins complement the label instead of
      repeating it: "Tomorrow" pairs with "9:00 AM", not "tomorrow 9:00 AM".
      Saved presets name a rule, so their column carries the day. */
  readonly whenLabel: string;
  /** ISO wake time. */
  readonly snoozedUntil: string;
}

export interface SnoozePresetOptions {
  /** Presets saved in settings, listed after the built-in choices. */
  readonly saved?: ReadonlyArray<SnoozePresetRule>;
  /** Formats a time of day. Web passes the user's clock preference. */
  readonly formatTime?: (date: Date) => string;
}

// The built-in choices that are plain rules. Saving a rule with one of these
// keys would only add a duplicate, so settings refuse it.
const BUILT_IN_SNOOZE_RULES = {
  hour: { kind: "delay", amount: 1, unit: "hours" },
  "three-hours": { kind: "delay", amount: 3, unit: "hours" },
  "next-week": { kind: "weekday", weekday: 1, time: "09:00" },
} as const satisfies Partial<Record<BuiltInSnoozePresetId, SnoozePresetRule>>;

function snoozeTimeOfDayLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function snoozeWeekdayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "short" });
}

function snoozeAtHour(base: Date, hour: number): Date {
  const next = DateTime.toDate(DateTime.makeUnsafe(base));
  next.setHours(hour, 0, 0, 0);
  return next;
}

// Calendar-day advance instead of adding DAY_MS: fixed millisecond offsets
// land on the wrong local day across DST transitions (a spring-forward day
// is 23 hours, so 23:30 + 24h skips the whole next day).
function addSnoozeDays(base: Date, days: number): Date {
  const next = DateTime.toDate(DateTime.makeUnsafe(base));
  next.setDate(next.getDate() + days);
  return next;
}

function parseSnoozePresetTime(time: string): { readonly hours: number; readonly minutes: number } {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return { hours, minutes };
}

/**
 * Wake time for a preset rule, in the device's local time zone. A delay is
 * elapsed time, so a day is 24 hours even across a DST change, matching
 * Custom… durations. A weekday is the next such day after today at that
 * wall-clock time; a time skipped by a DST change rolls forward to the next
 * valid one, and a repeated time resolves to its first occurrence.
 */
export function resolveSnoozePresetRule(rule: SnoozePresetRule, now: Date): Date {
  if (rule.kind === "delay") {
    return DateTime.toDate(
      DateTime.makeUnsafe(now.getTime() + rule.amount * SNOOZE_UNIT_MS[rule.unit]),
    );
  }
  // Never today: on a Friday, "Friday" means next week's, like "Next week" on
  // a Monday. Today's later hours belong to the delay presets.
  const daysAhead = (rule.weekday - now.getDay() + 7) % 7 || 7;
  const wake = addSnoozeDays(now, daysAhead);
  const { hours, minutes } = parseSnoozePresetTime(rule.time);
  wake.setHours(hours, minutes, 0, 0);
  return wake;
}

/** Rules with the same key always resolve to the same wake time. */
export function snoozePresetRuleKey(rule: SnoozePresetRule): string {
  return rule.kind === "delay"
    ? `delay:${(rule.amount * SNOOZE_UNIT_MS[rule.unit]) / 60_000}m`
    : `weekday:${rule.weekday}:${rule.time}`;
}

function delayLabel(rule: Extract<SnoozePresetRule, { kind: "delay" }>): string {
  const unit = rule.amount === 1 ? rule.unit.slice(0, -1) : rule.unit;
  return `In ${rule.amount} ${unit}`;
}

/** How settings list a saved rule: "In 3 days", "Friday at 9:00 AM". */
export function describeSnoozePresetRule(
  rule: SnoozePresetRule,
  formatTime: (date: Date) => string = snoozeTimeOfDayLabel,
): string {
  if (rule.kind === "delay") return delayLabel(rule);
  const { hours, minutes } = parseSnoozePresetTime(rule.time);
  // Any date works: only the time of day is formatted.
  const time = formatTime(new Date(2000, 0, 1, hours, minutes));
  return `${weekdayName(rule.weekday)} at ${time}`;
}

// Saved presets name a rule rather than a day, so their time column carries
// the day: "3:45 PM" today, "Fri 9:00 AM" this week, "Oct 16, 9:00 AM" when
// a weekday preset lands a full week out.
function savedPresetWhenLabel(wake: Date, now: Date, formatTime: (date: Date) => string): string {
  const time = formatTime(wake);
  const dayDelta = Math.round(
    (snoozeAtHour(wake, 0).getTime() - snoozeAtHour(now, 0).getTime()) / DAY_MS,
  );
  if (dayDelta === 0) return time;
  if (dayDelta < 7) return `${snoozeWeekdayLabel(wake)} ${time}`;
  return `${wake.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/**
 * Shared "snooze until" choices for every client. "This evening" only
 * appears while it is meaningfully before evening; after that the calendar
 * choices start at "Tomorrow". Saved presets follow the built-ins, soonest
 * first. A choice that lands on the same instant as an earlier one collapses
 * into it: on Sundays "Next week" is Monday morning just like "Tomorrow", and
 * a saved "Monday at 9:00 AM" is always one of the two.
 */
export function resolveSnoozePresets(
  now: Date,
  options: SnoozePresetOptions = {},
): ReadonlyArray<SnoozePreset> {
  const formatTime = options.formatTime ?? snoozeTimeOfDayLabel;
  const preset = (
    id: SnoozePresetId,
    label: string,
    wake: Date,
    whenLabel = formatTime(wake),
  ): SnoozePreset => ({ id, label, whenLabel, snoozedUntil: wake.toISOString() });

  const presets: SnoozePreset[] = [
    preset("hour", "In 1 hour", resolveSnoozePresetRule(BUILT_IN_SNOOZE_RULES.hour, now)),
    preset(
      "three-hours",
      "In 3 hours",
      resolveSnoozePresetRule(BUILT_IN_SNOOZE_RULES["three-hours"], now),
    ),
  ];
  const evening = snoozeAtHour(now, EVENING_HOUR);
  if (evening.getTime() - now.getTime() > HOUR_MS) {
    presets.push(preset("evening", "This evening", evening));
  }
  presets.push(preset("tomorrow", "Tomorrow", snoozeAtHour(addSnoozeDays(now, 1), MORNING_HOUR)));
  const nextWeek = resolveSnoozePresetRule(BUILT_IN_SNOOZE_RULES["next-week"], now);
  presets.push(
    preset(
      "next-week",
      "Next week",
      nextWeek,
      `${snoozeWeekdayLabel(nextWeek)} ${formatTime(nextWeek)}`,
    ),
  );

  const saved = (options.saved ?? [])
    .map((rule) => ({ rule, wake: resolveSnoozePresetRule(rule, now) }))
    .sort((left, right) => left.wake.getTime() - right.wake.getTime());
  for (const { rule, wake } of saved) {
    presets.push(
      preset(
        `saved:${snoozePresetRuleKey(rule)}`,
        rule.kind === "delay" ? delayLabel(rule) : weekdayName(rule.weekday),
        wake,
        savedPresetWhenLabel(wake, now, formatTime),
      ),
    );
  }

  const seenWakeTimes = new Set<string>();
  return presets.filter((candidate) => {
    if (seenWakeTimes.has(candidate.snoozedUntil)) return false;
    seenWakeTimes.add(candidate.snoozedUntil);
    return true;
  });
}

/** Form input for a new saved preset, before validation. */
export type SnoozePresetDraft =
  | { readonly kind: "delay"; readonly amount: string; readonly unit: SnoozePresetUnit }
  | { readonly kind: "weekday"; readonly weekday: number; readonly time: string };

const isSnoozePresetRule = Schema.is(SnoozePresetRule);

/**
 * Validates a new saved preset against the settings schema and the presets
 * already saved. A rule that always duplicates a built-in or saved choice is
 * refused here; ones that only coincide on some days collapse in the menu.
 */
export function parseSnoozePresetDraft(
  draft: SnoozePresetDraft,
  saved: ReadonlyArray<SnoozePresetRule>,
): { readonly rule: SnoozePresetRule } | { readonly error: string } {
  if (saved.length >= MAX_SNOOZE_PRESETS) {
    return { error: `You can save up to ${MAX_SNOOZE_PRESETS} presets. Remove one first.` };
  }
  const candidate = draft.kind === "delay" ? { ...draft, amount: Number(draft.amount) } : draft;
  if (!isSnoozePresetRule(candidate)) {
    return {
      error:
        draft.kind === "delay"
          ? `Enter a whole number from 1 to ${MAX_SNOOZE_PRESET_AMOUNT}.`
          : "Choose a day and a time.",
    };
  }
  const key = snoozePresetRuleKey(candidate);
  if (Object.values(BUILT_IN_SNOOZE_RULES).some((rule) => snoozePresetRuleKey(rule) === key)) {
    return { error: "That is already a built-in choice." };
  }
  if (saved.some((rule) => snoozePresetRuleKey(rule) === key)) {
    return { error: "That preset is already saved." };
  }
  return { rule: candidate };
}

/**
 * Compact "wakes in" label for snoozed rows: "2h", "18h", "3d". Minutes
 * round up so a snooze never reads "0m" while still hidden. Shared by web
 * and mobile so the same wake time never reads differently per client.
 */
export function snoozeWakeLabel(snoozedUntil: string, options: { readonly now: string }): string {
  const wakeMs = Date.parse(snoozedUntil);
  const nowMs = Date.parse(options.now);
  if (Number.isNaN(wakeMs) || Number.isNaN(nowMs)) return "now";
  const remainingMs = wakeMs - nowMs;
  if (remainingMs <= 0) return "now";
  if (remainingMs < HOUR_MS) return `${Math.max(1, Math.ceil(remainingMs / 60_000))}m`;
  if (remainingMs < DAY_MS) return `${Math.ceil(remainingMs / HOUR_MS)}h`;
  return `${Math.ceil(remainingMs / DAY_MS)}d`;
}

export type CustomSnoozeInput =
  | { readonly mode: "date"; readonly date: string; readonly time: string }
  | {
      readonly mode: "duration";
      readonly amount: string;
      readonly unit: SnoozePresetUnit;
    };

/** Resolve local calendar input or elapsed time, rejecting past and invalid dates. */
export function resolveCustomSnooze(input: CustomSnoozeInput, now: Date): string | null {
  let wake: Date;
  if (input.mode === "duration") {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    wake = new Date(now.getTime() + amount * SNOOZE_UNIT_MS[input.unit]);
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return null;
    wake = new Date(`${input.date}T${input.time}:00`);
    // Reject rolled-over dates and nonexistent local times during DST changes.
    if (localSnoozeDate(wake) !== input.date || localSnoozeTime(wake) !== input.time) return null;
  }
  return Number.isFinite(wake.getTime()) && wake.getTime() > now.getTime()
    ? wake.toISOString()
    : null;
}

export function localSnoozeDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localSnoozeTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
