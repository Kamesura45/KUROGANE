import * as THREE from 'three'
import {
  ROSTER,
  PERSO_ID,
  SKIN_PALETTE,
  buildFighter,
  clearFighter,
  cssColor,
  customFighter,
  fighterById,
  type Fighter,
  type Head,
} from './roster'
import { Anim, animerGuerrier } from './anims'
import { CIBLAGE, EFFETS, PARCHEMINS, TIRAGE, type ParcheminKind } from './parchemin'
import { cleanName, loadSettings, saveSettings, type Quality, type Settings } from './settings'
import { montant } from './icones'
import type { LobbyView, SalonInfo } from './net'
import { COURSE_LENGTH } from './track'
import {
  chargerScores,
  chargerInfini,
  meilleuresInfini,
  formaterTemps,
  MAX_SCORES,
} from './scores'
import { PAYS, drapeau, regionsDe, niveauDe } from './pays'
import { lireClassement, type LigneClassement } from './compte'

/** Les trois lectures du classement, cf. buildScores. */
type OngletScore = 'mondial' | 'local' | 'recentes'

/**
 * Les deux familles de classement, qui ne se comparent PAS entre elles.
 *
 * ⚠️ `course` se lit en secondes et le plus petit gagne ; `infini` se lit en
 * mètres et c'est le plus grand. Les mettre dans un même tableau demanderait de
 * trier dans deux sens à la fois — d'où deux catégories, choisies avant tout le
 * reste.
 */
type CategorieScore = 'course' | 'infini' | 'dev'

type ScreenName =
  | 'title'
  | 'roster'
  | 'options'
  | 'help'
  | 'status'
  | 'botpick'
  | 'salon'
  | 'lobby'
  | 'results'
  | 'scores'
  | 'jouer'
  | 'boutique'
  | 'compte'

export interface MenuCallbacks {
  onSolo(): void
  /** ♾️ La course sans fin : pas de rivaux, pas de ligne d’arrivée. */
  onInfini(): void
  onOnline(): void
  /** Le joueur a changé de guerrier */
  onFighter(f: Fighter): void
  /** Le joueur a changé la qualité graphique */
  onQuality(q: Quality): void
  /** Le joueur a réglé le volume de la musique (0 → 1) */
  onMusique(volume: number): void
  /** Le joueur a réglé le volume des bruitages (0 → 1) */
  onSfx(volume: number): void
  /** Le joueur annule la recherche d'adversaire */
  onCancel(): void
  // ————— Les salons en ligne —————
  onCreateSalon(): void
  onQuick(): void
  onJoinByCode(code: string): void
  onJoinRoom(roomId: string): void
  onListSalons(): Promise<SalonInfo[]>
  onReady(ready: boolean): void
  onStart(): void
  onChat(text: string): void
  /**
   * 🔄 « Rejouer » depuis l'écran de fin — on repart en course DIRECTEMENT.
   *
   * En entraînement, on relance la même configuration. En ligne, seul l'hôte
   * l'a : il renvoie tout le monde au salon et enchaîne le départ.
   */
  onReplay(): void
  /** ↩️ « Retour au lobby » — en ligne seulement : le salon, sans relancer. */
  onRetourLobby(): void
  onLeaveSalon(): void
  /** Le joueur veut ouvrir la boutique (le jeu ira chercher le catalogue) */
  onBoutique(): void
  /** Le joueur achete un article — le serveur tranche */
  onAcheter(code: string): void
  /** Le joueur veut securiser son compte avec Google */
  onGoogle(): void
  /** Le joueur se deconnecte */
  onDeconnexion(): void
  /** Creer un compte, ou retrouver le sien, par email */
  onEmail(mode: 'inscription' | 'connexion', email: string, motDePasse: string): void
}

/**
 * Échappe le HTML.
 * ⚠️ Indispensable : le pseudo de l'adversaire vient d'un AUTRE joueur, on ne
 * lui fait aucune confiance. Sans ça, quelqu'un pourrait s'appeler
 * `<img src=x onerror=…>` et faire exécuter son code sur ton téléphone.
 */
export function escapeHtml(s: string): string {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

/**
 * Un article tel que la boutique l'AFFICHE.
 * Le menu ne calcule aucun prix : il ne fait que montrer ce que le serveur
 * envoie, et renvoyer le code cliqué.
 */
export interface ArticleVu {
  code: string
  nom: string
  categorie: string
  prix_mon: number | null
  prix_hisui: number | null
  valeur: string | null
  possede: boolean
}

/** L'aperçu 3D du guerrier sélectionné : sa propre petite scène, son propre canvas. */
interface Preview {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  group: THREE.Group
}

/**
 * Tous les écrans de menu : titre, choix du guerrier, options, aide, et les
 * messages (attente d'un adversaire, résultat de la course).
 *
 * Le menu ne connaît RIEN de la course : il prévient main.ts par des callbacks
 * et se contente de garder les réglages à jour.
 */
/**
 * Les écrans où l'on ARRIVE, par opposition à ceux dans lesquels on descend.
 * Y entrer efface le chemin parcouru : on n'a plus rien derrière soi.
 */
const RACINES = new Set<ScreenName>(['title', 'salon', 'lobby', 'results', 'status'])

export class Menu {
  readonly settings: Settings

  private cb: MenuCallbacks
  private screens: Record<ScreenName, HTMLElement>
  private current: ScreenName = 'title'
  private preview: Preview | null = null
  private spin = 0
  /** La dernière vue du salon reçue — pour savoir qui je suis, si je suis prêt… */
  private view: LobbyView | null = null
  /** 💬 La salle dont le chat est affiché. Change → le journal repart vierge. */
  private salleChat = ''
  /** D'où l'on a ouvert l'aide, pour y revenir. null = depuis le titre. */
/*
   * ————— D'où l'on vient —————
   *
   * Une PILE, et non un repère unique. Le repère unique ne pouvait retenir
   * qu'un seul cran : depuis le salon, descendre au vestiaire PUIS à la
   * boutique le laissait pointer sur le salon. Le retour depuis la boutique
   * sautait alors par-dessus le vestiaire pour atterrir au salon — et le
   * retour suivant, croyant être au bout, QUITTAIT le salon. C'est le bug
   * « je change de skin et ça me sort de la partie ».
   *
   * Une pile retient le chemin entier, quelle que soit sa profondeur.
   */
  private pile: ScreenName[] = []
  private apercu?: THREE.Object3D
  /** Le guerrier montré dans la vignette — il a sa propre foulée. */
  private fighterAffiche: Fighter = ROSTER[0]
  /**
   * L'onglet ouvert du classement. On démarre sur « mondial » : c'est celui qui
   * donne une raison de rejouer. « Local » ne montre que ce qu'on sait déjà.
   */
  private ongletScore: OngletScore = 'mondial'
  /** La famille de classement affichée. On démarre sur les courses : c'est le mode historique. */
  private categorieScore: CategorieScore = 'course'
  /** 🗺️ Le pays qu'on REGARDE sous « Géo » (`''` = tous). */
  private filtrePays = ''
  /** 🗺️ La subdivision qu'on y regarde (`''` = tout le pays). */
  private filtreRegion = ''
  /** Les couleurs achetées (0xrrggbb), ajoutées aux palettes du vestiaire. */
  private couleursAchetees: number[] = []
  private anim = new Anim()

  private el = {
    banner: document.getElementById('banner')!,
    msg: document.getElementById('msg')!,
    cancel: document.getElementById('btnCancel')!,
    pickJp: document.getElementById('pickJp')!,
    pickName: document.getElementById('pickName')!,
    fighters: document.getElementById('fighters')!,
    infoJp: document.getElementById('infoJp')!,
    infoName: document.getElementById('infoName')!,
    infoRole: document.getElementById('infoRole')!,
    infoBlurb: document.getElementById('infoBlurb')!,
    infoPassive: document.getElementById('infoPassive')!,
    // ————— Le vestiaire perso —————
    forge: document.getElementById('forge')!,
    palBody: document.getElementById('palBody')!,
    palBand: document.getElementById('palBand')!,
    forgeHead: document.getElementById('forgeHead')!,
    optName: document.getElementById('optName') as HTMLInputElement,
    optQuality: document.getElementById('optQuality')!,
    optVolume: document.getElementById('optVolume') as HTMLInputElement,
    optVolumeVal: document.getElementById('optVolumeVal')!,
    optSfx: document.getElementById('optSfx') as HTMLInputElement,
    optSfxVal: document.getElementById('optSfxVal')!,
    optNoms: document.getElementById('optNoms') as HTMLInputElement,
    // ————— Salon —————
    joinCode: document.getElementById('joinCode') as HTMLInputElement,
    salonList: document.getElementById('salonList')!,
    // ————— Lobby —————
    lobbyCode: document.getElementById('lobbyCode')!,
    lobbyHint: document.getElementById('lobbyHint')!,
    lobbyList: document.getElementById('lobbyList')!,
    chatLog: document.getElementById('chatLog')!,
    chatInput: document.getElementById('chatInput') as HTMLInputElement,
    ready: document.getElementById('btnReady')!,
    start: document.getElementById('btnStart')!,
    // ————— Résultats —————
    scoresRech: document.getElementById('scoresRech') as HTMLInputElement,
    scoresPays: document.getElementById('scoresPays') as HTMLSelectElement,
    scoresRegion: document.getElementById('scoresRegion') as HTMLSelectElement,
    scoresFiltre: document.getElementById('scoresFiltre')!,
    selPays: document.getElementById('selPays') as HTMLSelectElement,
    selRegion: document.getElementById('selRegion') as HTMLSelectElement,
    champRegion: document.getElementById('champRegion')!,
    labRegion: document.getElementById('labRegion')!,
    resultsBody: document.getElementById('resultsBody')!,
    replay: document.getElementById('btnReplay')!,
    finTitre: document.getElementById('finTitre')!,
    podium: document.getElementById('podium')!,
    btnLobby: document.getElementById('btnLobby')!,
    // ————— Boutique —————
    bourseRow: document.getElementById('bourseRow')!,
    bourse: document.getElementById('bourse')!,
    bourseMon: document.getElementById('bourseMon')!,
    bourseHisui: document.getElementById('bourseHisui')!,
    boutiqueListe: document.getElementById('boutiqueListe')!,
    boutiqueVide: document.getElementById('boutiqueVide')!,
    // ————— Compte —————
    compteTitre: document.getElementById('compteTitre')!,
    compteDetail: document.getElementById('compteDetail')!,
    compteAlerte: document.getElementById('compteAlerte')!,
    compteAide: document.getElementById('compteAide')!,
    btnGoogle: document.getElementById('btnGoogle')!,
    btnDeconnexion: document.getElementById('btnDeconnexion')!,
    compteOu: document.getElementById('compteOu')!,
    compteActions: document.getElementById('compteActions')!,
    compteErreur: document.getElementById('compteErreur')!,
    mailCompte: document.getElementById('mailCompte') as HTMLInputElement,
    mdpCompte: document.getElementById('mdpCompte') as HTMLInputElement,
    btnInscription: document.getElementById('btnInscription')!,
    btnConnexionMail: document.getElementById('btnConnexionMail')!,
  }

  constructor(cb: MenuCallbacks) {
    this.cb = cb
    this.settings = loadSettings()

    this.screens = {
      title: document.getElementById('scr-title')!,
      roster: document.getElementById('scr-roster')!,
      options: document.getElementById('scr-options')!,
      help: document.getElementById('scr-help')!,
      status: document.getElementById('scr-status')!,
      botpick: document.getElementById('scr-botpick')!,
      salon: document.getElementById('scr-salon')!,
      lobby: document.getElementById('scr-lobby')!,
      results: document.getElementById('scr-results')!,
      scores: document.getElementById('scr-scores')!,
      jouer: document.getElementById('scr-jouer')!,
      boutique: document.getElementById('scr-boutique')!,
      compte: document.getElementById('scr-compte')!,
    }

    this.peindre()

    // — Écran-titre —
    document.getElementById('btnJouer')!.addEventListener('click', () => this.ouvrir('jouer'))

    // — Écran « Jouer » : les trois modes, et l'entraînement —
    document.getElementById('btnSolo')!.addEventListener('click', () => cb.onSolo())
    document.getElementById('btnInfini')!.addEventListener('click', () => cb.onInfini())
    /*
     * ⚔️ « Course VS.E » n'entre pas en piste : elle OUVRE l'écran « Jouer en
     * ligne ».
     *
     * ⚠️ Il y avait ici trois boutons — partie rapide, créer un salon,
     * rejoindre — qui doublaient tous les trois ce que cet écran-là propose
     * déjà, champ de code et liste des salons ouverts en plus. Les garder en
     * double obligeait à choisir sa porte avant de savoir ce qu'il y avait
     * derrière : on lançait une partie rapide sans voir qu'un ami tenait un
     * salon ouvert. Une seule entrée, et tout le reste se lit derrière.
     */
    document.getElementById('btnVSE')!.addEventListener('click', () => cb.onOnline())

    document.getElementById('btnRoster')!.addEventListener('click', () => this.ouvrir('roster'))
    document.getElementById('btnOptions')!.addEventListener('click', () => this.ouvrir('options'))
    document.getElementById('btnHelp')!.addEventListener('click', () => this.ouvrir('help'))
    // 🏆 Le tableau se REBÂTIT à chaque ouverture : on vient souvent d'y ajouter
    // une ligne en finissant une course.
    document.getElementById('btnScores')!.addEventListener('click', () => {
      // On rouvre sur une recherche VIERGE : retrouver l'écran filtré par une
      // requête tapée trois jours plus tôt se lirait comme un classement vide.
      this.el.scoresRech.value = ''
      this.buildScores()
      this.ouvrir('scores')
    })
    /*
     * 🔎 La recherche filtre l'onglet AFFICHÉ, et se contente de rebâtir.
     *
     * Aucun appel réseau de plus : les trois onglets tiennent déjà en mémoire la
     * liste qu'ils viennent d'afficher (cf. `dernieresLignes`). Interroger le
     * serveur à chaque lettre aurait été une requête par frappe, pour filtrer
     * des données qu'on a déjà sous la main.
     */
    this.el.scoresRech.addEventListener('input', () => this.buildScores())
    for (const b of document.querySelectorAll<HTMLElement>('#scoresOnglets button')) {
      b.addEventListener('click', () => {
        this.ongletScore = (b.dataset.t ?? 'mondial') as OngletScore
        this.buildScores()
      })
    }

    /*
     * 🗺️ Le filtre de l'onglet « Géo » : où l'on veut REGARDER.
     *
     * ⚠️ Sans rapport avec le pays de l'écran Compte, qui dit d'où l'on EST.
     * Les confondre obligerait à se déclarer japonais pour jeter un œil au
     * classement japonais.
     *
     * Bâti une seule fois : deux cents options recréées à chaque ouverture
     * feraient ramer l'écran pour rien.
     */
    this.el.scoresPays.appendChild(new Option('🌍 Tous les pays', ''))
    for (const p of PAYS) {
      this.el.scoresPays.appendChild(new Option(`${drapeau(p.code)}  ${p.nom}`, p.code))
    }
    this.el.scoresPays.addEventListener('change', () => {
      this.filtrePays = this.el.scoresPays.value
      this.filtreRegion = '' // la subdivision tombe avec son pays
      this.majFiltreRegion()
      this.buildScores()
    })
    this.el.scoresRegion.addEventListener('change', () => {
      this.filtreRegion = this.el.scoresRegion.value
      this.buildScores()
    })

    for (const b of document.querySelectorAll<HTMLElement>('#scoresCategories button')) {
      b.addEventListener('click', () => {
        this.categorieScore = (b.dataset.c ?? 'course') as CategorieScore
        // La recherche ne suit PAS d'une catégorie à l'autre : on cherchait un
        // pseudo dans les chronos, le garder pour les distances afficherait un
        // « aucun résultat » qu'on n'a pas demandé.
        this.el.scoresRech.value = ''
        this.buildScores()
      })
    }

    /*
     * ————— 🌍 Le pays et la région —————
     *
     * Bâtis UNE FOIS à l'allumage : deux cent cinquante options recréées à
     * chaque ouverture de l'écran feraient ramer l'ouverture pour rien.
     */
    this.el.selPays.appendChild(new Option('— Aucun —', ''))
    for (const p of PAYS) {
      this.el.selPays.appendChild(new Option(`${drapeau(p.code)}  ${p.nom}`, p.code))
    }
    this.el.selPays.value = this.settings.pays
    this.majRegions()

    this.el.selPays.addEventListener('change', () => {
      this.settings.pays = this.el.selPays.value
      // ⚠️ La région TOMBE avec le pays : garder celle d'avant ferait un
      // japonais normand. `majRegions` reconstruit la liste, cette ligne
      // s'assure que l'ancienne valeur ne survit pas au changement.
      this.settings.region = ''
      this.majRegions()
      saveSettings(this.settings)
    })
    this.el.selRegion.addEventListener('change', () => {
      this.settings.region = this.el.selRegion.value
      saveSettings(this.settings)
    })

    document.getElementById('btnBoutique')!.addEventListener('click', () => cb.onBoutique())
    document.getElementById('btnCompte')!.addEventListener('click', () => this.ouvrir('compte'))
    this.el.btnGoogle.addEventListener('click', () => cb.onGoogle())
    this.el.btnDeconnexion.addEventListener('click', () => cb.onDeconnexion())
    this.el.btnInscription.addEventListener('click', () => this.envoyerEmail('inscription'))
    this.el.btnConnexionMail.addEventListener('click', () => this.envoyerEmail('connexion'))
    // Entree dans le mot de passe = on valide, comme partout ailleurs
    this.el.mdpCompte.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.envoyerEmail('inscription')
    })
    this.el.cancel.addEventListener('click', () => cb.onCancel())

    /*
     * Les boutons « retour » / « OK » ramènent au titre — SAUF quand on est
     * venu du salon. Un joueur qui ouvre les fiches depuis le lobby veut y
     * revenir : le renvoyer au titre lui donnerait l'impression d'avoir quitté
     * la partie, alors qu'il y est toujours.
     */
    for (const b of document.querySelectorAll('[data-back]')) {
      b.addEventListener('click', () => {
        // Un cran en arrière, et un seul. La pile vide ramène au titre.
        this.show(this.pile.pop() ?? 'title')
      })
    }

    // 📜 L'aide depuis le salon, sans quitter le salon
    document.getElementById('btnLobbyHelp')?.addEventListener('click', () => {
      this.ouvrir('help')
    })

    // 🥷 Le vestiaire depuis le salon. On attend souvent plusieurs minutes qu'un
    // salon se remplisse : c'est LE moment où l'on veut changer de guerrier ou
    // retoucher son skin. Le faire imposait de quitter le salon — donc de perdre
    // sa place et son code. Même mécanique de retour que l'aide.
    document.getElementById('btnLobbyRoster')?.addEventListener('click', () => {
      this.ouvrir('roster')
    })

    this.buildAideSorts()

    this.buildRoster()
    this.buildOptions()
    this.buildSalon()
    this.applyFighter(this.settings.fighter)
    this.jouerEnseigne()
  }

  get fighter(): Fighter {
    return this.settings.fighter === PERSO_ID
      ? customFighter(this.settings.custom)
      : fighterById(this.settings.fighter)
  }

  // ————— Les salons en ligne —————

  private buildSalon() {
    const cb = this.cb
    document.getElementById('btnCreate')!.addEventListener('click', () => cb.onCreateSalon())
    document.getElementById('btnQuick')!.addEventListener('click', () => cb.onQuick())
    document.getElementById('btnRefresh')!.addEventListener('click', () => this.refreshSalons())

    const join = () => {
      const code = this.el.joinCode.value.toUpperCase().replace(/[^A-Z]/g, '')
      if (code) cb.onJoinByCode(code)
    }
    document.getElementById('btnJoinCode')!.addEventListener('click', join)
    this.el.joinCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') join()
    })
    // Toujours en majuscules pendant la frappe
    this.el.joinCode.addEventListener('input', () => {
      this.el.joinCode.value = this.el.joinCode.value.toUpperCase().replace(/[^A-Z]/g, '')
    })

    // — Lobby —
    document.getElementById('btnLeaveLobby')!.addEventListener('click', () => cb.onLeaveSalon())
    this.el.ready.addEventListener('click', () => {
      const me = this.view?.players.find((p) => p.id === this.view?.me)
      cb.onReady(!me?.ready)
    })
    this.el.start.addEventListener('click', () => cb.onStart())

    const send = () => {
      const text = this.el.chatInput.value.trim()
      if (!text) return
      cb.onChat(text)
      this.el.chatInput.value = ''
    }
    document.getElementById('btnChatSend')!.addEventListener('click', send)
    this.el.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send()
    })

    // — Résultats —
    this.el.replay.addEventListener('click', () => cb.onReplay())
    this.el.btnLobby.addEventListener('click', () => cb.onRetourLobby())
    document.getElementById('btnQuitResults')!.addEventListener('click', () => cb.onLeaveSalon())
  }

  /** Ouvre l'accueil « jouer en ligne » et charge la liste des salons. */
  showSalon() {
    this.el.joinCode.value = ''
    /*
     * 💬 On OUBLIE la salle plutôt que de vider le journal : c'est `showLobby`
     * qui décide, et lui seul. Repartir de la liste des salons signifie que la
     * prochaine entrée sera une entrée neuve — même si le hasard nous ramène
     * dans la salle qu'on vient de quitter, où la conversation a continué sans
     * nous.
     */
    this.salleChat = ''
    /*
     * ⚠️ On retient d'où l'on vient AVANT d'afficher, et on le repose APRÈS.
     *
     * `salon` est une RACINE : y entrer efface le chemin, pour qu'un salon
     * abandonné autrement que par « retour » ne laisse pas une marche fantôme
     * derrière lui. C'est toujours ce qu'on veut… sauf depuis la tuile
     * « Course VS.E », qui est une VRAIE descente : on regardait les modes, on
     * va voir les salons ouverts, et le retour doit ramener aux modes. Renvoyer
     * à l'écran-titre obligeait à rouvrir « Jouer » pour retrouver sa place.
     *
     * On garde donc les deux : l'effacement d'abord, puis la SEULE marche qui
     * compte. Et seulement depuis « jouer » — toute autre arrivée reste une
     * racine, sans rien derrière elle.
     */
    const depuis = this.current
    this.show('salon')
    if (depuis === 'jouer') this.pile.push(depuis)
    this.refreshSalons()
  }

  private async refreshSalons() {
    this.el.salonList.innerHTML = '<div class="salonempty">…</div>'
    const salons = await this.cb.onListSalons()
    if (!salons.length) {
      this.el.salonList.innerHTML = '<div class="salonempty">Aucun salon ouvert. Crée le tien !</div>'
      return
    }
    this.el.salonList.innerHTML = ''
    for (const s of salons) {
      const b = document.createElement('button')
      b.className = 'salonrow'
      const host = s.host ? escapeHtml(s.host) : 'un guerrier'
      b.innerHTML =
        `<span class="salonhost">${host}</span>` +
        `<span class="saloncount">${s.count}/${s.max}</span>`
      b.addEventListener('click', () => this.cb.onJoinRoom(s.roomId))
      this.el.salonList.appendChild(b)
    }
  }

  /** (Re)dessine le lobby à partir de la vue serveur. */
  /**
   * ⏳ Le décompte AVANT de rejoindre la grille, affiché dans le salon.
   *
   * `null` l'efface et rend la main aux boutons. Appelée à chaque image pendant
   * l'attente : elle doit donc rester bon marché, d'où le garde sur la valeur
   * déjà affichée — réécrire le même texte soixante fois par seconde ferait
   * recalculer la mise en page à chaque fois.
   *
   * ⚠️ Les boutons se VERROUILLENT pendant ce temps. « Prêt » et « Lancer »
   * n'ont plus aucun sens une fois la partie lancée, et un clic qui ne fait
   * rien se lit comme un bouton cassé.
   */
  setDepartSalon(secondes: number | null) {
    if (this.departAffiche === secondes) return
    this.departAffiche = secondes

    const enAttente = secondes !== null
    // On n'ÉCRIT que pendant l'attente. En sortie, on laisse le mot en place :
    // `showLobby` le réécrira au prochain rafraîchissement, et lui seul sait
    // quoi y mettre (le mode, le nombre de prêts…).
    if (enAttente) {
      this.el.lobbyHint.textContent = `⚔️ Départ dans ${secondes}… rejoins la grille !`
    }
    this.el.lobbyHint.classList.toggle('compte', enAttente)
    ;(this.el.ready as HTMLButtonElement).disabled = enAttente
    ;(this.el.start as HTMLButtonElement).disabled = enAttente
  }

  /** Le dernier chiffre passé à `setDepartSalon`, pour ne pas réécrire pour rien. */
  private departAffiche: number | null = null

  /**
   * 🌍 Reconstruit la liste des régions pour le pays choisi, et masque le champ
   * quand ce pays n'en détaille aucune.
   *
   * On MASQUE plutôt que d'afficher une liste vide : un menu déroulant sans
   * options se lit comme un bug, alors que son absence ne dit rien de faux — ce
   * pays n'a simplement pas de subdivision chez nous.
   */
  private majRegions() {
    const regions = regionsDe(this.settings.pays)
    // Vide UNIQUEMENT quand aucun pays n'est choisi : tout pays connu offre au
    // moins sa capitale.
    this.el.champRegion.classList.toggle('hidden', regions.length === 0)
    this.el.selRegion.replaceChildren()
    if (regions.length === 0) return

    /*
     * L'étiquette suit ce que la liste contient VRAIMENT — et il y a désormais
     * TROIS échelles possibles. Appeler « Région » les cent-un départements
     * français serait aussi faux que d'appeler « Ville » les provinces belges :
     * le joueur chercherait la sienne dans un menu qui ne l'a pas.
     *
     * Le genre du « — Aucun(e) — » suit le mot : on ne dit pas « aucun région ».
     */
    const MOTS = {
      departement: ['Département', '— Aucun —'],
      region: ['Région', '— Aucune —'],
      ville: ['Ville', '— Aucune —'],
      aucun: ['Région', '— Aucune —'],
    } as const
    const [etiquette, vide] = MOTS[niveauDe(this.settings.pays)]
    this.el.labRegion.textContent = etiquette
    this.el.selRegion.appendChild(new Option(vide, ''))
    for (const r of regions) this.el.selRegion.appendChild(new Option(r, r))
    this.el.selRegion.value = this.settings.region
  }

  showLobby(view: LobbyView) {
    /*
     * ————— 💬 UN CHAT PAR SALON, ET RIEN QUE LUI —————
     *
     * Le journal se vidait à l'ouverture de la LISTE des salons. Tous les
     * chemins n'y passent pas : on tombait dans une partie rapide avec, sous
     * les yeux, la conversation du salon d'avant — des messages adressés à
     * des gens qui ne sont plus là, dans une salle qui n'est plus la même.
     *
     * ⚠️ On compare la SALLE, pas le code. Toutes les parties rapides portent
     * le code `PUBLIC` : deux salons rapides successifs auraient eu le même
     * code, et le journal aurait survécu de l'un à l'autre — le cas exact
     * signalé. `salle` est le `roomId` Colyseus, unique par salle.
     *
     * ⚠️ Et c'est bien ICI, dans `showLobby`, qui est rappelée à CHAQUE
     * rafraîchissement du salon. Vider sans condition effacerait le chat à
     * chaque fois que quelqu'un se déclare prêt.
     */
    if (view.salle !== this.salleChat) {
      this.salleChat = view.salle
      this.el.chatLog.replaceChildren()
    }
    this.view = view
    this.el.lobbyCode.textContent = view.code === 'PUBLIC' ? '' : view.code
    this.show('lobby')

    const me = view.players.find((p) => p.id === view.me)
    const total = view.players.length
    const prets = view.players.filter((p) => p.ready).length

    // La liste des joueurs : hôte, prêt, moi
    this.el.lobbyList.innerHTML = view.players
      .map((p) => {
        const tags: string[] = []
        if (p.id === view.hostId) tags.push('<span class="tag host">hôte</span>')
        if (p.ready) tags.push('<span class="tag ok">prêt</span>')
        if (!p.connected) tags.push('<span class="tag off">absent</span>')
        const moi = p.id === view.me ? ' moi' : ''
        const nom = escapeHtml(p.name || 'Guerrier') + (p.id === view.me ? ' (toi)' : '')
        return `<div class="lobbyrow${moi}"><span class="lnom">${nom}</span>${tags.join('')}</div>`
      })
      .join('')

    // Le bouton « prêt » reflète mon état
    this.el.ready.textContent = me?.ready ? '✓ PRÊT (annuler)' : 'JE SUIS PRÊT'
    this.el.ready.classList.toggle('on', !!me?.ready)

    // Le bouton « lancer » : à l'hôte seul, actif dès la moitié prête (≥ 2 joueurs)
    const peutLancer = total >= 2 && prets >= Math.ceil(total / 2)
    this.el.start.classList.toggle('hidden', !view.isHost)

    /*
     * ⏳ LE DÉCOMPTE A LA PRIORITÉ.
     *
     * Une vue du salon peut très bien arriver PENDANT l'attente — il suffit
     * qu'un joueur s'en aille. Sans ce garde, elle rendrait la main aux boutons
     * et remplacerait « Départ dans 3… » par le nombre de prêts, alors que la
     * course est déjà lancée et que plus rien de tout cela n'est vrai.
     */
    if (this.departAffiche !== null) return

    ;(this.el.start as HTMLButtonElement).disabled = !peutLancer

    // Le mot d'ambiance : le MODE (duel à 2, chacun pour soi à 3+) puis le statut
    if (total < 2) {
      this.el.lobbyHint.textContent =
        view.code === 'PUBLIC'
          ? 'En attente d\'autres guerriers…'
          : `Partage le code ${view.code} pour inviter tes amis.`
    } else {
      const mode = total === 2 ? '⚔️ Duel' : `⚔️ Chacun pour soi · ${total} guerriers`
      const statut = view.isHost
        ? peutLancer
          ? `${prets}/${total} prêts — tu peux lancer !`
          : `${prets}/${total} prêts — il en faut ${Math.ceil(total / 2)}.`
        : `${prets}/${total} prêts — l'hôte lance la partie.`
      this.el.lobbyHint.textContent = `${mode} — ${statut}`
    }
  }

  /** Ajoute une ligne au chat (et fait défiler en bas). */
  addChatLine(name: string, text: string, mine: boolean) {
    const line = document.createElement('div')
    line.className = 'chatline' + (mine ? ' mine' : '')
    line.innerHTML = `<b>${escapeHtml(name || 'Anonyme')}</b> ${escapeHtml(text)}`
    this.el.chatLog.appendChild(line)
    // On borne l'historique et on colle en bas
    while (this.el.chatLog.childElementCount > 60) this.el.chatLog.firstElementChild!.remove()
    this.el.chatLog.scrollTop = this.el.chatLog.scrollHeight
  }

  /**
   * ————— 🏁 L'écran de fin —————
   *
   * Le même pour l'entraînement et pour les courses en ligne : c'est le MÊME
   * moment de jeu, et deux écrans différents auraient fini par diverger.
   *
   * `joueurs` arrive DÉJÀ TRIÉ — l'ordre des rangs n'est pas la même question
   * selon le mode (en ligne, un abandon se range après les arrivés ; en solo,
   * tout le monde finit), et cet arbitrage appartient à l'appelant.
   *
   * ⚠️ Les noms passent par `textContent`, jamais par `innerHTML` : en ligne
   * ils viennent des autres joueurs.
   */
  showFin(opts: {
    titre: string
    joueurs: { nom: string; temps: number | null; moi: boolean }[]
    canReplay: boolean
    canLobby: boolean
    /**
     * ♾️ Comment lire le chiffre. Une course se mesure en secondes, l'infini en
     * MÈTRES — et là, le plus grand gagne. Le podium ne trie pas lui-même : il
     * affiche l'ordre qu'on lui donne, si bien qu'inverser le classement se
     * fait chez l'appelant et que cette fonction n'a qu'à savoir écrire.
     */
    format?: (v: number) => string
    /**
     * ♾️ Un RELEVÉ à la place du podium.
     *
     * ⚠️ Un podium à trois marches suppose trois coureurs. En course sans fin il
     * n'y en a qu'un : deux marches restaient vides, et un podium creux se lit
     * comme un abandon — ou pire, comme des adversaires qu'on aurait manqués.
     *
     * Quand ce relevé est fourni, le podium disparaît et l'on montre ce qui a
     * du sens quand on court seul : cette course, son record, et les
     * précédentes — de quoi voir si l'on progresse.
     */
    resume?: { label: string; valeur: string; fort?: boolean }[]
  }) {
    const ecrire = (v: number | null) =>
      v === null ? 'abandon' : (opts.format ?? ((x: number) => `${x.toFixed(2)} s`))(v)
    this.el.finTitre.innerHTML = opts.titre

    /*
     * ♾️ Le relevé remplace le podium ET la liste : on rend la main tout de
     * suite, sans construire des marches qu'on masquerait juste après.
     *
     * ⚠️ `toggle` À DEUX ARGUMENTS, ET C'EST VOLONTAIRE : il RETIRE la classe
     * quand `resume` est absent. Le vrai piège n'est pas « le podium disparaît
     * en course sans fin » — c'est « il ne revient pas après ». Un simple
     * `add('hidden')` laisserait l'entraînement suivant avec un écran de fin
     * vide, et le défaut ne se verrait qu'en enchaînant les deux modes dans cet
     * ordre : personne ne fait ça en testant une seule chose.
     *
     * Si l'on remplace un jour cette ligne, il faut un `remove` en face.
     */
    this.el.podium.classList.toggle('hidden', !!opts.resume)
    if (opts.resume) {
      this.el.resultsBody.replaceChildren(this.blocResume(opts.resume))
      this.el.replay.classList.toggle('hidden', !opts.canReplay)
      this.el.btnLobby.classList.toggle('hidden', !opts.canLobby)
      this.show('results')
      return
    }

    // Les trois marches, dans l'ordre du DOM (2 · 1 · 3) et non du classement.
    const rangs = [1, 0, 2]
    const marches = [...this.el.podium.children] as HTMLElement[]
    marches.forEach((marche, i) => {
      const j = opts.joueurs[rangs[i]]
      // Une marche sans joueur disparaît : un podium à trois places dont une
      // reste vide se lirait comme un abandon.
      marche.classList.toggle('vide', !j)
      marche.classList.toggle('moi', !!j?.moi)
      if (!j) return
      marche.querySelector<HTMLElement>('.pod-nom')!.textContent = j.nom
      marche.querySelector<HTMLElement>('.pod-temps')!.textContent =
        ecrire(j.temps)
    })

    // Du 4ᵉ au dernier : la liste, qui existait déjà et n'avait pas à changer.
    this.el.resultsBody.replaceChildren()
    if (opts.joueurs.length > 3) {
      const liste = document.createElement('div')
      liste.className = 'reslist'
      opts.joueurs.slice(3).forEach((j, i) => {
        const ligne = document.createElement('div')
        ligne.className = `resrow${j.moi ? ' moi' : ''}`
        const rang = document.createElement('span')
        rang.textContent = `${i + 4}ᵉ`
        const nom = document.createElement('span')
        nom.className = 'resname'
        nom.textContent = j.nom
        const temps = document.createElement('span')
        temps.className = 'restime'
        temps.textContent = ecrire(j.temps)
        ligne.append(rang, nom, temps)
        liste.appendChild(ligne)
      })
      this.el.resultsBody.appendChild(liste)
    }

    this.el.replay.classList.toggle('hidden', !opts.canReplay)
    this.el.btnLobby.classList.toggle('hidden', !opts.canLobby)
    this.show('results')
  }

  // ————— Les écrans —————

  /**
   * Descend dans une fiche en retenant d'où l'on vient.
   * À utiliser partout où un « retour » doit ramener ici.
   */
  private ouvrir(name: ScreenName) {
    this.pile.push(this.current)
    this.show(name)
  }

  private show(name: ScreenName) {
    /*
     * Un écran RACINE n'est jamais « au milieu » d'un chemin : on y arrive,
     * on n'y revient pas. Il remet donc la pile à zéro — sans quoi un chemin
     * abandonné (salon quitté autrement que par « retour ») traînerait, et un
     * retour bien plus tard renverrait vers un salon qui n'existe plus.
     */
    if (RACINES.has(name)) this.pile.length = 0
    this.current = name
    for (const [key, el] of Object.entries(this.screens)) {
      el.classList.toggle('hidden', key !== name)
    }
    document.getElementById('overlay')!.classList.remove('hidden')
    // L'aperçu 3D ne tourne que quand on le regarde : inutile de faire chauffer
    // le téléphone pour un canvas caché.
    if (name === 'roster') this.resizePreview()
  }

  /** L'écran-titre. `banner` : le mot de la fin de la course précédente. */
  showTitle(banner?: string) {
    this.el.banner.innerHTML = banner ?? ''
    this.el.banner.classList.toggle('hidden', !banner)
    this.show('title')
  }

  /**
   * ————— 🌀 L'enseigne peinte —————
   *
   * Jouée UNE FOIS, au tout premier affichage du titre. Pas à chaque retour :
   * on repasse par le titre après chaque course, et une intro qu'on subit dix
   * fois par session cesse d'être une entrée en matière pour devenir un péage.
   *
   * Et toujours sautable. Un tap, une touche, et l'on est à l'état final —
   * il suffit de retirer la classe, puisque c'est elle seule qui anime.
   */
  private jouerEnseigne() {
    const e = document.getElementById('enseigne')
    if (!e) return
    e.classList.add('joue')

    const couper = () => {
      e.classList.remove('joue')
      removeEventListener('pointerdown', couper)
      removeEventListener('keydown', couper)
      clearTimeout(minuteur)
    }
    /*
     * Le minuteur n'est PAS ce qui termine l'animation (les keyframes le font
     * en `forwards`) : il ne sert qu'à retirer les écouteurs une fois l'intro
     * passée, pour qu'un tap sur un bouton ne soit plus intercepté.
     *
     * ⚠️ Il doit couvrir TOUTE la chorégraphie (3,4 s, cf. style.css) plus une
     * marge. Trop court, il retirerait la classe en plein geste et couperait
     * l'intro chez tout le monde — un « saut » que personne n'a demandé.
     */
    const minuteur = setTimeout(couper, 3800)
    addEventListener('pointerdown', couper)
    addEventListener('keydown', couper)
  }

  /**
   * Le mot de fin de course est-il encore à l'écran ?
   *
   * main.ts s'en sert pour GELER le décor : tant qu'on lit son chrono, le sol
   * ne doit plus défiler. On le dérive de l'affichage au lieu d'entretenir un
   * drapeau en double — un drapeau finirait par mentir le jour où l'on ajoute
   * un chemin de retour au titre qui oublie de le baisser.
   */
  arriveeAffichee(): boolean {
    return !this.el.banner.classList.contains('hidden')
  }

  /** Un message plein écran : recherche d'adversaire, ligne franchie… */
  showStatus(html: string, cancellable = false) {
    this.el.msg.innerHTML = html
    this.el.cancel.classList.toggle('hidden', !cancellable)
    this.show('status')
  }

  showBotPick() {
    this.ouvrir('botpick')
  }

  hide() {
    document.getElementById('overlay')!.classList.add('hidden')
  }

  // ————— Le choix du guerrier —————

  private buildRoster() {
    for (const f of ROSTER) {
      if (!f.pickable) continue
      const b = document.createElement('button')
      b.className = 'fighter'
      b.dataset.id = f.id
      b.style.setProperty('--c', cssColor(f.band))
      // Le prénom seul : « Hana la Kunoichi » ne rentre pas dans une vignette
      b.innerHTML =
        `<span class="jp-mini">${f.jp}</span><span class="nm">${escapeHtml(f.name.split(' ')[0])}</span>`
      b.addEventListener('click', () => this.pick(f.id))
      this.el.fighters.appendChild(b)
    }

    // La vignette « + » : le vestiaire perso, en bout de rangée façon Among Us
    const plus = document.createElement('button')
    plus.className = 'fighter plus'
    plus.dataset.id = PERSO_ID
    plus.style.setProperty('--c', cssColor(this.settings.custom.band))
    plus.innerHTML = '<span class="plusicon">＋</span><span class="nm">Perso</span>'
    plus.addEventListener('click', () => this.pick(PERSO_ID))
    this.el.fighters.appendChild(plus)

    this.buildForge()
  }

  private pick(id: string) {
    this.applyFighter(id)
    saveSettings(this.settings)
  }

  // ————— Le vestiaire perso —————

  /** Câble les deux palettes et le choix d'ornement. */
  private buildForge() {
    this.remplirPalettes()
    for (const b of this.el.forgeHead.querySelectorAll<HTMLElement>('button')) {
      b.addEventListener('click', () => {
        this.settings.custom.head = b.dataset.h as Head
        this.editCustom()
      })
    }
  }

  /**
   * (Re)fabrique les deux palettes : les 18 couleurs libres, puis les couleurs
   * ACHETÉES à la suite.
   *
   * Appelée à nouveau après un achat, pour que la couleur payée apparaisse
   * tout de suite — sans quoi il faudrait relancer le jeu pour en profiter.
   */
  private remplirPalettes() {
    for (const [pal, key] of [
      [this.el.palBody, 'body'],
      [this.el.palBand, 'band'],
    ] as const) {
      pal.replaceChildren()
      for (const c of [...SKIN_PALETTE, ...this.couleursAchetees]) {
        const sw = document.createElement('button')
        sw.className = 'swatch'
        sw.dataset.c = String(c)
        sw.style.background = cssColor(c)
        sw.setAttribute('aria-label', cssColor(c))
        // Les couleurs achetées portent une marque : on doit voir ce qu'on a payé
        if (this.couleursAchetees.includes(c)) sw.classList.add('paye')
        sw.addEventListener('click', () => {
          this.settings.custom[key] = c
          this.editCustom()
        })
        pal.appendChild(sw)
      }
    }
    this.markForge()
  }

  /**
   * Les couleurs débloquées, reçues du serveur en '#rrggbb'.
   *
   * ⚠️ C'est le SERVEUR qui dit ce que le joueur possède. Cette liste n'est
   * qu'un affichage : ajouter une couleur ici à la main ne la ferait
   * apparaître que sur son propre écran, sans rien débloquer nulle part.
   */
  setCouleursDebloquees(hex: string[]) {
    this.couleursAchetees = hex
      .map((h) => Number.parseInt(h.replace('#', ''), 16))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 0xffffff)
    this.remplirPalettes()
  }

  // ————— La boutique —————

  /**
   * Affiche la bourse partout où elle se montre : le bouton de l'écran-titre et
   * l'en-tête de la boutique. `null` = on n'a pas joint le serveur ; on cache
   * alors la ligne plutôt que d'afficher un faux zéro.
   */
  setBourse(mon: number | null, hisui: number | null) {
    const dispo = mon !== null && hisui !== null
    this.el.bourseRow.classList.toggle('hidden', !dispo)
    if (!dispo) return

    // Le bouton du titre : les deux monnaies côte à côte, en petit
    this.el.bourse.replaceChildren(
      montant(mon, 'mon', 15),
      ' · ',
      montant(hisui, 'hisui', 15)
    )
    // L'en-tête de la boutique : une monnaie par pavé, en plus gros
    this.el.bourseMon.replaceChildren(montant(mon, 'mon', 20))
    this.el.bourseHisui.replaceChildren(montant(hisui, 'hisui', 20))
  }

  /** Remplit la boutique. `articles` vient du serveur — lui seul dit les prix. */
  setBoutique(articles: ArticleVu[]) {
    const liste = this.el.boutiqueListe
    liste.replaceChildren()
    this.el.boutiqueVide.classList.toggle('hidden', articles.length > 0)

    for (const a of articles) {
      const carte = document.createElement('div')
      carte.className = 'article' + (a.possede ? ' possede' : '')

      const pastille = document.createElement('span')
      pastille.className = 'pastille'
      if (a.valeur) pastille.style.background = a.valeur

      const lignes = document.createElement('span')
      lignes.className = 'lines'
      const nom = document.createElement('b')
      // textContent : le nom vient de la base, on ne fabrique jamais de HTML avec
      nom.textContent = a.nom
      const prix = document.createElement('small')
      if (a.possede) {
        prix.textContent = 'Acquis'
      } else if (a.prix_mon !== null) {
        prix.appendChild(montant(a.prix_mon, 'mon', 14))
      } else {
        prix.appendChild(montant(a.prix_hisui ?? 0, 'hisui', 14))
      }
      lignes.append(nom, prix)

      const bouton = document.createElement('button')
      bouton.className = 'ghost'
      bouton.textContent = a.possede ? '✓' : 'Acheter'
      bouton.disabled = a.possede
      if (!a.possede) bouton.addEventListener('click', () => this.cb.onAcheter(a.code))

      carte.append(pastille, lignes, bouton)
      liste.appendChild(carte)
    }
  }

  showBoutique() {
    this.ouvrir('boutique')
  }

  // ————— Le compte —————

  /**
   * Reflète l'état du compte.
   *
   * `anonyme` vient du serveur. Le ton change du tout au tout : un compte
   * anonyme mérite un avertissement — ses Mon tiennent à un navigateur — là où
   * un compte Google n'a besoin que d'être constaté.
   */
  setCompte(opts: {
    anonyme: boolean
    email: string | null
    googleDispo: boolean
    connecte: boolean
  }) {
    const { anonyme, email, googleDispo, connecte } = opts
    const formulaire = [
      this.el.mailCompte.parentElement!,
      this.el.mdpCompte.parentElement!,
      this.el.btnInscription,
      this.el.btnConnexionMail,
    ]
    const montrer = (els: HTMLElement[], oui: boolean) =>
      els.forEach((e) => e.classList.toggle('hidden', !oui))

    this.el.compteErreur.classList.add('hidden')

    if (!connecte) {
      // Serveur injoignable : ni compte, ni promesse qu'on ne peut pas tenir.
      this.el.compteTitre.textContent = 'Hors ligne'
      this.el.compteDetail.textContent = "Le serveur ne répond pas — tes Mon ne sont pas accessibles."
      this.el.compteAlerte.classList.add('hidden')
      this.el.btnGoogle.classList.add('hidden')
      this.el.compteOu.classList.add('hidden')
      this.el.btnDeconnexion.classList.add('hidden')
      this.el.compteAide.classList.add('hidden')
      montrer(formulaire, false)
      return
    }

    this.el.compteTitre.textContent = anonyme ? 'Compte invité' : 'Compte connecté'
    this.el.compteDetail.textContent = anonyme
      ? 'Tu joues sans inscription. Tes Mon sont gardés côté serveur.'
      : (email ?? 'Ta progression te suit sur tous tes appareils.')

    this.el.compteAlerte.classList.toggle('hidden', !anonyme)
    this.el.compteAide.classList.toggle('hidden', !anonyme)
    // Le bouton Google n'apparaît que s'il MÈNE quelque part : sans les clés
    // côté serveur, mieux vaut pas de bouton qu'un bouton qui échoue.
    this.el.btnGoogle.classList.toggle('hidden', !anonyme || !googleDispo)
    // Le « ou » ne sépare quelque chose que si les DEUX voies sont proposées
    this.el.compteOu.classList.toggle('hidden', !anonyme || !googleDispo)
    this.el.btnDeconnexion.classList.toggle('hidden', anonyme)
    // Déjà connecté : plus rien à saisir
    montrer(formulaire, anonyme)
  }

  /**
   * Valide la saisie AVANT d'appeler le serveur.
   *
   * Ce n'est pas une sécurité — le serveur revérifie tout — mais une politesse :
   * dire « il manque le mot de passe » tout de suite vaut mieux qu'un
   * aller-retour réseau pour l'apprendre.
   */
  private envoyerEmail(mode: 'inscription' | 'connexion') {
    const email = this.el.mailCompte.value.trim()
    const mdp = this.el.mdpCompte.value

    if (!email || !email.includes('@')) {
      this.erreurCompte('Il faut un email valide.')
      this.el.mailCompte.focus()
      return
    }
    // 8 caractères : la même longueur que celle exigée par le serveur
    // (minPasswordLength). Les deux doivent rester d'accord.
    if (mode === 'inscription' && mdp.length < 8) {
      this.erreurCompte('Le mot de passe doit faire au moins 8 caractères.')
      this.el.mdpCompte.focus()
      return
    }
    if (!mdp) {
      this.erreurCompte('Il faut un mot de passe.')
      this.el.mdpCompte.focus()
      return
    }

    this.el.compteErreur.classList.add('hidden')
    this.cb.onEmail(mode, email, mdp)
  }

  /** Affiche un refus sous le formulaire. */
  erreurCompte(texte: string) {
    this.el.compteErreur.textContent = texte
    this.el.compteErreur.classList.remove('hidden')
  }

  /** Vide les champs — après une réussite, on ne laisse pas traîner le mot de passe. */
  viderFormulaireCompte() {
    this.el.mailCompte.value = ''
    this.el.mdpCompte.value = ''
    this.el.compteErreur.classList.add('hidden')
  }

  /** Une retouche du skin : on sauve et on réapplique (aperçu + jeu en direct). */
  private editCustom() {
    saveSettings(this.settings)
    this.applyFighter(PERSO_ID)
  }

  /** Reflète le skin courant dans les palettes et l'ornement sélectionnés. */
  private markForge() {
    const c = this.settings.custom
    for (const sw of this.el.palBody.querySelectorAll<HTMLElement>('.swatch')) {
      sw.classList.toggle('on', Number(sw.dataset.c) === c.body)
    }
    for (const sw of this.el.palBand.querySelectorAll<HTMLElement>('.swatch')) {
      sw.classList.toggle('on', Number(sw.dataset.c) === c.band)
    }
    for (const b of this.el.forgeHead.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('on', b.dataset.h === c.head)
    }
    // La vignette « + » prend la couleur du bandeau perso, même non sélectionnée
    const plus = this.el.fighters.querySelector<HTMLElement>('.fighter.plus')
    if (plus) plus.style.setProperty('--c', cssColor(c.band))
  }

  /** Met à jour le perso partout : vignettes, fiche, aperçu 3D, bouton du titre, jeu. */
  private applyFighter(id: string) {
    const custom = id === PERSO_ID
    const f = custom ? customFighter(this.settings.custom) : fighterById(id)
    this.settings.fighter = f.id

    for (const b of this.el.fighters.querySelectorAll<HTMLElement>('.fighter')) {
      b.classList.toggle('on', b.dataset.id === f.id)
    }

    this.el.infoJp.textContent = f.jp
    this.el.infoName.textContent = f.name
    this.el.infoRole.textContent = f.role
    this.el.infoBlurb.textContent = f.blurb
    this.el.infoPassive.textContent = f.passive
    this.el.pickJp.textContent = f.jp
    this.el.pickName.textContent = f.name

    // L'éditeur n'apparaît que pour le guerrier perso
    this.el.forge.classList.toggle('hidden', !custom)
    this.markForge()

    this.showInPreview(f)
    this.cb.onFighter(f)
  }

  // ————— 📜 Les fiches des sorts —————

  /**
   * Construit la liste des dix parchemins dans l'écran d'aide.
   *
   * Tout vient de `parchemin.ts` : nom, icône, ciblage et chiffres. Rien n'est
   * écrit en dur dans le HTML — une fiche recopiée à la main aurait menti au
   * joueur dès le premier réglage de calibrage.
   *
   * On construit une fois, au démarrage : le contenu ne change jamais.
   */
  /**
   * 🏆 Le tableau des meilleurs temps.
   *
   * Construit en DOM plutôt qu'en innerHTML : les noms viennent du joueur (et,
   * en ligne, d'inconnus). `textContent` les pose tels quels, sans qu'un
   * pseudo contenant des chevrons puisse devenir du balisage.
   */
  /**
   * Pose une ligne du tableau. Commune aux trois onglets : ils montrent le même
   * objet — un temps, un guerrier, un contexte — et devaient donc se lire pareil.
   *
   * Tout passe par `textContent` : les pseudos viennent des joueurs, et en
   * mondial d'inconnus. Un nom contenant des chevrons doit rester un nom.
   */
  private ligneScore(o: {
    rang: string
    jp: string
    nom: string
    detail: string
    temps: string
    premier?: boolean
    moi?: boolean
    /**
     * 🔴 TON record à toi, hissé en tête de « Récentes ».
     *
     * Distinct de `premier`, qui dore la première ligne d'un CLASSEMENT. Ici il
     * n'y a personne à battre : c'est ta meilleure course parmi les tiennes, et
     * elle se lit en vermillon pour qu'on la retrouve sans chercher.
     */
    record?: boolean
  }) {
    const ligne = document.createElement('div')
    ligne.className =
      'score' + (o.premier ? ' premier' : '') + (o.moi ? ' moi' : '') + (o.record ? ' record' : '')

    const rang = document.createElement('span')
    rang.className = 'scorerang'
    rang.textContent = o.rang

    const jp = document.createElement('span')
    jp.className = 'scorejp'
    jp.textContent = o.jp

    const corps = document.createElement('div')
    corps.className = 'scorecorps'
    const nom = document.createElement('b')
    nom.textContent = o.nom
    const sous = document.createElement('small')
    sous.textContent = o.detail
    corps.append(nom, sous)

    const temps = document.createElement('span')
    temps.className = 'scoretemps'
    temps.textContent = o.temps

    ligne.append(rang, jp, corps, temps)
    return ligne
  }

  /**
   * ♾️ Le relevé de fin : une ligne par chiffre, libellé à gauche, valeur à
   * droite. Volontairement plat — il n'y a rien à classer ici, juste à comparer.
   */
  private blocResume(lignes: { label: string; valeur: string; fort?: boolean }[]) {
    const bloc = document.createElement('div')
    bloc.className = 'resume'
    for (const l of lignes) {
      const ligne = document.createElement('div')
      ligne.className = `resumeligne${l.fort ? ' fort' : ''}`
      const nom = document.createElement('span')
      nom.textContent = l.label
      const val = document.createElement('b')
      val.textContent = l.valeur
      ligne.append(nom, val)
      bloc.appendChild(ligne)
    }
    return bloc
  }

  /**
   * ————— 🖼️ LES BOUTONS PEINTS —————
   *
   * Quatre images dessinées à la main remplacent quatre boutons : la pause
   * (休憩), Jouer (遊ぶ), la course sans fin (無限) et le Compte (戦士).
   *
   * ⚠️ L'IMAGE EST CHARGÉE AVANT D'ÊTRE POSÉE, et c'est tout l'intérêt de
   * passer par du JavaScript plutôt qu'un `background-image` en CSS. Un
   * fichier absent, mal nommé ou pas encore déployé laisserait alors un bouton
   * SANS FOND ET SANS TEXTE — donc invisible, et l'on ne pourrait plus ni
   * jouer ni reprendre une partie en pause. Ici, tant que le fichier ne
   * répond pas, le bouton garde exactement l'apparence qu'il avait.
   *
   * ⚠️ Chemin RELATIF (`ui/…`), pas absolu : le jeu doit pouvoir vivre dans un
   * sous-dossier. Un `/ui/…` chercherait à la racine du domaine.
   */
  private peindre() {
    const ART: Record<string, string> = {
      btnPause: 'pause',
      btnJouer: 'jouer',
      btnInfini: 'infini',
      btnCompte: 'compte',
    }
    for (const [id, nom] of Object.entries(ART)) {
      const b = document.getElementById(id)
      if (!b) continue
      const src = `ui/${nom}.png`
      const img = new Image()
      img.onload = () => {
        b.style.setProperty('--art', `url("${src}")`)
        b.classList.add('peint')
      }
      img.src = src
    }
  }

  /** Le podium se lit d'un coup d'œil ; au-delà, le chiffre suffit. */
  private medaille(i: number) {
    return ['🥇', '🥈', '🥉'][i] ?? String(i + 1)
  }

  private buildScores() {
    const hote = document.getElementById('scoresBody')
    const lead = document.getElementById('scoresLead')
    if (!hote || !lead) return

    for (const b of document.querySelectorAll<HTMLElement>('#scoresCategories button')) {
      b.classList.toggle('on', b.dataset.c === this.categorieScore)
    }
    const infini = this.categorieScore === 'infini'
    const dev = this.categorieScore === 'dev'

    // 🚧 Le mode à venir n'a ni onglets, ni recherche : il n'a rien à montrer.
    // On ne laisse pas des commandes qui ne commandent rien.
    document.getElementById('scoresOnglets')?.classList.toggle('hidden', dev)

    /*
     * 🔎 LA RECHERCHE DISPARAÎT SOUS « RÉCENTES ».
     *
     * Elle sert à retrouver QUELQU'UN dans une longue liste. Mais « Récentes »
     * ne contient que TES propres courses : le seul pseudo qu'on puisse y
     * trouver est le sien. Au mieux le champ ne fait rien, au pire une lettre
     * de trop vide l'écran et l'on croit avoir perdu ses scores.
     *
     * ⚠️ On efface aussi ce qui était tapé. Masquer un filtre encore actif
     * cacherait la CAUSE d'une liste incomplète tout en la laissant agir —
     * le pire des deux mondes, car il ne resterait plus rien à l'écran pour
     * expliquer le trou.
     */
    const cherchable = !dev && this.ongletScore !== 'recentes'
    if (!cherchable) this.el.scoresRech.value = ''
    this.el.scoresRech.parentElement?.classList.toggle('hidden', !cherchable)

    /*
     * 🗺️ Le filtre n'apparaît QUE sous « Géo », et c'est tout le sens de cet
     * onglet : « Mondial » montre les meilleurs de partout, « Géo » ceux d'un
     * endroit qu'on choisit. Le laisser sous les trois ferait trois fois la même
     * chose, et l'on ne saurait plus à quoi sert lequel.
     */
    const geo = !dev && this.ongletScore === 'local'
    this.el.scoresFiltre.classList.toggle('hidden', !geo)
    if (geo) this.majFiltreRegion()

    const titre = document.querySelector<HTMLElement>('#scr-scores h2')
    if (titre) {
      titre.textContent = dev
        ? 'Bientôt'
        : infini
          ? 'Plus longues courses'
          : 'Meilleurs temps'
    }

    if (dev) {
      hote.replaceChildren()
      lead.textContent =
        "🚧 Un troisième mode est en chantier. Sa place est déjà là — on préfère l'annoncer que de te laisser croire que tu as fait le tour."
      return
    }

    if (infini) {
      // ⚠️ Les trois onglets sont là AUSSI en Infinity, comme demandé. Mais
      // « Mondial » n'existe pas encore pour ce mode : le serveur ne stocke que
      // des chronos. `buildScoresInfini` le dit franchement plutôt que d'afficher
      // une liste vide qu'on prendrait pour une panne.
      for (const b of document.querySelectorAll<HTMLElement>('#scoresOnglets button')) {
        b.classList.toggle('on', b.dataset.t === this.ongletScore)
      }
      this.buildScoresInfini(hote, lead)
      return
    }

    // L'onglet actif se marque tout de suite, avant même que le serveur réponde :
    // sur un réseau lent, un onglet qui ne réagit pas au doigt donne l'impression
    // d'un bouton mort, et on le tape trois fois.
    for (const b of document.querySelectorAll<HTMLElement>('#scoresOnglets button')) {
      b.classList.toggle('on', b.dataset.t === this.ongletScore)
    }
    if (this.ongletScore === 'local') {
      this.buildScoresLocal(hote, lead)
      return
    }
    void this.buildScoresServeur(hote, lead, this.ongletScore)
  }

  /**
   * 🔎 Ce qu'on cherche, en minuscules et sans accents.
   *
   * ⚠️ La normalisation n'est pas un luxe : les pseudos portent des accents, et
   * personne ne les tape pour chercher. « rene » doit trouver « René », sinon la
   * recherche ne sert qu'à ceux qui écrivent déjà juste. `NFD` sépare la lettre
   * de son accent, et l'on jette les accents.
   */
  private get requeteScore(): string {
    return this.el.scoresRech.value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
  }

  private correspond(nom: string, q: string): boolean {
    if (!q) return true
    return nom
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .includes(q)
  }

  /** Le mot qu'on affiche quand le filtre ne laisse rien passer. */
  private videRecherche(lead: HTMLElement, q: string) {
    lead.textContent = `Aucun guerrier ne répond à « ${q} » dans ce classement.`
  }

  /** Le nom précédé de son drapeau — tel quel si le coureur n'en a pas. */
  private avecDrapeau(nom: string, pays?: string): string {
    const d = drapeau(pays ?? '')
    return d ? `${d} ${nom}` : nom
  }

  /**
   * 🗺️ Remplit le second menu du filtre d'après le pays regardé.
   *
   * Il DISPARAÎT quand aucun pays n'est choisi : proposer des départements sans
   * savoir de quel pays n'aurait aucun sens, et un menu vide se lit comme un bug.
   */
  private majFiltreRegion() {
    const liste = regionsDe(this.filtrePays)
    this.el.scoresRegion.classList.toggle('hidden', liste.length === 0)
    this.el.scoresRegion.replaceChildren()
    if (liste.length === 0) return
    const MOTS = {
      departement: 'Tous les départements',
      region: 'Toutes les régions',
      ville: 'Toutes les villes',
      aucun: 'Partout',
    } as const
    this.el.scoresRegion.appendChild(new Option(MOTS[niveauDe(this.filtrePays)], ''))
    for (const r of liste) this.el.scoresRegion.appendChild(new Option(r, r))
    this.el.scoresRegion.value = this.filtreRegion
  }

  /**
   * 🗺️ Le filtre s'applique-t-il à cette ligne ? Vrai partout SAUF sous « Géo ».
   *
   * ⚠️ UNE LIGNE SANS PAYS EST ÉCARTÉE dès qu'on filtre. Les temps enregistrés
   * avant que le pays existe n'en ont pas : les montrer sous « France » serait
   * leur inventer une origine, et le classement mentirait.
   */
  private dansLeFiltre(s: { pays?: string; region?: string }): boolean {
    if (this.ongletScore !== 'local') return true
    if (this.filtrePays && s.pays !== this.filtrePays) return false
    if (this.filtreRegion && s.region !== this.filtreRegion) return false
    return true
  }

  /**
   * ————— ♾️ Les plus longues courses sans fin —————
   *
   * Gardées sur l'appareil, comme les chronos locaux. Il n'y a pas de mondial
   * ici : le serveur ne stocke que des temps, et un classement de distances
   * demanderait qu'il apprenne un second mode de calcul — ainsi qu'une défense
   * contre les distances trafiquées, puisque c'est le CLIENT qui les compte.
   */
  private buildScoresInfini(hote: HTMLElement, lead: HTMLElement) {
    // ⚠️ « Mondial » n'existe pas pour ce mode : le serveur ne stocke que des
    // chronos. On le DIT, plutôt que d'afficher un vide qu'on prendrait pour
    // une panne de réseau.
    if (this.ongletScore === 'mondial') {
      hote.replaceChildren()
      lead.textContent =
        "🌍 Pas encore de classement mondial pour la course sans fin — le serveur ne garde que les chronos. Tes distances sont dans « Local » et « Récentes »."
      return
    }

    // 🕓 « Récentes » = TES courses, dans l'ordre du journal ; « Local » = les
    // meilleures. Deux questions différentes sur les mêmes données.
    const recentes = this.ongletScore === 'recentes'
    /*
     * 🕓 « Récentes » = TES courses, dans l'ordre du journal — MAIS ton record
     * hissé en tête.
     *
     * ⚠️ Une chronologie pure enterre le record dès qu'on rejoue : après dix
     * parties moyennes, la meilleure est hors de l'écran et l'on ne sait plus ce
     * qu'on avait fait. On la remonte donc, et on la marque en rouge — le reste
     * garde son ordre, du plus frais au plus vieux.
     */
    const journal = recentes ? chargerInfini() : meilleuresInfini()
    const record = recentes
      ? journal.reduce<(typeof journal)[number] | null>(
          (m, s) => (!m || s.metres > m.metres ? s : m),
          null
        )
      : null
    const tous = record ? [record, ...journal.filter((s) => s !== record)] : journal
    const q = this.requeteScore
    // ⚠️ Le rang d'origine est conservé, comme partout ailleurs : filtrer puis
    // renuméroter donnerait la médaille d'or au 5ᵉ dès qu'il cherche son nom.
    const scores = tous
      .map((s, rang) => ({ s, rang }))
      .filter(({ s }) => this.correspond(s.nom, q))

    hote.replaceChildren()
    if (tous.length === 0) {
      lead.textContent =
        'Aucune course sans fin pour l\'instant. Cours jusqu\'aux flammes une fois et ta distance s\'inscrira ici.'
      return
    }
    if (scores.length === 0) {
      this.videRecherche(lead, this.el.scoresRech.value.trim())
      return
    }
    lead.textContent = q
      ? `${scores.length} course${scores.length > 1 ? 's' : ''} sur ${tous.length} correspond${scores.length > 1 ? 'ent' : ''} à « ${this.el.scoresRech.value.trim()} ».`
      : recentes
        ? 'Tes dernières courses sans fin — ton record en tête, en rouge.'
        : `Tes ${MAX_SCORES} plus longues courses sans fin, gardées sur cet appareil.`

    scores.forEach(({ s, rang }) => {
      const f = fighterById(s.fighter)
      const quand = s.date ? ` · ${new Date(s.date).toLocaleDateString('fr-FR')}` : ''
      const dr = drapeau(s.pays ?? '')
      const estRecord = recentes && s === record
      hote.append(
        this.ligneScore({
          // En « Récentes », le chiffre du tableau ne classe rien : c'est une
          // chronologie. Seul le record porte une marque — le trophée.
          rang: recentes ? (estRecord ? '🏆' : `${rang}`) : this.medaille(rang),
          jp: f.jp,
          nom: dr ? `${dr} ${s.nom}` : s.nom,
          detail: `${f.name} · ♾️ sans fin${quand}`,
          temps: `${s.metres} m`,
          premier: !recentes && rang === 0,
          record: estRecord,
        })
      )
    })
  }

  /** 📱 L'appareil : les temps solo comme en ligne, gardés ici et nulle part ailleurs. */
  private buildScoresLocal(hote: HTMLElement, lead: HTMLElement) {
    const tous = chargerScores(COURSE_LENGTH).filter((s) => this.dansLeFiltre(s))
    const q = this.requeteScore
    /*
     * ⚠️ ON GARDE LE RANG D'ORIGINE. Filtrer puis numéroter la liste réduite
     * donnerait la médaille d'or au 5ᵉ dès qu'on cherche son nom — la recherche
     * doit montrer OÙ l'on est, pas réécrire le classement.
     */
    const scores = tous
      .map((s, rang) => ({ s, rang }))
      .filter(({ s }) => this.correspond(s.nom, q))

    hote.replaceChildren()
    if (tous.length === 0) {
      lead.textContent = `Aucun temps pour l'instant. Franchis le torii une fois et ta ligne s'inscrira ici.`
      return
    }
    if (scores.length === 0) {
      this.videRecherche(lead, this.el.scoresRech.value.trim())
      return
    }
    // « temps » est invariable : seul le VERBE s'accorde.
    lead.textContent = q
      ? `${scores.length} temps sur ${tous.length} correspond${scores.length > 1 ? 'ent' : ''} à « ${this.el.scoresRech.value.trim()} ».`
      : `Tes ${MAX_SCORES} meilleurs temps sur les ${COURSE_LENGTH} m, gardés sur cet appareil.`

    scores.forEach(({ s, rang }) => {
      const f = fighterById(s.fighter)
      // Ce qui rend deux temps comparables : le mode et le nombre d'adversaires.
      // « rival » fait « rivaux » : le pluriel change le mot entier, on ne peut
      // pas se contenter de coller une terminaison.
      const quoi =
        s.mode === 'ligne'
          ? '⚔️ en ligne'
          : s.rivaux > 0
            ? `🏋️ ${s.rivaux} ${s.rivaux > 1 ? 'rivaux' : 'rival'}`
            : '🏋️ en solitaire'
      const quand = s.date ? ` · ${new Date(s.date).toLocaleDateString('fr-FR')}` : ''
      // 🌍 Le drapeau précède le nom. Vide si aucun pays n'était choisi ce
      // jour-là — d'où l'espace conditionnel, sinon toutes les vieilles lignes
      // seraient décalées d'un cran pour rien.
      const dr = drapeau(s.pays ?? '')
      hote.append(
        this.ligneScore({
          rang: this.medaille(rang),
          jp: f.jp,
          nom: dr ? `${dr} ${s.nom}` : s.nom,
          detail: `${f.name} · ${quoi}${quand}`,
          temps: formaterTemps(s.temps),
          premier: rang === 0,
        })
      )
    })
  }

  /** 🌍 / 🕓 Les onglets servis par le serveur. */
  private async buildScoresServeur(
    hote: HTMLElement,
    lead: HTMLElement,
    onglet: 'mondial' | 'recentes'
  ) {
    hote.replaceChildren()
    lead.textContent = '⏳ Lecture du classement…'

    // On retient l'onglet demandé : si l'on change d'onglet pendant que le
    // serveur répond, la réponse en retard ne doit pas écraser l'écran courant.
    const demande = onglet
    const lignes = await lireClassement(onglet, COURSE_LENGTH)
    if (this.ongletScore !== demande) return

    hote.replaceChildren()
    if (lignes === null) {
      lead.textContent =
        '📡 Classement indisponible — pas de compte, ou serveur injoignable. Tes temps restent dans l’onglet Local.'
      return
    }
    if (lignes.length === 0) {
      lead.textContent =
        onglet === 'mondial'
          ? 'Personne n’a encore couru en ligne sur cette distance. La première place est libre.'
          : 'Aucune course en ligne pour l’instant. Seules les courses en ligne sont enregistrées ici.'
      return
    }
    /*
     * 🔎 Le filtre, en gardant le rang d'origine — voir `buildScoresLocal` : un
     * classement mondial qui renumérote ce qu'il montre ne dit plus rien.
     */
    /*
     * 🕓 Comme pour la course sans fin : en « Récentes », ton MEILLEUR temps
     * remonte en tête, en rouge. Une chronologie pure l'enterre dès qu'on
     * rejoue, et l'on ne sait plus ce qu'on avait fait.
     */
    const record =
      onglet === 'recentes'
        ? lignes.reduce<LigneClassement | null>(
            (m, l) => (!m || l.temps_ms < m.temps_ms ? l : m),
            null
          )
        : null
    const ordonnees = record ? [record, ...lignes.filter((l) => l !== record)] : lignes

    const q = this.requeteScore
    const vues = ordonnees
      .map((l, i) => ({ l, i }))
      // 🌍 Le filtre géographique s'applique AUSSI ici : « les meilleurs du
      // Japon » se lit dans le mondial, pas ailleurs.
      .filter((x) => this.correspond(x.l.pseudo || 'Guerrier anonyme', q) && this.dansLeFiltre(x.l))

    if (vues.length === 0) {
      this.videRecherche(lead, this.el.scoresRech.value.trim())
      return
    }

    lead.textContent = q
      ? `${vues.length} guerrier${vues.length > 1 ? 's' : ''} sur ${lignes.length} répond${vues.length > 1 ? 'ent' : ''} à « ${this.el.scoresRech.value.trim()} ».`
      : onglet === 'mondial'
        ? `Le meilleur temps de chaque guerrier sur les ${COURSE_LENGTH} m. Seules les courses en ligne comptent : ce sont les seules dont le serveur chronomètre lui-même.`
        : 'Tes dernières courses en ligne — ton meilleur temps en tête, en rouge.'

    vues.forEach(({ l, i }) => {
      const f = fighterById(l.fighter)
      const quand = new Date(l.cree_le).toLocaleDateString('fr-FR')
      const place = `${l.rang}ᵉ sur ${l.partants}`
      hote.append(
        this.ligneScore({
          // En « récentes », le rang du tableau n'a pas de sens : ce n'est pas un
          // classement mais une chronologie. On y montre la place à l'arrivée.
          rang:
            onglet === 'mondial'
              ? this.medaille(i)
              : l === record
                ? '🏆' // 🕓 ton meilleur temps, hissé en tête
                : `${l.rang}ᵉ`,
          jp: f.jp,
          // 🌍 Le drapeau précède le nom, comme en local. Vide si le coureur ne
          // s'est déclaré de nulle part — pas de carré vide à la place.
          nom: this.avecDrapeau(l.pseudo || 'Guerrier anonyme', l.pays),
          // Et sa subdivision suit son guerrier : c'est elle qu'on cherche quand
          // on regarde « les meilleurs du Finistère ».
          detail: `${f.name}${l.region ? ` · ${l.region}` : ''} · ${place} · ${quand}`,
          temps: formaterTemps(l.temps_ms / 1000),
          premier: onglet === 'mondial' && i === 0,
          record: l === record,
          moi: l.moi,
        })
      )
    })
  }

  private buildAideSorts() {
    const hote = document.getElementById('helpSorts')
    if (!hote) return

    // Rangés par usage : ce qu'on se lance à soi, puis ce qu'on envoie.
    const groupes: [string, ParcheminKind[]][] = [
      ['🧘 Pour toi', TIRAGE.filter((k) => PARCHEMINS[k].cible === 'soi')],
      ['⚔️ Contre les autres', TIRAGE.filter((k) => PARCHEMINS[k].cible !== 'soi')],
    ]

    hote.replaceChildren()
    for (const [titre, kinds] of groupes) {
      const h = document.createElement('h4')
      h.className = 'sortgroupe'
      h.textContent = titre
      hote.append(h)

      for (const k of kinds) {
        const p = PARCHEMINS[k]
        const carte = document.createElement('div')
        carte.className = 'sort'

        const ic = document.createElement('span')
        ic.className = 'sortic'
        ic.textContent = p.icone

        const corps = document.createElement('div')
        const nom = document.createElement('b')
        nom.textContent = p.nom
        const ou = document.createElement('span')
        ou.className = 'sortcible'
        ou.textContent = CIBLAGE[p.cible]
        const quoi = document.createElement('p')
        quoi.textContent = EFFETS[k]

        corps.append(nom, ou, quoi)
        carte.append(ic, corps)
        hote.append(carte)
      }
    }
  }

  // ————— L'aperçu 3D —————

  private showInPreview(f: Fighter) {
    if (!this.preview) this.initPreview()
    if (!this.preview) return // pas de WebGL pour le petit canvas : tant pis, on garde les vignettes
    clearFighter(this.preview.group)
    const parts = buildFighter(f)
    this.apercu = parts[0] // on le fait courir sur place dans la vignette
    this.fighterAffiche = f // c'est SA foulée qu'on joue : chacun la sienne
    this.preview.group.add(...parts)
  }

  private initPreview() {
    const canvas = document.querySelector<HTMLCanvasElement>('#preview')
    if (!canvas) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    } catch {
      return // certains vieux mobiles refusent un 2ᵉ contexte WebGL — le jeu passe avant
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20)
    camera.position.set(0, 1.5, 4.2)
    camera.lookAt(0, 0.85, 0)

    // Même ambiance que la course : clair de lune froid + contre-jour chaud
    const ambient = new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 1.1)
    const key = new THREE.DirectionalLight(0xdfe8ff, 1.7)
    key.position.set(-2.5, 4, 3)
    const rim = new THREE.DirectionalLight(0xe24b3a, 0.8)
    rim.position.set(3, 1.5, -3)
    scene.add(ambient, key, rim)

    const group = new THREE.Group()
    scene.add(group)

    this.preview = { renderer, scene, camera, group }
  }

  /** Le canvas est dimensionné par le CSS : on recale le rendu dessus. */
  private resizePreview() {
    const p = this.preview
    if (!p) return
    const w = p.renderer.domElement.clientWidth
    const h = p.renderer.domElement.clientHeight
    if (w === 0 || h === 0) return
    const size = p.renderer.getSize(new THREE.Vector2())
    if (size.x === w && size.y === h) return
    p.renderer.setSize(w, h, false)
    p.camera.aspect = w / h
    p.camera.updateProjectionMatrix()
  }

  /** Appelé à chaque image par la boucle de jeu : fait tourner l'aperçu. */
  update(dt: number) {
    if (this.current !== 'roster' || !this.preview) return
    this.resizePreview()
    this.spin += dt * 0.7
    this.preview.group.rotation.y = this.spin
    // Il court sur place pendant qu'on le regarde : une pose figée donnerait
    // l'impression d'un mannequin, pas d'un coureur.
    animerGuerrier(this.apercu, this.fighterAffiche, this.anim, 'course', dt, this.spin)
    this.preview.renderer.render(this.preview.scene, this.preview.camera)
  }

  // ————— Les options —————

  private buildOptions() {
    // Le pseudo
    this.el.optName.value = this.settings.name
    const commit = () => {
      this.settings.name = cleanName(this.el.optName.value)
      this.el.optName.value = this.settings.name
      saveSettings(this.settings)
    }
    this.el.optName.addEventListener('change', commit)
    this.el.optName.addEventListener('blur', commit)
    // Entrée = j'ai fini : on referme le clavier du téléphone
    this.el.optName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.el.optName.blur()
    })

    // La qualité graphique
    for (const b of this.el.optQuality.querySelectorAll<HTMLElement>('button')) {
      b.addEventListener('click', () => {
        this.settings.quality = b.dataset.q as Quality
        saveSettings(this.settings)
        this.markQuality()
        this.cb.onQuality(this.settings.quality)
      })
    }
    this.markQuality()

    // Le volume de la musique. On applique en DIRECT (`input`) : régler un
    // volume sans l'entendre bouger, c'est régler à l'aveugle.
    this.el.optVolume.addEventListener('input', () => {
      this.settings.volumeMusique = Number(this.el.optVolume.value) / 100
      this.markVolume()
      this.cb.onMusique(this.settings.volumeMusique)
    })
    // On n'écrit sur le téléphone qu'une fois le curseur lâché : sinon on
    // sauvegarderait des dizaines de fois pendant le glissement.
    this.el.optVolume.addEventListener('change', () => saveSettings(this.settings))
    this.el.optVolume.value = String(Math.round(this.settings.volumeMusique * 100))
    this.markVolume()

    // Le volume des bruitages, même principe. Le callback JOUE un son au
    // passage : c'est le seul moyen d'entendre ce qu'on règle, un bruitage
    // ne tournant pas en boucle comme la musique.
    this.el.optSfx.addEventListener('input', () => {
      this.settings.volumeSfx = Number(this.el.optSfx.value) / 100
      this.markSfx()
      this.cb.onSfx(this.settings.volumeSfx)
    })
    this.el.optSfx.addEventListener('change', () => saveSettings(this.settings))
    this.el.optSfx.value = String(Math.round(this.settings.volumeSfx * 100))
    this.markSfx()

    // Les pseudos en piste. Rien à prévenir au jeu : main.ts relit le réglage à
    // chaque image pour placer les étiquettes — un rappel de plus pourrait se
    // désynchroniser, la lecture directe ne le peut pas.
    this.el.optNoms.checked = this.settings.afficherNoms
    this.el.optNoms.addEventListener('change', () => {
      this.settings.afficherNoms = this.el.optNoms.checked
      saveSettings(this.settings)
    })
  }

  private markQuality() {
    for (const b of this.el.optQuality.querySelectorAll<HTMLElement>('button')) {
      b.classList.toggle('on', b.dataset.q === this.settings.quality)
    }
  }

  private markVolume() {
    const pct = Math.round(this.settings.volumeMusique * 100)
    this.el.optVolumeVal.textContent = pct === 0 ? '🔇 coupée' : `${pct} %`
    this.el.optVolume.style.setProperty('--pct', `${pct}%`)
  }

  private markSfx() {
    const pct = Math.round(this.settings.volumeSfx * 100)
    this.el.optSfxVal.textContent = pct === 0 ? '🔇 coupés' : `${pct} %`
    // C'est ce qui remplit le rail en or jusqu'à la poignée : sur WebKit, aucun
    // pseudo-élément ne donne la progression, il faut la lui dire (cf. le CSS).
    this.el.optSfx.style.setProperty('--pct', `${pct}%`)
  }
}
