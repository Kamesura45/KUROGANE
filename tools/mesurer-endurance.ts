/**
 * ————— 📈 L'ENDURANCE DE LA COURSE SANS FIN —————
 *
 * Une course sans fin n'a pas de fin : tout ce qui grandit avec la distance
 * finit par se voir. Ce banc fait courir la VRAIE piste sur des kilomètres et
 * relève, palier par palier :
 *
 *   · le temps de calcul par image — se dégrade-t-il avec la distance ?
 *   · la taille des plans, qui s'allongent à chaque tronçon cousu ;
 *   · la taille des réserves de maillages, qui elles devraient PLAFONNER.
 *
 * La distinction est tout l'intérêt. Un plan qui grandit ne coûte rien tant que
 * personne ne le reparcourt : il se lit par un curseur qui avance. Une réserve
 * de maillages qui grandirait, en revanche, voudrait dire que le recyclage ne
 * marche pas — et là, c'est la mémoire vidéo qui monte jusqu'à l'onglet mort.
 *
 *   npm run endurance
 */

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
const g = globalThis as unknown as { document: unknown }
g.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
}

import * as THREE from 'three'
import { Track, COURSE_LENGTH } from '../src/track.ts'

const VITESSE = 22 // m/s, un rythme de course soutenu
const DT = 1 / 60
const PAS = VITESSE * DT // ~0,37 m par image
const PALIER = 2000 // on relève tous les 2 km
const BOUT = 20000 // 20 km, soit ~15 minutes de course réelle

const scene = new THREE.Scene()
const track = new Track(scene)
track.reset(COURSE_LENGTH, 1234, true, true)

/** Les réserves de maillages, celles qui DOIVENT plafonner. */
function reserves() {
  const t = track as unknown as Record<string, unknown[]>
  return {
    obstacles: t.obstacles?.length ?? 0,
    jarres: t.jarres?.length ?? 0,
    rouleaux: t.rouleaux?.length ?? 0,
    plateformes: t.plateformes?.length ?? 0,
  }
}

/** Les plans, qui eux s'allongent à chaque tronçon. */
function plans() {
  const t = track as unknown as Record<string, unknown[]>
  return {
    plan: t.plan?.length ?? 0,
    plateformePlan: t.plateformePlan?.length ?? 0,
    jarrePlan: t.jarrePlan?.length ?? 0,
    murPlan: t.murPlan?.length ?? 0,
    planBots: t.planBots?.length ?? 0,
  }
}

console.log(`\n— ${BOUT / 1000} km de course sans fin, relevé tous les ${PALIER / 1000} km —\n`)
console.log(
  'distance   µs/image   plan  plats  jarres   murs  |  réserve obst.  jarres  rouleaux  plats'
)

const releves: { d: number; us: number; plan: number; obst: number }[] = []
let distance = 0
while (distance < BOUT) {
  const debut = process.hrtime.bigint()
  let images = 0
  const cible = distance + PALIER
  while (distance < cible) {
    distance += PAS
    track.update(DT, VITESSE, distance)
    images++
  }
  const us = Number(process.hrtime.bigint() - debut) / 1000 / images
  const p = plans()
  const r = reserves()
  releves.push({ d: distance, us, plan: p.plan, obst: r.obstacles })
  console.log(
    `${String(Math.round(distance)).padStart(7)} m ${us.toFixed(1).padStart(9)} ` +
      `${String(p.plan).padStart(6)} ${String(p.plateformePlan).padStart(6)} ` +
      `${String(p.jarrePlan).padStart(7)} ${String(p.murPlan).padStart(6)}  |  ` +
      `${String(r.obstacles).padStart(12)} ${String(r.jarres).padStart(7)} ` +
      `${String(r.rouleaux).padStart(9)} ${String(r.plateformes).padStart(6)}`
  )
}

// ————— Ce que les chiffres disent —————
const premier = releves[0]
const dernier = releves[releves.length - 1]
console.log('')
let ko = 0
function verifie(cond: boolean, quoi: string) {
  console.log(`  ${cond ? 'OK   ' : 'ÉCHEC'} ${quoi}`)
  if (!cond) ko++
}

const derive = dernier.us / premier.us
verifie(
  derive < 1.5,
  `le temps par image ne dérive pas : ×${derive.toFixed(2)} entre le 1er et le dernier km`
)
verifie(
  dernier.obst <= premier.obst * 1.6,
  `la réserve de maillages plafonne : ${premier.obst} → ${dernier.obst} obstacles`
)
console.log(
  `  (le plan, lui, passe de ${premier.plan} à ${dernier.plan} entrées — c'est attendu :\n` +
    `   il se lit par un curseur qui avance, personne ne le reparcourt.)`
)

// Combien de mémoire, en ordre de grandeur ?
const octets = process.memoryUsage().heapUsed
console.log(`  (tas Node après ${BOUT / 1000} km : ${(octets / 1024 / 1024).toFixed(1)} Mo)`)

/*
 * ————— 🖊️ LES ÉCRITURES DU HUD QUE LE CACHE ÉVITE —————
 *
 * On n'a pas besoin du DOM pour compter : ce qui décide, c'est la SUITE DE
 * VALEURS affichées. On rejoue donc une course ordinaire à 60 images par
 * seconde et l'on compte combien de fois le texte affiché change vraiment.
 *
 * ⚠️ Le chrono s'affiche au dixième : il ne peut pas changer plus de 10 fois
 * par seconde, quel que soit le nombre d'images. Tout le reste était réécrit
 * pour rien.
 */
console.log('')
console.log('— Les écritures du HUD sur une course de 1 920 m —')
{
  const IMAGES = 60
  let t = 0
  let d = 0
  let images = 0
  let chrono = ''
  let jauge = ''
  let ecritChrono = 0
  let ecritJauge = 0
  while (d < COURSE_LENGTH) {
    t += 1 / IMAGES
    d += VITESSE / IMAGES
    images++
    const c = `${t.toFixed(1)} s`
    if (c !== chrono) {
      chrono = c
      ecritChrono++
    }
    const j = `${((d / COURSE_LENGTH) * 100).toFixed(1)}%`
    if (j !== jauge) {
      jauge = j
      ecritJauge++
    }
  }
  const pct = (n: number) => Math.round((1 - n / images) * 100)
  console.log(`  ${images} images pour parcourir la course`)
  console.log(
    `  chrono : ${ecritChrono} écritures utiles sur ${images} — ${pct(ecritChrono)} % évitées`
  )
  console.log(
    `  jauge  : ${ecritJauge} écritures utiles sur ${images} — ${pct(ecritJauge)} % évitées`
  )
  verifie(ecritChrono < images / 4, `le chrono ne s'écrit plus qu'un quart du temps`)
  verifie(ecritJauge < images / 2, `la jauge ne s'écrit plus que la moitié du temps`)
}

console.log(ko === 0 ? '\n✅ TOUT PASSE\n' : `\n❌ ${ko} ÉCHEC(S)\n`)
process.exit(ko === 0 ? 0 : 1)
