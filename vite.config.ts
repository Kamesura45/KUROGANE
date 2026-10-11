import { defineConfig, type Plugin } from 'vite'

/*
 * ————— La configuration de build —————
 *
 * Elle n'existait pas : sans `vite.config.ts`, chaque `*.html` à la racine est
 * une entrée et tout le reste suit les défauts. Deux choses méritaient mieux.
 *
 * ⚠️ RIEN ICI NE CHANGE LE COMPORTEMENT DU JEU. C'est de l'emballage.
 */

/*
 * ————— 1. Les commentaires HTML ne voyagent pas —————
 *
 * `index.html` fait 55,8 kB, dont **20,8 kB de commentaires** (37,4 %). Ce
 * sont de longs blocs d'explication écrits au fil des corrections — la
 * mémoire du dépôt — et ils partaient en production, téléchargés par chaque
 * joueur à chaque visite.
 *
 * On les retire AU BUILD. La source les garde tous, le README aussi : rien
 * n'est perdu, seul l'empaquetage s'allège.
 *
 * Pourquoi un plugin maison plutôt qu'une dépendance ? Parce qu'il fait une
 * seule chose, en une ligne, et qu'ajouter un paquet pour ça serait payer
 * plus lourd ce qu'on veut alléger.
 *
 * Sécurité : on ne touche PAS au contenu des `<script>` ni des `<style>`.
 * `index.html` en a un seul, et il est vide (un simple `<script type="module"
 * src="…">`). Le motif s'arrête au premier `-->`, donc il ne peut pas
 * traverser un bloc.
 */
function sansCommentairesHtml(): Plugin {
  return {
    name: 'kurogane:sans-commentaires-html',
    enforce: 'pre',
    transformIndexHtml: (html) => html.replace(/<!--[\s\S]*?-->/g, ''),
  }
}

/*
 * ————— 2. Le bundle en trois morceaux —————
 *
 * ⚠️ ÇA NE RÉDUIT PAS LE POIDS DU PREMIER CHARGEMENT, ET C'EST VOULU.
 *
 * Le menu est une SCÈNE 3D : `main.ts` crée son `WebGLRenderer` au
 * démarrage, et `menu.ts` montre un aperçu du guerrier. Three.js est donc
 * requis dès la première image — on ne peut pas le renvoyer à plus tard.
 *
 * Ce que le découpage change, c'est la SUITE :
 *
 *  · trois requêtes au lieu d'une, donc parallèles sur HTTP/2 ;
 *  · et surtout, une modification du jeu ne re-télécharge PLUS three.js.
 *    Aujourd'hui le bundle fait un seul bloc d'1 Mo : chaque commit renvoie
 *    les 650 kB de three.js à tout le monde. Après, seul le chunk du jeu
 *    change de hachage.
 *
 * Sur cette machine (HDD, 8 Go) et en 4G, c'est la mise à jour qui coûte,
 * pas la première visite.
 */
const groupes = [
  {
    name: 'three',
    // `[\\/]` et non `/` : sous Windows le séparateur est un antislash, et un
    // motif écrit à la main ne matcherait plus rien.
    test: /node_modules[\\/]three[\\/]/,
    priority: 20,
  },
  {
    name: 'colyseus',
    test: /node_modules[\\/]@colyseus[\\/]/,
    priority: 20,
  },
]

export default defineConfig({
  plugins: [sansCommentairesHtml()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: { groups: groupes },
      },
    },
  },
})
