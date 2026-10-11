/** Explicit game unit equivalence, not an engineering certification or railway standard. */
export const DEPOT_GAME_COMPATIBILITY_NOTICE = 'Équivalence approuvée par règle du jeu : 1 unité pour 1 unité, aucune norme technique revendiquée.';
const presets = { brake_pad_set: ['brake_pad', 'brake_pad_eco'], brake_pad: ['brake_pad_set', 'brake_pad_eco'], brake_pad_eco: ['brake_pad_set', 'brake_pad'] };
export function partCompatibleReferenceIds(id) { return [...(presets[id] ?? [])]; }
