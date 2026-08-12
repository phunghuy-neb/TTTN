import { request } from './api.js'

export async function createReview({ tourId, bookingId, rating, comment, images = [] }) {
  const body = new FormData()
  body.set('bookingId', bookingId)
  body.set('rating', String(rating))
  body.set('comment', comment)
  images.forEach((file) => body.append('images', file))
  const res = await request(`/tours/${encodeURIComponent(tourId)}/reviews`, {
    method: 'POST',
    body,
    auth: true,
  })
  if (res.success === false) return res
  return { success: true, data: res.review, message: res.message }
}
