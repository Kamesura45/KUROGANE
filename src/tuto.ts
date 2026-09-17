/**
 * ————— 🎓 LE TUTORIEL, ÉCRIT COMME UNE PARTITION —————
 *
 * Tout ce fichier est de la DONNÉE. Pas une ligne ne décide quand geler, quand
 * relâcher ni quoi afficher : main.ts lit cette partition et l'exécute. La
 * raison est simple — un tutoriel se retouche cent fois (« cette phrase est
 * trop longue », « l'obstacle arrive trop tôt »), et chaque retouche doit être
 * une valeur changée, jamais une condition de plus dans la boucle de jeu.
 *
 * ————— La forme, en deux temps —————
 *
 *  1. ❄️ SUR LA NEIGE (Flancs du Fuji, 雪). La piste est NUE : rien qu'on n'ait
 *     posé soi-même. On explique le départ, puis chaque chose arrive SEULE —
 *     l'écran se fige devant, le geste s'affiche, et il repart quand on l'a
 *     fait. On finit par les SORTS : on en lance un sur soi, un rival entre en
 *     scène pour en recevoir un, il répond, et l'on se soigne.
 *
 *  2. 🌉 SUR LE PONT (Pont au clair de lune). Plus d'explications : une vraie
 *     course d'entraînement contre deux rivaux.
 *
 * ⚠️ Le décor change EXPRÈS entre les deux. « On recommence » doit se voir sans
 * qu'on ait à le lire : un paysage neuf dit « autre chose maintenant » mieux
 * qu'un message.
 */
import type {
  Kind,
  PlannedObstacle,
  PlannedPlateforme,
  PlannedJarre,
  PlannedMur,
} from './track'
import { PLATEFORME_H } from './track'
import type { ParcheminKind } from './parchemin'

/** L'index des décors dans `BIOMES` (village, pont, Fuji). */
export const BIOME_NEIGE = 2
export const BIOME_PONT = 1

/**
 * Combien de mètres séparent l'explication de ce qu'elle annonce.
 *
 * ————— DEUX ÉLANS, PAS UN —————
 *
 * ⚠️ `ELAN_GESTE` — court, et calculé pour que LE GESTE ESQUIVE VRAIMENT.
 *
 * Le geste qui relâche la fiche est joué pour de bon : swiper vers le haut fait
 * sauter le coureur. Il faut donc que ce saut-là passe l'obstacle, sinon on
 * aurait appris un mouvement sans effet — et il faudrait le refaire trente
 * mètres plus loin, ce qui est exactement ce que le tutoriel doit éviter.
 *
 * Les chiffres du jeu : un saut vole 0,63 s, une glissade dure 0,55 s. À
 * 22 m/s, cela couvre 13,8 m et 12,1 m. Poser la barrière à 8 m la place donc
 * en plein vol, à peu près à l'apex — le geste porte, avec de la marge des deux
 * côtés.
 *
 * ⚠️ `ELAN_LIBRE` — long, pour ce qui ne se règle PAS par un geste unique.
 *
 * Une plateforme, une paroi, une jarre : là on ne demande rien de précis, on
 * montre. Il faut le temps de voir arriver la chose et de décider, et l'on n'a
 * rien enclenché en fermant la fiche.
 */
const ELAN_GESTE = 8
const ELAN_LIBRE = 35

/**
 * Le geste qui relâche la course.
 *
 * `sort` : un parchemin est VRAIMENT parti de la main. Pas « le double-tap a
 * été fait » — un sort refusé (trêve, sprint final) ne relâche rien, sinon la
 * fiche passerait alors qu'on n'a rien vu se produire.
 */
export type GesteTuto = 'saut' | 'glissade' | 'ligne' | 'tap' | 'sort'

/** Ce qu'une étape pose sur la piste, `ELAN` mètres plus loin. */
export type PoseTuto = Kind | 'plateforme' | 'paroi' | 'jarre'

export interface EtapeTuto {
  /** Le mètre où la course se fige. */
  d: number
  /** Le titre de la fiche — court, il tient sur une ligne. */
  titre: string
  /** Ce qu'on explique. Deux ou trois phrases : on est à l'arrêt, pas en cours. */
  texte: string
  /** Le geste, au doigt et au clavier. Les deux, toujours. */
  doigt: string
  clavier: string
  /** Ce qui relâche la fiche. */
  attend: GesteTuto
  /** Ce qu'on rencontre juste après. */
  pose?: PoseTuto
  /**
   * 🔒 À partir de cette étape, les changements de ligne sont permis.
   *
   * ⚠️ Avant elle, ils sont REFUSÉS — voir `main.ts`. Un débutant qui dérive sur
   * le côté rate l'obstacle qu'on vient de lui expliquer et ne comprend pas
   * pourquoi : la leçon portait sur le saut, elle s'est jouée sur la ligne.
   */
  ouvreLesLignes?: boolean
  /**
   * 📜 Le parchemin mis EN MAIN à l'ouverture de la fiche — sauf s'il y est déjà.
   *
   * « Sauf s'il y est déjà » : c'est ce qui rend la jarre sans échec. Brisée ou
   * percutée, elle a déjà donné le rouleau et la fiche n'en ajoute pas un
   * second ; esquivée, c'est la fiche qui le donne. Dans tous les cas on repart
   * avec, et la leçon qui suit a de quoi se jouer.
   */
  donne?: ParcheminKind
  /**
   * ⚔️ Un rival entre en scène à l'ouverture de la fiche, tant de mètres DEVANT.
   *
   * ⚠️ Devant, jamais derrière : un sort d'attaque vise le rival le plus proche
   * DEVANT. Posé derrière, le kunai de la leçon partirait dans le vide.
   */
  rival?: number
  /**
   * ⚔️ À la reprise, le rival lance CE sort sur le joueur.
   *
   * À la reprise et pas à l'ouverture : un effet encaissé à l'arrêt, sous une
   * fiche, ne se sent pas. Il faut le prendre en courant pour comprendre ce
   * qu'il coûte.
   */
  riposte?: ParcheminKind
}

/**
 * ————— 🚀 LA FICHE DU DÉPART, avant le décompte —————
 *
 * ⚠️ Elle se montre PENDANT l'état « départ », et le décompte ne s'écoule pas
 * tant qu'elle est là. C'est le seul moment où l'on peut expliquer le départ
 * canon : après le 3-2-1 il est trop tard, et le joueur n'aurait jamais su que
 * ces trois secondes-là se jouaient.
 */
export const DEPART: EtapeTuto = {
  d: 0,
  titre: '🚀 Le départ canon',
  texte:
    'Pendant le 3-2-1 qui vient, MARTÈLE. Plus tu tapes vite, plus tu pars lancé — une avance qui ne se rattrape pas au milieu de la course.',
  doigt: 'Touche pour lancer le décompte',
  clavier: 'Espace ou clic',
  attend: 'tap',
}

/**
 * ⚠️ L'ordre n'est pas décoratif.
 *
 * On commence par le geste qu'on devine (sauter par-dessus), puis son contraire
 * (glisser dessous), et l'on finit par celui qu'aucun des deux ne résout — le
 * bloc, qu'on ne peut QUE contourner. Chaque étape rend la suivante lisible ;
 * ouvrir sur le bloc laisserait croire qu'il se saute, et le premier essai se
 * solderait par un échec qu'on n'aurait pas mérité.
 *
 * Viennent ensuite les trois choses qu'on ne SUBIT pas mais qu'on UTILISE : la
 * plateforme, la paroi, le parchemin. Elles arrivent après les obstacles parce
 * qu'elles n'ont de sens qu'une fois qu'on sait ce qu'on évite.
 *
 * Et les SORTS en dernier, dans l'ordre où ils se comprennent : sur soi d'abord
 * (rien à viser, l'effet se sent tout de suite), puis sur un rival, puis celui
 * qu'on reçoit — et le soin qui le lave. Recevoir un kunai AVANT d'en avoir
 * lancé un se lirait comme une punition ; après, c'est la même arme qui revient.
 */
export const ETAPES: readonly EtapeTuto[] = [
  {
    d: 10,
    titre: '⛩️ Bienvenue',
    texte:
      "Tu cours vers le torii, et tu ne t'arrêtes jamais : la seule chose que tu décides, c'est COMMENT tu passes ce qui arrive.",
    doigt: 'Touche l’écran pour continuer',
    clavier: 'Espace ou clic',
    attend: 'tap',
  },
  {
    d: 50,
    titre: '🔥 Le sprint final',
    texte:
      "Sur les 120 DERNIERS mètres, on martèle encore : c'est le coup de reins qui vole une course au coude-à-coude. La piste y est vide, tu n'as rien à esquiver.",
    doigt: 'Touche l’écran pour continuer',
    clavier: 'Espace ou clic',
    attend: 'tap',
  },
  {
    d: 90,
    titre: '⬆️ Sauter',
    texte:
      'Une barrière basse arrive. Elle se franchit par-dessus — et sauter ne coûte rien tant que tu ne retombes pas dessus.',
    doigt: 'Swipe vers le haut',
    clavier: '↑ ou Z',
    attend: 'saut',
    pose: 'saut',
  },
  {
    d: 185,
    titre: '⬇️ Glisser',
    texte:
      "Une barre HAUTE, cette fois : sauter t'y jetterait dedans. On passe dessous, en se baissant.",
    doigt: 'Swipe vers le bas',
    clavier: '↓ ou S',
    attend: 'glissade',
    pose: 'glissade',
  },
  {
    d: 280,
    titre: '↔️ Changer de ligne',
    texte:
      "Un bloc plein. Ni par-dessus, ni par-dessous : il n'y a que trois lignes, et celle-ci est prise. Prends-en une autre — à partir de maintenant, elles sont à toi.",
    doigt: 'Swipe à gauche ou à droite',
    clavier: '← → ou Q D',
    attend: 'ligne',
    pose: 'mur',
    ouvreLesLignes: true,
  },
  {
    d: 375,
    titre: '🚃 Les plateformes',
    texte:
      "Un plateau barre ta ligne. Celui-ci a une rampe : tu montes dessus et tu cours sur le toit. Sans rampe, il faut l'ESCALADER — et l'escalade se paie en vitesse.",
    doigt: 'Prends la rampe, ou change de ligne',
    clavier: '← → pour l’éviter',
    attend: 'tap',
    pose: 'plateforme',
  },
  {
    d: 500,
    titre: '🧱 Les pans de mur',
    texte:
      "Une paroi borde la piste à DROITE. Prends la ligne du bord, saute AVANT d'arriver, puis swipe vers elle : tu la longes à l'abri de tout, et elle te renvoie en l'air.",
    doigt: 'Ligne de droite, saute, puis swipe →',
    clavier: '→ puis ↑ puis →',
    attend: 'tap',
    pose: 'paroi',
  },
  {
    d: 630,
    titre: '📜 Les parchemins',
    texte:
      "Une jarre DORÉE en cache un. Brise-la d'un coup de lame en sautant juste avant — ou fonce dedans : tu l'auras aussi, mais en trébuchant.",
    doigt: 'Swipe vers le haut juste avant la jarre',
    clavier: '↑ juste avant la jarre',
    attend: 'tap',
    pose: 'jarre',
  },
  /*
   * ⚠️ JUSTE APRÈS la jarre (665 m) : le rouleau vient d'apparaître dans la
   * main, on l'explique pendant qu'il brille encore. Plus loin, on aurait
   * oublié d'où il venait.
   */
  {
    d: 680,
    titre: '🌀 Un sort sur toi',
    texte:
      'Ton parchemin est rangé en haut à droite. Celui-ci agit sur TOI : le Vent du Nord te propulse. Lance-le, et sens la poussée.',
    doigt: 'Double-tap',
    clavier: 'E',
    attend: 'sort',
    donne: 'vent',
  },
  {
    d: 760,
    titre: '🎯 Un sort sur un rival',
    texte:
      "Un rival te double. Un sort d'attaque part tout seul sur le plus proche DEVANT toi — en tête, il se perd. Lance ce kunai : regarde-le trébucher.",
    doigt: 'Double-tap',
    clavier: 'E',
    attend: 'sort',
    donne: 'kunai',
    rival: 30,
  },
  {
    d: 840,
    titre: '⚔️ Les mêmes armes',
    texte:
      'Les rivaux ramassent les mêmes parchemins que toi, et visent celui qui les précède. Celui-là va te rendre ton kunai : sens ce que ça fait.',
    doigt: 'Touche l’écran pour encaisser',
    clavier: 'Espace ou clic',
    attend: 'tap',
    riposte: 'kunai',
  },
  {
    d: 885,
    titre: '🍵 Se soigner',
    texte:
      "La terre te colle aux yeux, et elle y restera. Le Thé Purificateur lave tout d'un coup : terre, fumée, poison, chaînes. Lance-le.",
    doigt: 'Double-tap',
    clavier: 'E',
    attend: 'sort',
    donne: 'the',
  },
  {
    d: 940,
    titre: '🌉 À toi de courir',
    texte:
      "C'est tout ce qu'il fallait savoir. On passe au pont : une vraie course contre deux rivaux, sans explications cette fois.",
    doigt: 'Touche l’écran pour partir',
    clavier: 'Espace ou clic',
    attend: 'tap',
  },
]

/** Le mètre où la neige s'arrête et où la vraie course commence. */
export const FIN_APPRENTISSAGE = 995

/**
 * ————— Les quatre plans, DÉDUITS des étapes —————
 *
 * ⚠️ Déduits, jamais recopiés. Déplacer une explication déplace ce qu'elle
 * annonce ; deux listes à tenir en phase se seraient désynchronisées au premier
 * réglage, et l'on aurait expliqué le saut devant une barre haute.
 */
const pose = (quoi: PoseTuto) => ETAPES.filter((e) => e.pose === quoi)

/**
 * Le décalage propre à une étape : court si son geste doit esquiver.
 *
 * ⚠️ 10 m pour la ligne et non 8 : le changement de voie couvre 95 % de l'écart
 * en 0,25 s, soit 5,5 m à pleine vitesse. À 8 m on arriverait TOUT JUSTE, le
 * corps encore entre deux lignes — et le bloc fait 2,15 m de large.
 */
const elanDe = (e: EtapeTuto) =>
  e.attend === 'tap' ? ELAN_LIBRE : e.attend === 'ligne' ? 10 : ELAN_GESTE

/** Les obstacles ordinaires : barrière, barre haute, bloc. */
export const PLAN_NEIGE: PlannedObstacle[] = ETAPES.filter(
  (e) => e.pose === 'saut' || e.pose === 'glissade' || e.pose === 'mur'
).map((e) => ({ d: e.d + elanDe(e), lane: 1, kind: e.pose as Kind }))

/**
 * La plateforme, AVEC sa rampe.
 *
 * ⚠️ Avec rampe, et c'est un choix : on montre d'abord le cas agréable — on
 * court dessus. L'escalade, elle, coûte de la vitesse ; la découvrir dans un
 * tutoriel donnerait l'impression d'avoir mal joué alors qu'on découvrait. Le
 * texte de la fiche prévient qu'elle existe.
 */
export const PLATEFORMES_NEIGE: PlannedPlateforme[] = pose('plateforme').map((e) => ({
  d: e.d + elanDe(e),
  longueur: 16,
  lane: 1,
  hauteur: PLATEFORME_H,
  rampe: 6,
}))

/** La paroi, à DROITE — la fiche dit « swipe vers la droite », il faut que ce soit vrai. */
export const MURS_NEIGE: PlannedMur[] = pose('paroi').map((e) => ({
  d: e.d + elanDe(e),
  longueur: 34,
  cote: 1 as const,
}))

/**
 * La jarre dorée, et son parchemin CHOISI.
 *
 * ⚠️ Le Vent du Nord, pas un tirage. Un dash qui accélère se comprend en une
 * seconde, sans cible ni minuteur ; tomber sur un sabotage obligerait à
 * expliquer un adversaire qui n'est pas encore là — le rival n'entre en scène
 * qu'à la leçon suivante.
 */
export const JARRES_NEIGE: PlannedJarre[] = pose('jarre').map((e) => ({
  d: e.d + elanDe(e),
  lane: 1,
  kind: 'doree' as const,
  parchemin: 'vent' as const,
}))
