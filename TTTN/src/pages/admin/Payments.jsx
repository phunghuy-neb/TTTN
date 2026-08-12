import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getAdminPayment, getAdminPayments, resolveAdminPayment } from '../../services/adminPaymentService.js'
import Button from '../../components/ui/Button.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { formatPrice } from '../../utils/format.js'

const STATUS = {
  creating: 'Đang tạo',
  initiated: 'Chờ thanh toán',
  paid: 'Thành công',
  failed: 'Thất bại',
  expired: 'Hết hạn',
  review_required: 'Cần đối soát',
}
const RECON = {
  pending: 'Chờ xử lý',
  confirmed: 'Đã xác nhận',
  refunded: 'Đã hoàn tiền',
  ignored: 'Đã đóng',
}
const PROVIDER = { vnpay: 'VNPay', momo: 'MoMo' }
const dateTime = (value) => value
  ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—'

export default function Payments() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const provider = params.get('provider') || ''
  const status = params.get('status') || ''
  const needsReview = params.get('needsReview') === 'true'
  const q = params.get('q') || ''

  const [keyword, setKeyword] = useState(q)
  const [data, setData] = useState({ payments: [], total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [resolution, setResolution] = useState({ status: 'refunded', note: '' })
  const [saving, setSaving] = useState(false)
  const latestLoad = useRef(0)
  const latestDetailsLoad = useRef(0)
  const toast = useToast()

  const load = useCallback(async ({ silent = false } = {}) => {
    const loadId = ++latestLoad.current
    if (!silent) setLoading(true)
    const response = await getAdminPayments({ page, provider, status, q, needsReview: needsReview || '' })
    if (loadId !== latestLoad.current) return
    if (response.success) setData(response)
    else if (!silent) toast(response.message, 'error')
    if (!silent) setLoading(false)
  }, [needsReview, page, provider, q, status, toast])

  useEffect(() => {
    load()
    const refresh = () => load({ silent: true })
    const timer = window.setInterval(refresh, 3_000)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [load])

  useEffect(() => {
    const paymentId = selected?._id
    if (!paymentId) return undefined
    let active = true
    const refreshDetails = async () => {
      const loadId = ++latestDetailsLoad.current
      const response = await getAdminPayment(paymentId)
      if (active && loadId === latestDetailsLoad.current && response.success) setSelected(response.payment)
    }
    const timer = window.setInterval(refreshDetails, 2_000)
    window.addEventListener('focus', refreshDetails)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshDetails)
    }
  }, [selected?._id])

  function filter(change) {
    const all = { provider, status, q, needsReview: needsReview ? 'true' : '', ...change }
    const next = {}
    for (const [key, value] of Object.entries(all)) if (value) next[key] = value
    setParams(next)
  }

  async function openDetails(payment) {
    setSelected(payment)
    setResolution({ status: 'refunded', note: '' })
    const response = await getAdminPayment(payment._id)
    if (response.success) setSelected(response.payment)
    else toast(response.message, 'error')
  }

  function closeModal() {
    if (!saving) setSelected(null)
  }

  async function resolve() {
    setSaving(true)
    const response = await resolveAdminPayment(selected._id, resolution)
    setSaving(false)
    if (!response.success) return toast(response.message, 'error')
    toast(response.message)
    setSelected(null)
    load({ silent: true })
  }

  const canResolve = selected?.status === 'review_required'
    && (selected.reconciliation?.status || 'pending') === 'pending'

  const columns = [
    {
      key: 'id',
      label: 'Giao dịch',
      render: (payment) => (
        <button className="max-w-[210px] text-left" onClick={() => openDetails(payment)}>
          <span className="block truncate font-semibold text-teal">{payment.orderId}</span>
          <small className="text-muted">{PROVIDER[payment.provider]} · {dateTime(payment.createdAt)}</small>
        </button>
      ),
    },
    {
      key: 'booking',
      label: 'Booking',
      render: (payment) => payment.booking ? (
        <div>
          <Link className="font-semibold text-teal" to={`/admin/bookings?q=${payment.booking.bookingCode}&open=${payment.booking._id}`}>
            {payment.booking.bookingCode}
          </Link>
          <p className="max-w-[220px] truncate text-[12px] text-muted">{payment.booking.tourName}</p>
        </div>
      ) : '—',
    },
    { key: 'amount', label: 'Số tiền', render: (payment) => <b>{formatPrice(payment.amount)}</b> },
    {
      key: 'status',
      label: 'Trạng thái',
      render: (payment) => (
        <span className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold ${payment.status === 'paid' ? 'bg-jade/10 text-jade' : payment.status === 'review_required' ? 'bg-coral/10 text-coralD' : 'bg-sand text-muted'}`}>
          {STATUS[payment.status]}
        </span>
      ),
    },
    {
      key: 'recon',
      label: 'Xử lý',
      render: (payment) => payment.status === 'initiated'
        ? <span className="text-[12.5px] font-semibold text-teal">Chờ cổng phản hồi</span>
        : payment.status === 'review_required'
          ? <span className="text-[12.5px] font-semibold">{RECON[payment.reconciliation?.status || 'pending']}</span>
          : '—',
    },
    {
      key: 'action',
      label: '',
      render: (payment) => (
        <Button variant="ghost" className="!px-3 !py-1.5 text-[12px]" onClick={() => openDetails(payment)}>
          Chi tiết
        </Button>
      ),
    },
  ]

  const modalActions = canResolve ? (
    <>
      <Button variant="ghost" disabled={saving} onClick={closeModal}>Đóng</Button>
      <Button disabled={saving} onClick={resolve}>{saving ? 'Đang lưu…' : 'Xác nhận xử lý'}</Button>
    </>
  ) : <Button variant="ghost" onClick={closeModal}>Đóng</Button>

  return (
    <div>
      <p className="eyebrow">THANH TOÁN</p>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Giao dịch & đối soát</h1>
      <p className="mt-1 text-[14px] text-muted">
        {data.total} giao dịch <span className="ml-1 text-[12px] text-jade">· Tự cập nhật mỗi 3 giây</span>
      </p>

      <form className="mt-5 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); filter({ q: keyword.trim() }) }}>
        <input className="field-input !w-[250px]" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Mã đơn cổng / mã giao dịch…" />
        <Button type="submit" variant="ghost">Tìm</Button>
        <select className="field-input !w-[145px]" value={provider} onChange={(event) => filter({ provider: event.target.value })}>
          <option value="">Mọi cổng</option>
          <option value="vnpay">VNPay</option>
          <option value="momo">MoMo</option>
        </select>
        <select className="field-input !w-[180px]" value={status} onChange={(event) => filter({ status: event.target.value, needsReview: '' })}>
          <option value="">Mọi trạng thái</option>
          {Object.entries(STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-card border border-line px-3 text-[13px] font-semibold">
          <input type="checkbox" checked={needsReview} onChange={(event) => filter({ needsReview: event.target.checked ? 'true' : '', status: '' })} />
          Cần đối soát
        </label>
      </form>

      {loading ? (
        <div className="mt-5 space-y-2">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-[70px] rounded-card" />)}</div>
      ) : data.payments.length ? (
        <>
          <div className="mt-5"><Table columns={columns} rows={data.payments} rowKey={(payment) => payment._id} /></div>
          <Pagination page={page} totalPages={data.totalPages} onPageChange={(nextPage) => filter({ page: nextPage > 1 ? nextPage : '' })} />
        </>
      ) : <EmptyState className="mt-5" title="Không có giao dịch phù hợp." />}

      <Modal open={!!selected} title="Chi tiết giao dịch" onClose={closeModal} actions={modalActions}>
        {selected && (
          <div className="space-y-3 text-[14px]">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-muted">Cổng thanh toán</dt><dd className="font-semibold">{PROVIDER[selected.provider]} Sandbox</dd></div>
              <div><dt className="text-muted">Trạng thái</dt><dd className="font-semibold">{STATUS[selected.status]}</dd></div>
              <div><dt className="text-muted">Mã đơn cổng</dt><dd className="break-all font-semibold">{selected.orderId}</dd></div>
              <div><dt className="text-muted">Mã xác nhận</dt><dd className="break-all font-semibold">{selected.providerTxnId || '—'}</dd></div>
              <div><dt className="text-muted">Số tiền</dt><dd className="font-semibold">{formatPrice(selected.amount)}</dd></div>
              <div><dt className="text-muted">Mã phản hồi</dt><dd className="font-semibold">{selected.responseCode || '—'}</dd></div>
              <div><dt className="text-muted">Khách hàng</dt><dd className="font-semibold">{selected.user?.name || '—'}</dd></div>
              <div><dt className="text-muted">Xử lý lúc</dt><dd className="font-semibold">{dateTime(selected.processedAt)}</dd></div>
            </dl>

            {canResolve && (
              <div className="rounded-card bg-sand/60 p-4">
                <label className="text-[13px] font-semibold">
                  Kết quả
                  <select className="field-input mt-1" value={resolution.status} onChange={(event) => setResolution((current) => ({ ...current, status: event.target.value }))}>
                    <option value="refunded">Đã hoàn tiền</option>
                    <option value="confirmed">Đã xác nhận</option>
                    <option value="ignored">Đóng / không xử lý thêm</option>
                  </select>
                </label>
                <label className="mt-3 block text-[13px] font-semibold">
                  Ghi chú
                  <textarea className="field-input mt-1 min-h-[80px]" value={resolution.note} onChange={(event) => setResolution((current) => ({ ...current, note: event.target.value }))} />
                </label>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
