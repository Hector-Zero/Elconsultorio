import { createContext } from 'react'

// Provided by App.jsx (post-login subtree only), consumed by Sidebar,
// settings screens, agenda, etc. for full centro config including
// sensitive keys. Pre-login or pro-mode consumers should use
// useClientBootstrap instead — the safe-public subset suffices.
export const ClientConfigCtx = createContext(null)
