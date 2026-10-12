/**
 * ————— Le banc du JOURNAL des connectés —————
 *
 * Le compteur du coin répond « combien sont-ils, LÀ, maintenant ». Ce banc
 * répond à l'autre moitié de la question : « combien il y en avait, et quand ».
 *
 * Il ne fabrique rien : il lit `/journal`, le tableau que le serveur tient en
 * mémoire vive, et le met en page. C'est la même règle que tous les bancs — une
 * planche qui recalculerait son propre contenu montrerait autre chose que le
 * jeu, et mentirait d'autant plus qu'on lui ferait confiance.
 *
 * Le vrai travail ici n'est pas l'affichage, c'est la FUSION : le serveur note
 * un point toutes les cinq minutes, et quarante-huit heures de zéros donnent
 * cent quarante-quatre lignes que personne ne lira. Des tronçons de même valeur
 * réunis en « de 14:00 à 16:20 : 0 » se lisent, eux.
 */
import { WS_URL } from './net'

const API = WS_URL.replace(/^ws/, 'http')

/** Un point du serveur : un horodatage, un nombre. Rien d'autre. */
type Point = { t: number; n: number }
/** Ce qu'on affiche : des points de même valeur, réunis. */
type Troncon = { debut: number; fin: number; n: number }

const corps = document.getElementById('corps')!
const resume = document.getElementById('resume')!
const bouton = document.getElementById('rafraichir') as HTMLButtonElement

const fmtJour = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const fmtHeure = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
})

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Réunit les points de même valeur consécutifs.
 *
 * ⚠️ Le DERNIER point est toujours laissé seul, même s'il rejoint le précédent :
 * c'est l'instant présent, et le fusionner ferait croire que le compte a tenu
 * pendant une durée qu'il n'a pas encore tenue.
 */
function merger(points: Point[]): Troncon[] {
  const out: Troncon[] = []
  for (const p of points) {
    const dernier = out[out.length - 1]
    if (dernier && dernier.n === p.n && p !== points[points.length - 1]) dernier.fin = p.t
    else out.push({ debut: p.t, fin: p.t, n: p.n })
  }
  return out
}

function libelleQuand(debut: number, fin: number): string {
  const jourDebut = fmtJour.format(debut)
  const entete = `<span class="jour">${echapper(jourDebut)}</span> ${fmtHeure.format(debut)}`
  if (debut === fin) return entete
  // À minuit passé, la date de fin compte aussi : sinon « 23:55 → 00:15 » se
  // lit comme un aller-retour de vingt minutes dans le même jour.
  const memeJour = fmtJour.format(fin) === jourDebut
  const fini = memeJour
    ? fmtHeure.format(fin)
    : `${echapper(fmtJour.format(fin))} ${fmtHeure.format(fin)}`
  return `${entete} → ${fini}`
}

function duree(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const reste = min % 60
  return reste ? `${h} h ${reste}` : `${h} h`
}

function depuis(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 90) return `il y a ${s} s`
  const m = Math.round(s / 60)
  if (m < 90) return `il y a ${m} min`
  return `il y a ${Math.round(m / 60)} h`
}

function bloc(cle: string, val: string, plein = false): string {
  return `<div class="bloc"><div class="cle">${echapper(cle)}</div><div class="val${
    plein ? ' plein' : ''
  }">${val}</div></div>`
}

function rendreVide(message: string) {
  corps.innerHTML = `<tr><td class="vide" colspan="3">${echapper(message)}</td></tr>`
}

function rendreResume(t: Troncon[]) {
  if (t.length === 0) {
    resume.innerHTML = bloc('Journal', 'vide')
    return
  }
  const premier = t[0].debut
  const dernier = t[t.length - 1].fin
  const couverture = dernier - premier
  let pic = t[0]
  let somme = 0
  for (const tr of t) {
    if (tr.n > pic.n) pic = tr
    // Chaque tronçon pèse sa DURÉE, pas son existence : fusionner cent points
    // de zéro en un seul ne doit pas faire grimper la moyenne.
    somme += tr.n * (tr.fin - tr.debut)
  }
  const moyenne = couverture > 0 ? somme / couverture : 0

  resume.innerHTML =
    bloc('Couverture', duree(couverture)) +
    bloc('Dernier point', depuis(dernier)) +
    bloc('Pic', pic.n > 0 ? `${pic.n} le ${fmtHeure.format(pic.debut)}` : '0', pic.n > 0) +
    bloc('Moyenne', moyenne.toFixed(1))
}

function rendre(t: Troncon[]) {
  rendreResume(t)
  if (t.length === 0) {
    rendreVide('Journal vide — le serveur vient de démarrer, ou il était endormi.')
    return
  }
  // Du plus récent au plus ancien : c'est un journal, on lit d'abord ce qui
  // vient de se passer.
  const lignes = [...t].reverse()
  const max = Math.max(1, ...lignes.map((tr) => tr.n))
  corps.innerHTML = lignes
    .map((tr) => {
      const dure = tr.fin - tr.debut
      const barre =
        tr.n > 0
          ? `<span class="barre" style="width:${Math.max(
              4,
              Math.round((tr.n / max) * 120)
            )}px"></span>`
          : ''
      return (
        `<tr${tr.n > 0 ? ' class="vif"' : ''}>` +
        `<td class="quand">${libelleQuand(tr.debut, tr.fin)}</td>` +
        `<td>${barre}${tr.n}</td>` +
        `<td class="quand">${dure === 0 ? '—' : duree(dure)}</td>` +
        `</tr>`
      )
    })
    .join('')
}

async function relire() {
  try {
    const r = await fetch(`${API}/journal`, { signal: AbortSignal.timeout(6000) })
    const d = await r.json()
    const points: Point[] = Array.isArray(d?.points) ? d.points : []
    rendre(merger(points))
  } catch {
    rendreVide('Serveur injoignable — il tourne ? (cf. DEPLOY.md)')
  }
}

bouton.addEventListener('click', () => void relire())
void relire()
// Un journal qu'on doit rafraîchir à la main n'est pas un journal : on
// relit toutes les trente secondes, sans jamais monopoliser quoi que ce soit.
setInterval(() => {
  if (!document.hidden) void relire()
}, 30_000)

/*
 * Les bancs exposent leur guichet sous `DEV` — cf. `catalogue.ts`. Sans ceci,
 * vérifier la FUSION demanderait d'attendre cinq minutes entre chaque point :
 * on appelle `merger()` sur des points fabriqués, et on regarde ce qu'il en
 * sort. Le guichet disparaît du bundle final.
 */
if (import.meta.env.DEV) {
  ;(window as unknown as { __journal?: unknown }).__journal = { merger, rendre, relire }
}
