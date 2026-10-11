/**
 * ————— Les comptes reviennent tout seuls —————
 *
 * CE BANC NE TESTE PAS LE SERVEUR. Il teste le client face a un serveur qui
 * dort, qui se reveille, et qui ne repond pas.
 *
 * C'est la panne reelle de production, mesuree un soir de septembre :
 *
 *   GET https://kurogane-production.up.railway.app/sante
 *   {"ok":true,"base":true,"saine":false,"raison":"ENOTFOUND",...}
 *
 * Le service était en SOMMEIL. Le premier appel le réveille en 3,4 s, et
 * pendant cette fenêtre il répond AVANT que sa base soit joignable. Le
 * serveur se soigne tout seul en moins d'une minute — c'est sa façon normale
 * de fonctionner.
 *
 * Ce qui ne marchait pas, c'était le CLIENT :
 *
 *   1. aucun délai sur les appels — chaque tentative coûtait les 10 s de
 *      `connectionTimeoutMillis` du serveur ;
 *   2. une SEULE sonde, au lancement — « injoignable » était écrit pour
 *      toute la session, même quand le serveur était revenu ;
 *   3. `connecter()` renonçait définitivement ;
 *   4. le catalogue n'était pas gardé — la boutique disait « indisponible »
 *      au lieu de s'ouvrir.
 *
 *   npm run serveur:test
 */

/* Rien de tout ça n'existe dans Node : faux `location`, faux `localStorage`. */
;(globalThis as any).location = {
  protocol: 'http:',
  hostname: 'localhost',
  origin: 'http://localhost',
  pathname: '/',
  search: '',
  hash: '',
}
;(globalThis as any).history = { replaceState() {} }

/* Un vrai magasin, pour qu'on puisse inspecter ce qui y est rangé. */
const sac = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => (sac.has(k) ? sac.get(k)! : null),
  setItem: (k: string, v: string) => void sac.set(k, v),
  removeItem: (k: string) => void sac.delete(k),
}

/* ————— Le faux serveur ————— */
/*
 * Trois interrupteurs : `sain` (ce que `/sante` raconte), `muet` (on ne
 * répond jamais, comme un réseau coupé) et `refuse` (on répond 401 à tout,
 * comme un jeton révoqué).
 */
const faux = {
  sain: false,
  muet: false,
  refuse: false,
  appels: [] as string[],
  reset() {
    this.appels = []
  },
}

const CATALOGUE = [
  {
    code: 'carmin',
    nom: 'Carmin du maître',
    categorie: 'couleur',
    prix_mon: 50,
    prix_hisui: null,
    valeur: '#ff2200',
    possede: false,
  },
]

function repondre(donnees: unknown, statut = 200) {
  return {
    ok: statut >= 200 && statut < 300,
    status: statut,
    json: async () => donnees,
  }
}

;(globalThis as any).fetch = async (url: unknown, opts: any = {}) => {
  const u = String(url)
  faux.appels.push(u)
  const route = u.replace(/^https?:\/\/[^/]+/, '')

  if (faux.muet) {
    /*
     * On ne répond JAMAIS — mais on doit deux choses.
     *
     * D'abord, écouter le signal d'abandon : sinon le délai du client ne
     * servirait à rien et le banc mentirait.
     *
     * Puis laisser un VRAI timer en vie. `AbortSignal.timeout` de Node ne
     * garde pas la boucle d'événements allumée : sans ce `setTimeout`, le
     * processus se termine avant que le signal ne se déclenche, et Node
     * rend un « unsettled top-level await » au lieu d'un résultat. C'est un
     * artefact de Node, pas un défaut du jeu — le navigateur, lui, ne
     * s'endort jamais.
     */
    await new Promise((_resolve, reject) => {
      const e = new Error('TimeoutError')
      e.name = 'TimeoutError'
      const garde = setTimeout(() => reject(e), 120_000)
      opts.signal?.addEventListener?.('abort', () => {
        clearTimeout(garde)
        reject(e)
      })
    })
  }

  if (route === '/sante') {
    return repondre({
      ok: true,
      base: true,
      saine: faux.sain,
      raison: faux.sain ? undefined : 'ENOTFOUND',
      comptes: true,
      google: true,
    })
  }

  if (faux.refuse) return repondre({ erreur: 'jeton invalide' }, 401)

  if (route === '/api/auth/sign-in/anonymous') {
    return repondre({ token: 'jeton-de-test' })
  }

  if (route === '/api/profil') {
    const auth = opts?.headers?.authorization
    if (!auth) return repondre({ erreur: 'jeton manquant' }, 401)
    return repondre({
      joueur: 'j1',
      pseudo: 'Banc',
      mon: 120,
      hisui: 3,
      guerrier: 'ronin',
      anonyme: true,
    })
  }

  if (route === '/api/boutique') {
    return repondre({
      profil: {
        joueur: 'j1',
        pseudo: 'Banc',
        mon: 120,
        hisui: 3,
        guerrier: 'ronin',
        anonyme: true,
      },
      articles: CATALOGUE,
    })
  }

  if (route === '/api/acheter') {
    return repondre({
      profil: {
        joueur: 'j1',
        pseudo: 'Banc',
        mon: 70,
        hisui: 3,
        guerrier: 'ronin',
        anonyme: true,
      },
      articles: CATALOGUE.map((a) => ({ ...a, possede: true })),
    })
  }

  return repondre({ erreur: 'route inconnue' }, 404)
}

/* ————— Le banc ————— */
let echecs = 0
function verifier(titre: string, bon: boolean, detail = '') {
  if (!bon) echecs++
  console.log(`  ${bon ? 'ok  ' : 'ECHEC'} ${titre}${detail ? '  → ' + detail : ''}`)
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/*
 * Chaque phase importe un module NEUF : compte.ts garde son etat (jeton,
 * catalogue, veille) dans le module, et deux phases qui se partageraient le
 * meme se continueraient l'une l'autre. La chaine "?v=n" triche sur le cache
 * d'ESM de Node, sans toucher au fichier.
 *
 * L'adresse passe par une variable, pas par un import en ligne : un import
 * dynamique dont l'argument est une expression interpolee rend un
 * "ReferenceError: n is not defined" sous Node 24.
 */
const BASE_COMPTES = new URL('../src/compte.ts', import.meta.url).href
let suivant = 0
async function nouveauCompte() {
  suivant++
  const url = BASE_COMPTES + '?v=' + suivant
  return await import(url)
}

console.log('\n————— 📡 Un premier lancement sans réseau —————\n')
{
  faux.sain = false
  faux.muet = true
  faux.refuse = false
  faux.reset()
  const c = await nouveauCompte()

  const t0 = performance.now()
  const p = await c.connecter()
  const delai = performance.now() - t0

  verifier('connecter() rend la main vite', delai < 5_000, `${Math.round(delai)} ms`)
  verifier('connecter() ne lève pas', p === null, 'null, sans exception')
  verifier('le compte est déclaré cassé', c.comptesCasses() === true)
}

console.log('\n————— 🔄 La veille re-sonde, et prévient —————\n')
{
  /*
   * On repart du module de tout à l'heure ? Non : on en prend un neuf, mais
   * on reproduit exactement le même scénario, puis on rend la main au
   * serveur. C'est le moment qui compte : le joueur est au menu, il n'a
   * rien cliqué, et le serveur revient.
   */
  faux.sain = false
  faux.muet = false
  faux.refuse = false
  faux.reset()
  const c = await nouveauCompte()

  await c.connecter()
  verifier('au départ, les comptes sont cassés', c.comptesCasses() === true)

  const santeAvant = faux.appels.filter((a) => a.endsWith('/sante')).length

  let revele = false
  c.surRepriseDuServeur(() => {
    revele = true
  })

  // Le serveur revient. Personne ne le signale : c'est la veille qui doit
  // s'en apercevoir toute seule.
  faux.sain = true

  const t0 = performance.now()
  while (!revele && performance.now() - t0 < 20_000) await dormir(200)
  const delai = performance.now() - t0

  const santeApres = faux.appels.filter((a) => a.endsWith('/sante')).length
  verifier('la veille a re-sondé', santeApres > santeAvant, `${santeApres - santeAvant} sonde(s) en plus`)
  verifier('le retour est signalé sans rechargement', revele, `après ${Math.round(delai)} ms`)
  verifier('les comptes sont réparés', c.comptesCasses() === false)

  /*
   * Et c'est le vrai test : le jeu, de son côté, profite de ce rappel pour
   * reprendre le compte et le catalogue. On refait exactement ce que fait
   * `main.ts` dans `surRepriseDuServeur`.
   */
  faux.muet = false
  const profil = await c.connecter()
  const articles = await c.chargerBoutique()
  verifier('le compte revient', profil !== null && profil.mon === 120, `mon=${profil?.mon}`)
  verifier('la boutique se remplit', articles !== null && articles.length === 1, `${articles?.length} article(s)`)
  verifier(
    'le catalogue vient bien du serveur',
    c.boutiqueDuCache() === false,
    'boutiqueDuCache() === false'
  )
}

console.log('\n————— 🛍️ La boutique s\'ouvre depuis l\'appareil —————\n')
{
  // Phase 1 : un serveur sain, pour remplir le cache une première fois.
  faux.sain = true
  faux.muet = false
  faux.refuse = false
  faux.reset()
  {
    const c = await nouveauCompte()
    await c.connecter()
    await c.chargerBoutique()
  }
  const rangé = sac.get('kurogane-boutique')
  verifier('le catalogue est bien conservé', typeof rangé === 'string' && rangé.length > 0)

  // Phase 2 : un autre appareil, un autre lancement — et le serveur dort.
  faux.sain = false
  faux.muet = true
  const c = await nouveauCompte()
  await c.connecter()
  const t0 = performance.now()
  const articles = await c.chargerBoutique()
  const delai = performance.now() - t0

  verifier('la boutique s\'ouvre quand même', articles !== null && articles.length === 1)
  verifier('et elle s\'ouvre vite', delai < 6_000, `${Math.round(delai)} ms`)
  verifier(
    'l\'écran sait que ça vient de l\'appareil',
    c.boutiqueDuCache() === true,
    'boutiqueDuCache() === true'
  )
  verifier('le solde reste honnête', c.monProfil() === null, 'pas de faux chiffre')
}

console.log('\n————— 🔒 Le solde n\'entre jamais dans le cache —————\n')
{
  const brut = sac.get('kurogane-boutique') ?? '[]'
  let l: any[] = []
  try {
    l = JSON.parse(brut)
  } catch {
    /* on le signale juste en dessous */
  }
  verifier('le cache est un tableau d\'articles', Array.isArray(l) && l.length > 0, `${l.length} ligne(s)`)
  verifier('chaque ligne a son code', l.every((a) => typeof a?.code === 'string'))
  /*
   * `prix_mon` contient « mon » : on cherche donc la CLÉ entière, guillemets
   * et deux-points compris. Un `"mon":` là-dedans voudrait dire qu'on a mis
   * le SOLDE dans le cache — c'est exactement ce qu'on refuse, puisque le
   * solde est un reflet de la base et que le cache mentirait au joueur qui
   * vient de dépenser ailleurs.
   */
  verifier('aucun solde de profil', !/"mon":/.test(brut) && !/"hisui":/.test(brut))
}

console.log('\n————— 🔑 Un 401 jette le jeton, une panne non —————\n')
{
  faux.sain = true
  faux.muet = false
  faux.refuse = false
  faux.reset()
  {
    const c = await nouveauCompte()
    await c.connecter()
    verifier('un jeton est bien posé', sac.has('kurogane-jeton'))
  }

  // Une panne : le jeton doit SURVIVRE, il resservira.
  faux.sain = false
  faux.muet = true
  {
    const c = await nouveauCompte()
    await c.connecter()
    verifier('une panne ne jette pas le jeton', sac.has('kurogane-jeton'))
  }

  // Un vrai refus : le jeton est périmé, on l'oublie — en mémoire, du moins.
  // On ne le SUPPRIME PAS du magasin : si la création du compte anonyme qui
  // suit échoue à son tour, le joueur n'aurait plus AUCUN jeton, alors que
  // celui-là reste peut-être bon. Un jeton qu'on ne montre plus ne coûte rien.
  faux.sain = true
  faux.muet = false
  faux.refuse = true
  {
    const c = await nouveauCompte()
    await c.connecter()
    verifier('un 401 oublie le jeton', c.monJeton() === null)
  }
}

console.log(echecs === 0 ? '\nTout est bon.\n' : `\n${echecs} verification(s) en echec.\n`)
process.exit(echecs === 0 ? 0 : 1)
