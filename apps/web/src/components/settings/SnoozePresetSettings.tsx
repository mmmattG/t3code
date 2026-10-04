import { PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import {
  MAX_SNOOZE_PRESET_AMOUNT,
  MAX_SNOOZE_PRESETS,
  type SnoozePresetUnit,
} from "@t3tools/contracts/settings";
import {
  describeSnoozePresetRule,
  parseSnoozePresetDraft,
  SNOOZE_PRESET_WEEKDAYS,
  snoozePresetRuleKey,
  type SnoozePresetDraft,
} from "@t3tools/client-runtime/state/thread-settled";

import {
  getClientSettings,
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { formatShortTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const UNIT_LABELS: Record<SnoozePresetUnit, string> = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
};
const WEEKDAY_LABELS = Object.fromEntries(
  SNOOZE_PRESET_WEEKDAYS.map(({ weekday, label }) => [String(weekday), label]),
);

/**
 * Saved Snooze menu choices for this device. Every snooze menu on web and
 * desktop lists them after the built-in choices.
 */
export function SnoozePresetSettings() {
  const saved = useClientSettings((settings) => settings.snoozePresets);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const hydrated = useClientSettingsHydrated();
  const updateSettings = useUpdateClientSettings();
  const [formOpen, setFormOpen] = useState(false);
  const full = saved.length >= MAX_SNOOZE_PRESETS;
  const formatTime = (date: Date) => formatShortTimestamp(date.toISOString(), timestampFormat);

  return (
    <SettingsRow
      {...searchableSetting("snooze-presets")}
      description="Add your own choices to the Snooze menu, after the built-in ones. Times use this device's time zone."
      status={full ? `You can save up to ${MAX_SNOOZE_PRESETS} presets.` : null}
      resetAction={
        saved.length > 0 ? (
          <SettingResetButton
            label="snooze presets"
            onClick={() => updateSettings({ snoozePresets: [] })}
          />
        ) : null
      }
      control={
        <Popover open={formOpen} onOpenChange={setFormOpen}>
          <PopoverTrigger
            render={<Button size="sm" variant="outline" disabled={!hydrated || full} />}
          >
            <PlusIcon />
            Add preset
          </PopoverTrigger>
          <PopoverPopup align="end" aria-label="Add snooze preset">
            <SnoozePresetForm onAdded={() => setFormOpen(false)} />
          </PopoverPopup>
        </Popover>
      }
    >
      {saved.length > 0 ? (
        <div className="mt-2 mb-2 overflow-hidden rounded-lg border border-border/60">
          {saved.map((rule, index) => {
            const key = snoozePresetRuleKey(rule);
            const label = describeSnoozePresetRule(rule, formatTime);
            return (
              <div
                key={key}
                className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  index > 0 && "border-t border-border/60",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label}</span>
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`Remove ${label}`}
                  disabled={!hydrated}
                  onClick={() =>
                    updateSettings({
                      snoozePresets: getClientSettings().snoozePresets.filter(
                        (candidate) => snoozePresetRuleKey(candidate) !== key,
                      ),
                    })
                  }
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
    </SettingsRow>
  );
}

function SnoozePresetForm(props: { readonly onAdded: () => void }) {
  const id = useId();
  const updateSettings = useUpdateClientSettings();
  const [kind, setKind] = useState<SnoozePresetDraft["kind"]>("delay");
  const [amount, setAmount] = useState("3");
  const [unit, setUnit] = useState<SnoozePresetUnit>("days");
  const [weekday, setWeekday] = useState(5);
  const [time, setTime] = useState("09:00");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="flex w-72 flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        // Validate against the latest list, not the one this form opened with.
        const current = getClientSettings().snoozePresets;
        const result = parseSnoozePresetDraft(
          kind === "delay" ? { kind, amount, unit } : { kind, weekday, time },
          current,
        );
        if ("error" in result) {
          setError(result.error);
          return;
        }
        updateSettings({ snoozePresets: [...current, result.rule] });
        props.onAdded();
      }}
    >
      <ToggleGroup
        aria-label="Preset type"
        className="w-full *:flex-1"
        value={[kind]}
        onValueChange={(next) => {
          const value = next[0];
          if (value === "delay" || value === "weekday") setKind(value);
          setError(null);
        }}
      >
        <Toggle value="delay">After a delay</Toggle>
        <Toggle value="weekday">On a weekday</Toggle>
      </ToggleGroup>
      {kind === "delay" ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            id={`${id}-amount`}
            min={1}
            max={MAX_SNOOZE_PRESET_AMOUNT}
            step={1}
            value={amount === "" ? null : Number(amount)}
            onValueChange={(value) => {
              setAmount(value === null ? "" : String(value));
              setError(null);
            }}
          >
            <Label htmlFor={`${id}-amount`}>Snooze for</Label>
            <NumberFieldGroup>
              <NumberFieldDecrement aria-label="Decrease amount" />
              <NumberFieldInput required />
              <NumberFieldIncrement aria-label="Increase amount" />
            </NumberFieldGroup>
          </NumberField>
          <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-unit`}>
            Unit
            <Select
              value={unit}
              items={UNIT_LABELS}
              onValueChange={(value) => {
                if (value === "minutes" || value === "hours" || value === "days") setUnit(value);
                setError(null);
              }}
            >
              <SelectTrigger id={`${id}-unit`} className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {Object.entries(UNIT_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-weekday`}>
            Day
            <Select
              value={String(weekday)}
              items={WEEKDAY_LABELS}
              onValueChange={(value) => {
                if (value !== null) setWeekday(Number(value));
                setError(null);
              }}
            >
              <SelectTrigger id={`${id}-weekday`} className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {SNOOZE_PRESET_WEEKDAYS.map((option) => (
                  <SelectItem key={option.weekday} value={String(option.weekday)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Label>
          <Label className="flex min-w-0 flex-col items-stretch" htmlFor={`${id}-time`}>
            Time
            <Input
              nativeInput
              id={`${id}-time`}
              className="h-9 sm:h-8"
              type="time"
              required
              value={time}
              onChange={(event) => {
                setTime(event.target.value);
                setError(null);
              }}
            />
          </Label>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {kind === "delay"
          ? "Counts from when you snooze. A day is 24 hours."
          : "The next one after today, never today itself."}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm">
        Add preset
      </Button>
    </form>
  );
}
