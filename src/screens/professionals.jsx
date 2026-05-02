import React from 'react'
import { T, Sidebar, TopBar } from './shared.jsx'

export default function ProfessionalsScreen({ onNavigate }) {
  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', background: T.bg, fontFamily: T.sans, color: T.ink }}>
      <Sidebar active="professionals" onNavigate={onNavigate} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar title="Profesionales" subtitle="Gestión de los profesionales del centro" />
        <div style={{
          flex: 1, display: 'grid', placeItems: 'center',
          color: T.inkMuted, fontStyle: 'italic', fontFamily: T.serif, fontSize: 18,
        }}>
          Próximamente
        </div>
      </div>
    </div>
  )
}
