/**
 * ————— 🎓 LE TUTORIEL, ÉCRIT COMME UNE PARTITION —————
 *
 * Tout ce fichier est de la DONNÉE. Pas une ligne ne décide quand geler, quand
 * relâcher ni quoi afficher : main.ts lit cette partition et l'exécute. La
 * raison est simple — un tutoriel se retouche cent fois (« cette phrase est
 * trop longue », « l'obstacle arrive trop tôt »), et chaque retouche doit être
 * une valeur changée, jamais une condition de plus dans la boucle de jeu.
 *
 * ————— La forme, en deux temps —————
 *
 *  1. ❄️ SUR LA NEIGE (Flancs du Fuji, 雪). La piste est NUE : aucun obstacle
 *     qu'on n'ait posé soi-même, aucune jarre, aucun rouleau, aucune
 *     plateforme. On présente le départ, puis chaque obstacle arrive SEUL —
 *     l'écran se fige devant, le geste s'affiche, et il repart quand on l'a
 *     fait.
 *
 *  2. 🌉 SUR LE PONT (Pont au clair de lune). Plus d'explications : une vraie
 *     course d'entraînement contre deux rivaux, pour éprouver ce qu'on vient
 *     d'apprendre.
 *
 * ⚠️ Le décor change EXPRÈS entre les deux. « On recommence » doit se voir sans
 * qu'on ait à le lire : un paysage neuf dit « autre chose maintenant » mieux
 * qu'un message.
 */
import type { Kind, PlannedObstacle } from './track'

/** L'index des décors dans `BIOMES` (village, pont, Fuji). */
export const BIOME_NEIGE = 2
export const BIOME_PONT = 1

/**
 * Combien de mètres séparent l'explication de l'obstacle qu'elle annonce.
 *
 * ⚠️ 35 m et non 20. Au relâchement, la vitesse repart de ZÉRO et met une
 * seconde à revenir : 20 m se faisaient à moitié à l'arrêt, l'obstacle arrivait
 * avant qu'on ait repris son élan, et le premier essai était perdu d'avance.
 */
const ELAN = 35

/** Une étape : on fige, on explique, on relâche devant l'obstacle. */
export interface EtapeTuto {
  /** Le mètre où la course se fige. */
  d: number
  /** Le titre de la fiche — court, il tient sur une ligne. */
  titre: string
  /** Ce qu'on explique. Deux phrases au plus : on est à l'arrêt, pas en cours. */
  texte: string
  /** Le geste, au doigt et au clavier. Les deux, toujours. */
  doigt: string
  clavier: string
  /** L'obstacle posé `ELAN` mètres plus loin, s'il y en a un. */
  obstacle?: { kind: Kind; lane: number }
}

/**
 * ⚠️ L'ordre n'est pas décoratif : saut, glissade, mur.
 *
 * On commence par le geste qu'on devine (sauter par-dessus), puis son contraire
 * (glisser dessous), et l'on finit par celui qu'aucun des deux ne résout — le
 * mur, qu'on ne peut QUE contourner. Chaque étape rend la suivante lisible ;
 * ouvrir sur le mur laisserait croire qu'il se saute, et le premier essai se
 * solderait par un échec qu'on n'aurait pas mérité.
 */
export const ETAPES: readonly EtapeTuto[] = [
  {
    d: 10,
    titre: '⛩️ Bienvenue',
    texte:
      "Tu cours vers le torii, et tu ne t'arrêtes jamais : la seule chose que tu décides, c'est COMMENT tu passes ce qui arrive.",
    doigt: 'Touche l’écran pour continuer',
    clavier: 'Espace ou clic',
  },
  {
    d: 60,
    titre: '⬆️ Sauter',
    texte:
      'Une barrière basse arrive. Elle se franchit par-dessus — et sauter ne coûte rien tant que tu ne retombes pas dessus.',
    doigt: 'Swipe vers le haut',
    clavier: '↑ ou Z',
    obstacle: { kind: 'saut', lane: 1 },
  },
  {
    d: 130,
    titre: '⬇️ Glisser',
    texte:
      "Une barre HAUTE, cette fois : sauter t'y jetterait dedans. On passe dessous, en se baissant.",
    doigt: 'Swipe vers le bas',
    clavier: '↓ ou S',
    obstacle: { kind: 'glissade', lane: 1 },
  },
  {
    d: 200,
    titre: '↔️ Changer de ligne',
    texte:
      "Un bloc plein. Ni par-dessus, ni par-dessous : il n'y a que trois lignes, et celle-ci est prise. Prends-en une autre.",
    doigt: 'Swipe à gauche ou à droite',
    clavier: '← → ou Q D',
    obstacle: { kind: 'mur', lane: 1 },
  },
  {
    d: 270,
    titre: '🌉 À toi de courir',
    texte:
      "C'est tout ce qu'il fallait savoir. On passe au pont : une vraie course contre deux rivaux, sans explications cette fois.",
    doigt: 'Touche l’écran pour partir',
    clavier: 'Espace ou clic',
  },
]

/** Le mètre où la neige s'arrête et où la vraie course commence. */
export const FIN_APPRENTISSAGE = 300

/**
 * Le parcours de la neige, déduit des étapes.
 *
 * ⚠️ DÉDUIT, jamais recopié. Déplacer une explication déplace son obstacle avec
 * elle ; deux listes à tenir en phase se seraient désynchronisées au premier
 * réglage, et l'on aurait expliqué le saut devant une barre haute.
 */
export const PLAN_NEIGE: PlannedObstacle[] = ETAPES.filter((e) => e.obstacle).map((e) => ({
  d: e.d + ELAN,
  lane: e.obstacle!.lane,
  kind: e.obstacle!.kind,
}))
