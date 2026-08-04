import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { updateProfile, changePassword } from '../services/authService.js'
import Button from '../components/ui/Button.jsx'
import Field from '../components/ui/Field.jsx'
import { useToast } from '../components/ui/Toast.jsx'

// SĐT Việt Nam: 10 chữ số, bắt đầu bằng 0 — khớp luật Checkout/BE
const PHONE_RE = /^0\d{9}$/

// Trang hồ sơ cá nhân (UC-03): xem/sửa họ tên + SĐT, đổi mật khẩu
export default function Profile() {
  const { user, updateUser } = useAuth()
  const toast = useToast()

  // Form hồ sơ
  const [hoSo, setHoSo] = useState({ name: user?.name || '', phone: user?.phone || '' })
  const [loiHoSo, setLoiHoSo] = useState({})
  const [dangLuuHoSo, setDangLuuHoSo] = useState(false)

  // Form đổi mật khẩu
  const [matKhau, setMatKhau] = useState({ oldPassword: '', newPassword: '', confirm: '' })
  const [loiMatKhau, setLoiMatKhau] = useState({})
  const [dangDoiMk, setDangDoiMk] = useState(false)

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
    const res = await updateProfile({ name: hoSo.name.trim(), phone: hoSo.phone.trim() })
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

          <Button type="submit" variant="teal" disabled={dangLuuHoSo} className="mt-[22px]">
            {dangLuuHoSo ? 'Đang lưu…' : 'Lưu thay đổi'}
          </Button>
        </form>

        {/* Đổi mật khẩu */}
        <form onSubmit={doiMatKhau} noValidate className="card-surface p-6">
          <h2 className="font-heading text-[19px] font-semibold text-ink">Đổi mật khẩu</h2>
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
