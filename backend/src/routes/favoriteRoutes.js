import { Router } from 'express'
import { protect } from '../middleware/auth.js'
import { addFavorite, getFavoriteIds, getFavorites, getFavoriteSuggestions, removeFavorite } from '../controllers/favoriteController.js'

const router = Router()
router.use(protect)
router.get('/ids', getFavoriteIds)
router.get('/suggestions', getFavoriteSuggestions)
router.get('/', getFavorites)
router.post('/:tourId', addFavorite)
router.delete('/:tourId', removeFavorite)

export default router
