// Event bus nhỏ cho chat — các nút CTA "Hỏi trợ lý AI" rải rác (Home, TourDetail)
// mở được panel chat mà không cần prop-drilling hay import chéo component.
const listeners = new Set()

export function onOpenChat(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitOpenChat() {
  for (const listener of [...listeners]) listener()
}
