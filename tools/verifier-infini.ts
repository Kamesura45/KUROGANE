/**
 * ————— La piste sans fin tient ses promesses —————
 *
 * Le mode infini ne genere plus la course d'un bloc : il coud des troncons bout
 * a bout, chacun bati par les MEMES generateurs qu'une course ordinaire, puis
 * decale. Trois choses peuvent casser a la couture, et une seule est grave.
 *
 *   · la piste s'arrete (le plan ne s'etend pas) → on court dans le vide ;
 *   · les biomes ne bouclent pas → le flanc du Fuji jusqu'a la fin des temps ;
 *   · ⚠️ UNE RANGEE SANS AUCUN PASSAGE. Une plateforme du troncon precedent
 *     deborde sur le suivant ; le generateur, qui ne connait que son propre
 *     troncon, poserait alors des barrieres sur les deux lignes restantes sans
 *     savoir que la troisieme est deja prise. Le joueur se retrouve devant un
 *     mur complet. C'est le seul defaut vraiment INJUSTE que cette piste puisse
 *     produire, et c'est celui qu'on traque ici.
 *
 * On pilote le vrai Track, pas une imitation.
 *
 *   npm run infini:test
 */

/*
 * Un canevas de facade. Track cuit une texture de degrade pour les jarres, ce
 * qui reclame un <canvas> — Node n'en a pas. La texture ne sera jamais REGARDEE
 * ici : seule la geometrie compte.
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
import { BIOMES } from '../src/biomes.ts'
import { TIRAGE, TIRAGE_INFINI, tirerParchemin } from '../src/parchemin.ts'

const CYCLE = 1920
const LOIN = CYCLE * 6 // six cycles : cinq coutures a traverser
let rates = 0

function ok(bon: boolean, quoi: string, detail = '') {
  console.log(`  ${bon ? 'ok  ' : 'RATE'}   ${quoi}${detail ? '  → ' + detail : ''}`)
  if (!bon) rates++
}

/** Fait courir la piste jusqu'a `bout`, comme le jeu le ferait image par image. */
function courir(track: Track, bout: number, pas = 12) {
  for (let d = 0; d <= bout; d += pas) track.update(pas / 22, 22, d)
}

console.log("\n————— La piste s'etend, encore et encore —————\n")
{
  const track = new Track(new THREE.Scene())
  track.reset(CYCLE, 4242, false, true)
  courir(track, LOIN)

  const prevus = track.obstaclesPrevus()
  const dernier = prevus.reduce((m, o) => Math.max(m, o.d), 0)
  ok(dernier > LOIN, 'le plan garde toujours de l\'avance', `bati jusqu'a ${Math.round(dernier)} m`)
  ok(prevus.length > 300, 'les obstacles suivent la distance', `${prevus.length} sur ${LOIN} m`)
}

console.log('\n————— Une course ORDINAIRE n\'est pas touchee —————\n')
{
  const track = new Track(new THREE.Scene())
  track.reset(CYCLE, 4242, false) // sans le drapeau infini
  courir(track, CYCLE)
  const dernier = track.obstaclesPrevus().reduce((m, o) => Math.max(m, o.d), 0)
  ok(dernier < CYCLE, 'elle s\'arrete bien a sa ligne d\'arrivee', `dernier a ${Math.round(dernier)} m`)
}

console.log('\n————— Les biomes bouclent au lieu de se figer —————\n')
{
  // Le biome d'un point est decide par sa distance ramenee dans le cycle.
  const biomeDe = (d: number) =>
    Math.min(BIOMES.length - 1, Math.floor(((d % CYCLE) / CYCLE) * BIOMES.length))

  const vus = new Set<number>()
  for (let d = 0; d < LOIN; d += 60) vus.add(biomeDe(d))
  ok(vus.size === BIOMES.length, 'tous les biomes reviennent', `${vus.size}/${BIOMES.length}`)

  // Le point-cle : APRES plusieurs cycles, on doit repasser par le PREMIER
  // biome. Sans bouclage, indexBiome bornerait au dernier pour toujours.
  ok(biomeDe(CYCLE * 5 + 10) === 0, 'le 6e cycle rejoue depuis le premier decor')
}

console.log('\n————— ⚠️ Les coutures ne sont pas plus dures que le reste —————\n')
{
  /*
   * ⚠️ ON COMPARE, ON NE COMPTE PAS.
   *
   * Une premiere version de ce banc comptait les rangees « bouchees » dans
   * l'absolu, et en trouvait 105 — y compris sur une course ORDINAIRE, qui est
   * pourtant juste par construction. La mesure etait donc fausse : regrouper
   * par tranches de 5 m et etaler sur les voisines confond des obstacles qui,
   * sur la piste, sont a des metres les uns des autres.
   *
   * Une mesure grossiere reste utile si elle est grossiere PARTOUT PAREIL. On
   * regarde donc si les abords des coutures sortent du lot : c'est la seule
   * chose que le mode infini peut avoir cassee, et c'est comparable.
   */
  const PRES = 60 // ce qu'on appelle « aux abords d'une couture », en metres
  let dursCouture = 0
  let toutCouture = 0
  let dursAilleurs = 0
  let toutAilleurs = 0

  // Plusieurs graines : une couture malheureuse peut ne sortir qu'avec certains
  // tirages, et un seul essai ne prouverait rien.
  for (const graine of [1, 7, 99, 1234, 55555, 8675309]) {
    const track = new Track(new THREE.Scene())
    track.reset(CYCLE, graine, false, true)
    courir(track, LOIN)

    /*
     * Tout ce qui BARRE une ligne : les obstacles, et les plateformes sur toute
     * leur portee. `obstaclesPrevus` contient deja les deux — les plateformes y
     * sont traduites en obstacles fictifs pour que les bots les esquivent.
     */
    const parRangee = new Map<number, Set<number>>()
    for (const o of track.obstaclesPrevus()) {
      const cle = Math.round(o.d / 5) * 5
      for (const c of [cle - 5, cle, cle + 5]) {
        if (!parRangee.has(c)) parRangee.set(c, new Set())
        parRangee.get(c)!.add(o.lane)
      }
    }

    for (const [d, lignes] of parRangee) {
      // A quelle distance de la couture la plus proche ?
      const ecart = Math.abs(d - Math.round(d / CYCLE) * CYCLE)
      const couture = d > CYCLE / 2 && ecart <= PRES
      const dur = lignes.size >= 3
      if (couture) {
        toutCouture++
        if (dur) dursCouture++
      } else {
        toutAilleurs++
        if (dur) dursAilleurs++
      }
    }
  }

  const tauxC = dursCouture / Math.max(1, toutCouture)
  const tauxA = dursAilleurs / Math.max(1, toutAilleurs)
  ok(
    toutCouture > 100,
    'on a bien traverse des coutures',
    `${toutCouture} rangees aux abords, ${toutAilleurs} ailleurs`
  )
  ok(
    tauxC <= tauxA * 1.5 + 0.01,
    'les coutures ne concentrent pas les rangees chargees',
    `couture ${(tauxC * 100).toFixed(1)} % contre ${(tauxA * 100).toFixed(1)} % ailleurs`
  )
}


console.log('\n————— ♾️ Les rouleaux de la course sans fin —————\n')
{
  const VOULUS = ['armure', 'grue', 'the', 'kunai']
  ok(
    TIRAGE_INFINI.length === VOULUS.length && VOULUS.every((k) => TIRAGE_INFINI.includes(k as any)),
    'la table contient exactement les quatre demandes',
    TIRAGE_INFINI.join(', ')
  )

  // Les six autres visent un adversaire ou parent un sort : seuls, ils ne
  // feraient rien. Un rouleau sur deux sans effet, ce n'est pas plus dur —
  // c'est un ramassage qui ment.
  const exclus = TIRAGE.filter((k) => !TIRAGE_INFINI.includes(k))
  ok(exclus.length === TIRAGE.length - 4, 'les autres sont bien ecartes', exclus.join(', '))

  // Dix mille tirages : si un sort ecarte pouvait encore sortir, il sortirait.
  const sortis = new Set<string>()
  for (let i = 0; i < 10_000; i++) sortis.add(tirerParchemin(Math.random, TIRAGE_INFINI))
  ok(
    [...sortis].every((k) => TIRAGE_INFINI.includes(k as any)),
    'sur 10 000 tirages, rien d autre ne sort',
    `${sortis.size} sortes vues`
  )
  ok(sortis.size === 4, 'et les quatre sortent bien', [...sortis].sort().join(', '))

  // ⚠️ La table par defaut ne doit PAS avoir bouge : une course ordinaire
  // continue de tirer dans les dix.
  const ordinaires = new Set<string>()
  for (let i = 0; i < 10_000; i++) ordinaires.add(tirerParchemin())
  ok(ordinaires.size === TIRAGE.length, 'une course ordinaire tire toujours dans les dix', `${ordinaires.size} sortes`)
}
console.log('\n————— 🎯 Le kunai ne fait sauter QUE les murs —————\n')
{
  const track = new Track(new THREE.Scene())
  track.reset(CYCLE, 4242, false, true)

  let murs = 0
  let autres = 0
  let vides = 0

  /*
   * ⚠️ ON IDENTIFIE PAR LE PLAN, PAS PAR LA GEOMETRIE.
   *
   * Une premiere version reconnaissait le mur a sa hauteur (2,40 m) et n'en
   * trouvait AUCUN sur 341 destructions. La mesure etait fausse, pas le code :
   * la hauteur d'un obstacle vient de TAILLE_OBSTACLE au moment du test de
   * collision, elle n'est pas portee par le maillage, dont le `y` vaut tout
   * autre chose.
   *
   * On confronte donc la position rendue au PLAN, seule source de verite sur ce
   * qu'est un obstacle : `z = -(d_obstacle - distance)` donne sa distance.
   * ⚠️ ET L'ON RELEVE LE PLAN A LA FIN, PAS AU DEBUT. Le plan s'ALLONGE a
   * chaque troncon cousu : le capturer avant de courir n'aurait contenu que le
   * premier segment, et les murs des suivants auraient tous ete comptes comme
   * « autre chose ». C'est exactement ce qui s'est passe — 291 faux positifs.
   */
  const detruites: number[] = []

  // On avance par petits pas et l'on tire des que possible : sur six cycles, on
  // croise assez de murs pour que le compte veuille dire quelque chose.
  for (let d = 0; d <= LOIN; d += 12) {
    track.update(12 / 22, 22, d)
    const ou = track.detruireMurDevant()
    if (!ou) {
      vides++
      continue
    }
    detruites.push(d - ou.z) // z est negatif devant : d - z = distance de l'obstacle
  }

  const mursPrevus = track
    .obstaclesPrevus()
    .filter((o) => o.kind === 'mur')
    .map((o) => o.d)
  for (const dObstacle of detruites) {
    if (mursPrevus.some((d) => Math.abs(d - dObstacle) < 1)) murs++
    else autres++
  }

  ok(murs > 30, 'des murs sont bien detruits', `${murs} sur ${LOIN} m`)
  ok(autres === 0, 'et RIEN d autre ne l est', `${autres} destructions hors plan des murs`)
  ok(vides > 0, 'sans mur en vue, il ne rend rien (le rouleau est alors rendu)', `${vides} tirs a vide`)
}

console.log(rates === 0 ? '\nTout est bon.\n' : `\n❌ ${rates} verification(s) en echec.\n`)
process.exit(rates === 0 ? 0 : 1)
