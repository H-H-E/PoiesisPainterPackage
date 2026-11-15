import type { Material } from './types.generated.js';

const mediaDefaults: Record<Material['medium'], Required<Omit<Material, 'medium' | 'color' | 'size'>>> = {
  ink: { opacity: .9, load: .88, wetness: .12, roughness: .27, bristles: 36, granulation: .1, viscosity: .3 },
  watercolor: { opacity: .42, load: 1, wetness: .9, roughness: .18, bristles: 32, granulation: .42, viscosity: .1 },
  oil: { opacity: .93, load: .94, wetness: .5, roughness: .35, bristles: 42, granulation: 0, viscosity: .85 },
  graphite: { opacity: .65, load: .45, wetness: 0, roughness: .78, bristles: 32, granulation: .6, viscosity: 1 },
  marker: { opacity: .52, load: 1, wetness: 0, roughness: .04, bristles: 18, granulation: 0, viscosity: .7 },
  knife: { opacity: .97, load: .98, wetness: .35, roughness: .22, bristles: 14, granulation: 0, viscosity: .96 },
};

export function resolveMaterial(material: Material): Required<Material> { return { ...mediaDefaults[material.medium], ...material }; }

export const defaultMaterials: Readonly<Record<string, Material>> = Object.freeze({
  ink: { medium: 'ink', color: '#1b2936', size: .014 },
  wash: { medium: 'watercolor', color: '#627f91', size: .09 },
  oil: { medium: 'oil', color: '#213b4d', size: .045 },
  pencil: { medium: 'graphite', color: '#32343b', size: .008 },
  marker: { medium: 'marker', color: '#8093a0', size: .035 },
  knife: { medium: 'knife', color: '#d8d5c8', size: .075 },
});
