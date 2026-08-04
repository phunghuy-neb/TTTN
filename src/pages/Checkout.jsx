import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { createBooking } from '../services/bookingService.js'
import { formatPrice, formatDate } from '../utils/format.js'
import Button from '../components/ui/Button.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Field from '../components/ui/Field.jsx'

// Regex email — khớp Login/Register
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Số điện thoại Việt Nam: 10 chữ số, bắt đầu bằng 0
const PHONE_RE = /^0\d{9}$/

// Ba phương thức thanh toán theo enum của Backend — cổng online hoàn thiện ở Tuần 5
const PHUONG_THUC = [
  { value: 'vnpay', label: 'VNPay', desc: 'Cổng thanh toán trực tuyến — sẽ hoàn thiện ở giai đoạn sau' },
  { value: 'momo', label: 'MoMo', desc: 'Ví điện tử — sẽ hoàn thiện ở giai đoạn sau' },
  { value: 'later', label: 'Thanh toán sau', desc: 'Giữ chỗ trước, thanh toán khi công ty liên hệ xác nhận' },
]

// Trang xác nhận đặt tour (UC-08) — nhận dữ liệu đơn qua location.state từ TourDetail
export default function Checkout() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const { user } = useAuth()

  // Điền sẵn thông tin liên hệ từ tài khoản đang đăng nhập
  const [form, setForm] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    email: user?.email || '',
    note: '',
  })
  const [phuongThuc, setPhuongThuc] = useState('later')
  const [errors, setErrors] = useState({}) // { name, phone, email, form }
  const [submitting, setSubmitting] = useState(false)

  // Vào thẳng /checkout không qua trang chi tiết → không có dữ liệu đơn, không gọi API
  if (!state?.tourId || !state?.departureId || !state?.guests) {
    return (
      <div className="wrap py-[56px]">
        <EmptyState
          className="mx-auto max-w-[560px]"
          title="Chưa có thông tin đặt tour"
          description="Hãy chọn tour và đợt khởi hành trước khi vào bước xác nhận."
          action={
            <Link to="/tours" className="btn-teal">
              Về danh sách tour
            </Link>
          }
        />
      </div>
    )
  }

  const onChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    // Xóa lỗi của field đang gõ + lỗi tổng
    setErrors((err) => ({ ...err, [name]: undefined, form: undefined }))
  }

  // Validate phía client — lỗi tiếng Việt hiển thị tại từng field, khớp khuôn Login/Register
  const validate = () => {
    const next = {}
    if (!form.name.trim()) next.name = 'Vui lòng nhập họ tên.'
    if (!form.phone.trim()) next.phone = 'Vui lòng nhập số điện thoại.'
    else if (!PHONE_RE.test(form.phone.trim())) next.phone = 'Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).'
    if (!form.email.trim()) next.email = 'Vui lòng nhập email.'
    else if (!EMAIL_RE.test(form.email.trim())) next.email = 'Email không hợp lệ.'
    return next
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    const res = await createBooking({
      tourId: state.tourId,
      departureId: state.departureId,
      guests: state.guests,
      contact: {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
      },
      paymentMethod: phuongThuc,
      note: form.note.trim(),
    })
    setSubmitting(false)

    if (!res.success) {
      // Hiển thị đúng message Backend trả về (hết chỗ, tour ngưng bán, ...)
      setErrors({ form: res.message || 'Đặt tour không thành công. Vui lòng thử lại.' })
      return
    }
    // replace để bấm Back không quay lại form checkout còn nguyên state — tránh gửi lại tạo đơn trùng
    navigate('/payment', { state: { booking: res.data }, replace: true })
  }

  return (
    <div className="wrap py-[42px]">
      <p className="eyebrow">Đặt tour</p>
      <h1 className="mt-2 font-heading text-[30px] font-semibold text-ink">Xác nhận thông tin đơn</h1>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_380px]">
        {/* Tóm tắt đơn — đứng trước ở mobile để người dùng thấy mình đang đặt gì */}
        <aside className="card-surface overflow-hidden lg:order-2">
          {state.image && (
            <img src={state.image} alt={state.tourName} className="aspect-[16/9] w-full object-cover" />
          )}
          <div className="p-5">
            <p className="font-heading text-[18px] font-semibold text-ink">{state.tourName}</p>
            <dl className="mt-4 flex flex-col gap-2.5 text-[14.5px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Ngày khởi hành</dt>
                <dd className="font-semibold text-ink">{formatDate(state.departureDate)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Số khách</dt>
                <dd className="font-semibold text-ink">{state.guests} khách</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Đơn giá / khách</dt>
                <dd className="font-semibold text-ink">{formatPrice(state.unitPrice)}</dd>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-line pt-3">
                <dt className="font-semibold text-ink">Tổng tiền</dt>
                <dd className="font-heading text-[22px] font-semibold text-coralD">
                  {formatPrice(state.totalPrice)}
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        {/* Form liên hệ + phương thức thanh toán */}
        <form onSubmit={onSubmit} noValidate className="card-surface p-6 lg:order-1">
          {/* Lỗi tổng — message thật từ Backend */}
          {errors.form && (
            <div className="mb-4 rounded-[11px] border border-coral/40 bg-coral/5 px-3.5 py-2.5 text-[13.5px] text-coralD">
              {errors.form}
            </div>
          )}

          <h2 className="font-heading text-[19px] font-semibold text-ink">Thông tin liên hệ</h2>

          <Field
            id="name"
            name="name"
            label="Họ và tên"
            type="text"
            autoComplete="name"
            placeholder="Nguyễn Văn A"
            value={form.name}
            onChange={onChange}
            error={errors.name}
          />

          <Field
            id="phone"
            name="phone"
            label="Số điện thoại"
            type="tel"
            autoComplete="tel"
            placeholder="0912345678"
            value={form.phone}
            onChange={onChange}
            error={errors.phone}
          />

          <Field
            id="email"
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
            value={form.email}
            onChange={onChange}
            error={errors.email}
          />

          <Field
            id="note"
            name="note"
            label="Ghi chú (không bắt buộc)"
            as="textarea"
            rows="3"
            placeholder="Yêu cầu đặc biệt: ăn chay, phòng tầng cao, ..."
            value={form.note}
            onChange={onChange}
            className="resize-none"
          />

          <h2 className="mt-6 font-heading text-[19px] font-semibold text-ink">Phương thức thanh toán</h2>
          <div className="mt-3 flex flex-col gap-3">
            {PHUONG_THUC.map((pt) => (
              <label
                key={pt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-card border-[1.5px] p-4 transition ${
                  phuongThuc === pt.value ? 'border-teal bg-teal/5' : 'border-line hover:border-jade'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={pt.value}
                  checked={phuongThuc === pt.value}
                  onChange={() => setPhuongThuc(pt.value)}
                  className="mt-1 accent-teal"
                />
                <span>
                  <span className="block font-semibold text-ink">{pt.label}</span>
                  <span className="mt-0.5 block text-[13px] text-muted">{pt.desc}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 rounded-[11px] bg-sand px-3.5 py-2.5 text-[13px] leading-[1.6] text-muted">
            Cổng thanh toán trực tuyến (VNPay/MoMo) sẽ được hoàn thiện ở giai đoạn sau. Hiện tại đơn
            của bạn được tạo ở trạng thái <b className="text-ink">chờ thanh toán</b>.
          </p>

          <Button type="submit" variant="coral" disabled={submitting} className="mt-[22px] w-full !py-[13px]">
            {submitting ? 'Đang xử lý…' : 'Xác nhận đặt tour'}
          </Button>
        </form>
      </div>
    </div>
  )
}
