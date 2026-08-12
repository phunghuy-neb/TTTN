import mongoose from 'mongoose'
import Notification from '../models/Notification.js'

export async function getNotifications(req, res) {
  try {
    const page = Math.max(1, Number(req.query.page) || 1)
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10))
    const filter = { user: req.user._id }
    if (req.query.unreadOnly === 'true') filter.isRead = false
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort('-createdAt').skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user._id, isRead: false }),
    ])
    res.json({
      success: true,
      notifications,
      unreadCount,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  } catch (error) {
    console.error('[getNotifications]', error)
    res.status(500).json({ success: false, message: 'Không tải được thông báo.' })
  }
}

export async function markNotificationRead(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Mã thông báo không hợp lệ.', code: 'VALIDATION_ERROR' })
    }
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    )
    if (!notification) return res.status(404).json({ success: false, message: 'Không tìm thấy thông báo.' })
    res.json({ success: true, notification })
  } catch (error) {
    console.error('[markNotificationRead]', error)
    res.status(500).json({ success: false, message: 'Không cập nhật được thông báo.' })
  }
}

export async function markAllNotificationsRead(req, res) {
  try {
    const result = await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    )
    res.json({ success: true, message: 'Đã đánh dấu tất cả thông báo là đã đọc.', updated: result.modifiedCount })
  } catch (error) {
    console.error('[markAllNotificationsRead]', error)
    res.status(500).json({ success: false, message: 'Không cập nhật được thông báo.' })
  }
}
