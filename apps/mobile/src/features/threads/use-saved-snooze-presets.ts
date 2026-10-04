import { useAtomValue } from "@effect/atom-react";
import type { SnoozePresetRule } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";

import { mobilePreferencesAtom } from "../../state/preferences";

const NO_SAVED_SNOOZE_PRESETS: ReadonlyArray<SnoozePresetRule> = [];

/**
 * This device's saved Snooze menu choices. The array keeps its identity until
 * the presets change, so lists can hand it to memoized rows without every
 * row subscribing to preferences.
 */
export function useSavedSnoozePresets(): ReadonlyArray<SnoozePresetRule> {
  const preferences = useAtomValue(mobilePreferencesAtom);
  return AsyncResult.isSuccess(preferences)
    ? (preferences.value.snoozePresets ?? NO_SAVED_SNOOZE_PRESETS)
    : NO_SAVED_SNOOZE_PRESETS;
}
