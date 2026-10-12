/**
 * ————— Le banc permanent : ping et images/s —————
 *
 * Deux chiffres, en temps réel, à côté du compteur de connectés. Les deux
 * existent déjà, sous des formes que personne ne regarde :
 *
 *  · `net.ts` mesure le ping depuis le début — un aller-retour toutes les deux
 *    secondes — mais range le résultat dans `net.rtt`, où il ne sert qu'à la
 *    prédiction des rivaux.
 *  · Les images/s ne sont comptées nulle part en jeu : le diagnostic les
 *    mesure UNE fois, en laboratoire, sur une scène figée.
 *
 * Ce module ne fait que les rendre LISIBLES. Il n'ajoute ni requête, ni
 * thread, ni charge : `requestAnimationFrame` tourne déjà pour dessiner, on
 * compte juste les coups qu'il nous donne. Le ping est lu là où il est déjà
 * calculé.
 *
 * ⚠️ Tout est LOCAL. Rien de tout ça n'est envoyé au serveur : c'est une
 * sonde de confort, pas un télémètre. Et les deux sont ÉTEINTS par défaut —
 * un chiffre qui défile en permanence dérange autant qu'il rassure.
 */

/** On accumule une demi-seconde avant de calculer une cadence. Assez court
 *  pour qu'on voie un accoulement se produire, assez long pour que le chiffre
 *  ne se mette pas à trembler. */
const FENETRE = 500

let images = 0
let departFenetre = 0
/** Le lissage se souvient de tout : une fenêtre mal tombée ne suffit pas à
 *  faire croire que la machine a rendu 4 images par seconde. */
let lissage = 0
let fps: number | null = null

let raf = 0

/** Aller-retour en millisecondes. `null` = aucun salon n'a encore répondu. */
let ping: number | null = null

export interface Mesures {
  fps: number | null
  ping: number | null
}

const abonnes: ((m: Mesures) => void)[] = []

function annoncer() {
  if (abonnes.length === 0) return
  const m: Mesures = { fps, ping }
  for (const cb of abonnes) {
    try {
      cb(m)
    } catch {
      // Un abonné qui crache n'empêche pas les autres d'être prévenus.
    }
  }
}

function boucle(t: number) {
  images++
  if (departFenetre === 0) departFenetre = t
  const ecoule = t - departFenetre
  if (ecoule >= FENETRE) {
    const brut = (images * 1000) / ecoule
    lissage = lissage === 0 ? brut : lissage * 0.6 + brut * 0.4
    fps = lissage
    images = 0
    departFenetre = t
    annoncer()
  }
  raf = requestAnimationFrame(boucle)
}

/** Ouvre le robinet. Idempotent : appelé à chaque bascule d'option. */
export function demarrerPerf() {
  if (raf !== 0) return
  images = 0
  departFenetre = 0
  raf = requestAnimationFrame(boucle)
}

/**
 * Le ferme.
 *
 * ⚠️ On ne remet PAS `fps` à zéro : les options sont éteintes, le chiffre
 * n'est plus affiché nulle part, et un `0` resurgissant à la prochaine
 * ouverture des réglages mentirait sur la machine.
 */
export function arreterPerf() {
  if (raf === 0) return
  cancelAnimationFrame(raf)
  raf = 0
}

/**
 * `net.ts` appelle ça dès qu'un pong arrive, en millisecondes.
 *
 * La même moyenne glissante que `net.rtt` — un pic de réseau n'a pas à faire
 * sauter le compteur de 40 à 600 et redescendre en escalier.
 */
/**
 * Deux chemins mesurent la même chose — un aller-retour au serveur — et
 * c'est le seul cas où ce module accepte deux portes.
 *
 *  · `'salon'` — le WebSocket, toutes les deux secondes, en piste. Plus
 *    fréquent, et plus juste : c'est la liaison sur laquelle le jeu repose.
 *  · `'http'` — la sonde `/sante`, toutes les dix secondes. Sans elle, le
 *    ping serait MUET sur l'écran-titre… où le compteur vit pourtant.
 *
 * Le salon gagne : une sonde toutes les dix secondes ne doit pas écraser de
 * son épislon ce que le salon vient de dire. On ne la laisse parler que si le
 * salon s'est tu depuis plus de cinq secondes — un salon perdu, un écran
 * verrouillé, une reconnexion.
 */
const PRIORITE_SALON = 5000
let dernierPingSalon = 0

export function noterPing(ms: number, source: 'salon' | 'http' = 'salon') {
  if (!Number.isFinite(ms) || ms <= 0) return
  const maintenant = performance.now()
  if (source === 'http' && maintenant - dernierPingSalon < PRIORITE_SALON) return
  if (source === 'salon') dernierPingSalon = maintenant
  ping = ping === null ? ms : ping * 0.7 + ms * 0.3
  annoncer()
}

/**
 * On n'a plus de salon : le ping du salon n'a plus de sens.
 *
 * ⚠️ On ne remet PAS `dernierPingSalon` à zéro — `performance.now()` n'est
 * pas monotone à travers un rechargement, et une valeur très ancienne
 * laisserait la sonde HTTP parler librement, ce qui est exactement ce qu'on
 * veut une fois le salon parti.
 */

/**
 * On n'a plus de salon : le ping n'a plus de sens.
 *
 * ⚠️ Remettre à `null` et pas à `0` — « 0 ms » se lirait comme « instantané »,
 * et c'est exactement le mensonge que le compteur des connectés refuse déjà
 * de faire avec `CO:000`.
 */
export function oublierPing() {
  if (ping === null) return
  ping = null
  annoncer()
}

/** La dernière mesure connue. Ne notifie personne : c'est une lecture. */
export function mesures(): Mesures {
  return { fps, ping }
}

/** Prévenir à chaque nouvelle mesure — toutes les 0,5 s au plus. */
export function surMesure(cb: (m: Mesures) => void) {
  abonnes.push(cb)
}
