// Nút bấm dùng chung — gói các class .btn-* sẵn có (index.css) thành component,
// trích xuất từ markup lặp ở các trang. Không đổi design system.
const VARIANT_CLASS = {
  coral: 'btn-coral',
  teal: 'btn-teal',
  ghost: 'btn-ghost',
}

export default function Button({ variant = 'teal', type = 'button', className = '', children, ...props }) {
  const base = VARIANT_CLASS[variant] || VARIANT_CLASS.teal
  return (
    <button type={type} className={`${base} ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}
