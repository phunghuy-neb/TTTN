import Notification from '../models/Notification.js'

export async function createNotification(data, session = null) {
  const document = {
    user: data.user,
    type: data.type || 'system',
    title: data.title,
    message: data.message,
    link: data.link || '/notifications',
    ...(data.uniqueKey ? { uniqueKey: data.uniqueKey } : {}),
  }

  if (data.uniqueKey) {
    return Notification.findOneAndUpdate(
      { user: data.user, uniqueKey: data.uniqueKey },
      { $setOnInsert: document },
      { upsert: true, new: true, setDefaultsOnInsert: true, session }
    )
  }

  const [notification] = await Notification.create([document], { session })
  return notification
}

let lastCleanupAt = 0
export async function cleanupOldNotifications({ force = false } = {}) {
  const now = Date.now()
  if (!force && now - lastCleanupAt < 24 * 60 * 60_000) return 0
  lastCleanupAt = now
  const readDays = Math.max(7, Number(process.env.NOTIFICATION_RETENTION_DAYS) || 90)
  const unreadDays = Math.max(readDays, Number(process.env.UNREAD_NOTIFICATION_RETENTION_DAYS) || 365)
  const result = await Notification.deleteMany({
    $or: [
      { isRead: true, createdAt: { $lt: new Date(now - readDays * 86400000) } },
      { createdAt: { $lt: new Date(now - unreadDays * 86400000) } },
    ],
  })
  return result.deletedCount
}
