import * as THREE from 'three'
import './style.css'
import { Player, LANES } from './player'
import { Opponent } from './opponent'
import {
  Track,
  SPRINT_ZONE,
  COURSE_LENGTH,
  PLATEFORME_H,
  TAILLE_OBSTACLE,
  type Tresor,
} from './track'
import { ajouterScore, ajouterInfini } from './scores'
import { Input } from './input'
import { Net, type RemotePlayer, type LobbyView } from './net'
import { Bot, PROFILS, BOTS_MAX, construireRangees } from './bot'
import {
  DEPART,
  ETAPES,
  PLAN_NEIGE,
  PLATEFORMES_NEIGE,
  MURS_NEIGE,
  JARRES_NEIGE,
  FIN_APPRENTISSAGE,
  BIOME_NEIGE,
  BIOME_PONT,
  type EtapeTuto,
} from './tuto'
import { PERSO_ID, cssColor, skinEnTexte } from './roster'
import {
  PARCHEMINS,
  TIRAGE,
  SLOTS_MAX,
  VENT_BOOST,
  VENT_DUREE,
  GRUE_DUREE,
  KUSARIGAMA_FACTEUR,
  KUSARIGAMA_DUREE,
  ARMURE_SOLIDITE,
  ARMURE_COUT_MUR,
  ARMURE_COUT_PETIT,
  FUMIGENE_DUREE,
  SENBON_DUREE,
  ONMYOJI_VITESSE,
  LUEUR_DUREE,
  type ParcheminKind,
} from './parchemin'
import { Menu, escapeHtml } from './menu'
import {
  connecter,
  monProfil,
  monJeton,
  rafraichirProfil,
  chargerBoutique,
  mesArticles,
  couleursDebloquees,
  acheter as acheterArticle,
  connexionGoogle,
  deconnecter,
  estAnonyme,
  monEmail,
  googleActif,
  inscriptionEmail,
  connexionEmail,
  verserPots,
} from './compte'
import {
  souffleDeVent,
  jouerBruit,
  setVolumeSfx,
  sonDeSoin,
  feuAmbiance,
  oiseauxAmbiance,
  prechauffeFeu,
} from './sfx'
import { BIOMES } from './biomes'
import type { Quality } from './settings'
import { Musique } from './audio'

// La longueur de la course vit dans track.ts — le module qui possède la piste.
// L'écran des meilleurs temps en a besoin lui aussi (sa clé de rangement la
// porte), et il ne peut pas importer main.ts sans boucler.

/**
 * ————— Le sprint final —————
 * Sur les SPRINT_ZONE derniers mètres, marteler l'écran fait accélérer.
 * Réglages calibrés par simulation, pour tenir deux promesses contradictoires :
 *
 *  · Départager deux joueurs au coude-à-coude : à fond, on gagne 0,37 s (≈ 10 m).
 *  · Ne PAS refaire la course : un trébuchement coûte 0,53 s (≈ 15 m). Le sprint
 *    parfait vaut moins que ça, donc il ne rattrape jamais une vraie faute.
 *
 * Ne pas marteler ne pénalise pas : on garde la vitesse normale, c'est un bonus.
 *
 * ⚠️ Aucun passif de guerrier ne touche à ces valeurs : dans les 120 derniers
 * mètres, tout le monde est à armes égales.
 */
const SPRINT_BOOST = 0.15 // +15 % de vitesse à jauge pleine
const SPRINT_FULL_RATE = 8 // taps/s pour remplir la jauge — au-delà, plus rien
const SPRINT_WINDOW = 0.6 // durée sur laquelle on mesure la cadence (s)

/**
 * ————— Le combat —————
 * Frapper COÛTE de la vitesse ; c'est la CHAÎNE qui rembourse. Un coup isolé
 * est à peu près neutre — taper au hasard ne fait pas gagner la course. Une
 * chaîne de trois ou quatre jarres, elle, rapporte vraiment.
 *
 * L'étalon reste le trébuchement (on perd ~65 % de sa vitesse) : même une
 * chaîne parfaite vaut moins que d'éviter une faute. On ajoute une compétence
 * par-dessus la course, on ne la remplace pas.
 *
 * Et comme le rebond garde en l'air, enchaîner survole les obstacles : c'est
 * la « route rapide » des bons joueurs, payée par le risque de rater un coup.
 */
const COUP_COUT = 0.06 // −6 % de vitesse à chaque coup porté
const COUP_GAIN = 1.5 // m/s rendus, MULTIPLIÉS par le rang dans la chaîne
const CHAINE_MAX = 5 // au-delà, le rang ne compte plus (anti-spam)
const CHAINE_FENETRE = 1.4 // s sans toucher → la chaîne retombe

/**
 * Ce qu'on appelle « toucher » un coureur : il faut être SUR lui, pas devant.
 * Les jarres, elles, passent par une vraie intersection de boîtes — un rival
 * n'a pas de corps physique de notre côté, d'où ces deux marges.
 */
const CONTACT_Z = 1.8 // écart de distance toléré, en mètres
const CONTACT_Y = 1.8 // écart de hauteur toléré

/**
 * L'allonge de la lame SOUS les pieds. Un sabre tranche ce qu'on survole de
 * peu — sans cette allonge il faudrait heurter la jarre du corps, et la
 * fenêtre de frappe se réduirait à deux mètres : injouable au doigt.
 *
 * Elle ne rouvre PAS la porte à la montée infinie : on rebondit toujours
 * depuis le sommet de la jarre (rebondSur), donc chaque bond repart du même
 * niveau quoi qu'il arrive.
 */
const PORTEE_LAME = 1.3

/**
 * Percuter une jarre au lieu de la frapper : on garde 72 % de sa vitesse.
 * Bien moins qu'un obstacle (35 %) — c'est une poterie, pas un mur — mais
 * assez pour qu'une grappe sur sa ligne ne s'ignore jamais.
 */
const JARRE_FREIN = 0.72

/**
 * ————— Le prix d'une escalade —————
 *
 * Percuter une plateforme sans rampe fait perdre **1,0 s** : le double d'un
 * trébuchement (0,53 s), et de loin la plus lourde erreur du jeu. C'est
 * volontaire — ce n'est pas une maladresse mais un mauvais itinéraire, et il
 * faut que la rampe VAILLE le détour. Ça reste rattrapable : un sprint final
 * parfait rend 0,42 s.
 *
 * Le freinage dure plus longtemps que la montée elle-même (0,45 s) : on se
 * hisse, puis on repart mollement. Les deux chiffres sont calibrés ensemble par
 * simulation — cf. test-escalade.
 */
const ESCALADE_FREIN = 0.16
const ESCALADE_FREIN_DUREE = 1.12

/**
 * ————— Les deux vitesses du 2ᵉ ACTE —————
 * Elles n'existent QUE dans le corps de la course : ni pendant le départ
 * canon, ni dans le sprint final, où seul le martèlement compte.
 *
 * **La ligne droite** récompense la course propre : tenir sa voie fait monter
 * la vitesse. Changer de ligne remet le compteur à zéro — c'est le « très
 * léger » coût d'un déplacement, une occasion manquée plutôt qu'une punition.
 *
 * **L'aspiration** est l'inverse : elle récompense celui qui est DERRIÈRE.
 * Se glisser dans le sillage d'un rival, sur sa ligne, fait gagner du terrain.
 * C'est la mécanique de rattrapage des jeux de course — elle garde les duels
 * serrés jusqu'au bout au lieu de laisser filer celui qui mène.
 *
 * Les deux se cumulent, et c'est voulu : ça pose un choix permanent — tenir
 * MA ligne pour l'élan, ou aller chercher SA ligne pour le sillage ?
 *
 * ⚠️ CALIBRAGE — la simulation a corrigé une erreur d'intuition. Ces bonus
 * courent sur TOUT le 2ᵉ acte (~70 s), là où le sprint final ne dure que 4 s :
 * des pourcentages qui semblent modestes y deviennent écrasants. À +6 % / +9 %,
 * ils faisaient gagner 9,25 s — vingt fois le sprint final. Ramenés ici à :
 *
 *   · ligne droite tenue à fond ....... 1,25 s
 *   · aspiration collée en permanence .. 2,07 s
 *   · jeu réaliste (les deux à 50 %) ... 1,65 s
 *
 * Les étalons du jeu : un trébuchement coûte 0,53 s, un sprint final parfait
 * en rapporte 0,42. Bien se placer sur toute une course vaut donc environ
 * trois fautes évitées : ça compte, sans jamais remplacer l'esquive.
 */
const LIGNE_BOOST = 0.018 // +1,8 % de vitesse à jauge pleine
const LIGNE_PLEIN = 3 // secondes de course droite pour la remplir
const ASPI_BOOST = 0.03 // +3 % collé au rival
const ASPI_MIN = 2 // plus près, on le double : le sillage n'a plus de sens
const ASPI_MAX = 16 // plus loin, on est hors de son sillage

/**
 * ————— ⚔️ Le duel au corps à corps —————
 * Frapper le rival, c'est la vraie raison d'être du combat.
 *
 * Le client n'a plus de « portée » : il exige un vrai CONTACT (cf. CONTACT_Z /
 * CONTACT_Y). Les 5 m que le serveur revérifie deviennent donc un simple
 * garde-fou — largement au-dessus de ce que le jeu autorise, il ne rejettera
 * jamais un coup honnête, mais il coupe court à un client bidouillé.
 *
 * Encaisser coûte plus cher qu'une jarre (72 %) mais moins qu'un mur (35 %) :
 * un coup du rival fait mal sans décider la course à lui seul — et le serveur
 * laisse 1,5 s de répit à la victime, on ne matraque pas un joueur à terre.
 */
const PVP_FREIN = 0.55

// ————— La scène 3D —————
const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x151a2c) // nuit indigo
scene.fog = new THREE.Fog(0x151a2c, 30, 85) // la brume cache l'apparition des obstacles

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 200)
camera.position.set(0, 4.4, 7.5)
camera.lookAt(0, 1.2, -8)

// Lumières : clair de lune + lueur d'ambiance
const ambient = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 0.9)
const moon = new THREE.DirectionalLight(0xdfe8ff, 1.4)
moon.position.set(-6, 12, -4)
scene.add(ambient, moon)

const player = new Player(scene)
const track = new Track(scene)

// ————— Les adversaires en ligne (jusqu'à 9 avatars) —————
// Un pool d'avatars fantômes qu'on ASSIGNE aux joueurs présents dans le salon.
// On ne recrée jamais de mesh en pleine course : on recycle.
const MAX_OPP = 9
const oppPool = Array.from({ length: MAX_OPP }, () => new Opponent(scene))

/** Un adversaire réel : son avatar + ce qu'on garde pour le classement. */
interface Rival {
  opp: Opponent
  id: string
  name: string
  rank: number
  finished: boolean
  /**
   * 👻 Est-il encore relié ?
   *
   * ⚠️ Un joueur qui coupe garde sa place 30 s côté serveur (`onDrop`), le
   * temps de revenir. Il reste donc dans la liste, et c'est voulu. Mais il ne
   * doit plus être DESSINÉ en train de courir.
   */
  connecte: boolean
  /** Était-il en l'air à l'image précédente ? (pour la poussière d'atterrissage) */
  enLAir: boolean
}
/** Les rivaux du salon, par identifiant réseau. */
const rivals = new Map<string, Rival>()

/** Rend tous les avatars au pool et vide la table (fin de course, retour menu). */
function clearRivals() {
  for (const r of rivals.values()) {
    r.opp.active = false
    r.opp.reset()
  }
  rivals.clear()
}

/**
 * Met les avatars en phase avec la liste du serveur : on crée ceux qui
 * arrivent, on libère ceux qui partent, on nourrit l'extrapolation des autres.
 */
function syncRivals(others: RemotePlayer[]) {
  const present = new Set(others.map((p) => p.id))
  for (const [id, r] of rivals) {
    if (!present.has(id)) {
      r.opp.active = false
      r.opp.reset()
      rivals.delete(id)
    }
  }
  for (const p of others) {
    let r = rivals.get(p.id)
    if (!r) {
      const pris = new Set([...rivals.values()].map((x) => x.opp))
      const libre = oppPool.find((o) => !pris.has(o))
      if (!libre) continue // plus de 9 rivaux : les suivants ne sont pas dessinés
      libre.active = true
      libre.reset(p.startLane)
      r = { opp: libre, id: p.id, name: '', rank: 0, finished: false, connecte: true, enLAir: false }
      rivals.set(p.id, r)
    }
    r.opp.setFighter(p.fighter, p.skin)
    r.name = p.name || 'Rival'
    r.opp.setName(r.name)
    r.rank = p.rank

    /*
     * ————— 👻 LE COUREUR FANTÔME —————
     *
     * Un joueur qui coupe — écran verrouillé, appli en arrière-plan, réseau
     * qui saute — garde sa place 30 secondes le temps de revenir. Il reste
     * donc dans la liste que le serveur envoie, et il le FAUT : sa place, son
     * rang et son chrono l'attendent.
     *
     * ⚠️ Mais ses positions, elles, ne viennent plus. Et l'avatar ne s'arrête
     * pas pour autant : l'extrapolation le fait glisser sur sa dernière
     * vitesse connue, tout droit, pendant une demi-minute. On voyait donc un
     * rival courir seul, sans personne derrière — et l'on croyait à un bug
     * d'affichage alors que c'était un joueur parti.
     *
     * Le client recevait `connected` depuis toujours et ne s'en servait pas.
     * `active = false` suffit : `Opponent.update` masque le maillage et sort
     * aussitôt, donc plus de dessin ET plus d'extrapolation. On garde en
     * revanche le rival dans la table — il compte encore au classement, et il
     * reprendra sa place tel quel si le réseau revient.
     */
    r.connecte = p.connected
    r.opp.active = p.connected
    if (!p.connected) continue

    r.opp.latency = net.rtt / 2
    r.opp.onNetUpdate(
      { lane: p.lane, y: p.y, distance: p.distance, sliding: p.sliding },
      net.ageOf(p.at)
    )
    if (p.finished && !r.finished) {
      r.finished = true
      if (state === 'course') toast(`⛩️ ${r.name} a franchi le torii !`)
    }
  }
}

/**
 * Le rival le plus proche DEVANT nous : la cible naturelle d'un sort offensif.
 *
 * ⚠️ Ni les arrivés, ni les DÉCONNECTÉS. Viser quelqu'un qui a coupé gâchait un
 * parchemin sur un adversaire qu'on ne voit même plus — et le sort partait vers
 * une position figée, donc dans le vide.
 */
function rivalDevant(): Rival | undefined {
  return [...rivals.values()]
    .filter((r) => r.connecte && !r.finished && r.opp.distanceNow > distance)
    .sort((a, b) => a.opp.distanceNow - b.opp.distanceNow)[0]
}

// Les 4 rivaux existent dès le départ ; seuls les `nbBots` premiers courent.
const bots = PROFILS.map((p) => new Bot(scene, p))

/**
 * La qualité graphique ne joue QUE sur le nombre de pixels dessinés — c'est de
 * loin le plus gros coût sur mobile, et diviser par 2 le pixelRatio, c'est 4
 * fois moins de pixels.
 *
 * On ne touche SURTOUT pas à la brume : c'est elle qui décide à quelle distance
 * on découvre les obstacles. La rapprocher pour gagner des images/s donnerait
 * moins de temps pour réagir — ce serait un réglage de difficulté déguisé en
 * réglage graphique, et un désavantage en duel.
 */
function applyQuality(q: Quality) {
  const mobile = matchMedia('(pointer: coarse)').matches
  const cap = q === 'bas' ? 1 : q === 'haut' ? 2 : mobile ? 1.5 : 2
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap))
  resize() // setSize doit être rappelé après un changement de pixelRatio
}

// ————— L'interface —————
const scoreEl = document.getElementById('score')!
const toastEl = document.getElementById('toast')!
const countEl = document.getElementById('count')!
const flashEl = document.getElementById('flash')!
const fumeeEl = document.getElementById('fumee')!
/** 🎯 La terre du kunai : des éclaboussures sur les BORDS de l'écran, jusqu'au 🍵 thé */
const terreEl = document.getElementById('terre')!
// ♾️ Le brasier du mode infini. Toute sa mise en scène vit dans la CSS ; le jeu
// ne touche qu'à une variable, `--proche` (cf. #brasier dans style.css).
const brasierEl = document.getElementById('brasier')!
const degatsEl = document.getElementById('degats')!
const degatsPucesEl = document.getElementById('degatsPuces')!
const degatsMotEl = document.getElementById('degatsMot')!
const jarresEl = document.getElementById('jarres')!
const jarresNEl = document.getElementById('jarresN')!
const jarresPctEl = document.getElementById('jarresPct')!
const pauseEl = document.getElementById('pause')!
const pauseTitreEl = document.getElementById('pauseTitre')!
const pauseMotEl = document.getElementById('pauseMot')!
const btnPauseEl = document.getElementById('btnPause')!
const btnReprendreEl = document.getElementById('btnReprendre')!
const btnQuitterPartieEl = document.getElementById('btnQuitterPartie')!
const progressEl = document.getElementById('progressfill')!
const gapEl = document.getElementById('gap')!
const aspiEl = document.getElementById('aspi')!
const sprintEl = document.getElementById('sprint')!
const sprintFillEl = document.getElementById('sprintfill')!
const slotEls = [document.getElementById('slot0')!, document.getElementById('slot1')!]
const progressbarEl = document.getElementById('progressbar')!
const sprintLabelEl = document.getElementById('sprintlabel')!
const botRowEl = document.getElementById('botrow')!
const botNamesEl = document.getElementById('botnames')!
const btnGo = document.getElementById('btnGo')!

let toastTimer = 0
function toast(text: string) {
  toastEl.textContent = text
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400)
}

function flash() {
  flashEl.classList.add('show')
  setTimeout(() => flashEl.classList.remove('show'), 120)
}

// ————— L'état de la course —————
let state: 'menu' | 'attente' | 'depart' | 'course' | 'fini' = 'menu'
let online = false // course en ligne ou entraînement ?
let raceGo = false // le serveur a-t-il donné le GO ?
let time = 0 // le chrono
let distance = 0 // mètres parcourus
let speed = 0
let countdown = 0 // secondes avant le GO !
let stumble = 0 // invincibilité après un trébuchement
/**
 * ⚡ Les shaders de la course sont-ils déjà compilés ?
 *
 * Remis à faux à chaque départ : d'une course à l'autre le biome de tête ne
 * change pas, mais la graine, elle, change — les matières croisées sur les
 * premiers mètres ne sont pas forcément les mêmes. Repayer une compilation
 * déjà faite ne coûte rien (three.js garde son cache de programmes), la sauter
 * à tort coûterait le hoquet qu'on cherche justement à supprimer.
 */
let shadersPrets = false
/**
 * 🔄 Un « rejouer » en ligne est en cours : il attend que le salon revienne.
 *
 * Le serveur n'accepte le départ que depuis le salon, et le retour au salon est
 * un aller-retour réseau. On note donc l'intention ici, et `onLobby` la
 * consomme quand le salon est réellement là.
 */
let relancerDesLobby = false

/**
 * ⏳ Combien de temps on passe SUR LA GRILLE avant le GO, en ms.
 *
 * Le décompte total est posé par le serveur (`startAt`, l'instant du GO) ; ce
 * chiffre-ci ne décide que du moment où l'on QUITTE LE SALON pour rejoindre la
 * piste. Les secondes d'avant se passent au salon, à regarder qui court.
 *
 * ⚠️ Il a un jumeau côté serveur (`PISTE_MS` dans RaceRoom.ts), et les deux
 * doivent rester d'accord — mais une divergence ne casserait RIEN : le GO tombe
 * à la milliseconde près sur tous les téléphones quoi qu'il arrive, puisqu'il
 * ne dépend que de `startAt`. On verrait seulement la grille un peu plus tôt ou
 * un peu plus tard.
 */
const PISTE_MS = 4_000

/**
 * ⚔️ La graine d'une course lancée mais pas encore rejointe.
 *
 * Non nulle pendant les secondes de salon qui précèdent la grille. C'est la
 * boucle de jeu qui la consomme, au moment dit.
 */
let departImminent: number | null = null
/**
 * 🧪 Le banc d'essai fige la course (cf. le guichet `__sorts` en fin de
 * fichier). Le monde s'arrête, mais TOUT LE RESTE continue de tourner : les
 * sorts, leurs minuteurs, les brumes, les chaînes. C'est ce qui permet de
 * regarder un effet posément au lieu de le subir en esquivant des barrières.
 *
 * `import.meta.env.DEV` fait disparaître le guichet du bundle de production —
 * ce drapeau y reste donc à `false` pour toujours.
 */
let gele = false

/*
 * ————— ⏸ La pause —————
 *
 * ⚠️ ELLE N'EXISTE PAS EN LIGNE, et ce n'est pas un oubli : les autres
 * continuent de courir. Figer sa propre piste pendant que la course avance
 * donnerait un écran menteur — on reprendrait cinq secondes plus tard en ayant
 * traversé cinq secondes d'obstacles sans les voir. Le bouton reste, mais il
 * n'y propose que de QUITTER.
 *
 * Hors ligne, on met `dt` à zéro plutôt que de traiter chaque cas : chrono,
 * distance, sorts, flammes, tout est écrit en `x += v * dt` et s'arrête donc de
 * lui-même. Un drapeau lu à un seul endroit ne peut pas être oublié dans un
 * coin du code.
 */
let enPause = false

/*
 * ————— ♾️ LE MODE INFINI —————
 *
 * Pas de ligne d'arrivée : on court jusqu'à ce que les flammes vous rattrapent.
 * Ce qui les rapproche n'est pas le temps, c'est la MALADRESSE — cinq obstacles
 * encaissés et c'est fini.
 *
 * ⚠️ CINQ COUPS, PAS CINQ RENCONTRES. Ne comptent que les vrais trébuchements :
 *   · l'armure qui encaisse ne compte pas — c'est tout son intérêt ;
 *   · une escalade ne compte pas — on a franchi l'obstacle, pas subi.
 * Les deux sont déjà des branches distinctes au moment de la collision, si
 * bien que la règle s'écrit là où le joueur perd VRAIMENT sa vitesse, et nulle
 * part ailleurs.
 */
let modeInfini = false
/**
 * ————— 🎓 LE TUTORIEL —————
 *
 * Deux temps, et l'état tient en trois variables :
 *
 *  · `modeTuto`  — on y est ou non ; il coupe les scores, les pots et le podium ;
 *  · `phaseTuto` — `neige` (on apprend) puis `pont` (on court) ;
 *  · `etapeTuto` — quelle fiche vient ensuite, dans `ETAPES`.
 *
 * ⚠️ Rien n'est enregistré pendant un tutoriel : ni record, ni ligne au
 * tableau, ni monnaie. On le rejoue autant qu'on veut, et un classement qu'on
 * remplit en répétant ses gammes ne classe plus rien.
 */
let modeTuto = false
let phaseTuto: 'neige' | 'pont' = 'neige'
let etapeTuto = 0
/**
 * Le geste que la fiche attend, ou `null` si la course tourne.
 *
 * ⚠️ On attend le VRAI geste, pas un « appuyez pour continuer ». Faire le
 * mouvement à l'arrêt, le voir marcher, puis le refaire trois secondes plus
 * tard devant l'obstacle : c'est la seule façon d'apprendre un geste. Lire
 * « swipe vers le haut » et cliquer OK ne fait apprendre que le bouton OK.
 */
let tutoAttend: 'saut' | 'glissade' | 'ligne' | 'tap' | null = null
/**
 * 🔒 Les changements de ligne sont-ils permis ?
 *
 * ⚠️ Faux au début du tutoriel, et c'est délibéré. Un débutant qui dérive sur
 * le côté rate l'obstacle qu'on vient de lui expliquer et ne comprend pas
 * pourquoi : la leçon portait sur le saut, elle s'est jouée sur la ligne. Les
 * lignes s'ouvrent à l'étape qui les enseigne, et ne se referment plus.
 */
let tutoLignes = false
/** 🚀 La fiche du départ canon a-t-elle été montrée pour cette course ? */
let tutoDepartVu = false
/** Combien de coups encaissés, de 0 à DEGATS_MAX. Ne redescend jamais. */
let degats = 0
const DEGATS_MAX = 5

/*
 * ————— 🏺 La lourdeur des jarres —————
 *
 * En course sans fin, percuter une poterie ne coûte plus seulement l'instant du
 * choc : ça ALOURDIT, et ça reste. Chaque jarre encaissée retire un cran de
 * vitesse de croisière, définitivement — jusqu'au 🍵 thé, qui lave tout.
 *
 * ⚠️ C'est ce qui redonne un rôle au thé. Il ne lavait que les afflictions
 * (poison, chaînes, fumigène), toutes envoyées par un ADVERSAIRE — donc
 * inexistantes ici. Un rouleau qui ne peut jamais rien soigner est un rouleau
 * mort ; celui-ci répond maintenant à un mal qu'on peut vraiment attraper.
 *
 * ⚠️ ET IL Y A UN PLANCHER. Sans lui, une poignée de jarres ramènerait la
 * course à l'arrêt et il n'y aurait plus rien à jouer — juste à attendre les
 * flammes. On perd jusqu'à 40 % de croisière, pas davantage : assez pour que ça
 * pèse, jamais assez pour que la partie soit finie sans l'être.
 */
let lourdeur = 0
const LOURDEUR_PAR_JARRE = 0.07
const LOURDEUR_PLANCHER = 0.6

/**
 * ♾️ Le dernier tronçon franchi — la « carte » qu'on vient de boucler.
 *
 * Sert à repérer le moment où l'on recommence : c'est là qu'on encaisse les
 * pots verts, comme une course en ligne verse les siens à l'arrivée.
 *
 * ⚠️ BOUCLER UNE CARTE NE REND AUCUNE VIE. On garde le même droit à l'erreur du
 * début à la fin : sinon la partie ne finirait jamais pour qui tient un tour, et
 * « cinq obstacles » ne voudrait plus rien dire — ce serait « cinq par carte »,
 * une règle qu'on ne peut plus énoncer d'une phrase.
 */
let dernierTroncon = 0

/**
 * L'avancement dans la course, de 0 à 1 — ce qui fait monter la croisière.
 *
 * ⚠️ EN INFINI, ÇA PLAFONNE. `distance / COURSE_LENGTH` grandit sans borne
 * quand il n'y a plus de ligne d'arrivée : la vitesse de croisière doublerait
 * tous les deux kilomètres et le jeu deviendrait injouable au bout de quelques
 * minutes, non par difficulté mais par absurdité. On monte donc jusqu'au
 * maximum d'une course ordinaire, puis on s'y tient — la tension vient des
 * flammes, pas d'une vitesse que personne ne peut plus tenir.
 */
function avancement() {
  const t = distance / COURSE_LENGTH
  return modeInfini ? Math.min(1, t) : t
}

/**
 * 🏺 Ce qui reste de la vitesse de croisière, une fois les jarres encaissées.
 * 1 quand on est net ; jamais moins que le plancher (cf. LOURDEUR_PLANCHER).
 */
function facteurLourdeur() {
  if (!modeInfini || lourdeur === 0) return 1
  return Math.max(LOURDEUR_PLANCHER, 1 - LOURDEUR_PAR_JARRE * lourdeur)
}

/**
 * Est-on dans les derniers mètres, ceux du sprint final ?
 *
 * ⚠️ Toujours FAUX en infini. Le test d'origine (`distance >= COURSE_LENGTH -
 * SPRINT_ZONE`) deviendrait vrai pour de bon passé 1 800 m, et le jeu resterait
 * en « sprint final » jusqu'à la fin de la partie : bannière collée à l'écran,
 * foulée pressée en permanence, sorts bridés. Une course sans fin n'a pas de
 * dernière ligne droite.
 */
function versLaFin() {
  return !modeInfini && distance >= COURSE_LENGTH - SPRINT_ZONE
}
let escaladeT = 0 // temps de freinage restant après une escalade
let stumblePrec = 0 // sa valeur à l'image d'avant : sert à repérer le choc
let netTimer = 0 // pour n'envoyer notre position que 10 fois/s
let sprintTaps: number[] = [] // instants des derniers taps → cadence
let sprintCharge = 0 // la jauge de sprint, 0 → 1
let sprintSeen = false // la bannière ne s'annonce qu'une fois
let rankTimer = 0 // les tetes se redessinent 10 fois/s, pas 60
let dernierChiffre = -1 // le dernier chiffre du décompte annoncé (pour ne biper qu'une fois)
let ligneCharge = 0 // la jauge de course droite, 0 → 1
let aspiCharge = 0 // la jauge d'aspiration, 0 → 1
let chaine = 0 // coups enchaînés sans toucher le sol de la chaîne
let chaineT = 0 // temps restant pour enchaîner (sinon la chaîne retombe)

// ————— Les rivaux d'entraînement —————
// Le choix est gardé sur le téléphone : on reprend l'entraînement où on l'a
// laissé, sans re-cliquer à chaque course.
const CLE_BOTS = 'kurogane-bots'
let nbBots = Math.min(BOTS_MAX, Math.max(1, Number(localStorage.getItem(CLE_BOTS)) || 1))

/**
 * Les têtes sur la colonne de progression.
 *
 * Un disque à la couleur de l'armure, barré du bandeau : le même langage que
 * les corps en piste, donc on reconnaît qui est qui sans légende. Elles
 * montent du bas (le départ) vers le haut (le torii).
 */
interface Coureur {
  wrap: HTMLElement
  tete: HTMLElement
  etiq: HTMLElement
}

function makeCoureur(moi = false): Coureur {
  const wrap = document.createElement('div')
  wrap.className = moi ? 'coureur moi' : 'coureur hidden'
  const tete = document.createElement('div')
  tete.className = 'tete'
  const etiq = document.createElement('span')
  etiq.className = 'etiq'
  wrap.append(tete, etiq)
  progressbarEl.appendChild(wrap)
  return { wrap, tete, etiq }
}

/** La tienne : toujours là, toujours au-dessus des autres. */
const coureurMoi = makeCoureur(true)

/**
 * Un banc de têtes pour les rivaux, ASSIGNÉ à chaque rafraîchissement.
 *
 * Un banc plutôt qu'une tête par bot : en ligne, les rivaux vont et viennent
 * et ne sont pas des bots. Le même banc sert donc les deux modes — sinon le
 * duel n'aurait aucune tête sur la colonne, et perdrait l'information que le
 * panneau de classement portait avant d'être supprimé.
 */
const TETES_RIVAUX = 9
const tetesRivaux = Array.from({ length: TETES_RIVAUX }, () => makeCoureur())

// ————— Les parchemins —————
// Une FILE d'attente : on lance toujours le plus ancien ramassé. Impossible de
// garder le bon sort au chaud — c'est ce qui rend le ramassage tendu.
let slots: ParcheminKind[] = []
let ventFin = 0 // 🌀 le dash court jusqu'à cet instant du chrono
let kusarigamaFin = 0 // ⛓️ on est bridé jusqu'à cet instant
let chaineToastT = 0 // anti-spam du message « clouté au sol »
let armure = 0 // 🛡️ solidité restante de l'armure (0 = pas d'armure)
let grueFin = 0 // 🕊️ le double saut est armé jusqu'ici
let miroirFin = 0 // 🪞 la parade est levée jusqu'ici
let fumigeneFin = 0 // 💨 l'écran est noyé de fumée
let senbonFin = 0 // ☠️ l'écran ondule

/**
 * ————— 🔮 Le portail : un orbe ÉLECTRIQUE —————
 *
 * Une bille unie ne disait rien de la violence du sort le plus brutal du jeu.
 * On le monte comme une boule de foudre : un cœur incandescent, un anneau qui
 * tourne, et des arcs qui se redessinent À CHAQUE IMAGE. C'est ce redessin
 * permanent qui fait l'électricité — des éclairs figés ne crépitent pas.
 *
 * Le portail est BLEU, comme la foudre : c'est la couleur qu'on lit
 * instantanément comme « électrique », et elle le distingue de tout le reste du
 * jeu (le rouge du trébuchement, l'or du torii, l'orange de l'explosion).
 *
 * Elle reste portée par le portail plutôt que codée en dur dans chaque
 * maillage : le halo, les arcs et la brûlure laissée sur le mur la lisent tous
 * depuis lui. Le jour où un rival lancera son propre portail, lui donner une
 * autre teinte tiendra en une ligne — et sa brûlure suivra toute seule.
 */
const PORTAIL_BLEU = 0x4db8ff

/**
 * L'altitude de vol du portail, en mètres.
 *
 * ⚠️ Elle est LUE par la piste (`premierBarrage`) autant qu'elle place le
 * maillage. C'était un `1.1` écrit en dur au seul endroit du dessin, et la
 * collision, elle, ne connaissait aucune hauteur : l'orbe s'enfonçait dans les
 * rampes. Une pente ne peut pas dire où l'on tape sans savoir à quelle hauteur
 * on arrive — les deux usages partagent donc désormais le même chiffre.
 */
const PORTAIL_Y = 1.1

/**
 * 🔮 Combien de temps la boule tient sa ligne avant de commencer à tomber.
 *
 * Deux secondes : assez pour qu'on la voie filer droit et comprendre qu'elle
 * vole, assez court pour que sa chute arrive encore dans le champ. Passé ce
 * délai elle plonge, touche le sol et éclate — c'est ce qui lui donne enfin une
 * portée à elle, au lieu de dépendre uniquement du prochain mur.
 */
const PORTAIL_PLANE = 2
/**
 * La pesanteur de la boule, en m/s². Volontairement le QUART d'une vraie
 * gravité : elle doit s'affaisser, pas piquer. Depuis 1,10 m, la chute dure un
 * peu moins d'une seconde — on a le temps de la voir descendre.
 */
const PORTAIL_PESANTEUR = 2.4

/**
 * 🔮 Le portail en vol : il file tout droit dans SA ligne jusqu'au 1er mur.
 *
 * `y` est sa hauteur ACTUELLE, et `t0` l'instant du lancer. Les deux vont
 * ensemble : la boule part à la hauteur du lanceur — saut compris — tient ce
 * niveau `PORTAIL_PLANE` secondes, puis s'affaisse jusqu'au sol.
 */
let portail:
  | { d: number; lane: number; couleur: number; sens: 1 | -1; y: number; vy: number; t0: number }
  | null = null

/**
 * 👻 La trêve du départ : pendant les 5 premières secondes, personne ne peut
 * attaquer personne. Ni lame, ni sort, ni portail — le peloton se déploie
 * d'abord. Sans elle, le premier kunai partait sur la grille, avant même
 * d'avoir pu esquiver quoi que ce soit.
 * Le serveur applique LA MÊME fenêtre (cf. RaceRoom) : un client trafiqué qui
 * enverrait un sort plus tôt serait simplement ignoré.
 */
const FANTOME_DUREE = 5
const enTreve = () => state === 'course' && time < FANTOME_DUREE

const portailGroup = new THREE.Group()
// Le cœur : presque blanc, c'est lui qui « brûle » au centre
const portailCoeur = new THREE.Mesh(
  new THREE.SphereGeometry(0.2, 12, 10),
  new THREE.MeshBasicMaterial({ color: 0xf2fbff, blending: THREE.AdditiveBlending, depthWrite: false })
)
// Le halo : la lueur diffuse autour du cœur
const portailHalo = new THREE.Mesh(
  new THREE.SphereGeometry(0.46, 14, 12),
  new THREE.MeshBasicMaterial({
    color: PORTAIL_BLEU,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
)
// L'anneau : le cercle net de la référence, qui tourne sur lui-même
const portailAnneau = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.055, 8, 28),
  new THREE.MeshBasicMaterial({
    color: PORTAIL_BLEU,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
)
portailGroup.add(portailCoeur, portailHalo, portailAnneau)
portailGroup.visible = false
scene.add(portailGroup)

/**
 * Les arcs électriques. Chacun est une polyligne de 6 points qu'on RELANCE au
 * hasard à chaque image : c'est le seul moyen d'obtenir un crépitement, et
 * c'est bien moins coûteux que d'animer une texture.
 */
const ARC_POINTS = 6
function makeArc(couleur: number): THREE.Line {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3))
  return new THREE.Line(
    g,
    new THREE.LineBasicMaterial({
      color: couleur,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
}

/** Redessine un arc : il part de l'anneau et gigote vers l'extérieur. */
function jitterArc(arc: THREE.Line, rayon: number, ampleur: number) {
  const pos = arc.geometry.getAttribute('position') as THREE.BufferAttribute
  const a = Math.random() * Math.PI * 2
  for (let i = 0; i < ARC_POINTS; i++) {
    const t = i / (ARC_POINTS - 1)
    const r = rayon * (0.45 + t * 0.95)
    pos.setXYZ(
      i,
      Math.cos(a) * r + (Math.random() - 0.5) * ampleur,
      Math.sin(a) * r + (Math.random() - 0.5) * ampleur,
      (Math.random() - 0.5) * ampleur * 0.6
    )
  }
  pos.needsUpdate = true
}

const PORTAIL_ARCS = 7
const portailArcs = Array.from({ length: PORTAIL_ARCS }, () => {
  const l = makeArc(0x9fe8ff)
  portailGroup.add(l)
  return l
})

/**
 * ————— 💥 L'impact contre un mur —————
 * Le portail ne se contente plus de disparaître : il ÉCLATE. Une gerbe d'arcs
 * qui crépitent une fraction de seconde, puis une trace brûlée qui reste sur
 * le mur — à la couleur du portail, pour qu'on sache lequel s'y est cassé.
 */
const IMPACT_ARCS = 9
const IMPACT_CREPITE = 0.4 // durée du crépitement
const IMPACT_TRACE = 1.8 // la brûlure s'efface bien après
const impactGroup = new THREE.Group()
const impactArcs = Array.from({ length: IMPACT_ARCS }, () => {
  const l = makeArc(PORTAIL_BLEU)
  impactGroup.add(l)
  return l
})
// La brûlure laissée sur la paroi
const impactTrace = new THREE.Mesh(
  new THREE.CircleGeometry(0.75, 20),
  new THREE.MeshBasicMaterial({
    color: PORTAIL_BLEU,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
)
impactGroup.add(impactTrace)
impactGroup.visible = false
scene.add(impactGroup)
let impactFin = 0

/** Le portail s'écrase ici, dans SA couleur. */
function portailImpact(pos: THREE.Vector3, couleur: number) {
  impactGroup.position.copy(pos)
  impactGroup.visible = true
  impactFin = time + IMPACT_TRACE
  for (const a of impactArcs) {
    ;(a.material as THREE.LineBasicMaterial).color.setHex(couleur)
    a.visible = true
  }
  const m = impactTrace.material as THREE.MeshBasicMaterial
  m.color.setHex(couleur)
  m.opacity = 0.85
}

/**
 * ————— Les projectiles : un sabotage, ça VOLE jusqu'à sa victime —————
 *
 * Une seule mécanique pour toutes les armes du jeu, avec une silhouette par
 * sort. Sans ça, on encaissait des sorts sans jamais RIEN voir venir — juste un
 * message et une vitesse qui s'effondre.
 *
 * Ils sont PUREMENT décoratifs : le sort a déjà frappé quand le projectile
 * part. Sa durée de vol ne doit rien coûter à personne, sinon on toucherait au
 * calibrage des parchemins (cf. README). C'est un traceur, pas un projectile.
 *
 * Le VOL EST FIXE (0,28 s) quelle que soit la distance : une lame qui met deux
 * secondes à traverser 60 m se lirait comme un ralenti, pas comme un jet.
 */
const PROJET_VOL = 0.28

/** La dégaine d'un sort : ce qu'on voit filer, et s'il tournoie. */
interface StyleProjet {
  geo: () => THREE.BufferGeometry
  couleur: number
  emissive: number
  /** Une lame tournoie ; une aiguille file droit, sinon elle ne pique plus. */
  tournoie: boolean
}
const STYLES_PROJET: Partial<Record<ParcheminKind, StyleProjet>> = {
  kunai: {
    geo: () => new THREE.BoxGeometry(0.16, 0.16, 1),
    couleur: 0xd8dfec,
    emissive: 0xe24b3a,
    tournoie: true,
  },
  senbon: {
    // Longue et fine : une aiguille se reconnaît à sa silhouette, pas à sa taille
    geo: () => new THREE.BoxGeometry(0.05, 0.05, 1.2),
    couleur: 0xd9c8ff,
    emissive: 0x9b5cff,
    tournoie: false,
  },
  kusarigama: {
    // Le poids au bout de la chaîne : compact et lourd
    geo: () => new THREE.SphereGeometry(0.2, 10, 8),
    couleur: 0x8a97ab,
    emissive: 0x3d4560,
    tournoie: true,
  },
}

interface Projet {
  mesh: THREE.Mesh
  kind: ParcheminKind
  de: THREE.Vector3
  a: THREE.Vector3
  /** Le corps visé : c'est LUI qu'on marquera d'une aura à l'arrivée. */
  cible: THREE.Object3D | null
  fin: number
  actif: boolean
}
const projets: Projet[] = []

/**
 * Envoie le projectile de `kind` de `de` vers `a`. `cible` (facultatif) est le
 * corps visé : à l'arrivée, c'est lui qui reçoit l'aura du sort.
 */
function lancerProjet(
  kind: ParcheminKind,
  de: THREE.Vector3,
  a: THREE.Vector3,
  cible: THREE.Object3D | null = null
) {
  const style = STYLES_PROJET[kind]
  if (!style) return
  let p = projets.find((x) => !x.actif && x.kind === kind)
  if (!p) {
    const mesh = new THREE.Mesh(
      style.geo(),
      new THREE.MeshStandardMaterial({
        color: style.couleur,
        emissive: style.emissive,
        emissiveIntensity: 0.45,
      })
    )
    mesh.visible = false
    scene.add(mesh)
    p = { mesh, kind, de: new THREE.Vector3(), a: new THREE.Vector3(), cible: null, fin: 0, actif: false }
    projets.push(p)
  }
  // On part de positions AU SOL : on relève le tir à hauteur de poitrine une
  // bonne fois ici, sinon la 1re image s'affiche dans les pieds.
  const poitrine = new THREE.Vector3(0, 0.6, 0)
  p.de.copy(de).add(poitrine)
  p.a.copy(a).add(poitrine)
  p.cible = cible
  p.fin = time + PROJET_VOL
  p.actif = true
  p.mesh.position.copy(p.de)
  p.mesh.visible = true
}

/**
 * ————— Chaque sort a sa FORME, plus une bulle pour tous —————
 *
 * La bulle colorée générique disait « il se passe quelque chose », jamais QUOI.
 * Chaque sort a donc désormais son propre corps : la brume du poison, l'aura
 * jaillissante du dash, les cercles montants du soin, l'anneau de la Grue, les
 * chaînes du Kusarigama, la glace de la Parade.
 *
 * La règle commune ne change pas : tant que l'effet se voit, l'effet court.
 */

/** Une tache douce, pour la brume et les auras — dégradé radial en mémoire. */
function makeBlobTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 64
  cv.height = 64
  const g = cv.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.95)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(cv)
}
const blobTex = makeBlobTexture()

// ————— La brume : le corps du ☠️ Senbon et du 🌀 Vent —————
// Plusieurs voiles doux qui dérivent chacun sur son orbite : c'est leur
// chevauchement IRRÉGULIER qui fait « brume ». Alignés, ils redeviendraient la
// boule qu'on cherche à éviter.
//
// Deux sorts s'en servent, à deux couleurs : le poison NOIE sa victime de
// violet, le dash enveloppe le coureur de cyan. Même matière, deux lectures —
// et une seule mécanique à régler.
const BRUME_VOILES = 6
const BRUME_POISON = 0x9b5cff
const BRUME_VENT = 0x8fe6ff
interface Brume {
  group: THREE.Group
  voiles: THREE.Mesh[]
  cible: THREE.Object3D
  fin: number
  duree: number
  /** Le 🍵 Thé ne balaie que les afflictions — jamais ton propre dash. */
  affliction: boolean
  actif: boolean
}
const brumes: Brume[] = []

function poserBrume(cible: THREE.Object3D, duree: number, couleur: number, affliction = true) {
  let b = brumes.find((x) => !x.actif)
  if (!b) {
    const group = new THREE.Group()
    const voiles: THREE.Mesh[] = []
    for (let i = 0; i < BRUME_VOILES; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.9, 1.9),
        new THREE.MeshBasicMaterial({
          map: blobTex,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      m.userData.phase = (i / BRUME_VOILES) * Math.PI * 2
      voiles.push(m)
      group.add(m)
    }
    group.visible = false
    scene.add(group)
    b = { group, voiles, cible, fin: 0, duree, affliction, actif: false }
    brumes.push(b)
  }
  for (const v of b.voiles) (v.material as THREE.MeshBasicMaterial).color.setHex(couleur)
  b.cible = cible
  b.duree = duree
  b.affliction = affliction
  b.fin = time + duree
  b.actif = true
  b.group.visible = true
}

/** Dissipe les brumes SUBIES par `cible` (le 🍵 Thé les balaie). */
function dissiperBrume(cible: THREE.Object3D) {
  for (const b of brumes) {
    if (b.actif && b.affliction && b.cible === cible) {
      b.actif = false
      b.group.visible = false
    }
  }
}

// ————— 🍵 Les cercles du Thé Purificateur —————
// Des anneaux clairs qui MONTENT le long du corps, du sol vers la tête : le
// sens de lecture du soin. Ils partent décalés dans le temps pour qu'on lise
// une vague, pas un clignotement.
const THE_CERCLES = 4
const THE_DUREE = 1.15
const theCercles: THREE.Mesh[] = []
for (let i = 0; i < THE_CERCLES; i++) {
  const m = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.045, 8, 26),
    new THREE.MeshBasicMaterial({
      color: 0xc9ffd8, // vert très clair, presque blanc : ça doit apaiser
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  m.rotation.x = -Math.PI / 2
  m.visible = false
  scene.add(m)
  theCercles.push(m)
}
let theFin = 0

// ————— 🕊️ L'anneau du Saut de la Grue —————
// Un cercle vert qui te ceint. Il SUIT le saut — hauteur comprise : c'est un
// pouvoir de saut, un anneau resté au sol pendant que tu voles ne dirait rien.
const GRUE_VERT = 0x5ef08a
const grueAnneau = new THREE.Mesh(
  new THREE.TorusGeometry(0.95, 0.055, 8, 32),
  new THREE.MeshBasicMaterial({
    color: GRUE_VERT,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
)
grueAnneau.rotation.x = -Math.PI / 2 // à plat, comme un cerceau autour du coureur
grueAnneau.visible = false
scene.add(grueAnneau)

// ————— ⛓️ Les chaînes du Kusarigama —————
// Une entrave qu'on VOIT : des maillons partent de la hanche de la victime et
// retombent au sol derrière elle, qu'elle traîne tant que le sort dure. Un
// simple halo gris ne disait pas « tu es enchaîné », juste « il se passe un truc ».
const CHAINE_MAILLONS = 9
interface Chaine {
  group: THREE.Group
  maillons: THREE.Mesh[]
  boulet: THREE.Mesh
  cible: THREE.Object3D
  fin: number
  duree: number
  actif: boolean
}
const chaines: Chaine[] = []

function poserChaines(cible: THREE.Object3D, duree: number) {
  let c = chaines.find((x) => !x.actif)
  if (!c) {
    const group = new THREE.Group()
    const mat = () =>
      new THREE.MeshStandardMaterial({ color: 0x9aa4b8, roughness: 0.45, metalness: 0.8 })
    const maillons: THREE.Mesh[] = []
    for (let i = 0; i < CHAINE_MAILLONS; i++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.032, 6, 10), mat())
      // Un maillon sur deux pivote d'un quart de tour : c'est ce qui fait lire
      // « chaîne » plutôt que « collier de rondelles ».
      m.rotation.y = (i % 2) * (Math.PI / 2)
      maillons.push(m)
      group.add(m)
    }
    const boulet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat())
    group.add(boulet)
    group.visible = false
    scene.add(group)
    c = { group, maillons, boulet, cible, fin: 0, duree, actif: false }
    chaines.push(c)
  }
  c.cible = cible
  c.duree = duree
  c.fin = time + duree
  c.actif = true
  c.group.visible = true
}

/** Coupe les chaînes qui pendent à `cible` (le 🍵 Thé les fait tomber). */
function libererChaines(cible: THREE.Object3D) {
  for (const c of chaines) {
    if (c.actif && c.cible === cible) {
      c.actif = false
      c.group.visible = false
    }
  }
}

// ————— 🪞 Le miroir de la Parade —————
// Une grande glace dressée derrière toi, face aux sorts qui arrivent — c'est
// de là qu'ils viennent, lancés par ceux qui te suivent. Un reflet balaie sa
// surface : sans ce glissement, un rectangle gris ne se lit pas comme un miroir.
function makeRefletTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = 128
  cv.height = 128
  const g = cv.getContext('2d')!
  // Le fond : un verre bleuté qui s'assombrit vers le bas
  const fond = g.createLinearGradient(0, 0, 0, 128)
  fond.addColorStop(0, '#cfe2ff')
  fond.addColorStop(1, '#6d86ad')
  g.fillStyle = fond
  g.fillRect(0, 0, 128, 128)
  // La bande de reflet, en biais : c'est elle qui glissera
  const bande = g.createLinearGradient(0, 128, 128, 0)
  bande.addColorStop(0, 'rgba(255,255,255,0)')
  bande.addColorStop(0.42, 'rgba(255,255,255,0)')
  bande.addColorStop(0.5, 'rgba(255,255,255,0.95)')
  bande.addColorStop(0.58, 'rgba(255,255,255,0)')
  bande.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = bande
  g.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  return tex
}
const miroirTex = makeRefletTexture()
const miroirGroup = new THREE.Group()
const miroirGlace = new THREE.Mesh(
  new THREE.PlaneGeometry(1.25, 1.55),
  new THREE.MeshBasicMaterial({
    map: miroirTex,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
)
// Le cadre : sans lui, la glace flotte comme un simple carré de lumière
const miroirCadre = new THREE.Mesh(
  new THREE.PlaneGeometry(1.42, 1.72),
  new THREE.MeshBasicMaterial({
    color: 0xd6ac5a,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
)
miroirCadre.position.z = -0.02
miroirGroup.add(miroirCadre, miroirGlace)
miroirGroup.visible = false
scene.add(miroirGroup)

/**
 * 🔮 La lueur jaune de l'échange. Elle enveloppe LES DEUX échangés : sans ça,
 * on se téléporterait sans comprendre ce qui vient d'arriver ni avec qui.
 */
function makeLueur() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd94a, transparent: true, opacity: 0.4 })
  )
}
const lueurJoueur = makeLueur()
const lueurRival = makeLueur()
lueurJoueur.visible = false
lueurRival.visible = false
scene.add(lueurJoueur, lueurRival)

let lueurFin = 0 // les deux lueurs brillent jusqu'à cet instant
let lueurCible: THREE.Object3D | null = null // le corps de l'échangé

/**
 * ⚡ L'éclair du Sharingan — le passif de Sasuke.
 * DEUX vrais éclairs en zigzag, style cartoon (remplissage vif + gros contour
 * bleu nuit), qui claquent entre l'ancienne et la nouvelle ligne à chaque
 * changement de voie, quand le guerrier a le style de Sasuke (`player.spark`).
 */
// L'éclair se DESSINE (très vite) puis se DISSIPE — il ne doit jamais avoir
// l'air « déjà posé » : on doit voir le trait naître et filer.
const SPARK_TRACE = 0.07 // la création, à la vitesse de la lumière
const SPARK_DISSIP = 0.2 // puis il s'efface en s'étalant
let sparkT0 = -99 // instant du déclenchement
let sparkDe = 0 // bornes X du tracé — le plan de coupe balaie entre les deux
let sparkVers = 0

/**
 * Le plan de coupe qui RÉVÈLE l'éclair au fil de sa création. On le fait
 * glisser de `sparkDe` à `sparkVers` : le zigzag apparaît au fur et à mesure,
 * comme s'il se traçait tout seul. C'est ça qui donne la vitesse de la lumière.
 */
const sparkPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
// Les deux sens de balayage : vers la droite on garde « x < balai », vers la
// gauche « x > balai ». (Three.js garde le côté où normale·point + constante > 0.)
const SPARK_N_NEG = new THREE.Vector3(-1, 0, 0)
const SPARK_N_POS = new THREE.Vector3(1, 0, 0)
renderer.localClippingEnabled = true

/** La silhouette d'un éclair (zigzag façon ⚡), en unités locales. */
function boltShape(): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(0.08, 0.55)
  s.lineTo(-0.24, 0.04)
  s.lineTo(-0.05, 0.04)
  s.lineTo(-0.17, -0.55)
  s.lineTo(0.24, 0.1)
  s.lineTo(0.04, 0.1)
  s.closePath()
  return s
}

/** Un éclair cartoon : un gros contour bleu nuit + un remplissage vif dessus. */
function makeBolt(): THREE.Group {
  const geo = new THREE.ShapeGeometry(boltShape())
  const g = new THREE.Group()
  // Les deux matériaux sont coupés par le MÊME plan : le trait se révèle d'un bloc
  const contour = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x11224a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      clippingPlanes: [sparkPlane],
    })
  )
  contour.scale.set(1.45, 1.18, 1)
  contour.position.z = -0.01
  const remplissage = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0x9fe8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      clippingPlanes: [sparkPlane],
    })
  )
  g.add(contour, remplissage)
  return g
}

const sparkBolts = [makeBolt(), makeBolt()]
for (const b of sparkBolts) {
  b.visible = false
  scene.add(b)
}

/** Cache les deux éclairs (fin de course, retour menu). */
function hideSpark() {
  for (const b of sparkBolts) b.visible = false
  sparkT0 = -99
}

/**
 * Fait naître les DEUX éclairs entre deux positions X. `echelle` : 1 pour un
 * changement de ligne, plus petit pour le saut. Ils ne sont pas « posés » : le
 * plan de coupe les trace de `fromX` vers `toX` en 70 ms, puis ils se dissipent.
 */
function flashSpark(fromX: number, toX: number, echelle = 1) {
  const z = player.mesh.position.z + 0.12
  const dir = Math.sign(toX - fromX) || 1
  // Le 1er éclair, plus haut et incliné vers le départ ; le 2e plus bas, penché
  // à l'inverse et plus petit : deux zigzags qui crépitent sur le trajet.
  sparkBolts[0].position.set(fromX + (toX - fromX) * 0.32, 1.2, z)
  sparkBolts[0].rotation.z = dir * -0.3
  sparkBolts[0].scale.setScalar(echelle)
  sparkBolts[0].userData.base = echelle
  sparkBolts[1].position.set(fromX + (toX - fromX) * 0.72, 0.7, z + 0.04)
  sparkBolts[1].rotation.z = dir * 0.45
  sparkBolts[1].scale.setScalar(0.78 * echelle)
  sparkBolts[1].userData.base = 0.78 * echelle
  for (const b of sparkBolts) b.visible = true
  // Les bornes du tracé : on déborde un peu pour que les pointes soient prises
  sparkDe = Math.min(fromX, toX) - 0.7
  sparkVers = Math.max(fromX, toX) + 0.7
  if (dir < 0) [sparkDe, sparkVers] = [sparkVers, sparkDe] // on trace dans le sens du saut
  sparkT0 = time
}

/** ⚡ Le petit éclair du saut : même effet, en réduit, autour du guerrier. */
function flashSparkSaut() {
  const x = player.mesh.position.x
  flashSpark(x - 0.6, x + 0.6, 0.5)
}

// ═══════════ Effets visuels de course ═══════════

// ————— 🌸 Le cerisier du départ + ses pétales —————
// Un arbre UNIQUE, planté à la ligne de départ. Il défile vers l'arrière quand
// on s'élance et ne réapparaît jamais : c'est le seuil du tournoi, pas un décor
// qui se répète. Pendant le décompte, ses pétales tombent.
const CERISIER_X = -5.6
function makeCerisier(): THREE.Group {
  const g = new THREE.Group()
  const tronc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.3, 2.8, 6),
    new THREE.MeshStandardMaterial({ color: 0x5a3a2e, roughness: 0.9 })
  )
  tronc.position.y = 1.4
  g.add(tronc)
  // La frondaison : des boules roses, deux tons pour le volume
  const roses = [0xffb7d5, 0xf79ac2, 0xffc9e0]
  for (let i = 0; i < 5; i++) {
    const blob = new THREE.Mesh(
      new THREE.SphereGeometry(0.9 + i * 0.12, 10, 8),
      new THREE.MeshStandardMaterial({ color: roses[i % 3], roughness: 0.85 })
    )
    blob.position.set((i - 2) * 0.42, 3 + Math.sin(i) * 0.5, Math.cos(i) * 0.5)
    g.add(blob)
  }
  return g
}
const cerisier = makeCerisier()
cerisier.visible = false
scene.add(cerisier)

// Les pétales : un banc de petits plans roses qui chutent en tanguant.
interface Petale {
  mesh: THREE.Mesh
  vx: number
  vy: number
  phase: number
}
const petaleMat = new THREE.MeshStandardMaterial({
  color: 0xffc2dd,
  roughness: 0.7,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.95,
})
const petales: Petale[] = []
for (let i = 0; i < 40; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), petaleMat)
  m.visible = false
  scene.add(m)
  petales.push({ mesh: m, vx: 0, vy: 0, phase: 0 })
}
let petalesActifs = false // on ne fait NAÎTRE de nouveaux pétales qu'au départ
let ventPhase = 0 // l'horloge de la rafale (le chrono, lui, est figé au décompte)

/**
 * (Re)lâche un pétale. `neuf` : au tout premier souffle on en sème déjà EN
 * TRAVERS de l'écran — sinon la première seconde est vide, le temps qu'ils
 * traversent depuis l'arbre.
 */
function poserPetale(p: Petale, neuf: boolean) {
  p.mesh.position.set(
    cerisier.position.x + (neuf ? Math.random() * 9 : (Math.random() - 0.5) * 2.6),
    cerisier.position.y + (neuf ? 1.2 + Math.random() * 3.2 : 3.4 + Math.random() * 1.4),
    cerisier.position.z + (Math.random() - 0.5) * 2.4
  )
  // Le vent les emporte vers la DROITE : ils balaient toute la piste
  p.vx = 3.4 + Math.random() * 2.8
  p.vy = -0.35 - Math.random() * 0.4
  p.phase = Math.random() * 6.28
  p.mesh.visible = true
}

// ————— 💥 L'explosion (Kunai qui touche, ou trébuchement) —————
// Une boule additive qui gonfle et s'éteint. Un seul maillage recyclé : deux
// explosions quasi simultanées se recouvrent, on l'assume.
const BOOM_DUREE = 0.42
const boomMat = new THREE.MeshBasicMaterial({
  color: 0xffa23a,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const boomMesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), boomMat)
boomMesh.visible = false
scene.add(boomMesh)
let boomFin = 0
function boom(pos: THREE.Vector3) {
  boomMesh.position.copy(pos)
  boomMesh.scale.setScalar(0.4)
  boomMesh.visible = true
  boomFin = time + BOOM_DUREE
}

// ————— 🛡️ Le bouclier d'acier, façon Protection de Daruk —————
// Un dôme facetté ambré enveloppe le coureur tant que l'armure tient : on SAIT
// qu'on est protégé, au lieu de le deviner. Comme dans Breath of the Wild, il
// réagit de deux façons bien distinctes, et c'est toute la lecture du sort :
//
//  · Un choc encaissé, mais l'armure tient → le dôme CLAQUE (flash + sursaut)
//    et quelques éclats se détachent. Il reste là : « il t'en reste ».
//  · La dernière plaque cède → volée d'éclats dans toutes les directions,
//    souffle lumineux, et le dôme DISPARAÎT. Plus rien ne te protège.
//
// Deux maillages superposés : un remplissage translucide et un fil de fer qui
// dessine les facettes. C'est le fil de fer qui fait la signature Daruk.
const BOUCLIER_R = 1.35
const boucGeo = new THREE.IcosahedronGeometry(BOUCLIER_R, 1)
const boucFillMat = new THREE.MeshBasicMaterial({
  color: 0xff9a3c,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const boucLineMat = new THREE.MeshBasicMaterial({
  color: 0xffd08a,
  transparent: true,
  opacity: 0,
  wireframe: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
})
const boucFill = new THREE.Mesh(boucGeo, boucFillMat)
const boucLignes = new THREE.Mesh(boucGeo, boucLineMat)
boucFill.visible = false
boucLignes.visible = false
scene.add(boucFill, boucLignes)
const BOUC_CLAQUE = 0.25 // durée du claquement quand un choc est encaissé
let boucFlash = 0

/** Un éclat de bouclier qui part en tournoyant. */
interface Eclat {
  mesh: THREE.Mesh
  vx: number
  vy: number
  vz: number
  fin: number
}
const ECLAT_VIE = 0.6
const eclats: Eclat[] = []
for (let i = 0; i < 26; i++) {
  // Chacun son matériau : ils doivent pouvoir s'éteindre à leur propre rythme
  const m = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.17),
    new THREE.MeshBasicMaterial({
      color: 0xffb055,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  )
  m.visible = false
  scene.add(m)
  eclats.push({ mesh: m, vx: 0, vy: 0, vz: 0, fin: 0 })
}

/** Fait sauter `nb` éclats de la coque, projetés à `force` mètres/seconde. */
function briserBouclier(nb: number, force: number) {
  const p = player.mesh.position
  let poses = 0
  for (const e of eclats) {
    if (poses >= nb) break
    if (e.mesh.visible) continue
    // Un point au hasard sur la coque : les éclats partent de la surface
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    const dx = Math.sin(ph) * Math.cos(th)
    const dy = Math.cos(ph)
    const dz = Math.sin(ph) * Math.sin(th)
    // p.y : les éclats naissent sur la coque, donc à SA hauteur du moment —
    // une armure qui vole en morceaux au sol pendant qu'on saute serait absurde.
    e.mesh.position.set(p.x + dx * BOUCLIER_R, p.y + 0.85 + dy * BOUCLIER_R, p.z + dz * BOUCLIER_R)
    e.vx = dx * force
    e.vy = dy * force + 1.2 // un rien vers le haut : ça retombe joliment
    e.vz = dz * force
    e.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
    e.fin = time + ECLAT_VIE
    e.mesh.visible = true
    poses++
  }
}

/**
 * L'armure vient d'encaisser un choc. `brisee` : c'était la dernière plaque.
 * Les deux cas doivent se lire d'un coup d'œil, sans lire le message.
 */
function armureEncaisse(brisee: boolean) {
  if (brisee) {
    briserBouclier(20, 5.5) // toute la coque explose…
    // Le souffle part de la coque elle-même, saut compris
    const p = player.mesh.position
    boom(new THREE.Vector3(p.x, p.y + 0.85, p.z)) // …dans un souffle
  } else {
    boucFlash = time + BOUC_CLAQUE // le dôme claque et tient bon
    briserBouclier(7, 2.6)
  }
}

// ————— 💨 La zone de fumée, COLLÉE à sa victime —————
// Le nuage gris suit le coureur enfumé pendant toute la durée du sort, en plus
// du voile d'écran. Deux règles, et elles vont ensemble :
//
//  · Il COLLE à sa cible. Posé au sol une fois pour toutes, il serait distancé
//    en une seconde (on court à 30 m/s) et n'apprendrait plus rien à personne.
//    Accroché au coureur, il dit « c'est LUI qui est aveuglé ».
//  · Il dure exactement FUMIGENE_DUREE. Le nuage n'est pas un décor : c'est la
//    JAUGE de l'effet. Tant qu'il est là, l'effet court ; il s'éteint avec lui.
//
// Un petit banc recyclé : rarement plus d'un ou deux à la fois.
interface FumeeZone {
  disque: THREE.Mesh
  dome: THREE.Mesh
  /** Le coureur enfumé : la zone se recale sur lui à chaque image. */
  cible: THREE.Object3D
  fin: number
  actif: boolean
}
const fumeeZones: FumeeZone[] = []
function spawnFumeeZone(cible: THREE.Object3D) {
  let z = fumeeZones.find((f) => !f.actif)
  if (!z) {
    const disque = new THREE.Mesh(
      new THREE.CircleGeometry(1.9, 24),
      new THREE.MeshBasicMaterial({ color: 0x9aa2ad, transparent: true, opacity: 0, depthWrite: false })
    )
    disque.rotation.x = -Math.PI / 2
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x8a929d, transparent: true, opacity: 0, depthWrite: false })
    )
    dome.scale.y = 0.5
    scene.add(disque, dome)
    z = { disque, dome, cible, fin: 0, actif: false }
    fumeeZones.push(z)
  }
  z.cible = cible
  z.fin = time + FUMIGENE_DUREE // la zone vit exactement le temps de l'effet
  z.actif = true
  z.disque.visible = true
  z.dome.visible = true
  placerFumeeZone(z, 0) // en place dès la 1re image, sans attendre la boucle
}

/** Recale la zone sur sa victime. `age` fait monter le dôme au fil du temps. */
function placerFumeeZone(z: FumeeZone, age: number) {
  const p = z.cible.position
  /*
   * ⚠️ `p.y` : LA FUMÉE MONTE AVEC SA VICTIME.
   *
   * Les deux hauteurs étaient écrites en dur, et la zone restait donc plaquée
   * au sol pendant qu'on sautait ou qu'on courait sur un plateau à 2,70 m. On
   * voyait alors son aveuglement se dérouler sous ses pieds — un effet qu'on
   * subit ne peut pas rester en bas quand on monte.
   *
   * Le disque garde son ras-du-sol RELATIF : c'est l'empreinte au niveau des
   * pieds, pas une tache sur la piste.
   */
  z.disque.position.set(p.x, p.y + 0.05, p.z)
  z.dome.position.set(p.x, p.y + 0.4 + age * 0.16, p.z)
}

// ————— 💨💥 Le rideau de vitesse (sprint final + dash) —————
// Un overlay DOM (créé ici, pas dans index.html, pour ne pas gêner l'autre
// chantier en cours). Son intensité suit le martèlement et les dash.
const speedEl = document.createElement('div')
speedEl.id = 'speedlines'
// Les éclats triangulaires, semés une fois pour toutes. Tailles, départs et
// vitesses tirés au hasard : sans ça, les deux bords battraient à l'unisson et
// l'effet ferait « rideau » au lieu de « rafale ».
for (const cote of ['g', 'd'] as const) {
  for (let i = 0; i < 14; i++) {
    const t = document.createElement('i')
    t.className = `tri ${cote}`
    t.style.top = `${Math.random() * 100}%`
    t.style.height = `${5 + Math.random() * 13}px`
    t.style.width = `${70 + Math.random() * 170}px`
    t.style.background = `rgba(233, 240, 255, ${0.4 + Math.random() * 0.5})`
    t.style.animationDuration = `${0.32 + Math.random() * 0.4}s`
    t.style.animationDelay = `${-Math.random() * 0.8}s` // déjà en vol au 1er affichage
    speedEl.appendChild(t)
  }
}
document.body.appendChild(speedEl)

// ————— 💨 La poussière d'atterrissage (tout le monde, bots compris) —————
// Un petit nuage plat qui s'étale au sol quand un coureur retombe d'un saut.
// Une horloge à part (`effetTemps`) : le chrono de course est figé pendant le
// décompte, ces effets doivent tourner quand même.
interface Poussiere {
  mesh: THREE.Mesh
  fin: number
}
const POUSSIERE_DUREE = 0.5
let effetTemps = 0
const poussieres: Poussiere[] = []
for (let i = 0; i < 14; i++) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 16),
    new THREE.MeshBasicMaterial({
      color: 0xcbbba0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
  )
  m.rotation.x = -Math.PI / 2 // à plat sur le sol
  m.visible = false
  scene.add(m)
  poussieres.push({ mesh: m, fin: 0 })
}

/** Lâche un nuage de poussière au sol, aux pieds d'un coureur qui atterrit. */
function poserPoussiere(x: number, z: number) {
  const p = poussieres.find((q) => !q.mesh.visible) ?? poussieres[0]
  p.mesh.position.set(x, 0.04, z)
  p.mesh.scale.setScalar(0.45)
  p.mesh.visible = true
  p.fin = effetTemps + POUSSIERE_DUREE
}

// Qui était en l'air à l'image d'avant ? On compare avec maintenant : passer de
// « en l'air » à « au sol », c'est un atterrissage.
let joueurEnLAir = false
const botEnLAir = PROFILS.map(() => false)

/** Repère les atterrissages de TOUT LE MONDE et lâche la poussière qui va avec. */
function detecterAtterrissages() {
  const AIR = 0.05 // au-dessus de ça, on considère qu'on décolle

  const pAir = player.mesh.position.y > AIR
  if (joueurEnLAir && !pAir) poserPoussiere(player.mesh.position.x, player.mesh.position.z)
  joueurEnLAir = pAir

  bots.forEach((b, i) => {
    if (!b.actif) {
      botEnLAir[i] = false
      return
    }
    const air = b.mesh.position.y > AIR
    if (botEnLAir[i] && !air) poserPoussiere(b.mesh.position.x, b.mesh.position.z)
    botEnLAir[i] = air
  })

  for (const r of rivals.values()) {
    const air = r.opp.mesh.position.y > AIR
    if (r.enLAir && !air) poserPoussiere(r.opp.mesh.position.x, r.opp.mesh.position.z)
    r.enLAir = air
  }
}

/** Fait avancer tous les effets d'un pas. `dz` = recul du monde cette image. */
function updateEffets(dt: number, dz: number) {
  effetTemps += dt
  // 💨 Les nuages de poussière s'étalent au sol puis s'effacent
  for (const p of poussieres) {
    if (!p.mesh.visible) continue
    const k = (p.fin - effetTemps) / POUSSIERE_DUREE // 1 → 0
    if (k <= 0) {
      p.mesh.visible = false
      continue
    }
    p.mesh.position.z += dz
    p.mesh.scale.setScalar(0.45 + (1 - k) * 1.6)
    ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = k * 0.45
  }
  // 🌸 Le cerisier glisse vers l'arrière puis disparaît, une fois dépassé
  if (cerisier.visible) {
    cerisier.position.z += dz
    if (cerisier.position.z > 14) cerisier.visible = false
  }
  // 🌸 Les pétales : emportés vers la DROITE par le vent, en tanguant.
  // La rafale enfle et retombe : un vent constant ferait « tapis roulant ».
  ventPhase += dt
  const rafale = 1 + Math.sin(ventPhase * 1.6) * 0.35
  for (const p of petales) {
    if (!p.mesh.visible) {
      if (petalesActifs && cerisier.visible && Math.random() < 0.4) poserPetale(p, true)
      continue
    }
    p.phase += dt * 3
    p.mesh.position.x += (p.vx * rafale + Math.sin(p.phase) * 0.5) * dt
    p.mesh.position.y += (p.vy + Math.sin(p.phase * 0.7) * 0.25) * dt
    p.mesh.position.z += dz
    p.mesh.rotation.z += dt * 3.2 // ils tourbillonnent plus fort dans le vent
    p.mesh.rotation.x += dt * 2.2
    // Recyclés dès qu'ils sortent : par la droite (le vent), par le bas, ou derrière
    if (p.mesh.position.y < 0 || p.mesh.position.x > 13 || p.mesh.position.z > 14) {
      if (petalesActifs && cerisier.visible) poserPetale(p, false)
      else p.mesh.visible = false
    }
  }
  // 💥 L'explosion gonfle et s'éteint
  if (boomMesh.visible) {
    const k = (boomFin - time) / BOOM_DUREE // 1 → 0
    if (k <= 0) boomMesh.visible = false
    else {
      boomMesh.scale.setScalar(0.4 + (1 - k) * 2.8)
      boomMat.opacity = k * 0.85
    }
  }

  // 🛡️ Le dôme : présent tant qu'il reste de la solidité, il respire doucement
  // et CLAQUE quand il vient d'encaisser. Sa seule présence dit « tu es couvert ».
  const bouclierOn = armure > 0
  boucFill.visible = bouclierOn
  boucLignes.visible = bouclierOn
  if (bouclierOn) {
    const p = player.mesh.position
    // p.y : le dôme SUIT le saut. Resté au sol pendant qu'on vole, il dirait
    // qu'on a laissé sa protection en bas — or c'est en l'air qu'on percute.
    boucFill.position.set(p.x, p.y + 0.85, p.z)
    boucLignes.position.copy(boucFill.position)
    boucLignes.rotation.y += dt * 0.5
    boucFill.rotation.y = boucLignes.rotation.y
    const claque = Math.max(0, (boucFlash - time) / BOUC_CLAQUE) // 1 → 0
    boucFillMat.opacity = 0.1 + Math.sin(time * 3) * 0.02 + claque * 0.5
    boucLineMat.opacity = 0.28 + claque * 0.6
    const s = 1 + claque * 0.18 // il enfle une fraction de seconde sous le choc
    boucFill.scale.setScalar(s)
    boucLignes.scale.setScalar(s)
  }

  // 🛡️ Les éclats : ils fusent, retombent et s'éteignent
  for (const e of eclats) {
    if (!e.mesh.visible) continue
    const reste = e.fin - time
    if (reste <= 0) {
      e.mesh.visible = false
      continue
    }
    e.mesh.position.x += e.vx * dt
    e.mesh.position.y += e.vy * dt
    e.mesh.position.z += e.vz * dt + dz // + dz : ils restent dans le décor qui recule
    e.vy -= 6 * dt // un peu de gravité, pour qu'ils retombent au lieu de flotter
    e.mesh.rotation.x += dt * 6
    e.mesh.rotation.z += dt * 5
    ;(e.mesh.material as THREE.MeshBasicMaterial).opacity = (reste / ECLAT_VIE) * 0.9
  }

  // 💨 Les zones de fumée : entrée franche, tenue, sortie en fondu ; elles montent
  for (const z of fumeeZones) {
    if (!z.actif) continue
    const reste = z.fin - time
    if (reste <= 0) {
      z.actif = false
      z.disque.visible = false
      z.dome.visible = false
      continue
    }
    const age = FUMIGENE_DUREE - reste
    // Elle tient pleine presque tout l'effet : on ne fond qu'à la toute fin,
    // pour que sa disparition annonce la fin de l'aveuglement.
    const fade = Math.min(1, age / 0.3) * Math.min(1, reste / 0.5)
    ;(z.disque.material as THREE.MeshBasicMaterial).opacity = fade * 0.5
    ;(z.dome.material as THREE.MeshBasicMaterial).opacity = fade * 0.42
    // Elle SUIT sa victime au lieu de défiler avec le décor : c'est ce qui en
    // fait un indicateur d'effet et non une simple tache sur la piste.
    placerFumeeZone(z, age)
    z.dome.rotation.y += dt * 0.6
  }
}

// ————— Le rouleau-machine à sous —————
// À chaque ramassage, la case fait défiler les icônes façon machine de casino
// et s'arrête PILE sur l'objet gagné, qui grossit et brille 1,5 s.
const REEL_MS = 1000 // durée du déroulé
const WON_MS = 1500 // durée « grossi + brillance »
const reelTimers: (ReturnType<typeof setTimeout>[])[] = [[], []]

/** Coupe un déroulé en cours sur une case (avant de la redessiner proprement). */
function clearReel(i: number) {
  for (const t of reelTimers[i]) clearTimeout(t)
  reelTimers[i] = []
  const el = slotEls[i]
  el.classList.remove('won', 'rolling')
  el.querySelector('.reel')?.remove()
}

/** Redessine les 2 slots. Le 1er est mis en avant : c'est le prochain lancé. */
function drawSlots(pop = -1) {
  slotEls.forEach((el, i) => {
    clearReel(i) // un déroulé en cours est annulé : on repart d'un état net
    const k = slots[i]
    el.textContent = k ? PARCHEMINS[k].icone : '—'
    el.classList.toggle('actif', i === 0 && !!k)
    if (i === pop) {
      el.classList.remove('plein')
      void el.offsetWidth // relance l'animation même sur un ramassage consécutif
      el.classList.add('plein')
    }
  })
}

/**
 * Le déroulé « machine à sous » d'un ramassage sur la case `i` : les icônes
 * défilent et ralentissent, s'arrêtent pile sur `kind`, puis la case grossit et
 * brille 1,5 s. Purement visuel — le vrai contenu est déjà dans `slots`, et le
 * toast a annoncé l'objet, donc on peut jouer même pendant le déroulé.
 */
function revealSlot(i: number, kind: ParcheminKind) {
  clearReel(i)
  const el = slotEls[i]
  el.classList.remove('actif', 'plein')
  el.textContent = ''
  const H = el.clientHeight || 42

  // La bande : des icônes au hasard, et l'objet GAGNÉ tout en bas.
  const N = 18
  const cells: string[] = []
  for (let k = 0; k < N - 1; k++) {
    cells.push(PARCHEMINS[TIRAGE[Math.floor(Math.random() * TIRAGE.length)]].icone)
  }
  cells.push(PARCHEMINS[kind].icone)

  const reel = document.createElement('div')
  reel.className = 'reel'
  reel.innerHTML = cells
    .map((ic) => `<span style="height:${H}px">${ic}</span>`)
    .join('')
  reel.style.transition = `transform ${REEL_MS}ms cubic-bezier(0.13, 0.75, 0.2, 1)`
  el.classList.add('rolling')
  el.appendChild(reel)

  // On force un reflow, puis on lance le défilé jusqu'à la dernière case (gagnée)
  void reel.offsetWidth
  reel.style.transform = `translateY(${-(N - 1) * H}px)`

  reelTimers[i].push(
    setTimeout(() => {
      // Arrêt pile sur l'objet : on retire la bande, on fige l'icône, on brille
      reel.remove()
      el.classList.remove('rolling')
      el.textContent = PARCHEMINS[kind].icone
      el.classList.toggle('actif', i === 0)
      void el.offsetWidth
      el.classList.add('won')
      reelTimers[i].push(setTimeout(() => el.classList.remove('won'), WON_MS))
    }, REEL_MS)
  )
}

/** Le sélecteur 1-2-3-4 du menu : boutons + qui on va affronter. */
function drawBotPick() {
  for (const el of Array.from(botRowEl.children)) {
    el.classList.toggle('actif', Number((el as HTMLElement).dataset.n) === nbBots)
  }
  // On annonce les noms : le joueur doit savoir qu'ajouter un rival, c'est
  // ajouter un rival PLUS FORT — pas juste un de plus.
  botNamesEl.textContent = PROFILS.slice(0, nbBots)
    .map((p) => p.nom)
    .join(' · ')
}

for (let n = 1; n <= BOTS_MAX; n++) {
  const b = document.createElement('button')
  b.className = 'botn'
  b.dataset.n = String(n)
  b.textContent = String(n)
  b.addEventListener('click', () => {
    nbBots = n
    localStorage.setItem(CLE_BOTS, String(n))
    drawBotPick()
  })
  botRowEl.appendChild(b)
}
drawBotPick()

/** Les rivaux qui courent vraiment sur cette course. */
function botsEnCourse() {
  return bots.filter((b) => b.actif)
}

/**
 * Le classement en direct. On le trie par distance : le meneur en haut. Les
 * écarts sont donnés EN SECONDES et non en mètres — c'est la seule unité qui
 * parle au joueur, celle de son chrono et de son record.
 */
function majTetes() {
  // Toi : ta tete et ton nom, a ta hauteur de course
  coureurMoi.wrap.style.bottom = `${Math.min(100, (((modeInfini ? distance % COURSE_LENGTH : distance)) / COURSE_LENGTH) * 100)}%`
  coureurMoi.etiq.textContent = menu.settings.name || 'Toi'

  // Les rivaux : les bots en entrainement, les joueurs en ligne. Le meme banc
  // sert les deux — un duel doit montrer ses rivaux comme une course solo.
  const rivaux = botsEnCourse().map((b) => ({
    nom: b.profil.nom,
    corps: b.profil.corps,
    band: b.profil.bandeau,
    d: b.distance,
    fini: b.tempsArrivee >= 0,
  }))
  if (online) {
    for (const r of rivals.values()) {
      rivaux.push({
        nom: r.name,
        corps: r.opp.currentFighter.body,
        band: r.opp.currentFighter.band,
        d: r.opp.distanceNow,
        fini: r.finished,
      })
    }
  }

  tetesRivaux.forEach((c, i) => {
    const r = rivaux[i]
    c.wrap.classList.toggle('hidden', !r)
    if (!r) return
    c.tete.style.setProperty('--body', cssColor(r.corps))
    c.tete.style.setProperty('--band', cssColor(r.band))
    c.wrap.style.bottom = `${Math.min(100, (r.d / COURSE_LENGTH) * 100)}%`

    // L'ecart est compte a TA vitesse : « ce qu'il me faudrait pour y etre ».
    // ⚠️ Le pseudo vient d'un autre joueur : on l'echappe avant tout affichage.
    const nom = escapeHtml(r.nom)
    if (r.fini) {
      c.etiq.innerHTML = `${nom} ⛩️`
      return
    }
    const ecart = (r.d - distance) / Math.max(speed, 1)
    const devant = ecart >= 0
    c.etiq.innerHTML =
      `${nom} <span class="${devant ? 'devant' : ''}">` +
      `${devant ? '+' : ''}${ecart.toFixed(1)}</span>`
  })
}

/**
 * On encaisse un sort. Si la 🪞 parade est levée, il repart chez son auteur au
 * lieu de nous toucher — d'où le retour : `true` = renvoyé.
 */
function subirSort(
  kind: string,
  deBot: Bot | null = null,
  srcMesh: THREE.Object3D | null = null,
  fromId = ''
): boolean {
  // 👻 La trêve du départ protège tout le monde — même d'un client trafiqué
  if (enTreve()) return false
  if (time < miroirFin) {
    miroirFin = 0 // la parade est à usage unique
    toast('🪞 Parade Miroir — renvoyé !')
    // En ligne, le renvoi repart chez SON lanceur (fromId), pas au hasard
    if (online) net.sendSpell(kind, fromId)
    else if (deBot) deBot.subir(kind as ParcheminKind, time)
    return true
  }

  // D'où vient le tir : le bot qui l'a lancé, le rival en ligne, ou la brume
  // si on l'ignore. Calculé pour tous les sabotages, pas seulement le kunai.
  const lanceur =
    deBot?.mesh.position ?? srcMesh?.position ?? new THREE.Vector3(player.mesh.position.x, 1.2, -22)

  if (kind === 'kusarigama') {
    kusarigamaFin = time + KUSARIGAMA_DUREE
    lancerProjet('kusarigama', lanceur, player.mesh.position, player.mesh) // ⛓️
    toast('⛓️ Kusarigama ! Tu es entravé…')
  } else if (kind === 'kunai') {
    // Avant le test d'armure : on doit voir la lame même quand elle éclate dessus.
    lancerProjet('kunai', lanceur, player.mesh.position, player.mesh)

    // Le seul sort qui fait trébucher sec. L'armure peut encore l'avaler.
    if (armure > 0) {
      armure = Math.max(0, armure - ARMURE_COUT_PETIT)
      armureEncaisse(armure === 0) // 🛡️ même lecture que sur un obstacle
      toast('🛡️ Le kunai éclate sur l\'armure !')
      return false
    }
    speed = Math.max(6, speed * 0.35)
    stumble = 1.2
    // 🎯 L'explosion te crache de la terre au visage : les BORDS de l'écran se
    // salissent, le centre reste lisible. Et elle COLLE — seul le 🍵 thé lave.
    terreEl.classList.add('on')
    toast('🎯 Kunai en pleine course !')
  } else if (kind === 'fumigene') {
    fumigeneFin = time + FUMIGENE_DUREE
    spawnFumeeZone(player.mesh) // 💨 le nuage te suit tant que tu es aveuglé
    toast('💨 Tu ne vois plus rien !')
  } else if (kind === 'senbon') {
    senbonFin = time + SENBON_DUREE
    // ☠️ L'aiguille file jusqu'à toi, et te laisse son aura violette
    lancerProjet('senbon', lanceur, player.mesh.position, player.mesh)
    toast('☠️ Poison — tout tangue…')
  } else if (kind === 'onmyoji') {
    return false // l'échange est traité par l'appelant : il connaît les 2 places
  }
  flash()
  return false
}

/**
 * 🔮 Échange nos places avec `d`. Le sort le plus violent du jeu.
 * `corps` = le maillage de l'échangé, pour l'envelopper de la même lueur.
 */
function echangerAvec(d: number, qui: string, corps: THREE.Object3D | null = null) {
  distance = d
  lueurFin = time + LUEUR_DUREE
  lueurCible = corps
  toast(`🔮 Portail ! Tu échanges avec ${qui}`)
  flash()
}

/**
 * Trouve à qui envoyer un sort offensif en solo : le rival le plus proche
 * DEVANT. Les autres ne te coûtent rien — les saboter serait du gâchis, et le
 * joueur ne choisit pas sa cible en pleine course.
 */
function cibleDevant(): Bot | undefined {
  return botsEnCourse()
    .filter((b) => b.tempsArrivee < 0 && b.distance > distance)
    .sort((a, b) => a.distance - b.distance)[0]
}

/** Lance le parchemin le plus ancien. Rien à faire s'il n'y en a pas. */
/**
 * 🔥 Les sorts qu'on JETTE — ceux qui méritent le geste du lancer.
 *
 * Ce sont les quatre qui partent de la main : le portail, l'aiguille, la
 * fumée et la lame. Les autres se posent sur soi (l'armure, le thé, la grue)
 * et n'ont rien à jeter — leur donner le même geste ferait mimer un tir dans
 * le vide.
 *
 * Le geste ne part qu'au moment où le sort SORT vraiment : quand on mène
 * déjà, le rouleau est rendu et rien ne doit s'animer.
 */
const SORTS_LANCES = new Set(['onmyoji', 'senbon', 'fumigene', 'kunai'])

function lancerParchemin() {
  // Dans le sprint, tous les taps servent à marteler : pas de sort ici, sinon
  // le clavier pourrait encore lancer (touche E) là où le mobile ne peut plus.
  if (inSprintZone()) {
    toast('🔥 Pas de parchemin dans le sprint !')
    return
  }
  const kind = slots.shift()
  if (!kind) {
    toast('📜 Aucun parchemin en main')
    return
  }
  const p = PARCHEMINS[kind]
  drawSlots()
  toast(p.cri)

  // ————— Sur soi —————
  // Chacun a sa forme, et elle vit exactement le temps du sort.
  // L'armure fait exception — son dôme facetté joue déjà ce rôle, en mieux.
  if (kind === 'vent') {
    ventFin = time + VENT_DUREE
    // 🌀 Une brume cyan t'enveloppe — la même matière que le poison, l'autre
    // couleur. `false` : ce n'est pas une affliction, le Thé ne l'emporte pas.
    poserBrume(player.mesh, VENT_DUREE, BRUME_VENT, false)
  } else if (kind === 'grue') {
    grueFin = time + GRUE_DUREE // 🕊️ l'anneau vert suit `grueFin` tout seul
  } else if (kind === 'armure') armure = ARMURE_SOLIDITE
  else if (kind === 'miroir') {
    // 🪞 La glace tient TANT QU'ON N'Y TOUCHE PAS : elle ne s'éteint qu'en
    // renvoyant un sort (cf. subirSort). C'est une garde, pas un minuteur.
    miroirFin = Infinity
  } else if (kind === 'the') {
    // 🍵 Le thé lave TOUT d'un coup — y compris ce qu'on vient d'encaisser
    kusarigamaFin = 0
    fumigeneFin = 0
    senbonFin = 0
    // Les marques des afflictions s'éteignent avec elles : sinon on se croirait
    // encore empoisonné et entravé alors qu'on vient de se purifier.
    libererChaines(player.mesh) // ⛓️ les chaînes tombent
    dissiperBrume(player.mesh) // ☠️ la brume se lève
    terreEl.classList.remove('on') // 🎯 la terre du kunai s'en va avec le reste
    /*
     * ♾️🏺 …et la LOURDEUR des jarres part avec le reste.
     *
     * C'est ce qui rend le thé utile en course sans fin : les afflictions qu'il
     * lavait (poison, chaînes, fumigène) viennent toutes d'un adversaire, et il
     * n'y en a pas. Sans ce mal-là, il ne soignerait jamais rien.
     */
    const pesait = lourdeur
    lourdeur = 0
    majJarres() // le compteur retombe a zero avec le poids
    theFin = time + THE_DUREE // 🍵 les cercles montent
    sonDeSoin()
    // On ne se vante que s'il y avait quelque chose à laver : annoncer une
    // guérison quand on courait déjà net ferait douter de ce que fait le thé.
    if (modeInfini && pesait > 0) toast('🍵 Le poids des jarres s\'en va — pleine vitesse')
  }
  // ————— 🔮 Le portail : il part, il ne vise pas —————
  else if (kind === 'onmyoji') {
    // La couleur voyage AVEC le portail jusqu'à la brûlure qu'il laissera sur
    // le mur : c'est lui qui la porte, pas les maillages.
    if (enTreve()) {
      // 👻 Même le portail attend la fin de la trêve : il échange des places,
      // c'est bien une attaque. Le rouleau est rendu, rien n'est perdu.
      toast('👻 Trêve du départ — encore un instant !')
      slots.unshift(kind)
      drawSlots()
      return
    }
    const couleur = PORTAIL_BLEU
    /*
     * ⚠️ Elle part à LA HAUTEUR DU LANCEUR, saut compris.
     *
     * Elle naissait à 1,10 m quoi qu'il arrive : tirer en plein saut faisait
     * apparaître la boule sous ses propres pieds. `PORTAIL_Y` n'est donc plus
     * une altitude mais un écart au-dessus des pieds — la hauteur de la main
     * qui jette.
     */
    portail = {
      d: distance,
      lane: player.currentLane,
      couleur,
      sens: 1,
      y: player.mesh.position.y + PORTAIL_Y,
      vy: 0,
      t0: time,
    }
    player.geste('lancer') // 🔥 le bras jette le portail devant lui
    for (const m of [portailHalo, portailAnneau]) {
      ;(m.material as THREE.MeshBasicMaterial).color.setHex(couleur)
    }
    for (const a of portailArcs) (a.material as THREE.LineBasicMaterial).color.setHex(couleur)
  }
  /*
   * ————— ♾️🎯 En course sans fin, le kunai vise la PISTE —————
   *
   * Il n'y a personne devant : le lancer sur un adversaire le rendrait muet
   * (« …mais tu mènes déjà ! ») et le rouleau ne servirait à rien. Il fait donc
   * sauter le prochain MUR — le seul obstacle qu'on ne peut pas franchir
   * proprement, puisqu'on l'escalade et que l'escalade se paie en vitesse.
   *
   * ⚠️ Le mur seulement. Barrières et barres hautes se sautent ou se glissent :
   * un kunai qui ferait sauter n'importe quoi vaudrait beaucoup ou rien selon le
   * hasard de ce qui se présente. Limité au mur, il répond toujours à la même
   * question — « celui-là, je ne veux pas le grimper ».
   *
   * Sans mur en vue, on REND le rouleau : le gâcher sur un vide serait une
   * punition pour avoir appuyé une seconde trop tôt.
   */
  else if (modeInfini && kind === 'kunai') {
    const ou = track.detruireMurDevant(player.mesh.position.x)
    if (!ou) {
      slots.unshift(kind)
      drawSlots()
      toast('🎯 …aucun mur droit devant')
      return
    }
    player.geste('lancer')
    boom(ou) // 💥 la lame éclate sur la pierre
    jouerBruit('coup')
    toast('🎯 Le mur vole en éclats !')
  }
  // ————— Offensif : ça part chez quelqu'un —————
  else if (p.cible === 'adversaire') {
    if (enTreve()) {
      // 👻 On ne bloque pas le rouleau pour toujours : on le REND. La trêve
      // est un délai, pas une punition.
      toast('👻 Trêve du départ — encore un instant !')
      slots.unshift(kind)
      drawSlots()
      return
    }
    if (online) {
      // Il vise le rival le plus proche DEVANT — comme en solo, mais parmi les
      // 9 autres. Le serveur ne l'applique qu'à celui-là.
      const cible = rivalDevant()
      if (!cible) {
        /*
         * Comme à l'entraînement : en tête, le sort part dans le vide et le
         * slot SE LIBÈRE. On rendait le rouleau, et un joueur en tête se
         * retrouvait les mains pleines à jamais — impossible de vider ses
         * slots pour ramasser mieux. La file en souffrait plus que le sort.
         */
        toast(`${p.icone} …mais tu mènes déjà !`)
        return
      }
      lancerProjet(kind, player.mesh.position, cible.opp.mesh.position, cible.opp.mesh)
      if (SORTS_LANCES.has(kind)) player.geste('lancer') // 🔥
      if (kind === 'fumigene') spawnFumeeZone(cible.opp.mesh)
      net.sendSpell(kind, cible.id)
      toast(`${p.icone} sur ${cible.name} !`)
      return
    }
    const cible = cibleDevant()
    if (!cible) {
      toast(`${p.icone} …mais tu mènes déjà !`)
      return
    }
    // 🎯 La lame part vers sa victime. Si elle nous revient dans les dents,
    // `subirSort` rejouera le vol dans l'autre sens : c'est le même maillage,
    // donc le retour écrase l'aller — on ne voit que le trajet qui compte.
    lancerProjet(kind, player.mesh.position, cible.mesh.position, cible.mesh)
    if (SORTS_LANCES.has(kind)) player.geste('lancer') // 🔥
    if (kind === 'fumigene') spawnFumeeZone(cible.mesh)

    // Sa parade peut nous le renvoyer dans les dents : on l'a bien cherché
    if (cible.subir(kind, time)) {
      toast(`🪞 ${cible.profil.nom} te l'a renvoyé !`)
      subirSort(kind)
    } else {
      toast(`${p.icone} sur ${cible.profil.nom} !`)
    }
  }
}

/**
 * Ton pseudo, sur ton étiquette au-dessus de ta tête.
 * Relu à chaque départ : c'est le seul moment qui compte, et le pseudo comme le
 * perso ont pu changer dans le menu entre deux courses.
 */
function updateMeLabel() {
  player.setName(menu.settings.name)
}

/**
 * Le combat n'existe qu'au 2ᵉ ACTE — le corps de la course.
 * Ni pendant le départ canon, ni dans le sprint final : là, seul le
 * martèlement compte. Chaque acte a sa compétence, aucun ne déborde.
 */
function combatActif() {
  return acte2()
}

/**
 * Le 2ᵉ ACTE : le corps de la course. C'est là que vivent le combat ET les
 * deux systèmes de vitesse (ligne droite, aspiration). Avant, c'est le départ
 * canon ; après, le sprint final — deux moments où seul le martèlement compte.
 */
function acte2() {
  return state === 'course' && !versLaFin()
}

/**
 * La force du sillage devant nous, de 0 (rien) à 1 (collé au rival).
 *
 * Il faut être sur SA ligne : c'est ce qui en fait une décision — aller
 * chercher son sillage, c'est renoncer à sa propre trajectoire (et donc à
 * l'élan de ligne droite). On prend le meilleur sillage disponible : en salon
 * à 10, il peut y avoir plusieurs coureurs devant.
 */
function forceAspiration(): number {
  if (!acte2()) return 0
  let meilleur = 0

  const jauger = (lane: number, d: number) => {
    if (lane !== player.currentLane) return
    const ecart = d - distance
    if (ecart < ASPI_MIN || ecart > ASPI_MAX) return
    // Plus on est près, plus ça tire — le sillage s'affaiblit avec la distance
    const f = 1 - (ecart - ASPI_MIN) / (ASPI_MAX - ASPI_MIN)
    if (f > meilleur) meilleur = f
  }

  if (online) {
    for (const r of rivals.values()) {
      if (r.opp.active && !r.finished) jauger(r.opp.laneNow, r.opp.distanceNow)
    }
  } else {
    for (let i = 0; i < nbBots; i++) {
      const b = bots[i]
      if (b.actif) jauger(b.ligne, b.distance)
    }
  }
  return meilleur
}

/** Range un parchemin dans une main libre. Partagé par les rouleaux et les jarres dorées. */
function gagneParchemin(kind: ParcheminKind) {
  if (slots.length >= SLOTS_MAX) {
    // Les deux mains sont pleines : il faut en lancer un pour reprendre
    toast('✋ Mains pleines — lance un parchemin !')
    return
  }
  slots.push(kind)
  jouerBruit('parchemin')
  revealSlot(slots.length - 1, kind) // déroulé machine à sous
  toast(`📜 ${PARCHEMINS[kind].icone} ${PARCHEMINS[kind].nom}`)
}

/**
 * ————— 🟢 Les pots verts —————
 *
 * Ce qu'on a tiré des pots depuis le départ. On CUMULE au lieu de verser à
 * chaque pot : le serveur n'accepte qu'un versement par course (cf. /api/pot),
 * et deux appels coup sur coup feraient perdre le second pot.
 */
const recolte = { mon: 0, hisui: 0 }

function ramasserTresor(t: Tresor) {
  recolte.mon += t.mon
  recolte.hisui += t.hisui
  jouerBruit('jarreDoree')
  /*
   * Le jade s'annonce autrement que les pièces : c'est la trouvaille rare, elle
   * ne doit pas se confondre avec un gain ordinaire dans le coin de l'œil.
   *
   * ⚠️ Et quand il y a du jade, LES PIÈCES SONT ANNONCÉES AUSSI. Elles tombent
   * désormais dans tous les cas : n'afficher que le jade laisserait croire
   * qu'on a troqué les unes contre l'autre, alors qu'on a reçu les deux.
   */
  toast(
    t.hisui > 0
      ? `💎 JADE ! +${t.hisui} Hisui — et +${t.mon} Mon`
      : `🟢 +${t.mon} Mon`
  )
}

/**
 * Verse la récolte au serveur, à l'arrivée. Le solde affiché est rafraîchi dans
 * la foulée — sans quoi on verrait sa bourse inchangée après avoir ramassé, et
 * on croirait le pot cassé pour rien.
 */
function encaisserPots() {
  if (recolte.mon <= 0 && recolte.hisui <= 0) return
  const total = { ...recolte }
  // Remis à zéro TOUT DE SUITE : un double appel ne doit pas payer deux fois
  recolte.mon = 0
  recolte.hisui = 0
  void verserPots(total).then(({ verse }) => {
    if (verse) {
      majAffichageBourse()
      return
    }
    /*
     * ⚠️ REFUSÉ : on REMET la récolte de côté au lieu de la jeter.
     *
     * Le serveur n'accepte qu'un versement par minute. En course ordinaire on
     * ne verse qu'à l'arrivée, le cas ne se posait pas ; en course SANS FIN on
     * verse à chaque tronçon, et une carte bouclée un peu vite passe sous le
     * délai. Sans ce retour en arrière, le joueur perdrait les pots d'un tour
     * entier pour avoir couru trop bien.
     */
    recolte.mon += total.mon
    recolte.hisui += total.hisui
  })
}

/**
 * Tente de frapper sur la ligne `lane`. Renvoie true si le swipe a été
 * consommé par une attaque — l'appelant n'exécute alors PAS le déplacement.
 */
/**
 * Le rival est-il à portée de lame sur cette ligne ? On se fie à sa position
 * ESTIMÉE (extrapolée), la seule honnête — mais le serveur revérifiera.
 */
function rivalAuContact() {
  if (!online || enTreve()) return null // 👻 pas de cible pendant la trêve
  for (const r of rivals.values()) {
    if (!r.opp.active || r.finished) continue
    if (r.opp.laneNow !== player.currentLane) continue
    // Un contact, pas une portée : il faut être sur lui, à sa hauteur.
    if (Math.abs(r.opp.distanceNow - distance) > CONTACT_Z) continue
    if (Math.abs(r.opp.mesh.position.y - player.mesh.position.y) > CONTACT_Y) continue
    return r
  }
  return null
}

/**
 * Le bot à portée de lame sur cette ligne — la cible du mode entraînement.
 *
 * Les bots SONT les rivaux du solo : les priver du corps à corps ferait de
 * l'entraînement un mode où l'on ne peut pas répéter le geste qui décide les
 * duels. Mêmes règles que contre un humain, sans le serveur (rien à valider :
 * tout se passe sur cette machine).
 */
/**
 * Tente de s'accrocher à la paroi de ce côté (-1 gauche, +1 droite).
 *
 * Trois conditions : être EN VOL (le mur est une manœuvre aérienne, pas un
 * raccourci qu'on prend au sol — il faut donc avoir sauté avant d'arriver),
 * être sur la voie extérieure de ce côté, et qu'un pan de mur borde la piste
 * ici. Renvoie true si le swipe a servi à ça.
 */
function tenteMur(cote: -1 | 1): boolean {
  /*
   * Deux parois possibles, et la seconde est la nouveauté.
   *
   * 1. Le PAN DE MUR qui borde la piste — depuis la voie extérieure seulement.
   * 2. Le FLANC D'UNE PLATEFORME, depuis n'importe quelle voie.
   *
   * On n'escalade un mur que de face : vu de côté, un wagon est une paroi comme
   * une autre. Ça donne une troisième réponse au convoi — après « prendre la
   * rampe » et « payer l'escalade » — et c'est la seule qui demande du geste :
   * il faut avoir sauté AVANT d'arriver à sa hauteur.
   */
  const surVoieExterieure = player.currentLane === (cote === -1 ? 0 : 2)
  const flanc = track.flancA(player.currentLane, cote, player.mesh.position.y)

  let accroche = false
  let msg = ''

  if (surVoieExterieure && track.murA(distance, cote)) {
    if (player.accrocheMur(cote)) {
      accroche = true
      msg = '🧱 Au mur !'
    }
  } else if (flanc !== null) {
    if (player.accrocheMur(cote, flanc)) {
      accroche = true
      msg = '🚃 Au flanc !'
    }
  }

  if (accroche) {
    // Les rivaux doivent le VOIR filer le long de la paroi : c'est la manoeuvre
    // la plus spectaculaire du jeu, et rien ne la transmettait.
    if (online) net.sendAction({ t: 'mur', cote })
    jouerBruit('glissade')
    toast(msg)
    return true
  }
  return false
}

function botAuContact(): Bot | null {
  if (online || enTreve()) return null // 👻 pas de cible pendant la trêve
  for (let i = 0; i < nbBots; i++) {
    const b = bots[i]
    if (!b.actif || b.ligne !== player.currentLane) continue
    if (Math.abs(b.distance - distance) > CONTACT_Z) continue
    if (Math.abs(b.mesh.position.y - player.mesh.position.y) > CONTACT_Y) continue
    return b
  }
  return null
}

/**
 * Un maillon de chaîne de plus, et le gain qui va avec.
 * Une jarre ou un rival valent pareil : c'est le RANG qui paie.
 */
function encaisseGain() {
  chaine = Math.min(CHAINE_MAX, chaine + 1)
  chaineT = CHAINE_FENETRE
  speed = Math.max(6, speed * (1 - COUP_COUT) + COUP_GAIN * chaine)
}

/**
 * ————— Donner un coup de lame —————
 * Le swipe ne fait que SORTIR LA LAME. Ce qu'elle touche est réglé image par
 * image dans la boucle de jeu (cf. resoudCoup), au CONTACT des corps.
 *
 * C'est ce découplage qui répare la montée infinie : avant, la lame frappait
 * tout ce qui se trouvait devant, à n'importe quelle altitude — on cassait une
 * jarre restée au sol depuis dix mètres de haut, on empochait le rebond, et
 * l'on grimpait sans jamais redescendre. Maintenant il faut aller la toucher.
 *
 * Le geste est donc toujours gratuit : c'est le contact qui coûte et rapporte.
 */
function donneCoup() {
  if (!combatActif() || player.surMur !== 0) return
  player.attaquer() // refusé si un coup est déjà en cours : pas de moulinet
}

/**
 * Le coup en cours touche-t-il quelque chose ? Appelé à chaque image tant que
 * la lame est sortie. Une seule cible par coup — on ne fauche pas une grappe
 * entière d'un seul geste.
 */
function resoudCoup() {
  if (!player.enAttaque || !combatActif()) return

  // Le rebond ne récompense QUE les coups donnés en vol : au sol, on casse la
  // jarre et l'on continue à courir, sans tremplin.
  const enLAir = !player.onGround
  const box = player.hitbox()
  // La lame balaie SOUS les pieds : on tranche ce qu'on survole de peu. Sans
  // cette allonge, il faudrait toucher la jarre du corps — la fenêtre serait
  // de deux mètres à peine, injouable au doigt sur un écran qui défile.
  box.min.y -= PORTEE_LAME

  // 🏺 Une jarre, d'abord : c'est la cible posée là exprès par le niveau.
  const { touchee, parchemin, tresor, sommet } = track.casseAuContact(box)
  if (touchee) {
    jouerBruit(parchemin || tresor ? 'jarreDoree' : 'jarre')
    encaisseGain()
    // On rebondit DEPUIS le sommet de la jarre : chaque bond repart du même
    // niveau, donc la chaîne ne dérive ni vers le haut ni vers le bas.
    if (enLAir) player.rebondSur(sommet)
    if (parchemin) gagneParchemin(parchemin)
    else if (tresor) ramasserTresor(tresor)
    else if (chaine >= 2) toast(`⚔️ Chaîne ×${chaine}`)
    return
  }

  // ⚔️ Un bot (entraînement) : tout est local, le coup porte immédiatement.
  const bot = botAuContact()
  if (bot) {
    bot.encaisseCoup(PVP_FREIN)
    jouerBruit('coup')
    encaisseGain()
    if (enLAir) player.rebond()
    toast(chaine >= 2 ? `⚔️ ${bot.profil.nom} ! Chaîne ×${chaine}` : `⚔️ ${bot.profil.nom} touché !`)
    return
  }

  // ⚔️ Le rival en ligne : on joue le geste (et le rebond) TOUT DE SUITE, mais
  // les dégâts sont tranchés par le serveur, qui rejuge le coup à l'instant où
  // on l'a porté. Attendre sa réponse pour bouger rendrait la lame molle.
  const rival = rivalAuContact()
  if (rival) {
    net.sendPvp(player.currentLane)
    jouerBruit('coup')
    if (enLAir) player.rebond()
  }
}

/**
 * Quand les taps servent à MARTELER plutôt qu'à esquiver :
 * - le sprint final (les derniers mètres)
 * - le décompte 3-2-1 : le DÉPART CANON — plus tu martèles, plus tu pars vite
 */
function inSprintZone() {
  return (
    (state === 'course' && versLaFin()) ||
    state === 'depart'
  )
}

/** Retour à l'écran-titre. `banner` : le mot de la fin de la course précédente. */
function backToMenu(banner?: string) {
  state = 'menu'
  online = false
  // ♾️ On quitte le mode infini en même temps que la course : sans ça, le
  // brasier resterait allumé derrière le menu, et la course suivante hériterait
  // d'une règle qu'on n'a pas choisie.
  modeInfini = false
  /*
   * 🎓 Le tutoriel aussi — y compris la FICHE, qui vit hors de `#overlay` et ne
   * disparaît donc pas en changeant d'écran. Quitter pendant une explication
   * l'aurait laissée par-dessus le menu-titre.
   */
  modeTuto = false
  phaseTuto = 'neige'
  etapeTuto = 0
  tutoAttend = null
  tutoEl.classList.add('hidden')
  tutoEl.classList.remove('tape')
  gele = false
  // ⏸ On sort de la pause en même temps que de la course, et le bouton s'en va.
  ouvrirPause(false)
  btnPauseEl.classList.add('hidden')
  degats = 0
  lourdeur = 0 // 🏺 on repart léger
  dernierTroncon = 0 // ♾️ la carte repart du premier tour
  majJarres()
  majBrasier()
  /*
   * ⏳ UNE COURSE LANCÉE MAIS PAS ENCORE REJOINTE S'ANNULE ICI.
   *
   * Sans cette ligne, quitter le salon pendant les secondes d'attente
   * n'empêchait rien : la boucle de jeu tenait toujours sa graine et
   * rapatriait le joueur sur la piste quelques secondes plus tard, depuis le
   * menu principal. Le décompte en deux temps a ouvert cette fenêtre — avant,
   * on partait à l'instant même et il n'y avait rien à annuler.
   *
   * ⚠️ C'est le passage OBLIGÉ de tous les abandons (quitter le salon,
   * annuler, erreur réseau) : le poser ailleurs en oublierait un.
   */
  departImminent = null
  menu.setDepartSalon(null)
  musique.jouer('menu')
  clearRivals()
  for (const b of bots) {
    b.actif = false
    b.cacher()
  }
  for (const c of tetesRivaux) c.wrap.classList.add('hidden')
  progressbarEl.classList.add('hidden') // la colonne n'a de sens qu'en course
  // Une lame encore en l'air à l'arrivée resterait plantée dans le menu
  for (const p of projets) {
    p.actif = false
    p.mesh.visible = false
  }
  for (const b of brumes) {
    b.actif = false
    b.group.visible = false
  }
  theFin = 0
  for (const c of theCercles) c.visible = false
  for (const c of chaines) {
    c.actif = false
    c.group.visible = false
  }
  grueAnneau.visible = false
  miroirGroup.visible = false
  hideSpark()
  gapEl.classList.add('hidden')
  aspiEl.classList.add('hidden')
  countEl.classList.remove('show')
  sprintEl.classList.add('hidden')
  menu.showTitle(banner)
}


/**
 * ♾️ Rapproche (ou éteint) le brasier, d'après les dégâts encaissés.
 *
 * Une seule variable CSS porte tout : la hauteur des flammes, leur emprise sur
 * les bords, leur éclat. Écrire les cinq paliers en dur des deux côtés aurait
 * demandé de les tenir d'accord à jamais.
 *
 * Le plancher à 0,1 n'est pas décoratif : sans lui, un joueur qui n'a rien
 * encaissé ne verrait AUCUN feu et ne saurait pas qu'il est poursuivi. La règle
 * doit s'apprendre en jouant, pas dans un écran d'aide.
 */
/**
 * 🏺 Le compte des jarres percutées, sous le chiffre principal.
 *
 * Il ne s'affiche qu'en course sans fin : ailleurs, une jarre ne laisse aucune
 * trace après le choc, et un compteur figé à zéro poserait une question sans
 * réponse.
 */
/**
 * ⏸ Ouvre ou ferme le voile de pause.
 *
 * ⚠️ EN LIGNE, ON N'ARRÊTE RIEN. Les autres continuent de courir : figer sa
 * propre piste donnerait un écran menteur, et l'on reprendrait après avoir
 * traversé sans les voir les obstacles de ces secondes-là. Le voile s'ouvre
 * quand même — il faut pouvoir quitter — mais le jeu tourne derrière, et le
 * texte le dit franchement au lieu de laisser croire à un répit.
 */
function ouvrirPause(ouvert: boolean) {
  // Le bouton ne répond qu'en course : au menu ou sur l'écran de fin, il n'y a
  // rien à mettre en pause, et le voile masquerait ce qu'on est en train de lire.
  if (ouvert && state !== 'course' && state !== 'depart') return
  enPause = ouvert && !online
  pauseEl.classList.toggle('hidden', !ouvert)
  pauseTitreEl.textContent = online ? '⚔️ Course en ligne' : '⏸ Pause'
  /*
   * ⌨️ Le rappel de la touche T n'apparaît QUE sur un appareil à pointeur fin —
   * c'est-à-dire une souris, donc un clavier. L'afficher sur un téléphone
   * parlerait d'une touche qui n'existe pas, à côté d'un bouton qu'on a sous le
   * pouce.
   */
  const clavier = matchMedia('(pointer: fine)').matches ? ' (ou la touche T)' : ''
  pauseMotEl.textContent = online
    ? 'La course CONTINUE — on ne met pas les autres en attente. Tu peux la quitter, mais tu ne la reprendras pas.'
    : `La course est arrêtée. Reprends quand tu veux${clavier}.`
  // « Reprendre » ne promet pas la même chose des deux côtés : hors ligne on
  // repart où l'on s'est arrêté, en ligne on retourne à une course qui a
  // continué sans nous.
  btnReprendreEl.textContent = online ? '↩ RETOUR À LA COURSE' : '▶ REPRENDRE'
}

function majJarres() {
  jarresEl.classList.toggle('hidden', !modeInfini)
  if (!modeInfini) return
  jarresNEl.textContent = String(lourdeur)
  // Le pourcentage n'apparaît que s'il y a quelque chose à perdre : « −0 % »
  // occuperait la place pour ne rien dire.
  const perte = Math.round((1 - facteurLourdeur()) * 100)
  jarresPctEl.textContent = perte > 0 ? `−${perte} %` : ''
}

function majBrasier() {
  const p = modeInfini ? 0.1 + 0.9 * (degats / DEGATS_MAX) : 0
  brasierEl.style.setProperty('--proche', p.toFixed(3))
  const critique = modeInfini && DEGATS_MAX - degats <= 1
  // Le dernier palier bat plus vite : on doit sentir que c'est maintenant,
  // sans avoir à lire un chiffre.
  brasierEl.classList.toggle('critique', critique)

  // ————— Le compte des coups, en haut au milieu —————
  degatsEl.classList.toggle('hidden', !modeInfini)
  degatsEl.classList.toggle('critique', critique)
  if (!modeInfini) return

  // Les pastilles sont bâties une fois puis seulement rallumées : les recréer à
  // chaque coup relancerait leur transition depuis le début, et le fondu de
  // celles déjà éteintes repartirait à zéro sous les yeux du joueur.
  if (degatsPucesEl.childElementCount !== DEGATS_MAX) {
    degatsPucesEl.replaceChildren(
      ...Array.from({ length: DEGATS_MAX }, () => document.createElement('i'))
    )
  }
  const puces = degatsPucesEl.children
  for (let i = 0; i < puces.length; i++) puces[i].classList.toggle('pris', i < degats)

  /*
   * ⚠️ COURT. Le chrono tient le coin gauche, les boutons le coin droit : au
   * milieu il ne reste qu'environ 145 px sur un téléphone étroit. « 6 avant les
   * flammes » passait sous les boutons. Les PASTILLES disent déjà tout — celles
   * qui restent et celles qu'on a perdues — ce mot n'est qu'un rappel chiffré.
   */
  const reste = DEGATS_MAX - degats
  degatsMotEl.textContent =
    reste === 0 ? 'RATTRAPÉ' : reste === 1 ? 'DERNIÈRE' : `reste ${reste}`
}
/**
 * ————— ♾️ Un coup encaissé, en mode infini —————
 *
 * Appelée depuis la SEULE branche où le joueur perd vraiment sa vitesse :
 * l'armure et l'escalade passent ailleurs, et ne comptent donc jamais.
 *
 * Le compteur ne redescend pas. C'était tentant — récompenser une longue série
 * propre en éloignant un peu les flammes — mais cela changerait la règle
 * annoncée : « cinq obstacles et c'est fini » deviendrait « cinq obstacles
 * rapprochés ». Une règle qu'on ne peut pas énoncer en une phrase ne se retient
 * pas, et le joueur ne saurait plus combien il lui reste de droit à l'erreur.
 */
function encaisserCoup() {
  degats = Math.min(DEGATS_MAX, degats + 1)
  majBrasier()
  const reste = DEGATS_MAX - degats
  if (reste <= 0) {
    finInfini()
    return
  }
  // Le message ne RÉPÈTE plus le compte : la jauge du haut le montre en
  // permanence. Il marque l'instant du coup, ce qu'une jauge ne sait pas faire.
  toast(reste === 1 ? '🔥 Dernière chance !' : '🔥 Les flammes gagnent du terrain')
}

/**
 * ————— ♾️ Les flammes ont rattrapé le coureur —————
 *
 * On mesure en MÈTRES, et le plus loin gagne — l'inverse d'une course. Le
 * record vit donc sous sa propre clé : le mêler aux chronos rendrait les deux
 * illisibles, puisqu'ils ne se comparent pas dans le même sens.
 */
/* ————————————————————————————————————————————————————————————
   🎓 LE TUTORIEL
   ———————————————————————————————————————————————————————————— */

/** Les éléments de la fiche, cherchés une fois. */
const tutoEl = document.getElementById('tuto')!
const tutoTitreEl = document.getElementById('tutoTitre')!
const tutoTexteEl = document.getElementById('tutoTexte')!
const tutoDoigtEl = document.getElementById('tutoDoigt')!
const tutoClavierEl = document.getElementById('tutoClavier')!
const tutoEtapeEl = document.getElementById('tutoEtape')!

/** ▶️ On entre dans le tutoriel : la neige, et personne autour. */
function demarrerTuto() {
  online = false
  modeInfini = false
  modeTuto = true
  phaseTuto = 'neige'
  etapeTuto = 0
  tutoAttend = null
  tutoLignes = false
  tutoDepartVu = false
  nbBots = 2 // 🌉 ils ne courent qu’au second temps (cf. startRace)
  startRace(Math.floor(Math.random() * 2 ** 31))
}

/**
 * ⏸ Fige la course et pose la fiche.
 *
 * ⚠️ On réutilise `gele`, écrit pour le banc d'essai des sorts : il met la
 * vitesse à zéro ET met le coureur au repos, donc la piste ne défile plus et
 * rien ne vient percuter. Un second mécanisme de gel n'aurait fait que doubler
 * celui-là — avec ses propres oublis.
 */
function figerTuto(e: EtapeTuto, rang: string) {
  gele = true
  tutoTitreEl.textContent = e.titre
  tutoTexteEl.textContent = e.texte
  tutoDoigtEl.textContent = e.doigt
  tutoClavierEl.textContent = e.clavier
  tutoEtapeEl.textContent = rang
  tutoAttend = e.attend
  // 🔒 Les lignes s'ouvrent à l'étape qui les enseigne, et ne se referment plus.
  if (e.ouvreLesLignes) tutoLignes = true
  /*
   * ⚠️ La fiche ne capte le doigt QUE si elle attend un tap. Sinon elle
   * avalerait le swipe qu'elle vient de demander, et le joueur glisserait dans
   * le vide en se croyant maladroit.
   */
  tutoEl.classList.toggle('tape', tutoAttend === 'tap')
  tutoEl.classList.remove('hidden')
}

/*
 * 👆 Les étapes qui n'attendent pas de geste se passent en touchant la fiche.
 *
 * ⚠️ L'écouteur est posé UNE FOIS, ici, et non à chaque affichage : en
 * rattacher un par fiche en aurait empilé cinq par tutoriel, et le second
 * tutoriel de la session aurait sauté deux étapes d'un seul doigt.
 */
tutoEl.addEventListener('click', () => {
  if (tutoAttend === 'tap') reprendreTuto()
})

/** ▶️ Le geste est fait : on relâche et on passe à la fiche suivante. */
function reprendreTuto() {
  tutoEl.classList.add('hidden')
  tutoEl.classList.remove('tape')
  tutoAttend = null
  gele = false
  /*
   * ⚠️ La fiche du départ n'est PAS une étape du parcours : elle vit dans
   * l'état « départ », avant le premier mètre. L'incrémenter ici ferait sauter
   * « ⛩️ Bienvenue », et le tutoriel commencerait par sa deuxième page.
   */
  if (!tutoDepartVu) {
    tutoDepartVu = true
    return
  }
  etapeTuto++
}

/**
 * Le geste du joueur, pendant une fiche.
 *
 * ⚠️ On ne bloque PAS les autres gestes : swiper vers le bas quand la fiche
 * demande un saut fait bien glisser le coureur, sur place. C'est voulu — on
 * essaie, on voit ce que ça fait, et rien n'est cassé. Seul le bon geste
 * relâche la course.
 */
function tutoGeste(quoi: 'saut' | 'glissade' | 'ligne' | 'tap') {
  if (!tutoAttend) return
  if (tutoAttend === quoi || (tutoAttend === 'tap' && quoi !== 'tap')) reprendreTuto()
}

/**
 * 🌉 On passe de la neige au pont.
 *
 * Une VRAIE course d'entraînement : deux rivaux, une piste tirée au sort, plus
 * une seule fiche. On vient de dire « à toi de courir » — il faut que ce soit
 * vrai, sinon la promesse ne vaut rien.
 */
function passerAuPont() {
  phaseTuto = 'pont'
  tutoAttend = null
  tutoEl.classList.add('hidden')
  gele = false
  startRace(Math.floor(Math.random() * 2 ** 31))
  toast('🌉 Pont au clair de lune — à toi de courir !')
}

/**
 * 🏁 La fin du tutoriel : une animation, pas un podium.
 *
 * ⚠️ Et RIEN n'est enregistré : ni record personnel, ni ligne au tableau des
 * temps. On rejoue son tutoriel autant qu'on veut ; un classement qu'on
 * remplit en répétant ses gammes ne classe plus rien.
 */
function finTuto() {
  state = 'fini'
  jouerBruit('victoire')
  menu.showFin({
    titre: 'Tu sais courir. Le reste, ça se gagne.',
    joueurs: [],
    canReplay: true,
    canLobby: false,
    anim: true,
  })
}

function finInfini() {
  if (state === 'fini') return // deux obstacles dans la même image ne tuent qu'une fois
  state = 'fini'
  const metres = Math.floor(distance)

  /*
   * ♾️ La distance entre au tableau des courses sans fin — le SIEN, pas celui
   * des chronos : on y trie du plus grand au plus petit (cf. scores.ts).
   *
   * Le rang n'est annoncé que s'il existe : dire « 11ᵉ » quand la table n'en
   * garde que dix serait un classement fantôme.
   */
  const { recordAvant, precedentes } = ajouterInfini({
    metres,
    nom: menu.settings.name || 'Guerrier anonyme',
    fighter: menu.settings.fighter,
    date: Date.now(),
    pays: menu.settings.pays, // 🌍 le drapeau du jour, figé avec la distance
    region: menu.settings.region,
  })
  const bat = metres > recordAvant
  jouerBruit(bat ? 'victoire' : 'defaite')

  /*
   * ————— ♾️ Un relevé, pas un podium —————
   *
   * Un podium à trois marches suppose trois coureurs ; ici on court seul, et
   * deux marches vides se liraient comme un abandon. On montre donc les seuls
   * chiffres qui aient un sens en solitaire : ce qu'on vient de faire, le
   * record, et les courses d'avant — de quoi voir si l'on progresse.
   *
   * ⚠️ Le record affiché est celui d'AVANT quand on vient de le battre : « tu
   * as fait 1240, ton record est 1240 » n'apprendrait rien. On montre ce qui a
   * été dépassé, ce qui est toute la nouvelle.
   */
  const resume = [
    { label: 'Cette course', valeur: `${metres} m`, fort: true },
    {
      label: bat ? 'Ancien record' : 'Ton record',
      valeur: `${bat ? recordAvant : Math.max(recordAvant, metres)} m`,
    },
    ...precedentes.map((p, i) => ({
      label: i === 0 ? 'Course précédente' : 'Celle d\'avant',
      valeur: `${p.metres} m`,
    })),
  ]

  menu.showFin({
    titre: bat
      ? `🔥 Rattrapé — mais c'est ton RECORD&nbsp;!`
      : `🔥 Les flammes t'ont rattrapé`,
    joueurs: [],
    canReplay: true,
    canLobby: false,
    resume,
  })
}

/** Lance une course. En ligne, la graine vient du serveur : même piste pour les deux ! */
function startRace(seed: number) {
  // Le décompte fait déjà partie de la course : la piste démarre avec lui.
  musique.jouer('race')

  // ————— La grille de départ —————
  // On aligne joueur + bots sur la MÊME ligne, répartis de gauche à droite sur
  // les 3 voies (le joueur à gauche, les bots vers la droite). En duel, c'est le
  // serveur qui donne la place ; ici on ne gère que la grille solo.
  // ♾️ Seul sur la piste en infini : la grille n'a qu'un coureur, donc le milieu.
  const nbCoureurs = modeInfini ? 1 : 1 + nbBots
  const voieDe = (k: number) => (nbCoureurs === 1 ? 1 : Math.round((k / (nbCoureurs - 1)) * 2))
  /*
   * 🎓 AU MILIEU, TOUJOURS, pendant le tutoriel.
   *
   * ⚠️ La grille répartit les coureurs de gauche à droite, et le tutoriel
   * annonce deux rivaux dès son premier temps : `voieDe(0)` plaçait donc le
   * joueur SUR LA LIGNE DE GAUCHE, alors qu'on lui pose ses obstacles au
   * centre et qu'on lui interdit encore de changer de ligne. Il regardait
   * passer la leçon à côté de lui.
   */
  player.reset(modeTuto ? 1 : online ? net.myStartLane : voieDe(0))
  // Les avatars des rivaux sont (re)placés par syncRivals dès la 1re position
  // reçue ; ici on repart d'une table propre en solo, et on garde les rivaux
  // déjà connus du lobby en ligne.
  if (!online) clearRivals()
  // La récolte de pots repart de zéro à chaque départ
  recolte.mon = 0
  recolte.hisui = 0
  // 🏋️ Les pots verts n'existent qu'EN LIGNE : ils donnent de la monnaie, et
  // l'entraînement se relance seul, à volonté. Voir buildJarrePlan.
  /*
   * 🟢 Les pots verts existent EN LIGNE et en COURSE SANS FIN.
   *
   * Ils étaient réservés au multi parce que l'entraînement se relance à
   * volonté : on y aurait moissonné en boucle. La course sans fin, elle, se paie
   * en distance — pour toucher le tronçon suivant il faut vraiment y survivre.
   */
  /*
   * 🎓 LA NEIGE DU TUTORIEL EST UNE PISTE ÉCRITE À LA MAIN.
   *
   * Nue — ni jarres, ni rouleaux, ni plateformes, ni murs latéraux — et son
   * décor est FORCÉ. Un tirage, même heureux, ne peut pas promettre « un seul
   * obstacle à la fois, dans cet ordre » ; et un décor qui change au milieu
   * d'une explication distrait de ce qu'on explique.
   *
   * ⚠️ Le second temps, lui, est une VRAIE course : piste tirée au sort comme
   * partout ailleurs, seul le décor reste choisi. On vient de dire « à toi de
   * courir » — ce serait mentir que de lui donner un parcours sur mesure.
   */
  if (modeTuto) {
    const neige = phaseTuto === 'neige'
    track.reset(COURSE_LENGTH, seed, false, false, {
      biome: neige ? BIOME_NEIGE : BIOME_PONT,
      plan: neige ? PLAN_NEIGE : undefined,
      plateformes: neige ? PLATEFORMES_NEIGE : undefined,
      murs: neige ? MURS_NEIGE : undefined,
      jarres: neige ? JARRES_NEIGE : undefined,
      nu: neige,
    })
  } else {
    track.reset(COURSE_LENGTH, seed, online || modeInfini, modeInfini)
  }
  time = 0
  distance = 0
  speed = 0
  stumble = 0
  netTimer = 0
  raceGo = false
  sprintTaps = []
  sprintCharge = 0
  sprintSeen = false
  chaine = 0
  chaineT = 0
  dernierChiffre = -1
  ligneCharge = 0
  aspiCharge = 0
  slots = []
  ventFin = 0
  kusarigamaFin = 0
  armure = 0
  // ♾️ Le droit à l'erreur repart entier à chaque partie, et le feu recule.
  degats = 0
  lourdeur = 0 // 🏺 on repart léger
  dernierTroncon = 0 // ♾️ la carte repart du premier tour
  majJarres()
  majBrasier()
  grueFin = 0
  miroirFin = 0
  fumigeneFin = 0
  senbonFin = 0
  portail = null
  terreEl.classList.remove('on') // pas de boue d'une course sur la suivante
  portailGroup.visible = false
  impactGroup.visible = false // ni orbe ni brûlure ne survivent à une course
  impactFin = 0
  for (const p of projets) {
    p.actif = false
    p.mesh.visible = false
  }
  for (const b of brumes) {
    b.actif = false
    b.group.visible = false
  }
  theFin = 0
  for (const c of theCercles) c.visible = false
  for (const c of chaines) {
    c.actif = false
    c.group.visible = false
  }
  grueAnneau.visible = false
  miroirGroup.visible = false
  lueurFin = 0
  lueurCible = null
  lueurJoueur.visible = false
  lueurRival.visible = false
  hideSpark()

  /*
   * ————— 🐛 CE QUI SURVIVAIT D'UNE COURSE À L'AUTRE —————
   *
   * Ces trois-là se comparent au chrono de la course, qui repart à zéro — mais
   * eux gardaient la valeur de la course PRÉCÉDENTE. Le « rejouer » de l'écran
   * de fin ne repasse pas par le menu, donc rien ne les nettoyait.
   *
   * ⚠️ `escaladeT` était le plus grave, et il se jouait à la manette : il
   * multiplie la vitesse par 0,16. Finir ou quitter dans la seconde qui suit
   * une escalade — le cas normal en course sans fin, où l'on meurt souvent
   * juste après — et la course suivante démarrait à 16 % de vitesse pendant
   * plus d'une seconde. Le décompte n'y changeait rien : le minuteur ne
   * s'écoule que dans l'état `course`, jamais pendant le 3-2-1.
   *
   * ⚠️ `boomFin` laissait l'explosion du kunai à l'écran. Pire qu'une simple
   * rémanence : le facteur `(boomFin - time) / BOOM_DUREE` valait alors des
   * dizaines au lieu de descendre de 1 à 0, donc une ÉCHELLE NÉGATIVE et une
   * opacité saturée — une sphère retournée, opaque, plantée dans le décor.
   *
   * ⚠️ `chaineToastT` retenait le message « clouté au sol » pendant tout le
   * temps déjà écoulé à la course d'avant. Un avertissement qu'on ne voit pas
   * est pire qu'absent : le joueur subit l'effet sans savoir ce qui le frappe.
   */
  escaladeT = 0
  boomFin = 0
  boomMesh.visible = false
  chaineToastT = 0
  fumeeEl.classList.remove('show')
  canvas.classList.remove('poison')
  // 🌸💥💨 Les effets de course repartent à zéro : cerisier au départ, pétales
  // et zones de fumée éteints, rideau de vitesse coupé.
  cerisier.position.set(CERISIER_X, 0, -9)
  cerisier.visible = true
  for (const p of petales) p.mesh.visible = false
  petalesActifs = true
  ventPhase = 0
  // 🌬️ La rafale qui emporte les pétales, le temps du décompte (6 s en salon,
  // 3 s en solo). Le son est synthétisé : aucun fichier à charger.
  souffleDeVent(online ? 5 : 3.2)
  boomMesh.visible = false
  // 💨 Poussière : on efface les nuages et on repart « tout le monde au sol »
  for (const p of poussieres) p.mesh.visible = false
  joueurEnLAir = false
  botEnLAir.fill(false)
  // 🛡️ Ni dôme ni éclat ne survivent d'une course à l'autre
  boucFlash = 0
  boucFill.visible = false
  boucLignes.visible = false
  for (const e of eclats) e.mesh.visible = false
  for (const z of fumeeZones) {
    z.actif = false
    z.disque.visible = false
    z.dome.visible = false
  }
  speedEl.style.opacity = '0'
  drawSlots()

  // Les rivaux : uniquement en entraînement (en ligne, l'adversaire est réel).
  // Ils lisent le MÊME plan d'obstacles et de rouleaux que le joueur.
  const rangees = construireRangees(track.obstaclesPrevus())
  const rouleaux = track.parcheminsPrevus()
  bots.forEach((b, i) => {
    // ♾️ Pas de rivaux en course sans fin : on court contre les flammes.
    // 🎓 ❄️ Personne sur la neige : on y apprend seul, sans rien qui double ni
    // qui distraie. Les deux rivaux n'apparaissent qu'au pont.
    b.actif = !online && !modeInfini && (!modeTuto || phaseTuto === 'pont') && i < nbBots
    // Graine dérivée : chaque rival tire ses fautes ailleurs dans la suite,
    // sinon les 4 rateraient exactement les mêmes obstacles au même endroit.
    // Le joueur est l'indice 0 de la grille, les bots suivent (voie répartie).
    b.reset(rangees, rouleaux, (seed ^ ((i + 1) * 0x9e3779b1)) | 0, voieDe(i + 1))
  })

  // Le classement en direct : visible dans les deux modes !
  rankTimer = 0
  majTetes()

  countdown = 3
  state = 'depart'
  shadersPrets = false // ⚡ la piste va être repeuplée : on recompile au décompte
  menu.hide()
  // ⏸ Le bouton n'a de sens qu'en course : il apparaît avec elle.
  btnPauseEl.classList.remove('hidden')
  ouvrirPause(false)
  updateMeLabel()
  countEl.classList.add('show')
  // Le départ canon : la jauge apparaît dans les 3 dernières secondes (cf. boucle)
  sprintEl.classList.add('hidden')
  sprintLabelEl.textContent = '🚀 DÉPART CANON'
  sprintFillEl.style.width = '0%'
  oublierHud() // le HUD repart de zéro : le cache ne doit rien retenir
  progressbarEl.classList.remove('hidden')
  progressEl.style.height = '0%'
  coureurMoi.wrap.style.bottom = '0%'
  // Le marqueur unique n'a plus de sens à 10 : c'est le classement en direct
  // qui montre où en est chacun. La bulle d'écart vise le plus proche devant.
  gapEl.classList.remove('hidden')
}

/**
 * Le verdict de l'entraînement. On le calcule à l'instant où le joueur coupe
 * la ligne : tout rival qui n'a pas encore fini est forcément derrière lui.
 */
function classement(): string {
  const rivaux = botsEnCourse()
  if (!rivaux.length) return ''

  const finis = rivaux.filter((b) => b.tempsArrivee >= 0)
  const rang = 1 + finis.length
  const medaille = ['🥇', '🥈', '🥉'][rang - 1] ?? '🏁'
  const place = `${medaille} ${rang === 1 ? '1er' : `${rang}ᵉ`} sur ${rivaux.length + 1}`

  if (finis.length) {
    // Celui qui vient de te battre : le dernier arrivé juste avant toi. C'est
    // lui l'objectif de la prochaine course, pas le vainqueur inaccessible.
    const devant = finis.reduce((a, b) => (a.tempsArrivee > b.tempsArrivee ? a : b))
    const ecart = (time - devant.tempsArrivee).toFixed(2)
    return `${place} — ${devant.profil.nom} t'a devancé de ${ecart} s`
  }

  // Tu mènes : l'écart sur le poursuivant, estimé à son rythme du moment
  const second = rivaux.reduce((a, b) => (a.distance > b.distance ? a : b))
  const reste = (COURSE_LENGTH - second.distance) / Math.max(second.speed, 1)
  return `${place} — tu devances ${second.profil.nom} de ${reste.toFixed(2)} s`
}

function crossFinishLine() {
  // 🎓 Le tutoriel a sa propre fin : ni podium, ni record, ni ligne au tableau.
  if (modeTuto) {
    finTuto()
    return
  }
  player.mesh.visible = true // au cas où on franchit la ligne en plein clignotement
  sprintEl.classList.add('hidden')
  gapEl.classList.add('hidden')
  const t = time.toFixed(2)
  // 🟢 On encaisse À L'ARRIVÉE, comme le serveur ne paie que ceux qui finissent :
  // abandonner en cours de route ne doit pas rapporter les pots déjà cassés,
  // sinon la meilleure façon de gagner sa vie serait de partir, casser, quitter.
  encaisserPots()

  if (online) {
    // On prévient le serveur et on attend le classement (les autres courent encore)
    net.sendFinished(time)
    state = 'fini'
    // Le temps compte aussi quand il a été couru en ligne : c'est le même torii
    // et la même longueur. Le tableau garde le mode, pour qu'on sache après coup
    // ce qui a été couru seul et ce qui a été couru dans la mêlée.
    ajouterScore(COURSE_LENGTH, {
      temps: time,
      nom: menu.settings.name || 'Guerrier anonyme',
      fighter: menu.settings.fighter,
      mode: 'ligne',
      rivaux: rivals.size,
      date: Date.now(),
      // 🌍 Figé avec le temps : changer de pays plus tard ne réécrit pas
      // l'histoire des courses déjà couponnées.
      pays: menu.settings.pays,
      region: menu.settings.region, // 🏞️ figée avec le temps, comme le pays
    })
    const restants = [...rivals.values()].filter((r) => !r.finished).length
    menu.showStatus(
      `⛩️ Ligne franchie en <b>${t} s</b> !<br>` +
        (restants > 0 ? `${restants} guerrier${restants > 1 ? 's' : ''} encore en course…` : 'Classement…')
    )
    return
  }

  // Solo : meilleur temps gardé en mémoire sur le téléphone
  state = 'fini'
  // La clé porte la longueur : un record établi sur une course plus courte
  // serait imbattable et resterait affiché à vie.
  const CLE_RECORD = `kurogane-best-${COURSE_LENGTH}`
  const best = Number(localStorage.getItem(CLE_RECORD) ?? Infinity)
  let bestLine: string
  if (time < best) {
    localStorage.setItem(CLE_RECORD, String(time))
    bestLine = '🏆 Nouveau record personnel !'
  } else {
    bestLine = `Record à battre : ${best.toFixed(2)} s`
  }
  // En solo on est toujours « arrivé » : c'est la place devant les rivaux qui
  // décide du son, pas le simple fait d'avoir fini.
  jouerBruit(bots.some((b) => b.actif && b.distance >= COURSE_LENGTH) ? 'defaite' : 'victoire')

  // 🏆 La ligne entre au tableau des meilleurs temps. On l'annonce seulement si
  // elle y est entrée : dire « 11ᵉ » quand la table n'en garde que 10 serait un
  // classement fantôme.
  const { rang } = ajouterScore(COURSE_LENGTH, {
    temps: time,
    nom: menu.settings.name || 'Guerrier anonyme',
    fighter: menu.settings.fighter,
    mode: 'solo',
    rivaux: bots.filter((b) => b.actif).length,
    date: Date.now(),
    pays: menu.settings.pays, // 🌍 le drapeau du jour, figé avec le temps
    region: menu.settings.region,
  })
  const rangLine = rang > 0 ? `<br>🏆 ${rang}ᵉ meilleur temps` : ''

  /*
   * ————— 🏁 L'entraînement a droit au même écran que la course —————
   *
   * Il repartait droit au menu-titre avec un bandeau, alors qu'on venait de
   * courir 75 secondes : le résultat défilait dans un coin et l'on n'avait
   * même pas de quoi relancer sans retraverser deux menus.
   *
   * Les rivaux qui n'ont pas franchi le torii n'ont pas de temps — leur
   * `tempsArrivee` vaut -1. On les range après les arrivés, comme en ligne
   * pour un abandon, et non à un temps de 0 qui les mettrait premiers.
   */
  const rivaux = botsEnCourse().map((b) => ({
    nom: b.profil.nom,
    temps: b.tempsArrivee >= 0 ? b.tempsArrivee : null,
    moi: false,
  }))
  const joueurs = [
    { nom: menu.settings.name || 'Guerrier anonyme', temps: time, moi: true },
    ...rivaux,
  ].sort((a, b) => {
    if (a.temps === null && b.temps === null) return 0
    if (a.temps === null) return 1
    if (b.temps === null) return -1
    return a.temps - b.temps
  })

  menu.showFin({
    titre:
      `⛩️ Torii franchi en <b>${t} s</b><br>${classement()}<br>${bestLine}${rangLine}`,
    joueurs,
    canReplay: true,
    // 🏋️ Pas de salon en entraînement : le bouton du milieu n'aurait nulle part
    // où mener. On le cache plutôt que de lui inventer une destination.
    canLobby: false,
  })
}

/** Le classement final : trié, arrivés d'abord (au rang), puis les abandons. */
function showResults(view: LobbyView) {
  const ranked = [...view.players].sort((a, b) => {
    if (a.rank && b.rank) return a.rank - b.rank
    if (a.rank) return -1
    if (b.rank) return 1
    return b.distance - a.distance
  })
  const me = view.players.find((p) => p.id === view.me)
  const total = view.players.length
  const rang = me?.rank || 0
  const titre =
    rang === 1
      ? '🏆 <b>VICTOIRE !</b> La lame légendaire est à toi.'
      : rang > 0
        ? `Tu finis <b>${rang}ᵉ</b> sur ${total}.`
        : '☁️ Tu n\'as pas fini la course…'
  jouerBruit(rang === 1 ? 'victoire' : 'defaite')

  menu.showFin({
    titre,
    joueurs: ranked.map((p) => ({
      nom: p.name || 'Guerrier',
      // Un abandon n'a pas de temps : `rank` à 0 le dit, et `time` vaudrait 0.
      temps: p.rank ? p.time : null,
      moi: p.id === view.me,
    })),
    // Seul l'hôte relance : c'est lui qui commande le départ.
    canReplay: view.isHost,
    // Le retour au salon, lui, est pour tout le monde — y compris celui qui
    // veut juste attendre la manche suivante sans la déclencher.
    canLobby: true,
  })
}

// ————— Le réseau —————
const net = new Net({
  onLobby(view) {
    // Le salon a bougé (arrivée, départ, prêt…) : on (re)dessine le lobby, tant
    // qu'on n'est pas déjà en course. Sert aussi au retour au salon d'après-course.
    if (state === 'course' || state === 'depart') return
    if (state === 'fini' && view.phase === 'lobby') clearRivals() // rematch : on repart propre
    state = 'attente'
    musique.jouer('lobby')
    menu.showLobby(view)

    /*
     * 🔄 Le « rejouer » demandé depuis l'écran de fin arrive à destination : le
     * salon est là, on peut enfin lancer. Réservé à l'hôte — lui seul commande
     * le départ, et l'intention est remise à zéro dans TOUS les cas pour qu'un
     * clic resté en travers ne relance pas une course trois manches plus tard.
     */
    if (relancerDesLobby) {
      relancerDesLobby = false
      if (view.isHost && view.phase === 'lobby') net.sendStart()
    }
  },
  onCountdown(seed) {
    online = true
    /*
     * ⚠️ ON NE PART PAS TOUT DE SUITE. Le décompte se joue en deux temps : on
     * patiente d'abord au SALON, et l'on ne rejoint la grille que pour les
     * dernières secondes (cf. PISTE_MS). On retient donc la graine, et c'est la
     * boucle de jeu qui déclenchera le départ à l'heure.
     *
     * Basculer ici, comme on le faisait, envoyait sur la piste à la seconde même
     * où l'hôte lançait : on n'avait pas le temps de voir qui courait.
     */
    departImminent = seed
    toast('⚔️ La course commence !')
  },
  onGo() {
    raceGo = true
    for (const r of rivals.values()) r.opp.go()
  },
  onPlayers(others) {
    // Positions de tous les autres : on met les avatars en phase avec le salon
    syncRivals(others)
  },
  onSpell(from, kind, d) {
    if (state !== 'course') return
    const r = rivals.get(from)
    // 🔮 Le portail est à part : un échange, pas une affliction. On prend SA
    // place (d) ; de son côté il prend la nôtre. La 🪞 parade ne le renvoie pas.
    if (kind === 'onmyoji') echangerAvec(d, r ? r.name : 'un rival', r ? r.opp.mesh : null)
    else subirSort(kind, null, r ? r.opp.mesh : null, from)
  },
  onAction(a) {
    // Une action d'un rival, reçue à l'instant où il l'a faite — routée vers SON avatar
    rivals.get(a.from)?.opp.applyAction(a)
  },
  onChat(from, name, text) {
    menu.addChatLine(name, text, from === net.id)
  },
  onPvp(par, sur) {
    if (state !== 'course') return
    const victime = sur === net.id
    if (victime) {
      // Le serveur a tranché : on encaisse, sans discuter.
      const attaquant = rivals.get(par)?.name || 'Un rival'
      if (armure > 0) {
        armure = Math.max(0, armure - ARMURE_COUT_PETIT)
        stumble = 1
        toast(`🛡️ L'armure encaisse le coup de ${attaquant} !`)
      } else {
        speed = Math.max(6, speed * PVP_FREIN)
        stumble = 1.2
        chaine = 0 // se faire toucher casse son propre enchaînement
        jouerBruit('chute')
        flash()
        toast(`⚔️ ${attaquant} t'a touché !`)
        net.sendAction({ t: 'stumble', keep: PVP_FREIN })
      }
    } else if (par === net.id) {
      // Notre coup a porté : le rival vaut un maillon, comme une jarre
      const cible = rivals.get(sur)?.name || 'Un rival'
      encaisseGain()
      toast(chaine >= 2 ? `⚔️ ${cible} touché ! Chaîne ×${chaine}` : `⚔️ ${cible} touché !`)
    }
  },
  onLink(up) {
    // NOTRE connexion qui vacille — le SDK retente tout seul derrière
    toast(up ? '📡 Reconnecté !' : '📡 Connexion instable… reconnexion en cours')
  },
  onResults(view) {
    state = 'fini'
    sprintEl.classList.add('hidden')
    gapEl.classList.add('hidden')
    showResults(view)
    // Le serveur vient de payer les arrivants : on relit notre bourse. Elle est
    // créditée LÀ-BAS, on ne fait que la constater — d'où la relecture plutôt
    // qu'une addition côté jeu, qui pourrait mentir.
    void majBourse()
  },
  onError(message) {
    net.leave()
    backToMenu(`⚠️ ${escapeHtml(message)}`)
  },
})

// ————— Les menus —————
/**
 * Qui l'on est, pour le salon de course.
 *
 * Le `token` sert au serveur à savoir quel PORTEFEUILLE créditer à l'arrivée —
 * il ne circule jamais vers les autres joueurs, et le serveur le range à part
 * de l'état partagé. Sans jeton (hors-ligne, base en panne), on court quand
 * même : on ne gagne simplement pas de Mon.
 */
const identity = () => ({
  name: menu.settings.name,
  fighter: menu.settings.fighter,
  // Le perso « + » n'est pas un guerrier de la fiche mais un guerrier PLUS un
  // skin : sans ses couleurs, les autres ne verraient qu'un corps generique.
  skin: menu.settings.fighter === PERSO_ID ? skinEnTexte(menu.settings.custom) : '',
  token: monJeton(),
  // 🌍 D’où l’on se déclare : le classement mondial pourra s’y filtrer.
  pays: menu.settings.pays,
  region: menu.settings.region,
})

const menu = new Menu({
  onSolo() {
    online = false
    modeInfini = false
    menu.showBotPick()
  },
  /**
   * ♾️ La course sans fin part TOUT DE SUITE.
   *
   * Pas d'écran de choix : il n'y a ni rivaux à doser ni longueur à régler.
   * Passer par la fiche des bots pour n'y rien décider ferait un détour que le
   * joueur devrait refaire à chaque partie — or c'est un mode où l'on
   * recommence beaucoup.
   */
  onTuto() {
    demarrerTuto()
  },
  onInfini() {
    online = false
    modeInfini = true
    startRace(Math.floor(Math.random() * 2 ** 31))
  },
  onOnline() {
    // Plus de recherche 1v1 : on ouvre l'accueil des salons (créer / rejoindre).
    menu.showSalon()
  },
  onCreateSalon() {
    menu.showStatus('🏮 Création du salon…')
    net.createSalon(identity())
  },
  onQuick() {
    menu.showStatus('⚡ Recherche d\'un salon public…')
    net.joinQuick(identity())
  },
  onJoinByCode(code) {
    if (!code) return
    menu.showStatus('🚪 On rejoint le salon…')
    net.joinByCode(identity(), code)
  },
  onJoinRoom(roomId) {
    menu.showStatus('🚪 On rejoint le salon…')
    net.joinRoom(identity(), roomId)
  },
  onListSalons() {
    return net.listSalons()
  },
  onReady(ready) {
    net.sendReady(ready)
  },
  onStart() {
    net.sendStart()
  },
  onChat(text) {
    net.sendChat(text)
  },
  /*
   * 🔄 REJOUER — on repart en course, sans repasser par les menus.
   *
   * En ligne, le départ ne peut PAS être demandé depuis l'écran de fin : le
   * serveur n'accepte `start` que depuis le salon. On y renvoie donc tout le
   * monde, et l'on retient qu'il faudra enchaîner — c'est `onLobby` qui
   * relancera, une fois le salon vraiment revenu. Envoyer les deux d'affilée
   * ferait courir le départ après un salon qui n'existe pas encore.
   */
  onReplay() {
    /*
     * 🎓 Rejouer un tutoriel relance le TUTORIEL, depuis la neige.
     *
     * ⚠️ Sans ce cas, `startRace` repartait sur la piste du moment — donc au
     * PONT, sans une seule explication. Le bouton disait « rejouer » et l'on
     * retombait au milieu de la seconde moitié, sans savoir ce qu'on avait raté.
     */
    if (modeTuto) {
      demarrerTuto()
      return
    }
    if (!online) {
      // 🏋️ Une NOUVELLE graine, comme au bouton « EN PISTE » : rejouer la même
      // piste par cœur ne serait plus de l'entraînement. Le nombre de rivaux,
      // lui, ne bouge pas — c'est le réglage qu'on vient de choisir.
      startRace(Math.floor(Math.random() * 2 ** 31))
      return
    }
    relancerDesLobby = true
    net.sendToLobby()
  },
  /** ↩️ Le salon, sans relancer : on attend la manche suivante. */
  onRetourLobby() {
    net.sendToLobby()
  },
  onLeaveSalon() {
    // En entraînement il n'y a rien à quitter : `leave` ne coûte rien et garde
    // ce chemin unique, mais c'est `backToMenu` qui fait le travail.
    net.leave()
    clearRivals()
    backToMenu()
  },
  onFighter(f) {
    // Le guerrier qui court derrière le menu change tout de suite : on voit son
    // choix avant même de lancer la course.
    player.setFighter(f)
    // Ta tête sur la colonne porte TES couleurs : sans ça elle resterait celle
    // de Yasuke et tu te chercherais parmi les rivaux.
    coureurMoi.tete.style.setProperty('--body', cssColor(f.body))
    coureurMoi.tete.style.setProperty('--band', cssColor(f.band))
    // Et si on est dans un salon, on prévient les autres : sans ça, changer de
    // guerrier depuis le lobby ne se verrait que chez soi.
    if (online) net.sendIdentity(identity())
  },
  onQuality(q) {
    applyQuality(q)
  },
  onMusique(volume) {
    musique.setVolume(volume)
  },
  onSfx(volume) {
    setVolumeSfx(volume)
    jouerBruit('clic') // on entend tout de suite ce qu'on règle
  },
  onCancel() {
    net.leave()
    backToMenu()
  },

  // ————— La boutique —————
  onBoutique() {
    menu.showBoutique()
    // On ouvre TOUT DE SUITE avec ce qu'on a déjà, puis on rafraîchit : ouvrir
    // un écran vide en attendant le réseau donne l'impression que ça rame.
    menu.setBoutique(mesArticles())
    void chargerBoutique().then((articles) => {
      menu.setBoutique(articles)
      majAffichageBourse()
    })
  },

  // ————— Le compte —————
  onGoogle() {
    void connexionGoogle().then((r) => {
      if (r.ok) return // on quitte la page vers Google : rien à afficher

      /*
       * Un échec ici doit se VOIR. Le bouton qui ne fait rien est le pire des
       * cas : le joueur reclique, croit à un écran gelé, et abandonne. On écrit
       * donc le refus dans l'écran du compte, sous les yeux du joueur, et pas
       * seulement dans un toast fugace.
       */
      const messages: Record<string, string> = {
        'hors-ligne': 'Serveur injoignable.',
        INVALID_CALLBACK_URL:
          "Le serveur n'accepte pas l'adresse de retour. (Configuration : PUBLIC_URL)",
      }
      const brut = r.raison ?? ''
      const connu = Object.entries(messages).find(([code]) => brut.includes(code))
      menu.erreurCompte(
        connu ? connu[1] : `Connexion Google indisponible${brut ? ` (${brut})` : ''}.`
      )
    })
  },

  onDeconnexion() {
    void deconnecter().then(async () => {
      toast('👋 Déconnecté')
      // On repart d'un compte anonyme neuf, sinon le jeu resterait sans bourse
      await connecter()
      majAffichageBourse()
      majCompte()
      menu.setCouleursDebloquees(couleursDebloquees())
    })
  },

  onEmail(mode, email, motDePasse) {
    const p = mode === 'inscription'
      ? inscriptionEmail(email, motDePasse, menu.settings.name)
      : connexionEmail(email, motDePasse)

    void p.then(async (r) => {
      if (!r.ok) {
        /*
         * Les refus du serveur arrivent en anglais. On les traduit par
         * MORCEAU de code plutôt que par égalité stricte : Better Auth
         * les rallonge parfois (« USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL »),
         * et une correspondance exacte laisserait passer l'anglais brut.
         */
        const traductions: [string, string][] = [
          ['hors-ligne', 'Serveur injoignable.'],
          ['USER_ALREADY_EXISTS', 'Un compte existe déjà avec cet email.'],
          ['INVALID_EMAIL_OR_PASSWORD', 'Email ou mot de passe incorrect.'],
          ['INVALID_EMAIL', "Cet email n'est pas valide."],
          ['PASSWORD_TOO_SHORT', 'Mot de passe trop court (8 caractères minimum).'],
          ['PASSWORD_TOO_LONG', 'Mot de passe trop long.'],
        ]
        const brut = r.raison ?? ''
        const trouve = traductions.find(([code]) => brut.includes(code))
        menu.erreurCompte(trouve ? trouve[1] : 'Échec — réessaie dans un instant.')
        return
      }
      menu.viderFormulaireCompte()
      toast(mode === 'inscription' ? '✅ Compte créé !' : '👋 Content de te revoir !')
      majAffichageBourse()
      majCompte()
      // Les couleurs achetees suivent le compte : on relit le catalogue
      await chargerBoutique()
      menu.setCouleursDebloquees(couleursDebloquees())
    })
  },

  onAcheter(code) {
    void acheterArticle(code).then((r) => {
      if (r.ok) {
        jouerBruit('parchemin')
        toast('🏪 Acquis !')
        menu.setBoutique(mesArticles())
        majAffichageBourse()
        // La couleur payée doit rejoindre le vestiaire immédiatement
        menu.setCouleursDebloquees(couleursDebloquees())
        return
      }
      // Chaque refus vient du SERVEUR : on ne fait que le traduire.
      const messages: Record<string, string> = {
        fonds: '💰 Pas assez de monnaie',
        possede: '✓ Tu le possèdes déjà',
        inconnu: '⚠️ Article introuvable',
        indisponible: '⚠️ Article indisponible',
        'hors-ligne': '📡 Hors ligne',
      }
      toast(messages[r.raison] ?? '⚠️ Achat refusé')
    })
  },
})

/**
 * ————— La bourse —————
 * Le solde n'est JAMAIS calculé ici : il est relu chez le serveur, qui seul
 * l'a écrit. Ce module ne fait que l'afficher.
 */
function majAffichageBourse() {
  const p = monProfil()
  menu.setBourse(p?.mon ?? null, p?.hisui ?? null)
}

/** Relit le solde auprès du serveur, puis rafraîchit l'affichage. */
async function majBourse() {
  await rafraichirProfil()
  majAffichageBourse()
}

/** Reflète l'état du compte dans son écran. */
function majCompte() {
  menu.setCompte({
    anonyme: estAnonyme(),
    email: monEmail(),
    googleDispo: googleActif(),
    connecte: monProfil() !== null,
  })
}

/**
 * La connexion au démarrage : compte anonyme si c'est la première fois, sinon
 * on reprend celui de l'appareil. Silencieuse et sans blocage — si le serveur
 * ne répond pas, le jeu reste parfaitement jouable, simplement sans bourse.
 */
void connecter().then(async () => {
  majAffichageBourse()
  majCompte()
  if (monProfil()) {
    // On charge le catalogue en fond : c'est lui qui porte les couleurs
    // achetées, et le vestiaire doit les proposer sans attendre une visite
    // en boutique.
    menu.setCouleursDebloquees(couleursDebloquees())
    await chargerBoutique()
    menu.setCouleursDebloquees(couleursDebloquees())
  }
})


/* ————— ⏸ Le bouton de pause et ses deux issues ————— */
/*
 * ⚠️ Le toucher s'ARRÊTE sur le bouton, il ne redescend pas sur la piste.
 *
 * Les gestes de jeu sont écoutés sur `document.body` : sans ces trois lignes, un
 * doigt posé sur la pause y remonterait aussi, et serait compté comme un tap —
 * deux appuis rapprochés sur le bouton auraient lancé un SORT en même temps
 * qu'ils ouvraient le voile.
 */
for (const ev of ['touchstart', 'touchend', 'pointerdown']) {
  btnPauseEl.addEventListener(ev, (e) => e.stopPropagation())
}
btnPauseEl.addEventListener('click', () => {
  jouerBruit('clic')
  ouvrirPause(true)
})
btnReprendreEl.addEventListener('click', () => {
  jouerBruit('clic')
  ouvrirPause(false)
})
btnQuitterPartieEl.addEventListener('click', () => {
  jouerBruit('clic')
  ouvrirPause(false)
  /*
   * ⚠️ ON PRÉVIENT LE SERVEUR AVANT DE PARTIR. Sans `leave`, le salon nous
   * garderait en course : les autres attendraient un coureur qui ne franchira
   * jamais la ligne, et le classement resterait suspendu.
   */
  if (online) net.leave()
  clearRivals()
  backToMenu()
})
btnGo.addEventListener('click', () => {
  online = false
  startRace(Math.floor(Math.random() * 2 ** 31))
})

// Créée APRÈS le menu : c'est lui qui détient le réglage sauvegardé.
const musique = new Musique(menu.settings.volumeMusique)
setVolumeSfx(menu.settings.volumeSfx)

// Le clic des menus : un seul écouteur délégué sur l'overlay plutôt qu'un par
// bouton — les écrans se fabriquent en cours de route (roster, salons, lobby),
// et il n'y aurait aucun moyen fiable de tous les attraper à la main.
document.getElementById('overlay')?.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('button')) jouerBruit('clic')
})

applyQuality(menu.settings.quality)
updateMeLabel()
menu.showTitle()

// La musique des menus attend le premier geste du joueur : les navigateurs
// interdisent le son avant. Elle démarrera donc à son premier clic (cf. audio.ts).
musique.jouer('menu')

// ————— Les contrôles —————
// Chaque action est AUSSI envoyée au serveur en événement instantané : le
// rival la voit ~50 ms plus tôt que si elle était fondue dans le flux 20 Hz.
// Chaque swipe est CONTEXTUEL : s'il y a une cible dans cette direction, il
// devient une attaque ; sinon c'est le déplacement habituel. Un seul geste,
// deux sens — aucun bouton de plus à apprendre sur un écran de téléphone.
new Input(document.body, {
  // ⬅️➡️ : on SE FEND sur la cible — le coup part ET on va la chercher.
  // Frapper une ligne où l'on ne se rend pas séparerait le corps de la lame ;
  // et comme une jarre garantit une ligne sans obstacle, s'y jeter est sûr.
  left: () => {
    if (state !== 'course') return
    tutoGeste('ligne')
    // 🔒 Avant la leçon des lignes, on ne dérive pas : voir `tutoLignes`.
    if (modeTuto && phaseTuto === 'neige' && !tutoLignes) return
    /*
     * ————— Collé à une paroi, aucun swipe ne change de ligne —————
     * Vers la paroi OPPOSÉE (ici : mur à droite, swipe à gauche) on s'en
     * détache, elle nous relance. Vers la paroi qu'on longe, il n'y a rien à
     * faire : on est déjà contre elle.
     *
     * ⚠️ Ce `return` est le correctif d'un bug tenace. Sans lui, swiper VERS le
     * mur qu'on longe traversait tout : `surMur === 1` était faux (on est en
     * -1), `tenteMur` échouait (`accrocheMur` refuse quand `mur !== 0`), et
     * l'on tombait dans `moveLeft()`. La ligne changeait donc EN SILENCE
     * pendant qu'on était plaqué au flanc — rien à l'écran ne le disait. Au
     * relâchement, le corps ne revenait pas sur sa ligne de départ mais filait
     * sur celle de la plateforme, 80 cm sous son plateau : `heurte`, et l'on
     * escaladait au milieu du convoi au lieu d'être renvoyé sur sa voie.
     */
    if (player.surMur !== 0) {
      if (player.surMur === 1) player.lacheMur()
      return
    }
    if (tenteMur(-1)) return
    const de = player.currentLane
    donneCoup()
    /*
     * 🚃 Le flanc d'une plateforme est SOLIDE : on ne s'y glisse pas de côté.
     *
     * Le swipe part quand même — la lame sort, c'est `donneCoup` juste au-dessus
     * — mais le corps reste sur sa voie. Sans ce garde-fou, entrer latéralement
     * dans un plateau faisait glisser le `x` DANS sa colonne, pieds sous le
     * pont : `supportSous` renvoyait `heurte`, et l'on escaladait un convoi par
     * le travers. Or on n'escalade que de FACE — à son nez, là où `flancA` ne
     * répond plus (cf. le `zAvant < 1` là-bas). Les deux règles sont les deux
     * moitiés de la même : de face on monte, de côté c'est un mur.
     */
    if (track.flancA(de, -1, player.mesh.position.y) === null) player.moveLeft()
    if (player.currentLane !== de) {
      ligneCharge = 0 // quitter sa voie coûte l'élan accumulé
      if (player.spark) flashSpark(LANES[de], LANES[player.currentLane])
    }
    if (online) net.sendAction({ t: 'lane', lane: player.currentLane })
  },
  right: () => {
    if (state !== 'course') return
    tutoGeste('ligne')
    if (modeTuto && phaseTuto === 'neige' && !tutoLignes) return
    // Symétrique de `left` : sur une paroi, on s'en détache ou l'on ne fait
    // rien — jamais de changement de ligne en douce (cf. le commentaire là-haut).
    if (player.surMur !== 0) {
      if (player.surMur === -1) player.lacheMur()
      return
    }
    if (tenteMur(1)) return
    const de = player.currentLane
    donneCoup()
    // 🚃 Le flanc reste solide de ce côté aussi (cf. le commentaire dans `left`).
    if (track.flancA(de, 1, player.mesh.position.y) === null) player.moveRight()
    if (player.currentLane !== de) {
      ligneCharge = 0
      if (player.spark) flashSpark(LANES[de], LANES[player.currentLane])
    }
    if (online) net.sendAction({ t: 'lane', lane: player.currentLane })
  },
  jump: () => {
    if (state !== 'course') return
    tutoGeste('saut')
    // Sur la paroi, sauter c'est s'en détacher — elle nous relance en l'air
    if (player.surMur !== 0) return player.lacheMur()
    // ⛓️ Entravé : les chaînes tombent au sol et t'y retiennent. Le ×0,7 seul
    // n'expliquait pas ce qu'on voyait à l'écran — des chaînes qui traînent
    // par terre pendant qu'on saute par-dessus. Maintenant elles CLOUENT.
    if (time < kusarigamaFin) {
      // Martelé pendant 2 s, un message par appui noierait le HUD : on ne le
      // redit qu'au bout d'une demi-seconde.
      if (time > chaineToastT) {
        chaineToastT = time + 0.5
        toast('⛓️ Les chaînes te clouent au sol !')
      }
      return
    }
    donneCoup() // la lame sort ; elle frappera ce qu'on touchera en montant
    const v = player.jump(time < grueFin)
    // ⚡ Le style de Sasuke crépite aussi au décollage, en plus petit
    if (v > 0 && player.spark) flashSparkSaut()
    if (v > 0) jouerBruit('saut')
    if (online && v > 0) net.sendAction({ t: 'jump', v })
  },
  slide: () => {
    if (state !== 'course') return
    tutoGeste('glissade')
    if (player.surMur !== 0) return // on ne s'accroupit pas sur une paroi
    donneCoup()
    const d = player.slide()
    if (d > 0) jouerBruit('glissade')
    if (online && d > 0) net.sendAction({ t: 'slide', d })
  },
  spell: () => state === 'course' && lancerParchemin(),
  // On horodate chaque coup : la boucle de jeu en déduit la cadence.
  // Horloge de la page (pas le chrono de course) : le chrono est figé à 0
  // pendant le décompte, or le DÉPART CANON se martèle pendant le décompte !
  sprint: () => sprintTaps.push(performance.now() / 1000),
  isSprint: inSprintZone,
  // ⏸ Le verrou unique : tant qu'il est levé, aucun geste ne parvient au jeu.
  bloque: () => enPause,
  /*
   * ⏸ T bascule la pause, dans les deux sens.
   *
   * ⚠️ On lit le VOILE, pas `enPause` : en ligne le voile s'ouvre sans rien
   * figer, donc `enPause` y reste faux. Se fier à lui rouvrirait le voile à
   * chaque appui au lieu de le refermer — la touche ne servirait à rien
   * précisément là où la souris est la plus loin.
   */
  pause: () => ouvrirPause(pauseEl.classList.contains('hidden')),
})

/*
 * ————— 🖊️ LE HUD NE SE RÉÉCRIT QUE QUAND IL CHANGE —————
 *
 * Écrire dans le DOM invalide la mise en page de l'élément — y compris quand
 * on y remet EXACTEMENT ce qu'il portait déjà. Or le chrono s'affiche au
 * dixième de seconde : il ne change que 10 fois par seconde, et on l'écrivait
 * 60. Cinq écritures sur six ne servaient à rien, et la jauge, les mètres et
 * l'écart au rival étaient dans le même cas.
 *
 * Une variable par élément plutôt qu'une `Map` : la consulter coûterait plus
 * cher que l'écriture qu'on évite.
 */
let hudScore = ''
let hudCount = ''
let hudGap = ''
let hudProgress = ''
let hudSprint = ''
let hudVitesse = ''
/*
 * ⚠️ ET ON OUBLIE TOUT ENTRE DEUX COURSES.
 *
 * Sans ça, le cache mentirait : une nouvelle course commence à « 0.0 s », et
 * si la précédente s'était terminée sur cette valeur, on sauterait l'écriture
 * — l'écran garderait alors le chrono de la course d'avant. Un cache doit être
 * vidé quand ce qu'il décrit peut changer sous lui.
 */
function oublierHud() {
  hudScore = hudCount = hudGap = hudProgress = hudSprint = hudVitesse = '\u0000'
}

// ————— La boucle de jeu (60 fois par seconde) —————
const timer = new THREE.Timer()

function tick(now?: number) {
  requestAnimationFrame(tick)
  timer.update(now)
  /*
   * ⏸ En pause, le temps ne passe plus.
   *
   * ⚠️ On CONSOMME quand même le delta (`getDelta` remet le compteur à zéro),
   * puis on le jette. Sans ça, il s'accumulerait pendant toute la pause et la
   * reprise avalerait d'un coup les secondes écoulées — le coureur ferait un
   * bond de plusieurs mètres à travers les obstacles.
   */
  const ecoule = Math.min(timer.getDelta(), 0.05) // temps écoulé depuis la dernière image
  const dt = enPause ? 0 : ecoule

  /*
   * ————— ⏳ Le salon avant la grille —————
   *
   * Une course est lancée mais on patiente encore au salon. On y reste jusqu'à
   * ce qu'il ne reste plus que `PISTE_MS` avant le GO, puis on rejoint la piste.
   *
   * ⚠️ Le repli sans horloge : si la synchronisation n'a pas abouti, on part
   * TOUT DE SUITE plutôt que d'attendre un instant qu'on ne sait pas calculer.
   * Rester bloqué au salon pendant que les autres courent serait bien pire que
   * quelques secondes de grille en trop.
   */
  if (departImminent !== null) {
    const pret = net.startAt > 0 && net.clockReady
    const resteMs = pret ? net.startAt - net.serverNow() : 0
    if (!pret || resteMs <= PISTE_MS) {
      const graine = departImminent
      departImminent = null
      menu.setDepartSalon(null)
      startRace(graine)
    } else {
      // Le décompte du salon : on montre les secondes qui restent AVANT la
      // grille, pas avant le GO. Annoncer 10 puis repartir de 4 sur la piste
      // se lirait comme un bug.
      menu.setDepartSalon(Math.ceil((resteMs - PISTE_MS) / 1000))
    }
  }

  if (state === 'depart') {
    /*
     * ————— 🎓 🚀 LA FICHE DU DÉPART CANON —————
     *
     * C'est le SEUL moment où l'on peut l'expliquer. Le départ canon se joue
     * pendant le 3-2-1 : dit après, il est déjà passé ; dit en pleine course,
     * il parle d'un instant qu'on ne reverra qu'à la partie suivante.
     *
     * ⚠️ Le décompte ATTEND. Sans le `return`, il s'écoulerait derrière la
     * fiche : on lirait « martèle pendant le décompte » et l'on relèverait la
     * tête sur un GO déjà parti.
     */
    if (modeTuto && !tutoDepartVu) {
      if (!tutoAttend) {
        figerTuto(DEPART, 'Avant de partir')
        return
      }
      return // la fiche est là : le décompte ne bouge pas
    }

    // 3… 2… 1… GO ! En duel, le départ est PROGRAMMÉ à une heure serveur
    // précise (startAt) : les deux téléphones tirent au même instant absolu,
    // quel que soit leur ping. (Avant, chacun partait à la réception du
    // signal — le mieux connecté partait toujours en premier !)
    if (online && net.startAt > 0 && net.clockReady) {
      countdown = (net.startAt - net.serverNow()) / 1000
    } else {
      countdown -= dt // solo, ou horloge pas encore synchronisée
    }
    // Le décompte dure 6 s (salon) ou 3 s (solo) : on affiche le vrai chiffre.
    // Sa durée n'est PAS écrite ici — elle se déduit de `startAt`, que le
    // serveur pose. Le plafond à 10 n'est qu'un garde-fou d'affichage au cas où
    // une horloge mal synchronisée renverrait un écart absurde.
    const chiffre = countdown > 0 ? Math.min(10, Math.ceil(countdown)) : 0
    const mot = countdown > 0 ? `${chiffre}` : 'GO !'
    if (mot !== hudCount) {
      hudCount = mot
      countEl.textContent = mot
    }

    // Un bip par seconde égrenée, mais seulement dans les 3 dernières : sur un
    // décompte de salon, biper dès le début serait harassant.
    if (chiffre !== dernierChiffre) {
      if (chiffre > 0 && chiffre <= 3) jouerBruit('bip')
      else if (chiffre === 0) jouerBruit('go')
      dernierChiffre = chiffre
    }

    /*
     * ————— Le DÉPART CANON : marteler dans les 3 dernières secondes —————
     * Pas plus tôt : sur le décompte d'un salon, marteler dès le début serait
     * épuisant et sans intérêt. La jauge n'apparaît que dans la ligne droite.
     *
     * ♾️ PAS EN COURSE SANS FIN. Le départ canon départage deux coureurs sur
     * quelques dixièmes — or ici on court seul, contre les flammes. Gagner 0,3 s
     * sur personne ne rapporte rien, et demander de marteler l'écran avant
     * CHAQUE partie d'un mode où l'on recommence beaucoup n'est plus un choix
     * tactique : c'est une corvée à l'entrée.
     */
    const canon = countdown <= 3.2 && !modeInfini
    sprintEl.classList.toggle('hidden', !canon)
    const pnow = performance.now() / 1000
    sprintTaps = sprintTaps.filter((t) => pnow - t < SPRINT_WINDOW)
    if (canon) {
      const startRate = sprintTaps.length / SPRINT_WINDOW
      sprintCharge += (Math.min(1, startRate / SPRINT_FULL_RATE) - sprintCharge) * Math.min(1, dt * 8)
      const jauge = `${(sprintCharge * 100).toFixed(1)}%`
      if (jauge !== hudSprint) {
        hudSprint = jauge
        sprintFillEl.style.width = jauge
      }
    }

    // Le GO : à l'heure programmée en duel (petit temps d'affichage du
    // « GO ! » identique pour les deux), au bout du décompte en solo.
    const ready = online
      ? net.startAt > 0 && net.clockReady
        ? countdown <= -0.4
        : raceGo && countdown <= 0 // secours si l'horloge n'est pas prête
      : countdown <= -0.6
    if (ready) {
      countEl.classList.remove('show')
      state = 'course'
      /*
       * La jauge convertit le martèlement en vitesse initiale : à fond, on part
       * directement à la vitesse de croisière (≈ 0,3 s de gagnées) — toujours
       * moins qu'un trébuchement : ça départage, ça ne décide pas.
       *
       * ♾️ Sans départ canon, on part À FOND. Laisser 12 punirait le joueur
       * pour un mécanisme qu'on lui a RETIRÉ, et il passerait ses premières
       * secondes à rattraper une lenteur qu'il ne pouvait pas éviter. Il n'y a
       * d'ailleurs personne à départager : c'est le meilleur départ, pour tous.
       */
      speed = modeInfini ? 22 : 12 + 10 * sprintCharge
      player.auRepos = false // 🧍→🏃 fin de l'attente, la foulée reprend
      if (sprintCharge > 0.75) toast('🚀 Départ canon !')
      if (online)
        for (const r of rivals.values()) {
          r.opp.repos = false
          r.opp.go()
        }
      sprintTaps = []
      sprintCharge = 0
      sprintEl.classList.add('hidden')
      sprintLabelEl.textContent = 'SPRINT FINAL'
    } else if (online && countdown < -4) {
      // Le GO du serveur n'arrive pas : connexion perdue
      net.leave()
      backToMenu('⚠️ Connexion perdue au départ.')
    }
    // 🧍 Pendant le décompte, tout le monde ATTEND sur la grille : personne ne
    // court sur place. Le drapeau retombe au GO, juste au-dessus.
    player.auRepos = true
    player.update(dt)
    for (const r of rivals.values()) {
      r.opp.repos = true
      r.opp.update(dt, distance)
    }
    // Les rivaux sont déjà sur la ligne de départ pendant le décompte
    for (const b of botsEnCourse()) b.placer(dt, distance)
    // 🌸 Les pétales tombent pendant tout le décompte (monde immobile : dz = 0)
    petalesActifs = true
    updateEffets(dt, 0)

    /*
     * La piste doit vivre PENDANT le décompte, à vitesse nulle.
     *
     * `track.reset()` vide tout le décor pour repartir propre, et jusqu'ici
     * rien ne le repeuplait avant le GO : on passait tout le décompte du départ
     * devant une piste nue, la forêt n'apparaissant qu'une fois lancé. C'est
     * précisément le moment où l'on REGARDE le décor, faute d'avoir autre chose
     * à faire.
     *
     * Vitesse 0 : rien ne défile, on est bien à l'arrêt sur la ligne. Mais les
     * bambous, les obstacles et les plateformes des 85 premiers mètres
     * apparaissent, et l'on voit ce qui nous attend.
     */
    track.update(dt, 0, 0)

    /*
     * ⚡ On compile les shaders PENDANT le décompte, pas en pleine course.
     *
     * Three.js ne compile le programme d'un matériau qu'à son PREMIER rendu, et
     * il le fait sur le thread principal : chaque matière inédite fige l'image
     * le temps de la compilation — de l'ordre de 50 à 200 ms sur mobile. Or la
     * bambouseraie découvre ses matières UNE À UNE au fil des premiers mètres
     * (radeau, palissade, yotsume-gaki, litière…), si bien que la course
     * démarrait en hoquetant, très exactement là où l'on accélère.
     *
     * La ligne juste au-dessus vient de peupler 85 m de piste à vitesse nulle :
     * tout ce que la forêt va montrer est DÉJÀ dans la scène. C'est donc le seul
     * moment de la partie où la facture peut être payée d'un coup sans que
     * personne ne le sente — on est immobile sur la grille.
     *
     * `compileAsync` de préférence à `compile` : là où le navigateur sait le
     * faire (KHR_parallel_shader_compile), three.js rend la main tout de suite
     * et le décompte ne bronche pas. Là où l'extension manque, il retombe de
     * lui-même sur la compilation bloquante — un temps d'arrêt sur la grille de
     * départ reste préférable à un hoquet en pleine ligne droite. Les deux cas
     * sont déjà traités DANS three.js : rien à démêler ici.
     *
     * La promesse n'intéresse personne : le GO ne l'attend pas. Si le décompte
     * s'achève avant la fin, on n'aura fait qu'AVANCER le travail — jamais
     * l'aggraver. Le `catch` est là pour qu'un échec de compilation reste un
     * problème d'images par seconde, jamais un rejet non capturé.
     */
    if (!shadersPrets) {
      shadersPrets = true
      renderer.compileAsync(scene, camera).catch(() => {})
      // 🔥 Et la boucle du brasier, pour la même raison exactement : sa
      // fabrication coûte quelques dizaines de millisecondes, et elle tomberait
      // sinon à l'instant où l'on entre dans le village, à pleine vitesse.
      prechauffeFeu()
    }
  } else if (state === 'course') {
    time += dt

    // ————— Sprint final : plus on martèle vite, plus on accélère —————
    const sprinting = inSprintZone()
    const pnow = performance.now() / 1000
    sprintTaps = sprintTaps.filter((t) => pnow - t < SPRINT_WINDOW)

    // La cadence est PLAFONNÉE à SPRINT_FULL_RATE : au-delà, plus aucun gain.
    // C'est ce qui met le pouce d'un mobile et un autoclicker à égalité.
    const rate = sprintTaps.length / SPRINT_WINDOW
    const target = sprinting ? Math.min(1, rate / SPRINT_FULL_RATE) : 0
    sprintCharge += (target - sprintCharge) * Math.min(1, dt * 8)

    // ————— Les deux vitesses du 2ᵉ acte —————
    // La ligne droite se remplit tant qu'on tient sa voie (elle est remise à
    // zéro au changement de ligne, cf. les contrôles). L'aspiration suit le
    // sillage, en douceur : entrer et sortir d'un sillage ne doit pas claquer.
    if (acte2()) {
      ligneCharge = Math.min(1, ligneCharge + dt / LIGNE_PLEIN)
      aspiCharge += (forceAspiration() - aspiCharge) * Math.min(1, dt * 3)
    } else {
      // Départ canon et sprint final : tout s'éteint, seul le martèlement compte.
      ligneCharge = 0
      aspiCharge = 0
    }
    // Le témoin n'apparaît qu'une fois vraiment dans le sillage : le faire
    // clignoter au moindre frôlement le rendrait illisible.
    aspiEl.classList.toggle('hidden', aspiCharge < 0.25)

    // La vitesse de croisière augmente au fil de la course…
    let cruise = 22 + 8 * avancement()
    // 🏺 …les jarres encaissées la rabotent, et ça ne s'en va qu'au thé…
    cruise *= facteurLourdeur()
    // …la course propre et le sillage la portent dans le corps de course…
    cruise *= 1 + LIGNE_BOOST * ligneCharge + ASPI_BOOST * aspiCharge
    // …le martèlement la pousse encore un peu dans les derniers mètres…
    if (sprinting) cruise *= 1 + SPRINT_BOOST * sprintCharge
    // …et les parchemins par-dessus. Un dash sous entrave reste bride : les
    // deux effets se multiplient au lieu de s'annuler.
    if (time < ventFin) cruise *= 1 + VENT_BOOST
    if (time < kusarigamaFin) cruise *= KUSARIGAMA_FACTEUR
    // 🧗 On se hisse : la course est presque à l'arrêt le temps de passer.
    escaladeT = Math.max(0, escaladeT - dt)
    if (escaladeT > 0) cruise *= ESCALADE_FREIN
    // 🧪 Banc d'essai : le décor s'immobilise, le reste de la course vit.
    if (gele) cruise = 0
    speed += (cruise - speed) * Math.min(1, dt * 1.2)
    if (gele) speed = 0 // sans ça, l'inertie ferait encore glisser le décor

    distance += speed * dt

    /*
     * ————— Le sol sous les pieds —————
     * À interroger AVANT player.update, sinon la gravité de cette image
     * s'appliquerait encore vers l'ancien sol : on traverserait le plateau d'un
     * cheveu à chaque atterrissage.
     *
     * Sur la paroi on est hors de la piste : aucune plateforme ne nous porte.
     */
    const support = track.supportSous(player.mesh.position.x, player.mesh.position.y)
    player.sol = player.surMur === 0 ? support.sol : 0
    // 🎋 Le plafond du tunnel. Sur la paroi on est hors de la piste : rien
    // au-dessus non plus, sinon on se cognerait à un tablier qu'on a quitté.
    player.plafond = player.surMur === 0 ? support.plafond : Infinity
    player.update(dt)
    for (const r of rivals.values()) {
      // Chacun entre dans le sprint a SA distance, pas a la notre
      r.opp.presse = r.opp.distanceNow >= COURSE_LENGTH - SPRINT_ZONE
      r.opp.update(dt, distance)
    }
    track.update(dt, speed, distance)

    // Chaque rival court sa propre course, sans jamais toucher à la nôtre
    bots.forEach((b) => {
      if (!b.actif) return
      if (b.avance(dt, time, COURSE_LENGTH)) toast(`⛩️ ${b.profil.nom} a franchi le torii !`)
      b.placer(dt, distance)

      // Ses parchemins. Un sort offensif part sur celui qui le précède — le
      // joueur compris : c'est ce qui rend l'entraînement mordant.
      const lance = b.jouerParchemin(time)
      if (!lance) return
      const devant = [...botsEnCourse(), null].find(
        (x) => x !== b && (x ? x.distance : distance) > b.distance
      )
      if (lance === 'onmyoji') {
        // Un bot ne vise pas mieux que nous : son portail part droit devant et
        // meurt au premier obstacle, exactement comme le nôtre.
        // Le portail d'un bot vole à la même altitude que le nôtre : il doit
        // donc s'écraser sur les mêmes pentes, aux mêmes endroits.
        const mur = track.premierBarrage(b.ligne, b.distance, distance, PORTAIL_Y)
        if (devant === null && b.ligne === player.currentLane && mur === null && distance > b.distance) {
          const sien = b.distance
          b.distance = distance
          echangerAvec(sien, b.profil.nom)
        }
      } else if (devant === null) {
        // C'est nous qu'il vise
        if (subirSort(lance, b)) toast(`🪞 Renvoyé à ${b.profil.nom} !`)
      } else if (devant) {
        devant.subir(lance, time)
      }
    })

    /*
     * ————— 🔮 Elle plane, puis elle s'affaisse —————
     *
     * Deux secondes de vol tendu à la hauteur du lancer, puis la pesanteur la
     * prend. On garde `vy` plutôt que de recalculer la hauteur depuis `t0` :
     * une vitesse s'intègre image par image et supporte tout ce qu'on voudra
     * lui ajouter plus tard — un rebond, un renvoi qui la relance — là où une
     * formule fermée obligerait à réécrire le temps.
     *
     * 💥 Et quand elle touche le sol, elle éclate : c'est SA portée à elle.
     * Jusqu'ici seul un mur pouvait l'arrêter, et sur une ligne dégagée elle
     * filait indéfiniment. Le sol lui donne une fin qui ne dépend plus de ce
     * que la piste veut bien lui opposer.
     *
     * ⚠️ Un bloc À PART, avant celui des rencontres, plutôt qu'une imbrication :
     * une boule éteinte au sol n'a plus de mur ni de rival à croiser, et le
     * `if (portail)` suivant suffit à le dire. Deux blocs frères se lisent mieux
     * qu'un test au milieu de cent lignes.
     */
    if (portail) {
      if (time - portail.t0 > PORTAIL_PLANE) {
        portail.vy -= PORTAIL_PESANTEUR * dt
        portail.y += portail.vy * dt
      }
      if (portail.y <= 0) {
        portailImpact(
          new THREE.Vector3(LANES[portail.lane], 0.12, -(portail.d - distance)),
          portail.couleur
        )
        portail = null
        portailGroup.visible = false
        toast('🔮 Le portail retombe et s\'éteint…')
      }
    }

    // ————— 🔮 Le portail en vol —————
    if (portail) {
      const avant = portail.d
      // Le sens : +1 vers l'avant, -1 quand une 🪞 parade l'a renvoyé
      portail.d += (speed + ONMYOJI_VITESSE) * dt * portail.sens
      const lo = Math.min(avant, portail.d)
      const hi = Math.max(avant, portail.d)

      // Un mur OU une plateforme pleine l'avale : c'est la piste qui borne sa
      // portée, pas un chiffre. Les radeaux de bambou, eux, le laissent filer
      // dessous — ils sont sur pilotis.
      //
      // ⚠️ On passe sa hauteur DU MOMENT, pas une constante : en s'affaissant
      // elle rencontre les rampes de plus en plus bas, donc de plus en plus tôt.
      const mur = track.premierBarrage(portail.lane, lo, hi, portail.y)
      // Qui croise-t-il dans sa ligne cette image ? Bots (solo) ET rivaux (en
      // ligne) confondus — le PLUS PROCHE l'emporte. On teste le franchissement :
      // à ~83 m/s il parcourt ~1,4 m par image, un test de proximité le raterait.
      const botTouche = botsEnCourse()
        .filter((b) => b.ligne === portail!.lane && b.distance > lo && b.distance <= hi)
        .sort((a, b) => a.distance - b.distance)[0]
      const rivalTouche = [...rivals.values()]
        .filter(
          (r) =>
            // 👻 Pas un déconnecté : on échangerait sa place avec un joueur
            // parti, et l'on se retrouverait téléporté sur une position figée
            // pendant que lui ne reçoit rien.
            r.connecte &&
            r.opp.currentLane === portail!.lane &&
            r.opp.distanceNow > lo &&
            r.opp.distanceNow <= hi
        )
        .sort((a, b) => a.opp.distanceNow - b.opp.distanceNow)[0]
      // 🔮 En marche ARRIÈRE, la boule peut retomber sur son lanceur : c'est la
      // seule « cible » qu'elle n'échange pas — on ne troque pas sa place avec
      // soi-même. Elle s'y éteint, et la parade aura coûté un portail.
      const retourAuLanceur =
        portail.sens === -1 && player.currentLane === portail.lane && distance >= lo && distance <= hi

      const dMur = mur ?? Infinity
      const dBot = botTouche ? botTouche.distance : Infinity
      const dRival = rivalTouche ? rivalTouche.opp.distanceNow : Infinity

      if (dMur <= dBot && dMur <= dRival && dMur !== Infinity) {
        // 💥 Il éclate SUR la paroi : on prend la position du mur, pas celle du
        // portail — sinon la brûlure flotterait devant, dans le vide.
        portailImpact(
          // Sa hauteur DU MOMENT : une boule qui s'est affaissée doit brûler la
          // paroi là où elle l'a heurtée, pas à l'altitude où elle est partie.
          new THREE.Vector3(LANES[portail.lane], portail.y, -(dMur - distance) + 0.3),
          portail.couleur
        )
        portail = null
        portailGroup.visible = false
        toast('🔮 Le portail se brise sur un mur…')
      } else if (retourAuLanceur && dBot === Infinity) {
        portail = null
        portailGroup.visible = false
        toast(`🔮 Ton portail te revient… et s'éteint.`)
      } else if (botTouche && dBot <= dRival) {
        /*
         * 🪞 La Parade Miroir renvoie AUSSI le portail : la boule repart en
         * marche arrière, telle quelle. Sur le chemin du retour elle obéit aux
         * mêmes lois — un joueur croisé échange sa place avec le lanceur, un
         * mur la brise. `subir` consomme la parade et ne fait rien d'autre
         * pour un portail : les afflictions n'y connaissent pas ce sort.
         */
        if (botTouche.subir('onmyoji', time)) {
          portail.sens = (portail.sens === 1 ? -1 : 1) as 1 | -1
          // La boule repart JUSTE DERRIÈRE lui : sans ce décalage, elle le
          // recroisait à l'image suivante — et l'échangeait, parade ou pas.
          portail.d = botTouche.distance + 0.6 * portail.sens
          toast(`🪞 ${botTouche.profil.nom} renvoie le portail !`)
        } else {
          const sien = botTouche.distance
          botTouche.distance = distance
          portail = null
          portailGroup.visible = false
          echangerAvec(sien, botTouche.profil.nom, botTouche.mesh)
        }
      } else if (rivalTouche) {
        // En ligne : on lui envoie NOTRE place, il prendra la sienne. Chacun
        // calcule l'échange de son côté — à 100 ms de ping, l'écart est de ~3 m.
        net.sendSpell('onmyoji', rivalTouche.id, distance)
        const sien = rivalTouche.opp.distanceNow
        portail = null
        portailGroup.visible = false
        echangerAvec(sien, rivalTouche.name, rivalTouche.opp.mesh)
      } else if (portail.d > COURSE_LENGTH || portail.d < 0) {
        // Aucun plafond de distance : sa portée est INFINIE. Seuls un rival ou
        // un mur l'arrêtent. Faute de quoi il finit par franchir le torii —
        // ou, renvoyé, par repasser la ligne de départ — et s'éteint.
        portail = null
        portailGroup.visible = false
      } else {
        // L'orbe file, l'anneau tourne, et les arcs se relancent à chaque image
        portailGroup.visible = true
        // `portail.y` et non plus une constante : c'est elle qui porte la
        // hauteur, du lancer jusqu'à l'affaissement.
        portailGroup.position.set(LANES[portail.lane], portail.y, -(portail.d - distance))
        portailAnneau.rotation.z += dt * 5
        portailCoeur.scale.setScalar(0.9 + Math.random() * 0.35) // le cœur palpite
        for (const a of portailArcs) jitterArc(a, 0.62, 0.3)
      }
    }

    // 💥 L'impact du portail : le crépitement claque, la brûlure s'attarde
    if (impactGroup.visible) {
      const reste = impactFin - time
      if (reste <= 0) {
        impactGroup.visible = false
      } else {
        impactGroup.position.z += speed * dt // elle reste collée à SA paroi
        const age = IMPACT_TRACE - reste
        // Les arcs ne crépitent qu'un instant, la trace lui survit
        const crepite = age < IMPACT_CREPITE
        for (const a of impactArcs) {
          a.visible = crepite
          if (crepite) {
            jitterArc(a, 1.1, 0.55)
            ;(a.material as THREE.LineBasicMaterial).opacity = 1 - age / IMPACT_CREPITE
          }
        }
        const m = impactTrace.material as THREE.MeshBasicMaterial
        m.opacity = 0.85 * (reste / IMPACT_TRACE) // la brûlure se refroidit
        impactTrace.scale.setScalar(1 + (1 - reste / IMPACT_TRACE) * 0.4)
      }
    }

    // Les projectiles filent vers leur victime, puis délivrent leur effet
    for (const p of projets) {
      if (!p.actif) continue
      const reste = p.fin - time
      if (reste > 0) {
        p.mesh.position.lerpVectors(p.de, p.a, 1 - reste / PROJET_VOL)
        if (STYLES_PROJET[p.kind]?.tournoie) p.mesh.rotation.x += dt * 26
        else p.mesh.lookAt(p.a) // l'aiguille reste pointée sur sa cible
        continue
      }
      // ————— L'arrivée : à chaque sort sa signature —————
      p.actif = false
      p.mesh.visible = false
      if (p.kind === 'kunai') {
        boom(p.a) // 💥 la lame éclate
      } else if (p.cible) {
        // ☠️ et ⛓️ marquent leur victime d'une aura, le temps de leur effet.
        // On retire le vol de la durée : l'aura doit s'éteindre AVEC le sort,
        // pas 0,28 s après — c'est une jauge, elle ne doit pas mentir.
        if (p.kind === 'senbon') poserBrume(p.cible, SENBON_DUREE - PROJET_VOL, BRUME_POISON)
        // ⛓️ Le poids touche : les chaînes s'accrochent et retombent au sol
        else if (p.kind === 'kusarigama') poserChaines(p.cible, KUSARIGAMA_DUREE - PROJET_VOL)
      }
    }

    // ☠️ La brume : des voiles qui dérivent autour de la victime et la noient
    for (const b of brumes) {
      if (!b.actif) continue
      const reste = b.fin - time
      if (reste <= 0) {
        b.actif = false
        b.group.visible = false
        continue
      }
      const p = b.cible.position
      const k = Math.min(1, reste / 0.5) // elle se lève sur la fin
      b.voiles.forEach((v) => {
        const ph = (v.userData.phase as number) + time * 0.8
        // Chacun tourne à son rythme sur une orbite propre : c'est l'irrégularité
        // qui fait « brume » — alignés, ils redeviendraient une boule.
        /*
         * ⚠️ `p.y` : LA BRUME MONTE AVEC SA VICTIME.
         *
         * Sa hauteur était écrite en dur, et la brume restait donc au sol
         * pendant qu'on sautait ou qu'on courait sur un plateau à 2,70 m. Un
         * poison qu'on laisse en bas en sautant se lit comme un décor posé sur
         * la piste, pas comme un état qui nous colle — et c'est précisément ce
         * que cette aura doit dire.
         */
        v.position.set(
          p.x + Math.cos(ph) * 0.5,
          p.y + 1 + Math.sin(ph * 1.7) * 0.45,
          p.z + Math.sin(ph) * 0.5
        )
        v.rotation.z = ph * 0.5
        v.lookAt(camera.position) // toujours face à l'œil : un voile n'a pas de dos
        ;(v.material as THREE.MeshBasicMaterial).opacity = (0.3 + Math.sin(ph * 2) * 0.12) * k
      })
    }

    // 🍵 Les cercles du Thé : ils montent du sol vers la tête, décalés
    const theOn = time < theFin
    if (theOn) {
      const p = player.mesh.position
      const ecoule = 1 - (theFin - time) / THE_DUREE // 0 → 1
      theCercles.forEach((c, i) => {
        // Chacun part un quart de seconde après le précédent : on lit une vague
        const t = ecoule * 1.6 - i * 0.18
        if (t <= 0 || t >= 1) {
          c.visible = false
          return
        }
        c.visible = true
        c.position.set(p.x, p.y + 0.1 + t * 2.1, p.z)
        c.scale.setScalar(1 + t * 0.35) // il s'évase en montant
        ;(c.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.85
      })
    } else {
      for (const c of theCercles) c.visible = false
    }

    // 🕊️ L'anneau de la Grue : il te ceint et MONTE AVEC TOI quand tu sautes
    const grueOn = time < grueFin
    grueAnneau.visible = grueOn
    if (grueOn) {
      const p = player.mesh.position
      grueAnneau.position.set(p.x, p.y + 0.2, p.z) // p.y : il suit le saut
      grueAnneau.rotation.z += dt * 1.6
      const k = (grueFin - time) / GRUE_DUREE
      ;(grueAnneau.material as THREE.MeshBasicMaterial).opacity =
        (0.5 + Math.sin(time * 7) * 0.14) * Math.min(1, k * 3)
    }

    // 🪞 La glace de la Parade, dressée derrière toi, reflet qui balaie
    const miroirOn = time < miroirFin
    miroirGroup.visible = miroirOn
    if (miroirOn) {
      const p = player.mesh.position
      miroirGroup.position.set(p.x, p.y + 1.25, p.z + 0.75)
      miroirTex.offset.x -= dt * 0.32 // le reflet glisse : c'est ça qui fait « miroir »
      // Discrète : la garde tient sans limite de temps, elle ne doit donc pas
      // masquer la piste pendant toute la course. On la devine, le reflet la
      // rappelle par éclats — juste assez pour savoir qu'on est couvert.
      const respire = 0.5 + Math.sin(time * 2.4) * 0.5 // 0 → 1, lent
      // Presque un fantôme : la garde tient sans limite de temps, elle ne doit
      // surtout pas voiler la piste. On ne la voit vraiment qu'au passage du
      // reflet — le reste du temps, on la devine.
      ;(miroirGlace.material as THREE.MeshBasicMaterial).opacity = 0.05 + respire * 0.08
      ;(miroirCadre.material as THREE.MeshBasicMaterial).opacity = 0.08 + respire * 0.09
    }

    // ⛓️ Les chaînes : accrochées à la hanche, elles retombent au sol derrière
    for (const c of chaines) {
      if (!c.actif) continue
      const reste = c.fin - time
      if (reste <= 0) {
        c.actif = false
        c.group.visible = false
        continue
      }
      const p = c.cible.position
      const sway = Math.sin(time * 4) * 0.12
      c.maillons.forEach((m, i) => {
        const t = i / (CHAINE_MAILLONS - 1) // 0 = la hanche, 1 = le sol
        // La chute est RAPIDE puis traîne : une chaîne pend, elle ne descend
        // pas en ligne droite. L'exposant fait toute la différence.
        m.position.set(
          p.x + sway * t,
          Math.max(0.07, (p.y + 0.85) * Math.pow(1 - t, 1.7) + 0.07),
          p.z + t * 1.9
        )
        m.rotation.z += dt * 0.8
      })
      const dernier = c.maillons[CHAINE_MAILLONS - 1].position
      c.boulet.position.set(dernier.x, 0.17, dernier.z + 0.22) // le poids, posé au sol
    }

    // 💨💥 Le rideau de vitesse : monte avec le martèlement du sprint final,
    // à fond sur un dash 🌀. C'est le même effet pour les deux accélérations.
    const dashing = time < ventFin
    let vitesseInten = 0
    if (sprinting) vitesseInten = 0.3 + 0.7 * sprintCharge
    if (dashing) vitesseInten = Math.max(vitesseInten, 0.9)
    const opa = `${vitesseInten}`
    if (opa !== hudVitesse) {
      hudVitesse = opa
      speedEl.style.opacity = opa
    }

    // 🌸💥💨 On ne fait plus naître de pétales passé les 2,5 premières secondes ;
    // ceux déjà en l'air finissent de tomber pendant que le cerisier s'éloigne.
    petalesActifs = time < 2.5
    updateEffets(dt, speed * dt)
    // 💨 Après que TOUT LE MONDE a bougé : qui vient de retomber au sol ?
    detecterAtterrissages()

    // 10 fois par seconde suffisent : à 60, on réécrirait le DOM pour rien
    rankTimer += dt
    if (rankTimer >= 0.1) {
      rankTimer = 0
      majTetes()
    }

    // 📜 Ramassage d'un rouleau — on découvre son contenu maintenant
    const trouve = track.ramasse(player.hitbox())
    if (trouve) gagneParchemin(trouve)

    // ⚔️ La chaîne retombe si on laisse passer trop de temps entre deux coups
    chaineT = Math.max(0, chaineT - dt)
    if (chaineT <= 0) chaine = 0

    // ⚔️ La lame est-elle en train de toucher quelque chose ? Résolu ICI, au
    // contact, et non au moment du swipe : c'est ce qui interdit de frapper
    // une jarre qu'on survole sans jamais la rejoindre.
    resoudCoup()

    // Le pan de mur s'achève : il nous relance en l'air, même si l'on aurait
    // pu tenir plus longtemps. On ne court pas sur du vide.
    // La paroi s'achève : elle nous relance en l'air, même si l'on aurait pu
    // tenir plus longtemps. On ne court pas sur du vide — et ça vaut pour les
    // deux sortes de parois, le bord de piste comme le flanc d'un wagon.
    if (
      player.surMur !== 0 &&
      !track.murA(distance, player.surMur) &&
      track.flancA(player.currentLane, player.surMur, player.mesh.position.y) === null
    ) {
      player.lacheMur()
    }

    /*
     * 😖 L'encaissement se déclenche sur le FRONT MONTANT de `stumble`.
     *
     * On le guette ici plutôt qu'aux cinq endroits qui font trébucher (mur,
     * kunai, coup d'un rival, armure entamée…) : un seul point d'écoute, et
     * aucune source ne peut être oubliée en chemin.
     */
    if (stumble > stumblePrec) player.geste('impact')
    stumblePrec = stumble

    // 🥴 Empoisonné, aveuglé ou entravé : la foulée devient bancale.
    player.gene = time < senbonFin || time < fumigeneFin || time < kusarigamaFin

    /*
     * 🔥 La foulée s'emballe sous le Souffle de Vent et dans le sprint final.
     *
     * On ne réutilise PAS `inSprintZone()` : elle englobe aussi le départ
     * canon, où l'on martèle sans avoir encore commencé à courir. Le coureur
     * sprinterait sur la ligne de départ.
     */
    player.presse =
      time < ventFin || versLaFin()
    // 🧪 Banc d'essai figé : on se tient debout au lieu de pédaler sur place.
    // La foulée « repos » existe déjà pour la grille de départ, on la réutilise.
    player.auRepos = gele

    // Trébuchement : toucher un obstacle RALENTIT (on ne meurt pas, c'est une course)
    // Sur la paroi on est hors de la piste : rien ne peut nous faucher.
    stumble = Math.max(0, stumble - dt)
    /*
     * 🚃 Percuter le FLANC d'une plateforme : on a raté le saut.
     *
     * C'est la contrepartie du raccourci — monter dessus met à l'abri de tout
     * ce qui traîne au sol, mais s'y prendre trop tard coûte comme un mur. On
     * l'assimile donc à `mur` : même sanction, et l'Armure de Fer y laisse une
     * plaque entière, puisque c'est bien une masse pleine qu'on vient d'emboutir.
     */
    /*
     * 🧗 Percuter une plateforme sans rampe : on l'ESCALADE.
     *
     * À 2,40 m, aucun saut ne passe (apex 2,07 m) : sans rampe, la rencontre est
     * inévitable dès qu'on est sur cette ligne. Ce n'est donc pas une faute
     * d'inattention qu'on sanctionne, c'est un choix d'itinéraire — d'où une
     * mécanique à part plutôt qu'un trébuchement.
     *
     * On passe TOUJOURS : on se hisse, on perd une seconde, et on se retrouve
     * en haut, sur la route rapide. Rester bloqué contre un mur en pleine
     * course serait insupportable.
     */
    const touche = player.surMur === 0 ? track.hits(player.hitbox()) : null

    /*
     * ————— Ce qui se GRIMPE —————
     *
     * Le flanc d'une plateforme, mais aussi le MUR ordinaire. Ce qui les réunit
     * n'est pas une hauteur commune, c'est qu'AUCUN DES DEUX NE SE SAUTE :
     * l'apex du saut vaut 2,07 m, le mur 2,40 m et la plateforme 2,70 m. Les
     * traiter différemment n'aurait aucun sens — on buterait contre l'un en
     * trébuchant alors qu'on escalade l'autre.
     *
     * Un mur n'a que 50 cm d'épaisseur : on l'enjambe et l'on retombe de
     * l'autre côté. Une plateforme est longue : on reste dessus. Même geste,
     * même prix, deux issues — et c'est la piste qui les distingue, pas une
     * règle à retenir.
     *
     * ⚠️ ON SE HISSE À LA HAUTEUR DE CE QU'ON GRIMPE. Les deux ont longtemps
     * fait 2,40 m, si bien qu'une seule constante suffisait ; la plateforme est
     * passée à 2,70 m et le mur est resté à 2,40 m. Continuer à toujours viser
     * la hauteur de plateforme ferait flotter le joueur 30 cm au-dessus du mur
     * qu'il vient d'enjamber.
     */
    const flancPlateforme = track.supportSous(
      player.mesh.position.x,
      player.mesh.position.y
    ).heurte
    const aGrimper = player.surMur === 0 && (touche === 'mur' || flancPlateforme)
    const hautGrimpe = flancPlateforme ? PLATEFORME_H : TAILLE_OBSTACLE.mur.haut

    /*
     * ⚠️ L'escalade ne dépend PLUS de l'armure.
     *
     * La condition portait `armure === 0`, et l'intention était bonne : sous
     * armure, on ne devait pas payer le freinage. Mais la branche suivante ne
     * traite que les obstacles de `track.hits()` — une plateforme n'en est pas
     * un. Résultat : armure levée, on heurtait un wagon massif et il ne se
     * passait RIEN. On le traversait de part en part.
     *
     * La géométrie reste de la géométrie : on se hisse toujours. C'est le
     * FREIN que l'armure épargne, pas le mur lui-même.
     *
     * ⚠️ Et l'on se hisse à `hautGrimpe`, la hauteur de CE QU'ON GRIMPE : un
     * mur fait 2,40 m, une plateforme 2,70. Viser toujours la plateforme
     * ferait flotter le joueur 30 cm au-dessus du mur qu'il vient d'enjamber.
     */
    if (stumble <= 0 && aGrimper && player.escalader(hautGrimpe)) {
      if (armure === 0) escaladeT = ESCALADE_FREIN_DUREE
      jouerBruit('chute')
      toast(armure > 0 ? "🛡️ L'armure encaisse l'escalade" : '🧗 Escalade !')
    } else if (stumble <= 0 && touche && !player.escalade) {
      if (armure > 0) {
        // 🛡️ L'armure avale le choc : on garde toute sa vitesse. Mais un mur
        // la met en pièces d'un coup, là où une barrière ne fait que l'entamer.
        const cout = touche === 'mur' ? ARMURE_COUT_MUR : ARMURE_COUT_PETIT
        armure = Math.max(0, armure - cout)
        stumble = 1.2
        armureEncaisse(armure === 0) // 🛡️ le dôme claque, ou vole en éclats
        toast(
          armure > 0
            ? '🛡️ L\'armure encaisse — une plaque saute'
            : '🛡️ L\'armure vole en éclats !'
        )
      } else {
        speed = Math.max(6, speed * player.grip)
        stumble = 1.2 // brève invincibilité le temps de se relever
        flash()
        boom(new THREE.Vector3(player.mesh.position.x, 0.9, player.mesh.position.z)) // 💥
        jouerBruit('chute')
        // ♾️ ICI, et nulle part ailleurs : c'est la seule branche où le coup
        // est réellement encaissé. L'armure et l'escalade sont au-dessus.
        if (modeInfini) encaisserCoup()
        else toast('💥 Trébuché !')
        // Le rival doit le voir TOUT DE SUITE : sa version de nous ralentit
        // immédiatement (au lieu que son extrapolation nous fasse dépasser à tort)
        if (online) net.sendAction({ t: 'stumble', keep: player.grip })
      }
    }
    /*
     * ⛩️ Percuter le portique rouge — ses piliers ou ses traverses.
     *
     * Pas de garde `surMur` ici, contrairement à la jarre : un pilier est du
     * bois massif qu'on longe une paroi ou non.
     *
     * ⚠️ AUJOURD'HUI CE TEST NE PEUT PAS SE DÉCLENCHER, et c'est voulu. Le
     * portique est monté assez haut pour dégager le saut le plus ample du jeu
     * (cf. TORII_MONTEE dans track.ts), et ses piliers se dressent au-delà des
     * parois. Un torii, ça s'enjambe : le rendre franchement mortel punirait au
     * hasard, puisqu'ils défilent sans rien savoir des obstacles tirés au sort.
     *
     * On garde quand même la collision : elle donne au portique la forme qu'il
     * annonce, et le jour où l'on rapprochera ses piliers — pour qu'ils
     * arrêtent enfin celui qui longe la paroi — elle prendra vie sans qu'on
     * touche à cette ligne.
     */
    if (stumble <= 0 && track.heurteTorii(player.hitbox())) {
      speed = Math.max(6, speed * player.grip)
      stumble = 1.2
      flash()
      jouerBruit('chute')
      toast('⛩️ Portique percuté !')
      if (online) net.sendAction({ t: 'stumble', keep: player.grip })
    }

    // 🏺 Percuter une jarre : la poterie éclate et on accuse le choc. En vol
    // on passe au-dessus — une chaîne bien menée traverse la grappe sans
    // jamais rien percuter, c'est là sa récompense.
    if (stumble <= 0 && player.surMur === 0 && track.heurteJarre(player.hitbox())) {
      if (armure > 0) {
        armure = Math.max(0, armure - ARMURE_COUT_PETIT)
        stumble = 0.6
        toast(armure > 0 ? '🛡️ L\'armure encaisse la jarre' : '🛡️ L\'armure vole en éclats !')
      } else {
        speed = Math.max(6, speed * JARRE_FREIN)
        stumble = 0.6 // on se reprend plus vite que d'un vrai trébuchement
        chaine = 0 // le choc casse l'enchaînement en cours
        jouerBruit('jarre') // la poterie éclate quand même
        jouerBruit('chute')
        /*
         * ♾️ La lourdeur s'installe, et elle RESTE. Le choc lui-même se dissipe
         * en une seconde ; ce qu'on emporte, c'est le poids — jusqu'au thé.
         *
         * ⚠️ Ça ne compte PAS dans les cinq coups. Une jarre n'est pas un
         * obstacle : elle se contourne sans rien lire, et la faire compter
         * doublerait sa punition tout en rendant la règle des cinq impossible à
         * énoncer simplement.
         */
        if (modeInfini) {
          lourdeur++
          majJarres()
          const perte = Math.round((1 - facteurLourdeur()) * 100)
          toast(`🏺 Alourdi — ${perte} % de vitesse en moins (🍵 pour laver)`)
        } else toast('🏺 Jarre percutée !')
        if (online) net.sendAction({ t: 'stumble', keep: JARRE_FREIN })
      }
    }

    // Le perso clignote tant qu'il se relève
    player.mesh.visible = stumble <= 0 || Math.floor(stumble * 12) % 2 === 0

    // 💨 la fumée aveugle, ☠️ le poison fait tanguer la scène
    fumeeEl.classList.toggle('show', time < fumigeneFin)
    canvas.classList.toggle('poison', time < senbonFin)

    // ⚡ Les deux éclairs de Sasuke : ils se TRACENT, puis se dissipent
    if (sparkBolts[0].visible) {
      const t = time - sparkT0
      if (t >= SPARK_TRACE + SPARK_DISSIP) {
        hideSpark()
      } else if (t < SPARK_TRACE) {
        // ————— Création : le plan de coupe file et le zigzag naît derrière lui
        const k = t / SPARK_TRACE // 0 → 1
        const balai = sparkDe + (sparkVers - sparkDe) * k
        if (sparkVers >= sparkDe) sparkPlane.set(SPARK_N_NEG, balai) // garde x < balai
        else sparkPlane.set(SPARK_N_POS, -balai) // garde x > balai
        for (const b of sparkBolts) {
          for (const c of b.children) {
            ;((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 1
          }
          b.scale.setScalar(b.userData.base as number)
        }
      } else {
        // ————— Dissipation : plus de coupe, il s'efface en s'étalant (flou)
        sparkPlane.set(SPARK_N_NEG, 1e6) // tout passe
        const k = (t - SPARK_TRACE) / SPARK_DISSIP // 0 → 1
        for (const b of sparkBolts) {
          const base = b.userData.base as number
          b.scale.setScalar(base * (1 + k * 0.45)) // il gonfle en se dissolvant
          const c0 = b.children[0] as THREE.Mesh
          const c1 = b.children[1] as THREE.Mesh
          // Le contour s'efface plus vite : le trait « perd ses bords », ça floute
          ;(c0.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k * 1.6)
          ;(c1.material as THREE.MeshBasicMaterial).opacity = 1 - k
        }
      }
    }

    // 🔮 Les deux lueurs de l'échange : elles battent et s'éteignent en douceur
    const lueurOn = time < lueurFin
    lueurJoueur.visible = lueurOn
    lueurRival.visible = lueurOn && !!lueurCible
    if (lueurOn) {
      const reste = (lueurFin - time) / LUEUR_DUREE // 1 → 0
      const battement = (1 + Math.sin(time * 22) * 0.09) * (0.75 + reste * 0.45)
      for (const l of [lueurJoueur, lueurRival]) {
        ;(l.material as THREE.MeshBasicMaterial).opacity = 0.45 * reste
        l.scale.setScalar(battement)
      }
      lueurJoueur.position.set(player.mesh.position.x, 0.85, player.mesh.position.z)
      if (lueurCible) lueurRival.position.set(lueurCible.position.x, 0.85, lueurCible.position.z)
    }

    // Interface : chrono + progression
    // ♾️ En infini, c'est la DISTANCE qui compte, et c'est elle qu'on classe.
    // Afficher un chrono donnerait à surveiller un chiffre qui ne décide de
    // rien, pendant que le seul qui compte resterait invisible.
    const chiffre = modeInfini ? `${Math.floor(distance)} m` : `${time.toFixed(1)} s`
    if (chiffre !== hudScore) {
      hudScore = chiffre
      scoreEl.textContent = chiffre
    }
    // La colonne monte : le remplissage ET ta tete suivent ta distance
    // ♾️ En infini, la colonne montre l'avancée DANS LE CYCLE : une jauge qui
    // resterait pleine à jamais ne dirait plus rien.
    const pct = Math.min(100, ((modeInfini ? distance % COURSE_LENGTH : distance) / COURSE_LENGTH) * 100)
    /*
     * ⚠️ Arrondie au dixième de pour-cent AVANT la comparaison.
     *
     * Sans l'arrondi, `pct` change à chaque image et le cache ne sauterait
     * jamais une écriture — on aurait ajouté un test pour rien. Un dixième de
     * pour-cent, sur une jauge haute de 200 px, vaut un cinquième de pixel :
     * personne ne peut le voir, et cela divise les écritures par cinq.
     */
    const jauge = `${pct.toFixed(1)}%`
    if (jauge !== hudProgress) {
      hudProgress = jauge
      progressEl.style.height = jauge
    }

    // Interface du sprint : on annonce, puis la jauge suit le martèlement
    if (sprinting) {
      if (!sprintSeen) {
        sprintSeen = true
        sprintEl.classList.remove('hidden')
        toast('🔥 MARTÈLE L\'ÉCRAN !')
      }
      const jauge = `${(sprintCharge * 100).toFixed(1)}%`
      if (jauge !== hudSprint) {
        hudSprint = jauge
        sprintFillEl.style.width = jauge
      }
    }

    // En ligne : on envoie notre position 20 fois par seconde
    if (online) {
      netTimer += dt
      if (netTimer >= 0.05) {
        netTimer = 0
        net.sendProgress({
          lane: player.currentLane,
          y: player.mesh.position.y,
          distance,
          sliding: player.isSliding,
        })
      }

      // L'écart vise le rival le plus proche (devant OU derrière) : c'est celui
      // qui compte, parmi les 9. Le classement en direct montre les autres.
      let proche: Rival | null = null
      let minEcart = Infinity
      for (const r of rivals.values()) {
        // 👻 Un déconnecté est figé quelque part sur la piste : annoncer
        // « +12 m » sur quelqu'un qu'on ne voit nulle part, c'est la version
        // HUD du coureur fantôme. On le saute, l'écart passe au suivant.
        if (!r.connecte) continue
        const diff = Math.abs(r.opp.distanceNow - distance)
        if (diff < minEcart) {
          minEcart = diff
          proche = r
        }
      }
      if (proche) {
        const lead = proche.opp.distanceNow - distance
        // textContent, pas innerHTML : le pseudo vient d'un autre joueur
        const ecart = `${proche.name} ${lead >= 0 ? '+' : '−'}${Math.abs(lead).toFixed(0)} m`
        if (ecart !== hudGap) {
          hudGap = ecart
          gapEl.textContent = ecart
        }
        gapEl.classList.toggle('ahead', lead >= 0)
      } else {
        /*
         * 👻 PLUS PERSONNE À ANNONCER — et il faut le DIRE, pas se taire.
         *
         * ⚠️ Sans cette branche, le dernier écart calculé restait affiché. Vu à
         * l'écran : le seul rival coupe sa connexion, on cesse (à raison) de le
         * compter… et la bulle continuait de dire « Rival −4 m » sur un coureur
         * que plus rien ne met à jour. On avait déplacé le fantôme de la piste
         * vers le HUD au lieu de l'enlever.
         *
         * ⚠️ Et l'on vide `hudGap` en même temps, sinon le cache croirait la
         * bulle déjà à jour au retour du rival et sauterait la réécriture.
         */
        if (hudGap !== '') {
          hudGap = ''
          gapEl.textContent = ''
        }
      }
    } else {
      // Solo : écart par rapport au robot le plus proche
      let closestBot: Bot | null = null
      let minDiff = Infinity
      for (const b of botsEnCourse()) {
        const diff = b.distance - distance
        if (Math.abs(diff) < minDiff) {
          minDiff = Math.abs(diff)
          closestBot = b
        }
      }
      if (closestBot) {
        const lead = closestBot.distance - distance
        const ecart = `${closestBot.profil.nom} ${lead >= 0 ? '+' : '−'}${Math.abs(lead).toFixed(0)} m`
        if (ecart !== hudGap) {
          hudGap = ecart
          gapEl.textContent = ecart
        }
        gapEl.classList.toggle('ahead', lead >= 0)
      }
    }

    // ⛩️ Ligne d'arrivée !
    // ♾️ Une course sans fin n'a pas de ligne d'arrivée à franchir : ce sont
    // les flammes qui décident, et elles passent par encaisserCoup().
    if (!modeInfini && distance >= COURSE_LENGTH) crossFinishLine()

    /*
     * ————— ♾️🟢 On a bouclé la carte : les pots sont versés —————
     *
     * Ce que l'arrivée fait pour une course en ligne, la fin de tronçon le fait
     * ici. C'est le seul moment naturel : il n'y a pas d'arrivée, mais il y a un
     * tour de carte, et il se mérite.
     *
     * ⚠️ Les vies NE REPARTENT PAS. Recommencer la carte ne rend pas le droit à
     * l'erreur : autrement, qui tient un tour ne perdrait jamais, et « cinq
     * obstacles » deviendrait « cinq par carte ».
     */
    /*
     * ————— 🎓 LE DÉROULÉ DU TUTORIEL —————
     *
     * Deux conditions, dans cet ordre : la fiche suivante si l'on arrive à son
     * mètre, puis le passage au pont quand il ne reste plus de fiche.
     *
     * ⚠️ `!tutoAttend` protège tout : tant qu'une fiche attend son geste, la
     * course est gelée, `distance` ne bouge plus, et rien ne peut déclencher
     * l'étape suivante. Sans lui, une fiche posée au mètre 60 se rejouerait à
     * chaque image tant qu'on n'aurait pas bougé.
     */
    if (modeTuto && phaseTuto === 'neige' && !tutoAttend) {
      if (etapeTuto < ETAPES.length && distance >= ETAPES[etapeTuto].d) {
        figerTuto(ETAPES[etapeTuto], `Étape ${etapeTuto + 1} sur ${ETAPES.length}`)
      } else if (etapeTuto >= ETAPES.length && distance >= FIN_APPRENTISSAGE) {
        passerAuPont()
      }
    }

    if (modeInfini) {
      const troncon = Math.floor(distance / COURSE_LENGTH)
      if (troncon > dernierTroncon) {
        dernierTroncon = troncon
        encaisserPots()
        toast(`🗺️ Carte bouclée — tour ${troncon + 1}`)
      }
    }
  } else {
    // Au menu / en attente : le décor défile doucement.
    //
    // Après l'arrivée, en revanche, il S'ARRÊTE NET. Le laisser glisser donnait
    // une sensation fausse : la course est finie, le chrono est figé, mais le
    // sol continuait de filer sous des pieds qui ne courent plus.
    //
    // J'avais d'abord mis un freinage progressif, par crainte qu'une coupure
    // sèche se lise comme un plantage. À l'usage c'est l'inverse : tant que
    // quelque chose bouge, l'œil croit la course encore en cours. L'arrêt franc
    // est ce qui DIT que c'est fini.
    //
    // Deux conditions, parce qu'il y a deux façons d'arriver :
    //  · en ligne, on reste en 'fini' le temps que les autres finissent ;
    //  · en SOLO, backToMenu() repasse en 'menu' dans la seconde — c'est là que
    //    le décor repartait sous le mot de fin. On se cale donc aussi sur la
    //    bannière d'arrivée, qui dure exactement tant qu'on lit son chrono.
    const fige = state === 'fini' || menu.arriveeAffichee()
    track.update(dt, fige ? 0 : 5)
    player.update(dt)
    if (state === 'fini' && online) for (const r of rivals.values()) r.opp.update(dt, distance)
    speedEl.style.opacity = '0' // pas de rideau de vitesse hors course
  }

  /*
   * ————— 🔊 L'ambiance sonore du biome traversé —————
   *
   * Appelée à chaque image, y compris pour la COUPER : hors course, ou dans un
   * biome silencieux, la consigne tombe à 0 et le fondu s'en occupe. Sans cet
   * appel systématique, le brasier resterait allumé au menu après une course
   * abandonnée dans le village.
   *
   * Le biome se lit par son champ `ambiance`, jamais par son numéro : ajouter
   * une nappe ailleurs ne demandera pas de revenir ici.
   */
  const enCourse = state === 'depart' || state === 'course' || state === 'fini'
  // ♾️ On DEMANDE le décor à la piste plutôt que de le recalculer : en infini
  // leur ordre est tiré au sort, et elle seule connaît le tirage.
  const biomeIci = enCourse ? BIOMES[track.biomeA(distance)] : null
  /*
   * ♾️ En infini, le feu qui poursuit COUVRE celui du décor.
   *
   * Les deux se disputeraient le même bruit de flammes, et le joueur ne saurait
   * plus lequel il entend : celui du village qu'il traverse, ou celui qui va le
   * rattraper. Le second est le seul qui puisse le tuer — il gagne, et il monte
   * avec les dégâts pour qu'on l'entende approcher sans quitter la piste des
   * yeux.
   */
  const feuPoursuite = modeInfini && enCourse ? 0.25 + 0.75 * (degats / DEGATS_MAX) : 0
  feuAmbiance(Math.max(feuPoursuite, biomeIci?.ambiance === 'feu' ? 1 : 0), dt)
  oiseauxAmbiance(biomeIci?.ambiance === 'oiseaux' ? 1 : 0, dt)

  // La caméra suit en douceur la ligne du joueur
  camera.position.x += (player.mesh.position.x * 0.55 - camera.position.x) * Math.min(1, dt * 5)

  // ————— Les étiquettes de nom, au-dessus des têtes —————
  // Après le déplacement des persos ET de la caméra, sinon elles auraient une
  // image de retard. Au menu, on les cache : le décor tourne à vide derrière.
  const racing = state === 'depart' || state === 'course' || state === 'fini'
  // Le réglage est relu ICI, à chaque image, plutôt que recopié à l'allumage :
  // on peut ainsi l'éteindre depuis le salon et le voir s'appliquer à la course
  // suivante sans avoir à recharger quoi que ce soit.
  const noms = racing && menu.settings.afficherNoms
  // player.mesh.visible clignote quand on se relève d'un trébuchement :
  // l'étiquette clignote avec lui, c'est le même personnage.
  player.tag.follow(player.mesh, camera, noms && player.mesh.visible)
  for (const r of rivals.values()) {
    r.opp.tag.follow(r.opp.mesh, camera, noms && r.opp.active && r.opp.mesh.visible)
  }

  // La caméra s'ouvre avec la vitesse. C'est le seul retour qui rende TOUS les
  // gains sensibles d'un coup — ligne droite, sillage, sprint, chaîne — sans
  // rien afficher à lire. On la referme au menu, où la vitesse ne veut rien dire.
  const fovVoulu = state === 'course' ? 70 + Math.min(11, Math.max(0, (speed - 24) * 1.1)) : 70
  if (Math.abs(camera.fov - fovVoulu) > 0.01) {
    camera.fov += (fovVoulu - camera.fov) * Math.min(1, dt * 2.5)
    camera.updateProjectionMatrix()
  }

  renderer.render(scene, camera)
  menu.update(dt) // l'aperçu 3D du guerrier, quand le menu de sélection est ouvert
  musique.update(dt) // le fondu entre deux pistes
}

// ————— Adaptation à la taille de l'écran —————
function resize() {
  renderer.setSize(innerWidth, innerHeight)
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

// ————— Le banc d'essai des sorts (développement uniquement) —————
// Les slots sont internes au module : sans ce petit guichet, aucune page de
// test ne peut mettre un parchemin précis dans la main du joueur.
//
// Vite remplace `import.meta.env.DEV` par `false` au build : tout ce bloc — le
// guichet compris — disparaît du bundle de production. Impossible de s'en
// servir pour tricher dans une vraie partie.
if (import.meta.env.DEV) {
  ;(window as unknown as { __sorts?: unknown }).__sorts = {
    /** Met `kind` en main, à la place de ce qu'on tenait. */
    donner(kind: ParcheminKind) {
      slots = [kind]
      drawSlots()
    },
    /** Le lance tout de suite — comme la touche E. */
    lancer() {
      lancerParchemin()
    },
    /**
     * Le SUBIR, au lieu de le lancer.
     *
     * C'est ce qui manquait : un sort offensif se juge sur SA VICTIME. En le
     * lançant on ne voit rien — l'effet part chez un bot qu'on regarde de dos,
     * à trente mètres. Ici on passe directement par le chemin que le jeu
     * emprunte quand on encaisse, celui-là même qu'un rival déclenche.
     *
     * `subirSort` refuse pendant la trêve du départ et renvoie tout sur une
     * parade levée : le banc d'essai hérite donc de ces règles au lieu de les
     * contourner, ce qui permet justement de les vérifier.
     */
    subir(kind: ParcheminKind) {
      // 🔮 Le portail n'est pas une affliction : c'est un échange. On simule
      // un rival vingt mètres devant, sinon il n'y a personne avec qui troquer.
      if (kind === 'onmyoji') echangerAvec(distance + 20, `le banc d'essai`)
      else subirSort(kind)
    },
    /**
     * 🧪 Fige ou relâche la course. Gelée, la piste ne défile plus et rien ne
     * vient te percuter : on regarde un sort posément au lieu de l'encaisser
     * en esquivant des barrières. Les minuteurs, eux, continuent — sinon un
     * effet à durée resterait affiché pour l'éternité et on ne verrait jamais
     * comment il se dissipe.
     */
    geler(v: boolean) {
      gele = v
    },
    /** Quitter la course et revenir au menu, sans recharger la page. */
    quitter() {
      backToMenu()
    },
    /**
     * 🎓 La fin du tutoriel, sans courir le pont.
     *
     * Même raison que `fin` juste en dessous : il fallait sinon franchir 1 920 m
     * pour voir l'animation une fois — et autant à chaque retouche de son
     * rythme. Ce guichet disparaît du build de production avec tout le bloc.
     */
    finTuto() {
      modeTuto = true
      finTuto()
    },
    /**
     * 🏁 Montre l'écran de fin sans courir les 1 920 m.
     *
     * Il fallait sinon 75 secondes de course pour voir un podium — et donc
     * autant à chaque retouche de sa mise en page. `n` est le nombre de
     * coureurs, `enLigne` ajoute le bouton « retour au lobby » réservé aux
     * salons.
     *
     * Les temps sont croissants et le joueur placé au milieu du peloton : c'est
     * le cas qui montre le plus de choses d'un coup — le podium, la liste des
     * suivants, et le repère doré sur SA ligne.
     */
    fin(n = 5, enLigne = false) {
      const noms = ['Hana', 'Oni-Maru', 'Tamae', 'Kurokumo', 'Ryu', 'Sora', 'Kaze']
      const moiA = Math.min(2, n - 1)
      menu.showFin({
        titre: `⛩️ Torii franchi en <b>72.40 s</b><br>Banc d'essai — ${n} coureurs`,
        joueurs: Array.from({ length: n }, (_, i) => ({
          nom: i === moiA ? menu.settings.name || 'Guerrier anonyme' : noms[i % noms.length],
          // Le dernier abandonne : sans lui, on ne verrait jamais ce cas.
          temps: i === n - 1 && n > 3 ? null : 70 + i * 1.7,
          moi: i === moiA,
        })),
        canReplay: true,
        canLobby: enLigne,
      })
    },
    /** Ce que le jeu retient de nous, pour l'afficher en direct. */
    etat() {
      return {
        time,
        distance,
        vent: Math.max(0, ventFin - time),
        grue: Math.max(0, grueFin - time),
        the: Math.max(0, theFin - time),
        kusarigama: Math.max(0, kusarigamaFin - time),
        fumigene: Math.max(0, fumigeneFin - time),
        senbon: Math.max(0, senbonFin - time),
        armure,
        miroir: miroirFin === Infinity ? Infinity : Math.max(0, miroirFin - time),
        stumble: Math.max(0, stumble),
        terre: terreEl.classList.contains('on'),
        treve: Math.max(0, FANTOME_DUREE - time),
        enCourse: state === 'course',
        gele,
        // 🎓 La ligne : le tutoriel la verrouille au début, et cela se vérifie.
        ligne: player.currentLane,
      }
    },
  }
}

tick()
