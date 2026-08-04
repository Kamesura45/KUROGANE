/**
 * ————— Le son du jeu —————
 *
 * Tout est SYNTHÉTISÉ à la volée (Web Audio) : pas un seul fichier à charger,
 * donc rien à télécharger sur mobile et aucun asset à gérer.
 *
 * Les navigateurs interdisent le son tant que le joueur n'a pas interagi : on
 * débloque le contexte au tout premier clic / appui, une bonne fois.
 */

let ctx: AudioContext | null = null

/** Le contexte audio, créé à la demande. null si le navigateur n'en veut pas. */
function audio(): AudioContext | null {
  const AC = window.AudioContext ?? (window as any).webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// Déblocage au premier geste : après ça, le son marche partout dans la partie.
for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
  addEventListener(ev, () => audio(), { once: true, passive: true })
}

/**
 * 🌬️ Un souffle de vent : du bruit blanc passé dans un filtre qui balaie les
 * fréquences, avec une enveloppe qui enfle puis retombe. C'est la recette
 * classique du vent — bien plus convaincant qu'un simple souffle constant.
 */
export function souffleDeVent(duree = 3.2, volume = 0.22) {
  const ac = audio()
  if (!ac) return

  // Le bruit blanc : la matière première du vent
  const n = Math.floor(ac.sampleRate * duree)
  const buf = ac.createBuffer(1, n, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource()
  src.buffer = buf

  // Le filtre qui balaie : c'est lui qui fait « whoooosh » plutôt que « chhhh »
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.7
  const t0 = ac.currentTime
  bp.frequency.setValueAtTime(300, t0)
  bp.frequency.linearRampToValueAtTime(950, t0 + duree * 0.5)
  bp.frequency.linearRampToValueAtTime(380, t0 + duree)

  // L'enveloppe : la rafale monte, tient, puis s'éteint
  const g = ac.createGain()
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(volume, t0 + duree * 0.3)
  g.gain.linearRampToValueAtTime(volume * 0.7, t0 + duree * 0.72)
  g.gain.linearRampToValueAtTime(0, t0 + duree)

  src.connect(bp)
  bp.connect(g)
  g.connect(sortie(ac)) // passe par le volume commun, comme tous les bruitages
  src.start(t0)
  src.stop(t0 + duree + 0.05)
}

/* ═══════════════ Les bruitages du jeu ═══════════════
 *
 * Le piège de la synthèse, c'est de sonner « bip de vieux jouet ». Trois
 * partis pris l'évitent :
 *
 * 1. **Du bruit, pas des tons.** Un impact ou une poterie qui casse, c'est du
 *    bruit blanc passé dans un filtre — jamais un oscillateur. Les tons purs
 *    ne servent qu'aux SIGNAUX (décompte, victoire), où personne n'attend
 *    qu'ils sonnent organiques.
 * 2. **Des décroissances exponentielles.** Un objet réel perd son énergie de
 *    plus en plus vite ; une décroissance linéaire s'entend tout de suite
 *    comme artificielle.
 * 3. **Une variation à chaque jeu.** Sans elle, casser dix jarres d'affilée
 *    sonne comme une mitraillette.
 */

export type Bruit =
  | 'saut'
  | 'glissade'
  | 'jarre'
  | 'jarreDoree'
  | 'coup'
  | 'chute'
  | 'parchemin'
  | 'bip'
  | 'go'
  | 'victoire'
  | 'defaite'
  | 'clic'

let master: GainNode | null = null
let volumeSfx = 0.6
let bruitBuf: AudioBuffer | null = null

/** Le volume commun à tous les bruitages — le vent compris. */
function sortie(ac: AudioContext): GainNode {
  if (!master) {
    master = ac.createGain()
    master.gain.value = volumeSfx
    master.connect(ac.destination)
  }
  return master
}

export function setVolumeSfx(v: number) {
  volumeSfx = Math.min(1, Math.max(0, v))
  if (master) master.gain.value = volumeSfx
}

/* ═══════════════ 🔥 Le brasier du village ═══════════════ */

let feuGain: GainNode | null = null
/** L'intensité VOULUE, retenue même quand le contexte audio n'existe pas
 *  encore : le joueur peut entrer dans le village avant d'avoir touché
 *  l'écran, et le feu doit démarrer au bon niveau dès qu'il y touche. */
let feuVoulu = 0

/**
 * ————— 🔥 Une nappe de feu, qu'on ouvre et qu'on ferme —————
 *
 * `intensite` va de 0 (silence) à 1 (plein brasier). On l'appelle à CHAQUE
 * IMAGE : la rampe interne se charge du fondu, il n'y a rien à cadencer côté
 * jeu.
 *
 * ⚠️ UNE SEULE BOUCLE, jamais des crépitements programmés un par un. Un feu
 * demande des dizaines de pops par seconde ; les planifier depuis la boucle de
 * jeu ferait autant de nœuds Web Audio à créer et détruire par image, et le
 * moindre à-coup d'images s'entendrait comme un trou dans le son. On cuit donc
 * six secondes de matière UNE fois — la nappe grave ET ses crépitements — et on
 * la joue en boucle. Le coût par image retombe à zéro.
 *
 * Six secondes, et non deux : plus court, l'oreille reconnaît le motif et le
 * feu se met à sonner comme une machine à laver.
 */
export function feuAmbiance(intensite: number) {
  feuVoulu = Math.min(1, Math.max(0, intensite))

  /*
   * ⚠️ ON NE CUIT PAS POUR RIEN, et l'on ne réveille même pas l'audio.
   *
   * Sans ce garde, la toute première image du jeu — au menu, silence demandé —
   * paierait la fabrication de la boucle, puisque la boucle de jeu appelle
   * cette fonction à CHAQUE image. Et placé après `audio()`, il laissait encore
   * 300 appels à `resume()` par seconde pour ne rien faire : mesuré, 0,16 ms
   * par image gaspillées au menu. Tant qu'on ne demande pas de feu et qu'il n'y
   * en a pas, il n'y a rien à faire du tout.
   *
   * `prechauffeFeu()` sert à provoquer la cuisson au bon moment.
   */
  if (!feuGain && feuVoulu <= 0) return

  const ac = audio()
  if (!ac) return

  if (!feuGain) {
    const DUREE = 6
    /*
     * ⚠️ 22 kHz, et non la fréquence du contexte (souvent 48).
     *
     * Web Audio ré-échantillonne tout seul à la lecture, et ce son passe de
     * toute façon dans un passe-bas à 1 150 Hz : au-delà de 2 300 Hz, il n'y a
     * rien à représenter. Générer à 48 kHz, c'était donc calculer plus du
     * double d'échantillons pour un contenu strictement identique — mesuré,
     * 114 ms de cuisson contre ~50.
     */
    const TAUX = 22050
    const n = Math.floor(TAUX * DUREE)
    const buf = ac.createBuffer(1, n, TAUX)
    const d = buf.getChannelData(0)

    /*
     * 1. LA NAPPE. Du bruit BRUN — du bruit blanc intégré — et non du blanc :
     * le blanc siffle comme une friture, le brun gronde. C'est la différence
     * entre « radio mal réglée » et « feu ».
     */
    let brun = 0
    for (let i = 0; i < n; i++) {
      brun = (brun + (Math.random() * 2 - 1) * 0.02) * 0.996
      d[i] = brun * 5
    }

    /*
     * 2. LES CRÉPITEMENTS, cuits par-dessus. Une centaine de pops très courts,
     * chacun avec sa décroissance exponentielle — c'est ce qui donne le bois
     * qui éclate, et sans eux la nappe seule sonne comme du vent.
     */
    for (let k = 0; k < 260; k++) {
      const at = Math.floor(Math.random() * (n - 2000))
      const vie = 120 + Math.floor(Math.random() * 900)
      const force = 0.12 + Math.random() * 0.5
      for (let i = 0; i < vie; i++) {
        d[at + i] += (Math.random() * 2 - 1) * force * Math.exp(-i / (vie * 0.22))
      }
    }

    const src = ac.createBufferSource()
    src.buffer = buf
    src.loop = true

    // Un passe-bas : un feu n'a pas d'aigus. Sans lui, les crépitements
    // deviennent des clics numériques.
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 1150

    feuGain = ac.createGain()
    feuGain.gain.value = 0
    src.connect(lp)
    lp.connect(feuGain)
    feuGain.connect(sortie(ac)) // le volume commun s'applique, comme au reste
    src.start()
  }

  /*
   * Le fondu. `setTargetAtTime` plutôt qu'une rampe : on ne sait pas quand la
   * prochaine consigne tombera, et une exponentielle qui vise la cible reste
   * juste quelle que soit la cadence — même si le jeu perd des images.
   */
  /*
   * ⚠️ 0,18 et non 0,5. Le brasier est une AMBIANCE : il pose le lieu, il ne
   * doit pas concurrencer ce qu'on doit entendre pour jouer — les jarres, les
   * sorts, le décompte. À un demi, il couvrait le village entier et l'on
   * n'entendait plus sa propre course.
   */
  feuGain.gain.setTargetAtTime(feuVoulu * 0.18, ac.currentTime, 0.5)
}

/* ═══════════════ 🐦 Les oiseaux de la bambouseraie ═══════════════ */

/** Secondes avant le prochain chant. 0 = au prochain appel. */
let oiseauT = 0

/**
 * ————— 🐦 Un chant, deux ou trois notes —————
 *
 * Un vrai chant d'oiseau n'est pas une note tenue : c'est une fréquence qui
 * GLISSE, vite, sur quelques centaines de hertz. C'est ce glissando qui fait
 * « oiseau » — une sinusoïde fixe au même endroit sonne comme une alarme.
 *
 * Chaque note monte puis retombe, et l'ensemble se décale d'un chant à l'autre
 * (hauteur, nombre de notes, tempo). Sans cette variation, le même trille
 * revenant toutes les trois secondes deviendrait vite insupportable.
 */
function chantOiseau(ac: AudioContext, volume: number) {
  const t0 = ac.currentTime + 0.02
  const notes = 2 + Math.floor(Math.random() * 3)
  // La hauteur de CET oiseau-là : deux individus ne chantent pas au même ton.
  const base = 2100 + Math.random() * 1500
  let t = t0

  for (let i = 0; i < notes; i++) {
    const duree = 0.055 + Math.random() * 0.07
    const osc = ac.createOscillator()
    osc.type = 'sine' // le plus proche d'un sifflement : pas d'harmoniques

    // Le glissando : on monte d'une tierce environ, puis on retombe.
    const bas = base * (0.92 + Math.random() * 0.16)
    const haut = bas * (1.22 + Math.random() * 0.3)
    osc.frequency.setValueAtTime(bas, t)
    osc.frequency.exponentialRampToValueAtTime(haut, t + duree * 0.42)
    osc.frequency.exponentialRampToValueAtTime(bas * 0.94, t + duree)

    // L'enveloppe : attaque franche, extinction exponentielle. Un chant qui
    // s'ouvrirait en fondu sonnerait comme un synthé, pas comme un bec.
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(volume, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree)

    osc.connect(g)
    g.connect(sortie(ac))
    osc.start(t)
    osc.stop(t + duree + 0.02)

    t += duree + 0.03 + Math.random() * 0.05
  }
}

/**
 * 🐦 L'ambiance de la bambouseraie. À appeler à CHAQUE image, avec `dt`.
 *
 * ⚠️ Rien à voir avec le brasier, et c'est voulu : un feu est CONTINU, donc une
 * boucle ; des oiseaux sont ESPACÉS, donc des événements. Boucler un chant
 * d'oiseau ferait entendre la répétition au bout de deux tours, et poser une
 * nappe de crépitements par événements coûterait des dizaines de nœuds par
 * seconde. Chaque son veut sa mécanique.
 *
 * Trois à sept secondes entre deux chants : assez pour qu'on l'entende comme
 * une forêt vivante, assez rare pour ne jamais couvrir le jeu.
 */
export function oiseauxAmbiance(intensite: number, dt: number) {
  if (intensite <= 0) {
    // On réarme : en revenant dans la forêt, un chant partira sans attendre.
    oiseauT = 0
    return
  }
  const ac = audio()
  if (!ac) return

  oiseauT -= dt
  if (oiseauT > 0) return
  oiseauT = 3 + Math.random() * 4
  chantOiseau(ac, 0.05 * intensite)
}

/**
 * 🔥 Cuit la boucle du brasier À L'AVANCE, sans la jouer.
 *
 * La fabrication coûte quelques dizaines de millisecondes sur le thread
 * principal — négligeable en soi, mais elle tomberait sinon à l'instant précis
 * où l'on ENTRE dans le village, à 28 m/s, et un à-coup à cet endroit-là se
 * sentirait. On la provoque donc pendant le décompte, à l'arrêt sur la grille,
 * exactement comme la compilation des shaders.
 *
 * Appelable autant de fois qu'on veut : la boucle n'est cuite qu'une seule.
 */
export function prechauffeFeu() {
  const avant = feuVoulu
  feuAmbiance(1) // force la cuisson…
  feuAmbiance(avant) // …et l'on remet aussitôt le niveau voulu, sans l'entendre
}

/** Un poil de hasard : ±4 %, assez pour casser la répétition sans dénaturer. */
const vary = () => 1 + (Math.random() - 0.5) * 0.08

/** Une seconde de bruit blanc, fabriquée une fois et réutilisée partout. */
function bruitBlanc(ac: AudioContext): AudioBuffer {
  if (!bruitBuf) {
    const n = ac.sampleRate
    bruitBuf = ac.createBuffer(1, n, ac.sampleRate)
    const d = bruitBuf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
  }
  return bruitBuf
}

/**
 * Une bouffée de bruit filtrée : la brique de tous les impacts.
 * Passe-bas pour un choc sourd, passe-bande pour un tintement sec.
 */
function souffle(
  ac: AudioContext,
  depart: number,
  duree: number,
  gain: number,
  freq: number,
  type: BiquadFilterType = 'bandpass',
  freqFin?: number
) {
  const src = ac.createBufferSource()
  src.buffer = bruitBlanc(ac)
  src.playbackRate.value = vary()

  const filtre = ac.createBiquadFilter()
  filtre.type = type
  filtre.frequency.setValueAtTime(freq, depart)
  if (freqFin) filtre.frequency.exponentialRampToValueAtTime(freqFin, depart + duree)
  filtre.Q.value = type === 'bandpass' ? 1.4 : 0.8

  const g = ac.createGain()
  g.gain.setValueAtTime(gain, depart)
  g.gain.exponentialRampToValueAtTime(0.0001, depart + duree)

  src.connect(filtre).connect(g).connect(sortie(ac))
  // On démarre à un point au hasard du bruit : deux souffles ne sont jamais
  // taillés dans la même matière.
  src.start(depart, Math.random() * 0.8, duree)
  src.stop(depart + duree)
}

/** Un ton : pour les signaux, et pour le corps grave d'un impact. */
function ton(
  ac: AudioContext,
  depart: number,
  duree: number,
  gain: number,
  freq: number,
  freqFin?: number,
  forme: OscillatorType = 'triangle'
) {
  const o = ac.createOscillator()
  o.type = forme
  o.frequency.setValueAtTime(freq, depart)
  if (freqFin) o.frequency.exponentialRampToValueAtTime(freqFin, depart + duree)

  const g = ac.createGain()
  // Attaque de 4 ms : instantanée à l'oreille, mais sans le « clic » parasite
  // qu'un démarrage à pic produirait.
  g.gain.setValueAtTime(0.0001, depart)
  g.gain.exponentialRampToValueAtTime(gain, depart + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, depart + duree)

  o.connect(g).connect(sortie(ac))
  o.start(depart)
  o.stop(depart + duree + 0.02)
}

export function jouerBruit(b: Bruit) {
  const ac = audio()
  if (!ac || volumeSfx <= 0) return
  const t = ac.currentTime
  const v = vary()

  switch (b) {
    // Un appel d'air qui monte : le corps qui se détend.
    case 'saut':
      ton(ac, t, 0.1 * v, 0.22, 300 * v, 620 * v)
      souffle(ac, t, 0.1, 0.05, 1400, 'bandpass', 2600)
      break

    // Du frottement : le filtre se referme à mesure que la vitesse retombe.
    case 'glissade':
      souffle(ac, t, 0.3 * v, 0.16, 3200 * v, 'lowpass', 500)
      break

    // La poterie : un choc sourd, une gerbe claire, puis trois éclats qui
    // retombent. Ce sont EUX qui font entendre « céramique » et non « explosion ».
    case 'jarre':
      ton(ac, t, 0.09, 0.18, 190 * v, 85)
      souffle(ac, t, 0.2 * v, 0.3, 2300 * v)
      souffle(ac, t + 0.03, 0.09, 0.14, 3600 * v)
      souffle(ac, t + 0.07, 0.07, 0.1, 4400 * v)
      souffle(ac, t + 0.12, 0.06, 0.07, 5200 * v)
      break

    // La même casse, doublée d'un accord clair : la récompense s'entend avant
    // même qu'on lise le HUD.
    case 'jarreDoree':
      ton(ac, t, 0.09, 0.18, 190 * v, 85)
      souffle(ac, t, 0.2 * v, 0.28, 2500 * v)
      souffle(ac, t + 0.04, 0.08, 0.12, 4000 * v)
      ton(ac, t + 0.02, 0.4, 0.16, 880 * v, undefined, 'sine')
      ton(ac, t + 0.09, 0.38, 0.13, 1320 * v, undefined, 'sine')
      ton(ac, t + 0.16, 0.36, 0.1, 1760 * v, undefined, 'sine')
      break

    // Un coup porté : le claquement du contact, puis le poids derrière.
    case 'coup':
      souffle(ac, t, 0.06, 0.28, 900 * v, 'lowpass')
      ton(ac, t, 0.14 * v, 0.34, 170 * v, 55)
      break

    // On tombe : plus grave, plus long et plus mou qu'un coup donné.
    case 'chute':
      souffle(ac, t, 0.32 * v, 0.3, 700 * v, 'lowpass', 200)
      ton(ac, t, 0.26, 0.3, 130 * v, 42)
      break

    // Le papier qu'on saisit, puis deux notes qui montent : c'est un gain.
    case 'parchemin':
      souffle(ac, t, 0.09, 0.1, 3000, 'bandpass', 1500)
      ton(ac, t + 0.02, 0.16, 0.2, 660 * v, undefined, 'sine')
      ton(ac, t + 0.1, 0.22, 0.18, 990 * v, undefined, 'sine')
      break

    // Ici le ton pur est LÉGITIME : c'est un signal, pas un objet du monde.
    case 'bip':
      ton(ac, t, 0.11, 0.24, 660, undefined, 'square')
      break

    case 'go':
      ton(ac, t, 0.3, 0.3, 990, undefined, 'square')
      ton(ac, t, 0.3, 0.12, 1980, undefined, 'sine')
      break

    // Do–mi–sol : l'accord parfait, ça sonne juste sans effort.
    case 'victoire':
      ton(ac, t, 0.18, 0.26, 523)
      ton(ac, t + 0.13, 0.18, 0.26, 659)
      ton(ac, t + 0.26, 0.5, 0.3, 784)
      break

    // Les mêmes notes à l'envers et plus lentes : ça retombe.
    case 'defaite':
      ton(ac, t, 0.22, 0.24, 392)
      ton(ac, t + 0.18, 0.24, 0.22, 330)
      ton(ac, t + 0.4, 0.6, 0.24, 262)
      break

    // Un rien : juste de quoi sentir que le doigt a touché.
    case 'clic':
      souffle(ac, t, 0.03, 0.14, 2600)
      break
  }
}

/**
 * 🍵 Le son du soin : trois notes qui MONTENT (do-mi-sol, un accord parfait).
 *
 * Un arpège ascendant en harmonie, c'est la grammaire universelle du soin dans
 * le jeu vidéo — on l'entend comme « ça va mieux » sans avoir rien appris. On
 * les joue sur des sinus doux, jamais sur une onde carrée : il faut que ça
 * apaise au milieu du vacarme de la course.
 */
export function sonDeSoin(volume = 0.16) {
  const ac = audio()
  if (!ac || volumeSfx <= 0) return
  const t0 = ac.currentTime
  const notes = [523.25, 659.25, 783.99] // do5, mi5, sol5

  notes.forEach((f, i) => {
    const debut = t0 + i * 0.085 // elles s'enchaînent vite : un geste, pas une mélodie
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.value = f

    const g = ac.createGain()
    // Attaque douce et longue traîne : une cloche, pas un bip
    g.gain.setValueAtTime(0, debut)
    g.gain.linearRampToValueAtTime(volume, debut + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, debut + 0.75)

    o.connect(g)
    // Passe par le volume commun (sortie), comme tous les autres bruitages —
    // sinon ce son ignorerait le réglage de volume et le mute.
    g.connect(sortie(ac))
    o.start(debut)
    o.stop(debut + 0.8)
  })
}
