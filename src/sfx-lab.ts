/**
 * Le banc d'essai du SON (sfx-lab.html).
 *
 * Une page à part, hors du jeu : on écoute, on juge, on ajuste les chiffres
 * dans sfx.ts et audio.ts. Elle ne part pas en production — c'est un outil
 * d'atelier.
 *
 * ⚠️ Elle doit contenir TOUT ce que le jeu peut émettre. Un son absent d'ici
 * ne se juge qu'en course, donc au milieu de dix autres et une fois sur vingt —
 * autant dire jamais. C'est pour ça qu'on y trouve aussi les ambiances de biome
 * et les musiques, et pas seulement les bruitages.
 */
import {
  jouerBruit,
  setVolumeSfx,
  souffleDeVent,
  sonDeSoin,
  feuAmbiance,
  oiseauxAmbiance,
  type Bruit,
} from './sfx'
import { Musique, type Piste } from './audio'

/* ————— 1. Les bruitages : des ÉVÉNEMENTS, on les déclenche ————— */

type Ponctuel = Bruit | 'vent' | 'soin'

const CATALOGUE: { id: Ponctuel; nom: string; quand: string }[] = [
  { id: 'saut', nom: '🦘 Saut', quand: 'swipe ⬆️' },
  { id: 'glissade', nom: '🛷 Glissade', quand: 'swipe ⬇️' },
  { id: 'jarre', nom: '🏺 Jarre cassée', quand: 'un coup qui porte' },
  { id: 'jarreDoree', nom: '✨ Jarre dorée', quand: 'un parchemin ou un trésor' },
  { id: 'coup', nom: '⚔️ Coup au rival', quand: 'on touche un joueur' },
  { id: 'chute', nom: '💥 Trébuchement', quand: 'obstacle, coup reçu, escalade' },
  { id: 'parchemin', nom: '📜 Ramassage', quand: 'on prend un rouleau' },
  { id: 'bip', nom: '🔔 Bip du décompte', quand: '3… 2… 1…' },
  { id: 'go', nom: '🚦 GO !', quand: 'le départ' },
  { id: 'victoire', nom: '🏆 Victoire', quand: 'premier au torii' },
  { id: 'defaite', nom: '☁️ Défaite', quand: 'arrivé après' },
  { id: 'clic', nom: '👆 Clic de menu', quand: 'un bouton' },
  { id: 'vent', nom: '🌬️ Rafale de vent', quand: '🌀 Souffle de Vent' },
  { id: 'soin', nom: '🍵 Soin', quand: 'le Thé purifie les afflictions' },
]

const jouer = (id: Ponctuel) => {
  if (id === 'vent') souffleDeVent(3.2)
  else if (id === 'soin') sonDeSoin()
  else jouerBruit(id)
}

const bouton = (nom: string, quand: string, onClic: (b: HTMLButtonElement) => void) => {
  const b = document.createElement('button')
  b.innerHTML = `<b></b><small></small>`
  b.querySelector('b')!.textContent = nom
  b.querySelector('small')!.textContent = quand
  b.addEventListener('click', () => onClic(b))
  return b
}

const grille = document.getElementById('grille')!
for (const s of CATALOGUE) {
  grille.appendChild(bouton(s.nom, s.quand, () => jouer(s.id)))
}

/* ————— 2. Les ambiances : des ÉTATS, on les ouvre et on les ferme ————— */

/*
 * ⚠️ Elles ne se jugent pas au clic mais À LA DURÉE. Une nappe peut être
 * parfaite pendant trois secondes et insupportable au bout de trente ; un chant
 * d'oiseau bien réglé isolément peut se mettre à sonner mécanique dès qu'on
 * l'entend revenir. D'où des interrupteurs, et une boucle qui les alimente
 * comme le jeu le fait — c'est la seule façon d'entendre ce que le joueur
 * entendra vraiment.
 */
const ambiances: { nom: string; quand: string; on: boolean }[] = [
  {
    nom: '🔥 Brasier du village',
    quand: 'biome 2 — grondement de fond + 2 à 8 craquements/s',
    on: false,
  },
  { nom: '🐦 Oiseaux de la forêt', quand: 'biome 1 — un chant toutes les 3 à 7 s', on: false },
]

const grilleAmb = document.getElementById('ambiances')!
ambiances.forEach((a) => {
  const b = bouton(a.nom, a.quand, (el) => {
    a.on = !a.on
    el.classList.toggle('on', a.on)
  })
  grilleAmb.appendChild(b)
})

// Un chant SEUL, pour juger une occurrence sans attendre la suivante.
grilleAmb.appendChild(
  bouton('🐦 Un chant, tout de suite', 'sans attendre le prochain', () => {
    // On force l'échéance : la prochaine image déclenchera un chant.
    oiseauxAmbiance(1, 999)
  })
)

/*
 * La boucle qui alimente les ambiances, exactement comme la boucle de jeu :
 * `feuAmbiance` reçoit un niveau, `oiseauxAmbiance` reçoit en plus le temps
 * écoulé — c'est lui qui espace les chants.
 */
let dernier = performance.now()
function tick(now: number) {
  const dt = Math.min(0.1, (now - dernier) / 1000)
  dernier = now
  feuAmbiance(ambiances[0].on ? 1 : 0, dt)
  oiseauxAmbiance(ambiances[1].on ? 1 : 0, dt)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

/* ————— 3. Les musiques ————— */

const musique = new Musique(0.5)
const PISTES: { id: Piste | null; nom: string; quand: string }[] = [
  { id: 'menu', nom: '🏮 Menu', quand: 'écran-titre et fiches' },
  { id: 'lobby', nom: '⚔️ Salon', quand: 'en attendant le départ' },
  { id: 'race', nom: '🏁 Course', quand: 'du décompte à l\'arrivée' },
  { id: null, nom: '🔇 Silence', quand: 'coupe la piste en cours' },
]

const grilleMus = document.getElementById('musiques')!
PISTES.forEach((p) => {
  const b = bouton(p.nom, p.quand, () => {
    musique.jouer(p.id)
    // Une seule piste à la fois : le témoin suit, sinon on ne sait plus
    // laquelle tourne après trois clics.
    for (const autre of grilleMus.children) autre.classList.remove('on')
    if (p.id) b.classList.add('on')
  })
  grilleMus.appendChild(b)
})

/* ————— 4. Les deux volumes ————— */

const vol = document.getElementById('vol') as HTMLInputElement
const volVal = document.getElementById('volVal')!
vol.addEventListener('input', () => {
  setVolumeSfx(Number(vol.value) / 100)
  volVal.textContent = `${vol.value} %`
})
setVolumeSfx(0.6)

const volMus = document.getElementById('volMus') as HTMLInputElement
const volMusVal = document.getElementById('volMusVal')!
volMus.addEventListener('input', () => {
  musique.setVolume(Number(volMus.value) / 100)
  volMusVal.textContent = `${volMus.value} %`
})

// La rafale : c'est ELLE qui dit si la variation aléatoire suffit.
document.getElementById('rafale')!.addEventListener('click', () => {
  for (let i = 0; i < 5; i++) setTimeout(() => jouerBruit('jarre'), i * 180)
})
