/**
 * Node exige l'extension dans les imports ; Vite ne la demande pas, et tout le
 * code du jeu est écrit sans. Plutôt que d'alourdir les sources pour faire
 * plaisir aux outils, on apprend à Node à retrouver le fichier.
 *
 *   node --import ./tools/resolveur-ts.mjs tools/verifier-anims.ts
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

/*
 * ⚠️ ON ENCODE LE PAYLOAD, ET CE N'EST PAS UN DÉTAIL DE COIFFURE.
 *
 * L'argument de `register` est une URL `data:`. Telle quelle, elle est
 * coupée au premier caractère qui lui est réservé — et le hook qu'on charge
 * contient des `/`, des `$`, des `(` et des `\`, autant de façons de faire
 * échouer un parseur d'URL. Le premier jet marchait par chance ; dès qu'on
 * ajoute une ligne, Node rend un `SyntaxError: Unexpected token` qui ne
 * mentionne même pas le fichier fautive.
 *
 * `encodeURIComponent` ne laisse passer aucun de ces caractères.
 */
const resolveur = `export function resolve(spec, ctx, next) {
  /*
   * On coupe la chaîne sur le premier « ? » avant de chercher l'extension :
   * \`verifier-serveur.ts\` importe \`../src/compte.ts?v=1\` pour obtenir un
   * module NEUF à chaque phase (le module garde son état : jeton, catalogue,
   * veille). Sans cette coupe, la règle ci-dessous croirait que le fichier
   * n'a pas d'extension et produirait \`compte.ts?v=1.ts\` — introuvable.
   */
  const i = spec.indexOf(String.fromCharCode(63))
  const chemin = i < 0 ? spec : spec.slice(0, i)
  const fin = i < 0 ? '' : spec.slice(i)
  if (spec.startsWith('.') && !/\\.(ts|js|json|mjs)$/.test(chemin)) {
    try { return next(chemin + '.ts' + fin, ctx) } catch {}
  }
  return next(spec, ctx)
}`

register('data:text/javascript,' + encodeURIComponent(resolveur), pathToFileURL('./'))
