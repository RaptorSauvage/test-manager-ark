/**
 * Mounts the REAL, completely unmodified src/renderer/src/pages/ChangelogView.tsx - a thirteenth
 * real page, and the cheapest one in this PoC to port: it has ZERO window.api calls, zero
 * sidecar RPC methods, zero Tauri commands - just real, static content from the real,
 * unmodified @shared/changelog's CHANGELOG constant, rendered by real React. No shim object
 * needed at all. Proves this PoC's rendering pipeline (esbuild bundling the real component tree,
 * JSX runtime, CSS) works for a page with no IPC surface whatsoever, not just the nine before it
 * that all needed one.
 */
import { createRoot } from 'react-dom/client'
import ChangelogView from '../../src/renderer/src/pages/ChangelogView'

const container = document.getElementById('root')
if (!container) throw new Error('changelog.html is missing #root')
createRoot(container).render(<ChangelogView onBack={() => window.history.back()} />)
