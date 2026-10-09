// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { createModelCapabilities } from "@t3tools/shared/model";

import { isEffortPickerOpen } from "../../effortPickerVisibility";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { TraitsMenuContent } from "./TraitsPicker";

const KEYBINDINGS = compileResolvedKeybindingsConfig([
  { key: "mod+2", command: "effortPicker.jump.2", when: "effortPickerOpen" },
  { key: "mod+3", command: "effortPicker.jump.3", when: "effortPickerOpen" },
]);

const REASONING: ProviderOptionDescriptor = {
  id: "reasoningEffort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low", isDefault: true },
    { id: "high", label: "High" },
  ],
};

const SERVICE_TIER: ProviderOptionDescriptor = {
  id: "serviceTier",
  label: "Service tier",
  type: "select",
  options: [
    { id: "default", label: "Standard", isDefault: true },
    { id: "priority", label: "Fast" },
  ],
};

const CLAUDE_EFFORT: ProviderOptionDescriptor = {
  id: "effort",
  label: "Effort",
  type: "select",
  options: [
    { id: "low", label: "Low", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
  ],
  promptInjectedValues: ["ultrathink"],
};

describe("traits menu effort jumps", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderMenu(
    provider: string,
    descriptors: ReadonlyArray<ProviderOptionDescriptor>,
    prompt = "",
  ) {
    const onModelOptionsChange =
      vi.fn<(options: ReadonlyArray<ProviderOptionSelection> | undefined) => void>();
    const onPromptChange = vi.fn<(prompt: string) => void>();
    const models: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "test-model",
        name: "Test model",
        isCustom: false,
        capabilities: createModelCapabilities({ optionDescriptors: descriptors }),
      },
    ];
    function TestMenu() {
      const [open, setOpen] = useState(true);
      return (
        <Menu open={open} onOpenChange={setOpen}>
          <MenuTrigger>Traits</MenuTrigger>
          <MenuPopup>
            <TraitsMenuContent
              provider={ProviderDriverKind.make(provider)}
              models={models}
              model="test-model"
              prompt={prompt}
              onPromptChange={onPromptChange}
              onModelOptionsChange={onModelOptionsChange}
              planModeEnabled={false}
              keybindings={KEYBINDINGS}
            />
          </MenuPopup>
        </Menu>
      );
    }
    await act(async () => root.render(<TestMenu />));
    return { onModelOptionsChange, onPromptChange };
  }

  async function press(key: string) {
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.activeElement?.dispatchEvent(event));
    return event;
  }

  it("numbers only the first group and picks from it, closing the menu", async () => {
    const { onModelOptionsChange } = await renderMenu("codex", [REASONING, SERVICE_TIER]);
    // Only mod+2 is bound for a two-option group, so a second hint would be Service tier's.
    expect(document.querySelectorAll("kbd")).toHaveLength(1);

    expect((await press("2")).defaultPrevented).toBe(true);
    expect(onModelOptionsChange).toHaveBeenCalledExactlyOnceWith([
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "default" },
    ]);
    expect(isEffortPickerOpen()).toBe(false);
    expect((await press("2")).defaultPrevented).toBe(false);
  });

  it("ignores numbers past the last option", async () => {
    const { onModelOptionsChange } = await renderMenu("codex", [REASONING]);
    await press("3");
    expect(onModelOptionsChange).not.toHaveBeenCalled();
    expect(isEffortPickerOpen()).toBe(true);
  });

  it("adds Claude's ultrathink prefix through the normal menu behavior", async () => {
    const { onModelOptionsChange, onPromptChange } = await renderMenu("claudeAgent", [
      CLAUDE_EFFORT,
    ]);
    await press("3");
    expect(onPromptChange).toHaveBeenCalledExactlyOnceWith("Ultrathink:\n");
    expect(onModelOptionsChange).not.toHaveBeenCalled();
    expect(isEffortPickerOpen()).toBe(false);
  });

  it("leaves Claude's effort locked while the prompt body says ultrathink", async () => {
    const { onModelOptionsChange, onPromptChange } = await renderMenu(
      "claudeAgent",
      [CLAUDE_EFFORT],
      "Please ultrathink about this",
    );
    expect(document.querySelector("kbd")).toBeNull();
    await press("2");
    expect(onModelOptionsChange).not.toHaveBeenCalled();
    expect(onPromptChange).not.toHaveBeenCalled();
    expect(isEffortPickerOpen()).toBe(true);
  });
});
