import arkAscendedIcon from '../assets/games/ark-ascended.png'
import arkEvolvedIcon from '../assets/games/ark-evolved.png'

/** Maps GameDefinition.iconFileName -> the bundled asset URL Vite resolved it to. Vite
 *  needs static imports to bundle image assets (no dynamic `import(variable)`), so this
 *  is the one place that has to be extended by hand whenever a game is added to the
 *  registry in shared/games.ts. */
export const GAME_ICONS: Record<string, string> = {
  'ark-ascended.png': arkAscendedIcon,
  'ark-evolved.png': arkEvolvedIcon
}
