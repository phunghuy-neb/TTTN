import mongoose from 'mongoose'
import User from '../models/User.js'
import Tour from '../models/Tour.js'

const publicTourFilter = { status: 'published', isActive: { $ne: false } }

export async function getFavoriteIds(req, res) {
  try {
    const user = await User.findById(req.user._id).select('favorites').lean()
    const ids = await Tour.find({ ...publicTourFilter, _id: { $in: user?.favorites || [] } }).distinct('_id')
    res.json({ success: true, ids: ids.map(String) })
  } catch (error) {
    console.error('[getFavoriteIds]', error)
    res.status(500).json({ success: false, message: 'Không tải được danh sách yêu thích.' })
  }
}

export async function getFavorites(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 12))
    const user = await User.findById(req.user._id).select('favorites').lean()
    const orderedIds = [...(user?.favorites || [])].reverse()
    const validTours = await Tour.find({ ...publicTourFilter, _id: { $in: orderedIds } })
      .select('-itinerary -reviews -vectorSync -searchText')
      .lean()
    const byId = new Map(validTours.map((tour) => [String(tour._id), tour]))
    const orderedTours = orderedIds.map((id) => byId.get(String(id))).filter(Boolean)
    const total = orderedTours.length
    const tours = orderedTours.slice((page - 1) * limit, page * limit)
    res.json({ success: true, tours, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) })
  } catch (error) {
    console.error('[getFavorites]', error)
    res.status(500).json({ success: false, message: 'Không tải được danh sách yêu thích.' })
  }
}

export async function getFavoriteSuggestions(req, res) {
  try {
    const limit = Math.min(12, Math.max(1, Number(req.query.limit) || 4))
    const user = await User.findById(req.user._id).select('favorites').lean()
    const favoriteIds = user?.favorites || []
    const favorites = await Tour.find({ _id: { $in: favoriteIds } }).select('region location tags').lean()
    const regions = [...new Set(favorites.map((tour) => tour.region).filter(Boolean))]
    const locations = [...new Set(favorites.map((tour) => tour.location).filter(Boolean))]
    const tags = [...new Set(favorites.flatMap((tour) => tour.tags || []).filter(Boolean))]

    const affinity = []
    if (regions.length) affinity.push({ region: { $in: regions } })
    if (locations.length) affinity.push({ location: { $in: locations } })
    if (tags.length) affinity.push({ tags: { $in: tags } })

    const baseFilter = { ...publicTourFilter, _id: { $nin: favoriteIds } }
    const candidates = await Tour.find(affinity.length ? { ...baseFilter, $or: affinity } : baseFilter)
      .select('-itinerary -reviews -departures -vectorSync -searchText')
      .sort({ avgRating: -1, createdAt: -1 })
      .limit(40)
      .lean()

    const regionSet = new Set(regions)
    const locationSet = new Set(locations)
    const tagSet = new Set(tags)
    const suggestions = candidates
      .map((tour) => ({
        tour,
        score: (regionSet.has(tour.region) ? 3 : 0)
          + (locationSet.has(tour.location) ? 2 : 0)
          + (tour.tags || []).filter((tag) => tagSet.has(tag)).length * 2
          + Number(tour.avgRating || 0) / 5,
      }))
      .sort((a, b) => b.score - a.score || Number(b.tour.avgRating || 0) - Number(a.tour.avgRating || 0))
      .slice(0, limit)
      .map(({ tour }) => tour)

    res.json({ success: true, tours: suggestions })
  } catch (error) {
    console.error('[getFavoriteSuggestions]', error)
    res.status(500).json({ success: false, message: 'Không tải được gợi ý tour.' })
  }
}

export async function addFavorite(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.tourId)) {
      return res.status(400).json({ success: false, message: 'Mã tour không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    const tour = await Tour.findOne({ _id: req.params.tourId, ...publicTourFilter }).select('_id')
    if (!tour) return res.status(404).json({ success: false, message: 'Không tìm thấy tour đang mở bán.' })
    await User.updateOne({ _id: req.user._id }, { $addToSet: { favorites: tour._id } })
    res.json({ success: true, message: 'Đã thêm tour vào danh sách yêu thích.', tourId: String(tour._id) })
  } catch (error) {
    console.error('[addFavorite]', error)
    res.status(500).json({ success: false, message: 'Không lưu được tour yêu thích.' })
  }
}

export async function removeFavorite(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.tourId)) {
      return res.status(400).json({ success: false, message: 'Mã tour không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    await User.updateOne({ _id: req.user._id }, { $pull: { favorites: req.params.tourId } })
    res.json({ success: true, message: 'Đã bỏ tour khỏi danh sách yêu thích.', tourId: req.params.tourId })
  } catch (error) {
    console.error('[removeFavorite]', error)
    res.status(500).json({ success: false, message: 'Không cập nhật được danh sách yêu thích.' })
  }
}
