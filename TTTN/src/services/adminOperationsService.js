import { downloadFile, request } from './api.js'

export const getDepartureCalendar = ({ from, to }) => request(`/admin/operations/calendar?${new URLSearchParams({ from, to })}`, { auth: true })
export function downloadReport(type, format, filters = {}) {
  const params = new URLSearchParams({ format })
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  return downloadFile(`/admin/operations/reports/${type}?${params}`, `vietvoyage-${type}.${format}`)
}
