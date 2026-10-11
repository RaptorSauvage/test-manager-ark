// Ports of the standalone bot's external status checks, verbatim in behavior and FR wording -
// each is a simple best-effort HTTP check against a third-party status feed, independent of
// the Manager entirely. Every function returns [line, severity] (0 = ok, 1 = degraded/unknown,
// 2 = severe), same convention as the Python originals.
import { log } from './logging'

const FETCH_TIMEOUT_MS = 5000

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

/** Same as `fetchWithTimeout`, but parses the body as JSON itself after discarding
 *  whatever junk precedes the actual JSON - confirmed in practice against the real AWS
 *  Health endpoint, which serves some. `response.json()` calls `JSON.parse` directly on
 *  the raw text and doesn't tolerate any of it, so a prefixed response fails with
 *  "Unexpected token" every single time, not as a transient network issue. A first attempt
 *  here only stripped a single leading UTF-8 BOM character - too narrow: a real capture
 *  showed *two* BOM-like characters in a row, still breaking `JSON.parse` after stripping
 *  only one. Instead of guessing how many (or what exactly) precedes it, this finds the
 *  first `[` or `{` in the text and parses from there - correct no matter what junk comes
 *  before it, since every response this function is used for is always a JSON array or
 *  object at the top level. */
async function fetchJsonWithTimeout(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url)
  const text = await response.text()
  const jsonStart = text.search(/[[{]/)
  return JSON.parse(jsonStart === -1 ? text : text.slice(jsonStart))
}

// ---------------------------------------------------------------------------
// Epic Online Services (dont dépend ARK: Survival Ascended)
// ---------------------------------------------------------------------------
const EOS_STATUS_URL = 'https://status.epicgames.com/api/v2/summary.json'
const EOS_COMPONENT_ID = 'zwclljjbtmfs'

const EOS_STATUS_LABELS: Record<string, { icon: string; label: string }> = {
  operational: { icon: '🟢', label: 'Opérationnel' },
  degraded_performance: { icon: '🟡', label: 'Performance dégradée' },
  partial_outage: { icon: '🟠', label: 'Panne partielle' },
  major_outage: { icon: '🔴', label: 'Panne majeure' },
  under_maintenance: { icon: '🔧', label: 'Maintenance en cours' }
}

export async function queryEosStatus(): Promise<[string, number]> {
  try {
    const data = (await fetchJsonWithTimeout(EOS_STATUS_URL)) as { components?: { id?: string; status?: string }[] }
    const component = (data.components ?? []).find((c) => c.id === EOS_COMPONENT_ID)
    if (!component) return ['⚪  **Epic Online Services** - Statut inconnu', 1]

    const statusKey = component.status ?? 'operational'
    const { icon, label } = EOS_STATUS_LABELS[statusKey] ?? { icon: '⚪', label: statusKey }
    const severity = statusKey === 'operational' ? 0 : statusKey === 'major_outage' ? 2 : 1
    return [`${icon}  **Epic Online Services** - ${label}`, severity]
  } catch (err) {
    log.warn(`Impossible de récupérer le statut Epic Online Services : ${(err as Error).message}`)
    return ['⚪  **Epic Online Services** - Statut indisponible', 1]
  }
}

// ---------------------------------------------------------------------------
// Réseau des serveurs officiels ARK: Survival Ascended
// ---------------------------------------------------------------------------
const ASA_OFFICIAL_STATUS_URL = 'https://cdn2.arkdedicated.com/asa/officialserverstatus.ini'
// Capture tout le texte entre le dernier ">" et "(vX.X)" -> gère aussi les statuts à
// plusieurs mots (ex: "Under Maintenance"), pas seulement un mot unique.
const ASA_OFFICIAL_STATUS_RE = />\s*([^<>]+?)\s*\(v([\d.]+)\)\s*</

/** Important : seul le mot-clé exact "Offline" déclenche le statut "Hors ligne" (🔴). Tout
 *  autre texte (maintenance, statut inattendu, échec de parsing, erreur réseau...) est
 *  affiché tel quel avec une icône neutre/jaune, JAMAIS comme "Hors ligne" par défaut. */
export async function queryOfficialNetworkStatus(): Promise<[string, number]> {
  try {
    const response = await fetchWithTimeout(ASA_OFFICIAL_STATUS_URL)
    const text = await response.text()
    const match = ASA_OFFICIAL_STATUS_RE.exec(text)
    if (!match) return ['⚪  **Official Network ASA** - Statut inconnu', 1]

    const statusRaw = match[1].trim()
    const version = match[2]
    const statusLower = statusRaw.toLowerCase()

    if (statusLower === 'online') return [`🟢  **Official Network ASA** - En ligne (v${version})`, 0]
    if (statusLower === 'offline') return [`🔴  **Official Network ASA** - Hors ligne (v${version})`, 2]
    return [`🟡  **Official Network ASA** - ${statusRaw} (v${version})`, 1]
  } catch (err) {
    log.warn(`Impossible de récupérer le statut du réseau officiel ASA : ${(err as Error).message}`)
    return ['⚪  **Official Network ASA** - Statut indisponible', 1]
  }
}

// ---------------------------------------------------------------------------
// Amazon Web Services (AWS Health Dashboard - événements publics en cours)
// ---------------------------------------------------------------------------
const AWS_STATUS_URL = 'https://health.aws.amazon.com/public/currentevents'
const MIDDLE_EAST_KEYWORDS = ['middle east', 'bahrain', 'uae', 'me-south-1', 'me-central-1']

export async function queryAwsStatus(): Promise<[string, number]> {
  try {
    const events = (await fetchJsonWithTimeout(AWS_STATUS_URL)) as unknown
    if (!Array.isArray(events)) return ['⚪  **Amazon Web Services** - Statut inconnu', 1]

    // La région Moyen-Orient a des coupures fréquentes et peu pertinentes pour ce bot, on
    // l'ignore pour éviter le bruit (Bahrain = me-south-1, UAE = me-central-1).
    const filtered = (events as { region_name?: string }[]).filter((e) => {
      const region = (e.region_name ?? '').toLowerCase()
      return !MIDDLE_EAST_KEYWORDS.some((kw) => region.includes(kw))
    })

    if (filtered.length === 0) return ['🟢  **Amazon Web Services** - Opérationnel', 0]

    const regions = [...new Set(filtered.map((e) => e.region_name || 'Global'))].sort()
    const regionsStr = regions.slice(0, 5).join(', ') + (regions.length > 5 ? '…' : '')
    const count = filtered.length
    return [`🟠  **Amazon Web Services** - ${count} incident${count !== 1 ? 's' : ''} en cours (${regionsStr})`, 1]
  } catch (err) {
    log.warn(`Impossible de récupérer le statut AWS : ${(err as Error).message}`)
    return ['⚪  **Amazon Web Services** - Statut indisponible', 1]
  }
}

// ---------------------------------------------------------------------------
// Xbox Live (nécessaire pour l'authentification Microsoft côté Minecraft)
// ---------------------------------------------------------------------------
const XBOX_STATUS_URL = 'https://xnotify.xboxlive.com/servicestatusv6/US/en-US'
const XBOX_ISSUE_KEYWORDS = ['impacted', 'outage', 'limited', 'investigating']

/** Flux non documenté par Microsoft (best-effort), même source qu'utilise
 *  support.xbox.com/xbox-live-status. */
export async function queryXboxStatus(): Promise<[string, number]> {
  try {
    const response = await fetchWithTimeout(XBOX_STATUS_URL)
    const textLower = (await response.text()).toLowerCase()
    if (XBOX_ISSUE_KEYWORDS.some((kw) => textLower.includes(kw))) {
      return ['🟠  **Xbox Live** - Incident(s) en cours', 1]
    }
    return ['🟢  **Xbox Live** - Opérationnel', 0]
  } catch (err) {
    log.warn(`Impossible de récupérer le statut Xbox Live : ${(err as Error).message}`)
    return ['⚪  **Xbox Live** - Statut indisponible', 1]
  }
}

// ---------------------------------------------------------------------------
// Cloudflare (statuspage.io)
// ---------------------------------------------------------------------------
const CLOUDFLARE_STATUS_URL = 'https://www.cloudflarestatus.com/api/v2/incidents/unresolved.json'
const CLOUDFLARE_IMPACT_ORDER: Record<string, number> = { none: 0, minor: 1, major: 2, critical: 3 }
const CLOUDFLARE_IMPACT_LABELS: Record<string, { icon: string; label: string; severity: number }> = {
  none: { icon: '🟢', label: 'Opérationnel', severity: 0 },
  minor: { icon: '🟡', label: 'Incident mineur', severity: 1 },
  major: { icon: '🟠', label: 'Incident majeur', severity: 1 },
  critical: { icon: '🔴', label: 'Panne critique', severity: 2 }
}

interface CloudflareIncident {
  name?: string
  impact?: string
  components?: { name?: string }[]
}

/** Détecte les incidents liés à Workers AI, ignorés car peu pertinents pour ce bot (coupures
 *  fréquentes sur ce service précis). */
function isWorkersAiIncident(incident: CloudflareIncident): boolean {
  if ((incident.name ?? '').toLowerCase().includes('workers ai')) return true
  return (incident.components ?? []).some((c) => (c.name ?? '').toLowerCase().includes('workers ai'))
}

export async function queryCloudflareStatus(): Promise<[string, number]> {
  try {
    const data = (await fetchJsonWithTimeout(CLOUDFLARE_STATUS_URL)) as { incidents?: CloudflareIncident[] }
    const incidents = (data.incidents ?? []).filter((inc) => !isWorkersAiIncident(inc))

    if (incidents.length === 0) return ['🟢  **Cloudflare** - Opérationnel', 0]

    const worst = incidents.reduce((a, b) =>
      (CLOUDFLARE_IMPACT_ORDER[b.impact ?? 'minor'] ?? 1) > (CLOUDFLARE_IMPACT_ORDER[a.impact ?? 'minor'] ?? 1) ? b : a
    )
    const { icon, label, severity } = CLOUDFLARE_IMPACT_LABELS[worst.impact ?? 'minor'] ?? {
      icon: '🟡',
      label: 'Incident en cours',
      severity: 1
    }
    const count = incidents.length
    return [`${icon}  **Cloudflare** - ${label} (${count} incident${count !== 1 ? 's' : ''})`, severity]
  } catch (err) {
    log.warn(`Impossible de récupérer le statut Cloudflare : ${(err as Error).message}`)
    return ['⚪  **Cloudflare** - Statut indisponible', 1]
  }
}

// ---------------------------------------------------------------------------
// Minecraft Auth - Mojang/Microsoft n'exposent plus de statuspage publique pour
// l'authentification Minecraft depuis 2022, donc simple test de joignabilité du serveur de
// session utilisé pour authentifier les joueurs en mode "online" (toute réponse HTTP, même
// une erreur 4xx, confirme que le service répond).
// ---------------------------------------------------------------------------
const MINECRAFT_AUTH_URL = 'https://sessionserver.mojang.com/session/minecraft/profile/0'

export async function queryMinecraftAuthStatus(): Promise<[string, number]> {
  try {
    await fetchWithTimeout(MINECRAFT_AUTH_URL)
    return ['🟢  **Minecraft Auth** - Opérationnel', 0]
  } catch (err) {
    log.warn(`Impossible de récupérer le statut Minecraft Auth : ${(err as Error).message}`)
    return ['🔴  **Minecraft Auth** - Injoignable', 2]
  }
}
