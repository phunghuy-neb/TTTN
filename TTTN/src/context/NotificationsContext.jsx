import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notificationService.js'

const NotificationsContext = createContext(null)

export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const [recent, setRecent] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || user.role === 'admin') {
      setRecent([])
      setUnreadCount(0)
      return { success: true }
    }
    setLoading(true)
    const res = await getNotifications({ limit: 5 })
    if (res.success) {
      setRecent(res.data)
      setUnreadCount(res.unreadCount)
    }
    setLoading(false)
    return res
  }, [user])

  useEffect(() => {
    if (!user || user.role === 'admin') {
      setRecent([])
      setUnreadCount(0)
      return undefined
    }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    return () => window.clearInterval(timer)
  }, [user, refresh])

  const markRead = useCallback(async (id) => {
    const res = await markNotificationRead(id)
    if (res.success) {
      setRecent((items) => items.map((item) => item._id === id ? { ...item, isRead: true } : item))
      setUnreadCount((count) => Math.max(0, count - 1))
    }
    return res
  }, [])

  const markAllRead = useCallback(async () => {
    const res = await markAllNotificationsRead()
    if (res.success) {
      setRecent((items) => items.map((item) => ({ ...item, isRead: true })))
      setUnreadCount(0)
    }
    return res
  }, [])

  const value = useMemo(() => ({ recent, unreadCount, loading, refresh, markRead, markAllRead }), [recent, unreadCount, loading, refresh, markRead, markAllRead])
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
  return useContext(NotificationsContext)
}
