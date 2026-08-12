import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { addFavorite, getFavoriteIds, removeFavorite } from '../services/favoriteService.js'

const FavoritesContext = createContext(null)

export function FavoritesProvider({ children }) {
  const { user } = useAuth()
  const [ids, setIds] = useState([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || user.role === 'admin') {
      setIds([])
      return { success: true, data: [] }
    }
    setLoading(true)
    const res = await getFavoriteIds()
    if (res.success) setIds(res.data)
    setLoading(false)
    return res
  }, [user])

  useEffect(() => {
    let active = true
    if (!user || user.role === 'admin') {
      setIds([])
      return undefined
    }
    setLoading(true)
    getFavoriteIds().then((res) => {
      if (!active) return
      if (res.success) setIds(res.data)
      setLoading(false)
    })
    return () => { active = false }
  }, [user])

  const toggleFavorite = useCallback(async (tourId) => {
    if (!user || user.role === 'admin') {
      return { success: false, message: 'Chức năng yêu thích chỉ dành cho khách hàng.', isFavorite: false }
    }
    const isFavorite = ids.includes(String(tourId))
    const res = isFavorite ? await removeFavorite(tourId) : await addFavorite(tourId)
    if (res.success) {
      setIds((current) => isFavorite
        ? current.filter((id) => id !== String(tourId))
        : [...current, String(tourId)])
    }
    return { ...res, isFavorite: res.success ? !isFavorite : isFavorite }
  }, [ids, user])

  const value = useMemo(() => ({
    favoriteIds: new Set(ids),
    loading,
    refresh,
    toggleFavorite,
  }), [ids, loading, refresh, toggleFavorite])

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}

export function useFavorites() {
  return useContext(FavoritesContext)
}
