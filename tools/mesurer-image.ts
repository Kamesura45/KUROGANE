/**
 * ————— 💰 Ce que coûte une image, hors de Track.update —————
 *
 * `npm run endurance` chronomètre `Track.update`. Rien n'a encore mesuré ce
 * que la boucle de jeu paie À CÔTÉ, à CHAQUE image : les tests de collision
 * qui seuls voient les jarres, les rouleaux, les torii et les obstacles ; le
 * tremblement des arcs d'un portail ; et l'animation des coureurs.
 *
 * Trois sujets soupçonnés depuis longtemps, jamais chiffrés :
 *
 *   1. 🏺 `Box3.setFromObject()` — il remonte TOUT le sous-arbre d'un maillage
 *      pour en déduire la boîte englobante. Cinq fonctions s'en servent
 *      (track.ts:1944, 1976, 2015, 2061, 2124), et quatre d'entre elles sont
 *      appelées par image (main.ts:4799, 4873, 4967, 4981).
 *   2. ⚡ `jitterArc()` — elle réécrit 7 × 6 points et lève `needsUpdate` à
 *      chaque image d'un portail. Le GPU est le vrai sujet, mais le CPU se
 *      mesure, et il pose la borne basse.
 *   3. 💃 `Anim.appliquer()` — `Object.keys()` alloue un tableau de chaînes par
 *      coureur et par image, et `poserAuSol()` force un `updateMatrixWorld()`
 *      entier alors que le rendu va en faire un autre.
 *
 * On ne corrige que ce que la mesure condamne : c'est la règle de la maison.
 *
 *   npm run image
 */

/*
 * ⚠️ EN PREMIER, et rien au-dessus. Voir tools/faux-navigateur.ts.
 */
import './faux-navigateur.ts'

import * as THREE from 'three'
import { Track, COURSE_LENGTH } from '../src/track.ts'
import { LANES } from '../src/player.ts'
import { Anim, animerGuerrier, clipDe } from '../src/anims.ts'
import { ROSTER, buildFighter, type Corps, type Fighter } from '../src/roster.ts'

const FPS = 60
const DT = 1 / FPS
const VITESSE = 22 // m/s, un rythme de course soutenu
const IMAGE_US = 1_000_000 / FPS

let ko = 0
function verifie(cond: boolean, quoi: string) {
  console.log(`  ${cond ? 'OK   ' : 'ÉCHEC'} ${quoi}`)
  if (!cond) ko++
}

const lesMesures = new Map<string, number>()

/**
 * ⚠️ UNE PASSE DE CHAUFFE AVANT CHAQUE RELEVÉ, sinon le premier chiffre mesure
 * la compilation du JIT et non la fonction. Vu en écrivant `mesurer-fuites.ts` :
 * `premierBarrage` rendait 74 µs au premier lancer, 30 µs au suivant — ×2,4
 * sans rapport avec la piste.
 */
function chronometre(cle: string, nom: string, appel: () => void, images = 2000): number {
  for (let i = 0; i < images; i++) appel()
  let meilleur = Infinity
  for (let tour = 0; tour < 3; tour++) {
    const debut = process.hrtime.bigint()
    for (let i = 0; i < images; i++) appel()
    const us = Number(process.hrtime.bigint() - debut) / 1000 / images
    if (us < meilleur) meilleur = us
  }
  const us = meilleur
  const part = (us / IMAGE_US) * 100
  console.log(
    `  ${nom.padEnd(34)} ${us.toFixed(2).padStart(8)} µs/image   ` +
      `${part.toFixed(2).padStart(6)} % de l'image`
  )
  lesMesures.set(cle, us)
  return us
}

/*
 * La hitbox telle que `player.ts:641-648` la rend : 60 cm de large, 1,50 m de
 * haut, centrée sur le coureur, qui est à z = 0 dans le repère de la piste —
 * les obstacles avancent jusqu'à lui.
 */
function hitbox(lane = 1) {
  const x = LANES[lane]
  return new THREE.Box3(
    new THREE.Vector3(x - 0.3, 0.05, -0.3),
    new THREE.Vector3(x + 0.3, 1.55, 0.3)
  )
}

/* ════════════════════ 1. 🏺 Les collisions ════════════════════ */

console.log('\n═════════════ 1. Les tests de collision, à chaque image ══════════════\n')

const scene = new THREE.Scene()
const track = new Track(scene)
track.reset(COURSE_LENGTH, 1234, true, false)

/*
 * Ce que `main.ts` appelle vraiment par image, garde comprises :
 *   ramasse       main.ts:4799 — SANS condition.
 *   hits          main.ts:4873 — si `surMur === 0`, soit presque toujours.
 *   heurteTorii   main.ts:4967 — si `stumble <= 0`, soit presque toujours.
 *   heurteJarre   main.ts:4981 — si `stumble <= 0 && surMur === 0`.
 * `casseAuContact` (track.ts:1944) est appelée par `resoudCoup()`, qui sort
 * dès que le joueur n'attaque pas (main.ts:2551) : elle n'est PAS dans le
 * lot par image, et on la chronomètre à part.
 */
function uneImageDeCollisions(b: THREE.Box3): number {
  track.ramasse(b)
  track.hits(b)
  track.heurteTorii(b)
  track.heurteJarre(b)
  return 0
}

/*
 * On fait avancer une VRAIE course et on appelle les quatre à chaque image.
 * Elles consomment ce qu'elles touchent — c'est ce qu'elles font dans le jeu
 * — mais le track en resème en permanence, donc la longueur de la boucle
 * reste représentative d'une course réelle.
 */
{
  const b = hitbox()
  let distance = 0
  const FIN = 3000 // 3 km : assez pour traverser plusieurs biomes

  // La chauffe fait AVANCER la piste : sans elle, la mesure porterait sur une
  // piste encore vide, où la boucle n'a presque rien à balayer.
  for (let i = 0; i < 3000; i++) {
    track.update(DT, VITESSE, distance)
    uneImageDeCollisions(b)
    distance += VITESSE * DT
  }

  /*
   * ⚠️ On n'entoure que les QUATRE APPELS, pas `track.update` : l'entourer
   * aussi aurait donné 768 µs/image, chiffre vrai mais sans rapport avec le
   * sujet — et c'est ce qui s'est passé à la première rédaction de ce banc.
   */
  let total = 0n
  let images = 0
  while (distance < FIN) {
    track.update(DT, VITESSE, distance)
    const t0 = process.hrtime.bigint()
    uneImageDeCollisions(b)
    total += process.hrtime.bigint() - t0
    distance += VITESSE * DT
    images++
  }
  const us = Number(total) / 1000 / images

  console.log(
    `  ${'les 4 ensemble (vraie course)'.padEnd(34)} ${us.toFixed(2).padStart(8)} ` +
      `µs/image   ${((us / IMAGE_US) * 100).toFixed(2).padStart(6)} % de l'image`
  )
  lesMesures.set('collisions', us)
}

track.reset(COURSE_LENGTH, 1234, true, false)

/*
 * On refait tourner la piste AVANT de mesurer le pool : après un `reset`, la
 * réserve ne contient que les maillages nécessaires au premier tronçon (4
 * jarres ici), alors qu'elle PLAFONNE bien plus haut en fin de course — c'est
 * ce que `npm run endurance` relève par palier. Mesurer sur le pool du départ
 * mesurerait le meilleur cas du monde.
 */
{
  const b = hitbox()
  let d = 0
  while (d < 5000) {
    track.update(DT, VITESSE, d)
    track.ramasse(b)
    track.hits(b)
    track.heurteTorii(b)
    track.heurteJarre(b)
    d += VITESSE * DT
  }
}

const reserveJarres = (track as unknown as { jarres: { active: boolean; mesh: THREE.Object3D }[] })
  .jarres.length
chronometre('setFromObject', `setFromObject seul (${reserveJarres} jarres)`, () => {
  const box = new THREE.Box3()
  const j = (track as unknown as { jarres: { active: boolean; mesh: THREE.Object3D }[] }).jarres
  for (let k = 0; k < j.length; k++) box.setFromObject(j[k].mesh)
})
console.log(
  `  → soit ${((lesMesures.get('setFromObject') ?? 0) / reserveJarres).toFixed(2)} µs par ` +
    `jarre. Seules les jarres au filtre |z| ≤ 4 paient ce prix : le reste de la ` +
    `réserve est balayé mais saute l'appel.`
)
chronometre('casseAuContact', 'casseAuContact (si attaque)', () => {
  track.casseAuContact(hitbox())
})

/* ════════════════════ 2. ⚡ jitterArc ════════════════════ */

console.log('\n═════════════ 2. Le tremblement des arcs de portail ══════════════\n')

/*
 * Recopié MOT POUR MOT de main.ts:827 et 844-858, parce que `main.ts` ne
 * s'importe pas sous Node — il emporterait canevas, HUD, réseau et
 * requestAnimationFrame. Le corps de la fonction est identique, ligne à ligne.
 */
const ARC_POINTS = 6
const PORTAIL_ARCS = 7

const portailArcs = Array.from({ length: PORTAIL_ARCS }, () => {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3))
  return new THREE.Line(g, new THREE.LineBasicMaterial())
})

function jitterArc(arc: THREE.Line, rayon: number, ampleur: number) {
  const pos = arc.geometry.getAttribute('position') as THREE.BufferAttribute
  const a = Math.random() * Math.PI * 2
  for (let i = 0; i < ARC_POINTS; i++) {
    const t = i / (ARC_POINTS - 1)
    const r = rayon * (0.45 + t * 0.95)
    pos.setXYZ(
      i,
      Math.cos(a) * r + (Math.random() - 0.5) * ampleur,
      Math.sin(a) * r + (Math.random() - 0.5) * ampleur,
      (Math.random() - 0.5) * ampleur * 0.6
    )
  }
  pos.needsUpdate = true
}

chronometre('jitterArc', 'les 7 arcs, à chaque image', () => {
  for (const arc of portailArcs) jitterArc(arc, 1.6, 0.4)
})

console.log(
  '\n  ⚠️ "needsUpdate" ne coûte ICI presque rien : Node n\'a pas de GPU, le\n' +
    '    re-upload du tampon ne se fait pas. Le chiffre ci-dessus est donc une\n' +
    '    BORNE BASSE — le vrai coût de jitterArc est côté GPU, où 7 tampons\n' +
    '    de 18 octets partent en mémoire vidéo à chaque image.'
)

/* ════════════════════ 3. 💃 Les animations ════════════════════ */

console.log('\n═════════════ 3. L\'animation des coureurs ══════════════\n')

function corpsDe(f: Fighter) {
  const g = new THREE.Group()
  g.add(...buildFighter(f))
  const racine = g.children[0]
  return { racine, corps: racine.userData.corps as Corps }
}

const JEU: Fighter[] = ROSTER.filter((f) => f.pickable)

function peloton(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const f = JEU[i % JEU.length]
    const { racine } = corpsDe(f)
    return { f, racine, anim: new Anim(Math.random()) }
  })
}

let horloge = 0
function animerUn(l: ReturnType<typeof peloton>[number]) {
  horloge += DT
  animerGuerrier(l.racine, l.f, l.anim, 'course', DT, horloge)
}

/*
 * ⚠️ Chauffe LONGUE et TROIS tours dont on garde le MEILLEUR.
 *
 * À 2 000 images, le premier peloton rendait 71 µs et le second 52 µs : non
 * pas parce que cinq coureurs coûteraient moins qu'un, mais parce que le
 * premier chiffre portait encore sur la compilation du JIT. Prendre le
 * meilleur de plusieurs tours est la seule façon stable de mesurer un bloc de
 * ce poids — et c'est ce qui rendait les deux relevés incompatibles.
 */
function mesureAnims(n: number): number {
  const p = peloton(n)
  horloge = 0
  for (let i = 0; i < 5000; i++) animerUn(p[i % n])
  let meilleur = Infinity
  for (let tour = 0; tour < 3; tour++) {
    horloge = 0
    const debut = process.hrtime.bigint()
    for (let i = 0; i < 5000; i++) animerUn(p[i % n])
    const us = Number(process.hrtime.bigint() - debut) / 1000 / 5000
    if (us < meilleur) meilleur = us
  }
  return meilleur
}

for (const n of [1, 5]) {
  const us = mesureAnims(n)
  const nom = n === 1 ? '1 coureur (solo)' : '5 coureurs (course à 4 bots)'
  console.log(
    `  ${nom.padEnd(34)} ${us.toFixed(2).padStart(8)} µs/image   ` +
      `${((us / IMAGE_US) * 100).toFixed(2).padStart(6)} % de l'image`
  )
  lesMesures.set(`anims${n}`, us)
}

console.log('\n  — Ce que cette somme est faite de —\n')

const f0 = JEU[0]
const { racine: racine0, corps: corps0 } = corpsDe(f0)
const clip0 = clipDe(f0, 'course')
const anim0 = new Anim()
anim0.jouer('course')
anim0.appliquer(f0, corps0, DT)

const cles = clip0 ? Object.keys(clip0.pistes) : []
chronometre('objectKeys', `Object.keys(clip.pistes)  [${cles.length}]`, () => {
  if (clip0) Object.keys(clip0.pistes)
})
chronometre('updateMatrixWorld', 'poserAuSol → updateMatrixWorld(true)', () => {
  racine0.updateMatrixWorld(true)
})
chronometre('soloAppliquer', 'anim.appliquer seul (sans poserAuSol)', () => {
  anim0.appliquer(f0, corps0, DT)
})

/* ════════════════════ Ce que la mesure dit ════════════════════ */

console.log('\n═════════════════════ Ce que la mesure dit ══════════════════════\n')

const coll = lesMesures.get('collisions') ?? 0
const anims5 = lesMesures.get('anims5') ?? 0
const total = coll + (lesMesures.get('jitterArc') ?? 0) + anims5

verifie(
  coll < IMAGE_US * 0.1,
  `les 4 collisions par image restent sous 10 % d'une image → ${coll.toFixed(1)} µs`
)
verifie(
  anims5 < IMAGE_US * 0.1,
  `5 coureurs animés restent sous 10 % d'une image → ${anims5.toFixed(1)} µs`
)
verifie(
  total < IMAGE_US * 0.2,
  `collisions + jitterArc + 5 anims, TOUS À CHAQUE IMAGE, < 20 % → ` +
    `${total.toFixed(1)} µs sur ${IMAGE_US.toFixed(0)} µs`
)

const keys = lesMesures.get('objectKeys') ?? 0
const mw = lesMesures.get('updateMatrixWorld') ?? 0
console.log(
  `\n  → Object.keys ressort ${keys.toFixed(3)} µs par coureur et par image ; ` +
    `×5 coureurs et ×60 s, cela fait ${(keys * 5 * 60).toFixed(1)} µs par seconde.`
)
console.log(
  `  → updateMatrixWorld ressort ${mw.toFixed(2)} µs par coureur et par image ; ` +
    `le rendu va en faire un second, sur la scène entière.\n`
)

console.log(ko === 0 ? '\n✅ TOUT PASSE\n' : `\n❌ ${ko} ÉCHEC(S)\n`)
process.exit(ko === 0 ? 0 : 1)
