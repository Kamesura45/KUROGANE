import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
// Type seul : effacé à la compilation, donc aucun cycle d'import avec track.ts.
import type { Kind } from './track'

/**
 * ————— Les quatre biomes du Tournoi des Voies —————
 *
 * La fiche de jeu décrit la course comme « une traversée des forêts de bambous,
 * villages en flammes, ponts au clair de lune et flancs enneigés du Fuji ».
 * Ce fichier en fait une réalité : la piste change de peau quatre fois.
 *
 * Pourquoi ça compte au-delà du joli : sur 1 920 m de couloir uniforme, on perd
 * la notion d'avancement. Le chrono dit qu'on progresse, l'œil dit qu'on fait du
 * surplace. Quatre décors, c'est quatre repères — « je suis dans les flammes,
 * donc à la moitié » — et un final qui EXPLOSE en blanc après trois biomes
 * sombres. La lisibilité de la course passe par là.
 *
 * ⚠️ Les frontières sont des FRACTIONS, pas des mètres : la longueur de course
 * peut bouger (menu, mode entraînement), le découpage doit suivre tout seul.
 *
 *
 * ————— Pourquoi tout est FUSIONNÉ —————
 *
 * Première version : chaque tige, chaque anneau, chaque braise était un mesh.
 * Mesuré sur une course complète, ça donnait **403 meshes** dans les bambous —
 * pour seulement 9 600 triangles. Sur mobile, le coût n'est pas le nombre de
 * triangles (9 600, c'est trois fois rien) mais le nombre d'APPELS DE DESSIN :
 * ~150 est confortable, ~300 la limite.
 *
 * D'où `assemble()` : toutes les pièces d'un élément de décor sont soudées en
 * UN seul maillage, la couleur voyageant dans les sommets. Un massif de bambous
 * entier coûte désormais 1 appel au lieu de 25 — et comme la couleur est par
 * sommet, on n'a rien perdu en variété.
 *
 * Corollaire : on peut être BEAUCOUP plus généreux en détail qu'avant. Le plan
 * lointain ci-dessous serait impensable sans ça.
 */

export interface Biome {
  nom: string
  kanji: string

  /** La brume : sa couleur EST le ciel, puisqu'on ne voit jamais l'horizon. */
  brume: number
  /** À partir d'où ça s'estompe, et où l'on ne voit plus rien. */
  brumeNear: number
  brumeFar: number

  /** Le sol, et les pointillés qui défilent dessus. */
  sol: number
  ligne: number

  /**
   * Le corps des pans de mur qu'on longe.
   *
   * ⚠️ Leur liseré, lui, reste vermillon dans TOUS les biomes — il n'est pas
   * décoratif : c'est le signal « ici tu peux t'accrocher ». Un repère d'action
   * doit rester identique d'un bout à l'autre de la course, sinon le joueur doit
   * réapprendre à le lire à chaque changement de décor. Seule la matière change.
   */
  murCorps: number

  /**
   * Un élément de bordure (massif, masure, rocher…). Appelé avec le tirage à
   * graine : deux joueurs voient EXACTEMENT le même décor, comme le reste.
   */
  /**
   * Le massif de bordure. `cote` vaut -1 à gauche, +1 à droite.
   *
   * ⚠️ Le côté n'est pas là pour faire joli : il permet aux deux bords de ne
   * PAS se ressembler. Un décor identique de part et d'autre se lit comme un
   * couloir tapissé ; deux bords qui racontent des choses différentes donnent
   * une direction au paysage.
   *
   * La plupart des biomes l'ignorent, et c'est très bien — ils sont symétriques
   * par nature. Seul le pont s'en sert (cf. ses maisons).
   */
  fabriqueDecor: (rng: () => number, cote: number) => THREE.Group
  /** Un élément tous les combien de mètres, de chaque côté. */
  ecartDecor: number

  /**
   * L'habillage des obstacles, propre au biome. Facultatif : sans lui, le biome
   * garde les blocs génériques.
   *
   * ⚠️ Ce n'est QUE de l'apparence. La boîte de collision vient de
   * `TAILLE_OBSTACLE` dans track.ts et ne dépend jamais du maillage — un
   * habillage peut donc déborder, pencher ou s'orner sans rien changer au jeu.
   * L'origine du groupe est AU SOL.
   */
  fabriqueObstacle?: (kind: Kind, rng: () => number) => THREE.Group

  /**
   * L'habillage d'une plateforme (le « train » sur lequel on court).
   *
   * ⚠️ Le maillage doit être bâti sur 1 m de long, CENTRÉ en z, et sera étiré à
   * la longueur voulue. Tout ce qui s'étire mal en Z est donc à proscrire : on
   * privilégie les formes qui courent le long de la plateforme (des perches),
   * puisque les allonger est justement ce qu'on veut.
   *
   * ⚠️ La LARGEUR est passée en paramètre, elle n'est pas importée. C'est
   * `PLATEFORME_LARG`, qui vit dans track.ts — et biomes.ts ne peut pas importer
   * de valeur depuis track.ts sans créer un cycle (track importe déjà BIOMES).
   * C'est la même raison qui fait que `Kind` n'est importé qu'en `type`.
   */
  fabriquePlateforme?: (
    hauteur: number,
    largeur: number,
    avecRampe: boolean
  ) => THREE.Group

  /**
   * 🎋 Ce biome sait-il bâtir des plateformes AJOURÉES — sur pilotis, ouvertes
   * dessous ?
   *
   * Ce n'est pas une coquetterie d'apparence mais une règle de jeu, et c'est
   * pour ça qu'elle vit ici et pas dans la fabrique. Sous un radeau de bambou
   * on doit pouvoir courir, et un kunaï doit filer dessous ; sous un wagon
   * plein, non — on lui rentre dedans et on l'escalade.
   *
   * ⚠️ CE DRAPEAU NE SUFFIT PLUS À LUI SEUL. La bambouseraie a désormais DEUX
   * radeaux, et c'est la RAMPE qui les départage :
   *
   *  · avec rampe → un radeau PLEIN, qu'on monte en courant par sa pente. Y
   *    ménager un tunnel n'aurait aucun sens : la rampe emmène en haut, et
   *    personne n'arriverait jamais dessous.
   *  · sans rampe → le radeau sur PILOTIS, celui qu'on traverse par-dessous et
   *    sur lequel on peut aussi passer.
   *
   * La collision croise donc les deux : ce drapeau, ET `rampe === 0`. Voir
   * `ajouree()` dans track.ts, qui est l'unique endroit où la question se pose.
   */
  plateformeAjouree?: boolean

  /**
   * 🔊 L'ambiance SONORE du biome, s'il en a une.
   *
   * Elle vit ici, à côté de la brume et de la palette, parce qu'elle dit la
   * même chose qu'elles : où l'on se trouve. La boucle de jeu n'a donc aucun
   * numéro de biome à connaître — elle lit ce champ, exactement comme elle lit
   * `plateformeAjouree`.
   */
  ambiance?: 'feu' | 'oiseaux'


  /**
   * La MATIÈRE du sol : une tuile qui se répète sous les pieds du joueur.
   *
   * ⚠️ Elle est MULTIPLIÉE par `sol` — c'est un relief, pas une couleur. D'où
   * un dessin qui tourne autour du blanc : un gris moyen assombrirait tout le
   * biome au lieu de le texturer. Voir `faitTexture`.
   *
   * Sans elle, le sol est un aplat parfait — et un aplat parfait bordé de deux
   * pointillés réguliers, l'œil le lit comme du bitume, quoi qu'on plante
   * autour. C'est cette texture qui dit « terre battue » plutôt que « route ».
   */
  /** ⚠️ Peut rendre `null` hors navigateur (pas de canvas) : cf. `faitTexture`. */
  texSol?: () => THREE.Texture | null
  /** Combien de mètres couvre une tuile de `texSol` (défaut : 4). */
  tuileSol?: number

  /**
   * Le PAN DE MUR qu'on longe et qu'on escalade, habillé par le biome.
   *
   * ⚠️ Mêmes contraintes que `fabriquePlateforme`, et pour la même raison : le
   * maillage est bâti sur 1 m puis ÉTIRÉ à la longueur du pan (26 à 42 m). Tout
   * ce qui a de l'épaisseur en z est donc à proscrire — un pieu vertical de
   * 12 cm deviendrait une planche de cinq mètres. Seules les formes qui COURENT
   * le long du mur (perches, assises, poutres) survivent à l'étirement.
   *
   * Origine AU SOL, centré en z, hauteur 3 m.
   *
   * ⚠️ Le liseré vermillon du haut est OBLIGATOIRE, dans tous les biomes : ce
   * n'est pas de l'ornement, c'est le signal « ici tu peux t'accrocher ».
   */
  fabriqueMur?: () => THREE.Group

  /**
   * La BARRIÈRE de bordure : un tronçon de clôture posé le long de la piste,
   * là où il n'y a pas de mur.
   *
   * Elle répond à un manque : entre les lignes et le décor, le sol partait dans
   * le vide sans que rien ne dise où finit le chemin. Un couloir de course a
   * besoin d'un BORD — c'est lui qui donne la vitesse (il défile tout près) et
   * qui explique la piste (on court dans quelque chose, pas sur une plaine).
   *
   * ⚠️ Contrairement au mur, elle n'est JAMAIS étirée : elle fait exactement
   * `LONG_BARRIERE` mètres. Toutes les formes sont donc permises, pieux
   * verticaux compris.
   *
   * ⚠️ Elle doit rester BASSE (~1,2 m). Une barrière haute referait un couloir
   * fermé et, surtout, finirait par masquer un obstacle de la ligne extérieure
   * dans les virages de caméra. La règle absolue tient toujours : rien ne cache
   * jamais un obstacle.
   *
   * Origine AU SOL, centrée en z, bâtie autour de x = 0.
   */
  fabriqueBarriere?: () => THREE.Group
}

/**
 * La longueur d'un tronçon de barrière.
 *
 * C'est un compromis, et le seul chiffre qui compte ici : la piste en montre
 * ~95 m (portée d'apparition + ce qui traîne derrière), soit 8 tronçons par
 * côté, donc **16 appels de dessin** rien que pour les bordures. Les rallonger
 * en économiserait, mais la barrière doit s'interrompre proprement autour des
 * pans de mur — et un tronçon de 24 m laisserait des trous bien plus larges que
 * les murs eux-mêmes.
 */
export const LONG_BARRIERE = 12

/* ————————————————————————————————————————————————————————————————
 *  Les sols : des tuiles peintes au canvas
 * ———————————————————————————————————————————————————————————————— */

/** Côté de la tuile, en pixels. 256 suffit : on la voit toujours en biais. */
const TUILE = 256

/**
 * Peint une tuile RÉPÉTABLE et en fait une texture.
 *
 * Le dessin reçoit `tache()`, qui recopie automatiquement chaque forme de
 * l'autre côté des bords : sans ça, une feuille posée près du bord serait
 * tranchée net et l'on verrait la grille de répétition sur toute la piste.
 *
 * ⚠️ Les textures sont créées à la DEMANDE et gardées : en fabriquer une par
 * course ferait fuir la mémoire vidéo, et les fabriquer toutes au chargement
 * ferait payer les quatre biomes à qui n'en verra qu'un.
 */
function faitTexture(dessin: (t: Peintre) => void): THREE.Texture | null {
  /*
   * ⚠️ SANS CANVAS, ON RENVOIE null — et le jeu tourne quand même.
   *
   * Les bancs d'essai font tourner la piste sous Node, où il n'existe ni
   * `document` ni contexte 2D. Sans ce garde-fou, construire un `Track` dans
   * un test plantait dès qu'un biome réclamait sa matière de sol : un simple
   * contrôle des plateformes se cassait sur une histoire de peinture.
   *
   * Renvoyer null est honnête plutôt que commode : la couleur du sol porte
   * déjà l'essentiel, la texture n'ajoute que le relief. Tous les appelants
   * savent déjà faire sans (`texSol?.() ?? null`).
   */
  const cv = typeof document === 'undefined' ? null : document.createElement('canvas')
  const ctx = cv?.getContext?.('2d')
  /*
   * On vérifie TOUTES les méthodes que la peinture emploie, pas une seule.
   *
   * Les bancs d'essai fournissent des canevas de façade partiels — celui des
   * plateformes n'imitait que ce qu'il fallait au dégradé des jarres. Ne
   * contrôler que `createLinearGradient` laissait donc passer, puis plantait
   * sur `save`. Cette liste est le CONTRAT de `faitTexture` : si l'une manque,
   * on se passe de matière au lieu de casser.
   */
  const requis = ['save', 'restore', 'translate', 'rotate', 'beginPath', 'ellipse', 'fill', 'fillRect'] as const
  if (!cv || !ctx || requis.some((m) => typeof (ctx as never)[m] !== 'function')) return null
  cv.width = cv.height = TUILE

  const peintre: Peintre = {
    ctx,
    fond(couleur) {
      ctx.fillStyle = couleur
      ctx.fillRect(0, 0, TUILE, TUILE)
    },
    tache(x, y, forme) {
      // Les 9 décalages : la forme déborde d'un bord et revient par l'autre.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          ctx.save()
          ctx.translate(x + dx * TUILE, y + dy * TUILE)
          forme(ctx)
          ctx.restore()
        }
      }
    },
  }
  dessin(peintre)

  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  // Le sol est vu en enfilade, donc sous un angle très rasant : sans
  // anisotropie il part en bouillie scintillante dès dix mètres.
  tex.anisotropy = 4
  return tex
}

interface Peintre {
  ctx: CanvasRenderingContext2D
  fond(couleur: string): void
  /** Dessine `forme` en (x, y), et ses recopies de l'autre côté des bords. */
  tache(x: number, y: number, forme: (ctx: CanvasRenderingContext2D) => void): void
}

/** Un tirage à graine fixe : la texture doit être la même pour les 2 joueurs. */
function dé(graine: number): () => number {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Une ellipse pleine, inclinée — la brique de base de tous les sols. */
function galet(
  ctx: CanvasRenderingContext2D,
  rx: number,
  ry: number,
  angle: number,
  couleur: string
) {
  ctx.rotate(angle)
  ctx.fillStyle = couleur
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * Un cache par biome : voir `faitTexture`.
 *
 * ⚠️ La valeur peut être `null` — hors navigateur, il n'y a pas de canvas et
 * donc pas de matière. On garde quand même l'entrée, pour ne pas retenter la
 * peinture à chaque image.
 */
/**
 * 🌿 Une brindille de bambou : un brin fin qui part du fût, presque à
 * l'horizontale, puis se redresse un peu vers le ciel.
 *
 * `cote` vaut -1 ou +1 : la branche part à gauche ou à droite. `x` est son
 * MILIEU, pas son attache — le cylindre est centré sur son origine, et c'est à
 * l'appelant d'avoir déjà décalé d'une demi-longueur.
 *
 * Elle est volontairement bâtie en UNE pièce : à deux ou trois par tige et une
 * trentaine de tiges ornées par massif, un coude articulé se paierait cent
 * fois pour un détail qu'on croise à 28 m/s.
 */
function p2Branche(
  dans: Piece[],
  o: { x: number; y: number; z: number; lg: number; cote: number; couleur: THREE.Color | number }
) {
  dans.push({
    geo: GEO.tigeCreuse.clone().scale(0.028, o.lg, 0.028),
    couleur: o.couleur,
    x: o.x,
    y: o.y,
    z: o.z,
    // Couchée (π/2), puis relevée d'un cheveu : une branche part à l'horizontale
    // et remonte. Le signe suit le côté, sinon elle plongerait vers le sol.
    rz: o.cote * (Math.PI / 2 - 0.22),
  })
}

const _texCache = new Map<string, THREE.Texture | null>()
function texturePour(clé: string, dessin: (t: Peintre) => void): THREE.Texture | null {
  const dejaLa = _texCache.get(clé)
  if (dejaLa !== undefined) return dejaLa
  const t = faitTexture(dessin)
  _texCache.set(clé, t)
  return t
}

/**
 * La transition : sur cette fraction de la course avant chaque frontière, les
 * couleurs se fondent d'un biome à l'autre. ~5 % = une centaine de mètres,
 * environ 4 s — assez long pour qu'on ne voie jamais un décor « claquer », assez
 * court pour qu'on sente quand même le changement de monde.
 */
const FONDU = 0.05

/* ————————————————————————————————————————————————————————————————
 *  L'outillage : souder des pièces en un seul maillage
 * ———————————————————————————————————————————————————————————————— */

interface Piece {
  geo: THREE.BufferGeometry
  couleur: number | THREE.Color
  x: number
  y: number
  z: number
  /** Inclinaisons, en radians */
  rx?: number
  ry?: number
  rz?: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _un = new THREE.Vector3(1, 1, 1)
const _c = new THREE.Color()

/**
 * Soude des pièces en UN maillage, la couleur passant dans les sommets.
 *
 * Chaque géométrie est déplacée à sa place définitive puis fusionnée : on perd
 * la possibilité de bouger les morceaux indépendamment (on n'en a pas besoin,
 * un bambou ne s'anime pas) et on gagne un facteur ~25 sur les appels de dessin.
 *
 * ⚠️ Les couleurs sont écrites en LINÉAIRE (`THREE.Color` convertit depuis le
 * sRGB tout seul) : c'est ce que l'attribut `color` attend. Y mettre du sRGB
 * brut donnerait un décor délavé.
 */
function assemble(pieces: Piece[], materiau: THREE.Material): THREE.Mesh | null {
  if (pieces.length === 0) return null
  const geos: THREE.BufferGeometry[] = []

  for (const p of pieces) {
    /*
     * ⚠️ On dégroupe l'index AVANT de fusionner.
     *
     * Les géométries de Three ne sont pas toutes bâties pareil : Cylinder, Box
     * et Cone sont INDEXÉES, Dodecahedron ne l'est pas. `mergeGeometries` refuse
     * de mélanger les deux et renvoie null — c'est-à-dire un décor qui disparaît
     * en silence, sans la moindre exception. C'est exactement ce qui était
     * arrivé au Fuji : plus un seul rocher, plus un seul pin.
     *
     * `toNonIndexed()` ramène tout le monde à la même forme. Ça duplique
     * quelques sommets, ce qui est sans importance ici (~19 000 triangles pour
     * toute la course, là où le vrai coût est le nombre d'appels de dessin).
     */
    const source = p.geo.getIndex() ? p.geo.toNonIndexed() : p.geo
    const g = source.clone()
    if (source !== p.geo) source.dispose()
    _e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0)
    _q.setFromEuler(_e)
    _v.set(p.x, p.y, p.z)
    g.applyMatrix4(_m.compose(_v, _q, _un))

    // La couleur, sommet par sommet — c'est ce qui permet de tout souder tout
    // en gardant des tiges de teintes différentes.
    _c.set(p.couleur as THREE.ColorRepresentation)
    const n = g.getAttribute('position').count
    const couleurs = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      couleurs[i * 3] = _c.r
      couleurs[i * 3 + 1] = _c.g
      couleurs[i * 3 + 2] = _c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(couleurs, 3))
    geos.push(g)
  }

  const fusion = mergeGeometries(geos, false)
  for (const g of geos) g.dispose()
  if (!fusion) {
    // Un échec de fusion fait DISPARAÎTRE tout un pan de décor sans lever
    // d'exception : on ne le voit qu'en comptant les maillages. On refuse de
    // le laisser passer sous silence.
    console.error(
      `[biomes] Fusion impossible pour ${pieces.length} pièces — ce décor sera absent.`
    )
    return null
  }
  return new THREE.Mesh(fusion, materiau)
}

/**
 * Les géométries de base, créées UNE fois et réutilisées partout.
 *
 * `assemble` les clone avant de les transformer, donc les partager ne coûte
 * rien — et évite de reconstruire un cylindre à chaque touffe de bambous.
 */
const GEO = {
  tige: new THREE.CylinderGeometry(0.8, 1, 1, 6),
  anneau: new THREE.CylinderGeometry(1, 1, 1, 6),
  /*
   * La même tige, mais SANS ses deux bouchons.
   *
   * Un cylindre à 6 pans coûte 12 triangles de paroi et 12 de bouchons : la
   * moitié du prix part dans des disques qu'on ne voit jamais, puisqu'une tige
   * de bambou est plantée dans le sol et se perd dans la brume. Sur les
   * cinquante tiges d'un massif, l'économie est franche.
   *
   * ⚠️ Réservée au DÉCOR. Les troncs couchés en travers d'une ligne, eux,
   * montrent leur section au joueur — ouverts, ils paraîtraient creux.
   */
  tigeCreuse: new THREE.CylinderGeometry(0.8, 1, 1, 6, 1, true),
  /**
   * La tige du LOINTAIN : 4 pans au lieu de 6, et creuse.
   *
   * À vingt mètres et dans la brume, on ne lit qu'une silhouette verticale —
   * personne ne comptera jamais ses arêtes. Comme ces tiges-là forment le gros
   * du décor (jusqu'à 70 par massif), leur faire économiser un tiers de leurs
   * triangles est le seul geste qui pèse vraiment.
   */
  tigeLoin: new THREE.CylinderGeometry(0.8, 1, 1, 4, 1, true),
  bloc: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 4),
  sapin: new THREE.ConeGeometry(1, 1, 6),
  caillou: new THREE.DodecahedronGeometry(1, 0),
  feuille: new THREE.PlaneGeometry(1, 1),
}

/**
 * Les matériaux, partagés par tous les décors d'un même type. Deux familles
 * seulement, et c'est volontaire :
 *  · MAT_SOLIDE  — éclairé par la scène, prend la brume ;
 *  · MAT_LUMIERE — s'éclaire tout seul (braises, lanternes), prend la brume
 *    aussi, sinon un feu resterait net à 90 m alors que tout s'estompe.
 */
const MAT_SOLIDE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
const MAT_FACETTE = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 1,
  flatShading: true,
})
const MAT_LUMIERE = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })
/** Le feuillage : des plans, donc à rendre des DEUX côtés — sinon la moitié
 *  des feuilles disparaît selon l'angle de la caméra. */
const MAT_FEUILLE = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 1,
  side: THREE.DoubleSide,
})

/** Regroupe les maillages soudés d'un élément de décor. */
function groupe(...meshes: (THREE.Mesh | null)[]): THREE.Group {
  const g = new THREE.Group()
  for (const m of meshes) if (m) g.add(m)
  return g
}

/** Tire une couleur entre deux teintes. */
function teinte(a: number, b: number, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), t)
}

/* ————————————————————————————————————————————————————————————————
 *  Bordures : le squelette commun des barrières et des murs
 * ———————————————————————————————————————————————————————————————— */

/**
 * Le VERMILLON du liseré. Il ne change dans aucun biome, jamais : c'est le
 * signal « ici tu peux t'accrocher », et un repère d'action qui change de
 * couleur oblige le joueur à réapprendre à le lire à chaque décor.
 */
const VERMILLON = 0xc33a2c

interface FaçonBarriere {
  /** Le pieu : sa couleur, son rayon, sa hauteur, et l'écart entre deux. */
  pieu: { couleur: [number, number]; r: number; h: number; ecart: number }
  /** Les lisses qui courent d'un bout à l'autre : à quelle hauteur, et de quoi. */
  lisses: { y: number; r: number; couleur: number }[]
  /** Une ligature au sommet de chaque pieu (facultatif). */
  ligature?: number
  /** Un chapeau conique sur chaque pieu (facultatif). */
  pointe?: number
}

/**
 * Toutes les barrières du jeu sont la même chose : des pieux régulièrement
 * espacés, deux ou trois lisses qui courent d'un bout à l'autre, et de quoi
 * les attacher. Ce qui change d'un biome à l'autre, c'est la matière et les
 * proportions — pas la structure.
 *
 * D'où ce squelette commun : quatre barrières crédibles pour le prix d'une, et
 * une garantie qu'aucune ne dérivera en hauteur (voir `fabriqueBarriere` : une
 * barrière haute masquerait des obstacles).
 *
 * ⚠️ Le premier pieu est posé à `-LONG/2` et le dernier EXCLU : deux tronçons
 * bout à bout partageraient sinon un pieu au même endroit, et l'on verrait un
 * poteau double tous les 12 m.
 *
 * ⚠️ Et `ecart` DOIT diviser `LONG_BARRIERE` exactement. Sinon le dernier pieu
 * d'un tronçon tombe trop près du premier du suivant : avec un écart de 1,6 m,
 * les pieux se suivaient à 1,6 m partout sauf au raccord, où ils se serraient à
 * 0,8 m — un hoquet dans le rythme, tous les 12 m, sur toute la course. C'est
 * le genre de motif que l'œil finit toujours par attraper.
 */
function barriereSimple(f: FaçonBarriere, rng: () => number): THREE.Group {
  const p: Piece[] = []

  for (let z = -LONG_BARRIERE / 2; z < LONG_BARRIERE / 2 - 0.01; z += f.pieu.ecart) {
    const h = f.pieu.h * (0.9 + rng() * 0.2) // jamais deux pieux de la même taille
    const penche = (rng() - 0.5) * 0.09
    p.push({
      geo: GEO.tige.clone().scale(f.pieu.r, h, f.pieu.r),
      couleur: teinte(f.pieu.couleur[0], f.pieu.couleur[1], rng()),
      x: 0, y: h / 2, z,
      rz: penche,
      rx: (rng() - 0.5) * 0.06,
    })
    if (f.ligature !== undefined) {
      p.push({
        geo: GEO.anneau.clone().scale(f.pieu.r * 1.5, 0.07, f.pieu.r * 1.5),
        couleur: f.ligature,
        x: Math.sin(penche) * h * 0.8, y: h * 0.8, z,
      })
    }
    if (f.pointe !== undefined) {
      p.push({
        geo: GEO.sapin.clone().scale(f.pieu.r * 1.4, f.pieu.r * 2.6, f.pieu.r * 1.4),
        couleur: f.pointe,
        x: Math.sin(penche) * h, y: h + f.pieu.r * 1.3, z,
      })
    }
  }

  // Les lisses : d'un bout à l'autre du tronçon, sans quoi la clôture se
  // lirait comme une rangée de piquets isolés.
  for (const l of f.lisses) {
    p.push({
      geo: GEO.tige.clone().scale(l.r, LONG_BARRIERE, l.r),
      couleur: l.couleur,
      x: 0, y: l.y, z: 0,
      rx: Math.PI / 2, // couchée le long de la piste
    })
  }

  return groupe(assemble(p, MAT_SOLIDE))
}

/**
 * La hauteur des pans de mur qu'on longe.
 *
 * Passée de 3 à **6 m** : à 3 m, la paroi arrivait à peine plus haut que le
 * coureur et la piste restait une plaine avec des bouts de clôture. À 6 m on
 * court dans quelque chose — le regard bute, et la vitesse se lit sur les
 * parois qui défilent.
 *
 * ⚠️ C'est une hauteur PUREMENT visuelle, et c'est ce qui la rend sûre : on
 * court sur la paroi à `MUR_HAUTEUR` (1,6 m) quoi qu'il arrive, et l'accroche
 * ne dépend que de la position en x. Doubler le mur ne change pas une seule
 * règle du jeu.
 *
 * ⚠️ En revanche elle entraîne les TORII, qui doivent enjamber la piste : un
 * linteau posé à 4,6 m passerait maintenant sous le haut des murs.
 */
export const MUR_HAUT = 6

/**
 * Là où le mur dit « accroche-toi ici ».
 *
 * Un peu au-dessus de la hauteur de course sur paroi (1,6 m), pour que le
 * repère reste visible au lieu de passer derrière le coureur.
 */
const Y_ACCROCHE = 1.85

interface FaçonMur {
  /** Le corps plein du mur. */
  corps: number
  /** Les bandes horizontales qui l'habillent : hauteur, épaisseur, couleur. */
  bandes: { y: number; e: number; couleur: number; ronde?: boolean }[]
  /** Un soubassement plus sombre, au pied (facultatif). */
  socle?: number
  /** Le couronnement : la matière qui coiffe le mur, propre au biome. */
  couronne: number
}

/**
 * Le squelette commun des pans de mur.
 *
 * ⚠️ Tout est bâti sur 1 m de long et sera ÉTIRÉ : il n'y a donc ici QUE des
 * formes qui courent le long du mur. C'est cette contrainte qui décide de
 * l'habillage de chaque biome — pas le goût. Un mur de bambou serait fait de
 * tiges verticales dans la vraie vie ; ici il est fait de perches couchées,
 * parce que c'est ce qui survit à l'étirement.
 */
function murSimple(f: FaçonMur): THREE.Group {
  const corps: Piece[] = []

  corps.push({
    geo: GEO.bloc.clone().scale(0.5, MUR_HAUT, 1),
    couleur: f.corps,
    x: 0, y: MUR_HAUT / 2, z: 0,
  })
  if (f.socle !== undefined) {
    corps.push({
      geo: GEO.bloc.clone().scale(0.58, 0.45, 1),
      couleur: f.socle,
      x: 0, y: 0.22, z: 0,
    })
  }

  // Les bandes, posées sur les DEUX faces : on longe un mur par la gauche comme
  // par la droite, et une face nue se remarque immédiatement.
  for (const b of f.bandes) {
    for (const x of [-0.27, 0.27]) {
      corps.push({
        geo: b.ronde
          ? GEO.tige.clone().scale(b.e, 1, b.e)
          : GEO.bloc.clone().scale(b.e, b.e, 1),
        couleur: b.couleur,
        x, y: b.y, z: 0,
        rx: b.ronde ? Math.PI / 2 : 0,
      })
    }
  }

  /*
   * ————— Le sommet : du biome, pas du rouge —————
   *
   * Le mur était coiffé d'une barre vermillon de 18 cm sur toute sa longueur.
   * Ça marchait comme signal, mais ça faisait courir un ruban rouge d'un bout
   * à l'autre de chaque décor — et sur un mur de 6 m, la barre serait devenue
   * franchement envahissante.
   *
   * Le sommet prend donc la MATIÈRE du biome (une tuile de bambou, une arête
   * de glace…), et le vermillon se réduit à deux traits fins :
   *  · une arête sous la lèvre du couronnement, qui souligne le haut ;
   *  · un trait à hauteur d'accroche, qui dit OÙ l'on s'agrippe.
   *
   * Le second n'existait pas avant, et c'est le mur de 6 m qui l'impose : le
   * repère était en haut parce que le haut était à portée de main. Il ne l'est
   * plus. Un signal d'action doit se trouver là où se fait l'action.
   */
  corps.push({
    geo: GEO.bloc.clone().scale(0.62, 0.26, 1),
    couleur: f.couronne,
    x: 0, y: MUR_HAUT - 0.13, z: 0,
  })

  const liser: Piece[] = [
    // L'arête du couronnement.
    {
      geo: GEO.bloc.clone().scale(0.66, 0.05, 1),
      couleur: VERMILLON,
      x: 0, y: MUR_HAUT - 0.29, z: 0,
    },
    // Le repère d'accroche, sur les deux faces.
    ...[-0.26, 0.26].map((x) => ({
      geo: GEO.bloc.clone().scale(0.04, 0.07, 1),
      couleur: VERMILLON,
      x, y: Y_ACCROCHE, z: 0,
    })),
  ]

  return groupe(assemble(corps, MAT_SOLIDE), assemble(liser, MAT_LUMIERE))
}

/**
 * ————— 🏗️ Le SQUELETTE d'une plateforme, commun à trois biomes —————
 *
 * La bambouseraie garde sa fabrique à elle (des perches couchées, une forme
 * qu'aucun autre biome ne partage). Les trois autres, eux, disent la même chose
 * avec des matières différentes — c'est exactement ce qu'un squelette commun
 * doit porter, comme `murSimple` et `barriereSimple` le font déjà ailleurs.
 *
 * Les DEUX variantes en sortent, et c'est le point :
 *
 *  · `avecRampe` → des flancs PLEINS. On la monte par sa pente, il n'y a rien à
 *    voir dessous et personne n'y passera jamais.
 *  · sinon       → des PILOTIS espacés. On voit au travers, et l'on y court.
 *
 * ⚠️ Tout est bâti sur 1 m de long puis ÉTIRÉ. D'où deux conséquences qu'il
 * faut avoir en tête en réglant les chiffres :
 *  · ce qui est HORIZONTAL (le tablier, les lisses) s'allonge — c'est voulu ;
 *  · ce qui est VERTICAL (les pilotis) ne s'allonge pas, il s'ÉCARTE. Trois
 *    poteaux posés à z = -0,34 / 0 / +0,34 deviennent trois pilotis
 *    régulièrement espacés sur toute la longueur, quelle qu'elle soit. C'est le
 *    seul endroit du jeu où l'étirement joue en notre faveur.
 */
interface FaçonPlateforme {
  /** Le dessus, celui qu'on foule. */
  tablier: number
  /** Les flancs pleins, en deux teintes qui alternent par assise. */
  corps: [number, number]
  /** Les poteaux de la variante ajourée. */
  pilotis: number
  /**
   * Ce qui S'ÉCLAIRE : braises, lanternes. Reçoit le tableau à remplir et de
   * quoi se placer. Appelé pour les deux variantes — un radeau plein a droit à
   * ses feux comme l'autre.
   */
  lueurs?: (dans: Piece[], h: number, l: number, ajoure: boolean) => void
}

function plateformeSimple(
  hauteur: number,
  largeur: number,
  avecRampe: boolean,
  f: FaçonPlateforme
): THREE.Group {
  const corps: Piece[] = []
  const lueurs: Piece[] = []

  // Le tablier : c'est LUI qu'on voit d'en haut, et lui qui porte.
  corps.push({
    geo: GEO.bloc.clone().scale(largeur, 0.22, 1),
    couleur: f.tablier,
    x: 0, y: hauteur - 0.11, z: 0,
  })

  if (avecRampe) {
    /*
     * ⚠️ UNE MASSE PLEINE, d'abord.
     *
     * Il n'y avait ici que deux assises de flanc, et l'intérieur restait VIDE :
     * de face, on voyait au travers entre les deux parois. Une plateforme qu'on
     * monte par une pente doit être pleine — c'est ce qui la distingue de sa
     * jumelle sur pilotis, et cette distinction ne peut pas tenir aux seuls
     * côtés.
     *
     * Le corps est posé EN PREMIER, les assises viennent ensuite par-dessus :
     * elles n'ont plus à faire structure, seulement relief.
     */
    corps.push({
      geo: GEO.bloc.clone().scale(largeur - 0.08, hauteur - 0.2, 1),
      couleur: f.corps[1],
      x: 0, y: (hauteur - 0.2) / 2, z: 0,
    })
    // Les assises qui l'habillent : elles débordent d'un cheveu sur les flancs,
    // et c'est leur alternance qui donne l'épaisseur du bâti.
    const etages = Math.max(2, Math.floor((hauteur - 0.66) / 0.42))
    for (const cote of [-1, 1]) {
      for (let e = 0; e < etages; e++) {
        corps.push({
          geo: GEO.bloc.clone().scale(0.2, (hauteur - 0.9) / etages + 0.02, 1),
          couleur: f.corps[e % 2],
          x: cote * (largeur / 2 - 0.02),
          y: 0.24 + e * ((hauteur - 0.9) / Math.max(1, etages - 1)),
          z: 0,
        })
      }
    }
  } else {
    // Les pilotis, plantés au bord EXACT de la ligne et volontairement fins :
    // ils expliquent que le tablier tienne sans jamais se trouver là où l'on
    // court. Le passage doit se voir libre pour qu'on ose s'y engager.
    for (const cote of [-1, 1]) {
      for (const z of [-0.34, 0, 0.34]) {
        corps.push({
          geo: GEO.bloc.clone().scale(0.13, hauteur - 0.66, 0.13),
          couleur: f.pilotis,
          x: cote * (largeur / 2 - 0.13),
          y: (hauteur - 0.66) / 2,
          z,
        })
      }
      // Une lisse basse d'un pilotis à l'autre : elle borde le tunnel sans le
      // fermer, et donne au passage un seuil.
      corps.push({
        geo: GEO.bloc.clone().scale(0.08, 0.08, 1),
        couleur: f.corps[0],
        x: cote * (largeur / 2 - 0.13),
        y: 0.34,
        z: 0,
      })
    }
  }

  f.lueurs?.(lueurs, hauteur, largeur, !avecRampe)
  return groupe(assemble(corps, MAT_SOLIDE), assemble(lueurs, MAT_LUMIERE))
}

/* ————————————————————————————————————————————————————————————————
 *  1 · FORÊT DE BAMBOUS 竹 — l'aube verte
 * ———————————————————————————————————————————————————————————————— */

/**
 * On démarre ici : c'est le biome qui doit être le PLUS lisible, parce que le
 * joueur apprend encore où sont les lignes. D'où la brume la plus claire des
 * trois biomes sombres, et un décor vertical (les tiges) qui souligne la fuite
 * de la piste au lieu de la brouiller.
 *
 * Le massif est bâti en TROIS PLANS, et c'est ce qui fait la profondeur :
 *
 *  · le plan RAPPROCHÉ (x 0→4) — tiges claires, avec nœuds et feuillage. C'est
 *    le seul plan où l'on distingue les détails, donc le seul qui en porte ;
 *  · le plan LOINTAIN (x 5→16) — tiges deux fois plus hautes et bien plus
 *    sombres. À cette distance l'œil ne lit qu'une silhouette : lui donner des
 *    détails serait payer pour rien. Leur hauteur double est ce qui fait dire
 *    « forêt » plutôt que « haie » ;
 *  · le SOL (x 0→5) — litière et jeunes pousses, qui empêchent les tiges d'avoir
 *    l'air plantées dans du vide.
 *
 * Le tout soudé en 2 maillages (le solide, et le feuillage). Sans la fusion, un
 * massif pareil coûterait ~60 appels de dessin ; il en coûte 2.
 */
const BAMBOUS: Biome = {
  nom: 'Forêt de bambous',
  kanji: '竹',
  brume: 0x1c2e24,
  brumeNear: 26,
  /*
   * ⚠️ 68 m, et pas 88.
   *
   * Voir à 88 m dans une bambouseraie n'a aucun sens : un vrai sous-bois se
   * referme bien avant. Et c'est cette portée excessive qui EXPOSAIT les
   * trouées — plus on voit loin, plus on accumule de chances qu'un rayon passe
   * entre deux tiges. Resserrer la brume densifie la forêt gratuitement, sans
   * un triangle de plus.
   *
   * 68 m reste large pour le jeu : les obstacles apparaissent à 85 m, donc on
   * les découvre à 68 m, soit 2,6 s d'anticipation à la vitesse de croisière.
   * C'est plus que ce que laisse un runner classique.
   */
  brumeFar: 68,
  sol: 0x24301f,
  ligne: 0x40573f,
  murCorps: 0x2c3a23, // une palissade de bambou serré, sombre
  /*
   * 9 m entre deux massifs, et chaque massif s'étale sur ~18 m de profondeur :
   * ils se CHEVAUCHENT donc largement.
   *
   * C'est le point qui manquait. Avec des massifs espacés de 12 m mais larges
   * de 7, on voyait le vide entre eux — une haie de bosquets, pas une forêt.
   * Le recouvrement est ce qui ferme complètement le regard.
   *
   * Et il ne coûte rien : chaque massif reste UN appel de dessin quel que soit
   * le nombre de tiges, puisque tout est soudé. Le seul vrai coût, c'est le
   * nombre de massifs — d'où le choix de charger chacun plutôt que d'en
   * multiplier.
   */
  /*
   * ⚠️ La densité au mètre ne dépend QUE du rapport tiges/écartement.
   *
   * Chaque massif apporte ses tiges tous les `ecartDecor` mètres : la densité
   * vaut donc `proches / ecartDecor`, et l'étalement en z ne joue que sur
   * l'uniformité. Serrer les massifs (6 → 4 m) faisait grimper les appels de
   * dessin d'un tiers — 175, au-dessus du confortable — pour le même résultat
   * que charger chaque massif, qui lui ne coûte RIEN de plus (tout est soudé).
   *
   * On garde donc un écartement large, et l'on remplit chaque massif.
   *
   * 7 m plutôt que 6 : le décor est devenu si fourni (feuillage, canopée) que
   * les massifs visibles coûtaient 156 appels de dessin, au-dessus des ~150
   * confortables. En les espaçant d'un mètre et en chargeant chacun d'autant
   * (× 7/6), la densité au mètre est INCHANGÉE et l'on récupère 14 % d'appels.
   * C'est exactement le levier que la mesure avait désigné.
   */
  ecartDecor: 7,

  // 🐦 L'aube dans les bambous : quelques chants espacés. C'est le biome du
  // DÉPART, celui qu'on écoute pendant le décompte faute d'avoir mieux à faire
  // — et le seul moment de la course où l'on a l'oreille libre.
  ambiance: 'oiseaux',

  /*
   * ————— Le sol de la bambouseraie —————
   *
   * Un sentier de terre battue sous une litière de bambou. Trois couches, dans
   * l'ordre où on les pose, qui répondent chacune à un défaut précis :
   *
   *  · la TERRE — de larges taches lentes, plus claires au milieu. C'est ce qui
   *    casse l'aplat : un sol parfaitement uni se lit comme du revêtement, quel
   *    que soit le décor planté autour ;
   *  · la LITIÈRE — des lames de feuilles sèches, toutes orientées à peu près
   *    dans le sens de la course. L'orientation n'est pas un caprice : couchées
   *    en travers, elles font des barres qui ressemblent à des marquages, et on
   *    revient exactement au problème qu'on essaie de résoudre ;
   *  · la MOUSSE — quelques plaques sombres et froides, qui donnent l'humidité
   *    du sous-bois et empêchent la terre de virer au désert.
   *
   * Tout tourne autour du blanc cassé : le résultat est multiplié par `sol`
   * (0x24301f, un vert très sombre), donc la tuile ne fait que le moduler.
   */
  texSol: () =>
    texturePour('bambous', (t) => {
      const r = dé(0x8a3b)
      t.fond('#e9e3d4')

      /*
       * ⚠️ Le CONTRASTE avant tout le reste.
       *
       * Première version : de larges galets sombres sur fond clair. Une tuile
       * de 5 m dessinée avec des taches de 40 px, ça fait des taches d'un mètre
       * — et vu d'en haut, ça ne donnait pas un sous-bois mais un motif de
       * CAMOUFLAGE, des trous noirs mous répartis sur le vert.
       *
       * La terre, ça n'est pas de grandes taches contrastées : c'est un grain
       * FIN et beaucoup de variations LENTES et faibles. D'où la refonte :
       * amplitude divisée par trois, et le détail reporté sur le grain.
       */

      // Les variations lentes du terrain : larges, mais à peine perceptibles.
      for (let i = 0; i < 14; i++) {
        const v = 222 + Math.floor(r() * 20)
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 30 + r() * 46, 24 + r() * 40, r() * Math.PI, `rgb(${v},${v - 3},${v - 10})`)
        )
      }

      // Le grain de la terre : c'est LUI le sujet. Des dizaines de petits
      // cailloux et grumeaux, trop fins pour se lire un par un, mais qui
      // enlèvent définitivement l'aspect « surface lisse ».
      for (let i = 0; i < 300; i++) {
        const v = 196 + Math.floor(r() * 54)
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 1.5 + r() * 4, 1.5 + r() * 3.5, r() * Math.PI, `rgb(${v},${v - 4},${v - 12})`)
        )
      }

      // La mousse : verte et à peine plus sombre que la terre. Elle donne
      // l'humidité du sous-bois, pas des trous dans le sol.
      for (let i = 0; i < 16; i++) {
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 9 + r() * 18, 7 + r() * 15, r() * Math.PI, 'rgb(214,230,206)')
        )
      }

      // La litière : des lames sèches, dans le sens de la course (± 25°).
      // Couchées en travers, elles feraient des barres — et l'on retomberait
      // sur le marquage routier qu'on cherche justement à effacer.
      for (let i = 0; i < 130; i++) {
        const chaud = r()
        const c = `rgb(${250 - chaud * 26},${238 - chaud * 34},${206 - chaud * 40})`
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 1.8 + r() * 1.6, 8 + r() * 11, (r() - 0.5) * 0.9, c)
        )
      }
      // Et quelques brindilles sombres : sans elles, la litière n'a que des
      // feuilles claires et le sol se met à briller uniformément.
      for (let i = 0; i < 26; i++) {
        const v = 176 + Math.floor(r() * 26)
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 1 + r() * 1, 6 + r() * 12, (r() - 0.5) * 1, `rgb(${v},${v - 8},${v - 22})`)
        )
      }
    }),
  tuileSol: 5,

  /*
   * Le yotsume-gaki, la clôture de jardin japonaise : des bambous fins liés à
   * deux traverses par de la corde. C'est LA barrière de la bambouseraie, et
   * elle a l'avantage d'être ajourée — on continue de voir la forêt derrière.
   */
  fabriqueBarriere: () =>
    barriereSimple(
      {
        pieu: { couleur: [0x6d8a42, 0x435c2a], r: 0.06, h: 1.15, ecart: 1.5 },
        lisses: [
          { y: 0.44, r: 0.05, couleur: 0x54683a },
          { y: 0.94, r: 0.05, couleur: 0x54683a },
        ],
        ligature: 0x8a7440, // la corde de paille
      },
      dé(0x0b1)
    ),

  /*
   * Le mur : une palissade de bambou serré.
   *
   * ⚠️ Faite de perches COUCHÉES, pas de tiges plantées — alors qu'une vraie
   * palissade de bambou est verticale. C'est l'étirement qui commande : une
   * tige de 12 cm de diamètre étirée sur un pan de 40 m deviendrait une planche
   * de cinq mètres de large. Les perches en long, elles, ne font que s'allonger,
   * ce qui est exactement l'effet voulu.
   */
  fabriqueMur: () =>
    murSimple({
      corps: 0x2c3a23,
      socle: 0x1a2214,
      couronne: 0x5a6b34, // une lisse de bambou clair en guise de chapeau
      bandes: [
        { y: 0.42, e: 0.13, couleur: 0x4d5c30, ronde: true },
        { y: 1.02, e: 0.13, couleur: 0x3e4b27, ronde: true },
        { y: 1.62, e: 0.13, couleur: 0x4d5c30, ronde: true },
        { y: 2.22, e: 0.13, couleur: 0x3e4b27, ronde: true },
        { y: 2.82, e: 0.13, couleur: 0x4d5c30, ronde: true },
        { y: 3.42, e: 0.13, couleur: 0x3e4b27, ronde: true },
        { y: 4.02, e: 0.13, couleur: 0x4d5c30, ronde: true },
        { y: 4.62, e: 0.13, couleur: 0x3e4b27, ronde: true },
        { y: 5.22, e: 0.13, couleur: 0x4d5c30, ronde: true },
        { y: 5.7, e: 0.11, couleur: 0x5a6b34, ronde: true },
      ],
    }),

  fabriqueDecor: (rng) => {
    const corps: Piece[] = []
    const feuilles: Piece[] = []

    /*
     * ————— TROIS ÉTAGES, et le classement se fait sur le COÛT, pas la distance
     *
     * Le piège dans lequel je suis tombé deux fois : croire que « plan proche »
     * et « plan lointain » suffisaient. Ça liait le DÉTAIL d'une tige à sa
     * POSITION, et donc son prix aussi. Résultat, la bande la plus proche de la
     * piste — celle qu'on voit le mieux, où le moindre trou saute aux yeux —
     * était la MOINS fournie : mesuré, 8,4 tiges par mètre de largeur contre
     * 11,5 pour le fond. Impossible d'en ajouter sans exploser le budget, une
     * tige ornée coûtant douze fois une tige nue.
     *
     * On sépare donc les deux questions :
     *   · DÉTAILLÉES (0→5 m)  — nœuds et feuillage. Peu nombreuses : ce sont
     *     celles qu'on frôle, elles portent la lecture « bambou ».
     *   · SIMPLES (0→11 m)    — de simples fûts à 6 pans. C'est ELLES qui
     *     remplissent la bande proche, et elles ne coûtent presque rien.
     *   · LOINTAINES (5→24 m) — 4 pans, quasi noires : la masse qui ferme
     *     l'horizon.
     *
     * Les trois se chevauchent largement, donc plus aucune couture verticale.
     */
    /*
     * ————— 🎋 LES TIGES POUSSENT EN TOUFFES —————
     *
     * Un bambou ne pousse pas tige par tige : un rhizome donne une touffe, et
     * les chaumes en sortent serrés autour du même point.
     *
     * On semait jusqu'ici chaque tige INDÉPENDAMMENT, à plat sur toute la
     * bande. D'où une forêt également clairsemée partout : l'œil n'y trouvait
     * aucun groupe auquel se raccrocher, et les trous se voyaient d'autant
     * mieux qu'ils étaient réguliers — c'est ce qui se lisait comme un bug.
     *
     * On tire donc des CENTRES, puis les tiges autour. Même quantité de
     * géométrie, répartition tout autre : des paquets denses, et de vraies
     * clairières entre eux.
     */
    const semeTouffes = (etendue: number, profondeur: number, n: number) =>
      Array.from({ length: n }, () => ({
        x: rng() * etendue,
        z: (rng() - 0.5) * profondeur,
        // Serré : au-delà d'un mètre, on retombe sur du semis à plat.
        r: 0.45 + rng() * 0.85,
      }))

    /**
     * Un point au hasard DANS une touffe.
     *
     * ⚠️ `sqrt` sur le rayon : sans lui, un tirage uniforme sur r entasse tout
     * au centre (l'aire croît comme r²) et la touffe devient un poteau unique.
     */
    const dansTouffe = (t: { x: number; z: number; r: number }) => {
      const a = rng() * Math.PI * 2
      const d = Math.sqrt(rng()) * t.r
      return { x: t.x + Math.cos(a) * d, z: t.z + Math.sin(a) * d }
    }

    const touffesProches = semeTouffes(5, 22, 9)
    const detaillees = 26 + Math.floor(rng() * 12)
    for (let i = 0; i < detaillees; i++) {
      const h = 7 + rng() * 7
      const r = 0.085 + rng() * 0.05
      const { x, z } = dansTouffe(touffesProches[Math.floor(rng() * touffesProches.length)])
      // Plus la tige est loin, plus elle est sombre : la profondeur se lit à la
      // valeur avant de se lire à la taille.
      const recul = Math.min(1, x / 5)
      const vert = teinte(0x6d8a42, 0x2f4423, recul * 0.65 + rng() * 0.2)
      const penche = (rng() - 0.5) * 0.14

      // ⚠️ Les géométries de base font 1 m et `assemble` ne gère pas l'échelle :
      // c'est la géométrie clonée qui porte la taille.
      corps.push({
        geo: GEO.tigeCreuse.clone().scale(r, h, r),
        couleur: vert,
        x, y: h / 2, z,
        rz: penche,
        rx: (rng() - 0.5) * 0.08,
      })

      // Les nœuds : c'est ce détail qui fait lire « bambou » et pas « tube vert ».
      const noeuds = 2 + Math.floor(rng() * 3)
      for (let k = 1; k <= noeuds; k++) {
        const hy = (h / (noeuds + 1)) * k
        corps.push({
          geo: GEO.anneau.clone().scale(r * 1.3, 0.1, r * 1.3),
          couleur: teinte(0x93a95c, 0x4a5c30, recul * 0.6),
          x: x + Math.sin(penche) * hy,
          y: hy,
          z,
          rz: penche,
        })
      }

      /*
       * 🌿 Les BRANCHES du haut : deux ou trois brindilles qui partent du fût,
       * dans le dernier tiers.
       *
       * C'est ce qui distingue une tige de bambou d'un tube vert planté. Les
       * nœuds le disaient déjà de près ; les branches le disent de LOIN, à la
       * silhouette — et c'est à la silhouette qu'on lit un massif en courant.
       *
       * Réservées aux tiges détaillées (une trentaine par massif) : sur les
       * deux cents fûts de remplissage, elles coûteraient sans rien ajouter,
       * puisque la canopée couvre déjà tout à cette hauteur.
       */
      const branches = 2 + Math.floor(rng() * 2)
      for (let k = 0; k < branches; k++) {
        const hy = h * (0.62 + rng() * 0.3)
        const cote = rng() < 0.5 ? -1 : 1
        const lg = 0.5 + rng() * 0.55
        p2Branche(corps, {
          x: x + Math.sin(penche) * hy + (cote * lg) / 2,
          y: hy,
          z,
          lg,
          cote,
          couleur: teinte(0x7f9a4c, 0x46592c, recul * 0.5 + rng() * 0.4),
        })
      }

      // Le feuillage : quelques lames en haut de tige. Sans ça, une forêt de
      // bambous ressemble à un parking à poteaux.
      const lames = 2 + Math.floor(rng() * 3)
      for (let k = 0; k < lames; k++) {
        const hy = h * (0.68 + rng() * 0.3)
        feuilles.push({
          geo: GEO.feuille.clone().scale(1.1 + rng() * 0.9, 0.16 + rng() * 0.12, 1),
          couleur: teinte(0x7fa04a, 0x35502a, rng() * 0.8),
          x: x + Math.sin(penche) * hy + (rng() - 0.5) * 0.9,
          y: hy,
          z: z + (rng() - 0.5) * 0.9,
          ry: rng() * Math.PI,
          rz: (rng() - 0.5) * 1.1,
        })
      }
    }

    /*
     * ————— Étage intermédiaire : le remplissage —————
     *
     * De simples fûts, sans nœuds ni feuillage, sur toute la bande proche. Ce
     * sont eux qui font la DENSITÉ là où elle manquait : à trois fois moins de
     * géométrie qu'une tige ornée, on peut en poser cinq fois plus.
     *
     * Ils gardent la hauteur et la teinte du premier plan — vus de la piste,
     * rien ne les distingue d'une tige détaillée, sinon qu'on ne compte pas
     * leurs nœuds à 28 m/s.
     */
    const touffesLarges = semeTouffes(11, 23, 27)
    const simples = 152 + Math.floor(rng() * 58)
    for (let i = 0; i < simples; i++) {
      const h = 7 + rng() * 8
      const r = 0.085 + rng() * 0.055
      const { x, z } = dansTouffe(touffesLarges[Math.floor(rng() * touffesLarges.length)])
      const recul = Math.min(1, Math.max(0, x) / 11)
      /*
       * 🟤 Une tige sur douze est SÈCHE.
       *
       * Une touffe de bambou n'est jamais d'un seul vert : les vieux chaumes
       * jaunissent puis brunissent sur pied, au milieu des jeunes. Sans eux, un
       * paquet serré de tiges identiques se lit comme un motif répété — et
       * c'est justement en les groupant qu'on rendrait ce défaut visible.
       */
      const seche = rng() < 0.085
      corps.push({
        geo: GEO.tigeCreuse.clone().scale(r, h, r),
        couleur: seche
          ? teinte(0x8a6f3a, 0x514020, rng())
          : teinte(0x6d8a42, 0x25361b, recul * 0.8 + rng() * 0.2),
        x,
        y: h / 2,
        z,
        rz: (rng() - 0.5) * 0.14,
        rx: (rng() - 0.5) * 0.08,
      })

      /*
       * ⚠️ ELLES AUSSI PORTENT DES FEUILLES. C'était LE manque.
       *
       * Mesuré : la densité de fûts atteignait déjà 3 tiges/m² — une tous les
       * 58 cm — et seuls 19 % des rayons de la caméra traversaient. Ajouter
       * encore des fûts ne pouvait donc rien donner. Ce qu'on voyait n'était
       * pas une forêt trop clairsemée, c'était **un parc à poteaux** : seules
       * les 25 tiges détaillées avaient du feuillage, les 155 d'ici et les 230
       * du fond étaient nues.
       *
       * Or une bambouseraie se lit à sa MASSE DE FEUILLES, jamais à ses fûts.
       * Deux ou trois lames par tige suffisent — à 2 triangles pièce, c'est
       * l'ajout le moins cher et le plus décisif du décor.
       */
      const lames = 3 + Math.floor(rng() * 3)
      for (let k = 0; k < lames; k++) {
        const hy = h * (0.6 + rng() * 0.38)
        feuilles.push({
          geo: GEO.feuille.clone().scale(1.3 + rng() * 1.2, 0.2 + rng() * 0.16, 1),
          couleur: teinte(0x6f9243, 0x2b4322, recul * 0.6 + rng() * 0.4),
          x: x + (rng() - 0.5) * 1.3,
          y: hy,
          z: z + (rng() - 0.5) * 1.3,
          /*
           * ⚠️ ry BRIDÉ À ±0,5 rad, et surtout pas tiré sur un demi-tour.
           *
           * Une feuille est un PLAN : de face elle couvre, par la tranche elle
           * DISPARAÎT. En tirant ry entre 0 et π, la moitié des feuilles se
           * présentaient de profil et ne comptaient pour rien — d'où une forêt
           * qui semblait fournie ici et vide trois mètres plus loin, sans que
           * la quantité de géométrie ait bougé d'un pouce.
           *
           * Le désordre passe donc par rz, qui fait tourner la lame DANS son
           * plan : elle reste visible quel que soit l'angle.
           */
          ry: (rng() - 0.5) * 1.0,
          rz: rng() * Math.PI,
        })
      }
    }

    /*
     * ————— Plan lointain : la masse de la forêt —————
     *
     * Deux fois plus hautes, quasi noires, sans le moindre détail. C'est elles
     * qui ferment l'horizon et donnent l'impression qu'on traverse quelque chose.
     *
     * ⚠️ CE QUI COMPTE ICI EST UNE DENSITÉ PAR SURFACE, PAS UN NOMBRE.
     *
     * L'erreur précédente : 75 tiges étalées sur 20 m de large, quand le plan
     * rapproché en met 50 sur 5,5 m. Mesuré sommet par sommet, la matière
     * s'effondrait d'un facteur **25** dès x = 10,5 m — le « rideau » n'était
     * qu'une poignée de piquets isolés. Selon l'angle de la caméra, on voyait
     * tantôt la bande dense, tantôt le vide derrière : d'où l'impression de
     * bambou par à-coups alors que le comptage le long de la piste, lui, était
     * parfaitement régulier.
     *
     * On raisonne donc en tiges par m² :
     *   · plan rapproché ≈ 50 / (5,5 × 22)  = 0,41 /m²
     *   · plan lointain  ≈ 230 / (18,5 × 24) = 0,52 /m²
     *
     * Le fond est volontairement un peu PLUS dense que le premier plan : c'est
     * lui qui doit se lire comme une masse pleine, alors que devant on veut
     * distinguer les tiges une à une.
     *
     * Le prix reste dérisoire : une tige lointaine fait 4 pans creux, soit
     * 8 triangles, et le massif entier tient toujours en UN appel de dessin.
     */
    const loin = 233 + Math.floor(rng() * 70)
    for (let i = 0; i < loin; i++) {
      const h = 13 + rng() * 11
      const r = 0.11 + rng() * 0.08
      corps.push({
        geo: GEO.tigeLoin.clone().scale(r, h, r),
        couleur: teinte(0x2b3d22, 0x141d12, rng()),
        // 5 → 24 m : le départ à 5 fait DÉBORDER ce plan sur l'intermédiaire
        // (0 → 11), pour que les deux se mélangent au lieu de se toucher.
        x: 5 + rng() * 19,
        y: h / 2,
        z: (rng() - 0.5) * 24,
        rz: (rng() - 0.5) * 0.1,
      })
    }

    /*
     * ————— LA CANOPÉE : ce qui ferme le haut du cadre —————
     *
     * L'autre grand absent. Sur les captures, tout le haut de l'écran était
     * vide : on courait au fond d'un couloir à ciel ouvert bordé de perches.
     * Or ce qui fait dire « forêt » avant tout le reste, c'est d'avoir quelque
     * chose AU-DESSUS de la tête — la lumière filtrée, le ciel bouché.
     *
     * Des lames larges entre 9 et 17 m, penchées vers la piste pour couvrir
     * jusqu'au-dessus du joueur. Elles ne descendent jamais sous 9 m : à
     * 2,4 m de saut maximum, elles ne peuvent gêner aucune lecture de jeu.
     *
     * 2 triangles pièce : c'est l'élément le plus rentable du décor.
     */
    /*
     * ⚠️ DES LAMES PETITES ET COUCHÉES, pas grandes et tirées au hasard.
     *
     * La version précédente est ce qui faisait « respirer » la forêt : de
     * grandes lames (jusqu'à 6 m) dont l'orientation était tirée sur un
     * demi-tour complet. Une lame de face bouchait un pan entier de ciel ; la
     * même de profil disparaissait. On tombait donc, au hasard des massifs, sur
     * des amas très denses puis sur du vide — alors que la quantité de
     * géométrie, elle, ne variait pas de 1 % (mesuré sur toute la course, et
     * sur dix graines).
     *
     * Deux corrections, et elles vont ensemble :
     *  · les lames sont COUCHÉES (rx ≈ −90°, donc face tournée vers le sol).
     *    On regarde une canopée par en dessous : couchée, elle couvre toujours,
     *    quel que soit l'angle. Le désordre passe par ry, qui la fait pivoter
     *    à plat — sans jamais la faire disparaître ;
     *  · elles sont trois fois plus PETITES et deux fois plus nombreuses. Cent
     *    petites lames se moyennent ; trente grandes clignotent.
     */
    const canopee = 190 + Math.floor(rng() * 70)
    for (let i = 0; i < canopee; i++) {
      const hy = 8 + rng() * 12
      feuilles.push({
        geo: GEO.feuille.clone().scale(1.2 + rng() * 1.6, 0.7 + rng() * 1.0, 1),
        couleur: teinte(0x4c6c33, 0x22331a, rng() * 0.9),
        /*
         * ⚠️ De -10 à +18. Le début NÉGATIF est le point clé : le feuillage
         * traverse au-dessus de la piste et rejoint celui d'en face. Sans ce
         * recouvrement, on n'a pas une voûte mais deux haies qui se regardent,
         * et le ciel reste ouvert pile au milieu — là où le joueur regarde.
         */
        x: -10 + rng() * 28,
        y: hy,
        z: (rng() - 0.5) * 24,
        // Couchée, face vers le sol : c'est de là qu'on la regarde.
        rx: -Math.PI / 2 + (rng() - 0.5) * 0.7,
        ry: rng() * Math.PI, // pivote à plat : reste visible d'en dessous
        rz: (rng() - 0.5) * 0.4,
      })
    }

    // ————— Le sol : litière et jeunes pousses —————
    const litiere = 7 + Math.floor(rng() * 6)
    for (let i = 0; i < litiere; i++) {
      feuilles.push({
        geo: GEO.feuille.clone().scale(0.5 + rng() * 1.3, 0.3 + rng() * 0.6, 1),
        couleur: teinte(0x4a4a24, 0x26301a, rng()),
        x: rng() * 6,
        y: 0.03, // à ras du sol, sinon ça scintille contre lui
        z: (rng() - 0.5) * 18,
        rx: -Math.PI / 2,
        ry: rng() * Math.PI,
      })
    }
    const pousses = 5 + Math.floor(rng() * 5)
    for (let i = 0; i < pousses; i++) {
      const h = 0.8 + rng() * 1.8
      corps.push({
        geo: GEO.tigeCreuse.clone().scale(0.05, h, 0.05),
        couleur: teinte(0x86a352, 0x4e6a30, rng()),
        x: rng() * 6,
        y: h / 2,
        z: (rng() - 0.5) * 18,
        rz: (rng() - 0.5) * 0.4,
      })
    }

    return groupe(assemble(corps, MAT_SOLIDE), assemble(feuilles, MAT_FEUILLE))
  },

  /*
   * ————— Les obstacles de la forêt —————
   *
   * La règle qui prime sur tout le reste : **la couleur reste sémantique**.
   * Le vermillon dit « saute », l'or dit « glisse », le sombre dit « change de
   * ligne ». À 28 m/s, on lit la couleur avant la forme — un joueur n'a pas le
   * temps d'analyser une silhouette. Tout habiller en vert bambou aurait été
   * plus joli et beaucoup moins jouable.
   *
   * Le bambou apporte donc la MATIÈRE (tiges, nœuds, ligatures), et l'accent de
   * couleur d'origine reste bien visible sur chacun.
   */
  fabriqueObstacle: (kind, rng) => {
    const p: Piece[] = []

    if (kind === 'saut') {
      // Un gros tronc couché en travers de la ligne : ça se saute.
      const r = 0.26
      p.push({
        geo: GEO.tige.clone().scale(r, 1.75, r),
        couleur: teinte(0x8a9a52, 0x5d6b34, rng()),
        x: 0, y: 0.3, z: 0,
        rz: Math.PI / 2, // le cylindre est vertical par défaut : on le couche
      })
      // Les nœuds du tronc
      for (const nx of [-0.5, 0, 0.5]) {
        p.push({
          geo: GEO.anneau.clone().scale(r * 1.15, 0.09, r * 1.15),
          couleur: 0x9fb268,
          x: nx, y: 0.3, z: 0, rz: Math.PI / 2,
        })
      }
      // Les ligatures VERMILLON : c'est elles qu'on voit arriver de loin.
      for (const nx of [-0.68, 0.68]) {
        p.push({
          geo: GEO.anneau.clone().scale(r * 1.3, 0.16, r * 1.3),
          couleur: 0xc33a2c,
          x: nx, y: 0.3, z: 0, rz: Math.PI / 2,
        })
      }
      // Deux billots qui le calent : sans eux, le tronc a l'air de flotter.
      for (const nx of [-0.8, 0.8]) {
        p.push({
          geo: GEO.tige.clone().scale(0.13, 0.3, 0.13),
          couleur: 0x4a4028,
          x: nx, y: 0.15, z: 0.2,
        })
      }
    } else if (kind === 'glissade') {
      // Une perche tendue en hauteur : on passe DESSOUS.
      const r = 0.19
      p.push({
        geo: GEO.tige.clone().scale(r, 1.75, r),
        couleur: teinte(0x8a9a52, 0x64703a, rng()),
        x: 0, y: 1.55, z: 0,
        rz: Math.PI / 2,
      })
      // Les cordages DORÉS, l'accent de couleur du « glisse »
      for (const nx of [-0.55, 0.55]) {
        p.push({
          geo: GEO.anneau.clone().scale(r * 1.45, 0.2, r * 1.45),
          couleur: 0xd6ac5a,
          x: nx, y: 1.55, z: 0, rz: Math.PI / 2,
        })
      }
      /*
       * Les deux montants qui la portent.
       *
       * Volontairement FINS, et plantés au bord exact de la ligne (±0,85 m) :
       * ils expliquent pourquoi la perche tient en l'air sans encombrer le
       * centre de la voie, là où l'on court.
       *
       * ⚠️ Ils DESCENDENT SOUS LA BOÎTE, et c'est voulu. La boîte de la
       * glissade couvre toute la largeur de la ligne entre 1,30 m et 1,80 m —
       * pas un centimètre plus bas. Un joueur qui glisse traverse donc les
       * montants sans rien heurter : ils portent la barre, ils ne barrent pas
       * le passage. Les faire épais laisserait croire le contraire.
       */
      for (const nx of [-0.85, 0.85]) {
        p.push({
          geo: GEO.tige.clone().scale(0.07, 1.95, 0.07),
          couleur: 0x5a6636,
          x: nx, y: 0.97, z: 0,
        })
      }
    } else {
      // Une palissade dense : infranchissable, il faut changer de ligne.
      const n = 7
      for (let i = 0; i < n; i++) {
        const x = -0.75 + (1.5 / (n - 1)) * i
        const h = 2.4 - rng() * 0.18 // des hauteurs inégales : c'est bâti à la main
        // Du bambou vieilli, presque noir : dans une forêt verte, une palissade
        // bleu-ardoise jurait. C'est la VALEUR (très sombre) qui dit
        // « infranchissable », pas la teinte — on peut donc rester dans le bois.
        p.push({
          geo: GEO.tige.clone().scale(0.12, h, 0.12),
          couleur: teinte(0x36432a, 0x1b2416, rng()),
          x, y: h / 2, z: 0,
          rz: (rng() - 0.5) * 0.05,
        })
        // Une pointe taillée en haut de chaque pieu
        p.push({
          geo: GEO.sapin.clone().scale(0.13, 0.26, 0.13),
          couleur: 0x222c1b,
          x, y: h + 0.11, z: 0,
        })
      }
      // Les deux traverses de ligature qui tiennent l'ensemble
      for (const hy of [0.7, 1.85]) {
        p.push({
          geo: GEO.tige.clone().scale(0.08, 1.68, 0.08),
          couleur: 0x574a33,
          x: 0, y: hy, z: -0.16,
          rz: Math.PI / 2,
        })
      }
    }

    return groupe(assemble(p, MAT_SOLIDE))
  },

  /*
   * ————— Le radeau de bambou —————
   *
   * L'équivalent forestier du wagon : un train de perches liées, qu'on
   * charriait sur les chemins. La forme est choisie pour l'étirement — ce sont
   * des perches COUCHÉES DANS LE SENS DE LA LONGUEUR, donc les rallonger est
   * exactement ce qu'on veut quand la plateforme s'étire. Un tonneau ou une
   * caisse se seraient déformés en bouillie.
   *
   * Le liseré vermillon du nez reprend celui des pans de mur : c'est devenu le
   * langage des surfaces qu'on UTILISE, par opposition aux obstacles qu'on
   * subit. Il est posé par la piste, pas ici (cf. la fabrique plus bas).
   *
   * ————— 🎋 DEUX RADEAUX, ET C'EST LA RAMPE QUI LES SÉPARE —————
   *
   * 1. AVEC RAMPE — un radeau PLEIN, qu'on monte en courant par sa pente. Ses
   *    flancs sont une pile de perches jusqu'au sol : rien à voir dessous, et
   *    rien à y faire. Y ménager un tunnel serait un mensonge, puisque la rampe
   *    emmène en haut et que personne n'arriverait jamais en dessous.
   *
   * 2. SANS RAMPE — le radeau sur PILOTIS : des poteaux espacés, on voit au
   *    travers, et c'est le seul passage bas de la course. C'est LUI le tunnel.
   *
   * Le tunnel se lit au pied de la lettre. On entre PAR L'ENTRÉE :
   *
   *  · par l'AVANT  → on passe ;
   *  · par les CÔTÉS → refusé, `flancA` retient le changement de ligne tant
   *    qu'on est sous la hauteur du tablier (et laisse passer au ras du nez,
   *    ce qui EST l'entrée) ;
   *  · par le TOIT  → refusé, `TUNNEL_HAUT` pose un plafond sous le tablier.
   *    Sauter à l'intérieur cognait autrefois au-delà du seuil des 2,40 m et
   *    l'on ressortait sur le dessus.
   *
   * Et l'on peut TOUJOURS courir sur le dessus, dans les deux cas : le tablier
   * porte, ajouré ou non.
   *
   * ⚠️ Le drapeau ci-dessous dit seulement que ce biome SAIT bâtir des radeaux
   * ajourés. C'est `ajouree()`, dans track.ts, qui croise ce drapeau avec la
   * rampe — et c'est la même condition qui choisit le maillage ici, pour que le
   * dessin et la règle ne puissent pas diverger.
   */
  plateformeAjouree: true,

  fabriquePlateforme: (hauteur, largeur, avecRampe) => {
    const p: Piece[] = []

    // Le corps : cinq perches côte à côte, couchées en long. Cinq et non
    // quatre depuis l'élargissement des lignes — à quatre, le radeau montrait
    // des jours entre ses troncs.
    const perches = 5
    const pas = (largeur - 0.44) / (perches - 1)
    for (let i = 0; i < perches; i++) {
      p.push({
        geo: GEO.tige.clone().scale(0.22, 1, 0.22),
        couleur: i % 2 ? 0x4d5c30 : 0x3e4b27,
        x: -(largeur - 0.44) / 2 + pas * i,
        y: hauteur - 0.55,
        z: 0,
        rx: Math.PI / 2, // couchée le long de la plateforme
      })
    }

    // Le tablier du dessus, sur lequel on court. C'est LUI qu'on voit d'en
    // haut : il reste en bambou clair, et c'est ce qui remplace l'ancienne
    // barre vermillon qui coiffait la plateforme.
    p.push({
      geo: GEO.bloc.clone().scale(largeur, 0.22, 1),
      couleur: 0x6b7d3f,
      x: 0, y: hauteur - 0.11, z: 0,
    })

    if (avecRampe) {
      /*
       * ————— 1. LE RADEAU PLEIN —————
       *
       * Ses flancs sont une PILE de perches couchées, du sol au tablier. On les
       * couche dans le sens de la longueur comme celles du dessus : c'est la
       * seule forme qui survive à l'étirement en Z sans se déformer.
       *
       * Rien ne se voit au travers, et c'est le but : ce radeau-là se monte par
       * sa pente, il n'a pas de dessous à montrer.
       */
      /*
       * ⚠️ LE CŒUR PLEIN, sous les perches.
       *
       * Les deux piles de perches ne faisaient que border : entre elles,
       * l'intérieur restait vide et l'on voyait au travers de face. Un radeau
       * qu'on monte par une pente est une masse — c'est ce qui le sépare de sa
       * jumelle sur pilotis, et deux flancs n'y suffisent pas.
       *
       * Le bloc est en retrait des perches : il les remplit sans jamais les
       * déborder, sinon on verrait une caisse là où l'on veut voir un fagot.
       */
      p.push({
        geo: GEO.bloc.clone().scale(largeur - 0.5, hauteur - 0.3, 1),
        couleur: 0x2f3a1e,
        x: 0, y: (hauteur - 0.3) / 2, z: 0,
      })

      const etages = Math.max(2, Math.floor((hauteur - 0.66) / 0.42))
      for (const cote of [-1, 1]) {
        for (let e = 0; e < etages; e++) {
          const y = 0.24 + e * ((hauteur - 0.9) / Math.max(1, etages - 1))
          p.push({
            geo: GEO.tige.clone().scale(0.21, 1, 0.21),
            couleur: e % 2 ? 0x3e4b27 : 0x33401f,
            x: cote * (largeur / 2 - 0.19),
            y,
            z: 0,
            rx: Math.PI / 2,
          })
        }
      }
      // Deux traverses verticales qui ceinturent la pile : sans elles, les
      // perches empilées se lisent comme un tas plutôt que comme un radeau lié.
      for (const cote of [-1, 1]) {
        p.push({
          geo: GEO.bloc.clone().scale(0.07, hauteur - 0.5, 0.16),
          couleur: 0x574a33,
          x: cote * (largeur / 2 - 0.19),
          y: (hauteur - 0.5) / 2,
          z: 0.34,
        })
      }
    } else {
      /*
       * ————— 2. LE RADEAU SUR PILOTIS : le TUNNEL —————
       *
       * Des poteaux ESPACÉS, et non deux parois pleines. C'était le défaut
       * filmé : le radeau se dessinait fermé sur ses côtés alors que la règle
       * laissait passer dessous — on traversait donc ce qui avait l'air massif.
       *
       * ⚠️ Ils sont plantés au bord EXACT de la ligne et restent fins : ils
       * expliquent que le tablier tienne sans jamais se trouver là où l'on
       * court. Le passage doit se voir libre pour qu'on ose s'y engager.
       *
       * ⚠️ Leur `z` est en LOCAL, sur une pièce bâtie sur 1 m puis étirée : ils
       * s'écarteront donc avec la longueur du radeau, exactement comme des
       * pilotis régulièrement espacés. C'est le seul cas où l'étirement joue en
       * notre faveur — un poteau vertical ne s'allonge pas, il se déplace.
       */
      for (const cote of [-1, 1]) {
        for (const z of [-0.34, 0, 0.34]) {
          p.push({
            geo: GEO.tige.clone().scale(0.105, hauteur - 0.66, 0.105),
            couleur: 0x2b3320,
            x: cote * (largeur / 2 - 0.15),
            y: (hauteur - 0.66) / 2,
            z,
          })
        }
      }
      // Une lisse basse qui court d'un pilotis à l'autre, à hauteur de cheville :
      // elle borde le tunnel sans le fermer, et donne au passage un seuil.
      for (const cote of [-1, 1]) {
        p.push({
          geo: GEO.tige.clone().scale(0.06, 1, 0.06),
          couleur: 0x3e4b27,
          x: cote * (largeur / 2 - 0.15),
          y: 0.34,
          z: 0,
          rx: Math.PI / 2,
        })
      }
    }

    /*
     * ⚠️ PAS DE VERMILLON ICI. Le liseré du nez est posé par la piste, en
     * mètres, sur son propre maillage (cf. `nez` dans track.ts).
     *
     * Il a vécu ici, et c'était le bug. Les 5 cm dont parlait le commentaire
     * étaient son ÉPAISSEUR ; sa longueur, elle, valait 1 — soit toute la pièce,
     * qui est ensuite étirée à la longueur du radeau. Sur un radeau de 25 m, la
     * bande faisait donc 25 m de long : tout le dessus virait au rouge, et le
     * « repère sur le nez » se lisait comme un tapis déroulé.
     *
     * La règle est la même que pour la rampe : ce qui doit garder sa taille en
     * mètres ne peut pas être un enfant de ce qu'on étire.
     */
    return groupe(assemble(p, MAT_SOLIDE))
  },
}

/* ————————————————————————————————————————————————————————————————
 *  2 · VILLAGE EN FLAMMES 火 — le chaos orange
 * ———————————————————————————————————————————————————————————————— */

/**
 * Le biome le plus dense en fumée (brumeFar tombe à 72) : on y voit moins loin,
 * donc on y réagit plus vite. C'est voulu — c'est le pic de tension de la course,
 * placé pile au moment où le joueur maîtrise ses contrôles.
 *
 * 🚧 C'est ici que viendront les TOITS (le chemin qui monte) et les culs-de-sac
 * à escalader. Pour l'instant : le décor et la palette seulement.
 */
const VILLAGE: Biome = {
  nom: 'Village en flammes',
  kanji: '火',
  brume: 0x2e1a12,
  brumeNear: 26,
  brumeFar: 72,
  sol: 0x36251a,
  ligne: 0x6b3a20,
  murCorps: 0x241610, // un mur de torchis noirci par le feu
  ecartDecor: 15,

  // 🔥 Le seul biome qui s'ENTEND avant de se voir : sa nappe de brasier monte
  // pendant qu'on y entre, et c'est elle qui annonce le pic de tension.
  ambiance: 'feu',

  /*
   * Terre battue de village, jonchée de cendres et de débris calcinés. Les
   * taches claires sont des braises retombées : elles doivent rester rares,
   * sinon le sol se met à concurrencer les vrais feux du décor.
   */
  texSol: () =>
    texturePour('village', (t) => {
      const r = dé(0x51c2)
      t.fond('#e8ded6')
      for (let i = 0; i < 24; i++) {
        const v = 176 + Math.floor(r() * 60)
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 22 + r() * 40, 16 + r() * 30, r() * Math.PI, `rgb(${v},${v - 10},${v - 16})`)
        )
      }
      // La cendre : des plaques grises et froides.
      for (let i = 0; i < 16; i++) {
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 10 + r() * 20, 8 + r() * 16, r() * Math.PI, 'rgb(214,210,206)')
        )
      }
      // Les débris calcinés : petits, très sombres, éparpillés.
      for (let i = 0; i < 60; i++) {
        const v = 96 + Math.floor(r() * 40)
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 1.4 + r() * 3, 2 + r() * 6, r() * Math.PI, `rgb(${v},${v - 6},${v - 8})`)
        )
      }
      // Quelques braises retombées.
      for (let i = 0; i < 7; i++) {
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 1.5 + r() * 2, 1.5 + r() * 2, 0, 'rgb(255,236,206)')
        )
      }
    }),
  tuileSol: 6,

  /*
   * 🔥 L'ÉCHAFAUD DU VILLAGE — et le feu qui court dessous.
   *
   * Des madriers noircis montés sur pilotis, comme une passerelle bâtie pour
   * enjamber les décombres. Sa variante ajourée est le seul endroit du biome où
   * l'on passe SOUS quelque chose, et ce quelque chose brûle : les braises sont
   * posées au pied des poteaux, à hauteur de cheville.
   *
   * ⚠️ Elles ne blessent pas. Rien dans ce jeu ne tue, et un feu qui ferait
   * exception ici obligerait à réapprendre la piste au pire endroit — le pic de
   * tension. Elles disent « ce passage est risqué » ; c'est l'obscurité du
   * biome, pas le feu, qui le rend vraiment difficile.
   */
  plateformeAjouree: true,

  /*
   * ————— 🔥 Les obstacles du village : du BOIS BRÛLÉ —————
   *
   * Le biome apporte sa matière — des poutres carbonisées, tombées de charpentes
   * qui ont cédé — et l'accent de couleur reste celui du jeu : vermillon pour
   * « saute », or pour « glisse », sombre pour « change de ligne ».
   *
   * ⚠️ LE FEU EST UN ACCENT, PAS LA LECTURE. Il aurait été tentant de tout
   * embraser, mais c'est le biome le plus sombre du jeu ET celui où l'on voit le
   * moins loin (72 m) : une braise sur chaque obstacle noierait le seul signal
   * qui compte — la couleur qui dit QUOI FAIRE. Les braises ne se posent donc
   * que là où elles ne trompent pas : sous une poutre au sol, jamais sur la
   * barre qu'il faut lire.
   */
  fabriqueObstacle: (kind, rng) => {
    const corps: Piece[] = []
    const feux: Piece[] = []
    const CHARBON = 0x1d1410
    const BOIS = 0x3a2a1c

    if (kind === 'saut') {
      // Une poutre de charpente tombée en travers : ça s'enjambe.
      corps.push({
        geo: GEO.bloc.clone().scale(1.9, 0.34, 0.34),
        couleur: teinte(BOIS, CHARBON, rng()),
        x: 0, y: 0.3, z: 0,
        rz: (rng() - 0.5) * 0.06,
      })
      // Les ferrures VERMILLON : c'est elles qu'on voit arriver de loin.
      for (const nx of [-0.62, 0.62]) {
        corps.push({
          geo: GEO.bloc.clone().scale(0.12, 0.42, 0.42),
          couleur: 0xc33a2c,
          x: nx, y: 0.3, z: 0,
        })
      }
      // Deux moellons qui la calent : sans eux, la poutre a l'air de flotter.
      for (const nx of [-0.88, 0.88]) {
        corps.push({
          geo: GEO.caillou.clone().scale(0.18, 0.14, 0.16),
          couleur: 0x2b2119,
          x: nx, y: 0.09, z: 0.2,
          ry: rng() * Math.PI,
        })
      }
      // Les braises SOUS la poutre : elles la soulignent sans la masquer.
      for (const nx of [-0.4, 0.15, 0.55]) {
        feux.push({
          geo: GEO.bloc.clone().scale(0.16, 0.09, 0.1),
          couleur: teinte(0xffc25c, 0xbf2f1e, rng()),
          x: nx, y: 0.06, z: 0.19,
        })
      }
    } else if (kind === 'glissade') {
      // Une panne de toiture restée en l'air : on passe DESSOUS.
      corps.push({
        geo: GEO.bloc.clone().scale(1.8, 0.3, 0.3),
        couleur: teinte(BOIS, CHARBON, rng() * 0.6),
        x: 0, y: 1.55, z: 0,
        rz: (rng() - 0.5) * 0.05,
      })
      // Les liens DORÉS, l'accent du « glisse » — le même que partout ailleurs.
      for (const nx of [-0.56, 0.56]) {
        corps.push({
          geo: GEO.anneau.clone().scale(0.23, 0.19, 0.23),
          couleur: 0xd6ac5a,
          x: nx, y: 1.55, z: 0, rz: Math.PI / 2,
        })
      }
      /*
       * Les deux montants, au bord EXACT de la ligne (±0,85 m) et volontairement
       * fins : ils expliquent que la panne tienne sans encombrer le centre de la
       * voie.
       *
       * ⚠️ Ils descendent SOUS la boîte, qui ne couvre que 1,30 m à 1,80 m : on
       * les traverse en glissant, et c'est ce qu'il faut. Un montant épais
       * laisserait croire qu'il barre aussi.
       */
      for (const nx of [-0.85, 0.85]) {
        corps.push({
          geo: GEO.bloc.clone().scale(0.1, 1.7, 0.1),
          couleur: CHARBON,
          x: nx, y: 0.85, z: 0,
          rz: (rng() - 0.5) * 0.04,
        })
      }
    } else {
      /*
       * Un pan de mur effondré : infranchissable, il faut changer de ligne.
       *
       * C'est la VALEUR très sombre qui dit « on ne passe pas », pas la teinte —
       * exactement comme la palissade de la forêt. Dans un biome orange, un
       * obstacle noir tranche mieux qu'un obstacle rouge.
       */
      const n = 5
      for (let i = 0; i < n; i++) {
        const h = 2.4 - rng() * 0.22
        corps.push({
          geo: GEO.bloc.clone().scale(1.6 / n - 0.02, h, 0.34),
          couleur: teinte(0x241610, 0x0e0a08, rng()),
          x: -0.72 + (1.44 / (n - 1)) * i,
          y: h / 2, z: 0,
          rz: (rng() - 0.5) * 0.04,
        })
      }
      // Les deux entretoises qui tiennent encore le pan debout.
      for (const hy of [0.75, 1.9]) {
        corps.push({
          geo: GEO.bloc.clone().scale(1.7, 0.13, 0.12),
          couleur: 0x3d2a1c,
          x: 0, y: hy, z: -0.18,
        })
      }
      // Un reste de braise à son pied : le mur a brûlé, il fume encore.
      feux.push({
        geo: GEO.bloc.clone().scale(0.9, 0.08, 0.1),
        couleur: 0xbf2f1e,
        x: 0, y: 0.05, z: 0.2,
      })
    }

    return groupe(assemble(corps, MAT_SOLIDE), assemble(feux, MAT_LUMIERE))
  },

  fabriquePlateforme: (hauteur, largeur, avecRampe) =>
    plateformeSimple(hauteur, largeur, avecRampe, {
      tablier: 0x4a3524, // du bois roussi, pas encore charbon
      corps: [0x33241a, 0x281c13],
      pilotis: 0x1d1410, // presque noir : les poteaux ont pris le plus de feu
      lueurs: (dans, h, l, ajoure) => {
        /*
         * Les braises. Sous un tunnel elles courent au SOL, entre les pilotis —
         * c'est ce qu'on longe en passant. Sur un radeau plein il n'y a pas de
         * dessous : elles remontent alors le long des flancs, comme un feu qui
         * lèche la structure.
         */
        const bas = ajoure ? 0.12 : h * 0.45
        for (const cote of [-1, 1]) {
          for (const z of [-0.3, 0.08, 0.36]) {
            dans.push({
              geo: GEO.bloc.clone().scale(0.16, 0.3, 0.12),
              couleur: teinte(0xffc25c, 0xbf2f1e, Math.abs(z)),
              x: cote * (l / 2 - 0.06),
              y: bas + Math.abs(z) * 0.5,
              z,
              rz: cote * 0.25,
            })
          }
        }
        // Une braise plus vive sur le nez : elle donne le bord d'entrée, là où
        // le vermillon du liseré ne suffit pas dans un biome déjà orange.
        dans.push({
          geo: GEO.bloc.clone().scale(l * 0.5, 0.14, 0.1),
          couleur: 0xffd98a,
          x: 0, y: h - 0.3, z: 0.44,
        })
      },
    }),

  // Une clôture de village à moitié brûlée : des pieux noircis, inégaux, et
  // une seule traverse qui tient encore. Les pointes cassées font le reste.
  fabriqueBarriere: () =>
    barriereSimple(
      {
        pieu: { couleur: [0x2f1e15, 0x140c08], r: 0.075, h: 1.05, ecart: 1.2 },
        lisses: [{ y: 0.7, r: 0.055, couleur: 0x241811 }],
        pointe: 0x120b07,
      },
      dé(0x0b2)
    ),

  // Un mur de torchis noirci, ceinturé de deux poutres carbonisées.
  fabriqueMur: () =>
    murSimple({
      corps: 0x241610,
      socle: 0x120b07,
      couronne: 0x1a100c, // les tuiles noircies qui coiffent le mur
      bandes: [
        { y: 1.05, e: 0.16, couleur: 0x1a100c },
        { y: 2.4, e: 0.16, couleur: 0x1a100c },
        { y: 3.75, e: 0.16, couleur: 0x1a100c },
        { y: 5.05, e: 0.16, couleur: 0x1a100c },
      ],
    }),
  fabriqueDecor: (rng) => {
    const corps: Piece[] = []
    const feux: Piece[] = []

    // Une masure : un corps sombre et un toit. Volontairement simple — à 28 m/s
    // on ne lit qu'une silhouette.
    const h = 3 + rng() * 2.5
    const larg = 3.2 + rng() * 1.6
    const x = rng() * 2.2
    corps.push({
      geo: GEO.bloc.clone().scale(larg, h, 3.4 + rng() * 1.8),
      couleur: teinte(0x2a1a13, 0x150d09, rng()),
      x, y: h / 2, z: 0,
    })
    corps.push({
      geo: GEO.cone.clone().scale(larg * 0.95, 1.6, larg * 0.95),
      couleur: 0x1a100c,
      x, y: h + 0.8, z: 0,
      ry: Math.PI / 4,
    })

    // Des poutres effondrées : c'est ce qui dit « en ruine » plutôt que « maison ».
    const poutres = 1 + Math.floor(rng() * 3)
    for (let i = 0; i < poutres; i++) {
      corps.push({
        geo: GEO.bloc.clone().scale(0.18, 0.18, 2.5 + rng() * 2),
        couleur: 0x1c120d,
        x: x + (rng() - 0.5) * 4,
        y: 0.3 + rng() * 1.5,
        z: (rng() - 0.5) * 4,
        rx: (rng() - 0.5) * 1.2,
        ry: rng() * Math.PI,
      })
    }

    // Un second rang de maisons, plus loin et plus sombre : le village a une
    // profondeur, ce n'est pas une rangée de façades.
    if (rng() < 0.7) {
      const h2 = 2.5 + rng() * 3
      corps.push({
        geo: GEO.bloc.clone().scale(4 + rng() * 3, h2, 4),
        couleur: 0x140c08,
        x: 7 + rng() * 6,
        y: h2 / 2,
        z: (rng() - 0.5) * 8,
      })
    }

    /*
     * Les braises : des blocs émissifs, SANS lumière réelle.
     * Une vraie PointLight par maison coûterait une passe d'ombre à chaque
     * image — ici c'est gratuit, et à cette vitesse l'œil ne fait pas la
     * différence. Elles gardent la brume : un feu qui resterait net à 90 m
     * alors que tout s'estompe trahirait le truc.
     */
    const nFeux = 2 + Math.floor(rng() * 4)
    for (let i = 0; i < nFeux; i++) {
      const t = rng()
      feux.push({
        geo: GEO.bloc.clone().scale(0.25 + rng() * 0.4, 0.5 + rng() * 1.1, 0.3),
        couleur: teinte(0xffc25c, 0xbf2f1e, t),
        x: x + (rng() - 0.5) * 4,
        y: 0.4 + rng() * h,
        z: (rng() - 0.5) * 3.5,
        rz: (rng() - 0.5) * 0.5,
      })
    }

    return groupe(assemble(corps, MAT_SOLIDE), assemble(feux, MAT_LUMIERE))
  },
}

/* ————————————————————————————————————————————————————————————————
 *  3 · PONT AU CLAIR DE LUNE 月 — le vide bleu
 * ———————————————————————————————————————————————————————————————— */

/**
 * C'est la palette d'origine du jeu, conservée telle quelle : elle marchait, et
 * elle prend tout son sens maintenant qu'elle n'occupe plus toute la course mais
 * un acte précis — le calme tendu entre les flammes et le sommet.
 *
 * Ici le décor est BAS et clairsemé : rien ne borde la piste que des poteaux de
 * rambarde. Le vide autour est le sujet.
 */
const PONT: Biome = {
  nom: 'Pont au clair de lune',
  kanji: '月',
  brume: 0x151a2c,
  brumeNear: 30,
  brumeFar: 92,
  sol: 0x272d3f,
  ligne: 0x3d4560,
  murCorps: 0x2b3145, // la rambarde d'ardoise du pont — la teinte d'origine
  ecartDecor: 8,

  /*
   * Le tablier du pont : des PLANCHES, donc des bandes nettes en travers de la
   * course. C'est le seul sol du jeu qui ait droit à un motif régulier, et ce
   * n'est pas une entorse : une planche traverse toute la largeur, là où un
   * marquage routier suit la course. La lecture est opposée.
   *
   * Et le défilement des joints donne à ce biome-là un repère de vitesse que
   * le vide alentour lui refuse.
   */
  texSol: () =>
    texturePour('pont', (t) => {
      const r = dé(0x2f70)
      t.fond('#e6e6ea')
      const planches = 6
      const pas = TUILE / planches
      for (let i = 0; i < planches; i++) {
        const v = 208 + Math.floor(r() * 40)
        t.ctx.fillStyle = `rgb(${v},${v - 2},${v + 4})`
        t.ctx.fillRect(0, i * pas, TUILE, pas - 2)
        // Le joint entre deux planches.
        t.ctx.fillStyle = 'rgb(150,150,162)'
        t.ctx.fillRect(0, i * pas + pas - 2, TUILE, 2)
        // Le fil du bois, dans le sens de la planche.
        for (let k = 0; k < 7; k++) {
          const w = 170 + Math.floor(r() * 50)
          t.ctx.fillStyle = `rgb(${w},${w},${w + 6})`
          t.ctx.fillRect(r() * TUILE, i * pas + 2 + r() * (pas - 6), 14 + r() * 50, 1)
        }
      }
    }),
  tuileSol: 4,

  /*
   * 🏮 LA PASSERELLE DE PLANCHES — et ses petites lanternes.
   *
   * Le biome le plus froid et le plus sombre : sa plateforme est en bois clair,
   * la seule matière chaude du décor, et elle porte des lanternes minuscules.
   *
   * ⚠️ MINUSCULES, et c'est le réglage qui compte. Le pont est le biome où l'on
   * voit le moins de points chauds — une seule lanterne tous les ~30 m dans son
   * décor. En poser de grosses sur chaque plateforme ferait de la piste un
   * lampion et annulerait ce que ce biome raconte : l'obscurité et le vide. Six
   * petites lueurs suffisent à faire lire « on peut aller là ».
   */
  plateformeAjouree: true,

  /*
   * ————— 🏮 Les obstacles du pont : le CHANTIER d'un ouvrage —————
   *
   * Sa matière à lui : des planches clouées, des cordages, et le papier des
   * lanternes. Un pont en travaux, barré de ce qu'on y a laissé — c'est la seule
   * lecture qui explique des obstacles au milieu d'un tablier.
   *
   * ⚠️ LE BIOME LE PLUS SOMBRE APRÈS LE VILLAGE, et le plus froid. Tout y vire à
   * l'indigo, donc un obstacle indigo disparaîtrait. Les trois sont bâtis en
   * BOIS CLAIR — la seule matière chaude du décor, celle des plateformes — et
   * l'accent de couleur les départage : vermillon « saute », or « glisse »,
   * ardoise noire « change de ligne ».
   *
   * 🏮 La lanterne trouve ici son emploi le plus juste : suspendue à un cordage
   * tendu en travers, elle EST le signal « baisse-toi ». C'est le seul biome où
   * l'accent doré est aussi une source de lumière, et non une peinture.
   */
  fabriqueObstacle: (kind, rng) => {
    const corps: Piece[] = []
    const lueurs: Piece[] = []
    const BOIS = 0x7a6242
    const BOIS_SOMBRE = 0x4a3a2c
    const ARDOISE = 0x2b3145

    if (kind === 'saut') {
      // Un chevalet de charpentier posé en travers : ça s'enjambe.
      corps.push({
        geo: GEO.bloc.clone().scale(1.85, 0.2, 0.3),
        couleur: teinte(BOIS, BOIS_SOMBRE, rng() * 0.5),
        x: 0, y: 0.5, z: 0,
      })
      // La bande VERMILLON, en plein sur le dessus : c'est elle qu'on lit.
      corps.push({
        geo: GEO.bloc.clone().scale(1.9, 0.09, 0.34),
        couleur: 0xc33a2c,
        x: 0, y: 0.58, z: 0,
      })
      // Les quatre pieds, croisés comme ceux d'un vrai chevalet.
      for (const nx of [-0.66, 0.66]) {
        for (const c of [-1, 1]) {
          corps.push({
            geo: GEO.bloc.clone().scale(0.08, 0.52, 0.08),
            couleur: BOIS_SOMBRE,
            x: nx + c * 0.06, y: 0.26, z: c * 0.11,
            rz: c * 0.14,
          })
        }
      }
    } else if (kind === 'glissade') {
      // Un cordage tendu d'une rambarde à l'autre : on passe DESSOUS.
      corps.push({
        geo: GEO.tige.clone().scale(0.07, 1.8, 0.07),
        couleur: 0x8a7a5c,
        x: 0, y: 1.62, z: 0,
        rz: Math.PI / 2,
      })
      /*
       * 🏮 Trois lanternes de papier qui y pendent. Ce sont elles l'accent DORÉ
       * du « glisse » — et ici il éclaire vraiment, au lieu d'être peint.
       */
      for (const nx of [-0.55, 0, 0.55]) {
        // La ficelle : sans elle, la lanterne flotte sous la corde.
        corps.push({
          geo: GEO.bloc.clone().scale(0.02, 0.1, 0.02),
          couleur: 0x8a7a5c,
          x: nx, y: 1.55, z: 0,
        })
        lueurs.push({
          geo: GEO.bloc.clone().scale(0.2, 0.26, 0.2),
          couleur: 0xffcf87,
          x: nx, y: 1.4, z: 0,
        })
      }
      // Les deux mâts qui tendent le cordage, au bord exact de la ligne.
      for (const nx of [-0.85, 0.85]) {
        corps.push({
          geo: GEO.bloc.clone().scale(0.09, 1.78, 0.09),
          couleur: 0x4a3a4e,
          x: nx, y: 0.89, z: 0,
        })
      }
    } else {
      /*
       * Une pile de caisses de chantier : infranchissable, il faut s'écarter.
       *
       * C'est la VALEUR très sombre qui dit « on ne passe pas ». Les cerclages
       * de bois clair suffisent à ce qu'on lise des caisses et non un bloc, sans
       * jamais éclaircir l'ensemble.
       */
      const rangs = [
        { y: 0.4, n: 2, h: 0.8 },
        { y: 1.2, n: 2, h: 0.8 },
        { y: 2.0, n: 1, h: 0.8 },
      ]
      for (const r of rangs) {
        for (let i = 0; i < r.n; i++) {
          const larg = 1.66 / r.n
          corps.push({
            geo: GEO.bloc.clone().scale(larg - 0.04, r.h - 0.04, 0.34),
            couleur: teinte(ARDOISE, 0x151a2c, rng()),
            x: -0.83 + larg * (i + 0.5),
            y: r.y, z: 0,
            rz: (rng() - 0.5) * 0.03,
          })
          // Le cerclage clair : deux traverses par caisse, en croix plate.
          corps.push({
            geo: GEO.bloc.clone().scale(larg - 0.04, 0.06, 0.37),
            couleur: BOIS_SOMBRE,
            x: -0.83 + larg * (i + 0.5),
            y: r.y, z: 0,
          })
        }
      }
    }

    return groupe(assemble(corps, MAT_SOLIDE), assemble(lueurs, MAT_LUMIERE))
  },

  fabriquePlateforme: (hauteur, largeur, avecRampe) =>
    plateformeSimple(hauteur, largeur, avecRampe, {
      tablier: 0x7a6242, // des planches claires : elles doivent trancher sur l'indigo
      corps: [0x4a3a2c, 0x3b2f24],
      pilotis: 0x2f2733,
      lueurs: (dans, h, l, ajoure) => {
        /*
         * Les lanternes pendent SOUS le tablier quand on passe dessous, et se
         * dressent SUR lui quand on court dessus. Dans les deux cas elles
         * éclairent le chemin qu'on emprunte réellement — une lanterne posée
         * du mauvais côté serait un décor, pas un repère.
         */
        for (const cote of [-1, 1]) {
          for (const z of [-0.3, 0.06, 0.42]) {
            dans.push({
              geo: GEO.bloc.clone().scale(0.13, 0.19, 0.13),
              couleur: 0xffcf87,
              x: cote * (l / 2 - 0.11),
              y: ajoure ? h - 0.42 : h + 0.16,
              z,
            })
          }
        }
      },
    }),

  /*
   * La rambarde du pont. Volontairement la plus BASSE et la plus ajourée des
   * quatre : ici le sujet est le vide autour, et une bordure pleine le
   * boucherait — on perdrait le seul biome qui fait peur.
   */
  fabriqueBarriere: () =>
    barriereSimple(
      {
        pieu: { couleur: [0x4a3a4e, 0x372c3d], r: 0.08, h: 1.1, ecart: 2 },
        lisses: [
          { y: 0.5, r: 0.05, couleur: 0x53425a },
          { y: 1.02, r: 0.065, couleur: 0x5e4b66 },
        ],
      },
      dé(0x0b3)
    ),

  // Le parapet d'ardoise : deux assises de pierre appareillées.
  fabriqueMur: () =>
    murSimple({
      corps: 0x2b3145,
      socle: 0x1f2433,
      couronne: 0x434b68, // la pierre de couronnement du parapet
      bandes: [
        { y: 0.85, e: 0.1, couleur: 0x39405a },
        { y: 1.75, e: 0.1, couleur: 0x39405a },
        { y: 2.65, e: 0.1, couleur: 0x39405a },
        { y: 3.55, e: 0.1, couleur: 0x39405a },
        { y: 4.45, e: 0.1, couleur: 0x39405a },
        { y: 5.35, e: 0.12, couleur: 0x434b68 },
      ],
    }),
  fabriqueDecor: (rng, cote) => {
    const corps: Piece[] = []
    const lueurs: Piece[] = []

    /*
     * ⚠️ PAS DE RAMBARDE ICI — c'était un DOUBLON.
     *
     * Ce décor portait un poteau et une lisse, soit une clôture complète, à
     * 5,6 m du centre. Or la bordure du jeu court déjà à 4,2 m
     * (`fabriqueBarriere`), alignée avec les murs qu'on longe. Le pont était
     * donc le seul biome à montrer DEUX traits parallèles.
     *
     * On garde la barrière commune — c'est elle qui reste continue avec les
     * murs, dont elle est le prolongement bas — et ce décor ne dit plus que ce
     * qu'elle ne peut pas dire : la STRUCTURE sous les pieds, et le vide
     * qu'elle enjambe.
     */

    /*
     * ⚠️ RIEN SOUS LE NIVEAU DU SOL.
     *
     * Ce décor posait une poutre de tablier à y = −0,25 pour « laisser deviner
     * la structure ». Elle n'a jamais rien laissé deviner : le sol de forêt
     * court à y = −0,03 sur 260 m de large et l'enterre complètement. C'était
     * des triangles payés pour de l'invisible.
     *
     * Le pont s'exprime donc par ce qui DÉPASSE : des pylônes hauts, qu'aucun
     * œil ne confondra avec une clôture, et ses lanternes.
     */

    /*
     * Les pylônes. Hauts (4 à 8 m) et espacés : c'est ce qui distingue un
     * portique de pont d'une rangée de piquets. Un sur deux environ — assez
     * pour border la voie, trop peu pour faire une ligne continue.
     */
    if (rng() < 0.55) {
      const h = 4 + rng() * 4
      corps.push({
        geo: GEO.bloc.clone().scale(0.3, h, 0.3),
        couleur: teinte(0x463a52, 0x2b2334, rng()),
        x: 0, y: h / 2, z: 0,
      })
      // La traverse qui le relie vers l'extérieur : un pylône seul a l'air
      // planté au hasard, relié il a l'air de tenir quelque chose.
      corps.push({
        geo: GEO.bloc.clone().scale(1.6, 0.16, 0.16),
        couleur: 0x3e3145,
        x: 0.8, y: h * 0.78, z: 0,
      })
    }

    /*
     * Une lanterne, sur son PROPRE mât.
     *
     * Elle se dressait sur le poteau de rambarde ; sans lui, elle flotterait.
     * Un mât isolé tous les ~30 m ne refait pas une clôture — c'est une
     * ponctuation, et le seul point chaud du biome le plus froid.
     */
    if (rng() < 0.28) {
      corps.push({
        geo: GEO.bloc.clone().scale(0.14, 1.9, 0.14),
        couleur: 0x4a3a4e, x: 0, y: 0.95, z: 0,
      })
      lueurs.push({
        geo: GEO.bloc.clone().scale(0.42, 0.6, 0.42),
        couleur: 0xffcf87, x: 0, y: 2.1, z: 0,
      })
    }

    /*
     * ————— 🏠 Les MAISONS SUR PILOTIS —————
     *
     * Une berge habitée plutôt qu'un plan d'eau vide. Elles disent la même chose
     * que le lac qu'elles remplacent — on longe de l'eau — mais elles le disent
     * par une SILHOUETTE, pas par une tache au sol. À 28 m/s et de biais, une
     * surface horizontale ne se voit presque pas ; un volume sur pieds, si.
     *
     * ⚠️ LE TOIT ROUGE EST TOUT L'ENJEU. C'est le biome le plus froid et le plus
     * sombre du jeu : une maison de bois brun s'y noierait. Le toit vif est la
     * seule chose qu'on lira à 92 m de brume, et c'est lui qui doit porter la
     * lecture — le reste n'est que du détail qu'on découvre en passant.
     *
     * ⚠️ Une sur quatorze (7 %). Le décor tombe tous les 8 m de chaque côté,
     * soit ~80 massifs par bord sur les 640 m du biome : cela fait cinq ou six
     * maisons par bord, assez pour un hameau qui borde la voie, trop peu pour
     * une rue continue — ce qui ferait mur et fermerait le paysage.
     */
    if (rng() < 0.07) {
      /*
       * ⚠️ LES DEUX BORDS N'ONT PAS LA MÊME ÉCHELLE.
       *
       * À gauche, des maisons à hauteur d'homme ; à droite, les mêmes en bien
       * plus grand. Ce n'est pas une fantaisie : deux rives identiques se lisent
       * comme un couloir tapissé, et l'œil n'y accroche rien. En cassant la
       * symétrie, on donne une ORIENTATION au paysage — on sait de quel côté on
       * regarde, ce qui est précieux dans le biome le plus sombre du jeu.
       *
       * Les grandes partent aussi plus loin (`cx` suit la largeur) : une maison
       * de six mètres plantée à la distance d'une petite viendrait boucher le
       * bord de la voie.
       */
      const droite = cote > 0
      const ech = droite ? 1.45 + rng() * 0.55 : 0.88 + rng() * 0.35
      const larg = 2.7 * ech
      const prof = 2.5 * ech
      const pil = 1.15 * ech // la hauteur des pilotis
      const murs = 1.75 * ech
      const cx = 4.2 + larg / 2 // au-delà des pylônes, jamais devant eux
      const tourne = (rng() - 0.5) * 0.5

      // Les PILOTIS : six pieds, plus fins que hauts. C'est ce qui fait lire
      // « posée sur l'eau » avant même qu'on voie l'eau.
      for (const sx of [-1, 0, 1]) {
        for (const sz of [-1, 1]) {
          corps.push({
            geo: GEO.tige.clone().scale(0.09 * ech, pil, 0.09 * ech),
            couleur: teinte(0x6b4f30, 0x4a3722, rng()),
            x: cx + sx * (larg / 2 - 0.16),
            y: pil / 2,
            z: sz * (prof / 2 - 0.16),
          })
        }
      }

      // Le plancher, qui coiffe les pilotis et porte tout le reste.
      corps.push({
        geo: GEO.bloc.clone().scale(larg + 0.24, 0.14 * ech, prof + 0.5),
        couleur: 0x7a5c38,
        x: cx, y: pil, z: 0, ry: tourne,
      })

      // Le corps de la maison : du bois clair, la seule matière chaude du biome.
      corps.push({
        geo: GEO.bloc.clone().scale(larg, murs, prof),
        couleur: teinte(0xa8804a, 0x8a6538, rng() * 0.6),
        x: cx, y: pil + murs / 2, z: 0, ry: tourne,
      })

      /*
       * 🔴 LE TOIT, en pyramide à quatre pans.
       *
       * `GEO.cone` a QUATRE côtés : pivoté d'un huitième de tour, sa base carrée
       * s'aligne sur les murs et l'on obtient une croupe, pas un cône. Il déborde
       * largement (×1,35) — un toit qui affleure les murs se lit comme un
       * couvercle ; c'est l'avancée qui fait l'auvent, et l'ombre dessous.
       */
      corps.push({
        geo: GEO.cone.clone().scale(larg * 0.96, 1.05 * ech, prof * 1.0),
        couleur: teinte(0xc4342a, 0x9c2a22, rng() * 0.7),
        x: cx,
        y: pil + murs + 0.5 * ech,
        z: 0,
        ry: tourne + Math.PI / 4,
      })

      // La VÉRANDA : un plancher qui dépasse côté piste, et sa balustrade. C'est
      // le détail qui fait « habitée » plutôt que « cabane ».
      corps.push({
        geo: GEO.bloc.clone().scale(0.55 * ech, 0.1 * ech, prof * 0.8),
        couleur: 0x8a6538,
        x: cx - larg / 2 - 0.24 * ech, y: pil + 0.06, z: 0, ry: tourne,
      })
      for (const hy of [0.32, 0.62]) {
        corps.push({
          geo: GEO.bloc.clone().scale(0.06, 0.05, prof * 0.78),
          couleur: 0x9c7444,
          x: cx - larg / 2 - 0.42 * ech, y: pil + hy * ech, z: 0, ry: tourne,
        })
      }

      // La porte et deux fenêtres, en creux sombre sur la façade.
      corps.push({
        geo: GEO.bloc.clone().scale(0.42 * ech, 0.95 * ech, 0.06),
        couleur: 0x3a2a1c,
        x: cx - larg / 2 - 0.01, y: pil + 0.5 * ech, z: 0, ry: tourne,
      })
      for (const sz of [-1, 1]) {
        corps.push({
          geo: GEO.bloc.clone().scale(0.06, 0.42 * ech, 0.4 * ech),
          couleur: 0x3a2f52, // le bleu profond des volets, comme sur la photo
          x: cx - larg / 2 - 0.01,
          y: pil + murs * 0.62,
          z: sz * prof * 0.28,
          ry: tourne,
        })
      }

      /*
       * 🏮 Une lanterne sous l'auvent, une fois sur deux.
       *
       * Elle ne sert pas à éclairer la maison mais à la SITUER : un point chaud
       * accroche l'œil à 90 m, là où la silhouette n'est encore qu'une masse.
       * C'est le même rôle que la lanterne du mât, et la même teinte.
       */
      if (rng() < 0.5) {
        lueurs.push({
          geo: GEO.bloc.clone().scale(0.2 * ech, 0.26 * ech, 0.2 * ech),
          couleur: 0xffcf87,
          x: cx - larg / 2 - 0.3 * ech,
          y: pil + murs * 0.9,
          z: prof * 0.3,
        })
      }
    }

    return groupe(assemble(corps, MAT_SOLIDE), assemble(lueurs, MAT_LUMIERE))
  },
}

/* ————————————————————————————————————————————————————————————————
 *  4 · FLANCS DU FUJI 雪 — le blanc final
 * ———————————————————————————————————————————————————————————————— */

/**
 * Le seul biome CLAIR, et c'est tout l'effet : après trois actes dans le noir,
 * l'arrivée sur la neige est un coup de projecteur. Il couvre la zone de sprint
 * final — le moment où l'on martèle l'écran sans plus rien à esquiver — donc la
 * récompense visuelle tombe pile sur la récompense de jeu.
 *
 * brumeFar monte à 105 : on voit LOIN, et donc on voit le torii sacré arriver.
 * C'est la seule fois de la course où la brume cesse de cacher l'horizon.
 */
const FUJI: Biome = {
  nom: 'Flancs du Fuji',
  kanji: '雪',
  brume: 0x8fa4bf,
  brumeNear: 38,
  brumeFar: 105,
  sol: 0xc9d4e0,
  ligne: 0x9aa9bd,
  murCorps: 0x5a6478, // une congère tassée, sombre pour trancher sur la neige
  ecartDecor: 13,

  /*
   * La neige tassée. Volontairement la texture la plus DISCRÈTE des quatre :
   * c'est le biome clair, celui du sprint final, et de la neige contrastée
   * ferait vibrer tout l'écran au moment précis où le joueur martèle. On se
   * contente de creux bleutés — assez pour que ça ne soit pas du papier.
   */
  texSol: () =>
    texturePour('fuji', (t) => {
      const r = dé(0x9ee1)
      t.fond('#fdfdff')
      for (let i = 0; i < 22; i++) {
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 20 + r() * 40, 14 + r() * 30, r() * Math.PI, 'rgb(232,238,250)')
        )
      }
      // Les congères : de longues ondulations dans le sens de la pente.
      for (let i = 0; i < 10; i++) {
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 6 + r() * 12, 36 + r() * 40, (r() - 0.5) * 0.6, 'rgb(220,229,246)')
        )
      }
      // Quelques cailloux qui percent : la limite des neiges, pas une plaine.
      for (let i = 0; i < 10; i++) {
        const v = 150 + Math.floor(r() * 50)
        t.tache(r() * TUILE, r() * TUILE, (ctx) =>
          galet(ctx, 2 + r() * 4, 2 + r() * 3, r() * Math.PI, `rgb(${v},${v + 4},${v + 12})`)
        )
      }
    }),
  tuileSol: 7,

  /*
   * ❄️ L'ENTRÉE D'IGLOO — une voûte de blocs de neige.
   *
   * Le seul des quatre à ne pas passer par `plateformeSimple` : ses pilotis ne
   * sont pas des poteaux mais une VOÛTE, et un squelette droit ne la donnerait
   * pas. C'est la forme qui raconte le biome, pas la couleur — sur la neige,
   * six poteaux blancs auraient disparu.
   *
   * ⚠️ La voûte est ELLIPTIQUE, pas circulaire, et c'est une contrainte de jeu
   * avant d'être un goût. Un arc de cercle né aux bords de la ligne culminerait
   * bien en dessous du plafond du tunnel (`TUNNEL_HAUT`, 1,90 m), et l'on se
   * cognerait la tête dans un décor. En étirant la hauteur, la clé de voûte
   * passe au-dessus du plafond : jamais dans le chemin.
   *
   * ⚠️ Les épaules sont des ASSISES PLEINES, pas des blocs posés le long d'un
   * arc. Elles l'ont été, et c'étaient six barreaux avec du vide entre eux —
   * on voyait au travers des côtés, alors qu'un igloo est une paroi continue
   * percée d'un seul trou. Chaque assise va maintenant du bord extérieur
   * jusqu'à la courbe du passage : le mur se referme tout seul en montant.
   */
  plateformeAjouree: true,

  fabriquePlateforme: (hauteur, largeur, avecRampe) => {
    const p: Piece[] = []
    const NEIGE = 0xf2f6fb
    const OMBRE = 0xd3deea // la neige à l'ombre : c'est elle qui donne le relief

    // Le tablier de neige tassée, celui qu'on foule.
    p.push({
      geo: GEO.bloc.clone().scale(largeur, 0.24, 1),
      couleur: NEIGE,
      x: 0, y: hauteur - 0.12, z: 0,
    })

    if (avecRampe) {
      /*
       * ⚠️ UNE CONGÈRE PLEINE. Les assises ne bordaient que les flancs et
       * l'intérieur restait vide : de face, on voyait au travers. Un banc de
       * neige tassée est plein — c'est ce qui le sépare de la voûte d'à côté.
       */
      p.push({
        geo: GEO.bloc.clone().scale(largeur - 0.1, hauteur - 0.2, 1),
        couleur: OMBRE,
        x: 0, y: (hauteur - 0.2) / 2, z: 0,
      })
      const etages = 5
      for (const cote of [-1, 1]) {
        for (let e = 0; e < etages; e++) {
          p.push({
            geo: GEO.bloc.clone().scale(0.26, (hauteur - 0.5) / etages - 0.03, 1),
            couleur: e % 2 ? NEIGE : OMBRE,
            // Chaque assise rentre un peu : une congère s'affaisse, elle n'est
            // pas un mur droit.
            x: cote * (largeur / 2 - 0.05 - e * 0.02),
            y: 0.2 + e * ((hauteur - 0.5) / etages),
            z: 0,
          })
        }
      }
    } else {
      /*
       * La voûte. Quatre blocs par épaule, posés sur une ellipse et inclinés
       * pour en suivre la tangente — sans cette rotation, des blocs droits
       * empilés en arc se lisent comme un escalier.
       */
      /*
       * ————— LES ÉPAULES SONT PLEINES —————
       *
       * Elles étaient six blocs posés le long d'un arc, donc six barreaux avec
       * du vide entre eux : on voyait au travers des côtés, alors qu'un igloo
       * est une PAROI continue percée d'un seul trou.
       *
       * On les bâtit donc par ASSISES : à chaque hauteur, un bloc qui va du
       * bord extérieur jusqu'à la courbe du passage. Le mur se referme tout
       * seul en montant, puisque la courbe rentre — et il n'y a plus un seul
       * interstice.
       *
       * ⚠️ L'OUVERTURE EST PLUS ÉTROITE QUE LA PLATEFORME, et il le faut. À
       * pleine largeur, il ne resterait aucune matière sur les côtés : la paroi
       * aurait l'épaisseur d'une feuille. `R` borne donc le passage à ±0,75 m,
       * ce qui laisse ~35 cm de neige de chaque côté — et reste deux fois plus
       * large que le coureur.
       */
      const R = 0.75 // demi-largeur du passage, au sol
      const H = hauteur - 0.25 // la clé de voûte
      const BORD = largeur / 2 + 0.06 // les épaules débordent un peu du tablier
      const ASSISES = 7

      for (const cote of [-1, 1]) {
        for (let i = 0; i < ASSISES; i++) {
          const y = ((i + 0.5) * H) / ASSISES
          // La courbe du passage à cette hauteur. Elliptique : un arc de cercle
          // culminerait sous le plafond du tunnel et l'on s'y cognerait.
          const creux = R * Math.sqrt(Math.max(0, 1 - (y / H) ** 2))
          const ep = BORD - creux
          p.push({
            geo: GEO.bloc.clone().scale(ep, H / ASSISES + 0.01, 1),
            couleur: i % 2 ? NEIGE : OMBRE,
            x: cote * (creux + ep / 2),
            y,
            z: 0,
          })
        }
      }

      /*
       * ————— LA BOUCHE —————
       *
       * Un igloo ne s'ouvre pas à même la voûte : il a un COL qui dépasse, un
       * bourrelet plus épais tout autour de l'entrée. C'est ce col qu'on
       * reconnaît, bien avant la coupole — et c'est lui qui manquait.
       *
       * ⚠️ Il est en z LOCAL, donc il s'écarte avec la longueur : sur un long
       * tunnel il devient un cerclage régulier. C'est juste pour une galerie de
       * neige, et ça reste lisible comme une entrée sur les plateformes courtes.
       */
      for (const cote of [-1, 1]) {
        for (let i = 0; i < ASSISES; i++) {
          const y = ((i + 0.5) * H) / ASSISES
          const creux = R * Math.sqrt(Math.max(0, 1 - (y / H) ** 2))
          // Le col suit EXACTEMENT la même courbe que les épaules, en un peu
          // plus épais : c'est ce débord qui se lit comme une bouche. Le caler
          // sur d'autres chiffres le décollerait de la paroi.
          p.push({
            geo: GEO.bloc.clone().scale(BORD + 0.09 - creux, H / ASSISES + 0.03, 0.14),
            couleur: NEIGE,
            x: cote * (creux + (BORD + 0.09 - creux) / 2),
            y,
            z: 0.47,
          })
        }
      }

      /*
       * ————— LA NEIGE FRAÎCHE —————
       *
       * Ce qu'on demandait, et qui change tout : la voûte nue se lisait comme
       * une maçonnerie. Deux congères aux pieds du col, et un bourrelet le long
       * de la crête — la neige s'accumule là où le vent la dépose, contre les
       * obstacles et sur les arêtes.
       */
      for (const cote of [-1, 1]) {
        p.push({
          geo: GEO.caillou.clone().scale(0.34, 0.17, 0.3),
          couleur: NEIGE,
          x: cote * (R + 0.02),
          y: 0.11,
          z: 0.5,
          ry: cote * 0.6,
        })
      }
      // Le bourrelet de crête, tout le long : c'est lui qui coiffe la galerie.
      p.push({
        geo: GEO.bloc.clone().scale(largeur * 0.52, 0.13, 1),
        couleur: NEIGE,
        x: 0, y: hauteur - 0.3, z: 0,
      })
    }

    return groupe(assemble(p, MAT_SOLIDE))
  },

  /*
   * Le balisage de sentier de montagne : des piquets sombres coiffés de neige,
   * reliés par une corde claire.
   *
   * Les piquets SOMBRES sont indispensables, comme les rochers du décor : sur
   * un sol blanc, une bordure claire disparaîtrait — et c'est le seul biome où
   * le bord de piste risque de se confondre avec le sol.
   */
  fabriqueBarriere: () =>
    barriereSimple(
      {
        pieu: { couleur: [0x3a2f22, 0x241d15], r: 0.07, h: 1.1, ecart: 1.5 },
        lisses: [{ y: 0.86, r: 0.045, couleur: 0xd8dfe9 }],
        pointe: 0xf2f6fb, // la neige accrochée au sommet
      },
      dé(0x0b4)
    ),

  /*
   * ————— 🪨 Les obstacles du Fuji : de la ROCHE sous la neige —————
   *
   * Le biome n'en avait aucun : ses trois obstacles étaient les blocs nus du
   * repli, et c'est le seul endroit de la course où l'on voyait la géométrie
   * brute du jeu.
   *
   * ⚠️ LA VALEUR AVANT LA TEINTE. C'est le biome CLAIR : un obstacle blanc sur
   * un sol blanc ne se verrait pas, et sur cette portion on martèle pour le
   * sprint final — on n'a pas le temps de déchiffrer. Chaque pièce est donc
   * bâtie en roche SOMBRE, et la neige ne vient que la coiffer. C'est
   * exactement la logique déjà retenue pour la bordure et le décor du biome.
   *
   * ⚠️ Rien ici ne définit la collision : elle vient de `TAILLE_OBSTACLE`. Les
   * volumes suivent ces boîtes au plus près pour ne pas mentir, et ce qui
   * dépasse (les congères basses, les montants) est volontairement HORS de la
   * trajectoire — au centre de sa ligne, on ne touche que ce qui compte.
   */
  fabriqueObstacle: (kind, rng) => {
    const p: Piece[] = []
    const ROCHE = 0x39445c
    const ROCHE_CLAIRE = 0x4d5a75
    const NEIGE = 0xf2f6fb

    if (kind === 'saut') {
      /*
       * Une congère durcie : trois blocs de roche à demi enfouis, coiffés de
       * neige. Boîte de 0,60 m de haut — assez bas pour se sauter, et la ligne
       * de crête blanche donne le bord supérieur d'un coup d'œil.
       */
      for (let i = 0; i < 3; i++) {
        const x = -0.62 + i * 0.62
        const r = 0.42 + rng() * 0.12
        p.push({
          geo: GEO.caillou.clone().scale(r, 0.38 + rng() * 0.1, r * 0.62),
          couleur: teinte(ROCHE, ROCHE_CLAIRE, rng()),
          x, y: 0.2, z: 0,
          ry: rng() * Math.PI,
          rz: (rng() - 0.5) * 0.3,
        })
        // La neige POSÉE dessus, jamais mélangée : c'est le contraste qui porte
        // la lecture, pas une teinte moyenne entre les deux.
        p.push({
          geo: GEO.caillou.clone().scale(r * 0.82, 0.16, r * 0.5),
          couleur: NEIGE,
          x, y: 0.52, z: 0,
          ry: rng() * Math.PI,
        })
      }
      // Deux éclats tombés devant, hors de la boîte : ils ancrent la congère au
      // sol au lieu de la faire poser dessus comme un décor découpé.
      for (const nx of [-0.95, 0.9]) {
        p.push({
          geo: GEO.caillou.clone().scale(0.16, 0.12, 0.14),
          couleur: ROCHE,
          x: nx, y: 0.08, z: 0.26,
          ry: rng() * Math.PI,
        })
      }
    } else if (kind === 'glissade') {
      /*
       * Une poutre de GLACE tendue en travers, à 1,55 m : on passe dessous.
       *
       * Les cordages restent DORÉS, comme sur la perche de la bambouseraie.
       * C'est devenu le signal du « glisse », et le changer ici obligerait à
       * réapprendre la lecture en cours de course — au pire moment, juste avant
       * le sprint.
       */
      p.push({
        geo: GEO.bloc.clone().scale(1.75, 0.34, 0.34),
        couleur: teinte(0x9fc4de, 0xd8ecf7, rng()),
        x: 0, y: 1.55, z: 0,
        rz: (rng() - 0.5) * 0.04,
      })
      for (const nx of [-0.58, 0.58]) {
        p.push({
          geo: GEO.anneau.clone().scale(0.24, 0.18, 0.24),
          couleur: 0xd6ac5a,
          x: nx, y: 1.55, z: 0, rz: Math.PI / 2,
        })
      }
      // Les stalactites : elles pendent SOUS la poutre et disent d'un coup
      // qu'il faut se baisser — la barre seule pouvait se lire comme un appui.
      for (let i = 0; i < 5; i++) {
        const x = -0.7 + i * 0.35
        p.push({
          geo: GEO.cone.clone().scale(0.075, 0.2 + rng() * 0.14, 0.075),
          couleur: 0xe6f2fa,
          x, y: 1.3, z: 0,
          rx: Math.PI, // pointe vers le bas
        })
      }
      /*
       * Les deux montants, plantés au bord exact de la ligne (±0,85 m) et
       * volontairement fins : ils expliquent que la poutre tienne sans encombrer
       * le centre de la voie.
       *
       * ⚠️ Ils descendent SOUS la boîte, qui ne couvre que 1,30 m à 1,80 m : on
       * les traverse en glissant. Un montant épais laisserait croire qu'il barre
       * aussi le bas.
       */
      for (const nx of [-0.85, 0.85]) {
        p.push({
          geo: GEO.tige.clone().scale(0.09, 1.72, 0.09),
          couleur: ROCHE,
          x: nx, y: 0.86, z: 0,
        })
        p.push({
          geo: GEO.caillou.clone().scale(0.2, 0.12, 0.18),
          couleur: NEIGE,
          x: nx, y: 1.74, z: 0,
          ry: rng() * Math.PI,
        })
      }
    } else {
      /*
       * ————— Le ROCHER : UN SEUL, et gros —————
       *
       * Il en portait trois : un gros et deux éclats calés au pied. Les éclats
       * partent. Ce qu'on reconnaît d'un rocher à 105 m de brume, c'est une
       * SILHOUETTE — une seule masse anguleuse. Trois volumes se lisaient comme
       * un éboulis, c'est-à-dire comme quelque chose qu'on pourrait contourner
       * ou escalader. Un bloc unique ne laisse aucun doute : on change de ligne.
       *
       * Il est élargi et posé plus bas pour occuper à lui seul la place que les
       * trois tenaient — un rocher qui rétrécit en perdant ses éclats aurait
       * l'air d'avoir maigri, pas d'avoir été simplifié.
       */
      p.push({
        geo: GEO.caillou.clone().scale(1.2, 1.34, 0.46),
        couleur: teinte(ROCHE, 0x2c3550, rng()),
        x: 0, y: 1.12, z: 0,
        ry: rng() * Math.PI,
        rz: (rng() - 0.5) * 0.18,
      })
      // La calotte de neige, sur le dessus seulement : c'est elle qui donne la
      // hauteur exacte à franchir… et qui dit qu'on ne la franchira pas.
      p.push({
        geo: GEO.caillou.clone().scale(1, 0.3, 0.38),
        couleur: NEIGE,
        x: 0, y: 2.28, z: 0,
        ry: rng() * Math.PI,
      })
    }

    return groupe(assemble(p, MAT_SOLIDE))
  },

  // Une congère tassée, striée d'arêtes de neige durcie.
  fabriqueMur: () =>
    murSimple({
      corps: 0x5a6478,
      socle: 0x49536a,
      couronne: 0xf2f6fb, // la crête de neige fraîche, tout en haut
      bandes: [
        { y: 1.2, e: 0.12, couleur: 0xdfe7f2 },
        { y: 2.45, e: 0.14, couleur: 0xe8eef6 },
        { y: 3.7, e: 0.12, couleur: 0xdfe7f2 },
        { y: 4.95, e: 0.14, couleur: 0xe8eef6 },
      ],
    }),
  fabriqueDecor: (rng) => {
    const corps: Piece[] = []

    // Un rocher coiffé de neige. La roche SOMBRE est indispensable : sur un sol
    // clair, un décor clair disparaîtrait complètement.
    const r = 1.2 + rng() * 1.8
    const rot = { rx: rng() * 3, ry: rng() * 3, rz: rng() * 3 }
    const x = rng() * 2.6
    corps.push({
      geo: GEO.caillou.clone().scale(r, r * 0.8, r),
      couleur: teinte(0x59647a, 0x333c4d, rng()),
      x, y: r * 0.5, z: 0, ...rot,
    })
    corps.push({
      geo: GEO.caillou.clone().scale(r * 0.72, r * 0.5, r * 0.72),
      couleur: 0xf2f6fb,
      x, y: r * 1.0, z: 0, ...rot,
    })

    // Un pin rabougri : la limite des arbres, en altitude.
    if (rng() < 0.4) {
      const px = rng() * 4
      const pz = (rng() - 0.5) * 4
      corps.push({
        geo: GEO.tige.clone().scale(0.16, 2.4, 0.16),
        couleur: 0x33291f, x: px, y: 1.2, z: pz,
      })
      corps.push({
        geo: GEO.sapin.clone().scale(1.1, 2.6, 1.1),
        couleur: teinte(0x354c3e, 0x1e2e26, rng()),
        x: px, y: 3, z: pz,
      })
      // La neige accrochée dessus : sans elle, le pin a l'air d'un été égaré.
      corps.push({
        geo: GEO.sapin.clone().scale(0.85, 1.1, 0.85),
        couleur: 0xe8eef6, x: px, y: 3.7, z: pz,
      })
    }

    // Une crête lointaine : c'est elle qui dit qu'on est en montagne et pas
    // dans une plaine enneigée.
    if (rng() < 0.55) {
      const hc = 6 + rng() * 9
      corps.push({
        geo: GEO.cone.clone().scale(7 + rng() * 6, hc, 7),
        couleur: teinte(0x8496ad, 0xb9c6d6, rng()),
        x: 12 + rng() * 9,
        y: hc / 2,
        z: (rng() - 0.5) * 14,
        ry: rng() * Math.PI,
      })
    }

    // Facettes : sur de la roche et de la neige, l'arête franche vaut mieux
    // qu'un dégradé lisse.
    return groupe(assemble(corps, MAT_FACETTE))
  },
}

/** Dans l'ordre de la course. */
/*
 * ⚠️ ————— LA FORÊT DE BAMBOUS EST RETIRÉE DE LA COURSE —————
 *
 * Retirée, PAS supprimée : son code entier vit toujours juste au-dessus, et il
 * suffit de remettre `BAMBOUS` dans cette liste pour qu'elle revienne telle
 * qu'elle était. Rien d'autre à toucher.
 *
 * ⚠️ Et il n'est pas mis en COMMENTAIRE, volontairement. Sept cents lignes de
 * texte mort cesseraient d'être compilées : elles ne suivraient plus les
 * changements de l'interface `Biome`, et l'on retrouverait dans six mois du
 * code qui ne compile plus — un biome qu'on croyait « en pause » et qu'il
 * faudrait en fait réécrire. `BIOMES_EN_PAUSE`, juste en dessous, le garde
 * VIVANT : typé, vérifié à chaque build, prêt à revenir.
 *
 * ————— Ce que ce retrait change —————
 *
 * `indexBiome` découpe la course sur `BIOMES.length` : le partage se refait
 * tout seul, en tiers au lieu de quarts. Concrètement :
 *
 *   · la course COMMENCE dans le village en flammes ;
 *   · les 🐦 oiseaux ne se font plus entendre — la bambouseraie était le seul
 *     biome à porter `ambiance: 'oiseaux'` ;
 *   · ses deux radeaux (le plein et celui sur pilotis) ne se croisent plus en
 *     piste. Les trois autres biomes ont les leurs, le tunnel existe toujours.
 */
export const BIOMES: readonly Biome[] = [/* BAMBOUS, */ VILLAGE, PONT, FUJI]

/**
 * Les biomes ÉCRITS mais hors course.
 *
 * Ils ne sont tirés par rien — ni `indexBiome`, ni le décor, ni les fabriques.
 * Leur seule raison d'être ici est de rester COMPILÉS : c'est ce qui garantit
 * qu'ils suivront les changements de l'interface `Biome` au lieu de pourrir en
 * silence, et qu'ils reviendront en une ligne le jour où on les rappelle.
 */
export const BIOMES_EN_PAUSE: readonly Biome[] = [BAMBOUS]

/** L'ambiance à un instant donné : deux biomes et le fondu entre eux. */
export interface Ambiance {
  brume: THREE.Color
  brumeNear: number
  brumeFar: number
  sol: THREE.Color
  ligne: THREE.Color
  /** Le biome dominant — celui dont on affiche le nom, et dont on tire le décor. */
  index: number

  /**
   * Le fondu à l'état BRUT : de quel biome on part, vers lequel on va, et où
   * l'on en est (0 → 1).
   *
   * Les couleurs ci-dessus sont déjà mélangées, mais une TEXTURE ne se mélange
   * pas : on ne peut pas interpoler de la litière de bambou vers des cendres.
   * La piste s'en sert pour superposer deux sols et faire monter l'opacité du
   * second — un vrai fondu enchaîné, là où un simple échange de texture
   * claquerait sous les pieds du joueur.
   */
  iA: number
  iB: number
  melange: number
}

// Réutilisés d'une image à l'autre : allouer quatre THREE.Color par frame
// remplirait le ramasse-miettes pour rien.
const _brume = new THREE.Color()
const _solC = new THREE.Color()
const _ligne = new THREE.Color()
const _a = new THREE.Color()
const _b = new THREE.Color()

/** Dans quel biome tombe cette distance ? (sans fondu — index brut) */
export function indexBiome(distance: number, length: number): number {
  const t = length > 0 ? distance / length : 0
  return Math.min(BIOMES.length - 1, Math.max(0, Math.floor(t * BIOMES.length)))
}

/**
 * L'ambiance à cette distance, fondu compris.
 *
 * On mélange sur les derniers `FONDU` de chaque biome. L'objet renvoyé est
 * TOUJOURS le même : ne pas le stocker, le lire tout de suite.
 */
export function ambianceA(
  distance: number,
  length: number,
  /**
   * ♾️ Quel biome occupe le créneau `k` ?
   *
   * Absent, c'est l'ordre naturel de `BIOMES` et le fondu s'arrête au dernier —
   * une course a une fin. Fourni, les créneaux se suivent SANS FIN et dans
   * l'ordre qu'on veut : c'est ce qui permet de tirer les décors au sort tout en
   * gardant les couleurs, la brume et la lumière d'accord avec eux.
   *
   * ⚠️ Sans ce paramètre, mélanger les décors aurait fait mentir l'ambiance : on
   * aurait couru dans la neige sous la lumière orange du village.
   */
  ordre?: (k: number) => number
): Ambiance {
  const n = BIOMES.length
  const part = 1 / n // la part de course d'un biome
  // Le fondu occupe la fin du biome. `FONDU` est une fraction de la COURSE,
  // ramenée ici à une fraction du biome.
  const seuil = 1 - FONDU / part

  let i: number
  let suivant: number
  let melange: number

  if (ordre) {
    // ♾️ Les créneaux défilent indéfiniment : pas de dernier, donc pas de cas
    // particulier — le fondu franchit aussi la couture entre deux cycles.
    const k = Math.max(0, Math.floor(distance / (length / n)))
    const dedans = (distance / (length / n)) - k
    melange = dedans <= seuil ? 0 : (dedans - seuil) / (1 - seuil)
    i = ordre(k)
    suivant = ordre(k + 1)
  } else {
    const t = length > 0 ? Math.min(0.9999, Math.max(0, distance / length)) : 0
    i = Math.min(n - 1, Math.floor(t / part))
    const dedans = (t - i * part) / part
    suivant = Math.min(n - 1, i + 1)
    melange = dedans <= seuil || i === n - 1 ? 0 : (dedans - seuil) / (1 - seuil)
  }

  const A = BIOMES[i]
  const B = BIOMES[suivant]

  _brume.copy(_a.setHex(A.brume)).lerp(_b.setHex(B.brume), melange)
  _solC.copy(_a.setHex(A.sol)).lerp(_b.setHex(B.sol), melange)
  _ligne.copy(_a.setHex(A.ligne)).lerp(_b.setHex(B.ligne), melange)

  return {
    brume: _brume,
    brumeNear: A.brumeNear + (B.brumeNear - A.brumeNear) * melange,
    brumeFar: A.brumeFar + (B.brumeFar - A.brumeFar) * melange,
    sol: _solC,
    ligne: _ligne,
    // On bascule le décor à mi-fondu : avant, on plante encore du biome A ;
    // après, du B. Comme le décor apparaît 85 m devant, la bascule se voit
    // arriver au loin pendant que les couleurs, elles, glissent déjà.
    index: melange > 0.5 ? suivant : i,
    iA: i,
    iB: suivant,
    melange,
  }
}
