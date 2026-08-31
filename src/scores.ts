/**
 * ————— Le tableau des meilleurs temps —————
 *
 * Dix lignes, gardées sur l'appareil. Pas de serveur : un classement en ligne
 * demanderait des comptes, et surtout une défense contre les temps trafiqués —
 * or le chrono est calculé par le CLIENT. Un tableau local ne prétend rien
 * d'autre que ce qu'il est : ta progression à toi.
 *
 * ⚠️ La clé porte la LONGUEUR de la course, comme le record simple. Un tableau
 * qui mélangerait des courses de 600 m et de 1 920 m classerait les plus
 * courtes en tête à jamais, et les temps n'y voudraient plus rien dire.
 */

export interface Score {
  /** Le chrono, en secondes */
  temps: number
  nom: string
  /** L'identifiant du guerrier (cf. roster.ts) — jamais son nom affiché */
  fighter: string
  mode: 'solo' | 'ligne'
  /** Le nombre d'adversaires : un temps seul et un temps à 4 ne se valent pas */
  rivaux: number
  /** Date en ms epoch */
  date: number
  /**
   * 🌍 Le pays porté CE JOUR-LÀ (code ISO, `''` si aucun).
   *
   * Figé avec le temps, et non relu du réglage courant : changer de pays ne
   * doit pas réécrire l'histoire de ses courses passées. Absent d'une vieille
   * sauvegarde — d'où l'optionnel.
   */
  pays?: string
  /**
   * 🏞️ La subdivision portée ce jour-là (département, région ou ville selon le
   * pays), `''` si aucune.
   *
   * ⚠️ Figée avec le temps, comme le pays. Et ABSENTE des scores enregistrés
   * avant son existence : un filtre par département ne peut donc pas les
   * montrer, et c'est normal — on ne va pas leur inventer une origine.
   */
  region?: string
}

/** On n'en garde que dix : au-delà, plus personne ne lit. */
export const MAX_SCORES = 10

const cle = (longueur: number) => `kurogane-scores-${longueur}`

/**
 * Relit le tableau. Tout est revalidé ligne par ligne, sans confiance :
 * localStorage est modifiable à la main, et surtout il SURVIT aux mises à jour.
 * Un tableau écrit par une version précédente doit se dégrader proprement, pas
 * faire planter l'écran des scores.
 */
export function chargerScores(longueur: number): Score[] {
  let brut: unknown
  try {
    brut = JSON.parse(localStorage.getItem(cle(longueur)) ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(brut)) return []

  const scores: Score[] = []
  for (const s of brut) {
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    const temps = Number(o.temps)
    // Un temps non fini ou négatif casserait le tri ET l'affichage
    if (!Number.isFinite(temps) || temps <= 0) continue
    scores.push({
      temps,
      nom: typeof o.nom === 'string' ? o.nom.slice(0, 12) : 'Guerrier anonyme',
      fighter: typeof o.fighter === 'string' ? o.fighter : 'yasuke',
      mode: o.mode === 'ligne' ? 'ligne' : 'solo',
      rivaux: Number.isFinite(Number(o.rivaux)) ? Math.max(0, Math.floor(Number(o.rivaux))) : 0,
      date: Number.isFinite(Number(o.date)) ? Number(o.date) : 0,
      /*
       * ⚠️ CES DEUX-LÀ N'ÉTAIENT PAS RELUS. Le pays était bien ÉCRIT avec chaque
       * temps, mais cette reconstruction l'oubliait — si bien que le drapeau
       * s'affichait juste après la course, puis disparaissait au redémarrage.
       * Le défaut ne se voyait qu'en relançant le jeu, jamais en jouant.
       */
      pays: typeof o.pays === 'string' ? o.pays : undefined,
      region: typeof o.region === 'string' ? o.region : undefined,
    })
  }
  // On retrie à la lecture plutôt que de faire confiance à l'ordre stocké.
  scores.sort((a, b) => a.temps - b.temps)
  return scores.slice(0, MAX_SCORES)
}

/**
 * Ajoute un temps et renvoie le tableau à jour, plus le RANG obtenu (1 = 1re
 * place, 0 = pas entré dans les dix). Le rang sert à féliciter le joueur sur
 * l'écran de fin : « 3ᵉ meilleur temps » se lit mieux qu'un tableau muet.
 */
export function ajouterScore(
  longueur: number,
  s: Score
): { scores: Score[]; rang: number } {
  const scores = chargerScores(longueur)
  scores.push(s)
  scores.sort((a, b) => a.temps - b.temps)
  const rang = scores.indexOf(s) + 1
  const gardes = scores.slice(0, MAX_SCORES)
  try {
    localStorage.setItem(cle(longueur), JSON.stringify(gardes))
  } catch {
    // Mode privé, quota plein : on ne garde rien, mais la course reste jouable.
  }
  return { scores: gardes, rang: rang <= MAX_SCORES ? rang : 0 }
}

/**
 * ————— ♾️ Les distances de la course sans fin —————
 *
 * ⚠️ UN TABLEAU À PART, ET C'EST OBLIGATOIRE. Une course se mesure en secondes
 * et le PLUS PETIT gagne ; l'infini se mesure en mètres et c'est le PLUS GRAND.
 * Les mêler dans une seule table ne demanderait pas seulement une colonne de
 * plus : il faudrait trier dans deux sens à la fois. Deux tables, deux tris,
 * aucune ambiguïté.
 *
 * Pas de longueur dans la clé, contrairement aux chronos : une course sans fin
 * n'en a pas.
 */
export interface ScoreInfini {
  /** La distance atteinte, en mètres */
  metres: number
  nom: string
  /** L'identifiant du guerrier (cf. roster.ts) */
  fighter: string
  /** Date en ms epoch */
  date: number
  /** 🌍 Le pays porté CE JOUR-LÀ (code ISO, `''` si aucun) */
  pays?: string
  /**
   * 🏞️ La subdivision portée ce jour-là (département, région ou ville selon le
   * pays), `''` si aucune.
   *
   * ⚠️ Figée avec le temps, comme le pays. Et ABSENTE des scores enregistrés
   * avant son existence : un filtre par département ne peut donc pas les
   * montrer, et c'est normal — on ne va pas leur inventer une origine.
   */
  region?: string
}

const CLE_INFINI = 'kurogane-infini-scores'

/**
 * Combien de courses le JOURNAL retient.
 *
 * Plus que les dix du classement : l'écran de fin a besoin des dernières
 * courses, y compris les mauvaises, et une mauvaise course sort du classement
 * sans sortir de l'histoire.
 */
const MAX_JOURNAL = 30

/** Relit les distances. Tout est revalidé, comme pour les chronos. */
export function chargerInfini(): ScoreInfini[] {
  let brut: unknown
  try {
    brut = JSON.parse(localStorage.getItem(CLE_INFINI) ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(brut)) return []

  const scores: ScoreInfini[] = []
  for (const s of brut) {
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    const metres = Number(o.metres)
    if (!Number.isFinite(metres) || metres < 0) continue
    scores.push({
      metres: Math.floor(metres),
      nom: typeof o.nom === 'string' ? o.nom.slice(0, 12) : 'Guerrier anonyme',
      fighter: typeof o.fighter === 'string' ? o.fighter : 'yasuke',
      date: Number.isFinite(Number(o.date)) ? Number(o.date) : 0,
      pays: typeof o.pays === 'string' ? o.pays : undefined,
      region: typeof o.region === 'string' ? o.region : undefined,
    })
  }
  /*
   * ⚠️ ON GARDE L'ORDRE CHRONOLOGIQUE, la plus récente en tête.
   *
   * Le tableau était trié par distance et coupé aux dix meilleures — et l'écran
   * de fin, qui montre « les deux courses d'avant », se retrouvait alors à
   * montrer des courses vieilles de plusieurs jours dès qu'on enchaînait
   * quelques parties moyennes. Pire : une mauvaise course disparaissait aussitôt
   * du journal, donc de « l'avant ».
   *
   * On garde donc le JOURNAL, et c'est `meilleuresInfini` qui trie quand il
   * s'agit de classer. Deux questions différentes, deux lectures.
   */
  scores.sort((a, b) => b.date - a.date)
  return scores.slice(0, MAX_JOURNAL)
}

/**
 * Le classement : les plus longues d'abord.
 *
 * ⚠️ Décroissant, contrairement aux chronos — ici, le plus loin gagne.
 */
export function meilleuresInfini(): ScoreInfini[] {
  return [...chargerInfini()].sort((a, b) => b.metres - a.metres).slice(0, MAX_SCORES)
}

/**
 * Ajoute une distance. Rend le journal à jour, le RANG au classement
 * (1 = meilleure de tous les temps, 0 = pas dans les dix), et ce qu'il fallait
 * pour l'écran de fin : le record d'AVANT et les deux courses précédentes.
 */
export function ajouterInfini(s: ScoreInfini): {
  journal: ScoreInfini[]
  rang: number
  /** Le meilleur AVANT cette course — ce qu'il y avait à battre. */
  recordAvant: number
  /** Les deux courses juste avant celle-ci, de la plus récente à la plus vieille. */
  precedentes: ScoreInfini[]
} {
  const avant = chargerInfini()
  const recordAvant = avant.reduce((m, x) => Math.max(m, x.metres), 0)
  const precedentes = avant.slice(0, 2)

  const journal = [s, ...avant].slice(0, MAX_JOURNAL)
  try {
    localStorage.setItem(CLE_INFINI, JSON.stringify(journal))
  } catch {
    // Mode privé, quota plein : on ne garde rien, la course reste jouable.
  }

  const classe = [...journal].sort((a, b) => b.metres - a.metres)
  const rang = classe.indexOf(s) + 1
  return { journal, rang: rang <= MAX_SCORES ? rang : 0, recordAvant, precedentes }
}

/*
 * ⚠️ `effacerScores` a été RETIRÉ avec son bouton.
 *
 * L'écran des scores proposait « 🗑️ Effacer » ; la place sert désormais à
 * CHERCHER un pseudo, ce qui est la vraie demande d'un classement — au-delà de
 * la première page, on ne peut plus se trouver soi-même ni suivre un camarade.
 *
 * On ne garde pas la fonction « au cas où » : une fonction que plus rien
 * n'appelle ne se teste plus, et c'est celle-là qu'on rebranche par erreur.
 */

/** « 75.07 » → « 1:15.07 » dès qu'on dépasse la minute. */
export function formaterTemps(t: number): string {
  if (t < 60) return `${t.toFixed(2)} s`
  const m = Math.floor(t / 60)
  const s = (t - m * 60).toFixed(2).padStart(5, '0')
  return `${m}:${s}`
}
