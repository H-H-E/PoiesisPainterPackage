export type DrawingContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** Structural surface contract: Node may supply @napi-rs/canvas without a runtime import. */
export interface CanvasSurface {
  width: number;
  height: number;
  getContext(type: '2d', settings?: { willReadFrequently?: boolean }): DrawingContext | null;
}
export type CanvasFactory = (width: number, height: number) => CanvasSurface;

export const browserCanvas: CanvasFactory = (width, height) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
  throw new Error('No Canvas2D implementation. Supply { canvasFactory: (w, h) => createCanvas(w, h) } in Node.');
};

export function context2d(canvas: CanvasSurface): DrawingContext {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas2D is unavailable or its context was lost. The previous painting was retained.');
  return context;
}

export function releaseCanvas(canvas: CanvasSurface): void { canvas.width = 1; canvas.height = 1; }
