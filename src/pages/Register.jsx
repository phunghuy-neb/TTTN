import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { register } from '../services/authService.js'

// Regex email — khớp app.html
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  const onChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    setErrors((err) => ({ ...err, [name]: undefined, form: undefined }))
  }

  // Validate phía client — lỗi hiển thị tại từng field
  const validate = () => {
    const next = {}
    if (!form.name.trim()) next.name = 'Vui lòng nhập họ tên.'
    if (!form.email.trim()) next.email = 'Vui lòng nhập email.'
    else if (!EMAIL_RE.test(form.email.trim())) next.email = 'Email không hợp lệ.'
    if (!form.password) next.password = 'Vui lòng nhập mật khẩu.'
    else if (form.password.length < 6) next.password = 'Mật khẩu tối thiểu 6 ký tự.'
    if (!form.confirm) next.confirm = 'Vui lòng nhập lại mật khẩu.'
    else if (form.confirm !== form.password) next.confirm = 'Mật khẩu nhập lại không khớp.'
    return next
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    const res = await register({ name: form.name, email: form.email, password: form.password })
    setSubmitting(false)

    if (!res.success) {
      // Lỗi từ service (VD email đã tồn tại) hiển thị ngay tại field email
      setErrors({ email: res.message || 'Đăng ký không thành công.' })
      return
    }
    navigate('/')
  }

  return (
    <div className="wrap">
      <form
        onSubmit={onSubmit}
        noValidate
        className="mx-auto my-[50px] max-w-[460px] rounded-[20px] border border-line bg-white p-[34px] shadow-soft"
      >
        <h1 className="text-[28px]">Đăng ký tài khoản</h1>
        <p className="mb-5 mt-1.5 text-[14.5px] text-muted">
          Tạo tài khoản để đặt tour và nhận gợi ý cá nhân hóa
        </p>

        <label htmlFor="name" className="field-label">Họ và tên</label>
        <input
          id="name"
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Nguyễn Văn A"
          value={form.name}
          onChange={onChange}
          className={`field-input ${errors.name ? 'field-input--error' : ''}`}
        />
        {errors.name && <div className="field-error">{errors.name}</div>}

        <label htmlFor="email" className="field-label">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={form.email}
          onChange={onChange}
          className={`field-input ${errors.email ? 'field-input--error' : ''}`}
        />
        {errors.email && <div className="field-error">{errors.email}</div>}

        <label htmlFor="password" className="field-label">Mật khẩu</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="Tối thiểu 6 ký tự"
          value={form.password}
          onChange={onChange}
          className={`field-input ${errors.password ? 'field-input--error' : ''}`}
        />
        {errors.password && <div className="field-error">{errors.password}</div>}

        <label htmlFor="confirm" className="field-label">Xác nhận mật khẩu</label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          placeholder="Nhập lại mật khẩu"
          value={form.confirm}
          onChange={onChange}
          className={`field-input ${errors.confirm ? 'field-input--error' : ''}`}
        />
        {errors.confirm && <div className="field-error">{errors.confirm}</div>}

        <button type="submit" disabled={submitting} className="btn-coral mt-[22px] w-full !py-[13px]">
          {submitting ? 'Đang xử lý…' : 'Đăng ký'}
        </button>

        <div className="mt-[18px] text-center text-sm text-muted">
          Đã có tài khoản?{' '}
          <Link to="/login" className="font-semibold text-teal">Đăng nhập</Link>
        </div>
      </form>
    </div>
  )
}
