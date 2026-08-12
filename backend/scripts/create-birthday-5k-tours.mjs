import 'dotenv/config'
import mongoose from 'mongoose'
import Tour from '../src/models/Tour.js'

const PROMOTION_PRICE = 5_000
const PROMOTION_LABEL = 'Sinh nhật VietVoyage · 5K/khách'
const DEPARTURES_PER_TOUR = 4
const SLOTS_PER_DEPARTURE = 20

const campaigns = [
  {
    sourceSlug: 'tour-binh-hung-2n2d-hcm-ninh-chu-vinh-hy-san-ho-bbq-hai-san-hbo3',
    promotionSlug: 'sinh-nhat-vietvoyage-5k-binh-hung-2n2d',
    promotionName: 'Sinh nhật VietVoyage 5K: Bình Hưng 2N2Đ',
  },
  {
    sourceSlug: 'tour-da-lat-3n3d-hcm-thi-tran-iyashi-vuon-chau-au-lac-hu-co-tran-fresh-garden-of56',
    promotionSlug: 'sinh-nhat-vietvoyage-5k-da-lat-3n3d',
    promotionName: 'Sinh nhật VietVoyage 5K: Đà Lạt 3N3Đ',
  },
]

function futureDepartures(source) {
  const now = new Date()
  return source.departures
    .filter((departure) => new Date(departure.date) > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, DEPARTURES_PER_TOUR)
    .map((departure) => ({
      date: departure.date,
      totalSlots: SLOTS_PER_DEPARTURE,
      availableSlots: SLOTS_PER_DEPARTURE,
      price: PROMOTION_PRICE,
    }))
}

function cloneForPromotion(source, config) {
  const data = source.toObject({ depopulate: true })
  delete data._id
  delete data.createdAt
  delete data.updatedAt
  delete data.slug

  return {
    ...data,
    name: config.promotionName,
    slug: config.promotionSlug,
    summary: `Ưu đãi mừng sinh nhật VietVoyage: chỉ 5.000đ/khách. ${source.summary || ''}`.trim(),
    basePrice: PROMOTION_PRICE,
    oldPrice: source.basePrice,
    promotionLabel: PROMOTION_LABEL,
    departures: futureDepartures(source),
    highlights: [
      '🎂 Giá sinh nhật chỉ 5.000đ/khách — đã áp dụng sẵn, không cần nhập mã',
      ...(source.highlights || []),
    ],
    status: 'published',
    isActive: true,
    reviews: [],
    avgRating: 0,
    vectorSync: { isSynced: false, lastSyncedAt: null, chromaId: '' },
  }
}

async function run() {
  if (!process.env.MONGO_URI) throw new Error('Thiếu MONGO_URI trong backend/.env')
  await mongoose.connect(process.env.MONGO_URI)

  const results = []
  for (const config of campaigns) {
    const source = await Tour.findOne({ slug: config.sourceSlug })
    if (!source) throw new Error(`Không tìm thấy tour nguồn: ${config.sourceSlug}`)

    const departures = futureDepartures(source)
    if (departures.length === 0) {
      throw new Error(`Tour nguồn không còn ngày khởi hành tương lai: ${source.name}`)
    }

    let promotion = await Tour.findOne({ slug: config.promotionSlug })
    if (!promotion) {
      promotion = await Tour.create(cloneForPromotion(source, config))
      results.push({ action: 'created', id: promotion.id, slug: promotion.slug })
      continue
    }

    // Chạy lại script không tạo bản trùng và không thay _id của các đợt đã có,
    // nhờ đó booking đã tham chiếu vẫn an toàn.
    promotion.name = config.promotionName
    promotion.basePrice = PROMOTION_PRICE
    promotion.oldPrice = source.basePrice
    promotion.promotionLabel = PROMOTION_LABEL
    promotion.status = 'published'
    promotion.isActive = true
    promotion.departures.forEach((departure) => {
      departure.price = PROMOTION_PRICE
    })
    await promotion.save()
    results.push({ action: 'updated', id: promotion.id, slug: promotion.slug })
  }

  console.table(results)
}

run()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })
