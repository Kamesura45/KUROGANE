/**
 * Ce que la scene coute VRAIMENT, en pleine course.
 * On ne devine pas ce qu'il faut optimiser : on compte.
 */
;(globalThis as any).document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {}, set fillStyle(_v: unknown) {},
    }),
  }),
}

import * as THREE from 'three'
import { Track } from '../src/track.ts'
import { setDensiteDecor } from '../src/biomes.ts'
import { NIVEAUX, ORDRE_QUALITE, resoudreQualite, type Quality } from '../src/settings.ts'

const LONGUEUR = 1920

/**
 * ⚠️ LE CRAN SE LIT SUR LA LIGNE DE COMMANDE, ET IL EST OPTIONNEL.
 *
 * `node tools/mesurer-scene.ts` mesure « Maxi » — le réglage de référence, et le
 * seul qui serve de comparatif. `node tools/mesurer-scene.ts fluide` enchaîne
 * alors les cinq crans sur la même course et la même graine, ce qui est le seul
 * moyen de comparer : deux mesures prises sur des graines différentes ne
 * veulent rien dire.
 *
 * ⚠️ `settings.ts` lit `matchMedia` et `navigator` pour « Auto ». On n'appelle
 * donc jamais `resoudreQualite` ici — il n'y a pas de navigateur, et le banc ne
 * teste que les crans manuels.
 */
const arg = process.argv[2] as Quality | 'tous' | undefined
const crans: Exclude<Quality, 'auto'>[] =
  arg === 'tous' ? ORDRE_QUALITE : arg && arg in NIVEAUX ? [arg as Exclude<Quality, 'auto'>] : ['maxi']

for (const cran of crans) {
  const n = NIVEAUX[cran]
  setDensiteDecor(n.densite)
  mesurer(cran)
}

function mesurer(cran: Exclude<Quality, 'auto'>) {
  const n = NIVEAUX[cran]
  const scene = new THREE.Scene()
  const track = new Track(scene)
  track.setBudgetDecor(n.decor, false)
  track.reset(LONGUEUR, 1234)

function compter() {
  let objets = 0, meshes = 0, visibles = 0
  const mats = new Set<string>()
  const geos = new Set<string>()
  scene.traverse((o) => {
    objets++
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    meshes++
    // « visible » ne suffit pas : un parent cache masque ses enfants.
    let v = true
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) { v = false; break }
    if (v) visibles++
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) if (x) mats.add(x.uuid)
    if (m.geometry) geos.add(m.geometry.uuid)
  })
  return { objets, meshes, visibles, mats: mats.size, geos: geos.size }
}

console.log(`\n————— ${n.nom} : pixels ×${n.pixels}, décor ×${n.decor}, matière ×${n.densite} —————`)
console.log('  distance   objets   meshes   VISIBLES   materiaux   geometries')
const VITESSE = 30, PAS = 2
let d = 0, pire = 0, pireD = 0
const jalons = new Set([0, 240, 480, 720, 960, 1200, 1440, 1680, 1900])
while (d < LONGUEUR) {
  track.update(PAS / VITESSE, VITESSE, d)
  d += PAS
  const c = compter()
  if (c.visibles > pire) { pire = c.visibles; pireD = d }
  for (const j of jalons) {
    if (Math.abs(d - j) < PAS / 2) {
      console.log(
        `  ${String(Math.round(d)).padStart(6)} m  ${String(c.objets).padStart(7)}  ` +
        `${String(c.meshes).padStart(7)}  ${String(c.visibles).padStart(9)}  ` +
        `${String(c.mats).padStart(10)}  ${String(c.geos).padStart(11)}`
      )
      jalons.delete(j)
    }
  }
}
console.log(`\n  PIRE moment : ${pire} meshes visibles, vers ${Math.round(pireD)} m`)

const f = compter()
console.log(`\n  Materiaux distincts : ${f.mats}`)
console.log(`  Geometries distinctes : ${f.geos}`)
console.log(`  Meshes total dans la scene : ${f.meshes} (dont ${f.visibles} visibles)`)
console.log(
  `\n  → chaque mesh visible = au moins 1 appel de dessin.\n` +
  `    Les meshes caches coutent 0 a dessiner, mais restent en memoire.\n`
)
}
