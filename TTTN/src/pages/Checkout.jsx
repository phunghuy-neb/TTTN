import { useEffect, useState, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { createBooking } from '../services/bookingService.js'
import { getPaymentConfig, initiatePayment } from '../services/paymentService.js'
import { formatPrice, formatDate } from '../utils/format.js'
import Button from '../components/ui/Button.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import Field from '../components/ui/Field.jsx'
import { validateVoucher } from '../services/voucherService.js'
import { closePaymentWindow, openPaymentWindow, preparePaymentWindow } from '../utils/paymentWindow.js'

// Regex email — khớp Login/Register
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Số điện thoại Việt Nam: 10 chữ số, bắt đầu bằng 0
const PHONE_RE = /^0\d{9}$/

// Ba phương thức thanh toán theo enum của Backend.
const PHUONG_THUC = [
  { value: 'vnpay', label: 'VNPay', desc: 'Thanh toán qua thẻ, tài khoản ngân hàng hoặc VNPAY-QR' },
  { value: 'momo', label: 'MoMo', desc: 'Thanh toán an toàn trên cổng hoặc ứng dụng MoMo' },
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
  const [paymentConfig, setPaymentConfig] = useState({ vnpay: { enabled: false }, momo: { enabled: false } })
  const [errors, setErrors] = useState({}) // { name, phone, email, form }
  const [submitting, setSubmitting] = useState(false)
  const [voucherCode, setVoucherCode] = useState('')
  const [voucher, setVoucher] = useState(null)
  const [voucherError, setVoucherError] = useState('')
  const [checkingVoucher, setCheckingVoucher] = useState(false)
  // Chốt ĐỒNG BỘ chống double-submit: `submitting` chỉ vô hiệu hoá nút sau khi React
  // re-render, nên nhiều click rơi vào CÙNG một tick vẫn lọt qua và tạo đơn trùng.
  // useRef đổi giá trị tức thì nên chặn được ngay từ click thứ hai.
  const dangGui = useRef(false)
  // Một khóa cho đúng một ý định đặt tour. Retry mạng dùng lại khóa này nên BE
  // trả đúng đơn cũ thay vì tạo thêm đơn/trừ thêm chỗ.
  const idempotencyKey = useRef(
    globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `booking_${Date.now()}_${Math.random().toString(36).slice(2)}`
  )

  useEffect(() => {
    getPaymentConfig().then((res) => {
      if (res.success) setPaymentConfig(res.data)
    })
  }, [])

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
    if (dangGui.current) return // click thứ 2 trở đi trong cùng tick — bỏ qua
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) return

    // Tạo popup ngay trong thao tác submit, trước mọi `await`, để trình duyệt
    // cho VietVoyage quyền mở/đóng cửa sổ cổng sau khi booking được xác nhận.
    if (phuongThuc === 'vnpay') preparePaymentWindow(phuongThuc)

    dangGui.current = true
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
      idempotencyKey: idempotencyKey.current,
      voucherCode: voucher?.voucher?.code || undefined,
    })
    setSubmitting(false)

    if (!res.success) {
      if (phuongThuc === 'vnpay') closePaymentWindow({ focusWebsite: false })
      // Thất bại thì mở chốt để người dùng sửa thông tin và gửi lại
      dangGui.current = false
      // Hiển thị đúng message Backend trả về (hết chỗ, tour ngưng bán, ...)
      setErrors({ form: res.message || 'Đặt tour không thành công. Vui lòng thử lại.' })
      return
    }
    if (['vnpay', 'momo'].includes(phuongThuc)) {
      const payment = await initiatePayment(res.data._id, phuongThuc)
      if (payment.success && payment.paymentUrl) {
        // Luôn giữ trung tâm thanh toán VietVoyage ở tab hiện tại để nhận trạng thái
        // booking mới từ webhook/admin mà không cần F5. VNPay được mở ở tab riêng;
        // nếu trình duyệt chặn tab bật lên, trang trung tâm vẫn có nút mở lại cổng.
        if (phuongThuc === 'momo') {
          // MoMo được mở ngay trên tab hiện tại, giống điều hướng cổng thanh toán
          // thông thường; callback của MoMo sẽ đưa khách quay lại /payment.
          window.location.assign(payment.paymentUrl)
          return
        }
        openPaymentWindow(payment.paymentUrl, phuongThuc)
        navigate(`/payment?bookingId=${res.data._id}`, {
          state: { booking: res.data, gatewayPayment: payment },
          replace: true,
        })
        return
      }
      // Booking đã được tạo và giữ chỗ. Đưa khách tới trang đơn để có thể thử
      // thanh toán lại, không mở khóa idempotency và tạo booking thứ hai.
      if (phuongThuc === 'vnpay') closePaymentWindow({ focusWebsite: false })
      navigate(`/payment?bookingId=${res.data._id}`, {
        state: { booking: res.data, paymentError: payment.message || 'Không khởi tạo được cổng thanh toán.' },
        replace: true,
      })
      return
    }

    navigate(`/payment?bookingId=${res.data._id}`, { state: { booking: res.data }, replace: true })
  }

  const applyVoucher = async () => {
    const code = voucherCode.trim().toUpperCase()
    if (!code) return setVoucherError('Vui lòng nhập mã voucher.')
    setCheckingVoucher(true)
    setVoucherError('')
    const res = await validateVoucher({ code, tourId: state.tourId, departureId: state.departureId, guests: state.guests })
    setCheckingVoucher(false)
    if (!res.success) {
      setVoucher(null)
      setVoucherError(res.message || 'Mã voucher không hợp lệ.')
      return
    }
    setVoucher(res)
    setVoucherCode(res.voucher.code)
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
                <dt className="font-semibold text-ink">Tạm tính</dt>
                <dd className="font-heading text-[22px] font-semibold text-coralD">
                  {formatPrice(state.totalPrice)}
                </dd>
              </div>
              {voucher && <>
                <div className="flex items-center justify-between gap-3 text-jade"><dt>Voucher {voucher.voucher.code}</dt><dd className="font-semibold">−{formatPrice(voucher.discountAmount)}</dd></div>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-3"><dt className="font-semibold text-ink">Cần thanh toán</dt><dd className="font-heading text-[22px] font-semibold text-coralD">{formatPrice(voucher.totalPrice)}</dd></div>
              </>}
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

          <div className="mt-5">
            <label htmlFor="voucherCode" className="mb-1.5 block text-[13.5px] font-semibold text-ink">Mã ưu đãi</label>
            <div className="flex gap-2">
              <input id="voucherCode" className="field-input uppercase" value={voucherCode} maxLength={30} placeholder="VD: DEMO10" onChange={(e) => { setVoucherCode(e.target.value); setVoucher(null); setVoucherError('') }} />
              <Button type="button" variant="ghost" disabled={checkingVoucher} onClick={applyVoucher}>{checkingVoucher ? 'Đang kiểm tra…' : 'Áp dụng'}</Button>
            </div>
            {voucherError && <p className="mt-1.5 text-[12.5px] text-coralD">{voucherError}</p>}
            {voucher && <p className="mt-1.5 text-[12.5px] font-semibold text-jade">✓ {voucher.voucher.name}: giảm {formatPrice(voucher.discountAmount)}</p>}
          </div>

          <h2 className="mt-6 font-heading text-[19px] font-semibold text-ink">Phương thức thanh toán</h2>
          <div className="mt-3 flex flex-col gap-3">
            {PHUONG_THUC.map((pt) => (
              <label
                key={pt.value}
                className={`flex items-start gap-3 rounded-card border-[1.5px] p-4 transition ${
                  paymentConfig[pt.value]?.enabled === false ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'
                } ${
                  phuongThuc === pt.value ? 'border-teal bg-teal/5' : 'border-line hover:border-jade'
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={pt.value}
                  checked={phuongThuc === pt.value}
                  disabled={paymentConfig[pt.value]?.enabled === false}
                  onChange={() => setPhuongThuc(pt.value)}
                  className="mt-1 accent-teal"
                />
                <span>
                  <span className="block font-semibold text-ink">{pt.label}</span>
                  <span className="mt-0.5 block text-[13px] text-muted">{pt.desc}</span>
                  {paymentConfig[pt.value]?.enabled === false && (
                    <span className="mt-1 block text-[12px] font-semibold text-coralD">Cổng Sandbox chưa được cấu hình</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 rounded-[11px] bg-sand px-3.5 py-2.5 text-[13px] leading-[1.6] text-muted">
            Đây là môi trường Sandbox, không trừ tiền thật. Nếu không có ứng dụng UAT để quét QR, admin có thể xác nhận
            mô phỏng giao dịch đang chờ để hoàn tất kịch bản trình diễn.
          </p>

          <Button type="submit" variant="coral" disabled={submitting} className="mt-[22px] w-full !py-[13px]">
            {submitting ? 'Đang xử lý…' : 'Xác nhận đặt tour'}
          </Button>
        </form>
      </div>
    </div>
  )
}
