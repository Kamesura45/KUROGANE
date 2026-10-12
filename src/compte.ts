import { WS_URL } from './net'

/**
 * ————— LE COMPTE DU JOUEUR —————
 *
 * Le jeu ne parle QU'À NOTRE SERVEUR. Il n'a aucune clé, aucune adresse de base
 * de données, et ne sait rien de la façon dont les comptes sont rangés : il
 * envoie un jeton, il reçoit un solde.
 *
 * ⚠️ Le solde affiché ici n'est qu'un REFLET. Le vrai vit dans la base, et lui
 * seul compte : bidouiller `profil.mon` dans la console ne change rien à ce
 * qu'on peut acheter, puisque le serveur relit tout au moment de l'achat.
 *
 * ————— Le parcours —————
 * Au tout premier lancement, on crée un compte ANONYME sans rien demander : le
 * joueur court dès la première seconde, sans inscription ni email (ils sont
 * souvent mineurs). Le jeton est gardé sur l'appareil ; il suffit à le
 * reconnaître aux lancements suivants.
 */

/**
 * L'adresse HTTP du serveur, déduite de celle du websocket : les deux vivent
 * sur le même port. `wss://` → `https://`, `ws://` → `http://`.
 */
const API = WS_URL.replace(/^ws/, 'http')

const CLE_JETON = 'kurogane-jeton'
const CLE_BOUTIQUE = 'kurogane-boutique'

/*
 * ————— Les délais —————
 *
 * Le SERVEUR attend 10 secondes avant d'abandonner une base muette
 * (`connectionTimeoutMillis`, server/src/db.ts). Si le CLIENT attend aussi
 * 10 secondes, chaque tentative coûte 10 secondes de gel — et sur une
 * machine lente, une boutique qui met 10 secondes à dire « indisponible »
 * est une boutique qui a l'air plantée.
 *
 * On rend donc la main AVANT le serveur : 5 secondes en lecture, 8 en
 * mutation (un achat ou un versement mérite un poil plus de patience). Le
 * joueur voit un résultat en moins de 5 secondes, le serveur continue de
 * travailler de son côté, et la reprise arrive par la sonde — pas par un
 * écran gelé.
 *
 * ⚠️ `AbortSignal.timeout` existe depuis Chrome 103 / Firefox 100 / Safari 16.
 * Le jeu exige déjà WebGL2 et Three.js 0.185 : on est bien au-dessus.
 */
const DELAI_LECTURE = 5_000
const DELAI_MUTATION = 8_000

export interface Profil {
  joueur: string
  pseudo: string
  mon: number
  hisui: number
  guerrier: string
  /** Compte anonyme = perdable : le jeu propose de le securiser. */
  anonyme?: boolean
  email?: string | null
}

export interface Article {
  code: string
  nom: string
  categorie: string
  prix_mon: number | null
  prix_hisui: number | null
  valeur: string | null
  possede: boolean
}

let jeton: string | null = null
let profil: Profil | null = null
let articles: Article[] = []

/** Le solde connu — `null` tant qu'on n'a pas réussi à joindre le serveur. */
export function monProfil(): Profil | null {
  return profil
}

/** Le catalogue connu (vide tant qu'on n'a pas ouvert la boutique). */
export function mesArticles(): Article[] {
  return articles
}

/** Les couleurs achetées, en '#rrggbb' — c'est ce que lit le vestiaire. */
export function couleursDebloquees(): string[] {
  return articles.filter((a) => a.possede && a.categorie === 'couleur' && a.valeur).map((a) => a.valeur!)
}

/**
 * Le jeton de session, à envoyer au salon de course pour que le serveur sache
 * quel portefeuille créditer à l'arrivée.
 */
export function monJeton(): string | null {
  return jeton
}

/** Un appel à notre serveur, avec le jeton s'il y en a un. */
async function appel(route: string, corps?: unknown): Promise<any> {
  const lecture = corps === undefined
  try {
    const r = await fetch(API + route, {
      method: lecture ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
      },
      body: lecture ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(lecture ? DELAI_LECTURE : DELAI_MUTATION),
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) throw Object.assign(new Error(data?.erreur ?? 'erreur'), { statut: r.status, data })
    return data
  } catch (e: any) {
    /*
     * ⚠️ `statut` = le serveur a répondu et a REFUSÉ : ce n'est pas une panne,
     * c'est une décision (401, 402 fonds insuffisants, 429 trop d'achats…).
     *
     * Un `fetch` qui casse — délai dépassé, réseau coupé, service en sommeil —
     * ne porte AUCUN `statut`. C'est exactement là qu'on note la panne et qu'on
     * remet la veille en route : c'est ce qui fait revenir la boutique et les
     * comptes sans que le joueur recharge la page.
     */
    if (!e?.statut) noterPanne()
    throw e
  }
}

/** Crée un compte anonyme et garde son jeton sur l'appareil. */
async function creerCompteAnonyme(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/api/auth/sign-in/anonymous`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      // Mutation : 8 s. Le serveur crée un compte dans la base, ce qui prend
      // un peu plus qu'une lecture.
      signal: AbortSignal.timeout(DELAI_MUTATION),
    })
    const data = await r.json()
    if (!data?.token) return false
    jeton = data.token
    try {
      localStorage.setItem(CLE_JETON, data.token)
    } catch {
      // Navigation privée : on jouera quand même, mais sans être reconnu au
      // prochain lancement. Mieux vaut ça que pas de jeu du tout.
    }
    return true
  } catch {
    return false
  }
}

/** Google est-il configuré côté serveur ? (sinon on masque le bouton) */
let googleDispo = false

/**
 * Le serveur répond-il, et ses comptes fonctionnent-ils ?
 *
 * Ce sont DEUX questions, et les confondre est exactement le défaut qu'on vient
 * de corriger : un serveur joignable dont la base est morte répond 200 à tout,
 * y compris à `/sante` — et le joueur ne peut pas s'y inscrire.
 */
let serveurSaine = true
let serveurRaison = ''

/*
 * 👥 Combien de joueurs sont en ligne, à la seconde où on le demande.
 *
 * Le serveur le renvoie avec `/sante` (champ `joueurs`, tenu par Colyseus lui-
 * même). On le range ICI et non dans menu.ts : le compteur a besoin du même
 * aller-retour que la santé, et les deux doivent voyager ensemble — une
 * seconde requête pour un entier serait une politesse de trop.
 *
 * ⚠️ `null` tant qu'on n'a rien reçu. Ce n'est pas « personne ne joue », c'est
 * « on ne sait pas ». La distinction est TOUT le sujet : `CO:000` affiché dès
 * le premier rendu mentirait trois secondes durant à chaque lancement, et un
 * joueur qui se connecte au même moment croirait le jeu vide.
 */
let joueursEnLigne: number | null = null
export function joueursConnectes() {
  return joueursEnLigne
}

/** Qui veut être prévenu quand ce nombre change. Ne se déclenche qu'après la 1ʳᵉ réponse. */
const abonnesJoueurs: ((n: number) => void)[] = []
export function surNombreJoueurs(cb: (n: number) => void) {
  abonnesJoueurs.push(cb)
}
function prevenirLesJoueurs() {
  if (joueursEnLigne === null) return
  for (const cb of abonnesJoueurs) {
    try {
      cb(joueursEnLigne)
    } catch {
      // Un abonné qui crache n'empêche pas les autres d'être prévenus.
    }
  }
}

/*
 * ————— Le compteur des connectés —————
 *
 * Il tourne TANT QUE LA PAGE EST OUVERTE, quel que soit l'écran affiché :
 * l'écran-titre, la boutique, les réglages, le salon. On le refermait dès qu'on
 * quittait le titre, et le compteur restait figé sur un chiffre mort partout
 * ailleurs.
 *
 * Dix secondes, et non trente : c'est un compteur de joueurs, il doit bouger
 * quand un ami arrive, pas une minute plus tard. Dix secondes reste très loin
 * d'une charge qui tiendrait le serveur éveillé — et l'onglet caché ne sonde
 * pas du tout.
 */
const CADENCE_COMPTEUR = 10_000
let cadenceCompteur: ReturnType<typeof setInterval> | null = null

/**
 * Un identifiant, à portée de main même hors HTTPS.
 *
 * `crypto.randomUUID()` n'existe QUE dans un contexte sécurisé : il manque en
 * `http://192.168.1.194:5173` — l'adresse de dev sur le réseau local — où il
 * lèverait un `TypeError` à chaque sonde. On retombe sur du temps + du hasard :
 * deux valeurs quasi sûres d'être différentes, ce qui est tout ce que demande
 * un compteur d'onglets.
 */
function nouvelId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // contexte non sécurisé : on passe au repli
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`
}

/**
 * L'identité de l'ONGLET, stable tant que la page vit.
 *
 * `sessionStorage` et non `localStorage` : deux onglets doivent compter pour
 * DEUX. Et c'est ce qui distingue notre compteur du `ccu` de Colyseus, qui ne
 * voit que les clients ayant rejoint une salle — le menu, la boutique et les
 * réglages n'en ont aucune, d'où le `CO:000` malgré deux joueurs ouverts.
 */
let visiteur = ''
function cleVisiteur(): string {
  if (visiteur) return visiteur
  try {
    visiteur = sessionStorage.getItem('kurogane-visiteur') ?? ''
    if (!visiteur) {
      visiteur = nouvelId()
      sessionStorage.setItem('kurogane-visiteur', visiteur)
    }
  } catch {
    // Stockage refusé (navigation privée stricte) : on reste anonyme et jetable,
    // le compteur fonctionne tout de même, il ne fait que perdre la mémoire
    // d'un onglet entre deux sondes.
    visiteur = nouvelId()
  }
  return visiteur
}

/**
 * Ouvre le robinet, une fois pour toutes.
 *
 * Idempotent : appelé au démarrage, il ne sert qu'à garantir que le compteur
 * tourne même si aucun écran n'a demandé quoi que ce soit.
 */
export function demarrerLeCompteur() {
  if (cadenceCompteur) return
  const sonder = () => {
    // Un onglet en arrière-plan ne regarde rien : on ne fait pas travailler le
    // serveur pour un chiffre que personne ne lit. Il se décompte de lui-même,
    // faute de se manifester, au bout de PRESENCE_FENETRE côté serveur.
    if (typeof document !== 'undefined' && document.hidden) return
    void sonderServeur()
  }
  void sonder()
  cadenceCompteur = setInterval(sonder, CADENCE_COMPTEUR)
  /*
   * 🚪 Au revoir SUR LE CHAMP.
   *
   * Sans ça, un onglet fermé resterait compté jusqu'à expiration — le joueur
   * ferme son navigateur et le compteur affiche encore son fantôme quarante-
   * cinq secondes. `keepalive` est ce qui laisse la requête partir alors que
   * la page est déjà en train de mourir.
   */
  if (typeof window !== 'undefined') {
    window.addEventListener(
      'pagehide',
      () => {
        const id = cleVisiteur()
        void fetch(`${API}/sante?v=${encodeURIComponent(id)}&sortie=1`, {
          keepalive: true,
        }).catch(() => {})
      },
      { once: true }
    )
  }
}

export function googleActif() {
  return googleDispo
}

/*
 * ————— La veille du serveur —————
 *
 * Railway met le service en SOMMEIL dès que personne ne joue. Le premier
 * appel le réveille, et pendant les trois premières secondes il répond AVANT
 * que sa base soit joignable : `/sante` dit alors « non saine », et une
 * requête Postgres casse en `ENOTFOUND`. Le serveur se soigne tout seul en
 * moins d'une minute (boucle `insister()` de server/src/index.ts : 2, 5, 10,
 * 20, 30, 60 s).
 *
 * Ce qui manquait n'était donc pas le serveur : c'était le CLIENT, qui ne
 * sondait qu'UNE FOIS, au lancement, et rangeait « injoignable » pour toute
 * la session. La boutique restait « indisponible » jusqu'au rechargement,
 * alors que le serveur était revenu depuis longtemps.
 *
 * D'où la veille : on re-sonde tant que c'est cassé, et quand ça repasse au
 * vert on prévient ceux qui ont besoin de se rafraîchir.
 */
const DELAI_SONDE = 4_000
/*
 * Dix secondes entre deux essais, et non trente : le serveur se remet en 10
 * à 30 secondes, et le joueur attend en ouvrant la boutique. Toutes les 30 s
 * on l'aurait laissé « indisponible » une bonne minute de trop.
 *
 * C'est une requête d'un kilo-octet, lancée UNIQUEMENT tant que c'est cassé,
 * et annulée dès que ça va mieux — pas une charge, une politesse.
 */
const RETRY_SONDE = 10_000

let sondeEnCours = false
let veilleur: ReturnType<typeof setTimeout> | null = null
const reprises: (() => void)[] = []

/**
 * Le serveur ne répond plus. On le note et on remet la veille en route.
 *
 * On ne fait QUE ça : pas de message, pas de toast. Une requête qui manque
 * (wifi qui décroche, service qui se rendort) n'est pas un événement — c'est
 * la reprise silencieuse qui compte.
 */
function noterPanne() {
  serveurSaine = false
  serveurRaison = ''
  googleDispo = false
  programmerSonde()
}

/** Reprogramme la prochaine sonde. Une seule à la fois, jamais plus rapprochée. */
function programmerSonde() {
  if (veilleur) return // une veille tourne déjà
  veilleur = setTimeout(
    () => {
      veilleur = null
      void sonderServeur()
    },
    RETRY_SONDE
  )
}

/** Demande au serveur s'il va bien — et surtout si ses COMPTES vont bien. */
export async function sonderServeur(): Promise<void> {
  if (sondeEnCours) return
  sondeEnCours = true
  const avant = serveurSaine
  try {
    /*
     * `?v=` : c'est la PRESENCE, pas un détail. Chaque sonde prouve que
     * l'onglet est encore ouvert — c'est lui, et non le `ccu` de Colyseus, qui
     * rend compte des gens sur le menu.
     */
    const r = await fetch(`${API}/sante?v=${encodeURIComponent(cleVisiteur())}`, {
      signal: AbortSignal.timeout(DELAI_SONDE),
    })
    const d = await r.json()
    googleDispo = d?.google === true
    // `saine` absent = serveur d'une version plus ancienne : on ne casse rien.
    serveurSaine = d?.saine !== false
    serveurRaison = typeof d?.raison === 'string' ? d.raison : ''
    /*
     * Le champ peut manquer (serveur d'avant l'addition, ou proxy qui a
     * ralenti). On garde alors le nombre précédent plutôt que de remettre à
     * zéro : un chiffre figé est moins faux qu'un `CO:000` qui clignote.
     */
    if (typeof d?.joueurs === 'number') {
      const vu = Math.max(0, Math.floor(d.joueurs))
      if (vu !== joueursEnLigne) {
        joueursEnLigne = vu
        prevenirLesJoueurs()
      }
    }
  } catch {
    googleDispo = false
    serveurSaine = false
    serveurRaison = ''
  } finally {
    sondeEnCours = false
  }

  if (serveurSaine) {
    if (veilleur) {
      clearTimeout(veilleur)
      veilleur = null
    }
    // On était cassé et on ne le sommes plus : c'est LA reprise.
    if (!avant) rappelerLesReprises()
  } else {
    programmerSonde()
  }
}

/**
 * Le serveur vient de REVENIR. On prévient ceux qui doivent se rafraîchir.
 *
 * C'est ce qui remet le solde, le catalogue et l'écran du compte à jour sans
 * que le joueur recharge la page.
 */
function rappelerLesReprises() {
  for (const cb of reprises) {
    try {
      cb()
    } catch {
      // Un abonné qui crache ne doit pas empêcher les autres d'être prévenus.
    }
  }
}

/**
 * S'abonne au retour du serveur. Appelé une fois, au démarrage, par le jeu.
 *
 * Le rappel peut survenir n'importe quand pendant la session : il doit donc
 * être léger et jamais lancer deux rafraîchissements qui se marchent dessus
 * (c'est `connecter()` qui se protège de lui-même contre la concurrence).
 */
export function surRepriseDuServeur(cb: () => void) {
  reprises.push(cb)
}

/** Es-tu un compte anonyme (donc perdable) ou un vrai compte ? */
let anonyme = true
export function estAnonyme() {
  return anonyme
}

/** L'email du compte, s'il y en a un. */
let email: string | null = null
export function monEmail() {
  return email
}

/**
 * ————— Le retour de Google —————
 *
 * Le serveur nous renvoie avec le jeton dans le FRAGMENT (`#jeton=…`). On le
 * récupère, on le garde, puis on NETTOIE la barre d'adresse : un jeton de
 * session n'a rien à faire dans l'historique du navigateur, ni dans un lien
 * qu'on partagerait par mégarde.
 *
 * Renvoie 'ok', 'echec' ou null (retour normal, sans connexion en cours).
 */
function lireRetourConnexion(): 'ok' | 'echec' | null {
  const h = location.hash
  if (!h || h.length < 2) return null

  const params = new URLSearchParams(h.slice(1))
  const recu = params.get('jeton')
  const echec = params.get('connexion') === 'echec'
  if (!recu && !echec) return null

  // On efface le fragment SANS recharger la page ni ajouter une entrée à
  // l'historique — sinon le bouton « précédent » ramènerait sur le jeton.
  history.replaceState(null, '', location.pathname + location.search)

  if (echec || !recu) return 'echec'
  jeton = recu
  try {
    localStorage.setItem(CLE_JETON, recu)
  } catch {
    /* navigation privée : on jouera cette session-ci, sans être reconnu ensuite */
  }
  return 'ok'
}

/**
 * Range ce que le serveur vient de dire de l'identité du joueur.
 *
 * Par défaut on se considère ANONYME : en cas de doute, le jeu proposera de
 * sécuriser un compte qui l'était déjà — sans gravité. L'erreur inverse
 * laisserait un joueur croire ses Mon à l'abri alors qu'ils sont perdables.
 */
function retenirIdentite() {
  anonyme = profil?.anonyme !== false
  email = profil?.email ?? null
}

/**
 * Demande au serveur ce qu'il sait faire — et, surtout, **si ses comptes
 * marchent**.
 *
 * ⚠️ ON LISSAIT `google` ET ON JETAIT LE RESTE. Le serveur envoyait déjà
 * `saine` et `raison` (cf. la route `/sante`), c'est-à-dire exactement ce qui
 * explique qu'une connexion échoue ; le client ne le prenait pas.
 *
 * Conséquence, et c'est le pire cas : le serveur répond, mais sa base est morte.
 * Le joueur voit le formulaire email et le bouton Google — le jeubentement
 * respond — il tape son mot de passe, et ça échoue. Sans explication. Le serveur
 * avait la réponse dans la réponse ; c'est le client qui a choisi de ne pas la
 * lire.
 *
 * C'est le même arbitrage que la boutique : un écran qui ne dit pas POURQUOI il
 * ne marche pas renvoie le joueur à l'essai, et l'essai est le chemin le plus
 * long vers la cause réelle.
 */
export function comptesCasses() {
  return !serveurSaine
}
export function raisonServeur() {
  return serveurRaison
}

/*
 * Se connecte au démarrage : on réutilise le jeton de l'appareil s'il est
 * encore valable, sinon on ouvre un compte anonyme.
 *
 * Ne lève JAMAIS : serveur éteint, hors-ligne, base en panne — le jeu doit
 * rester jouable. On se retrouve simplement sans solde ni boutique.
 *
 * ⚠️ ON NE RENONCE PLUS POUR TOUTE LA SESSION.
 *
 * Un appel qui échoue HORS 401 laissait le jeton en mémoire (bien) mais
 * `return null` clôturait la tentative : rien ne la reprenait plus, jamais,
 * jusqu'au rechargement. Or le serveur se répare tout seul — c'est même sa
 * façon normale de fonctionner après un sommeil. Il suffisait que le client
 * retente à la prochaine reprise ; c'est la veille qui le déclenche.
 */
let connexionEnCours: Promise<Profil | null> | null = null

export async function connecter(): Promise<Profil | null> {
  /*
   * Une reprise du serveur peut tomber au milieu d'une connexion déjà en vol.
   * Deux tentatives en parallèle se marcheraient sur le jeton et créeraient
   * deux comptes anonymes : on ne lance jamais deux à la fois.
   */
  if (connexionEnCours) return connexionEnCours
  connexionEnCours = tenterConnexion()
  try {
    return await connexionEnCours
  } finally {
    connexionEnCours = null
  }
}

async function tenterConnexion(): Promise<Profil | null> {
  // Un retour de Google l'emporte sur le jeton déjà en mémoire : c'est le
  // nouveau compte, éventuellement fusionné avec l'ancien anonyme.
  const retour = lireRetourConnexion()
  if (retour !== 'ok') {
    try {
      jeton = localStorage.getItem(CLE_JETON)
    } catch {
      jeton = null
    }
  }

  /*
   * ⚠️ LA SONDE PART TOUT DE SUITE, PENDANT QU'ON CHERCHE LE PROFIL.
   *
   * C'était un `await sonderServeur()` au tout début, avant toute requête.
   * Résultat sur un serveur qui se RÉVEILLE (Railway, 3,4 s de froid mesurés)
   * : sonde 3,4 s, puis profil 3,4 s — six secondes pour un compte qui existe
   * depuis toujours. Les deux appels n'ont rien à attendre l'un de l'autre.
   *
   * On attend la sonde juste APRÈS : l'écran du compte doit peindre avec le
   * verdict certain (c'était le défaut d'origine de ce `await`), seulement
   * sans payer deux réveils l'un après l'autre.
   */
  const sante = sonderServeur()
  let jetonRefuse = false

  if (jeton) {
    try {
      profil = await appel('/api/profil')
      retenirIdentite()
    } catch (e: any) {
      // 401 = jeton périmé ou révoqué : on repart d'un compte neuf. Toute autre
      // panne (serveur éteint) n'est PAS une raison de jeter le jeton — il
      // resservira au prochain lancement, et à la prochaine reprise.
      jetonRefuse = e?.statut === 401
      if (jetonRefuse) jeton = null
    }
  }

  await sante

  if (profil) return profil
  // Jeton gardé mais serveur injoignable : on ne crée surtout PAS un compte
  // anonyme par-dessus — ce serait jeter un portefeuille pour un coup de wifi.
  if (jeton && !jetonRefuse) return null
  /*
   * ⚠️ LE SERVEUR A DIT QUE SES COMPTES NE MARCHAIENT PAS : ON NE TENTE RIEN.
   *
   * Lui demander un compte anonyme coûterait 8 secondes de délai pour un
   * échec certain — il vient de le dire lui-même, une seconde plus tôt. On
   * attend la reprise : la veille re-sonde, et quand `/sante` repasse au vert
   * elle rappelle ce module, qui retente tout seul.
   *
   * C'est ce qui fait passer un premier lancement sans réseau de 12 secondes
   * à 4 : le seul appel qui reste est la sonde.
   */
  if (comptesCasses()) return null

  if (!(await creerCompteAnonyme())) return null
  try {
    profil = await appel('/api/profil')
    retenirIdentite()
  } catch {
    profil = null
  }
  return profil
}

/**
 * ————— Se connecter avec Google —————
 *
 * On ne quitte PAS le jeu vers Google directement : on passe par le relais du
 * serveur (`/api/relais`), qui seul saura récupérer le jeton après l'aller-retour
 * — cf. le commentaire détaillé dans server/src/index.ts.
 *
 * Si le joueur était anonyme, Better Auth fusionne son ancien compte dans le
 * nouveau : ses Mon et ses achats le suivent.
 */
export async function connexionGoogle(): Promise<{ ok: boolean; raison?: string }> {
  /*
   * ⚠️ On NAVIGUE, on n'appelle pas.
   *
   * Lancer la connexion par un `fetch` semblait plus propre, mais échouait au
   * retour sur « state_mismatch » : Better Auth dépose un jeton anti-falsification
   * dans un COOKIE au départ, et une réponse venue d'un autre domaine ne permet
   * pas au navigateur de le garder. Au retour, il n'y avait rien à comparer.
   *
   * En envoyant le navigateur directement sur le serveur, le cookie est posé en
   * première partie — comme pour n'importe quel site où l'on se connecte.
   *
   * Le jeton anonyme voyage en paramètre : le serveur s'en sert pour savoir
   * quel compte fusionner. (Il ne s'agit pas d'un secret durable et il ne
   * quitte pas nos domaines, mais c'est bien pour cela que le relais vérifie
   * strictement sa destination.)
   */
  try {
    /*
     * On part par un FORMULAIRE plutôt qu'un simple lien : l'envoi d'un
     * formulaire est lui aussi une navigation de premier niveau (le cookie sera
     * donc bien posé), mais le jeton voyage dans le CORPS de la requête.
     *
     * Dans l'adresse, il finirait dans l'historique du navigateur et dans les
     * journaux du serveur — pour un jeton de session, c'est exactement ce qu'on
     * évite.
     */
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = `${API}/api/connexion-google`
    form.style.display = 'none'

    const champ = (nom: string, valeur: string) => {
      const i = document.createElement('input')
      i.type = 'hidden'
      i.name = nom
      i.value = valeur
      form.appendChild(i)
    }
    champ('vers', location.origin + location.pathname)
    // Le jeton anonyme : il dit au serveur quel compte fusionner dans le nouveau
    if (jeton) champ('jeton', jeton)

    document.body.appendChild(form)
    form.submit()
    return { ok: true }
  } catch {
    return { ok: false, raison: 'hors-ligne' }
  }
}

/**
 * ————— S'inscrire ou se connecter par email —————
 *
 * Pour qui n'a pas de compte Google — ou n'en veut pas.
 *
 * Contrairement à Google, tout se joue en UN appel : pas de redirection, donc
 * le serveur nous rend directement le jeton dans sa réponse. C'est le même
 * chemin que le compte anonyme.
 *
 * Si le joueur était anonyme, Better Auth fusionne son ancien compte dans le
 * nouveau (cf. `onLinkAccount`) : ses Mon et ses achats le suivent.
 */
async function authEmail(
  route: 'sign-up/email' | 'sign-in/email',
  corps: Record<string, unknown>
): Promise<{ ok: boolean; raison?: string }> {
  try {
    const r = await fetch(`${API}/api/auth/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Le jeton anonyme courant : il dit à Better Auth quel compte reprendre
        ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
      },
      body: JSON.stringify(corps),
      // Mutation (création ou ouverture de session) : 8 s.
      signal: AbortSignal.timeout(DELAI_MUTATION),
    })
    const data = await r.json().catch(() => null)

    if (!r.ok || !data?.token) {
      /*
       * On remonte le CODE en priorité, pas le message.
       *
       * Le code est stable et fait pour être lu par du code
       * (« USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL ») ; le message, lui, est de
       * la prose anglaise qui peut changer d'une version à l'autre. Traduire
       * sur le message, c'est afficher de l'anglais au premier reformulage.
       */
      return { ok: false, raison: data?.code ?? data?.message ?? 'echec' }
    }

    jeton = data.token
    try {
      localStorage.setItem(CLE_JETON, data.token)
    } catch {
      /* navigation privée */
    }
    profil = await appel('/api/profil')
    retenirIdentite()
    return { ok: true }
  } catch {
    return { ok: false, raison: 'hors-ligne' }
  }
}

/** Crée un compte avec un email et un mot de passe. */
export function inscriptionEmail(email: string, motDePasse: string, pseudo: string) {
  // `name` est demandé par Better Auth ; on y met le pseudo du joueur, ce qui
  // évite un champ de plus à remplir.
  return authEmail('sign-up/email', { email, password: motDePasse, name: pseudo || 'Guerrier' })
}

/** Retrouve un compte existant. */
export function connexionEmail(email: string, motDePasse: string) {
  return authEmail('sign-in/email', { email, password: motDePasse })
}

/**
 * Se déconnecte : on oublie le jeton et on repart sur un compte anonyme neuf.
 *
 * ⚠️ Les Mon restent attachés au compte QUITTÉ, pas à l'appareil. Se
 * déconnecter d'un compte anonyme revient donc à l'abandonner pour de bon —
 * c'est au jeu de prévenir avant.
 */
export async function deconnecter(): Promise<void> {
  try {
    await appel('/api/auth/sign-out', {})
  } catch {
    /* même si le serveur ne répond pas, on oublie le jeton localement */
  }
  jeton = null
  profil = null
  articles = []
  anonyme = true
  email = null
  try {
    localStorage.removeItem(CLE_JETON)
    /*
     * ⚠️ LE CATALOGUE AUSSI, ET C'EST VOULU.
     *
     * Il porte `possede` : un article marqué « acquis » par le compte QUITTÉ
     * serait affiché comme acquis au compte suivant, jusqu'à ce que le serveur
     * le corrige. Vider le cache coûte une fraction de seconde de bandeau
     * « indisponible » ; le laisser mentir coûterait la confiance du joueur.
     */
    localStorage.removeItem(CLE_BOUTIQUE)
  } catch {
    /* rien à faire */
  }
}

/** Relit le solde (après une course, par exemple). */
export async function rafraichirProfil(): Promise<Profil | null> {
  if (!jeton) return null
  try {
    profil = await appel('/api/profil')
    retenirIdentite()
  } catch {
    // On garde l'ancien solde à l'écran plutôt que d'afficher un vide anxiogène
  }
  return profil
}

/** Une ligne du classement, telle que le serveur la sert. */
export interface LigneClassement {
  pseudo: string
  temps_ms: number
  fighter: string
  partants: number
  rang: number
  /** 🌍 D'où se déclare le coureur — déclaratif, cf. migration 005. */
  pays?: string
  /** 🏞️ Son département / région / ville, déclaratif lui aussi. */
  region?: string
  cree_le: string
  moi?: boolean
}

/**
 * 🏆 Lit un onglet du classement. `null` quand il n'y a pas de compte ou que le
 * serveur ne répond pas — l'écran distingue alors « vide » de « indisponible ».
 */
export async function lireClassement(
  onglet: 'mondial' | 'recentes',
  longueur: number
): Promise<LigneClassement[] | null> {
  if (!jeton) return null
  try {
    const r = await appel(`/api/classement?onglet=${onglet}&longueur=${longueur}`)
    return Array.isArray(r?.lignes) ? r.lignes : []
  } catch {
    return null
  }
}

/**
 * 🟢 Verse les Mon d'une course : ce qu'on a tiré des pots verts.
 *
 * On envoie le TOTAL de la course, une seule fois à l'arrivée, et non un appel
 * par pot : deux requêtes coup sur coup se feraient refuser par le délai côté
 * serveur, et la seconde poterie ne rapporterait rien.
 *
 * Sans compte (hors-ligne, base éteinte), on ne tente rien et on ne signale
 * rien : les pots restent un plaisir de course, ils ne doivent pas devenir un
 * message d'erreur.
 */
export async function verserPots(recolte: {
  mon: number
  hisui: number
}): Promise<{ profil: Profil | null; verse: boolean }> {
  if (!jeton || (recolte.mon <= 0 && recolte.hisui <= 0)) {
    return { profil: null, verse: false }
  }
  try {
    const r = await appel('/api/pot', recolte)
    profil = r.profil
    return { profil, verse: true }
  } catch {
    /*
     * Serveur muet, sans compte, ou versement trop rapproché (le serveur n'en
     * accepte qu'un par minute).
     *
     * ⚠️ ON DIT MAINTENANT QUE ÇA A ÉCHOUÉ, au lieu de faire comme si de rien
     * n'était. En course ordinaire, un versement raté ne coûtait qu'une récolte
     * de fin de partie ; en course SANS FIN on verse à chaque tronçon, et une
     * carte bouclée un peu vite tombe sous le délai. L'appelant peut alors
     * REMETTRE la récolte de côté pour le tronçon suivant, au lieu de la jeter.
     */
    return { profil, verse: false }
  }
}

/*
 * ————— Le catalogue gardé sur l'appareil —————
 *
 * ⚠️ IL NE CONTIENT QUE LES ARTICLES. JAMAIS LE SOLDE.
 *
 * Le solde est un reflet de la base et lui seul compte : un chiffre conservé
 * mentirait au joueur qui vient de dépenser ailleurs, et le jeu a déjà toute
 * une règle écrite sur ce sujet (cf. l'en-tête de ce fichier). Le catalogue,
 * lui, ne bouge presque jamais — une liste de couleurs et de prix, relue à
 * chaque ouverture.
 *
 * Ce cache sert à UNE chose : que la boutique s'ouvre AU MOMENT DU CLIC, et
 * non à la fin d'un aller-retour réseau. Le serveur reprend la main juste
 * après ; et c'est LUI qui décide des prix et des achats — un article périmé
 * ne peut donc pas faire acheter, puisque `acheter` n'envoie que le CODE.
 */
let catalogueDuCache = false

/** Le catalogue affiché vient-il du cache local plutôt que du serveur ? */
export function boutiqueDuCache() {
  return catalogueDuCache
}

function garderCatalogue() {
  try {
    localStorage.setItem(CLE_BOUTIQUE, JSON.stringify(articles))
  } catch {
    /* navigation privée : on fera sans */
  }
}

function lireCatalogueLocal(): Article[] {
  try {
    const brut = localStorage.getItem(CLE_BOUTIQUE)
    const l = brut ? JSON.parse(brut) : null
    // On ne garde que ce qui ressemble à un article : un cache corrompu ne
    // doit pas faire planter l'écran de la boutique.
    return Array.isArray(l) ? l.filter((a: any) => a && typeof a.code === 'string') : []
  } catch {
    return []
  }
}

/**
 * Ouvre la boutique : le catalogue ET le solde, d'un seul appel.
 *
 * ⚠️ `null` ET `[]` NE VEULENT PAS DIRE LA MÊME CHOSE.
 *
 * La boutique renvoyait `[]` dans les deux cas, et l'écran ne pouvait donc pas
 * les distinguer : hors-ligne, serveur éteint ou base en panne affichaient
 * « La boutique est fermée pour l'instant », exactement comme un rayon
 * volontairement vide. Le joueur en concluait qu'il n'y avait rien à acheter —
 * et il avait tort, puisque tout le catalogue était là, sur le serveur, à
 * quelques mètres.
 *
 * Le classement distingue déjà les deux depuis le début (`lireClassement` rend
 * `null` pour « indisponible ») ; la boutique est le seul endroit qui ne le
 * faisait pas. C'est le même arbitrage, et il ne peut pas y en avoir deux
 * versions : un joueur qui lit « fermée » pour un rayon vide et « indisponible »
 * pour une panne ne sait plus à quoi se fier.
 *
 *  · `null` → indisponible : pas de compte, ou le serveur n'a pas répondu.
 *  · `[]`   → le catalogue est RÉELLEMENT vide. Ça n'arrive presque jamais.
 */
export async function chargerBoutique(): Promise<Article[] | null> {
  // Pas de compte : ce n'est pas une boutique vide, c'est une boutique absente.
  if (!jeton) return null

  /*
   * Premier appel de la session : on ouvre avec le catalogue conservé, pour
   * que la boutique s'affiche tout de suite. Le serveur confirme ou corrige
   * juste après — et si le serveur répond, `catalogueDuCache` repasse à faux.
   */
  catalogueDuCache = false
  if (articles.length === 0) articles = lireCatalogueLocal()

  try {
    const r = await appel('/api/boutique')
    profil = r.profil
    if (Array.isArray(r.articles)) articles = r.articles
    garderCatalogue()
  } catch {
    /*
     * ⚠️ ON GARDE LE CATALOGUE PRÉCÉDENT, ET C'EST LE SEUL CAS OÙ IL COMPTE.
     *
     * Une coupure réseau au milieu de la visite ne doit pas effacer ce qu'on
     * affichait une seconde plus tôt : le joueur verrait le rayon se vider
     * sous ses yeux. Mais si l'on n'a JAMAIS rien chargé — ni réseau, ni
     * cache — il n'y a rien à garder, et rendre `[]` dirait « rayon vide »,
     * ce qui est le mensonge qu'on est en train de supprimer.
     */
    catalogueDuCache = articles.length > 0
    return catalogueDuCache ? articles : null
  }
  return articles
}

/**
 * Achète un article. On n'envoie QUE son code — le prix, la monnaie et le solde
 * sont l'affaire du serveur, qui les relit dans la base.
 *
 * Renvoie le motif du refus, que la boutique traduit en message lisible.
 */
export async function acheter(
  code: string
): Promise<{ ok: true } | { ok: false; raison: string }> {
  if (!jeton) return { ok: false, raison: 'hors-ligne' }
  try {
    const r = await appel('/api/acheter', { code })
    profil = r.profil
    if (Array.isArray(r.articles)) articles = r.articles
    // Le serveur vient de nous dire ce qu'on possède : le cache suit, sinon
    // la prochaine ouverture hors-ligne remontrerait l'article comme absent.
    catalogueDuCache = false
    garderCatalogue()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, raison: e?.message ?? 'erreur' }
  }
}
