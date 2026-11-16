/* Generated from src/schema.json by npm run generate. Do not edit. */

/**
 * Opaque sRGB pigment color; transparency is controlled separately.
 *
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Color".
 */
export type Color = string;
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Unit".
 */
export type Unit = number;
/**
 * Stable ASCII ID, at most 64 characters; reserved prototype names are rejected.
 *
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Id".
 */
export type Id = string;
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Command".
 */
export type Command = StrokeCommand | FillCommand | HatchCommand | FamilyCommand | WaitCommand;
/**
 * @minItems 2
 * @maxItems 4096
 *
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Path".
 */
export type Path = [GesturePoint, GesturePoint, ...GesturePoint[]];
/**
 * Normalized x, y and optional pressure; default pressure is 1.
 *
 * @minItems 2
 * @maxItems 3
 *
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "GesturePoint".
 */
export type GesturePoint = [number, number] | [number, number, Unit];
/**
 * @minItems 3
 * @maxItems 2048
 *
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Polygon".
 */
export type Polygon = [Point, Point, Point, ...Point[]];
/**
 * @minItems 2
 * @maxItems 2
 *
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Point".
 */
export type Point = [number, number];

/**
 * A deterministic, bounded, data-only painting display list. Coordinates and widths are normalized; time advances only through explicit wait commands.
 */
export interface PaintingDocument {
  version: '1.0';
  width: number;
  height: number;
  seed: number;
  background: Color;
  paper?: Paper;
  materials: {
    [k: string]: Material;
  };
  /**
   * @minItems 1
   * @maxItems 32
   */
  layers: [Layer, ...Layer[]];
}
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Paper".
 */
export interface Paper {
  texture?: Unit;
  absorbency?: Unit;
}
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Material".
 */
export interface Material {
  medium: 'ink' | 'watercolor' | 'oil' | 'graphite' | 'marker' | 'knife';
  color: Color;
  /**
   * Brush width as a fraction of the shorter surface dimension.
   */
  size: number;
  opacity?: Unit;
  load?: Unit;
  wetness?: Unit;
  roughness?: Unit;
  bristles?: number;
  granulation?: Unit;
  viscosity?: Unit;
}
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Layer".
 */
export interface Layer {
  id: Id;
  opacity?: Unit;
  blend?: 'normal' | 'multiply' | 'screen';
  /**
   * @maxItems 10000
   */
  commands: Command[];
}
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "StrokeCommand".
 */
export interface StrokeCommand {
  id: Id;
  op: 'stroke';
  material: Id;
  path: Path;
  intent?: Intent;
  tilt?: Unit;
  rotation?: number;
  speed?: number;
}
/**
 * Composable mark character; inspect resolved parameters to see the translation.
 *
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "Intent".
 */
export interface Intent {
  force?: Unit;
  hesitation?: Unit;
  restraint?: Unit;
}
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "FillCommand".
 */
export interface FillCommand {
  id: Id;
  op: 'fill';
  material: Id;
  polygon: Polygon;
}
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "HatchCommand".
 */
export interface HatchCommand {
  id: Id;
  op: 'hatch';
  material: Id;
  polygon: Polygon;
  spacing: number;
  angle: number;
}
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "FamilyCommand".
 */
export interface FamilyCommand {
  id: Id;
  op: 'family';
  material: Id;
  path: Path;
  count: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  spread: [number, number];
  jitter: number;
  intent?: Intent;
}
/**
 * This interface was referenced by `PaintingDocument`'s JSON-Schema
 * via the `definition` "WaitCommand".
 */
export interface WaitCommand {
  id: Id;
  op: 'wait';
  steps: number;
}
