import React, { createContext, useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmModal } from '../screens/shared.jsx'

// Central registry for forms with unsaved changes. Editors register a
// dirty-getter on mount (typically via useDirtyForm) and unregister on
// unmount. Navigation attempts route through guard.confirm(action):
// if any registered form reports dirty, a Spanish "Tienes cambios sin
// guardar" modal opens; on confirm the action runs, on cancel it does
// not. Page-level unload (refresh / close-tab) triggers the browser's
// native prompt via beforeunload.
//
// SPA-internal navigation is intercepted only where callers route
// through guard.confirm (e.g. the wrapped navigate in App.jsx and the
// sub-tab switcher in settings.jsx). Direct window.location.hash
// mutations bypass the guard — this is acceptable for now; commit 2
// wires up the remaining call sites.

export const DirtyGuardCtx = createContext(null)

export function DirtyGuardProvider({ children }) {
  // Map<formId, () => boolean>. Lives in a ref so register/unregister
  // don't trigger re-renders of the whole tree.
  const registryRef = useRef(new Map())
  // Stored as a wrapper object so React doesn't unwrap the function
  // (setState(fn) treats functions as updaters).
  const [pending, setPending] = useState(null)

  const register = useCallback((formId, getter) => {
    registryRef.current.set(formId, getter)
  }, [])

  const unregister = useCallback((formId) => {
    registryRef.current.delete(formId)
  }, [])

  const anyDirty = useCallback(() => {
    for (const getter of registryRef.current.values()) {
      try { if (getter()) return true } catch {}
    }
    return false
  }, [])

  const confirm = useCallback((action) => {
    if (typeof action !== 'function') return
    if (!anyDirty()) { action(); return }
    setPending({ action })
  }, [anyDirty])

  useEffect(() => {
    function handler(e) {
      if (!anyDirty()) return
      // Modern browsers ignore the custom string but require both
      // preventDefault() and a returnValue assignment to show the
      // native unload prompt. This is a security constraint — the
      // message itself cannot be customized.
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [anyDirty])

  const value = { register, unregister, anyDirty, confirm }

  return (
    <DirtyGuardCtx.Provider value={value}>
      {children}
      {pending && (
        <ConfirmModal
          title="Tienes cambios sin guardar"
          description="¿Quieres salir sin guardar los cambios?"
          confirmLabel="Salir sin guardar"
          cancelLabel="Seguir editando"
          variant="danger"
          onConfirm={() => {
            const fn = pending.action
            setPending(null)
            fn()
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </DirtyGuardCtx.Provider>
  )
}
