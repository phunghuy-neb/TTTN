// Cụm label + ô nhập + lỗi — trích xuất từ markup copy tay ở Login/Register/Checkout.
// Dựa trên các class field-label / field-input / field-error sẵn có trong index.css.
//
//   <Field id="email" label="Email" type="email" value={...} onChange={...} error={errors.email} />
//   <Field id="note" label="Ghi chú" as="textarea" rows={3} className="resize-none" />
export default function Field({ id, label, error, as = 'input', className = '', ...props }) {
  const Control = as
  return (
    <>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <Control
        id={id}
        className={`field-input ${error ? 'field-input--error' : ''} ${className}`.trim()}
        {...props}
      />
      {error && <div className="field-error">{error}</div>}
    </>
  )
}
