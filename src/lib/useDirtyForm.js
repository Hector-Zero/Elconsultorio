import { useContext, useEffect, useMemo, useRef } from 'react'
import { DirtyGuardCtx } from './DirtyGuardContext.jsx'

// Tracks whether a form's current state has diverged from its last-saved
// snapshot, and registers that signal with the DirtyGuardProvider so
// navigation attempts surface the unsaved-changes prompt.
//
// Signature:
//   const { isDirty, registerSaved, resetSnapshot } =
//     useDirtyForm(formId, getCurrentState, options?)
//
//   formId            — stable string unique to this form (e.g. 'settings/profile')
//   getCurrentState   — () => any. Called on every render and on demand
//                       by the guard. Default comparator is JSON.stringify
//                       equality against the snapshot.
//   options.comparator — (current, snapshot) => boolean. True means equal
//                        (i.e. NOT dirty). Use this when state is not
//                        JSON-stringifiable or you want a tighter check.
//   options.initialSnapshot — value to seed the snapshot with; defaults
//                             to the first getCurrentState() call.
//
// Returned:
//   isDirty         — boolean recomputed each render
//   registerSaved() — captures current state as the new snapshot (call
//                     after successful save so subsequent renders read
//                     not-dirty)
//   resetSnapshot(s) — manually replace the snapshot (pass an explicit
//                      value or omit to capture current state)
//
// The snapshot lives in a ref so updates don't trigger re-renders.
export function useDirtyForm(formId, getCurrentState, options = {}) {
  const { comparator, initialSnapshot } = options
  const ctx = useContext(DirtyGuardCtx)

  // Stable ref to the accessor so the getter registered with the guard
  // always reads the latest closure (useEffect would otherwise capture
  // the accessor at registration time).
  const accessorRef = useRef(getCurrentState)
  accessorRef.current = getCurrentState

  const snapshotRef = useRef(undefined)
  if (snapshotRef.current === undefined) {
    snapshotRef.current = initialSnapshot !== undefined
      ? serialize(initialSnapshot, comparator)
      : serialize(getCurrentState(), comparator)
  }

  const isDirty = useMemo(() => {
    return computeDirty(getCurrentState(), snapshotRef.current, comparator)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  useEffect(() => {
    if (!ctx) return
    ctx.register(formId, () => {
      try {
        return computeDirty(accessorRef.current(), snapshotRef.current, comparator)
      } catch {
        return false
      }
    })
    return () => ctx.unregister(formId)
    // comparator intentionally omitted — re-registering on every render
    // when callers pass an inline comparator would thrash the Map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, formId])

  return {
    isDirty,
    registerSaved() {
      snapshotRef.current = serialize(accessorRef.current(), comparator)
    },
    resetSnapshot(s) {
      const next = s !== undefined ? s : accessorRef.current()
      snapshotRef.current = serialize(next, comparator)
    },
  }
}

// When a custom comparator is supplied the snapshot is stored as-is
// (the comparator handles structural equality). Otherwise we cache the
// JSON-serialized form so dirty checks are O(state-size) string compare.
function serialize(value, comparator) {
  if (comparator) return value
  try { return JSON.stringify(value) } catch { return undefined }
}

function computeDirty(current, snapshot, comparator) {
  if (comparator) return !comparator(current, snapshot)
  try { return JSON.stringify(current) !== snapshot } catch { return false }
}
