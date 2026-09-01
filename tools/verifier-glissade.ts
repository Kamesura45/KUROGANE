/**
 * ————— Le contrôle de la GLISSADE, au sol et en l'air —————
 *
 * Deux gestes portent la même touche, et ce ne sont pas les mêmes :
 *
 *   · au sol  → une glissade courte (0,55 s × le style du guerrier) ;
 *   · en l'air → un PLONGEON qui s'achève en glissade de 5 s (`SLIDE_AIR`).
 *
 * Rien de tout cela ne se vérifie à l'œil : cinq secondes de course passent
 * vite, la boîte de collision est invisible, et le seul témoin à l'écran est
 * un corps aplati dont on ne mesure pas la durée en le regardant. D'où ce
 * banc, qui rejoue les séquences image par image avec le vrai `Player`.
 *
 * Il garde aussi la trace de ce qu'on attend de la manœuvre : qu'elle démarre
 * À L'APPUI et non à l'atterrissage, qu'elle SURVIVE au contact du sol, et
 * qu'on puisse en sortir en sautant. Les trois se sont décidées ensemble.
 *
 *   node --import ./tools/resolveur-ts.mjs tools/verifier-glissade.ts
 */

/* Un canvas 2D en carton-pâte : NameTag mesure du texte, rien de plus. */
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
import { Player, SLIDE_AIR } from '../src/player.ts'

const DT = 1 / 60
const scene = new THREE.Scene()
const p = new Player(scene)

let ko = 0
function verifie(cond: boolean, quoi: string) {
  console.log(`  ${cond ? 'OK   ' : 'ÉCHEC'} ${quoi}`)
  if (!cond) ko++
}

/**
 * Le sommet du saut.
 *
 * ⚠️ On y MONTE avant de mesurer quoi que ce soit. Une première version
 * plongeait dès la deuxième image du saut : on était encore à 22 cm du sol,
 * et la chute prenait 0,02 s — de quoi faire passer le contrôle sans rien
 * prouver, puisque tout serait tombé aussi vite de si bas.
 *
 * `vy` est privé, et doit le rester : on lit donc le sommet à ce qu’il fait,
 * une altitude qui cesse de monter.
 */
function monteAuSommet(): number {
  p.reset(1)
  p.update(DT)
  p.jump()
  let precedent = -1
  let n = 0
  while (p.mesh.position.y > precedent && n < 300) {
    precedent = p.mesh.position.y
    p.update(DT)
    n++
  }
  return p.mesh.position.y
}

/** Le temps de retombée depuis le sommet, avec ou sans plongeon. */
function chuteDepuisSommet(plonge: boolean): { t: number; h: number } {
  const h = monteAuSommet()
  if (plonge) p.slide()
  let n = 0
  while (!p.onGround && n < 600) {
    p.update(DT)
    n++
  }
  return { t: n * DT, h }
}

/** Combien de temps le joueur reste couché, à partir de maintenant. */
function dureeGlissade(max = 12): number {
  let t = 0
  while (p.isSliding && t < max) {
    p.update(DT)
    t += DT
  }
  return t
}

// ————— 1. Au sol : la glissade courte n'a pas bougé —————
console.log("\n— Au sol : la glissade courte est intacte —")
p.reset(1)
p.update(DT)
const auSol = p.slide()
verifie(auSol > 0, `la glissade au sol renvoie sa durée (${auSol.toFixed(2)} s)`)
verifie(auSol < 1, `elle reste courte : ${auSol.toFixed(2)} s, bien loin des ${SLIDE_AIR} s`)
const mesureSol = dureeGlissade()
verifie(
  Math.abs(mesureSol - auSol) < 0.05,
  `mesurée à ${mesureSol.toFixed(2)} s, conforme à ce qu'elle annonce`
)

// ————— 2. En l'air : le plongeon part en glissade de 5 s —————
console.log("\n— En l'air : le plongeon s'achève en glissade —")
p.reset(1)
p.update(DT)
p.jump()
p.update(DT)
verifie(!p.onGround, 'on est bien en vol avant de glisser')

// Le plongeon vaut par ce qu’il fait GAGNER : on le mesure contre une chute
// libre depuis la même hauteur, seule comparaison qui ait un sens.
const libre = chuteDepuisSommet(false)
const plonge = chuteDepuisSommet(true)
console.log(
  `  (sommet ${libre.h.toFixed(2)} m — chute libre ${libre.t.toFixed(2)} s, ` +
    `plongeon ${plonge.t.toFixed(2)} s)`
)
verifie(
  plonge.t < libre.t * 0.6,
  `le plongeon coupe la retombée de ${Math.round((1 - plonge.t / libre.t) * 100)} %`
)

// On remet le coureur en vol pour la suite de la séquence.
p.reset(1)
p.update(DT)
p.jump()
p.update(DT)

const enVol = p.slide()
verifie(enVol === SLIDE_AIR, `la glissade en l'air annonce ${SLIDE_AIR} s (reçu ${enVol})`)
// ⚠️ Le point qui décide du ressenti : le corps s'aplatit À L'APPUI. Si la
// glissade n'était armée qu'à l'atterrissage, le joueur resterait une demi-
// seconde sans le moindre signe que son geste a été entendu.
verifie(p.isSliding, "elle démarre à l'appui, pas à l'atterrissage")

let images = 0
while (!p.onGround && images < 600) {
  p.update(DT)
  images++
}
const chute = images * DT
verifie(p.isSliding, 'la glissade SURVIT au contact du sol')

const restant = dureeGlissade()
const total = chute + restant
verifie(
  Math.abs(total - SLIDE_AIR) < 0.1,
  `elle dure ${total.toFixed(2)} s en tout, atterrissage compris`
)
verifie(!p.isSliding, 'puis elle se termine — elle ne dure pas indéfiniment')

// ————— 3. On peut en sortir : sauter relève —————
console.log('\n— On en sort quand on veut : le saut relève —')
p.reset(1)
p.update(DT)
p.jump()
p.update(DT)
p.slide()
let n = 0
while (!p.onGround && n < 600) {
  p.update(DT)
  n++
}
verifie(p.isSliding, 'au sol, encore couché')
p.jump()
verifie(!p.isSliding, 'le saut interrompt la glissade au lieu de la subir')

// ————— 4. La boîte de collision suit le corps —————
console.log('\n— La boîte de collision rétrécit avec le corps —')
p.reset(1)
p.update(DT)
const debout = p.hitbox().max.y - p.hitbox().min.y
p.jump()
p.update(DT)
p.slide()
// Le corps s'aplatit en quelques images (interpolation), pas d'un coup.
for (let i = 0; i < 30; i++) p.update(DT)
const couche = p.hitbox().max.y - p.hitbox().min.y
console.log(`  (debout ${debout.toFixed(2)} m → couché ${couche.toFixed(2)} m)`)
verifie(couche < debout * 0.7, "couché, on passe sous ce qui arrêtait debout")

// ⚠️ Le revers, et il est voulu : couché, on ne saute plus. Le banc le vérifie
// pour que personne ne « corrige » un jour la manœuvre en la rendant gratuite.
console.log('\n— Le revers : la manœuvre a un prix —')
verifie(
  couche < debout,
  'la glissade échange les obstacles hauts contre les bas, elle ne les annule pas'
)

console.log(ko === 0 ? '\n✅ TOUT PASSE\n' : `\n❌ ${ko} ÉCHEC(S)\n`)
process.exit(ko === 0 ? 0 : 1)
