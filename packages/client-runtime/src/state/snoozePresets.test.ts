// @effect-diagnostics globalDate:off -- Tests exercise local calendar snooze presets.
import type { SnoozePresetRule } from "@t3tools/contracts/settings";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  describeSnoozePresetRule,
  localSnoozeTime,
  parseSnoozePresetDraft,
  resolveSnoozePresetRule,
  resolveSnoozePresets,
} from "./threadSettled.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
// Wednesday 2026-04-08 10:00 local.
const WEDNESDAY = new Date(2026, 3, 8, 10);
const IN_THREE_DAYS: SnoozePresetRule = { kind: "delay", amount: 3, unit: "days" };
const FRIDAY_MORNING: SnoozePresetRule = { kind: "weekday", weekday: 5, time: "09:00" };

const weekday = (date: Date) => date.toLocaleDateString(undefined, { weekday: "short" });

afterEach(() => vi.unstubAllEnvs());

describe("saved snooze presets", () => {
  it("leave the built-in choices alone when nothing is saved", () => {
    expect(resolveSnoozePresets(WEDNESDAY, { saved: [] })).toEqual(resolveSnoozePresets(WEDNESDAY));
  });

  it("follow the built-ins, soonest first, with the day in the time column", () => {
    const presets = resolveSnoozePresets(WEDNESDAY, {
      saved: [IN_THREE_DAYS, FRIDAY_MORNING],
      formatTime: localSnoozeTime,
    });
    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "three-hours",
      "evening",
      "tomorrow",
      "next-week",
      "saved:weekday:5:09:00",
      "saved:delay:4320m",
    ]);
    const friday = presets.at(-2)!;
    expect(friday.label).toBe("Friday");
    expect(friday.snoozedUntil).toBe(new Date(2026, 3, 10, 9).toISOString());
    expect(friday.whenLabel).toBe(`${weekday(new Date(2026, 3, 10))} 09:00`);
    const threeDays = presets.at(-1)!;
    expect(threeDays.label).toBe("In 3 days");
    expect(threeDays.snoozedUntil).toBe(new Date(WEDNESDAY.getTime() + 3 * DAY_MS).toISOString());
  });

  it("put a weekday preset a full week out on that same weekday, and say so", () => {
    // Friday 2026-04-10 07:00: "Friday 9:00" is next Friday, not today.
    const presets = resolveSnoozePresets(new Date(2026, 3, 10, 7), {
      saved: [FRIDAY_MORNING],
      formatTime: localSnoozeTime,
    });
    const friday = presets.find((preset) => preset.id === "saved:weekday:5:09:00")!;
    expect(friday.snoozedUntil).toBe(new Date(2026, 3, 17, 9).toISOString());
    expect(friday.whenLabel).not.toContain(weekday(new Date(2026, 3, 17)));
    expect(friday.whenLabel).toMatch(/17/);
  });

  it("collapse into an earlier choice that lands on the same instant", () => {
    const sameAsBuiltIns: SnoozePresetRule[] = [
      { kind: "delay", amount: 60, unit: "minutes" },
      { kind: "weekday", weekday: 1, time: "09:00" },
    ];
    expect(
      resolveSnoozePresets(WEDNESDAY, { saved: sameAsBuiltIns }).map((preset) => preset.id),
    ).toEqual(["hour", "three-hours", "evening", "tomorrow", "next-week"]);
    // Monday 2026-04-06: a saved "Tuesday 9:00" is just Tomorrow.
    expect(
      resolveSnoozePresets(new Date(2026, 3, 6, 10), {
        saved: [{ kind: "weekday", weekday: 2, time: "09:00" }],
      }).map((preset) => preset.id),
    ).toEqual(["hour", "three-hours", "evening", "tomorrow", "next-week"]);
  });

  it("format built-in and saved times with the caller's clock", () => {
    const presets = resolveSnoozePresets(WEDNESDAY, {
      saved: [IN_THREE_DAYS],
      formatTime: () => "TIME",
    });
    expect(presets.find((preset) => preset.id === "evening")!.whenLabel).toBe("TIME");
    expect(presets.find((preset) => preset.id === "next-week")!.whenLabel).toMatch(/ TIME$/);
    expect(presets.find((preset) => preset.id === "saved:delay:4320m")!.whenLabel).toMatch(
      / TIME$/,
    );
  });
});

describe("resolveSnoozePresetRule across DST", () => {
  it("counts a delay day as 24 elapsed hours", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const before = new Date(2027, 2, 13, 12);
    const wake = resolveSnoozePresetRule({ kind: "delay", amount: 1, unit: "days" }, before);
    expect(wake.getTime() - before.getTime()).toBe(DAY_MS);
    expect(wake.getHours()).toBe(13);
  });

  it("rolls a weekday time skipped by spring forward to the next valid time", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const wake = resolveSnoozePresetRule(
      { kind: "weekday", weekday: 0, time: "02:30" },
      new Date("2027-03-10T20:00:00Z"),
    );
    expect(wake.toISOString()).toBe("2027-03-14T10:30:00.000Z");
    expect(localSnoozeTime(wake)).toBe("03:30");
  });

  it("resolves a weekday time repeated by fall back to its first occurrence", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const wake = resolveSnoozePresetRule(
      { kind: "weekday", weekday: 0, time: "01:30" },
      new Date("2027-11-03T20:00:00Z"),
    );
    expect(wake.toISOString()).toBe("2027-11-07T08:30:00.000Z");
  });

  it("keeps the wall-clock time for a weekday after the change", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const wake = resolveSnoozePresetRule(FRIDAY_MORNING, new Date(2027, 2, 13, 12));
    expect(wake.getDay()).toBe(5);
    expect(localSnoozeTime(wake)).toBe("09:00");
  });
});

describe("parseSnoozePresetDraft", () => {
  it("accepts whole-number delays and weekday times", () => {
    expect(parseSnoozePresetDraft({ kind: "delay", amount: "3", unit: "days" }, [])).toEqual({
      rule: IN_THREE_DAYS,
    });
    expect(parseSnoozePresetDraft({ kind: "weekday", weekday: 5, time: "09:00" }, [])).toEqual({
      rule: FRIDAY_MORNING,
    });
  });

  it.each(["", "0", "-1", "1.5", "1000", "abc"])("rejects the delay amount %j", (amount) => {
    expect(parseSnoozePresetDraft({ kind: "delay", amount, unit: "hours" }, [])).toHaveProperty(
      "error",
    );
  });

  it("refuses rules that always duplicate a built-in choice", () => {
    for (const draft of [
      { kind: "delay", amount: "60", unit: "minutes" },
      { kind: "delay", amount: "3", unit: "hours" },
      { kind: "weekday", weekday: 1, time: "09:00" },
    ] as const) {
      expect(parseSnoozePresetDraft(draft, [])).toEqual({
        error: "That is already a built-in choice.",
      });
    }
  });

  it("refuses an equivalent of a saved preset and a full list", () => {
    expect(
      parseSnoozePresetDraft({ kind: "delay", amount: "72", unit: "hours" }, [IN_THREE_DAYS]),
    ).toEqual({ error: "That preset is already saved." });
    const full = Array.from({ length: 8 }, (_, index): SnoozePresetRule => ({
      kind: "delay",
      amount: index + 10,
      unit: "days",
    }));
    expect(
      parseSnoozePresetDraft({ kind: "delay", amount: "2", unit: "days" }, full),
    ).toHaveProperty("error");
  });
});

describe("describeSnoozePresetRule", () => {
  it("names the rule for the settings list", () => {
    expect(describeSnoozePresetRule({ kind: "delay", amount: 1, unit: "days" })).toBe("In 1 day");
    expect(describeSnoozePresetRule({ kind: "delay", amount: 45, unit: "minutes" })).toBe(
      "In 45 minutes",
    );
    expect(describeSnoozePresetRule(FRIDAY_MORNING, localSnoozeTime)).toBe("Friday at 09:00");
  });
});
