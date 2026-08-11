import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import Button from '../components/ui/Button.jsx'
import Field from '../components/ui/Field.jsx'

// Regex email — khớp app.html
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({}) // { email, password, form }
  const [submitting, setSubmitting] = useState(false)

  const onChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    // Xóa lỗi của field đang gõ + lỗi tổng
    setErrors((err) => ({ ...err, [name]: undefined, form: undefined }))
  }

  // Validate phía client: email đúng định dạng + không để trống
  const validate = () => {
    const next = {}
    if (!form.email.trim()) next.email = 'Vui lòng nhập email.'
    else if (!EMAIL_RE.test(form.email.trim())) next.email = 'Email không hợp lệ.'
    if (!form.password) next.password = 'Vui lòng nhập mật khẩu.'
    return next
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    const res = await login({ email: form.email, password: form.password })
    setSubmitting(false)

    if (!res.success) {
      setErrors({ form: res.message || 'Email hoặc mật khẩu không đúng.' })
      return
    }
    // Quay lại nơi định đến trước khi bị chặn, mặc định về trang chủ
    navigate(location.state?.from?.pathname || '/', { replace: true })
  }

  return (
    <div className="wrap">
      <form
        onSubmit={onSubmit}
        noValidate
        className="mx-auto my-[50px] max-w-[460px] rounded-[20px] border border-line bg-white p-[34px] shadow-soft"
      >
        <h1 className="text-[28px]">Đăng nhập</h1>
        <p className="mb-5 mt-1.5 text-[14.5px] text-muted">Chào mừng trở lại VietVoyage</p>

        {/* Lỗi tổng — sai email/mật khẩu */}
        {errors.form && (
          <div className="mb-4 rounded-[11px] border border-coral/40 bg-coral/5 px-3.5 py-2.5 text-[13.5px] text-coralD">
            {errors.form}
          </div>
        )}

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
          id="password"
          name="password"
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          placeholder="••••••"
          value={form.password}
          onChange={onChange}
          error={errors.password}
        />

        <Button type="submit" variant="coral" disabled={submitting} className="mt-[22px] w-full !py-[13px]">
          {submitting ? 'Đang xử lý…' : 'Đăng nhập'}
        </Button>

        <div className="mt-[18px] text-center text-sm text-muted">
          Chưa có tài khoản?{' '}
          <Link to="/register" className="font-semibold text-teal">Đăng ký ngay</Link>
        </div>
      </form>
    </div>
  )
}
