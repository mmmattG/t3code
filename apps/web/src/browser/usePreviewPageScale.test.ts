import { describe, expect, it } from "vite-plus/test";

import { resolveBrowserViewportLayout } from "./browserViewportLayout";
import { previewPageScale } from "./usePreviewPageScale";

// Electron's zoom steps are half a zoom level: factor 1.2 ** (level).
const ZOOMED_IN_ONE_STEP = 1.2 ** 0.5;
const ZOOMED_OUT_ONE_STEP = 1.2 ** -0.5;

/** The guest's CSS width for a webview laid out at `hostWidth` window CSS pixels. */
const guestWidth = (hostWidth: number, windowZoomFactor: number) => hostWidth * windowZoomFactor;

describe("previewPageScale", () => {
  it.each([
    ["zoomed in", ZOOMED_IN_ONE_STEP],
    ["at actual size", 1],
    ["zoomed out", ZOOMED_OUT_ONE_STEP],
  ])("gives the page the requested viewport with the app window %s", (_, windowZoomFactor) => {
    const layout = resolveBrowserViewportLayout(
      { width: 1600, height: 1000 },
      { _tag: "freeform", width: 1280, height: 800 },
      previewPageScale(1, windowZoomFactor),
    );

    expect(guestWidth(layout.viewportWidth, windowZoomFactor)).toBeCloseTo(1280);
    expect(guestWidth(layout.viewportHeight, windowZoomFactor)).toBeCloseTo(800);
  });

  it("keeps the tab's own zoom on top of the window's", () => {
    expect(previewPageScale(1.5, ZOOMED_IN_ONE_STEP)).toBeCloseTo(1.5 / ZOOMED_IN_ONE_STEP);
  });

  it("treats a missing or invalid window zoom as actual size", () => {
    expect(previewPageScale(1.25, Number.NaN)).toBe(1.25);
    expect(previewPageScale(1.25, 0)).toBe(1.25);
  });
});
