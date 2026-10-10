/**
 * ————— 🕳️ Ce qu'aucune mesure existante ne montre —————
 *
 * `npm run endurance` chronomètre `Track.update`. Il ne voit donc rien de ce
 * qui se passe HORS de `Track.update` — et c'est précisément là que dorment
 * deux sujets que la boucle de jeu déclenche **à CHAQUE image**.
 *
 *   1. 🔥 LE FEU. `main.ts:5286` appelle `feuAmbiance()` à chaque image, dans
 *      TOUS les états (`main.ts:5272`). Chaque appel programmaid une consigne
 *      sur l'AudioParam de la nappe : 60 par seconde, indéfiniment — au menu,
 *      au silence, et sur les deux tiers d'une course normale où le feu ne
 *      brûle pas. Le son entendu ne changeait pas ; la file d'automatisation,
 *      elle, ne cessait de grossir.
 *
 *   2. 📜 LES PLANS. Ils grandissent à chaque tronçon cousu en sans-fini
 *      (333 → 1 879 entrées sur 20 km, relevé par `npm run endurance`), et on
 *      affirme qu'ils ne se lisent qu'à coups de curseurs. C'est vrai des bots
 *      et de leurs rangées — mais CINQ fonctions les reparcourent entiers. Ce
 *      banc les chronomètre sur les PLANS RÉELS d'une piste de 20 km, et dit
 *      combien elles coûteraient appelées à CHAQUE image.
 *
 * On ne corrige que ce que la mesure condamne : c'est la règle de la maison.
 *
 *   npm run fuites:test
 */

/*
 * ⚠️ EN PREMIER, et rien au-dessus. Ce module pose `window`, `document` et
 * `addEventListener`, dont `sfx.ts` a besoin DÉJÀ pendant son évaluation. Les
 * imports sont hoistés par-dessus le corps du fichier, mais leur évaluation
 * suit l'ordre d'écriture. Voir `tools/faux-navigateur.ts` au complet.
 */
import './faux-navigateur.ts'
import { combienReprogrammes, remettreCompteur } from './faux-navigateur.ts'

import * as THREE from 'three'
import { Track, COURSE_LENGTH } from '../src/track.ts'
import { BIOMES } from '../src/biomes.ts'
import { LANES } from '../src/player.ts'
import { feuAmbiance, prechauffeFeu } from '../src/sfx.ts'

const FPS = 60
const DT = 1 / FPS
const VITESSE = 22 // m/s, un rythme de course soutenu
/** `DEGATS_MAX`, tel que `main.ts` le porte : cinq obstacles encaissés en ∞. */
const DEGATS_MAX = 5
/** Le budget d'une image à 60 Hz, en microsecondes. */
const IMAGE_US = 1_000_000 / FPS

const scene = new THREE.Scene()
const track = new Track(scene)

let ko = 0
function verifie(cond: boolean, quoi: string) {
  console.log(`  ${cond ? 'OK   ' : 'ÉCHEC'} ${quoi}`)
  if (!cond) ko++
}

/* ═══════════════════════ 🔥 1. Le brasier ═══════════════════════ */

/*
 * L'intensité que `main.ts:5285-5286` CALCULE, refaite à l'identique.
 *
 * On ne l'importe pas de `main.ts` : ce module emporterait tout le jeu —
 * canevas, HUD, réseau, `requestAnimationFrame` — et ne tournerait pas sous
 * Node. La formule est recopiée, et le banc la compare à `BIOMES` pour ne
 * jamais deviner quel décor porte le feu.
 */
function intensite(distance: number, degats: number, infini: boolean, enCourse: boolean) {
  const biomeIci = enCourse ? BIOMES[track.biomeA(distance)] : null
  const poursuite = infini && enCourse ? 0.25 + 0.75 * (degats / DEGATS_MAX) : 0
  return Math.max(poursuite, biomeIci?.ambiance === 'feu' ? 1 : 0)
}

/** Une image de la boucle de jeu : `main.ts:5286`, au complet. */
function image(distance: number, degats: number, infini: boolean, enCourse: boolean) {
  feuAmbiance(intensite(distance, degats, infini, enCourse), DT)
}

/**
 * Les segments sont enchaînés SANS remettre le compteur à zéro : c'est une
 * SEULE session de jeu, le feu lui-même ne redémarre jamais.
 */
let vu = 0
let toutesImages = 0
function segment(titre: string, images: number): number {
  const maintenant = combienReprogrammes()
  const n = maintenant - vu
  vu = maintenant
  toutesImages += images
  console.log(
    `  · ${titre.padEnd(36)} ${String(images).padStart(6)} images → ` +
      `${String(n).padStart(4)} programmation${n === 1 ? '' : 's'}` +
      `   (à plat : ${images})`
  )
  return n
}

console.log(`\n— 🔥 Le feu, sur une session entière à ${FPS} images/s —\n`)
remettreCompteur()
vu = 0
toutesImages = 0

// — L'accueil : 30 s de silence, avant même que le contexte existe.
track.reset(COURSE_LENGTH, 1234, true, false)
let d = 0
let images = 0
for (let i = 0; i < 30 * FPS; i++) {
  image(0, 0, false, false)
  images++
}
const accueil = segment('accueil, avant la cuisson', images)

/*
 * — Le décompte, avec sa PRÉCHAUFFE —
 *
 * `main.ts:4362` appelle `prechauffeFeu()` UNE fois, gardé par `shadersPrets`.
 * Puis `enCourse` est vrai dès le décompte (`main.ts:5272`) et `distance` vaut
 * 0 : on est dans le village, l'intensité est 1.
 */
prechauffeFeu()
images = 0
for (let i = 0; i < 5 * FPS; i++) {
  image(0, 0, false, true)
  images++
}
const decompte = segment('décompte + préchauffe', images)

// — La course ordinaire : 1 920 m à 22 m/s, soit ~87 s.
d = 0
images = 0
while (d < COURSE_LENGTH) {
  image(d, 0, false, true)
  d += VITESSE * DT
  images++
}
const course = segment('course ordinaire de 1 920 m', images)
// — Retour au menu, 30 s : l'intensité retombe à 0 et doit s'y tenir.
images = 0
for (let i = 0; i < 30 * FPS; i++) {
  image(0, 0, false, false)
  images++
}
const menu = segment('retour au menu', images)

// — 20 km de sans fin, avec les dégâts qui montent (un tous les 4 km).
track.reset(COURSE_LENGTH, 1234, true, true)
d = 0
images = 0
while (d < 20000) {
  image(d, Math.min(DEGATS_MAX, Math.floor(d / 4000)), true, true)
  d += VITESSE * DT
  images++
}
const infini = segment('20 km de course sans fin', images)

const total = combienReprogrammes()
console.log(`\n  session complète : ${total} programmations sur ${toutesImages} images`)

console.log('\n————— Ce que la mesure dit —————')
verifie(accueil === 0, `au silence, l'accueil ne programme rien → ${accueil}`)
verifie(menu === 0, `au silence, le retour au menu ne programme rien → ${menu}`)
verifie(decompte <= 3, `la préchauffe coûte ses deux appels, pas une par image → ${decompte}`)
verifie(course <= 4, `la course ne paie que les entrées/sorties de village → ${course}`)
verifie(infini <= 30, `20 km de sans fin restent sous les 30 programmations → ${infini}`)
verifie(
  total < toutesImages / 100,
  `moins de 1 % des images paient une programmation : ` +
    `${total} sur ${toutesImages} — à plat, ce serait ${toutesImages}`
)

/* ═══════════════════════ 📜 2. Les plans ═══════════════════════ */

/*
 * On pousse la piste à 20 km pour que les plans aient leur taille RÉELLE en
 * fin de course sans fin — c'est le cas le plus défavorable, celui que
 * `npm run endurance` relève à 1 879 entrées.
 */
track.reset(COURSE_LENGTH, 1234, true, true)
d = 0
while (d < 20000) {
  d += VITESSE * DT
  track.update(DT, VITESSE, d)
}

const acces = track as unknown as {
  plan: unknown[]
  plateformePlan: unknown[]
  murPlan: unknown[]
  planBots: unknown[]
  plateformes: unknown[]
  murAvale(d: number, cote: number): boolean
}

console.log('\n— 📜 Les plans, chronométrés sur les PLANS RÉELS de 20 km —\n')
console.log(
  `  · plan d'obstacles ${acces.plan.length} · plateformes ${acces.plateformePlan.length}` +
    ` · murs ${acces.murPlan.length} · rangées de bots ${acces.planBots.length}` +
    ` · réserve de plateformes actives ${acces.plateformes.length}\n`
)

const ESSAIS = 5000

/** Chronomètre `appel` sur `ESSAIS` tirages couvrant toute la piste. */
function chronometre(cle: string, nom: string, appel: (i: number) => void): number {
  /*
   * ⚠️ UNE PASSE DE CHAUFFE, sinon le relevé mesure la COMPILATION du JIT et
   * non la fonction. Mesuré en retirant ce passage : `premierBarrage` rendait
   * 74 µs au premier lancer et 30 µs au suivant — un écart de ×2,4 entièrement
   * dû au warm-up. Un chiffre qui bouge d'un lancer à l'autre ne peut pas
   * servir de seuil.
   */
  for (let i = 0; i < ESSAIS; i++) appel(i)

  const debut = process.hrtime.bigint()
  for (let i = 0; i < ESSAIS; i++) appel(i)
  const us = Number(process.hrtime.bigint() - debut) / 1000 / ESSAIS
  const parImage = us
  const pourcent = (parImage / IMAGE_US) * 100
  console.log(
    `  ${nom.padEnd(24)} ${us.toFixed(3).padStart(9)} µs/appel   ` +
      `×60 → ${us.toFixed(3).padStart(8)} µs/image   ${pourcent.toFixed(3).padStart(7)} %`
  )
  lesMesures.set(cle, us)
  return us
}

const lesMesures = new Map<string, number>()

/*
 * Les cadences réelles, tirées des APPELS eux-mêmes dans `main.ts` :
 *
 *   supportSous   main.ts:4424 et 4895 — À CHAQUE image, sans condition.
 *                 C'est la référence : ce qui tourne vraiment à tous les coups.
 *   murA          main.ts:4818 — UNIQUEMENT si `player.surMur !== 0`.
 *   flancA        main.ts:4819 — même garde que `murA`, à la même ligne.
 *                 main.ts:2478/4007/4028 — au swipe, quelques fois par seconde.
 *   premierBarrage main.ts:4520 — PAR IMAGE seulement pendant le vol d'un portail.
 *                 main.ts:4457 — à chaque lancer de bot en onmyoji.
 *   murAvale      track.ts:1615 — à la pose d'une barrière, quelques fois par
 *                 seconde.
 *
 * On chronomètre donc chacune sur un tirage qui BALAIE toute la piste : ni le
 * meilleur cas (trouvé au premier essai) ni le pire (jamais trouvé sur une
 * ligne vide), la moyenne des deux.
 */
chronometre('supportSous', 'supportSous (réf.)', (i) => track.supportSous(LANES[i % 3], 0))
chronometre('murA', 'murA', (i) => track.murA((i / ESSAIS) * 20000, i % 2 ? 1 : -1))
chronometre('flancA', 'flancA', (i) => track.flancA(i % 3, i % 2 ? 1 : -1, 0))
chronometre('premierBarrage', 'premierBarrage', (i) => {
  const p = (i / ESSAIS) * 20000
  track.premierBarrage(i % 3, p, p + 4, 1.1)
})
// `murAvale` est privé : on y va par un cast, comme les bancs existants en
// font déjà pour les surcharges conditionnelles de `buildJarrePlan`.
chronometre('murAvale', 'murAvale (privé)', (i) => acces.murAvale((i / ESSAIS) * 20000, i % 2 ? 1 : -1))

const les4 = ['murA', 'flancA', 'premierBarrage', 'murAvale']
const tout = les4.reduce((s, k) => s + (lesMesures.get(k) ?? 0), 0)

console.log('\n————— Ce que la mesure dit —————')
verifie(
  tout < IMAGE_US * 0.05,
  `les 4 scans, TOUT APPELÉS à chaque image, restent sous 5 % d'une image → ` +
    `${tout.toFixed(1)} µs sur ${IMAGE_US} µs`
)
verifie(
  (lesMesures.get('premierBarrage') ?? 0) < IMAGE_US * 0.05,
  `premierBarrage pendant un vol de portail complet → ` +
    `${(lesMesures.get('premierBarrage') ?? 0).toFixed(1)} µs/image`
)

console.log(
  `\n  (les scans ne coûtent presque rien — mais ils ne tournent pas à chaque\n` +
    `   image non plus : voir les garde en regard des cadences ci-dessus. Un plan\n` +
    `   de ${acces.plan.length} entrées reste un objet à lire par CURSEUR, comme\n` +
    `   le font déjà les bots et leurs rangées.)`
)

console.log(ko === 0 ? '\n✅ TOUT PASSE\n' : `\n❌ ${ko} ÉCHEC(S)\n`)
process.exit(ko === 0 ? 0 : 1)
