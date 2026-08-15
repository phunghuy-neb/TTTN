import 'dotenv/config'
import mongoose from 'mongoose'
import { TOURS } from '../../TTTN/src/data/tours.js'
import ChatMessage from '../src/models/ChatMessage.js'
import Conversation from '../src/models/Conversation.js'
import Setting from '../src/models/Setting.js'
import Tour from '../src/models/Tour.js'
import User from '../src/models/User.js'

const EXPECTED_DATABASE = 'vietvoyage_browser_uat'
const EXPECTED_PORT = '27018'

function assertIsolatedDatabase(uri) {
  const match = String(uri || '').match(
    /^mongodb:\/\/(?:[^@/]+@)?([^/?]+)\/([^?]+)(?:\?.*)?$/i
  )
  const hosts = match?.[1] || ''
  const database = match?.[2] || ''
  const localHost = hosts === `127.0.0.1:${EXPECTED_PORT}` || hosts === `localhost:${EXPECTED_PORT}`
  if (!localHost || database !== EXPECTED_DATABASE) {
    throw new Error(
      `Refusing to seed non-UAT MongoDB. Expected localhost:${EXPECTED_PORT}/${EXPECTED_DATABASE}.`
    )
  }
}

function upcomingFriday() {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  const daysUntilFriday = (5 - date.getDay() + 7) % 7
  date.setDate(date.getDate() + (daysUntilFriday === 0 ? 7 : daysUntilFriday))
  return date
}

function addDays(date, days) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

async function connectIsolatedDatabase(uri) {
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 })
    return
  } catch (error) {
    await mongoose.disconnect().catch(() => {})
    const directUri = `mongodb://127.0.0.1:${EXPECTED_PORT}/admin?directConnection=true`
    await mongoose.connect(directUri, { serverSelectionTimeoutMS: 3000 })
    try {
      await mongoose.connection.db.admin().command({ replSetGetStatus: 1 })
    } catch (statusError) {
      if (statusError?.code !== 94 && statusError?.codeName !== 'NotYetInitialized') throw error
      await mongoose.connection.db.admin().command({
        replSetInitiate: {
          _id: 'uatrs',
          members: [{ _id: 0, host: `127.0.0.1:${EXPECTED_PORT}` }],
        },
      })
    } finally {
      await mongoose.disconnect()
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 1000 })
        return
      } catch {
        await mongoose.disconnect().catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    throw error
  }
}

function normalizeTour(source, index, firstDeparture) {
  const { _id, reviews, departures, ...tour } = source
  const slotProfiles = [3, 8, 2, 12, 6, 10, 4]
  const firstSlots = slotProfiles[index % slotProfiles.length]
  const priceStep = 150000 + (index % 3) * 100000

  return {
    _id: new mongoose.Types.ObjectId(String(index + 1).padStart(24, '0')),
    ...tour,
    status: 'published',
    isActive: true,
    reviews: [],
    departures: [
      {
        date: firstDeparture,
        totalSlots: Math.max(firstSlots, 12),
        availableSlots: firstSlots,
        price: tour.basePrice + priceStep,
      },
      {
        date: addDays(firstDeparture, 7),
        totalSlots: 16,
        availableSlots: 12,
        price: tour.basePrice + priceStep + 500000,
      },
      {
        date: addDays(firstDeparture, 14),
        totalSlots: 10,
        availableSlots: 4,
        price: Math.max(0, tour.basePrice + priceStep - 200000),
      },
    ],
    vectorSync: { isSynced: false, lastSyncedAt: null, chromaId: '' },
  }
}

const mongoUri = process.env.MONGO_URI
assertIsolatedDatabase(mongoUri)
await connectIsolatedDatabase(mongoUri)

try {
  if (process.argv.includes('--reset')) {
    await mongoose.connection.dropDatabase()
  }

  const firstDeparture = upcomingFriday()
  const fixtures = TOURS.filter((tour) => tour.status === 'published').map((tour, index) =>
    normalizeTour(tour, index, firstDeparture)
  )

  for (const fixture of fixtures) {
    const existing = await Tour.findById(fixture._id)
    if (!existing) await Tour.create(fixture)
  }

  const email = 'browser-uat@example.test'
  let user = await User.findOne({ email })
  if (!user) {
    user = await User.create({
      name: 'Browser UAT User',
      email,
      password: 'BrowserUAT123!',
      phone: '0900000099',
      role: 'customer',
      isActive: true,
    })
  }

  const paginationEmail = 'browser-uat-pagination@example.test'
  let paginationUser = await User.findOne({ email: paginationEmail })
  if (!paginationUser) {
    paginationUser = await User.create({
      name: 'Browser UAT Pagination',
      email: paginationEmail,
      password: 'BrowserUAT123!',
      phone: '0900000098',
      role: 'customer',
      isActive: true,
    })
  }

  if (await Conversation.countDocuments({ userId: paginationUser._id }) === 0) {
    const now = Date.now()
    const conversations = await Conversation.insertMany(
      Array.from({ length: 35 }, (_, index) => ({
        userId: paginationUser._id,
        title: `Pagination fixture ${String(index + 1).padStart(2, '0')}`,
        lastMessageAt: new Date(now - index * 60000),
        nextTurnSequence: index === 0 ? 65 : 0,
        committedTurnSequence: index === 0 ? 65 : 0,
        stateTurnSequence: index === 0 ? 65 : 0,
      }))
    )
    const messageConversation = conversations[0]
    const messages = []
    for (let sequence = 1; sequence <= 65; sequence += 1) {
      const logicalTurnId = `pagination-turn-${String(sequence).padStart(3, '0')}`
      const at = new Date(now - (131 - sequence * 2) * 1000)
      messages.push(
        {
          userId: paginationUser._id,
          conversationId: messageConversation._id,
          logicalTurnId,
          turnSequence: sequence,
          historyEpoch: 0,
          role: 'user',
          content: `Pagination user message ${sequence}`,
          at,
        },
        {
          userId: paginationUser._id,
          conversationId: messageConversation._id,
          logicalTurnId,
          turnSequence: sequence,
          historyEpoch: 0,
          role: 'assistant',
          content: `Pagination assistant message ${sequence}`,
          at: new Date(at.getTime() + 1),
        }
      )
    }
    await ChatMessage.insertMany(messages)
  }

  await Setting.updateOne(
    { key: 'chatEnabled' },
    { $set: { value: true } },
    { upsert: true }
  )

  console.log(JSON.stringify({
    success: true,
    database: EXPECTED_DATABASE,
    tours: fixtures.length,
    firstDeparture: firstDeparture.toISOString().slice(0, 10),
    user: user.email,
    paginationUser: paginationUser.email,
    paginationConversations: 35,
    paginationMessages: 130,
  }))
} finally {
  await mongoose.disconnect()
}
