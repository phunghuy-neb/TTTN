import fs from 'fs/promises'
import mongoose from 'mongoose'
import Booking from '../models/Booking.js'
import Tour from '../models/Tour.js'
import { createNotification } from '../services/notificationService.js'

function reviewError(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code })
}

function imageUrl(req, filename) {
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
  const requestBaseUrl = `${req.protocol}://${req.get('host')}`
  return `${publicBaseUrl || requestBaseUrl}/uploads/${encodeURIComponent(filename)}`
}

async function cleanupFiles(files = []) {
  await Promise.allSettled(files.map((file) => fs.unlink(file.path)))
}

export async function createReview(req, res) {
  try {
    const { tourId } = req.params
    const { bookingId, rating, comment } = req.body
    const score = Number(rating)
    const cleanComment = String(comment || '').trim()

    if (!mongoose.isValidObjectId(tourId) || !mongoose.isValidObjectId(bookingId)) {
      throw reviewError('Mã tour hoặc mã đơn không hợp lệ.', 400, 'VALIDATION_ERROR')
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw reviewError('Điểm đánh giá phải từ 1 đến 5 sao.', 400, 'VALIDATION_ERROR')
    }
    if (cleanComment.length < 10 || cleanComment.length > 1000) {
      throw reviewError('Nội dung đánh giá cần từ 10 đến 1000 ký tự.', 400, 'VALIDATION_ERROR')
    }

    const images = (req.files || []).map((file) => imageUrl(req, file.filename))
    let savedReview

    await mongoose.connection.transaction(async (session) => {
      const booking = await Booking.findOneAndUpdate(
        {
          _id: bookingId,
          user: req.user._id,
          tour: tourId,
          status: 'completed',
          reviewed: false,
        },
        { $set: { reviewed: true } },
        { new: true, session }
      )

      if (!booking) {
        const current = await Booking.findOne({ _id: bookingId, user: req.user._id, tour: tourId }).session(session)
        if (!current) throw reviewError('Không tìm thấy đơn hoàn thành phù hợp với tour này.', 404, 'BOOKING_NOT_FOUND')
        if (current.reviewed) throw reviewError('Đơn này đã được đánh giá.', 409, 'ALREADY_REVIEWED')
        throw reviewError('Chỉ có thể đánh giá sau khi tour đã hoàn thành.', 409, 'BOOKING_NOT_COMPLETED')
      }

      const tour = await Tour.findById(tourId).session(session)
      if (!tour) throw reviewError('Không tìm thấy tour.', 404, 'TOUR_NOT_FOUND')

      tour.reviews.push({
        user: req.user._id,
        booking: booking._id,
        rating: score,
        comment: cleanComment,
        images,
        isVisible: true,
      })
      const visibleReviews = tour.reviews.filter((review) => review.isVisible !== false)
      tour.avgRating = visibleReviews.length
        ? visibleReviews.reduce((sum, review) => sum + review.rating, 0) / visibleReviews.length
        : 0
      await tour.save({ session })
      savedReview = tour.reviews[tour.reviews.length - 1]

      await createNotification({
        user: req.user._id,
        type: 'review',
        title: 'Cảm ơn bạn đã đánh giá',
        message: `Đánh giá ${score} sao cho ${tour.name} đã được đăng.`,
        link: `/tour/${tour.slug}#reviews`,
        uniqueKey: `review-created:${booking._id}`,
      }, session)
    })

    res.status(201).json({
      success: true,
      message: 'Đăng đánh giá thành công.',
      review: {
        ...savedReview.toObject(),
        user: { _id: req.user._id, name: req.user.name, avatar: req.user.avatar || '' },
      },
    })
  } catch (error) {
    await cleanupFiles(req.files)
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message, code: error.code })
    }
    console.error('[createReview]', error)
    res.status(500).json({ success: false, message: 'Không đăng được đánh giá.' })
  }
}
