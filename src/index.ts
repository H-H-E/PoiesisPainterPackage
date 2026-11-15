export { Painter, paint, capabilities } from './painter.js';
export type { PainterOptions, RenderOptions, RenderProgress, RenderReport, LayerReport } from './painter.js';
export { validatePainting, assertPainting, PaintingValidationError, estimateWorkload, WORKLOAD_LIMITS } from './validate.js';
export type { ValidationIssue, ValidationResult, WorkloadEstimate } from './validate.js';
export { resolveIntent, samplePath, hatchSegments, expandFamily } from './geometry.js';
export { resolveMaterial, defaultMaterials } from './presets.js';
export type { CanvasSurface, CanvasFactory } from './canvas.js';
export type * from './types.generated.js';
