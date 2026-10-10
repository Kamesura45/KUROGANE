/**
 * ————— Les animations importées —————
 *
 * Les mouvements viennent des .fbx Mixamo déposés dans animation/. Ils ne sont
 * PAS lus ici : `tools/cuire-anims.mjs` les a déjà reciblés sur notre squelette
 * à boîtes et rangés dans anims-cuites.json. Ce module ne fait que les jouer.
 *
 * Le partage suit la règle des dossiers : un mouvement rangé dans le dossier
 * d'un guerrier n'appartient qu'à lui ; à la racine, il sert à tout le monde.
 * Quand un guerrier n'a pas le mouvement demandé, on remonte la chaîne
 * jusqu'au mouvement commun — et s'il n'y a rien du tout, l'appelant garde son
 * animation calculée. Aucun personnage ne peut donc se retrouver figé.
 */
import * as THREE from 'three'
// L'attribut `type: json` n'est pas décoratif : sans lui, Node refuse le
// module. Vite l'accepte aussi, donc le même fichier sert au jeu et aux tests.
import cuites from './anims-cuites.json' with { type: 'json' }
import { CUSTOM_STYLE, animerCourse, type Corps, type Fighter } from './roster'

export type Action =
  | 'repos'
  | 'course'
  | 'courseRapide'
  | 'courseGenee'
  | 'saut'
  | 'glissade'
  | 'chute'
  | 'lancer'
  | 'virageG'
  | 'virageD'
  | 'impact'
  | 'attaque'
  | 'mur'

/**
 * Les gestes qui se SUPERPOSENT à la foulée au lieu de la remplacer.
 *
 * Un coureur qui lance un sort ne cesse pas de courir : il jette le bras
 * pendant que ses jambes continuent. Jouer le lancer seul le ferait patiner
 * sur place au milieu de la piste. On garde donc la foulée sur le bas du
 * corps et on ne pose le geste que sur le haut.
 *
 * C'est un type à part pour que le compilateur refuse de superposer une
 * course : `declencher('course')` n'a aucun sens et ne doit pas compiler.
 */
export type Geste = 'lancer' | 'attaque' | 'impact'

/** Le temps d'un fondu entre deux mouvements. Court : on court, ça doit claquer. */
const FONDU = 0.18

/** Un mouvement prêt à jouer : des quaternions par articulation, plus le rebond. */
interface Clip {
  duree: number
  images: number
  /** 4 flottants par image et par articulation (x, y, z, w) */
  pistes: Record<string, Float32Array>
  /** La hauteur du bassin, image par image */
  hauteur: Float32Array
}

/*
 * Le décodage. Le fichier cuit ne stocke que x, y, z : les quaternions sont
 * unitaires et rangés avec w positif, donc w se retrouve par le calcul. C'est
 * un quart des octets économisé sans rien perdre.
 */
const CLIPS = new Map<string, Clip>()

/*
 * Le fichier cuit range les mouvements dans `motifs` et n'en garde qu'un
 * ANNUAIRE dans `clips` : chaque dossier possédant son jeu complet, le même
 * mouvement s'y trouvait cinq fois à l'identique. On décode donc chaque motif
 * une seule fois, et plusieurs guerriers partagent le même objet en mémoire.
 */
const MOTIFS = new Map<string, Clip>()

for (const [h, brut] of Object.entries((cuites as any).motifs as Record<string, any>)) {
  const pistes: Record<string, Float32Array> = {}
  for (const [joint, plat] of Object.entries(brut.q as Record<string, number[]>)) {
    const n = brut.n as number
    const out = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      const x = plat[i * 3]
      const y = plat[i * 3 + 1]
      const z = plat[i * 3 + 2]
      out[i * 4] = x
      out[i * 4 + 1] = y
      out[i * 4 + 2] = z
      out[i * 4 + 3] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z))
    }
    pistes[joint] = out
  }
  MOTIFS.set(h, {
    duree: brut.d,
    images: brut.n,
    pistes,
    hauteur: Float32Array.from(brut.y as number[]),
  })
}

for (const [cle, h] of Object.entries((cuites as any).clips as Record<string, string>)) {
  const motif = MOTIFS.get(h)
  if (motif) CLIPS.set(cle, motif)
}

/**
 * Où chercher les mouvements d'un guerrier, du plus personnel au plus commun.
 *
 * Le perso « + » descend quatre marches :
 *   1. son ornement           `perso/oni2`, `perso/kitsu`, `perso/aucun`
 *   2. le fonds commun        `perso/`
 *   3. LE GUERRIER DE SON STYLE — Oni-Maru s'il porte les cornes, Tamae s'il
 *      porte les oreilles, Sasuke sinon
 *   4. la racine              `animation/`
 *
 * La 3ᵉ marche n'est pas un emprunt sauvage : `CUSTOM_STYLE` décide déjà de
 * ses réglages de jeu ET de son allure. L'ornement choisit un style, et ce
 * style va maintenant jusqu'au mouvement. On lit la même table que le reste
 * du jeu — impossible que les deux divergent.
 */
function chaine(f: Fighter): string[] {
  if (f.id === 'perso') return [`perso-${f.head}`, 'perso', CUSTOM_STYLE[f.head], 'tous']
  return [f.id, 'tous']
}

/**
 * Le mouvement de repli quand une action n'a pas de clip à elle.
 *
 * La course pressée n'a pas de fichier dédié : personne n'a déposé de sprint.
 * Elle rejoue donc la course normale, mais PLUS VITE (cf. CADENCE) — ce qui
 * suffit à lire l'accélération. Le jour où un vrai sprint atterrit dans un
 * dossier, il sera pris sans toucher à une ligne de code.
 */
const REPLI: Partial<Record<Action, Action>> = {
  courseRapide: 'course',
}

/**
 * La vitesse de lecture d'une action.
 *
 * 1,35 n'est pas un chiffre au jugé : c'est exactement le gain du Souffle de
 * Vent (VENT_BOOST = 0,35). La foulée s'accélère donc autant que le coureur —
 * les pieds ne patinent pas et ne courent pas devant lui.
 */
const CADENCE: Partial<Record<Action, number>> = {
  courseRapide: 1.35,
}

/** Le mouvement à jouer, ou null si personne n'en a fourni. */
export function clipDe(f: Fighter, action: Action): Clip | null {
  for (const source of chaine(f)) {
    const c = CLIPS.get(`${source}/${action}`)
    if (c) return c
  }
  const repli = REPLI[action]
  return repli ? clipDe(f, repli) : null
}

/** Ce guerrier a-t-il de quoi jouer cette action ? */
export function aUnClip(f: Fighter, action: Action) {
  return clipDe(f, action) !== null
}

// ————— La lecture —————

const qA = new THREE.Quaternion()
const qB = new THREE.Quaternion()

/**
 * Lit une articulation à l'instant `t` et pose le résultat dans `sortie`.
 * On interpole en SLERP et pas en linéaire : sur des angles marqués (le genou
 * qui se replie), le linéaire raccourcit le trajet et le membre s'écrase.
 */
function lire(clip: Clip, joint: string, t: number, sortie: THREE.Quaternion, boucle: boolean) {
  const piste = clip.pistes[joint]
  if (!piste) {
    sortie.identity()
    return
  }
  const n = clip.images
  const pos = boucle
    ? ((t % clip.duree) / clip.duree) * n
    : Math.min(t / clip.duree, 0.9999) * n
  const i = Math.floor(pos)
  const f = pos - i
  const i0 = i % n
  // En boucle, la dernière image enchaîne sur la première ; sinon elle tient.
  const i1 = boucle ? (i + 1) % n : Math.min(i + 1, n - 1)

  qA.set(piste[i0 * 4], piste[i0 * 4 + 1], piste[i0 * 4 + 2], piste[i0 * 4 + 3])
  qB.set(piste[i1 * 4], piste[i1 * 4 + 1], piste[i1 * 4 + 2], piste[i1 * 4 + 3])
  sortie.copy(qA).slerp(qB, f)
}

/** Le rebond du bassin à l'instant `t`. */
function lireHauteur(clip: Clip, t: number, boucle: boolean) {
  const n = clip.images
  const pos = boucle ? ((t % clip.duree) / clip.duree) * n : Math.min(t / clip.duree, 0.9999) * n
  const i = Math.floor(pos)
  const f = pos - i
  const a = clip.hauteur[i % n]
  const b = clip.hauteur[boucle ? (i + 1) % n : Math.min(i + 1, n - 1)]
  return a + (b - a) * f
}

/** Le raccord entre un nom d'articulation cuite et le membre correspondant. */
function membre(g: Corps, joint: string): THREE.Object3D | null {
  switch (joint) {
    case 'torse': return g.torse
    case 'tete': return g.tete
    case 'brasG': return g.brasG.pivot
    case 'brasGbas': return g.brasG.bas
    case 'brasD': return g.brasD.pivot
    case 'brasDbas': return g.brasD.bas
    case 'jambeG': return g.jambeG.pivot
    case 'jambeGbas': return g.jambeG.bas
    case 'jambeD': return g.jambeD.pivot
    case 'jambeDbas': return g.jambeD.bas
    default: return null
  }
}

/** Les actions qui tournent en rond ; les autres se jouent une fois et tiennent. */
const EN_BOUCLE: Record<Action, boolean> = {
  repos: true,
  course: true,
  courseRapide: true,
  courseGenee: true,
  saut: false,
  glissade: false,
  chute: false,
  lancer: false,
  virageG: false,
  virageD: false,
  impact: false,
  attaque: false,
  // La course sur mur se joue d'un trait, du saut sur la paroi au lacher.
  mur: false,
}

/**
 * ————— Le miroir —————
 *
 * `Wall Run` a été capturé sur la paroi de GAUCHE : le buste y penche vers -X
 * et c'est la main gauche qui va chercher le mur. Rejoué tel quel à droite, le
 * coureur se penche dans le vide — et il COMBAT l'inclinaison que le jeu ajoute
 * au lieu de s'y ajouter. Plutôt que réclamer un second fichier, on retourne
 * le mouvement.
 *
 * Retourner, c'est deux choses. D'abord ÉCHANGER les membres : ce que faisait
 * le bras gauche, c'est le droit qui le fait. Ensuite retourner chaque
 * rotation : une réflexion à travers le plan sagittal envoie le quaternion
 * (x, y, z, w) sur (x, -y, -z, w) — un balancement avant/arrière est conservé,
 * un mouvement latéral est inversé, ce qui est exactement ce qu'on veut.
 */
export const MUR_COTE_NATIF = -1

const MIROIR: Record<string, string> = {
  brasG: 'brasD',
  brasD: 'brasG',
  brasGbas: 'brasDbas',
  brasDbas: 'brasGbas',
  jambeG: 'jambeD',
  jambeD: 'jambeG',
  jambeGbas: 'jambeDbas',
  jambeDbas: 'jambeGbas',
  // torse et tete n'ont pas de jumeau : ils se retournent sur eux-mêmes.
}

/** Lit une articulation, éventuellement en miroir. */
function lireCote(
  clip: Clip,
  joint: string,
  t: number,
  sortie: THREE.Quaternion,
  boucle: boolean,
  miroir: boolean
) {
  lire(clip, miroir ? MIROIR[joint] ?? joint : joint, t, sortie, boucle)
  if (miroir) {
    sortie.y = -sortie.y
    sortie.z = -sortie.z
  }
}

/** Les articulations du haut du corps — celles que pilote un geste superposé. */
const JOINTS_HAUT = new Set(['torse', 'tete', 'brasG', 'brasGbas', 'brasD', 'brasDbas'])

/**
 * L'état d'animation d'UN coureur. Chacun a le sien : le joueur, chaque bot,
 * chaque rival en ligne. C'est lui qui retient où on en est dans le mouvement
 * et le fondu en cours.
 */
export class Anim {
  private action: Action = 'course'
  private t: number
  private clipCourant: Clip | null = null
  /**
   * 🪞 Rejouer le mouvement retourné. Posé par l'appelant, qui seul sait de
   * quel côté est la paroi.
   */
  miroir = false
  /** Le mouvement qu'on quitte, gardé le temps du fondu */
  private avant: { clip: Clip; action: Action; t: number; miroir: boolean } | null = null
  private fondu = 0
  /** Horloge de la foulee calculee : monotone et sensible a la cadence */
  private tSecours = 0

  /**
   * `phase` décale le point de départ dans le cycle. Sans elle, tous les
   * coureurs poseraient le même pied au même instant : un peloton au pas
   * cadencé, comme des soldats. Un décalage au hasard suffit à casser ça.
   */
  constructor(phase = 0) {
    this.t = phase
  }

  /** Le geste superposé en cours (lancer, attaque, encaissement) */
  private geste: Geste | null = null
  private tGeste = 0

  /**
   * Déclenche un geste du haut du corps, par-dessus la foulée en cours.
   * Rejouer le même le REPART du début : on peut enchaîner deux sorts.
   */
  declencher(geste: Geste) {
    this.geste = geste
    this.tGeste = 0
  }

  /**
   * Demande une action. Rejouer la même ne la redémarre pas — sauf pour les
   * mouvements à un coup (saut, glissade), qu'on veut bien revoir depuis le
   * début à chaque appui.
   */
  jouer(action: Action, redemarrer = false) {
    if (action === this.action && !redemarrer) return
    // Sans clip en cours (première image, ou guerrier sans animation), il n'y
    // a rien à quitter : on démarre net plutôt que de fondre depuis le vide.
    const sortant = this.clipCourant
    // On garde AUSSI l'état du miroir : sans lui, quitter la paroi de droite
    // relisait la pose sortante à l'endroit, et le corps sautait d'un coup.
    this.avant = sortant
      ? { clip: sortant, action: this.action, t: this.t, miroir: this.miroir }
      : null
    this.fondu = sortant ? FONDU : 0
    this.action = action
    this.t = 0
  }

  /**
   * Avance le temps et pose la pose sur le corps.
   * Renvoie false si ce guerrier n'a aucun clip pour l'action en cours :
   * l'appelant retombe alors sur son animation calculée.
   */
  appliquer(f: Fighter, g: Corps, dt: number, intensite = 1): boolean {
    const clip = clipDe(f, this.action)
    this.clipCourant = clip

    /*
     * L'horloge de secours avance MÊME sans clip, et à la même cadence.
     *
     * Sans elle, un guerrier dont le dossier n'a pas de course — Yasuke,
     * Oni-Maru — gardait exactement la même foulée sous le Souffle de Vent et
     * dans le sprint final : la foulée calculée ne connaît pas la cadence.
     * Elle est monotone, jamais remise à zéro : la repartir de zéro à chaque
     * changement d'action ferait sauter la jambe d'un coup.
     */
    this.tSecours += dt * (CADENCE[this.action] ?? 1)
    if (!clip) return false

    this.t += dt * (CADENCE[this.action] ?? 1)
    this.fondu = Math.max(0, this.fondu - dt)

    const boucle = EN_BOUCLE[this.action]
    const melange = this.avant && this.fondu > 0 ? this.fondu / FONDU : 0

    for (const joint of Object.keys(clip.pistes)) {
      const cible = membre(g, joint)
      if (!cible) continue
      lireCote(clip, joint, this.t, cible.quaternion, boucle, this.miroir)

      // Le fondu : on revient vers la pose qu'on quittait, pour ne pas
      // téléporter les membres d'un mouvement à l'autre.
      if (melange > 0 && this.avant) {
        lireCote(
          this.avant.clip,
          joint,
          this.avant.t,
          qTmp,
          EN_BOUCLE[this.avant.action],
          this.avant.miroir
        )
        cible.quaternion.slerp(qTmp, melange)
      }

      // `intensite` à 0 = la pose de repos : c'est ce qui fige le guerrier
      // sur l'écran de sélection.
      if (intensite < 1) cible.quaternion.slerp(REPOS, 1 - intensite)
    }

    let y = lireHauteur(clip, this.t, boucle)
    if (melange > 0 && this.avant) {
      const yAvant = lireHauteur(this.avant.clip, this.avant.t, EN_BOUCLE[this.avant.action])
      y = y + (yAvant - y) * melange
    }
    g.bassin.position.y = 0.72 + (y - 0.72) * intensite

    if (this.fondu <= 0) this.avant = null
    this.poserGeste(f, g, dt, intensite)
    return true
  }

  /**
   * Pose le geste du haut du corps par-dessus la foulée.
   *
   * Il s'ouvre et se referme en douceur : sans ça, le bras claquerait d'un
   * coup dans la pose de lancer, puis retomberait tout aussi sec.
   */
  private poserGeste(f: Fighter, g: Corps, dt: number, intensite: number) {
    if (!this.geste) return
    const clip = clipDe(f, this.geste)
    if (!clip) {
      this.geste = null
      return
    }

    this.tGeste += dt
    if (this.tGeste >= clip.duree) {
      this.geste = null
      return
    }

    // Une ouverture et une fermeture proportionnelles au geste : un geste
    // court ne peut pas s'offrir un fondu aussi long qu'un geste ample.
    const rampe = Math.min(FONDU, clip.duree * 0.25)
    const restant = clip.duree - this.tGeste
    const poids =
      Math.min(1, this.tGeste / rampe) * Math.min(1, restant / rampe) * intensite

    for (const joint of Object.keys(clip.pistes)) {
      if (!JOINTS_HAUT.has(joint)) continue
      const cible = membre(g, joint)
      if (!cible) continue
      lireCote(clip, joint, this.tGeste, qTmp, false, this.miroir)
      cible.quaternion.slerp(qTmp, poids)
    }
  }

  /** Un geste est-il en train de se jouer ? */
  get gesteEnCours() {
    return this.geste !== null
  }

  /**
   * L'horloge de la foulée calculée : monotone, et accélérée comme les clips.
   * C'est elle que joue un guerrier dont le dossier ne fournit pas le mouvement.
   */
  get horloge() {
    return this.tSecours
  }

  /** Où en est le mouvement, de 0 à 1. Utile pour savoir s'il est fini. */
  get avancement() {
    const c = this.clipCourant
    return c ? Math.min(1, this.t / c.duree) : 1
  }

  get actionCourante() {
    return this.action
  }
}

const qTmp = new THREE.Quaternion()
const REPOS = new THREE.Quaternion()

/*
 * ————— Ce que Mixamo ne sait pas —————
 *
 * Les clips animent un corps humain nu. Nos guerriers, eux, portent une lame
 * et traînent des queues ou une cape. Ces deux détails restent CALCULÉS, et se
 * posent par-dessus le mouvement importé.
 */

/** Le bras armé, verrouillé : épaule un peu en arrière, coude replié devant. */
const ARME_EPAULE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0))
const ARME_COUDE = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.15, 0, 0))

/*
 * ————— Le garde-fou du sol —————
 *
 * Les mouvements Mixamo sont joués par un corps aux proportions qui ne sont
 * pas les nôtres : là où leur personnage rase le sol, nos boîtes le
 * traversent. La glissade était la pire — mains et bassin passaient jusqu'à
 * 16 cm sous la piste, et le coureur semblait à moitié enterré.
 *
 * Plutôt que de retoucher chaque clip à la main, on relève le bassin de ce
 * qui dépasse. C'est un filet : il ne fait rien quand tout va bien, et aucun
 * mouvement futur ne pourra enfoncer un guerrier dans le décor.
 *
 * On sonde les MEMBRES SOLIDES uniquement. Les queues, capes et écharpes
 * traînent volontiers plus bas : les inclure relèverait le corps entier pour
 * sauver un bout de tissu, et la glissade se jouerait debout.
 */
const SOUS_LE_PIED = -0.41 // le dessous de la semelle, dans le repère du genou
const SOUS_LA_MAIN = -0.38 // le bout de la main, dans le repère du coude
const sonde = new THREE.Vector3()

function poserAuSol(racine: THREE.Object3D, g: Corps) {
  racine.updateMatrixWorld(true)
  let plusBas = 0
  for (const [membre, creux] of [
    [g.jambeG.bas, SOUS_LE_PIED],
    [g.jambeD.bas, SOUS_LE_PIED],
    [g.brasG.bas, SOUS_LA_MAIN],
    [g.brasD.bas, SOUS_LA_MAIN],
  ] as const) {
    sonde.set(0, creux, 0)
    membre.localToWorld(sonde)
    racine.worldToLocal(sonde)
    if (sonde.y < plusBas) plusBas = sonde.y
  }
  if (plusBas < 0) g.bassin.position.y -= plusBas
}

function finitions(g: Corps, t: number, intensite: number, geste: boolean) {
  // Pendant un geste (lancer, frappe, encaissement), on RELÂCHE le verrou :
  // le bras doit pouvoir partir. Le garder tiendrait la garde et écraserait
  // le lancer qu'on vient justement de déclencher.
  if (g.porteArme && !geste) {
    // Laissé libre, le bras qui PORTE balance de 40° et promène la lame dans
    // les jambes. On le ramène presque entièrement sur sa pose de garde, en
    // gardant un souffle de mouvement pour qu'il ne paraisse pas vissé.
    g.brasD.pivot.quaternion.slerp(ARME_EPAULE, 0.85 * intensite)
    g.brasD.bas.quaternion.slerp(ARME_COUDE, 0.9 * intensite)
  }

  // Ce qui traîne derrière ondule PLUS LENTEMENT que la foulée, et en retard :
  // à la même cadence, queues et cape auraient l'air vissées au corps.
  for (let i = 0; i < g.flottants.length; i++) {
    const f = g.flottants[i]
    const repos = (f.userData.repos ??= f.rotation.x)
    f.rotation.x = repos + Math.sin(t * 5 - 0.6 + i * 0.5) * 0.16 * intensite
  }
}

/**
 * Anime un guerrier : le mouvement importé s'il en a un, l'ancienne foulée
 * calculée sinon.
 *
 * Ce repli n'est pas une précaution de principe. Tout le monde n'a pas tout :
 * les dossiers déposés ne couvrent ni le saut du perso « + » ni la glissade de
 * Yasuke. Plutôt que de figer ces guerriers, on les fait courir comme avant.
 *
 * `tSecours` est l'horloge de la foulée calculée — elle sert au repli et aux
 * flottants, qui ne viennent d'aucun clip.
 */
export function animerGuerrier(
  racine: THREE.Object3D | undefined,
  f: Fighter,
  anim: Anim,
  action: Action,
  dt: number,
  tSecours: number,
  intensite = 1
) {
  const g = racine?.userData?.corps as Corps | undefined
  if (!g) return
  anim.jouer(action)
  if (!anim.appliquer(f, g, dt, intensite)) {
    /*
     * 🧍 L'attente sans clip : personne n'a encore déposé de « Standing Idle »
     * dans animation/. On ne fait PAS courir le guerrier sur place — sur une
     * grille de départ, ce serait ridicule. On le pose en position de repos et
     * on le fait RESPIRER : un souffle lent, décalé par l'horloge propre de
     * chaque coureur pour que la grille ne respire pas à l'unisson.
     */
    if (action === 'repos') {
      animerCourse(racine, 0, 0) // la pose de repos, immobile
      const souffle = Math.sin(anim.horloge * 1.7)
      g.torse.rotation.x = 0.02 + souffle * 0.022
      g.tete.rotation.x = -souffle * 0.015
      g.bassin.position.y = 0.72 + souffle * 0.008
      // Les bras se décollent un rien du corps à l'inspiration
      g.brasG.pivot.rotation.z = 0.04 + souffle * 0.02
      g.brasD.pivot.rotation.z = -0.04 - souffle * 0.02
      return
    }
    // Son horloge à lui, pas celle de l'appelant : elle suit la cadence, donc
    // ce guerrier s'emballe aussi sous le vent et dans le sprint.
    animerCourse(racine, anim.horloge, intensite)
    return
  }
  finitions(g, tSecours, intensite, anim.gesteEnCours)
  if (racine) poserAuSol(racine, g)
}

/**
 * ————— 🎭 LA VIE DE LOBBY —————
 *
 * ⚠️ ELLE S'AJOUTE À LA RESPIRATION, ELLE NE LA REMPLACE PAS.
 *
 * `animerGuerrier(…, 'repos')` écrit déjà une pose debout et un souffle. Ce que
 * cette fonction ajoute par-dessus est ce qui fait qu'un personnage posé devant
 * vous a l'air **vivant** plutôt qu'endormi : le transfert de poids d'un pied sur
 * l'autre, les bras qui ne sont jamais tout à fait immobiles, et — de temps en
 * temps — une **bâille**.
 *
 * ⚠️ ADDITIF, ET C'EST TOUT L'AFFAIRE.
 *
 * Tout est additionné à ce que le repos vient d'écrire, jamais remplacé. Poser
 * une valeur absolue écraserait la respiration selon un rythme arbitraire, et
 * les deux gestes se marcheraient dessus avec un tremblement à chaque fois que
 * leurs périodes se croisent. Additionner veut dire qu'ils se superposent
 * naturellement : on respire en même temps qu'on se balance, et rien ne claque.
 *
 * ⚠️ AUCUN CLIP, ET C'EST DÉLIBÉRÉ.
 *
 * Onze clips existent, tous de course ou de combat : pas un seul « Standing
 * Idle » n'a été déposé dans `animation/`. Tout ce qui se joue ici est donc
 * CALCULÉ — et c'est un avantage : la vie fonctionne pour les dix guerriers,
 * donc pour le perso à ornement, sans qu'il faille saisir un mouvement par
 * modèle. Le jour où un clip d'attente arrive, il remplacera cette fonction, et
 * celle-ci disparaîtra sans qu'aucun appelant ne change.
 */


/**
 * ————— 🎭 LES TROIS GESTES D'ATTENTE —————
 *
 * ⚠️ TROIS, ET PAS UN DE PLUS.
 *
 * Cinq postures d'abord — cinq jeux d'ampitudes — et le résultat fut le même
 * partout : une seule animation, jouée à cinq vitesses. Ce n'était pas faux,
 * c'était **invisible** : personne ne distingue un coefficient multiplié par deux
 * d'un autre mouvement.
 *
 * Ce qui se voit, c'est le GESTE : une bâille n'est pas un regard posé sur le
 * côté, même faits à la même vitesse. D'où trois gestes, et pas quatre — au-delà,
 * l'écran de choix devient un changement de danse, et le joueur regarde le
 * spectacle au lieu de choisir un guerrier.
 *
 * Les AMPLITUDES restent propres à chaque posture : trois gestes, mais trois
 * façons de les jouer, pour qu'aucun voisin de la liste ne se ressemble.
 */
const GESTES = {
  /** 🫁 Il se contente de respirer. Le plus calme — pour les imposants. */
  respirer: { pois: 0.7, cadence: 0.7, bras: 0.6, cycle: 0, duree: 0 },

  /** 🫧 Il bâille. Un geste ample, une fois par cycle. */
  baille: { pois: 1.15, cadence: 1.1, bras: 1.35, cycle: 8.4, duree: 0.34 },

  /** 👀 Il regarde autour de lui, la main au menton. Le plus expressif. */
  scrute: { pois: 0.95, cadence: 1.35, bras: 1.1, cycle: 5.2, duree: 0.46 },
} as const

export type Posture = keyof typeof GESTES

/**
 * ⚠️ LES LIMITES DE LA TÊTE, ET ELLES SONT DANS LE CODE.
 *
 * La tête est le seul membre qui peut traverser le torse : elle est posée au
 * sommet d'un cou de 5 cm, et une inclinaison de 20° vers l'avant suffit à
 * envoyer le devant du crâne **dedans** la poitrine. C'était exactement ce que
 * faisait la bâille — le signe de l'inclinaison était inversé (cf. plus bas).
 *
 * Les bornes ci-dessous ne sont donc pas un réglage de goût, c'est la
 * preventing du défaut : 3° vers l'avant, 20° vers l'arrière, ±6° d'inclinaison,
 * et la rotation latérale limitée à 12° d'un côté, 5° de l'autre.
 *
 * ⚠️ 12° ET 5°, ET NON 12° ET 12° : la dissymétrie est un choix. Une tête qui
 * tourne autant à droite qu'à gauche fait un pendule ; une tête qui tourne
 * *plus* d'un côté regarde quelque chose. C'est le seul endroit du jeu où
 * l'asymétrie est un choix, et non un oubli.
 */
const TETE_AVANT = 0.05 // 3°
const TETE_ARRIERE = 0.35 // 20°
const TETE_COTE = 0.1 // 6° d'inclinaison
const TETE_DROITE = 0.21 // 12°
const TETE_GAUCHE = 0.09 // 5°

const borne = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v

/**
 * @param posture Le GESTE, pas une graine. Deux guerriers peuvent le partager —
 *   c'est le seul doublon acceptable : ce qui compte est qu'aucun voisin de la
 *   liste ne joue le même.
 */
export function vieDeLobby(
  racine: THREE.Object3D | undefined,
  t: number,
  posture: Posture = 'baille',
  phase = 0
) {
  const g = racine?.userData?.corps as Corps | undefined
  if (!g) return
  const P = GESTES[posture]

  /*
   * ⚠️ `phase` DÉCALE L'HORLOGE, IL NE CHANGE PAS LE GESTE.
   *
   * Les deux font un travail différent : le geste dit CE QU'IL FAIT, la phase
   * dit QUAND. Sans phase, deux guerriers du même geste se mettent à bouger
   * ensemble — et sur l'écran de choix, cela se lit comme une seule commande.
   */
  const T = t + phase * 7.31

  /*
   * Le transfert de poids : lent, ample, et JAMAIS symétrique. Un sinus seul
   * fait une horloge ; deux fréquences battues ensemble font une démarche.
   */
  const poids =
    Math.sin(T * 0.55 * P.cadence) * 0.5 + Math.sin(T * 0.23 * P.cadence + 1.1) * 0.5
  g.bassin.position.x = poids * 0.022 * P.pois
  g.bassin.rotation.z = poids * 0.03 * P.pois
  g.torse.rotation.z += poids * 0.018 * P.pois

  // Les bras : un flottement très lent, et un débattement plus vif mais minuscule.
  const bras = Math.sin(T * 0.9 * P.cadence + 2.1)
  g.brasG.pivot.rotation.x += bras * 0.035 * P.bras
  g.brasD.pivot.rotation.x += -bras * 0.028 * P.bras
  g.brasG.pivot.rotation.z +=
    0.012 * P.bras + Math.sin(T * 0.41 * P.cadence) * 0.02 * P.bras
  g.brasD.pivot.rotation.z +=
    -0.012 * P.bras - Math.sin(T * 0.37 * P.cadence + 1) * 0.02 * P.bras

  // Les avant-bras ont leur propre inertie : sinon le bras bouge d'un bloc.
  g.brasG.bas.rotation.x += Math.sin(T * 1.3 * P.cadence) * 0.05 * P.bras
  g.brasD.bas.rotation.x += Math.sin(T * 1.15 * P.cadence + 0.7) * 0.05 * P.bras

  /*
   * ————— 🫧 LA BÂILLE —————
   *
   * ⚠️ LE SIGNE EST NEGATIF, ET C'EST LE CŒUR DU BUG.
   *
   * Le corps est modelé face à **+Z** (cf. le demi-tour de `racine`, dans
   * roster.ts). Une rotation X positive fait donc partir la tête **vers
   * l'avant** — c'est-à-dire dans la poitrine. La première version faisait
   * `+= f * 0.3` : elle.non seulement ne bâillait pas, elle **enfonçait le
   * crâne dans le buste**, de quatre centimètres.
   *
   * Negative : la tête part en arrière, le menton se lève, et c'est une bâille.
   *
   * ⚠️ ET ELLE EST CALCULÉE, PAS DÉCLENCHÉE. `u` est le reste d'une division :
   * le geste vaut 0 en dehors de sa fenêtre, et monte puis redescend tout seul.
   * Pas de minuterie à armer — donc rien qui puisse rester bloqué à mi-geste,
   * ce qui arrive toujours à une animation déclenchée quand on change de
   * guerrier juste avant son pic.
   */
  const u = P.cycle > 0 ? (T % P.cycle) / P.cycle : 1
  if (u < P.duree) {
    const v = u / P.duree
    // Montée, tenue, retour : une cloche, pas un sinus.
    const f = v < 0.35 ? v / 0.35 : v < 0.6 ? 1 : (1 - v) / 0.4
    g.tete.rotation.x -= f * 0.26 // en ARRIÈRE : le menton se lève
    g.brasD.pivot.rotation.x += -f * 1.45 // le bras devant la bouche
    g.brasD.pivot.rotation.z += -f * 0.32
    g.torse.rotation.x += f * 0.05
  }

  /*
   * ————— 👀 LE REGARD —————
   *
   * La tête pivote lentement d'un côté puis de l'autre, à la recherche d'un
   * rival qu'il n'y a pas. C'est un geste dejoueur : c'est lui qui donne au
   * personnage l'air d'ATTENDRE quelqu'un plutôt que de tenir bon.
   *
   * Le bras droit monte au menton. Il ne le touche pas — le buste est à 5 cm du
   * cou, et une main qui entre dans la mâchoire se voit bien plus qu'un bras
   * qui s'arrête trop tôt.
   */
  if (posture === 'scrute') {
    const balayage = Math.sin(T * 0.75)
    // `rotation.y` fait tourner la tête autour du cou : c'est le seul axe qui
    // regarde vraiment « à côté ».
    g.tete.rotation.y += balayage * 0.19
    g.brasD.pivot.rotation.x += -0.95 - balayage * 0.12
    g.brasD.pivot.rotation.z += -0.3
    g.brasD.bas.rotation.x += -0.5
  }

  /*
   * ⚠️ LES BORNES, EN DERNIER — ET C'EST LE BON ORDRE.
   *
   * Elles passent APRÈS tous les gestes, jamais avant : une borne posée au
   * milieu de la fonction serait contournée par le geste suivant, et le défaut
   * qu'elle corrige reviendrait par la porte de derrière. Ici, quoi qu'il ait
   * fait — une bâille, un regard, les deux, ou une combinaison qu'on n'avait pas
   * prévue — la tête sort dans ces bornes, et jamais plus.
   */
  g.tete.rotation.x = borne(g.tete.rotation.x, -TETE_ARRIERE, TETE_AVANT)
  g.tete.rotation.y = borne(g.tete.rotation.y, -TETE_GAUCHE, TETE_DROITE)
  g.tete.rotation.z = borne(g.tete.rotation.z, -TETE_COTE, TETE_COTE)
}
