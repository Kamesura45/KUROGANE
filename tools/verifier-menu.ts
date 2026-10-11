/**
 * ————— Le menu est un FOND DE COULEUR, pas une piste —————
 *
 * ⚠️ ÇA NE SE VOIT PAS À L'ŒIL, ET C'EST JUSTEMENT LE PROBLÈME.
 *
 * Une capture d'écran ne distingue pas « un fond de couleur » de « une scène
 * presque vide ». Les deux sont un aplat sombre. On ne peut donc pas dire « ça
 * change presque rien » — ni « ça marche » — sans COMPTER.
 *
 * Et le piège est dans les deux sens : retirer le terrain à la main marche
 * jusqu'au premier décor recyclé, puisque `spawnDecor` remet `visible = true`
 * à chaque réutilisation. Les massifs réapparaissent alors un par un, en trois
 * secondes, sans qu'aucune ligne de code ne soit modifiée. C'est exactement le
 * genre de régression qu'un testAttrape et que personne ne voit.
 *
 * Ce banc fait donc l'inverse de `mesurer-scene` : il ne compte pas ce qu'il y a
 * de TROP à la course, il exige qu'au MENU il n'y ait RIEN — et que tout
 * revienne d'un coup quand la course repart.
 *
 *   node tools/verifier-menu.ts
 */
/*
 * ⚠️ Le même shimming que `mesurer-scene.ts` : les textures de sol se peintent
 * dans un canvas, et il n'y a pas de navigateur ici. Sans ce faux `document`,
 * `Track` plante sur `BIOMES[0].texSol()` — c'est-à-dire sur le premier bout de
 * décor, très loin du terrain.
 */
;(globalThis as any).document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      fillRect() {},
      set fillStyle(_v: unknown) {},
    }),
  }),
}

import * as THREE from 'three'
import { Track } from '../src/track.ts'

let echecs = 0
function verifier(titre: string, bon: boolean, detail = '') {
  if (!bon) echecs++
  console.log(`  ${bon ? 'ok  ' : 'ECHEC'} ${titre}${detail ? '  → ' + detail : ''}`)
}

const scene = new THREE.Scene()
const track = new Track(scene)

/** Les maillages réellement dessinés — `visible` ne suffit pas, un parent peut cacher. */
function visibles() {
  let n = 0
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      if (!p.visible) return
    }
    n++
  })
  return n
}

console.log('\n————— 🎨 Au menu —————\n')
let reference = 0
{
  /*
   * On part du terrain ALLUMÉ pour avoir une référence, puis on l'éteint. Sans
   * cette référence, « 0 maillage » ne prouverait rien : une scène qui n'a jamais
   * rien eu donnerait le même chiffre.
   */
  track.setTerrain(true)
  track.update(1 / 60, 0, 0)
  reference = visibles()
  verifier('le terrain existe bel et bien', reference > 0, `${reference} maillages visibles`)

  track.setTerrain(false)
  track.update(1 / 60, 0, 0)
  const apres = visibles()
  /*
   * ⚠️ ZÉRO, ET PAS « PRESQUE ZÉRO ».
   *
   * Un maillage oublié ici se lit à l'écran comme un décor qui n'a pas été
   * coupé — un bout de sol qui dépasse sous le menu, une barrière plantée au
   * milieu du titre. Le test doit donc être exact, sinon il laisse passer
   * exactement ce qu'il cherche.
   */
  verifier(
    'le menu ne dessine aucun maillage',
    apres === 0,
    `${apres} encore visible(s) sur ${reference}`
  )

  /*
   * ⚠️ ET LE FOND, LUI, DOIT RESTER.
   *
   * C'est le but de l'opération : pas « une scène vide », mais UN FOND DE
   * COULEUR. Un `background` à null donnerait le noir du navigateur — et le
   * noir, c'est l'absence de fond, pas une couleur choisie.
   */
  verifier(
    'le fond de scène reste une couleur',
    scene.background instanceof THREE.Color,
    scene.background ? 'couleur posée' : 'AUCUN fond — écran noir'
  )
}

console.log('\n————— 🔄 Quand la course repart —————\n')
{
  track.setTerrain(true)
  track.update(1 / 60, 0, 0)
  const revenu = visibles()
  /*
   * ⚠️ LE MÊME CHIFFRE QU'AU DÉPART, PAS UN DE PLUS.
   *
   * `setTerrain(true)` ne doit rien créer : les maillages sont déjà dans la scène,
   * ils étaient seulement masqués. Un surplus signifierait qu'on a semé deux
   * fois — ce qui coûterait deux fois plus d'appels de dessin, sans qu'on le voie
   * (le décor serait juste plus dense).
   */
  verifier(
    'le terrain revient en un coup',
    revenu === reference,
    `${revenu} contre ${reference} au départ`
  )
}

console.log(echecs === 0 ? '\nTout est bon.\n' : `\n❌ ${echecs} verification(s) en echec.\n`)
process.exit(echecs === 0 ? 0 : 1)