/**
 * ————— Un navigateur en carton-pâte —————
 *
 * Node n'a ni `window`, ni `document`, ni `AudioContext`, ni même
 * `addEventListener`. Or `sfx.ts` appelle ce dernier **pendant l'évaluation du
 * module** (le déblocage du son au premier geste, `sfx.ts:23`) : importer le
 * module sans l'avoir posé au préalable lève un `ReferenceError`.
 *
 * ⚠️ D'où ce fichier, et d'où son IMPORT EN PREMIER dans le banc qui l'utilise.
 * Les imports sont hoistés par-dessus le corps du fichier, mais leur évaluation
 * suit l'ORDRE D'ÉCRITURE : un module importé tout en haut s'exécute avant tous
 * les autres. Un `globalThis.document = ...` placé dans le corps du banc,
 * même juste au-dessus des imports, arriverait TROP TARD — c'est le piège que
 * les bancs existants évitent sans le dire, parce qu'ils n'utilisent `document`
 * qu'à l'intérieur des fonctions, jamais à l'évaluation.
 *
 * Le compteur `setTargetAtTime` est l'intérêt principal de ce banc : c'est le
 * seul détectable sans audio réel, et c'est exactement ce qui fuyait. Dans
 * `src/`, une seule ligne programme cet événement — `sfx.ts` et la nappe du
 * feu —, donc le compteur global ÉGAL le compteur du feu.
 */

/**
 * Combien de consignes ont été remises au thread audio depuis le lancement.
 *
 * `setTargetAtTime` ne fait pas que régler un volume : il POSE un événement
 * dans la file d'automatisation de l'AudioParam. En reprogrammer 60 fois par
 * seconde, indéfiniment, ne change rien au son entendu et fait grossir la file
 * sans jamais la vider.
 */
let reprogrammes = 0

/** Le compteur, tel quel. */
export function combienReprogrammes(): number {
  return reprogrammes
}

/** On remet le compteur à zéro entre deux segments de mesure. */
export function remettreCompteur(): void {
  reprogrammes = 0
}

/**
 * Un AudioParam en carton-pâte.
 *
 * Seul `setTargetAtTime` est compté : dans `src/`, c'est le fondu du feu qui
 * l'utilise, et il est appelé à CHAQUE image. Les autres méthodes ne servent
 * qu'aux enveloppes de bruitage, déclenchées par événement.
 */
class Param {
  value = 0
  setValueAtTime(): this {
    return this
  }
  linearRampToValueAtTime(): this {
    return this
  }
  exponentialRampToValueAtTime(): this {
    return this
  }
  setTargetAtTime(): this {
    reprogrammes++
    return this
  }
}

class Noeud {
  connect<T>(cible: T): T {
    return cible
  }
  disconnect() {}
}

class Source extends Noeud {
  buffer: FauxBuffer | null = null
  loop = false
  playbackRate = new Param()
  start(_depart?: number, _offset?: number, _duree?: number) {}
  stop(_arrivee?: number) {}
}

class Filtre extends Noeud {
  type = 'lowpass'
  frequency = new Param()
  Q = new Param()
}

class Gain extends Noeud {
  gain = new Param()
}

class Oscillateur extends Noeud {
  type = 'sine'
  frequency = new Param()
  start(_depart?: number) {}
  stop(_arrivee?: number) {}
}

class FauxBuffer {
  readonly longueur: number
  readonly taux: number
  constructor(_canaux: number, longueur: number, taux: number) {
    this.longueur = longueur
    this.taux = taux
  }
  getChannelData(_c: number): Float32Array {
    // Assez grand pour `bruitBlanc`, qui le remplit tout entier.
    return new Float32Array(this.longueur)
  }
}

/**
 * Le contexte. `currentTime` avance comme dans un vrai navigateur : c'est ce
 * qui donne aux rampes un temps à viser, et cela ne coûte rien.
 */
class FauxAudioContext {
  currentTime = 0
  readonly sampleRate = 22050
  readonly state = 'running'
  readonly destination = new Noeud()
  resume(): Promise<void> {
    return Promise.resolve()
  }
  createBuffer(canaux: number, longueur: number, taux: number): FauxBuffer {
    return new FauxBuffer(canaux, longueur, taux)
  }
  createBufferSource(): Source {
    return new Source()
  }
  createBiquadFilter(): Filtre {
    return new Filtre()
  }
  createGain(): Gain {
    return new Gain()
  }
  createOscillator(): Oscillateur {
    return new Oscillateur()
  }
}

/**
 * Un canvas 2D qui ne peint rien.
 *
 * `Track` cuit ses textures de biome au canvas, et `NameTag` y mesure du texte.
 * Ni l'un ni l'autre n'a d'effet sur la géométrie ou sur les APPELS DE SONS
 * que ce banc compte — on rend donc des méthodes qui ne font rien : le but est
 * d'exécuter le VRAI code, pas de produire des pixels.
 */
const ctx2d = {
  font: '',
  fillStyle: '' as unknown,
  measureText: () => ({ width: 10 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  beginPath() {},
  ellipse() {},
  fill() {},
  fillRect() {},
  save() {},
  restore() {},
  rotate() {},
  translate() {},
}

const g = globalThis as unknown as {
  window: unknown
  document: unknown
  addEventListener: unknown
}

g.window = { AudioContext: FauxAudioContext }
g.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
}
// Les écouteurs de `sfx.ts` ne servent ici qu'à ne pas lever : le banc n'appuie
// sur rien, il appelle les fonctions de son directement.
g.addEventListener = () => {}
