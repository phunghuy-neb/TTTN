import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useFavorites } from '../context/FavoritesContext.jsx'
import { useNotifications } from '../context/NotificationsContext.jsx'
import { updateProfile, changePassword } from '../services/authService.js'
import { getMyBookings } from '../services/bookingService.js'
import Button from '../components/ui/Button.jsx'
import Field from '../components/ui/Field.jsx'
import { useToast } from '../components/ui/Toast.jsx'

// SĐT Việt Nam: 10 chữ số, bắt đầu bằng 0 — khớp luật Checkout/BE
const PHONE_RE = /^0\d{9}$/

// Trang hồ sơ cá nhân (UC-03): xem/sửa họ tên + SĐT, đổi mật khẩu
export default function Profile() {
  const { user, updateUser } = useAuth()
  const { favoriteIds } = useFavorites()
  const { unreadCount } = useNotifications()
  const toast = useToast()

  const initials = useMemo(() => String(user?.name || 'VV').trim().split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase(), [user?.name])
  const memberSince = user?.createdAt
    ? new Intl.DateTimeFormat('vi-VN', { month: '2-digit', year: 'numeric' }).format(new Date(user.createdAt))
    : '—'
  const [bookingTotal, setBookingTotal] = useState(null)

  // Form hồ sơ
  const [hoSo, setHoSo] = useState({
    name: user?.name || '',
    phone: user?.phone || '',
    dateOfBirth: user?.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : '',
    gender: user?.gender || '',
    address: user?.address || '',
  })
  const [loiHoSo, setLoiHoSo] = useState({})
  const [dangLuuHoSo, setDangLuuHoSo] = useState(false)

  // Form đổi mật khẩu
  const [matKhau, setMatKhau] = useState({ oldPassword: '', newPassword: '', confirm: '' })
  const [loiMatKhau, setLoiMatKhau] = useState({})
  const [dangDoiMk, setDangDoiMk] = useState(false)

  useEffect(() => {
    let active = true
    getMyBookings({ page: 1, limit: 1 }).then((res) => {
      if (active && res.success) setBookingTotal(res.pagination.total)
    })
    return () => { active = false }
  }, [])

  const suaHoSo = (e) => {
    const { name, value } = e.target
    setHoSo((f) => ({ ...f, [name]: value }))
    setLoiHoSo((err) => ({ ...err, [name]: undefined, form: undefined }))
  }
  const suaMatKhau = (e) => {
    const { name, value } = e.target
    setMatKhau((f) => ({ ...f, [name]: value }))
    setLoiMatKhau((err) => ({ ...err, [name]: undefined, form: undefined }))
  }

  async function luuHoSo(e) {
    e.preventDefault()
    const next = {}
    if (!hoSo.name.trim()) next.name = 'Vui lòng nhập họ tên.'
    if (hoSo.phone.trim() && !PHONE_RE.test(hoSo.phone.trim()))
      next.phone = 'Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).'
    setLoiHoSo(next)
    if (Object.keys(next).length > 0) return

    setDangLuuHoSo(true)
    const res = await updateProfile({
      name: hoSo.name.trim(),
      phone: hoSo.phone.trim(),
      dateOfBirth: hoSo.dateOfBirth,
      gender: hoSo.gender,
      address: hoSo.address.trim(),
    })
    setDangLuuHoSo(false)
    if (!res.success) {
      setLoiHoSo({ form: res.message || 'Cập nhật không thành công.' })
      return
    }
    updateUser(res.user) // Header + Checkout prefill dùng ngay tên/SĐT mới
    toast(res.message || 'Đã cập nhật hồ sơ.')
  }

  async function doiMatKhau(e) {
    e.preventDefault()
    const next = {}
    if (!matKhau.oldPassword) next.oldPassword = 'Vui lòng nhập mật khẩu hiện tại.'
    if (!matKhau.newPassword) next.newPassword = 'Vui lòng nhập mật khẩu mới.'
    else if (matKhau.newPassword.length < 6) next.newPassword = 'Mật khẩu mới tối thiểu 6 ký tự.'
    if (!matKhau.confirm) next.confirm = 'Vui lòng nhập lại mật khẩu mới.'
    else if (matKhau.confirm !== matKhau.newPassword) next.confirm = 'Mật khẩu nhập lại không khớp.'
    setLoiMatKhau(next)
    if (Object.keys(next).length > 0) return

    setDangDoiMk(true)
    const res = await changePassword({
      oldPassword: matKhau.oldPassword,
      newPassword: matKhau.newPassword,
    })
    setDangDoiMk(false)
    if (!res.success) {
      // 400 WRONG_PASSWORD hiện ngay tại ô mật khẩu cũ
      if (res.code === 'WRONG_PASSWORD') setLoiMatKhau({ oldPassword: res.message })
      else setLoiMatKhau({ form: res.message || 'Đổi mật khẩu không thành công.' })
      return
    }
    setMatKhau({ oldPassword: '', newPassword: '', confirm: '' })
    toast(res.message || 'Đổi mật khẩu thành công!')
  }

  return (
    <div className="wrap py-[56px]">
      <p className="eyebrow">TÀI KHOẢN</p>
      <h1 className="mt-2 font-heading text-[30px] font-semibold text-ink">Hồ sơ cá nhân</h1>

      <section className="card-surface mt-6 overflow-hidden">
        <div className="bg-gradient-to-r from-teal to-jade px-6 py-7 text-white sm:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              {user?.avatar ? (
                <img src={user.avatar} alt={user.name} className="h-20 w-20 rounded-full border-4 border-white/40 object-cover" />
              ) : (
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-4 border-white/40 bg-white text-[25px] font-bold text-teal">{initials}</div>
              )}
              <div>
                <h2 className="font-heading text-[24px] font-semibold">{user?.name}</h2>
                <p className="mt-1 text-[14px] text-white/80">{user?.email}</p>
                <p className="mt-2 text-[12.5px] text-white/75">Thành viên từ {memberSince} · {user?.role === 'admin' ? 'Quản trị viên' : 'Khách hàng'}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[300px]">
              <Link to="/bookings" className="rounded-[12px] bg-white/10 px-3 py-3 transition hover:bg-white/20"><b className="block text-[20px]">{bookingTotal ?? '—'}</b><span className="text-[11.5px] text-white/75">Đơn tour</span></Link>
              <Link to="/favorites" className="rounded-[12px] bg-white/10 px-3 py-3 transition hover:bg-white/20"><b className="block text-[20px]">{favoriteIds.size}</b><span className="text-[11.5px] text-white/75">Yêu thích</span></Link>
              <Link to="/notifications" className="rounded-[12px] bg-white/10 px-3 py-3 transition hover:bg-white/20"><b className="block text-[20px]">{unreadCount}</b><span className="text-[11.5px] text-white/75">Chưa đọc</span></Link>
            </div>
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line px-6 py-4 text-[13.5px] font-semibold sm:px-8" aria-label="Lối tắt tài khoản">
          <Link to="/bookings" className="text-teal hover:text-teal2">Đơn đặt tour của tôi →</Link>
          <Link to="/favorites" className="text-teal hover:text-teal2">Tour yêu thích →</Link>
          <Link to="/notifications" className="text-teal hover:text-teal2">Trung tâm thông báo →</Link>
          {user?.role === 'admin' && <Link to="/admin" className="text-coralD hover:underline">Trang quản trị →</Link>}
        </nav>
      </section>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        {/* Thông tin cơ bản */}
        <form onSubmit={luuHoSo} noValidate className="card-surface p-6">
          <h2 className="font-heading text-[19px] font-semibold text-ink">Thông tin cơ bản</h2>
          {loiHoSo.form && (
            <div className="mt-3 rounded-[11px] border border-coral/40 bg-coral/5 px-3.5 py-2.5 text-[13.5px] text-coralD">
              {loiHoSo.form}
            </div>
          )}

          <label className="field-label">Email</label>
          <p className="field-input cursor-not-allowed bg-sand/50 text-muted">{user?.email}</p>

          <Field
            id="name"
            name="name"
            label="Họ và tên"
            type="text"
            autoComplete="name"
            value={hoSo.name}
            onChange={suaHoSo}
            error={loiHoSo.name}
          />
          <Field
            id="phone"
            name="phone"
            label="Số điện thoại"
            type="tel"
            autoComplete="tel"
            placeholder="0912345678"
            value={hoSo.phone}
            onChange={suaHoSo}
            error={loiHoSo.phone}
          />

          <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            <div>
              <Field
                id="dateOfBirth"
                name="dateOfBirth"
                label="Ngày sinh"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={hoSo.dateOfBirth}
                onChange={suaHoSo}
                error={loiHoSo.dateOfBirth}
              />
            </div>
            <div>
              <Field id="gender" name="gender" label="Giới tính" as="select" value={hoSo.gender} onChange={suaHoSo}>
                <option value="">Chưa chọn</option>
                <option value="female">Nữ</option>
                <option value="male">Nam</option>
                <option value="other">Khác</option>
              </Field>
            </div>
          </div>
          <Field
            id="address"
            name="address"
            label="Địa chỉ liên hệ"
            as="textarea"
            rows={3}
            maxLength={250}
            className="resize-none"
            placeholder="Số nhà, phường/xã, quận/huyện, tỉnh/thành phố"
            value={hoSo.address}
            onChange={suaHoSo}
            error={loiHoSo.address}
          />

          <Button type="submit" variant="teal" disabled={dangLuuHoSo} className="mt-[22px]">
            {dangLuuHoSo ? 'Đang lưu…' : 'Lưu thay đổi'}
          </Button>
        </form>

        {/* Đổi mật khẩu */}
        <form onSubmit={doiMatKhau} noValidate className="card-surface p-6">
          <h2 className="font-heading text-[19px] font-semibold text-ink">Đổi mật khẩu</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">Dùng mật khẩu riêng, tối thiểu 6 ký tự và không chia sẻ mã đăng nhập với người khác.</p>
          {loiMatKhau.form && (
            <div className="mt-3 rounded-[11px] border border-coral/40 bg-coral/5 px-3.5 py-2.5 text-[13.5px] text-coralD">
              {loiMatKhau.form}
            </div>
          )}

          <Field
            id="oldPassword"
            name="oldPassword"
            label="Mật khẩu hiện tại"
            type="password"
            autoComplete="current-password"
            placeholder="••••••"
            value={matKhau.oldPassword}
            onChange={suaMatKhau}
            error={loiMatKhau.oldPassword}
          />
          <Field
            id="newPassword"
            name="newPassword"
            label="Mật khẩu mới"
            type="password"
            autoComplete="new-password"
            placeholder="Tối thiểu 6 ký tự"
            value={matKhau.newPassword}
            onChange={suaMatKhau}
            error={loiMatKhau.newPassword}
          />
          <Field
            id="confirm"
            name="confirm"
            label="Xác nhận mật khẩu mới"
            type="password"
            autoComplete="new-password"
            placeholder="Nhập lại mật khẩu mới"
            value={matKhau.confirm}
            onChange={suaMatKhau}
            error={loiMatKhau.confirm}
          />

          <Button type="submit" variant="coral" disabled={dangDoiMk} className="mt-[22px]">
            {dangDoiMk ? 'Đang đổi…' : 'Đổi mật khẩu'}
          </Button>
        </form>
      </div>
    </div>
  )
}
