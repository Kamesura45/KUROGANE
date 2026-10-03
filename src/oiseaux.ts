import * as THREE from 'three'

/**
 * 🐦 Les oiseaux de la bambouseraie — le seul decor ANIMÉ du jeu.
 *
 * Le son existait déjà (`oiseauxAmbiance`, dans sfx.ts) : la bambouseraie est le
 * seul biome à porter `ambiance: 'oiseaux'`. On entendait donc des chants dans un
 * ciel parfaitement vide, et c'est le genre de détail que l'on remarque sans
 * pouvoir le nommer.
 *
 * La règle qui décide de tout : **un vol n'apparaît que là où on l'entend.**
 * `maj` reçoit la même information que le son — le biome porte-t-il
 * `oiseaux` — donc l'image et le bruit ne peuvent pas se contredire. Ajouter
 * `oiseaux` à un autre biome suffirait à lui donner des oiseaux, sans écrire
 * une ligne de plus.
 *
 * ————— ⚠️ UNE VOLÉE = UN SEUL MAILLAGE —————
 *
 * Un oiseau en `Mesh` et `Group` pour animer ses ailes coûterait deux appels de
 * dessin pièce. Six oiseaux, deux volées : vingt-quatre appels, posés dans le
 * ciel, pour un décor qui ne fait rien d'autre que passer. La forêt est déjà à
 * 148 appels visibles, à deux doigts de la limite de confort (~150).
 *
 * On écrit donc à la main les sommets d'un seul `BufferGeometry` par volée : six
 * sommets par oiseau, deux triangles, et l'aile qui bat est un `y` qu'on
 * recalcule. Trente-six écritures par volée et par image — rien, en regard des
 * 4,7 µs d'une image de course.
 *
 * Le prix de ce choix, et il est réel : les oiseaux d'une même volée sont
 * dessinés dans un ordre fixe. À 30 m et plus, dans une brume de forêt, cela ne
 * se voit pas. C'est le seul endroit du jeu où l'on accepte ce genre de limite,
 * et elle est écrite ici pour qu'on ne la redécouvre pas en cherchant pourquoi
 * les oiseaux sont plats.
 */

/** Les oiseaux d'une volée. Six suffisent : au-delà, on lit un nuage. */
const PAR_VOL = 6
/** Volées en réserve. Deux en l'air suffisent ; au-delà, ça s'enchaîne. */
const RESERVE = 2

/** Un oiseau, en coordonnées de MONDE (le mesh, lui, reste à l'origine). */
interface Oiseau {
  x: number
  y: number
  z: number
  /** La vitesse horizontale : le sens de vol est donné par le signe. */
  vx: number
  vy: number
  /** L'orientation, figée au départ : un oiseau ne bat pas des ailes en virevoltant. */
  yaw: number
  /** Le déphasage des ailes — sans lui, toute la volée bat d'un seul coup. */
  phase: number
  taille: number
}

interface Vol {
  mesh: THREE.Mesh
  geo: THREE.BufferGeometry
  /** Les sommets, réutilisés : on n'alloue rien par image. */
  sommets: Float32Array
  oiseaux: Oiseau[]
  /** Le compteur de la prochaine volée. */
  dans: number
  visible: boolean
}

const vols: Vol[] = []

/**
 * ⚠️ `fog: true` est OBLIGATOIRE, et c'est ce qui fait la profondeur.
 *
 * Sans lui, un oiseau posé à 40 m dans une brume de forêt garde sa valeur
 * pleine : il se détache en tache noire sur un fond clair, et le joueur lit un
 * autocollant. Avec la brume, il s'éteint exactement comme le décor qu'il
 * traverse — donc il est à la bonne distance.
 */
const mat = new THREE.MeshBasicMaterial({
  color: 0x0f1510,
  side: THREE.DoubleSide,
  fog: true,
})

/** Le temps entre deux volées, en secondes. Aléatoire : jamais un rythme. */
const SILENCE = [7, 17] as const

export function installerOiseaux(scene: THREE.Scene) {
  for (let v = 0; v < RESERVE; v++) {
    const geo = new THREE.BufferGeometry()
    const sommets = new Float32Array(PAR_VOL * 6 * 3)
    /*
     * ⚠️ `DynamicDrawUsage` ET `frustumCulled = false`, ensemble.
     *
     * On réécrit des sommets : three.js ne le voit pas. Sans `DynamicDrawUsage`,
     * la carte graphique reçoit les mêmes sommets qu'au départ, depuis son
     * cache, et les oiseaux restent figés. Sans `frustumCulled = false`, three.js
     * ne recalcule pas la sphère d'encombrement et décide une fois pour toutes
     * que la volée est hors champ — alors qu'elle traverse l'écran justement
     * parce qu'elle bouge. Les deux oublis sont invisibles au typage, et le
     * second ne se voit qu'après une minute de jeu.
     */
    geo.setAttribute('position', new THREE.BufferAttribute(sommets, 3))
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    pos.setUsage(THREE.DynamicDrawUsage)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.frustumCulled = false
    mesh.visible = false
    scene.add(mesh)
    vols.push({ mesh, geo, sommets, oiseaux: [], dans: 0, visible: false })
  }
  // Le décor tourne déjà à vide derrière le menu : un oiseau doit pouvoir
  // s'y poser, sinon le premier vol de la partie serait une apparition.
  for (const v of vols) v.dans = 3 + Math.random() * 8
}

/** Envoie une volée. `sens` vaut -1 (vers la gauche) ou +1 (vers la droite). */
function lacher(vol: Vol, sens: number) {
  vol.oiseaux.length = 0
  /*
   * La formation : un meneur, et les autres en V derrière lui. L'écart de 1,7 m
   * est au-dessus de l'envergure (1,2 m) — les ailes ne se chevauchent pas, ce
   * qui se lirait comme une seule masse noire.
   */
  for (let i = 0; i < PAR_VOL; i++) {
    const rang = i === 0 ? 0 : Math.ceil(i / 2)
    const rang2 = i === 0 ? 0 : i % 2 === 0 ? 1 : -1
    vol.oiseaux.push({
      x: -sens * rang * 1.7 + (Math.random() - 0.5) * 1.1,
      y: rang2 * 1.3 + (Math.random() - 0.5) * 0.9,
      z: (Math.random() - 0.5) * 2.2,
      vx: sens * (7 + Math.random() * 4),
      vy: (Math.random() - 0.5) * 0.5,
      yaw: sens > 0 ? 0 : Math.PI,
      // ⚠️ Le déphasage est FORCÉ : deux oiseaux synchronisés se lisent comme
      // un seul objet qui se dédouble.
      phase: (i / PAR_VOL) * Math.PI * 2 + Math.random() * 0.7,
      taille: 0.75 + Math.random() * 0.5,
    })
  }
  /*
   * ⚠️ LA HAUTEUR EST AU-DESSUS DE LA CANOPÉE, TOUJOURS.
   *
   * Sous 9 m, un oiseau passe dans le feuillage : on le voit par intermittence,
   * ce qui se lit comme un défaut d'affichage. Au-dessus, il est dans l'air libre
   * — c'est le ciel qu'on lui veut, pas les feuilles.
   */
  const xDepart = -sens * (34 + Math.random() * 12)
  const yDepart = 14 + Math.random() * 9
  const zDepart = -(26 + Math.random() * 26)
  for (const o of vol.oiseaux) {
    o.x += xDepart
    o.y += yDepart
    o.z += zDepart
  }
  vol.mesh.visible = true
  vol.visible = true
}

/**
 * Fait vivre les volées. `dz` est le défilement du monde — le même `dz` que
 * celui qui emporte les pétales.
 *
 * ⚠️ `actif` n'est PAS « en course » : c'est « dans un biome qui porte
 * `oiseaux` ». Au menu, le décor est la bambouseraie, donc des oiseaux
 * traversent le ciel derrière le titre — et c'est bien. Partout ailleurs, ils
 * disparaissent, et c'est bien aussi : on ne voit pas d'oiseaux au-dessus du
 * village en flammes.
 */
export function majOiseaux(dt: number, dz: number, actif: boolean) {
  for (const vol of vols) {
    if (!actif) {
      // Hors bambouseraie : on les efface. `dans` est remis à zéro, sinon le
      // joueur arriverait au bois avec une volée déjà formée au-dessus de lui.
      if (vol.visible) {
        vol.visible = false
        vol.mesh.visible = false
        vol.oiseaux.length = 0
        vol.dans = 1 + Math.random() * 6
      }
      continue
    }

    if (!vol.visible) {
      vol.dans -= dt
      if (vol.dans <= 0) {
        lacher(vol, Math.random() < 0.5 ? -1 : 1)
        vol.dans = SILENCE[0] + Math.random() * (SILENCE[1] - SILENCE[0])
      }
      continue
    }

    let vivant = false
    for (let i = 0; i < vol.oiseaux.length; i++) {
      const o = vol.oiseaux[i]
      o.phase += dt * (5.5 + o.taille * 2)
      o.x += o.vx * dt
      o.y += (o.vy + Math.sin(o.phase * 0.5) * 0.35) * dt
      o.z += dz
      // Recyclés une fois passés derrière la caméra, ou trop loin de côté.
      if (o.z > 18 || Math.abs(o.x) > 62 || o.y < 4) {
        vol.oiseaux.splice(i, 1)
        i--
        continue
      }
      vivant = true
      ecrireOiseau(vol, i, o)
    }
    if (!vivant) {
      vol.visible = false
      vol.mesh.visible = false
    }
  }
}

/**
 * ⚠️ SIX SOMMETS PAR OISEAU, ET LE V EST FAIT DE DEUX TRIANGLES.
 *
 * L'axe du corps est `x` (le sens de vol), l'envergure est `z`, et le battement
 * ne touche qu'à `y` — l'extrémité d'aile monte et descend autour de l'axe.
 * C'est ce que l'on voit de profil, c'est-à-dire exactement ce qu'on voit ici :
 * les oiseaux traversent le champ de gauche à droite, donc on les regarde de
 * côté, donc c'est le profil qui compte.
 *
 * Le corps n'est qu'un fuseau de deux points (0,35 et −0,32) : à 30 m dans la
 * brume, un corps plus soigné se verrait moins bien qu'une aile bien battue.
 */
function ecrireOiseau(vol: Vol, index: number, o: Oiseau) {
  const s = vol.sommets
  const base = index * 18
  const c = Math.cos(o.yaw)
  const sn = Math.sin(o.yaw)
  const t = o.taille
  // Le battement : une oscillation par battement, l'extrémité d'aile montant et
  // descendant autour de l'axe du corps.
  const aile = Math.sin(o.phase) * 0.42 * t

  // (lx, ly, lz) → monde. Le repère est tourné du `yaw` : sans lui, les
  // oiseaux qui partent vers la gauche battraient à l'envers.
  const px = (lx: number, lz: number) => o.x + lx * c - lz * sn
  const pz = (lx: number, lz: number) => o.z + lx * sn + lz * c

  const nezX = px(0.35 * t, 0)
  const nezZ = pz(0.35 * t, 0)
  const qX = px(-0.32 * t, 0)
  const qZ = pz(-0.32 * t, 0)
  const aX = px(-0.02 * t, 0.62 * t)
  const aZ = pz(-0.02 * t, 0.62 * t)
  const bX = px(-0.02 * t, -0.62 * t)
  const bZ = pz(-0.02 * t, -0.62 * t)
  const ay = o.y + aile

  // Triangle 1 : nez → queue → aile droite
  s[base] = nezX; s[base + 1] = o.y; s[base + 2] = nezZ
  s[base + 3] = qX; s[base + 4] = o.y + 0.03 * t; s[base + 5] = qZ
  s[base + 6] = bX; s[base + 7] = ay; s[base + 8] = bZ
  // Triangle 2 : nez → aile gauche → queue
  s[base + 9] = nezX; s[base + 10] = o.y; s[base + 11] = nezZ
  s[base + 12] = aX; s[base + 13] = ay; s[base + 14] = aZ
  s[base + 15] = qX; s[base + 16] = o.y + 0.03 * t; s[base + 17] = qZ

  /*
   * ⚠️ LE FLAG `needsUpdate` EST OBLIGATOIRE, et il ne se devine pas.
   *
   * three.js n'envoie à la carte graphique que ce que le tampon de la
   * ATTRIBUTE le déclare. Sans cette ligne, le V bat… sur l'écran précédent, et
   * seulement si la carte a reçu quelque chose. Trois effets déjà écrits dans ce
   * jeu ont oublié la ligne ; on l'écrit ici une fois, au même endroit que les
   * sommets, pour ne plus y repenser.
   */
  vol.geo.getAttribute('position').needsUpdate = true
}