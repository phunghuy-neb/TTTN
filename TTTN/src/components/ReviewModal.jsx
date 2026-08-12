import { useEffect, useMemo, useState } from 'react'
import { createReview } from '../services/reviewService.js'
import Button from './ui/Button.jsx'
import Modal from './ui/Modal.jsx'

export default function ReviewModal({ open, booking, onClose, onSuccess }) {
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [images, setImages] = useState([])
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setRating(5)
    setComment('')
    setImages([])
    setError('')
  }, [open])

  const previews = useMemo(() => images.map((file) => ({ file, url: URL.createObjectURL(file) })), [images])
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews])

  function selectImages(event) {
    const files = Array.from(event.target.files || [])
    if (files.length > 5) {
      setError('Chỉ được chọn tối đa 5 ảnh.')
      return
    }
    if (files.some((file) => file.size > 5 * 1024 * 1024)) {
      setError('Mỗi ảnh không được vượt quá 5MB.')
      return
    }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) {
      setError('Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.')
      return
    }
    setImages(files)
    setError('')
  }

  async function submit(event) {
    event.preventDefault()
    const cleanComment = comment.trim()
    if (cleanComment.length < 10) {
      setError('Nội dung đánh giá cần ít nhất 10 ký tự.')
      return
    }
    setSubmitting(true)
    setError('')
    const res = await createReview({
      tourId: booking.tour?._id || booking.tour,
      bookingId: booking._id,
      rating,
      comment: cleanComment,
      images,
    })
    setSubmitting(false)
    if (!res.success) {
      setError(res.message || 'Không đăng được đánh giá.')
      return
    }
    onSuccess?.(res.data)
  }

  return (
    <Modal
      open={open}
      title="Đánh giá chuyến đi"
      onClose={() => !submitting && onClose?.()}
      actions={(
        <>
          <Button variant="ghost" disabled={submitting} onClick={onClose}>Để sau</Button>
          <Button variant="coral" type="submit" form="review-form" disabled={submitting}>
            {submitting ? 'Đang đăng…' : 'Đăng đánh giá'}
          </Button>
        </>
      )}
    >
      <form id="review-form" onSubmit={submit}>
        <p className="text-[14px] text-muted">Chia sẻ trải nghiệm của bạn về <b className="text-ink">{booking?.tourName}</b>.</p>

        <fieldset className="mt-5">
          <legend className="text-[13px] font-semibold text-muted">Mức độ hài lòng</legend>
          <div className="mt-2 flex gap-1" aria-label={`${rating} trên 5 sao`}>
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-label={`${value} sao`}
                onClick={() => setRating(value)}
                className={`text-[32px] leading-none transition hover:scale-110 ${value <= rating ? 'text-gold' : 'text-line'}`}
              >
                ★
              </button>
            ))}
          </div>
        </fieldset>

        <label htmlFor="review-comment" className="field-label">Nhận xét</label>
        <textarea
          id="review-comment"
          rows="4"
          maxLength="1000"
          className="field-input resize-none"
          placeholder="Điều gì khiến chuyến đi đáng nhớ?"
          value={comment}
          onChange={(event) => { setComment(event.target.value); setError('') }}
        />
        <p className="mt-1 text-right text-[12px] text-muted">{comment.length}/1000</p>

        <label htmlFor="review-images" className="field-label">Ảnh chuyến đi (không bắt buộc, tối đa 5 ảnh)</label>
        <input id="review-images" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectImages} className="field-input text-[13px]" />
        {previews.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {previews.map((preview, index) => (
              <div key={`${preview.file.name}-${preview.file.lastModified}`} className="relative shrink-0">
                <img src={preview.url} alt="Ảnh xem trước" className="h-[76px] w-[76px] rounded-[9px] object-cover" />
                <button
                  type="button"
                  aria-label={`Bỏ ảnh ${index + 1}`}
                  onClick={() => setImages((current) => current.filter((_, imageIndex) => imageIndex !== index))}
                  className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-coral text-[12px] font-bold text-white shadow-soft"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="mt-3 rounded-[9px] bg-coral/5 px-3 py-2 text-[13px] text-coralD">{error}</p>}
      </form>
    </Modal>
  )
}
