/**
 * ————— Le contrôle du SPRINT FINAL : personne ne se déplace —————
 *
 * Sur les derniers mètres, marteler accélère et c'est TOUT. Ni changement de
 * ligne, ni saut, ni glissade, ni sort — au clavier comme au pouce.
 *
 * Ce banc existe parce que la règle a été fausse pendant longtemps, et d'une
 * façon qu'aucun test de rendu n'aurait vue : le tactile la respectait déjà,
 * le clavier non. Un joueur au clavier pouvait esquiver dans la dernière
 * ligne droite, un joueur au pouce non — sur une course qui se départage au
 * dixième, l'avantage était décisif et invisible.
 *
 * D'où la forme des contrôles : on ne vérifie pas seulement que chaque
 * plateforme se tait, on vérifie qu'elles se taisent DE LA MÊME FAÇON. Une
 * parité qui n'est pas mesurée se réécarte à la première retouche.
 *
 *   node --import ./tools/resolveur-ts.mjs tools/verifier-sprint.ts
 */

/* Un canvas 2D en carton-pâte, pour la partie qui touche à la piste. */
const ctx2d = {
  font: '',
  fillStyle: '' as unknown,
  measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  beginPath() {},
  ellipse() {},
  fill() {},
  fillRect() {},
  save() {},
  restore() {},
  rotate() {},
  translate() {},
}

type Ecoute = (e: unknown) => void
const clavier: Ecoute[] = []
const g = globalThis as unknown as {
  document: unknown
  addEventListener: (t: string, cb: Ecoute) => void
}
g.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
}
// Le clavier est écouté sur la fenêtre : on l'intercepte avant de construire.
g.addEventListener = (t: string, cb: Ecoute) => {
  if (t === 'keydown') clavier.push(cb)
}

import * as THREE from 'three'
import { Input, type Handlers } from '../src/input.ts'
import { Track, COURSE_LENGTH, SPRINT_ZONE } from '../src/track.ts'

let ko = 0
function verifie(cond: boolean, quoi: string) {
  console.log(`  ${cond ? 'OK   ' : 'ÉCHEC'} ${quoi}`)
  if (!cond) ko++
}

// ————— Le montage : de faux écouteurs, de vrais Handlers —————
const tactile: Record<string, Ecoute> = {}
const el = {
  addEventListener: (t: string, cb: Ecoute) => {
    tactile[t] = cb
  },
}

let sprint = false
let journal: string[] = []
const h: Handlers = {
  left: () => journal.push('gauche'),
  right: () => journal.push('droite'),
  jump: () => journal.push('saut'),
  slide: () => journal.push('glissade'),
  spell: () => journal.push('sort'),
  sprint: () => journal.push('martèlement'),
  isSprint: () => sprint,
}
new Input(el as unknown as HTMLElement, h)

/** Une touche enfoncée ; renvoie ce que le jeu en a fait. */
function touche(key: string): string[] {
  journal = []
  clavier[0]({ key, repeat: false })
  return journal
}

/** Un swipe du doigt ; renvoie ce que le jeu en a fait. */
function swipe(dx: number, dy: number): string[] {
  journal = []
  tactile.touchstart({ changedTouches: [{ clientX: 200, clientY: 200 }] })
  tactile.touchend({ changedTouches: [{ clientX: 200 + dx, clientY: 200 + dy }] })
  return journal
}

/** Un doigt qui se pose — le geste du martèlement. */
function tape(): string[] {
  journal = []
  tactile.touchstart({ changedTouches: [{ clientX: 200, clientY: 200 }] })
  return journal
}

/*
 * Les quatre gestes de déplacement, dans les deux langues.
 * C'est la table de la parité : à chaque ligne, les deux colonnes doivent
 * produire exactement la même chose, sprint ou pas.
 */
const GESTES: { quoi: string; key: string; dx: number; dy: number }[] = [
  { quoi: 'gauche', key: 'ArrowLeft', dx: -60, dy: 0 },
  { quoi: 'droite', key: 'ArrowRight', dx: 60, dy: 0 },
  { quoi: 'saut', key: 'ArrowUp', dx: 0, dy: -60 },
  { quoi: 'glissade', key: 'ArrowDown', dx: 0, dy: 60 },
]

// ————— 1. Hors sprint : tout répond, et pareil des deux côtés —————
console.log('\n— En course ordinaire : les deux plateformes répondent —')
sprint = false
for (const geste of GESTES) {
  const clav = touche(geste.key)
  const doigt = swipe(geste.dx, geste.dy)
  verifie(
    clav.join() === geste.quoi && doigt.join() === geste.quoi,
    `${geste.quoi} : clavier [${clav}] et doigt [${doigt}]`
  )
}

// ————— 2. Pendant le sprint : plus personne ne bouge —————
console.log('\n— Pendant le sprint final : plus personne ne se déplace —')
sprint = true
/*
 * ⚠️ On mesure l'absence de DÉPLACEMENT, et non l'absence de réaction.
 *
 * Sur mobile, le doigt qui se pose pour amorcer un swipe compte déjà comme
 * un coup de martèlement — et c'est voulu : pendant le sprint, poser un
 * doigt EST le geste. Exiger un silence complet faisait échouer le banc sur
 * un comportement correct, et poussait à « corriger » ce qui allait bien.
 */
const deplacement = (r: string[]) => r.filter((x) => x !== 'martèlement')
for (const geste of GESTES) {
  const clav = deplacement(touche(geste.key))
  const doigt = deplacement(swipe(geste.dx, geste.dy))
  verifie(
    clav.length === 0 && doigt.length === 0,
    `${geste.quoi} : aucun déplacement — clavier [${clav}], doigt [${doigt}]`
  )
}
// Les lettres du clavier français mènent aux mêmes gestes : elles tombent aussi.
for (const k of ['q', 'd', 'z', 's', 'e']) {
  verifie(touche(k).length === 0, `la touche « ${k} » ne fait plus rien non plus`)
}

// ————— 3. …mais le martèlement, lui, passe —————
console.log('\n— Le martèlement, lui, passe des deux côtés —')
verifie(touche(' ').join() === 'martèlement', 'la barre d’espace martèle')
verifie(touche('Enter').join() === 'martèlement', 'Entrée martèle')
verifie(tape().join() === 'martèlement', 'le doigt qui se pose martèle')

// ⚠️ Le maintien de la touche ne martèle PAS tout seul : la répétition
// automatique du clavier tape à ~30 coups/s, ce qui gagnerait la course sans
// personne pour la jouer.
journal = []
clavier[0]({ key: ' ', repeat: true })
verifie(journal.length === 0, 'maintenir la barre enfoncée ne martèle pas tout seul')

// ————— 4. La barre d’espace redevient un saut hors sprint —————
console.log('\n— Hors sprint, la barre d’espace redevient un saut —')
sprint = false
verifie(touche(' ').join() === 'saut', 'espace saute quand on ne sprinte pas')
verifie(touche('e').join() === 'sort', 'le sort repart quand on ne sprinte pas')

/*
 * ————— 5. LA JUSTIFICATION DE LA COUPURE —————
 *
 * Couper les commandes n'est acceptable que si la piste est vide sur ces
 * mètres-là. Si un obstacle s'y trouvait, on retirerait au joueur le moyen de
 * l'éviter — et le contrôle ci-dessus passerait quand même, en validant une
 * règle injuste. On le vérifie donc sur une VRAIE course.
 */
console.log('\n— La zone du sprint est vide : il n’y a rien à esquiver —')
const track = new Track(new THREE.Scene())
track.reset(COURSE_LENGTH, 12345)
const debutZone = COURSE_LENGTH - SPRINT_ZONE
const dedans = track.obstaclesPrevus().filter((o) => o.d >= debutZone)
const platesDedans = track.plateformesPrevues().filter((p) => p.d >= debutZone)
console.log(
  `  (${track.obstaclesPrevus().length} obstacles sur la course, ` +
    `${dedans.length} après ${debutZone} m)`
)
verifie(dedans.length === 0, `aucun obstacle dans les ${SPRINT_ZONE} derniers mètres`)
verifie(platesDedans.length === 0, 'aucune plateforme non plus')

console.log(ko === 0 ? '\n✅ TOUT PASSE\n' : `\n❌ ${ko} ÉCHEC(S)\n`)
process.exit(ko === 0 ? 0 : 1)
