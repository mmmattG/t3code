import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { MenuAction } from "@react-native-menu/menu";
import type { SnoozePresetRule, SnoozePresetUnit } from "@t3tools/contracts";
import {
  describeSnoozePresetRule,
  localSnoozeTime,
  parseSnoozePresetDraft,
  SNOOZE_PRESET_WEEKDAYS,
  snoozePresetRuleKey,
  type SnoozePresetDraft,
} from "@t3tools/client-runtime/state/thread-settled";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";

import { SymbolView } from "../../../components/AppSymbol";
import { AppText as Text } from "../../../components/AppText";
import { ControlPillMenu } from "../../../components/ControlPill";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import { SettingsSection } from "./SettingsSection";

const NO_PRESETS: ReadonlyArray<SnoozePresetRule> = [];
const UNIT_LABELS: Record<SnoozePresetUnit, string> = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};

function timeOfDay(time: string): Date {
  const [hours = 9, minutes = 0] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Device-local saved Snooze menu choices, the counterpart of web's
 * Settings → General → Snooze presets. Mobile has no client-settings sync,
 * so each device keeps its own list.
 */
export function SnoozePresetsSettingsSection() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferences);
  const saved = loaded ? (preferences.value.snoozePresets ?? NO_PRESETS) : NO_PRESETS;
  const [kind, setKind] = useState<SnoozePresetDraft["kind"]>("delay");
  const [amount, setAmount] = useState("3");
  const [unit, setUnit] = useState<SnoozePresetUnit>("days");
  const [weekday, setWeekday] = useState(5);
  const [time, setTime] = useState("09:00");
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: SnoozePresetDraft =
    kind === "delay" ? { kind, amount: amount.trim(), unit } : { kind, weekday, time };
  const add = () => {
    const result = parseSnoozePresetDraft(draft, saved);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setTimePickerOpen(false);
    // Re-validate against the stored list in case it changed since render.
    savePreferences({
      transform: (current) => {
        const latest = current.snoozePresets ?? [];
        const next = parseSnoozePresetDraft(draft, latest);
        return "rule" in next ? { snoozePresets: [...latest, next.rule] } : {};
      },
    });
  };
  const remove = (key: string) =>
    savePreferences({
      transform: (current) => ({
        snoozePresets: (current.snoozePresets ?? []).filter(
          (candidate) => snoozePresetRuleKey(candidate) !== key,
        ),
      }),
    });

  return (
    <View className="gap-3">
      <SettingsSection title="Snooze presets">
        {saved.map((rule, index) => {
          const key = snoozePresetRuleKey(rule);
          const label = describeSnoozePresetRule(rule);
          return (
            <View
              key={key}
              className={
                index > 0
                  ? "min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3"
                  : "min-h-14 flex-row items-center gap-3 px-4 py-3"
              }
            >
              <Text className="min-w-0 flex-1 text-lg text-foreground android:text-base">
                {label}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${label}`}
                hitSlop={8}
                onPress={() => remove(key)}
                className="active:opacity-70"
              >
                <SymbolView
                  name="xmark.circle.fill"
                  size={22}
                  tintColorClassName="accent-chevron"
                  type="monochrome"
                />
              </Pressable>
            </View>
          );
        })}
        <View
          className={
            saved.length > 0 ? "gap-3 border-t border-border-subtle px-4 py-3" : "gap-3 px-4 py-3"
          }
        >
          <SegmentedControl
            options={[
              { value: "delay", label: "After a delay" },
              { value: "weekday", label: "On a weekday" },
            ]}
            selected={kind}
            onSelect={(value) => {
              setKind(value);
              setTimePickerOpen(false);
              setError(null);
            }}
          />
        </View>
        {kind === "delay" ? (
          <>
            <View className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3">
              <Text className="text-lg text-foreground">Snooze for</Text>
              <TextInput
                accessibilityLabel="Amount"
                keyboardType="number-pad"
                value={amount}
                onChangeText={(value) => {
                  setAmount(value);
                  setError(null);
                }}
                textAlign="right"
                className="min-h-8 min-w-0 flex-1 font-sans text-base text-foreground"
              />
            </View>
            <MenuRow
              label="Unit"
              value={UNIT_LABELS[unit]}
              actions={Object.entries(UNIT_LABELS).map(([value, title]) => ({
                id: value,
                title,
                state: value === unit ? "on" : undefined,
              }))}
              onSelect={(value) => {
                if (value === "minutes" || value === "hours" || value === "days") setUnit(value);
                setError(null);
              }}
            />
          </>
        ) : (
          <>
            <MenuRow
              label="Day"
              value={
                SNOOZE_PRESET_WEEKDAYS.find((option) => option.weekday === weekday)?.label ?? ""
              }
              actions={SNOOZE_PRESET_WEEKDAYS.map((option) => ({
                id: String(option.weekday),
                title: option.label,
                state: option.weekday === weekday ? "on" : undefined,
              }))}
              onSelect={(value) => {
                setWeekday(Number(value));
                setError(null);
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Time, ${timeOfDay(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
              onPress={() => setTimePickerOpen((open) => !open)}
              className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
            >
              <Text className="text-lg text-foreground">Time</Text>
              <Text className="min-w-0 flex-1 text-right text-base text-foreground-muted">
                {timeOfDay(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </Text>
            </Pressable>
            {timePickerOpen ? (
              <DateTimePicker
                value={timeOfDay(time)}
                mode="time"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onDismiss={() => setTimePickerOpen(false)}
                onValueChange={(_, selected) => {
                  setTime(localSnoozeTime(selected));
                  setError(null);
                }}
              />
            ) : null}
          </>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !loaded }}
          disabled={!loaded}
          onPress={add}
          className="min-h-14 flex-row items-center border-t border-border-subtle px-4 py-3 active:opacity-70 disabled:opacity-50"
        >
          <Text className="text-lg text-primary-text">Add preset</Text>
        </Pressable>
      </SettingsSection>
      {error ? (
        <Text accessibilityRole="alert" className="px-2 text-sm text-danger-foreground">
          {error}
        </Text>
      ) : null}
      <Text className="px-2 text-sm text-foreground-muted">
        Saved presets appear after the built-in Snooze choices on this device. A delay counts from
        when you snooze. A weekday means the next one after today, in this device's time zone.
      </Text>
    </View>
  );
}

function MenuRow(props: {
  readonly label: string;
  readonly value: string;
  readonly actions: MenuAction[];
  readonly onSelect: (id: string) => void;
}) {
  return (
    <ControlPillMenu
      actions={props.actions}
      onPressAction={({ nativeEvent }) => props.onSelect(nativeEvent.event)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${props.label}, ${props.value}`}
        className="min-h-14 flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
      >
        <Text className="text-lg text-foreground">{props.label}</Text>
        <Text
          className="min-w-0 flex-1 text-right text-base text-foreground-muted"
          numberOfLines={1}
        >
          {props.value}
        </Text>
        <SymbolView
          name="chevron.down"
          size={14}
          tintColorClassName="accent-chevron"
          type="monochrome"
        />
      </Pressable>
    </ControlPillMenu>
  );
}
