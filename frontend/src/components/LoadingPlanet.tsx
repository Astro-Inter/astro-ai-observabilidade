import { useId } from 'react'
import './LoadingPlanet.css'

interface LoadingPlanetProps {
  label?: string
}

export default function LoadingPlanet({ label = 'Carregando' }: LoadingPlanetProps) {
  const id = useId().replace(/:/g, '')
  const sphereClip = `loading-planet-sphere-${id}`
  const moonClip = `loading-planet-moon-${id}`
  const moonShape = `loading-planet-shape-${id}`

  return <div className="loading-planet" role="status" aria-live="polite">
    <svg className="loading-planet-svg" viewBox="0 0 430 374" aria-hidden="true" fill="none">
      <defs>
        <clipPath id={sphereClip}><circle cx="215" cy="187" r="106" /></clipPath>
        <clipPath id={moonClip}><circle cx="0" cy="0" r="24.5" /></clipPath>
        <g id={moonShape}>
          <circle cx="0" cy="0" r="24.5" fill="#9E06D7" stroke="#8A38F5" strokeWidth="1" />
          <g clipPath={`url(#${moonClip})`}>
            <path fillRule="evenodd" fill="#8F00C4" fillOpacity="0.5" d="M -24.5 0 a 24.5 24.5 0 1 0 49 0 a 24.5 24.5 0 1 0 -49 0 M -13.89 -10.61 a 24.5 24.5 0 1 0 49 0 a 24.5 24.5 0 1 0 -49 0" />
          </g>
        </g>
      </defs>

      <g className="loading-planet-wobble">
        <path className="loading-planet-ring" d="M 20 187 A 195 23.381 0 0 1 410 187" />
        <use className="loading-planet-moon loading-planet-moon--back" href={`#${moonShape}`} />
      </g>

      <circle cx="215" cy="187" r="106" fill="#081F8B" />
      <g clipPath={`url(#${sphereClip})`}>
        <path fillRule="evenodd" fill="#8F00C4" fillOpacity="0.5" d="M 109 187 a 106 106 0 1 0 212 0 a 106 106 0 1 0 -212 0 M 154.894 141.106 a 106 106 0 1 0 212 0 a 106 106 0 1 0 -212 0" />
      </g>

      <g className="loading-planet-wobble">
        <path className="loading-planet-ring" d="M 20 187 A 195 23.381 0 0 0 410 187" />
        <use className="loading-planet-moon loading-planet-moon--front" href={`#${moonShape}`} />
      </g>
    </svg>

    <p className="loading-planet-label"><span>{label}</span><span className="loading-planet-dots" aria-hidden="true" /></p>
  </div>
}
