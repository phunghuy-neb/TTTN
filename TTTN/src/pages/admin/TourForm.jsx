import { useState, useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  getAdminTour,
  createAdminTour,
  updateAdminTour,
  uploadTourImage,
} from '../../services/adminTourService.js'
import Button from '../../components/ui/Button.jsx'
import Field from '../../components/ui/Field.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'
import { REGIONS } from '../../constants/regions.js'

// ISO → giá trị cho <input type="date">
const toDateInput = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '')

// Một dòng đợt khởi hành trống (đợt mới — không có _id)
const dotTrong = () => ({ _id: null, date: '', price: '', totalSlots: '', availableSlots: null, soDon: 0 })

// Form tạo/sửa tour (admin). Quy tắc sống còn: đợt ĐÃ TỒN TẠI luôn mang _id
// (ẩn trong state) khi gửi lên — vắng _id nghĩa là yêu cầu XÓA đợt đó.
export default function TourForm() {
  const { id } = useParams() // có id = chế độ sửa
  const navigate = useNavigate()
  const toast = useToast()
  const beginRequest = useRequestGuard()

  const [form, setForm] = useState({
    name: '',
    region: REGIONS[0],
    location: '',
    days: '',
    basePrice: '',
    oldPrice: '',
    description: '',
    status: 'draft',
  })
  const [departures, setDepartures] = useState([dotTrong()])
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(!!id)
  const [loadError, setLoadError] = useState('')
  const [errors, setErrors] = useState({}) // { name, ..., departures, form }
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Chế độ sửa: nạp tour + số đơn active theo từng đợt
  useEffect(() => {
    if (!id) return
    const isCurrent = beginRequest()
    ;(async () => {
      setLoading(true)
      setLoadError('')
      const res = await getAdminTour(id)
      if (!isCurrent()) return
      if (!res.success) {
        setLoadError(res.message || 'Không tải được tour.')
        setLoading(false)
        return
      }
      const t = res.data
      setForm({
        name: t.name || '',
        region: t.region || REGIONS[0],
        location: t.location || '',
        days: String(t.days ?? ''),
        basePrice: String(t.basePrice ?? ''),
        oldPrice: t.oldPrice != null ? String(t.oldPrice) : '',
        description: t.description || '',
        status: t.status || 'draft',
      })
      setImages(t.images || [])
      setDepartures(
        (t.departures || []).map((d) => ({
          _id: d._id, // GIỮ _id — gửi lại nguyên vẹn khi lưu
          date: toDateInput(d.date),
          price: String(d.price),
          totalSlots: String(d.totalSlots),
          availableSlots: d.availableSlots,
          soDon: res.bookingsByDeparture[String(d._id)] || 0,
        }))
      )
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const onChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    setErrors((err) => ({ ...err, [name]: undefined, form: undefined }))
  }

  function suaDot(index, key, value) {
    setDepartures((ds) => ds.map((d, i) => (i === index ? { ...d, [key]: value } : d)))
    setErrors((err) => ({ ...err, departures: undefined, form: undefined }))
  }

  function xoaDot(index) {
    setDepartures((ds) => ds.filter((_, i) => i !== index))
  }

  // Upload ảnh: đẩy lên server ngay để lấy URL thật → preview chính là ảnh đã upload
  async function onChonAnh(e) {
    const files = [...(e.target.files || [])]
    e.target.value = '' // cho phép chọn lại cùng file
    if (!files.length) return
    setUploading(true)
    for (const file of files) {
      const res = await uploadTourImage(file)
      if (!res.success) {
        toast(res.message || 'Upload ảnh thất bại.', 'error')
        continue
      }
      setImages((imgs) => [...imgs, res.url])
    }
    setUploading(false)
  }

  // Validate client — phản chiếu đúng luật BE (ít nhất 1 đợt, ngày không quá khứ
  // với đợt MỚI, totalSlots > 0, giá > 0)
  function validate() {
    const next = {}
    if (!form.name.trim()) next.name = 'Vui lòng nhập tên tour.'
    if (!form.location.trim()) next.location = 'Vui lòng nhập địa điểm.'
    const days = Number(form.days)
    if (!Number.isInteger(days) || days < 1) next.days = 'Số ngày phải là số nguyên ≥ 1.'
    const gia = Number(form.basePrice)
    if (!Number.isFinite(gia) || gia <= 0) next.basePrice = 'Giá cơ bản phải > 0.'

    if (departures.length === 0) {
      next.departures = 'Tour phải có ít nhất 1 đợt khởi hành.'
    } else {
      const dauHomNay = new Date()
      dauHomNay.setHours(0, 0, 0, 0)
      for (const [i, d] of departures.entries()) {
        if (!d.date) { next.departures = `Đợt ${i + 1}: chưa chọn ngày.`; break }
        if (!d._id && new Date(d.date) < dauHomNay) {
          next.departures = `Đợt ${i + 1}: ngày khởi hành không được ở quá khứ.`
          break
        }
        const tong = Number(d.totalSlots)
        if (!Number.isInteger(tong) || tong <= 0) {
          next.departures = `Đợt ${i + 1}: tổng số chỗ phải là số nguyên > 0.`
          break
        }
        const giaDot = Number(d.price)
        if (!Number.isFinite(giaDot) || giaDot <= 0) {
          next.departures = `Đợt ${i + 1}: giá phải > 0.`
          break
        }
      }
    }
    return next
  }

  async function onSubmit(e) {
    e.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) return

    const payload = {
      name: form.name.trim(),
      region: form.region,
      location: form.location.trim(),
      days: Number(form.days),
      basePrice: Number(form.basePrice),
      oldPrice: form.oldPrice === '' ? null : Number(form.oldPrice),
      description: form.description.trim(),
      status: form.status,
      images,
      // Đợt đã tồn tại mang _id; đợt mới không có — BE merge theo _id
      departures: departures.map((d) => ({
        ...(d._id ? { _id: d._id } : {}),
        date: d.date,
        price: Number(d.price),
        totalSlots: Number(d.totalSlots),
      })),
    }

    setSubmitting(true)
    const res = id ? await updateAdminTour(id, payload) : await createAdminTour(payload)
    setSubmitting(false)

    if (!res.success) {
      // 409 nghiệp vụ (DEPARTURE_HAS_BOOKINGS / SLOTS_BELOW_BOOKED) đã map tiếng Việt ở service
      setErrors({ form: res.message || 'Lưu tour không thành công.' })
      toast(res.message || 'Lưu tour không thành công.', 'error')
      return
    }
    toast(res.message || 'Đã lưu tour.')
    navigate('/admin/tours')
  }

  if (loading) {
    return (
      <div>
        <Skeleton className="h-8 w-[280px] rounded" />
        <Skeleton className="mt-5 h-[420px] rounded-card" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="card-surface p-6 text-center">
        <p className="text-coralD">{loadError}</p>
        <Link to="/admin/tours" className="btn-teal mt-4">
          Về danh sách tour
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-[880px]">
      <p className="eyebrow">QUẢN LÝ TOUR</p>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">
        {id ? 'Sửa tour' : 'Thêm tour mới'}
      </h1>

      <form onSubmit={onSubmit} noValidate className="card-surface mt-5 p-6">
        {errors.form && (
          <div className="mb-4 rounded-[11px] border border-coral/40 bg-coral/5 px-3.5 py-2.5 text-[13.5px] text-coralD">
            {errors.form}
          </div>
        )}

        <Field id="name" name="name" label="Tên tour" type="text" placeholder="Vịnh Hạ Long — Kỳ quan trên biển" value={form.name} onChange={onChange} error={errors.name} />

        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          <div>
            <label htmlFor="region" className="field-label">Khu vực</label>
            <select id="region" name="region" value={form.region} onChange={onChange} className="field-input">
              {REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <Field id="location" name="location" label="Địa điểm" type="text" placeholder="Quảng Ninh" value={form.location} onChange={onChange} error={errors.location} />
        </div>

        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
          <Field id="days" name="days" label="Số ngày" type="number" min="1" value={form.days} onChange={onChange} error={errors.days} />
          <Field id="basePrice" name="basePrice" label="Giá cơ bản (đ)" type="number" min="0" value={form.basePrice} onChange={onChange} error={errors.basePrice} />
          <Field id="oldPrice" name="oldPrice" label="Giá gốc (đ, bỏ trống nếu không giảm)" type="number" min="0" value={form.oldPrice} onChange={onChange} />
        </div>

        <Field id="description" name="description" label="Mô tả" as="textarea" rows="4" className="resize-none" placeholder="Giới thiệu hành trình…" value={form.description} onChange={onChange} />

        <div>
          <label htmlFor="status" className="field-label">Trạng thái</label>
          <select id="status" name="status" value={form.status} onChange={onChange} className="field-input !w-[220px]">
            <option value="draft">Nháp (chưa hiện với khách)</option>
            <option value="published">Đang bán</option>
          </select>
        </div>

        {/* ── Ảnh tour: upload + preview + gỡ ─────────────────── */}
        <p className="field-label">Ảnh tour</p>
        <div className="flex flex-wrap items-start gap-3">
          {images.map((url, i) => (
            <div key={url + i} className="group relative">
              <img src={url} alt="" className="h-[74px] w-[110px] rounded-[10px] border border-line object-cover" />
              <button
                type="button"
                aria-label="Gỡ ảnh"
                onClick={() => setImages((imgs) => imgs.filter((_, j) => j !== i))}
                className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-coralD text-[12px] text-white opacity-0 shadow-soft transition group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
          <label className="grid h-[74px] w-[110px] cursor-pointer place-items-center rounded-[10px] border-[1.5px] border-dashed border-line text-[13px] text-muted transition hover:border-jade hover:text-jade">
            {uploading ? 'Đang tải…' : '+ Thêm ảnh'}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={onChonAnh} disabled={uploading} />
          </label>
        </div>

        {/* ── Editor đợt khởi hành ────────────────────────────── */}
        <div className="mt-6 flex items-center justify-between">
          <p className="field-label !mt-0">Đợt khởi hành</p>
          <Button variant="ghost" className="!px-3 !py-1.5 text-[13px]" onClick={() => setDepartures((ds) => [...ds, dotTrong()])}>
            + Thêm đợt
          </Button>
        </div>
        {errors.departures && <div className="field-error mb-2">{errors.departures}</div>}
        <div className="flex flex-col gap-2.5">
          {departures.map((d, i) => (
            <div key={d._id || `moi-${i}`} className="flex flex-wrap items-center gap-2.5 rounded-[12px] border border-line bg-white p-3">
              <input
                type="date"
                value={d.date}
                onChange={(e) => suaDot(i, 'date', e.target.value)}
                className="field-input !w-[160px]"
                aria-label={`Ngày đợt ${i + 1}`}
              />
              <input
                type="number"
                min="1"
                placeholder="Giá/khách"
                value={d.price}
                onChange={(e) => suaDot(i, 'price', e.target.value)}
                className="field-input !w-[140px]"
                aria-label={`Giá đợt ${i + 1}`}
              />
              <input
                type="number"
                min="1"
                placeholder="Tổng chỗ"
                value={d.totalSlots}
                onChange={(e) => suaDot(i, 'totalSlots', e.target.value)}
                className="field-input !w-[110px]"
                aria-label={`Tổng chỗ đợt ${i + 1}`}
              />
              {/* availableSlots chỉ hiển thị — muốn đổi chỗ trống thì sửa totalSlots,
                  server tự cộng/trừ phần chênh để giữ chỗ đã đặt */}
              {d._id && (
                <span className="text-[13px] text-muted" title="Chỗ trống / tổng chỗ — chỗ trống do server tính, không sửa trực tiếp">
                  Trống <b className="text-ink">{d.availableSlots}</b>/{d.totalSlots || '?'}
                </span>
              )}
              {d.soDon > 0 && (
                <span className="rounded-pill bg-gold/15 px-2.5 py-0.5 text-[12.5px] font-semibold text-gold">
                  {d.soDon} đơn
                </span>
              )}
              <span className="ml-auto">
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 text-[13px] !text-coralD hover:!border-coral disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={d.soDon > 0}
                  title={
                    d.soDon > 0
                      ? `Đợt này đang có ${d.soDon} đơn active — không thể xóa. Hủy/hoàn tất các đơn trước.`
                      : 'Xóa đợt này'
                  }
                  onClick={() => xoaDot(i)}
                >
                  Xóa
                </Button>
              </span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button type="submit" variant="coral" disabled={submitting || uploading} className="!px-6">
            {submitting ? 'Đang lưu…' : id ? 'Lưu thay đổi' : 'Tạo tour'}
          </Button>
          <Link to="/admin/tours" className="btn-ghost">
            Hủy
          </Link>
        </div>
      </form>
    </div>
  )
}
