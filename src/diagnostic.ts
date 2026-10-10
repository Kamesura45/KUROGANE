/**
 * ————— 🩺 LE DIAGNOSTIC DU POSTE —————
 *
 * On ne devine pas ce que vaut une machine : on le mesure chez elle.
 * Ce banc reconstruit la SCÈNE DU JEU (même caméra, même brume, mêmes
 * lumières, la vraie piste) et la fait tourner à trois configurations, pour
 * dire ce que chaque levier coûte ou rapporte réellement :
 *
 *   A · le jeu aujourd'hui      — antialias à fond, résolution native
 *   B · sans antialias          — le levier le plus gros sur un vieux GPU
 *   C · sans antialias, ×0,7    — le levier de la surface de rendu
 *
 * ⚠️ Une configuration ne se reconfigure PAS à l'exécution : `antialias` est
 * une option du contexte WebGL. Chaque essai crée donc son propre canvas et
 * son propre renderer, puis les jette avant le suivant. Réutiliser le même
 * canvas donnerait un contexte mort dont les mesures ne vaudraient rien.
 *
 * Pourquoi deux chiffres par configuration :
 *   · `ms/image` force la carte à rendre JUSQU'AU BOUT (`gl.finish()`) — c'est
 *     elle qui dit si le GPU tient, même quand l'écran le plafonne à 60 ;
 *   · `images/s` est le ressenti : le vrai nombre d'images affichées.
 * Les deux peuvent se contredire, et c'est normal : à 60 Hz plafonné, les FPS
 * s'arrêtent de monter pendant que le coût du GPU continue d'augmenter.
 */

import * as THREE from 'three'
import { Track, COURSE_LENGTH } from './track'

// Durées paramétrables par l'URL : `?rapide=1` raccourcit tout, pour vérifier
// que le banc va au bout sur une machine de test lente (rendu logiciel) sans
// fausser les chiffres — c'est la logique qu'on éprouve, pas la performance.
const args = new URLSearchParams(location.search)
const rapide = args.has('rapide')

// On compte un NOMBRE D'IMAGES, pas une durée ouverte : une mesure conditionnée
// à une horloge qui doit avancer pendant une attente peut ne jamais retomber,
// alors qu'un décompte finit toujours. C'est aussi le nombre d'images que l'œil
// aurait vues : 60 images = 1 s à 60 img/s, 2 s à 30, 6 s à 10.
let IMAGES = rapide ? 2 : 20 // images par tirage de temps de rendu
let CHAUFFE = rapide ? 1 : 12 // images de chauffe avant toute mesure
let FPS_IMAGES = rapide ? 3 : 60 // images comptées pour le ressenti

const CIBLE_MS = 1000 / 60 // 16,7 ms : la cadence de 60 images par seconde

interface Configuration {
  nom: string
  detail: string
  antialias: boolean
  pixelRatio: number
  actuel?: boolean
}

interface Mesure {
  config: Configuration
  ms: number | null
  fps: number | null
  erreur: string | null
  /** Le contexte WebGL a lâché — le symptôme exact d'une course figée. */
  perdu: boolean
}

// ————— Le DOM —————
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`élément #${id} manquant`)
  return el as T
}

const elResultats = $<HTMLTableSectionElement>('resultats')
const elVerdict = $<HTMLDivElement>('verdict')
const elAvancement = $<HTMLSpanElement>('avancement')
const elAlerte = $<HTMLDivElement>('alerte')
const elLancer = $<HTMLButtonElement>('lancer')
const elCopier = $<HTMLButtonElement>('copier')

// ————— L'identité du poste —————
function lireIdentite() {
  const canvas = document.createElement('canvas')
  const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null

  if (!gl) {
    $<HTMLElement>('gpu').textContent = 'aucun contexte WebGL — le jeu ne peut pas démarrer'
    return
  }

  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const gpu = debug
    ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER))
  const fab = debug
    ? String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))
    : String(gl.getParameter(gl.VENDOR))

  $<HTMLElement>('gpu').textContent = gpu
  $<HTMLElement>('fab').textContent = fab
  $<HTMLElement>('webgl').textContent = gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL 1'

  const dpr = devicePixelRatio
  $<HTMLElement>('ecran').textContent =
    `${innerWidth} × ${innerHeight} px · densité ×${dpr}` +
    ` · ${Math.round(innerWidth * dpr)} × ${Math.round(innerHeight * dpr)} de rendu`

  const coeurs = navigator.hardwareConcurrency
  $<HTMLElement>('coeurs').textContent = coeurs ? `${coeurs} cœurs` : 'non renseigné'

  try {
    const brut = localStorage.getItem('kurogane-settings')
    const reglage = brut ? (JSON.parse(brut) as { quality?: string }).quality : undefined
    $<HTMLElement>('reglage').textContent = reglage
      ? reglage === 'auto' ? 'auto (plafond 2)' : reglage
      : 'auto (défaut)'
  } catch {
    $<HTMLElement>('reglage').textContent = 'inaccessible'
  }

  // Une carte trop chétive n'aura pas de ligne de verdict utile : on le dit
  // tout de suite plutôt que de laisser tourner un test qui va planter.
  if (gpu === 'WebKit WebGL' && !debug) {
    elAlerte.style.display = 'block'
    elAlerte.textContent = '⚠️ Le navigateur masque l’identité de la carte : les mesures restent valides, le nom non.'
  }
}

// ————— La vraie scène du jeu —————
/** Recopie de src/main.ts:218-230 — même cadrage, même brume, mêmes lumières. */
function construireScene() {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x151a2c) // nuit indigo
  scene.fog = new THREE.Fog(0x151a2c, 30, 85) // la brume cache l'apparition des obstacles

  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200)
  camera.position.set(0, 4.4, 7.5)
  camera.lookAt(0, 1.2, -8)

  const ambient = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.9)
  const moon = new THREE.DirectionalLight(0xdfe8ff, 1.4)
  moon.position.set(-6, 12, -4)
  scene.add(ambient, moon)

  const track = new Track(scene)
  track.reset(COURSE_LENGTH, 1234, false, false)

  // On fait avancer la piste avant de mesurer : une piste au repos est vide,
  // et c'est le remplissage d'obstacles qui coûte. ~10 s de course simulée.
  for (let i = 0; i < 600; i++) track.update(1 / 60, 22, i * 0.366)

  return { scene, camera }
}

// ————— Une configuration, mesurée de bout en bout —————
/**
 * Deux pièges du banc, qui valent bien au-delà de ce banc.
 *
 * 1. Un `requestAnimationFrame` peut disparaître (onglet en arrière-plan,
 *    contexte WebGL mort) — et une attente sans retour ne finit JAMAIS : le
 *    banc resterait figé sans jamais dire pourquoi. Un `setTimeout` de garde,
 *    lui, est toujours servi. On lève l'attente, on le signale, on avance.
 *
 * 2. Un callback peut SURVIVRE à sa mesure : la garde a levé l'attente alors
 *    que le rAF était en route, et il continue de tourner pendant qu'on passe à
 *    la configuration suivante — d'où un panneau qui se met à jour tout seul.
 *    Chaque mesure porte un numéro de tour ; un callback dont le tour est
 *    dépassé sort sans rien écrire.
 */
let gele = false
let tour = 0

function attendreImages(n: number, monTour: number): Promise<void> {
  return new Promise((res) => {
    let reste = n
    let resolu = false
    const sortir = () => { if (!resolu) { resolu = true; res() } }
    const garde = setTimeout(() => { if (monTour === tour) gele = true; sortir() }, 10000)
    const pas = () => {
      if (monTour !== tour) { clearTimeout(garde); return sortir() }
      if (--reste <= 0) { clearTimeout(garde); return sortir() }
      requestAnimationFrame(pas)
    }
    requestAnimationFrame(pas)
  })
}

function attendre(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function mesurer(
  config: Configuration,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): Promise<Mesure> {
  const mesure: Mesure = { config, ms: null, fps: null, erreur: null, perdu: false }
  gele = false // drapeau propre à chaque configuration
  const monTour = ++tour

  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.left = '-10000px'
  canvas.style.top = '0'
  canvas.style.width = `${innerWidth}px`
  canvas.style.height = `${innerHeight}px`
  document.body.appendChild(canvas)

  // 🔴 Le symptôme même : si le contexte lâche, la course se fige en vrai.
  let perdu = false
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    perdu = true
  })

  let renderer: THREE.WebGLRenderer | null = null
  // Chaque étape cède un tour : le message avance VRAIMENT, et un blocage
  // éventuel se localise au lieu de figer la page sans dire où.
  const etape = async (t: string) => {
    elAvancement.innerHTML = `${config.nom} : <b>${t}</b>`
    await attendre(0)
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: config.antialias })
    renderer.setPixelRatio(config.pixelRatio)
    renderer.setSize(innerWidth, innerHeight, false)
    renderer.setClearColor(0x151a2c)

    const gl = renderer.getContext()

    await etape('compilation des shaders')
    try { renderer.compile(scene, camera) } catch { /* compilateur absent : on rend quand même */ }

    await etape('chauffe')
    // Une image par image, en rendu, avec un tour d'horloge entre chaque : une
    // chaîne synchrone de rendus fige la page et empêche même le DOM d'avancer.
    for (let i = 0; i < CHAUFFE && !perdu; i++) {
      renderer.render(scene, camera)
      elAvancement.innerHTML = `${config.nom} : <b>chauffe ${i + 1}/${CHAUFFE} — image dessinée</b>`
      await attendre(0)
      await attendreImages(1, monTour)
    }

    // ——— 1. le vrai coût du GPU, image par image ———
    if (!perdu) {
      await etape('temps de rendu réel')
      const t0 = performance.now()
      let rendues = 0
      for (let i = 0; i < IMAGES && !perdu; i++) { renderer.render(scene, camera); rendues++ }
      gl.finish() // on ne rend PAS un chiffre tant que la carte n'a pas fini
      if (rendues > 0) mesure.ms = (performance.now() - t0) / rendues
    }

    // ——— 2. le ressenti : ce que l'écran donne réellement ———
    if (!perdu) {
      await etape('comptage des images')
      let images = 0
      const debut = performance.now()
      await new Promise<void>((res) => {
        let fini = false
        const sortir = () => { if (!fini) { fini = true; res() } }
        // Deux pièges : un rAF qui ne revient plus, et une exception dans un
        // callback — qui échappe au try/catch englobant et laisserait le banc
        // figé pour toujours sans jamais afficher la raison.
        const garde = setTimeout(() => { if (monTour === tour) gele = true; sortir() }, 30000)
        const pas = () => {
          try {
            if (monTour !== tour || perdu || images >= FPS_IMAGES) { clearTimeout(garde); return sortir() }
            if (images % 5 === 0) elAvancement.innerHTML = `${config.nom} : <b>image ${images + 1}/${FPS_IMAGES}</b>`
            renderer!.render(scene, camera)
            images++
            requestAnimationFrame(pas)
          } catch (e) {
            clearTimeout(garde)
            mesure.erreur = e instanceof Error ? e.message : String(e)
            sortir()
          }
        }
        requestAnimationFrame(pas)
      })
      const secondes = (performance.now() - debut) / 1000
      // Le chronomètre n'a pas bougé : c'est l'onglet qui est en arrière-plan,
      // pas la carte qui cale. Un chiffre absurde pire qu'aucun — on le dit.
      if (mesure.erreur) { /* le callback a déjà tout dit */ }
      else if (gele) mesure.erreur = 'image non servie : onglet en arrière-plan ou contexte mort'
      else if (images <= 2 || secondes < 0.05) mesure.erreur = 'onglet mis en arrière-plan pendant la mesure'
      else mesure.fps = images / secondes
    }
  } catch (e) {
    mesure.erreur = e instanceof Error ? e.message : String(e)
  } finally {
    renderer?.dispose()
    canvas.remove()
    // Fin de tour : un callback qui survivrait encore à cette mesure voit son
    // numéro dépassé et sort sans rien écrire.
    tour++
  }

  if (perdu) {
    mesure.perdu = true
    mesure.erreur = mesure.erreur ?? 'contexte WebGL perdu pendant la mesure'
  } else if (gele) mesure.erreur = mesure.erreur ?? 'rAF non servi pendant la chauffe'

  return mesure
}

// ————— L'affichage —————
function cellule(result: Mesure): string {
  const ms = result.ms === null ? '—' : result.ms.toFixed(1)
  const fps = result.fps === null ? '—' : Math.round(result.fps)
  const classe = result.config.actuel ? 'actuel' : ''
  if (result.erreur) {
    return `<tr class="${classe}"><td>${result.config.nom}<br><span class="etat">${result.config.detail}</span></td>
      <td class="num" colspan="3" style="color:#e24b3a">✕ ${result.erreur}</td></tr>`
  }
  return `<tr class="${classe}">
    <td>${result.config.nom}<br><span class="etat">${result.config.detail}</span></td>
    <td class="num">${ms}</td>
    <td class="num">${fps}</td>
    <td>${verdictLigne(result)}</td>
  </tr>`
}

function verdictLigne(result: Mesure): string {
  if (result.ms === null) return '<span class="etat">—</span>'
  if (result.ms <= CIBLE_MS) return '✓ tient les 60 images/s'
  if (result.ms <= 2 * CIBLE_MS) return '~ 30 images/s'
  if (result.ms <= 4 * CIBLE_MS) return '~ 15 images/s'
  return '<span style="color:#e24b3a">ne tient pas la cadence</span>'
}

function redigerVerdict(mesures: Mesure[]): string {
  // Une mesure qui a échoué n'a aucun droit de vote : conclure sur « 0,0 ms »
  // serait pire que ne rien conclure du tout.
  const ok = mesures.filter((m) => m.ms !== null && !m.erreur)
  const enEchec = mesures.filter((m) => m.erreur)

  if (ok.length < 2) {
    const detail = enEchec.length
      ? `Les ${enEchec.length} configuration(s) en rouge ont échoué : ` +
        `${enEchec[0].erreur}. Aucun chiffre concluant.`
      : 'Pas assez de configurations mesurées pour conclure.'
    return `${detail}\n\nLe banc sert ici de démonstration : relancez-le dans un onglet VISIBLE (sans ?auto), ou corrigez la cause indiquée.`
  }

  const parNom = new Map(ok.map((m) => [m.config.nom, m.ms]))
  const ms = (n: string) => parNom.get(n) ?? null
  const A = ms('Le jeu aujourd’hui')
  const B = ms('Sans antialias')
  const C = ms('Sans antialias, résolution ×0,7')

  const lignes: string[] = []

  /**
   * Pourcentage signé pour passer de `a` à `b` : positif = on y gagne.
   *
   * La phrase doit partir de CE signe, jamais l'inverse. « L'antialias coûte
   * 38 % » quand c'est le mode SANS-antialias qui est ressorti plus lent est
   * une contrevérité — et une contrevérité que le joueur ne peut pas vérifier
   * de son côté, donc il n'a qu'à nous croire sur parole.
   */
  const gain = (a: number, b: number) => Math.round((1 - b / a) * 100)

  if (A && B && A > 0) {
    const g = gain(A, B)
    if (g > 0) {
      lignes.push(
        `• Couper l’antialias fait gagner ${g} % de temps de rendu. ` +
          (A > CIBLE_MS && B <= CIBLE_MS
            ? 'C’est à ça qu’il faut toucher en priorité : c’est ce qui vous sépare des 60 images/s.'
            : 'C’est le premier levier.'),
      )
    } else {
      lignes.push(
        `• Couper l’antialias fait PERDRE ${Math.abs(g)} % de temps de rendu : ` +
          'votre carte ne souffre pas du filtrage, le laisser activé ne lui coûte rien. ' +
          'On cherchera ailleurs.',
      )
    }
  }
  if (B && C && B > 0) {
    const g = gain(B, C)
    lignes.push(
      g > 0
        ? `• Réduire la résolution de 30 % fait gagner ${g} % de temps de rendu. ` +
            (B > CIBLE_MS && C <= CIBLE_MS ? 'C’est ce qui vous manque pour atteindre 60 images/s.' : '')
        : `• Réduire la résolution de 30 % fait PERDRE ${Math.abs(g)} % ici : ` +
            'le rendu n’est pas le goulot, la résolution ne peut pas aider.',
    )
  }

  const meilleur = ok.reduce((a, b) => ((a.ms ?? Infinity) <= (b.ms ?? Infinity) ? a : b))
  const msMeilleur = meilleur.ms ?? Infinity

  if (msMeilleur <= CIBLE_MS) {
    lignes.push(
      `\n✅ La configuration « ${meilleur.config.nom} » tient les 60 images/s avec ` +
        `${msMeilleur.toFixed(1)} ms/image. C’est celle à appliquer.`,
    )
  } else {
    lignes.push(
      `\n⚠️ Même la meilleure configuration monte à ${msMeilleur.toFixed(1)} ms/image ` +
        `(cible : ${CIBLE_MS.toFixed(1)} ms). Il faudra attaquer autre chose que la résolution : ` +
        'effets additives, nombre d’objets, ou détail des matériaux.',
    )
  }

  const perdues = mesures.filter((m) => m.perdu)
  if (perdues.length > 0) {
    lignes.push(
      `\n🔴 ${perdues.length} configuration(s) ont perdu leur contexte WebGL. En course, ça donne ` +
        'un écran figé : le correctif est une gestion de webglcontextlost, pas une question de puissance.',
    )
  }
  const autres = mesures.filter((m) => m.erreur && !m.perdu)
  if (autres.length > 0) {
    lignes.push(`\n⚠️ ${autres.length} mesure(s) n’ont pas abouti : ${autres[0].erreur}.`)
  }

  return lignes.filter((l) => l.length > 0).join('\n')
}

function rapport(mesures: Mesure[], scene: THREE.Scene): string {
  let tris = 0
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh && m.geometry) {
      const g = m.geometry as THREE.BufferGeometry
      tris += g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
    }
  })

  const lignes = [
    '— KUROGANE : diagnostic du poste —',
    `carte   : ${$<HTMLElement>('gpu').textContent}`,
    `écran   : ${$<HTMLElement>('ecran').textContent}`,
    `cœurs   : ${$<HTMLElement>('coeurs').textContent}`,
    `réglage : ${$<HTMLElement>('reglage').textContent}`,
    `scène   : ${Math.round(tris)} triangles`,
    '',
    ...mesures.map((m) =>
      `${m.config.actuel ? '> ' : '  '}${m.config.nom.padEnd(34)} ` +
        `${m.ms === null ? '    —' : m.ms.toFixed(1).padStart(6) + ' ms'}  ` +
        `${m.fps === null ? '—' : String(Math.round(m.fps)).padStart(3) + ' img/s'}` +
        (m.erreur ? `  ✕ ${m.erreur}` : ''),
    ),
    '',
    redigerVerdict(mesures),
  ]
  return lignes.join('\n')
}

// ————— Le lancement —————
const LANCEMENT: Configuration[] = [
  { nom: 'Le jeu aujourd’hui', detail: 'antialias ×4 · résolution native', antialias: true, pixelRatio: devicePixelRatio, actuel: true },
  { nom: 'Sans antialias', detail: 'filtre coupé · résolution native', antialias: false, pixelRatio: devicePixelRatio },
  { nom: 'Sans antialias, résolution ×0,7', detail: 'filtre coupé · rendu réduit de 30 %', antialias: false, pixelRatio: devicePixelRatio * 0.7 },
]

let dernierRapport = ''

async function lancer() {
  elLancer.disabled = true
  elCopier.disabled = true
  elVerdict.hidden = true
  elResultats.innerHTML = '<tr><td colspan="4" class="etat">Construction de la scène…</td></tr>'

  const { scene, camera } = construireScene()
  const mesures: Mesure[] = []

  for (let i = 0; i < LANCEMENT.length; i++) {
    const config = LANCEMENT[i]
    elAvancement.innerHTML = `Mesure en cours : <b>${config.nom}</b> (${i + 1}/${LANCEMENT.length})`
    elResultats.innerHTML =
      mesures.map(cellule).join('') +
      `<tr><td colspan="4" class="etat">⏳ ${config.nom}…</td></tr>`

    mesures.push(await mesurer(config, scene, camera))
    elResultats.innerHTML = mesures.map(cellule).join('') +
      (i < LANCEMENT.length - 1 ? '<tr><td colspan="4" class="etat">…</td></tr>' : '')
    await attendre(150) // laisser respirer entre deux créations de contexte
  }

  elResultats.innerHTML = mesures.map(cellule).join('')
  elVerdict.textContent = redigerVerdict(mesures)
  elVerdict.hidden = false

  dernierRapport = rapport(mesures, scene)
  elCopier.disabled = false
  elAvancement.innerHTML = 'Mesures terminées. <b>Copiez le rapport et collez-le moi.</b>'

  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[]
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat.dispose()
    }
  })
}

elLancer.addEventListener('click', () => { void lancer() })

elCopier.addEventListener('click', () => {
  void navigator.clipboard.writeText(dernierRapport).then(
    () => { elCopier.textContent = '✓ Copié — collez-le moi' },
    () => { elCopier.textContent = 'Copie refusée : sélectionnez le verdict' },
  )
})

lireIdentite()

// `?auto=1` lance les mesures sans clic : c'est la porte des scripts de test,
// et un moyen de relancer le banc sans se tromper de bouton.
if (new URLSearchParams(location.search).has('auto')) void lancer()
