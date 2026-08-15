export function BotIcon({ className = 'h-6 w-6' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3V1.75M8.25 7h7.5A3.25 3.25 0 0 1 19 10.25v5.5A3.25 3.25 0 0 1 15.75 19h-7.5A3.25 3.25 0 0 1 5 15.75v-5.5A3.25 3.25 0 0 1 8.25 7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.75 13h.01M15.25 13h.01M9.25 16h5.5M3.25 12v3M20.75 12v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="4.5" r="1.25" fill="currentColor" />
    </svg>
  )
}

export function HistoryIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7v5h5M5.25 17A8 8 0 1 0 4 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8v4l2.75 1.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function PlusIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function CloseIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function SendIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m4 4 17 8-17 8 3-8-3-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M7 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export function ArrowUpRightIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 17 17 7M8 7h9v9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ZaloIcon({ className = 'h-8 w-8' }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M10 8h28a6 6 0 0 1 6 6v16a6 6 0 0 1-6 6H24l-9 6v-6h-5a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z" fill="white" />
      <text x="24" y="27.5" textAnchor="middle" fill="#0068ff" fontSize="13" fontWeight="800" fontFamily="Arial, sans-serif">Zalo</text>
    </svg>
  )
}

export function MessengerIcon({ className = 'h-7 w-7' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path fill="currentColor" d="M16 3C8.82 3 3 8.39 3 15.04c0 3.79 1.89 7.17 4.84 9.38V29l4.43-2.43c1.18.33 2.43.51 3.73.51 7.18 0 13-5.39 13-12.04S23.18 3 16 3Zm1.29 16.21-3.31-3.53-6.46 3.53 7.1-7.54 3.39 3.53 6.38-3.53-7.1 7.54Z" />
    </svg>
  )
}
