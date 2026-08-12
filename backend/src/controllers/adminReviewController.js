import mongoose from 'mongoose'
import Tour from '../models/Tour.js'
import { createNotification } from '../services/notificationService.js'

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function getAdminReviews(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12))
    const rating = Number(req.query.rating)
    const visibility = String(req.query.visibility || '')
    const q = String(req.query.q || '').trim()

    if (req.query.rating && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      return res.status(400).json({ success: false, message: 'Điểm lọc phải từ 1 đến 5.', code: 'VALIDATION_ERROR' })
    }
    if (visibility && !['visible', 'hidden'].includes(visibility)) {
      return res.status(400).json({ success: false, message: 'Trạng thái hiển thị không hợp lệ.', code: 'VALIDATION_ERROR' })
    }

    const filters = []
    if (req.query.rating) filters.push({ 'reviews.rating': rating })
    if (visibility === 'visible') filters.push({ 'reviews.isVisible': { $ne: false } })
    if (visibility === 'hidden') filters.push({ 'reviews.isVisible': false })
    if (q) {
      const regex = new RegExp(escapeRegex(q), 'i')
      filters.push({ $or: [{ name: regex }, { 'reviews.comment': regex }, { 'reviewer.name': regex }, { 'reviewer.email': regex }] })
    }

    const pipeline = [
      { $match: { 'reviews.0': { $exists: true } } },
      { $unwind: '$reviews' },
      { $lookup: { from: 'users', localField: 'reviews.user', foreignField: '_id', as: 'reviewer' } },
      { $unwind: { path: '$reviewer', preserveNullAndEmptyArrays: true } },
      ...(filters.length ? [{ $match: { $and: filters } }] : []),
      { $sort: { 'reviews.createdAt': -1 } },
      {
        $facet: {
          rows: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: '$reviews._id',
                rating: '$reviews.rating',
                comment: '$reviews.comment',
                images: '$reviews.images',
                isVisible: { $ne: ['$reviews.isVisible', false] },
                createdAt: '$reviews.createdAt',
                booking: '$reviews.booking',
                tour: { _id: '$_id', name: '$name', slug: '$slug' },
                user: { _id: '$reviewer._id', name: '$reviewer.name', email: '$reviewer.email' },
              },
            },
          ],
          meta: [{ $count: 'total' }],
        },
      },
    ]

    const [result] = await Tour.aggregate(pipeline)
    const total = result?.meta?.[0]?.total || 0
    res.json({
      success: true,
      reviews: result?.rows || [],
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  } catch (error) {
    console.error('[getAdminReviews]', error)
    res.status(500).json({ success: false, message: 'Không tải được danh sách đánh giá.' })
  }
}

export async function updateReviewVisibility(req, res) {
  try {
    const { tourId, reviewId } = req.params
    if (!mongoose.isValidObjectId(tourId) || !mongoose.isValidObjectId(reviewId) || typeof req.body?.isVisible !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Dữ liệu đánh giá không hợp lệ.', code: 'VALIDATION_ERROR' })
    }

    let updatedReview
    await mongoose.connection.transaction(async (session) => {
      const tour = await Tour.findOne({ _id: tourId, 'reviews._id': reviewId }).session(session)
      if (!tour) {
        throw Object.assign(new Error('Không tìm thấy đánh giá.'), { statusCode: 404, code: 'NOT_FOUND' })
      }
      const review = tour.reviews.id(reviewId)
      review.isVisible = req.body.isVisible
      const visibleReviews = tour.reviews.filter((item) => item.isVisible !== false)
      tour.avgRating = visibleReviews.length
        ? visibleReviews.reduce((sum, item) => sum + item.rating, 0) / visibleReviews.length
        : 0
      await tour.save({ session })
      updatedReview = review.toObject()

      await createNotification({
        user: review.user,
        type: 'review',
        title: req.body.isVisible ? 'Đánh giá đã được hiển thị' : 'Đánh giá đã được ẩn',
        message: req.body.isVisible
          ? `Đánh giá của bạn cho ${tour.name} đã được hiển thị trở lại.`
          : `Đánh giá của bạn cho ${tour.name} đã được quản trị viên ẩn khỏi trang tour.`,
        link: req.body.isVisible ? `/tour/${tour.slug}#reviews` : '/notifications',
        uniqueKey: `review-visibility:${review._id}:${req.body.isVisible ? 'visible' : 'hidden'}`,
      }, session)
    })

    res.json({
      success: true,
      message: req.body.isVisible ? 'Đã hiển thị đánh giá.' : 'Đã ẩn đánh giá.',
      review: updatedReview,
    })
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code })
    console.error('[updateReviewVisibility]', error)
    res.status(500).json({ success: false, message: 'Không cập nhật được đánh giá.' })
  }
}
