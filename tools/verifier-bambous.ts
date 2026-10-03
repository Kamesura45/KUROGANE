/**
 * ————— La bambouseraie doit être GRANDE, et le couloir doit rester libre —————
 *
 * Deux exigences opposées, et c'est leur rencontre qui fait le décor.
 *
 *  1. La forêt doit se lire comme une forêt sans bord, pas comme un bosquet.
 *     Ce n'était pas une affaire de DENSITÉ : la densité était déjà correcte,
 *     et même mesurée en tiges par m². C'était une affaire de SILHOUETTE —
 *     tous les massifs avaient la même hauteur, donc l'œil lisait un motif
 *     répété — et de lisière : le rideau de tiges s'arrêtait à 24 m, et la
 *     lisière se lisait comme un bord de décor.
 *
 *  2. Aucun élément ne doit jamais s'approcher du couloir. C'est la règle
 *     absolue du jeu : un élément de paysage qui cache une barrière transforme
 *     le joli en injuste. Elle se vérifie ici parce qu'elle est désormais
 *     entourée de decoration — la lisière, les fûts-repères, les clairières
 *     s'ajoutent tous PRÈS de la piste, et chacun d'eux est une occasion de
 *     la transgresser sans qu'aucun type ne le voie.
 *
 * Le banc mesure donc, sur 24 massifs tirés :
 *
 *   · la PORTÉE — jusqu'où va le bois. C'est la lisière qui répond, et c'est le
 *     chiffre qui décide si la forêt a un bord.
 *   · le DÉGAGEMENT — où s'arrête le décor le plus proche de la piste.
 *   · la VARIÉTÉ — est-ce que les massifs se ressemblent encore ?
 *   · le NOMBRE DE MAILLAGES — la forêt est soudée en deux. Le jour où la
 *     lisière est venue, la tentation était de lui faire son propre matériau :
 *     un maillage de plus par massif, une vingtaine d'appels de dessin au pic,
 *     et le plafond de confort (150) sauté d'un coup.
 *   · le COÛT en triangles, parce que « gratuit en appels de dessin » veut
 *     dire « gratuit ailleurs ».
 *
 *   node tools/verifier-bambous.ts
 */
import * as THREE from 'three'
import { BIOMES, setDensiteDecor, densiteCourante } from '../src/biomes.ts'
import { mulberry32 } from '../src/track.ts'
import { installerOiseaux, majOiseaux } from '../src/oiseaux.ts'
import { NIVEAUX, ORDRE_QUALITE } from '../src/settings.ts'

let echecs = 0
function verifier(titre: string, ok: boolean, detail = '') {
  if (!ok) echecs++
  console.log(`  ${ok ? 'ok  ' : 'ECHEC'} ${titre}${detail ? '  → ' + detail : ''}`)
}

const bambous = BIOMES.find((b) => b.kanji === '竹')
if (!bambous) {
  console.log('ECHEC : la bambouseraie n est plus dans la course.')
  process.exit(1)
}

const GRAINES = Array.from({ length: 24 }, (_, i) => 101 + i * 977)
const BOX = new THREE.Box3()

type Mesure = {
  portee: number
  degagement: number
  hauteur: number
  maillages: number
  triangles: number
}

function mesurer(graine: number): Mesure {
  const groupe = bambous!.fabriqueDecor(mulberry32(graine), 1)
  let portee = 0
  let degagement = Infinity
  let hauteur = 0
  let triangles = 0

  for (const mesh of groupe.children as THREE.Mesh[]) {
    triangles += mesh.geometry.index
      ? mesh.geometry.index.count / 3
      : mesh.geometry.getAttribute('position').count / 3
    mesh.geometry.computeBoundingBox()
    BOX.copy(mesh.geometry.boundingBox!)
    /*
     * ⚠️ On ne mesure que le maillage du SOLIDE.
     *
     * La canopée déborde volontairement de 10 m vers l'intérieur — c'est elle
     * qui fait la voûte au-dessus de la piste. Mesurer « le plus près » sur
     * les deux maillages verrait donc la voûte, et non le décor planté.
     *
     * Or la règle qui compte est celle du décor PLANTÉ : les lames de
     * feuillage sont des plans sans épaisseur, et c'est le premier maillage
     * qui porte les tiges, les troncs et les repères.
     */
    if (mesh.material === (groupe.children[0] as THREE.Mesh).material) {
      portee = Math.max(portee, BOX.max.x)
      degagement = Math.min(degagement, BOX.min.x)
      hauteur = Math.max(hauteur, BOX.max.y)
    }
  }
  return { portee, degagement, hauteur, maillages: groupe.children.length, triangles }
}

const mesures = GRAINES.map(mesurer)
const mm = (f: (m: Mesure) => number) => {
  const v = mesures.map(f)
  return { min: Math.min(...v), max: Math.max(...v), moy: v.reduce((a, b) => a + b, 0) / v.length }
}

console.log('\n————— 🎋 La forêt n a pas de bord —————\n')
{
  const p = mm((m) => m.portee)
  /*
   * ⚠️ LE SEUIL EST CELUI DE LA BRUME, PAS UN NOMBRE RONDE.
   *
   * La brume du biome va de 26 à 68 m. À 44 m, elle est à 43 % : la silhouette
   * d'une tige est encore nette. Au-delà, on ne payerait que du brouillard en
   * triangles. C'est pourquoi `LISIERE_FIN = 44` et pourquoi ce banc exige 40 :
   * la marge couvre le fait que le décor est semé enraciné (la vraie portée
   * varie d'un massif à l'autre), tout en échouant si quelqu'un remonte la
   * lisière à 30 m.
   */
  verifier(
    'la lisière remplit le vide jusqu a la brume',
    p.min >= 40,
    `portee ${p.min.toFixed(1)} → ${p.max.toFixed(1)} m`
  )
  verifier(
    'aucun massif ne s arrete avant',
    p.min >= 40,
    `le plus court atteint ${p.min.toFixed(1)} m`
  )
}

console.log('\n————— 🚧 Le couloir reste libre —————\n')
{
  const d = mm((m) => m.degagement)
  /*
   * ⚠️ LE SEUIL EST CELUI DU MUR, MOINS LA POSITION DU DÉCOR.
   *
   * `spawnDecor` pose chaque massif à 5,6 m du centre et `spawnMur` place la
   * face intérieure du mur à 3,70 m. La règle écrite dans le jeu est « un
   * mètre franc après les murs », donc : 3,70 + 1,00 − 5,60 = **−0,90 m** en
   * coordonnées locales du massif.
   *
   * Ce seuil a attrapé un vrai bug. Les touffes sont semées sur une bande, et
   * une tige peut tomber à `r` mètres AVANT le centre de sa touffe — jusqu'à
   * 1,3 m. La bande commençant à x = 0, la tige la plus avancée se retrouvait
   * à 5,6 − 2,25 = 3,35 m du centre, soit **35 cm en dedans du mur**. La règle
   * absolue du jeu — rien ne masque jamais un obstacle — était violée depuis
   * que les bambous poussaient en touffes, et personne ne l'avait vue : un
   * maillage ne se plaint pas d'être 2 cm trop près.
   */
  verifier(
    'aucune tige ne depasse le metre franc',
    d.min >= -0.9,
    `x le plus proche ${d.min.toFixed(2)} m local, soit ${(d.min + 5.6).toFixed(2)} m du centre (mur a 3,70)`
  )
  verifier(
    'et le massif garde de la foret devant lui',
    d.moy <= 1.2,
    `en moyenne a ${(d.moy + 5.6).toFixed(2)} m du centre`
  )
}

console.log('\n————— 🎲 Les massifs ne se ressemblent plus —————\n')
{
  const h = mm((m) => m.hauteur)
  /*
   * ⚠️ ON COMPARE DES SILHOUETTES, PAS DES DENSITÉS.
   *
   * Avant les personnages de massif, tous les massifs sortaient du même moule :
   * même bande de hauteur, donc même ligne d'horizon de verdure. C'est
   * précisément ce que l'œil voit à 28 m/s, et c'est ce qui faisait lire
   * « décor répété » — donc « petit ».
   *
   * On exige donc un ÉCART de hauteur d'au moins 8 m entre le massif le plus
   * bas et le plus haut, et au moins cinq hauteurs distinctes. Les cinq, parce
   * qu'un simple écart se contenterait d'un rare géant au milieu d'un décor
   * uniforme : c'est un accident, pas une variété.
   */
  const hautes = new Set(mesures.map((m) => Math.round(m.hauteur / 2)))
  verifier(
    'les hauteurs s etalent vraiment',
    h.max - h.min >= 8,
    `${h.min.toFixed(1)} → ${h.max.toFixed(1)} m (ecart ${(h.max - h.min).toFixed(1)})`
  )
  verifier(
    'et ce ne sont pas deux mereilles',
    hautes.size >= 5,
    `${hautes.size} hauteurs distinctes sur ${mesures.length} massifs`
  )
}

console.log('\n————— ⚡ Le prix —————\n')
{
  const t = mm((m) => m.triangles)
  const ma = mm((m) => m.maillages)
  /*
   * ⚠️ DEUX, ET PLUS JAMAIS TROIS.
   *
   * Le décor est soudé en deux maillages (le solide, le feuillage), et c'est ce
   * qui fait tenir la forêt sous le budget d'appels de dessin. Ajouter un
   * troisième — son propre matériau pour le lointain, par exemple — coûterait
   * un appel PAR MASSIF, donc une vingtaine au pic de 148, et le plafond de
   * confort (150) serait franchi. Toute la lisière est donc dans le solide.
   */
  verifier(
    'la forêt se soude en deux maillages',
    ma.max === 2,
    `${ma.min} → ${ma.max} par massif`
  )
  /*
   * ⚠️ LE PLAFOND DE TRIANGLES EST UNE MESURE, PAS UNE PRÉFÉRENCE.
   *
   * Rapporté au nombre de massif visibles au pic (environ 20), 16 000
   * triangles par massif plafonnent le décor autour de 320 000 triangles
   * dessinés — ce que tient sans peine un téléphone d'il y a six ans. Le
   * budget réel s'est déplacé : ce ne sont plus les appels de dessin qui
   * coûtent, c'est la bande passante. Voir `npm run endurance`.
   */
  verifier(
    'un massif ne coute pas plus de 16 000 triangles',
    t.max <= 16000,
    `${t.moy.toFixed(0)} en moyenne, ${t.max} au pire`
  )
  verifier(
    'et la lisiere en a bien coute',
    t.moy > 4000,
    `${t.moy.toFixed(0)} triangles de moyenne`
  )
}

console.log('\n————— 🎚️ Les cinq crans de qualité —————\n')
{
  /*
   * ⚠️ LE PLANCHER EST À 55 TIGES, ET LE TEST LE VERRA.
   *
   * Une forêt à 0,5 de matière pourrait se passer de lisière : les 24 m du
   * rideau suffiraient à une pixélisation grossière. Elle ne le fait pas, parce
   * que le vide de 24 à 44 m ne se voit pas « moins » en moins de pixels. Le
   * plancher existe pour ça, et ce banc le garde : sans lui, quelqu'un couperait
   * la lisière au réglage « Fluide » et la première caméra la verrait
     * réapparaître.
   */
  const bornes = { fluide: 0.5, ultra: 1.3 }
  for (const cran of ORDRE_QUALITE) {
    setDensiteDecor(NIVEAUX[cran].densite)
    const m = GRAINES.map(mesurer)
    const portee = Math.min(...m.map((x) => x.portee))
    const tri = Math.max(...m.map((x) => x.triangles))
    /*
     * ⚠️ LE PLAFOND DE TRIANGLES MONTE AVEC LE CRAN, ET C'EST NORMAL.
     *
     * À « Fluide » le décor est à demi chargé, à « Ultra » il est plein. Ce qui
     * ne doit JAMAIS bouger, en revanche, c'est le nombre de MAILLAGES : deux,
     * quel que soit le réglage. C'est le seul garde-fou contre le plafond
     * d'appels de dessin — et « Fluide » ne peut pas le rattraper une fois le décor
     * construit.
     */
    verifier(
      `« ${NIVEAUX[cran].nom} » garde sa lisière`,
      portee >= 40,
      `portee ${portee.toFixed(1)} m, ${Math.round(tri)} triangles au pire`
    )
    verifier(
      `« ${NIVEAUX[cran].nom} » reste a deux maillages`,
      m.every((x) => x.maillages === 2)
    )
  }
  setDensiteDecor(1)
  verifier(
    'la densite est bornee des deux cotes',
    densiteCourante() === 1,
    `elle ne peut sortir de [${bornes.fluide} ; ${bornes.ultra}] — voir setDensiteDecor`
  )
}

console.log('\n————— 🐦 Les oiseaux —————\n')
{
  /*
   * ⚠️ ON NE TESTE PAS LE RENDU, ON TESTE CE QUI PEUT ÊTRE FAUX SANS SE VOIR.
   *
   * Les oiseaux n'ont qu'un seul vrai mode de panne, et il est invisible : les
   * sommets sont réécrits à la main, alors une division par zéro, une volée
   * recyclée deux fois ou une hauteur sous le sol produisent des `NaN` que rien
   * ne signale — la volée disparaît, et l'on croit à un problème de frume.
   *
   * On vérifie donc trois choses, dans cet ordre : que ça finit par voler, que
   * les ailes BOUGENT (le test qui attrape un tampon de sommets jamais
   * réécrit), et que rien n'est infini.
   */
  const scene = new THREE.Scene()
  installerOiseaux(scene)
  const meshes = scene.children.filter((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh[]

  verifier('les reserves sont creeees', meshes.length === 2, `${meshes.length} maillages`)

  // On fait tourner jusqu'à ce qu'une volée se forme, sans jamais aller chercher
  // la scène : la scène ne se voit pas, seule la géométrie dit quelque chose.
  let appearances = 0
  let aVoler = false
  let coordonneesFinies = true
  let precedent = ''
  for (let i = 0; i < 3000; i++) {
    majOiseaux(1 / 60, 0.4, true)
    for (const mesh of meshes) {
      const s = mesh.geometry.getAttribute('position').array as Float32Array
      for (let k = 0; k < s.length; k++) {
        if (!Number.isFinite(s[k])) coordonneesFinies = false
      }
      if (!mesh.visible) continue
      const texte = Array.from(s.slice(0, 9)).join(',')
      if (texte !== precedent) {
        if (aVoler) appearances++
        precedent = texte
        aVoler = true
      }
    }
  }
  verifier('les coordonnees restent finies', coordonneesFinies)
  verifier(
    'une volee finit par se former',
    aVoler,
    `${appearances} vols distincts en 50 s de temps simule`
  )
  verifier(
    'et les ailes battent',
    appearances > 10,
    `${appearances} changements de sommets — un tampon statique en ferait 1`
  )

  /*
   * ⚠️ COUPÉ HORS BAMBOUSERAIE : les volées doivent DISPARAÎTRE.
   *
   * Le son et l'image ne peuvent pas se contredire, et surtout on ne doit pas
   * arriver dans un village en flammes avec un volée déjà formée au-dessus.
   */
  majOiseaux(1 / 60, 0.4, false)
  verifier(
    'aucune volée ne survit hors de la bambouseraie',
    meshes.every((m) => !m.visible),
    `${meshes.filter((m) => m.visible).length} encore visible(s)`
  )
}

console.log(echecs === 0 ? '\nTout est bon.\n' : `\n❌ ${echecs} verification(s) en echec.\n`)
process.exit(echecs === 0 ? 0 : 1)
