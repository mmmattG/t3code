import { useSyncExternalStore } from "react";

const normalizeZoomFactor = (zoomFactor: number | undefined): number =>
  zoomFactor !== undefined && Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;

/**
 * App-window CSS pixels per preview-page CSS pixel.
 *
 * The preview page keeps its own zoom, but its webview is laid out in this
 * window's CSS pixels, which the app's own zoom (View > Zoom) also scales.
 * Dividing it out keeps a fixed viewport at exactly the requested size.
 */
export function previewPageScale(tabZoomFactor: number, windowZoomFactor: number): number {
  return normalizeZoomFactor(tabZoomFactor) / normalizeZoomFactor(windowZoomFactor);
}

// A zoom step changes the window's CSS viewport, so it always fires resize.
function subscribeToWindowZoom(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function readWindowZoomFactor(): number {
  return normalizeZoomFactor(window.desktopBridge?.getZoomFactor?.());
}

/** `previewPageScale` for a tab, following the app window's zoom as it changes. */
export function usePreviewPageScale(tabZoomFactor: number): number {
  const windowZoomFactor = useSyncExternalStore(
    subscribeToWindowZoom,
    readWindowZoomFactor,
    () => 1,
  );
  return previewPageScale(tabZoomFactor, windowZoomFactor);
}
