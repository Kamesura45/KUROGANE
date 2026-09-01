/**
 * ————— 🖼️ Détourer un bouton peint —————
 *
 * Rend TRANSPARENT le fond uni qui entoure un dessin, et lui seul.
 *
 * Les images des boutons arrivent avec un fond BLANC OPAQUE : le canal alpha
 * est bien là, mais aucun pixel ne s'en sert (mesuré : 0 % de transparent,
 * 18 à 28 % de blanc pur). Posées telles quelles sur l'interface sombre, elles
 * dessineraient quatre rectangles blancs autour des boutons.
 *
 * ⚠️ ON NE SUPPRIME PAS « TOUT CE QUI EST BLANC ». C'est le piège, et il aurait
 * troué les dessins : le parchemin de « Jouer » est presque blanc en son
 * centre, la plaque de 戦士 est grise claire. On part donc des BORDS et l'on se
 * propage de proche en proche — seul le blanc RELIÉ AU BORD s'en va. Un blanc
 * cerné par du dessin est à l'intérieur, donc il reste.
 *
 * Les originaux ne sont jamais modifiés : on lit d'un côté, on écrit de
 * l'autre.
 *
 *   node tools/detourer.mjs <source.png> <sortie.png> [seuil]
 *
 * `seuil` (30 par défaut) : à quelle distance de la couleur du coin un pixel
 * compte encore comme du fond. Trop bas, il reste un liseré ; trop haut, on
 * mange le dessin.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync, deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** La table de CRC-32 du format PNG. Chaque chunk porte la sienne. */
const TABLE_CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** Lit un PNG RVBA 8 bits et rend ses pixels à plat. */
function lire(fichier) {
  const b = readFileSync(fichier)
  if (!b.subarray(0, 8).equals(SIGNATURE)) throw new Error(fichier + " n'est pas un PNG")
  const largeur = b.readUInt32BE(16)
  const hauteur = b.readUInt32BE(20)
  const profondeur = b[24]
  const type = b[25]
  // On refuse plutôt que de deviner : un PNG palettisé ou 16 bits produirait
  // des couleurs fausses en silence, et l'on chercherait le bug ailleurs.
  if (profondeur !== 8 || type !== 6) {
    throw new Error(`${fichier} : attendu RVBA 8 bits (type 6), reçu type ${type} en ${profondeur} bits`)
  }
  const morceaux = []
  let i = 8
  while (i < b.length - 8) {
    const taille = b.readUInt32BE(i)
    const nom = b.subarray(i + 4, i + 8).toString('latin1')
    if (nom === 'IDAT') morceaux.push(b.subarray(i + 8, i + 8 + taille))
    if (nom === 'IEND') break
    i += 12 + taille
  }
  const brut = inflateSync(Buffer.concat(morceaux))

  // ————— Défiltrage —————
  // Chaque ligne commence par un octet qui dit comment elle a été prédite à
  // partir de la précédente. On rejoue la prédiction à l'envers.
  const px = 4
  const pas = largeur * px
  const out = Buffer.alloc(hauteur * pas)
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (pas + 1)]
    const ligne = brut.subarray(y * (pas + 1) + 1, y * (pas + 1) + 1 + pas)
    const dest = out.subarray(y * pas, (y + 1) * pas)
    const haut = y > 0 ? out.subarray((y - 1) * pas, y * pas) : null
    for (let x = 0; x < pas; x++) {
      const a = x >= px ? dest[x - px] : 0
      const h = haut ? haut[x] : 0
      const d = haut && x >= px ? haut[x - px] : 0
      let v = ligne[x]
      if (filtre === 1) v += a
      else if (filtre === 2) v += h
      else if (filtre === 3) v += (a + h) >> 1
      else if (filtre === 4) {
        const p = a + h - d
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - h)
        const pc = Math.abs(p - d)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? h : d
      }
      dest[x] = v & 0xff
    }
  }
  return { largeur, hauteur, pixels: out }
}

/** Réécrit un PNG RVBA 8 bits, sans filtrage (le zlib fait le gros du travail). */
function ecrire(fichier, { largeur, hauteur, pixels }) {
  const pas = largeur * 4
  const brut = Buffer.alloc(hauteur * (pas + 1))
  for (let y = 0; y < hauteur; y++) {
    brut[y * (pas + 1)] = 0
    pixels.copy(brut, y * (pas + 1) + 1, y * pas, (y + 1) * pas)
  }
  const chunk = (nom, data) => {
    const t = Buffer.alloc(4)
    t.writeUInt32BE(data.length)
    const corps = Buffer.concat([Buffer.from(nom, 'latin1'), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc32(corps))
    return Buffer.concat([t, corps, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largeur, 0)
  ihdr.writeUInt32BE(hauteur, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  writeFileSync(
    fichier,
    Buffer.concat([
      SIGNATURE,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(brut, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  )
}

/**
 * Le détourage : une propagation depuis les quatre bords.
 *
 * La couleur de référence est la MÉDIANE des quatre coins, pas un blanc
 * supposé : un fond légèrement gris ou teinté passerait à côté d'un test sur
 * le blanc pur, et il resterait un cadre.
 */
function detourer({ largeur, hauteur, pixels }, seuil) {
  const idx = (x, y) => (y * largeur + x) * 4
  const coins = [
    [0, 0],
    [largeur - 1, 0],
    [0, hauteur - 1],
    [largeur - 1, hauteur - 1],
  ].map(([x, y]) => [pixels[idx(x, y)], pixels[idx(x, y) + 1], pixels[idx(x, y) + 2]])
  const ref = [0, 1, 2].map((c) => {
    const v = coins.map((k) => k[c]).sort((a, b) => a - b)
    return (v[1] + v[2]) / 2
  })

  /** À quelle distance du fond se trouve ce pixel (0 = fond pur, 765 = tout). */
  const ecart = (i) =>
    Math.abs(pixels[i] - ref[0]) + Math.abs(pixels[i + 1] - ref[1]) + Math.abs(pixels[i + 2] - ref[2])

  /*
   * ————— DEUX SEUILS, PAS UN —————
   *
   * ⚠️ Un seuil unique laissait un LISERÉ BLANC tout autour des dessins, et il
   * se voyait : les bords sont anticrénelés, donc faits de pixels à moitié
   * fond, à moitié dessin. Trop clairs pour être du dessin, trop foncés pour
   * passer le seuil — ils restaient, opaques, et cernaient chaque bouton d'un
   * halo pâle sur le fond sombre.
   *
   * `dur` : en deçà, c'est du fond pur — alpha zéro.
   * `doux` : au-delà, c'est du dessin — on n'y touche pas.
   * Entre les deux, on DÉCOMPOSE le mélange (voir plus bas).
   */
  const dur = seuil * 3
  const doux = seuil * 3 * 5

  const vu = new Uint8Array(largeur * hauteur)
  const pile = []
  for (let x = 0; x < largeur; x++) {
    pile.push([x, 0], [x, hauteur - 1])
  }
  for (let y = 0; y < hauteur; y++) {
    pile.push([0, y], [largeur - 1, y])
  }
  let efface = 0
  let adouci = 0
  while (pile.length) {
    const [x, y] = pile.pop()
    if (x < 0 || y < 0 || x >= largeur || y >= hauteur) continue
    const p = y * largeur + x
    if (vu[p]) continue
    const i = p * 4
    const d = ecart(i)
    // On s'arrête au dessin franc : c'est lui qui contient la propagation.
    if (d >= doux) continue
    vu[p] = 1

    if (d <= dur) {
      pixels[i + 3] = 0
      efface++
    } else {
      /*
       * ————— LA DÉCOMPOSITION —————
       *
       * Ce pixel est un mélange : C = a·F + (1−a)·B, où B est le fond et F la
       * vraie couleur du dessin. On connaît C et B, on déduit a de l'écart,
       * et l'on REMONTE à F = (C − (1−a)·B) / a.
       *
       * ⚠️ Sans cette division, un bord à moitié transparent garderait sa
       * couleur DÉLAVÉE par le blanc : rendu sur fond sombre, il resterait
       * clair et l'on aurait juste un halo plus discret au lieu de pas de
       * halo du tout. Rendre le pixel translucide ne suffit pas — il faut lui
       * rendre sa couleur.
       */
      const a = (d - dur) / (doux - dur)
      for (let c = 0; c < 3; c++) {
        const v = (pixels[i + c] - (1 - a) * ref[c]) / a
        pixels[i + c] = Math.max(0, Math.min(255, Math.round(v)))
      }
      pixels[i + 3] = Math.round(a * 255)
      adouci++
    }
    pile.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
  }
  return { efface, adouci, ref: ref.map(Math.round) }
}

const [, , source, sortie, seuilTexte] = process.argv
if (!source || !sortie) {
  console.error('usage : node tools/detourer.mjs <source.png> <sortie.png> [seuil]')
  process.exit(1)
}
const seuil = Number(seuilTexte ?? 30)
const img = lire(source)
const { efface, adouci, ref } = detourer(img, seuil)
ecrire(sortie, img)
const total = img.largeur * img.hauteur
console.log(
  `${sortie.padEnd(22)} ${img.largeur}×${img.hauteur}  fond rgb(${ref})  ` +
    `${Math.round((efface / total) * 100)} % effacé, ` +
    `${Math.round((adouci / total) * 100)} % de bord décomposé (seuil ${seuil})`
)
