import {
  fighterById,
  DEFAULT_CUSTOM,
  HEADS,
  PERSO_ID,
  type CustomSkin,
  type FighterId,
  type Head,
} from './roster'
import { valider } from './pays'

/**
 * La qualité graphique.
 *
 * Six positions : cinq crans, plus « Auto ».
 */
export type Quality = 'auto' | 'fluide' | 'faible' | 'moyen' | 'maxi' | 'ultra'

export interface Settings {
  fighter: FighterId
  /** Le skin du guerrier perso — indépendant du choix courant, gardé sous le coude. */
  custom: CustomSkin
  /** Le pseudo, vu par l'adversaire pendant le duel. Vide = anonyme. */
  name: string
  quality: Quality
  /** Volume de la musique, de 0 (coupée) à 1. On joue aussi en cours ou dans le bus. */
  volumeMusique: number
  /** Volume des bruitages, séparé : on veut pouvoir garder les sons sans la musique. */
  volumeSfx: number
  /**
   * Affiche-t-on les pseudos au-dessus des coureurs ?
   *
   * Allumé par défaut : en duel, savoir QUI l'on double fait partie du jeu. Mais
   * à cinq sur la ligne de départ, cinq étiquettes se chevauchent juste devant
   * les obstacles — d'où le bouton. Il ne touche QUE l'affichage 3D : la colonne
   * de progression à gauche garde ses noms, puisqu'elle ne masque rien de la piste.
   */
  afficherNoms: boolean

  /**
   * 🌍 Le pays qu'on représente — code ISO à deux lettres, `''` si aucun.
   *
   * ⚠️ Un réglage LOCAL, comme le pseudo, et surtout PAS une donnée de compte :
   * se déclarer d'un pays ne demande aucune connexion. C'est une façon de se
   * présenter, pas une identité vérifiée — et un joueur sans compte doit pouvoir
   * le faire comme les autres.
   */
  pays: string
  /** La région dans ce pays, `''` si aucune (ou si le pays n'en détaille pas). */
  region: string
}

/**
 * ————— Les cinq crans —————
 *
 * ⚠️ UN CRAN PILOTE DEUX LEVIERS, PLUS LES PIXELS.
 *
 * Le réglage d'origine ne touchait qu'aux **pixels** dessinés, et c'était
 * suffisant tant qu'il n'y avait que deux positions. La forêt, elle, ne coûte
 * pas en pixels : elle coûte en **appels de dessin** et en **triangles**, et le
 * nombre de pixels ne change ni à l'un ni à l'autre. Un joueur qui descendait
 * la densité d'écran gardait donc ses 148 maillages visibles — c'est-à-dire
 * qu'il ne gagnait rien.
 *
 *  · `pixels` — le plafond de `pixelRatio`. Le plus gros coût sur mobile, et le
 *    seul que la brume interdit de toucher : la rapprocher pour gagner des
 *    images/s donnerait moins de temps pour réagir, ce serait un réglage de
 *    difficulté déguisé en réglage graphique.
 *  · `decor` — l'écartement des massifs. C'est lui qui décide du nombre
 *    d'appels de dessin : un décor deux fois plus espacé, c'est deux fois
 *    moins de massifs à l'écran.
 *  · `densite` — la matière dans chaque massif. C'est le budget de triangles :
 *    la lisière de la bambouseraie se resserre, sans jamais laisser revenir le
 *    vide que la lisière est venue combler.
 *
 * ⚠️ L'ÉCHELLE EST CALCULÉE, PAS INVENTÉE. Les cinq marches montent d'un cran et
 * redescendent d'un cran : un niveau doit valoir exactement ce qu'on peut
 * permettre d'y retirer, sinon deux niveaux font la même chose et le joueur se
 * demande lequel choisir.
 */
export interface NiveauQualite {
  /** Le nom affiché sur le bouton. */
  nom: string
  /** Le plafond de densité d'écran. */
  pixels: number
  /** Multiplicateur d'écartement des massifs. > 1 = moins de massifs. */
  decor: number
  /** Multiplicateur de matière dans un massif. > 1 = plus de triangles. */
  densite: number
}

export const NIVEAUX: Record<Exclude<Quality, 'auto'>, NiveauQualite> = {
  fluide: { nom: 'Fluide', pixels: 1, decor: 1.7, densite: 0.5 },
  faible: { nom: 'Faible', pixels: 1.25, decor: 1.35, densite: 0.72 },
  moyen: { nom: 'Moyen', pixels: 1.5, decor: 1.15, densite: 0.9 },
  maxi: { nom: 'Maxi', pixels: 2, decor: 1, densite: 1.05 },
  ultra: { nom: 'Ultra', pixels: 3, decor: 0.85, densite: 1.25 },
}

/** Les cinq crans, du plus économique au plus coûteux. */
export const ORDRE_QUALITE: Exclude<Quality, 'auto'>[] = [
  'fluide',
  'faible',
  'moyen',
  'maxi',
  'ultra',
]

/**
 * ⚠️ « AUTO » EST CHOISI UNE FOIS, ET IL NE BOUGE PAS.
 *
 * Un mode auto qui ajuste en cours de partie oscille : le jeu descend d'un
 * cran, la cadence remonte, il remonte, la cadence retombe — et le joueur voit
 * l'image « respirer » sans savoir pourquoi. Auto se contente donc de demander
 * à l'appareil ce qu'il est, ce qu'on peut faire une fois sans trembler.
 */
export function resoudreQualite(q: Quality): Exclude<Quality, 'auto'> {
  if (q !== 'auto') return q
  const mobile = matchMedia('(pointer: coarse)').matches
  /*
   * ⚠️ Le nombre de cœurs ne décide pas seul.
   *
   * Un téléphone à 4 cœurs fait la moitié des images par seconde d'un octuple,
   * à qualité égale. On s'en sert donc pour écarter « Maxi » — que le nombre de
   * pixels rendrait intenable — mais le mobile garde « Moyen », ce qui est son
   * réglage de référence depuis le début du jeu.
   */
  const cœurs = navigator.hardwareConcurrency ?? 8
  return mobile && cœurs <= 4 ? 'faible' : mobile ? 'moyen' : 'maxi'
}

/** Le niveau effectif : celui qui décide vraiment de ce qui est dessiné. */
export function niveauDe(q: Quality): NiveauQualite {
  return NIVEAUX[resoudreQualite(q)]
}

/**
 * Les deux anciens réglages, ramenés sur l'échelle nouvelle.
 *
 * ⚠️ SANS ÇA, l'ANCIEN CHOIX DISPARAÎTRAIT SANS MOT. Un joueur qui avait
 * « Fluide » se retrouverait sur « Auto » — donc sur « Maxi » — et il
 * Conclusion : que le jeu saccade, parce qu'on a effacé son réglage sans lui
 * demander.
 */
const ANCIENS: Record<string, Exclude<Quality, 'auto'>> = { haut: 'maxi', bas: 'fluide' }

function validQuality(v: unknown): Quality {
  const s = String(v ?? '')
  if (s === 'auto') return 'auto'
  if (s in NIVEAUX) return s as Exclude<Quality, 'auto'>
  return ANCIENS[s] ?? 'auto'
}

/** Le volume par défaut : présent sans couvrir le reste. */
export const VOLUME_DEFAUT = 0.55

const KEY = 'kurogane-settings'
export const MAX_NAME = 12

/** Un pseudo sûr : pas de retour à la ligne, pas de pavé, 12 caractères max. */
export function cleanName(v: unknown): string {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
}

/** Une couleur valide : un entier 0xrrggbb. Sinon on retombe sur le défaut. */
function validColor(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : fallback
}

/**
 * Relit le skin perso en validant tout : une couleur bidouillée à la main ou
 * une vieille sauvegarde ne doit pas pouvoir peindre un guerrier illisible ni
 * casser le rendu.
 */
function loadCustom(raw: unknown): CustomSkin {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    body: validColor(r.body, DEFAULT_CUSTOM.body),
    band: validColor(r.band, DEFAULT_CUSTOM.band),
    head: HEADS.includes(r.head as Head) ? (r.head as Head) : DEFAULT_CUSTOM.head,
  }
}

/**
 * Relit les réglages du téléphone.
 * Tout est validé au passage : une vieille sauvegarde ou un localStorage
 * bidouillé à la main ne doit pas pouvoir casser le jeu.
 */
export function loadSettings(): Settings {
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
  } catch {
    // JSON abîmé, ou localStorage interdit (navigation privée) : on repart des défauts
  }
  return {
    // 'perso' n'est pas dans le roster (il se construit) : on le garde tel quel,
    // sinon fighterById le renverrait vers Yasuke et on perdrait le choix.
    fighter: raw.fighter === PERSO_ID ? PERSO_ID : fighterById(raw.fighter as string).id,
    custom: loadCustom(raw.custom),
    name: cleanName(raw.name),
    quality: validQuality(raw.quality),
    // Allumée par défaut : elle fait beaucoup pour l'ambiance, et le premier
    // réflexe de qui n'en veut pas est d'aller la baisser dans les options.
    // `musique: false` est l'ancien réglage oui/non : on le convertit en silence.
    volumeMusique:
      typeof raw.volumeMusique === 'number' && raw.volumeMusique >= 0 && raw.volumeMusique <= 1
        ? raw.volumeMusique
        : raw.musique === false
          ? 0
          : VOLUME_DEFAUT,
    // Un peu plus fort que la musique : les bruitages doivent passer PAR-DESSUS
    // elle, ce sont eux qui portent l'information de jeu.
    volumeSfx:
      typeof raw.volumeSfx === 'number' && raw.volumeSfx >= 0 && raw.volumeSfx <= 1
        ? raw.volumeSfx
        : 0.7,
    // Absent d'une vieille sauvegarde = allumé : on ne fait pas disparaître les
    // pseudos chez qui ne les a jamais éteints.
    afficherNoms: raw.afficherNoms !== false,
    // 🌍 Validés ENSEMBLE : une région n'a de sens que dans son pays, et un
    // couple incohérent (japonais et normand) doit se réduire au pays seul.
    ...valider(raw.pays, raw.region),
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // Quota plein ou stockage interdit : tant pis, le jeu marche quand même
  }
}
