import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createAdminVoucher, getAdminVouchers, toggleAdminVoucher, updateAdminVoucher } from '../../services/voucherService.js'
import Button from '../../components/ui/Button.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { formatPrice } from '../../utils/format.js'

const dateInput = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const blank = () => ({ code: '', name: '', description: '', discountType: 'percentage', value: 10, maxDiscount: 500000, minOrderValue: 0, startAt: dateInput(), endAt: dateInput(new Date(Date.now() + 30 * 86400000)), usageLimit: 100, perUserLimit: 1, isActive: true })
const showDate = (value) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(value))

export default function Vouchers() {
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('page')) || 1)
  const q = params.get('q') || ''
  const [keyword, setKeyword] = useState(q)
  const [data, setData] = useState({ vouchers: [], total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [editingId, setEditingId] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const load = async () => {
    setLoading(true)
    const res = await getAdminVouchers({ page, q })
    if (res.success) setData(res); else toast(res.message, 'error')
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, q])
  const open = (v) => {
    setEditingId(v?._id || '')
    setForm(v ? { ...v, startAt: dateInput(new Date(v.startAt)), endAt: dateInput(new Date(v.endAt)) } : blank())
  }
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  async function save() {
    setSaving(true)
    const res = editingId ? await updateAdminVoucher(editingId, form) : await createAdminVoucher(form)
    setSaving(false)
    if (!res.success) return toast(res.message, 'error')
    toast(res.message); setForm(null); load()
  }
  async function toggle(v) {
    const res = await toggleAdminVoucher(v._id, !v.isActive)
    if (!res.success) return toast(res.message, 'error')
    setData((current) => ({ ...current, vouchers: current.vouchers.map((item) => item._id === v._id ? res.voucher : item) }))
    toast(res.message)
  }
  const columns = [
    { key: 'code', label: 'Mã', render: (v) => <div><p className="font-bold text-teal">{v.code}</p><p className="max-w-[190px] truncate text-[12px] text-muted">{v.name}</p></div> },
    { key: 'discount', label: 'Mức giảm', render: (v) => <span className="font-semibold">{v.discountType === 'percentage' ? `${v.value}%` : formatPrice(v.value)}{v.maxDiscount > 0 && v.discountType === 'percentage' ? <small className="block font-normal text-muted">tối đa {formatPrice(v.maxDiscount)}</small> : null}</span> },
    { key: 'period', label: 'Hiệu lực', render: (v) => <span className="text-[13px]">{showDate(v.startAt)}<br />→ {showDate(v.endAt)}</span> },
    { key: 'usage', label: 'Lượt dùng', render: (v) => <span>{v.usedCount}/{v.usageLimit}<small className="block text-muted">{v.perUserLimit}/người</small></span> },
    { key: 'state', label: 'Trạng thái', render: (v) => <span className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold ${v.isActive ? 'bg-jade/10 text-jade' : 'bg-coral/10 text-coralD'}`}>{v.isActive ? 'Đang bật' : 'Đã tắt'}</span> },
    { key: 'actions', label: '', render: (v) => <div className="flex gap-1"><Button variant="ghost" className="!px-2.5 !py-1.5 text-[12px]" onClick={() => open(v)}>Sửa</Button><Button variant="ghost" className="!px-2.5 !py-1.5 text-[12px]" onClick={() => toggle(v)}>{v.isActive ? 'Tắt' : 'Bật'}</Button></div> },
  ]
  return <div>
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">KHUYẾN MÃI</p><h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Quản lý voucher</h1><p className="mt-1 text-[14px] text-muted">{data.total} mã ưu đãi</p></div><Button onClick={() => open()}>+ Tạo voucher</Button></div>
    <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); setParams(keyword.trim() ? { q: keyword.trim() } : {}) }}><input className="field-input !w-[280px]" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Tìm mã hoặc tên…" /><Button type="submit" variant="ghost">Tìm</Button></form>
    {loading ? <div className="mt-5 space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-[70px] rounded-card" />)}</div> : data.vouchers.length ? <><div className="mt-5"><Table columns={columns} rows={data.vouchers} rowKey={(v) => v._id} /></div><Pagination page={page} totalPages={data.totalPages} onPageChange={(p) => { const next = {}; if (q) next.q = q; if (p > 1) next.page = p; setParams(next) }} /></> : <EmptyState className="mt-5" title="Chưa có voucher." />}
    <Modal open={!!form} title={editingId ? 'Sửa voucher' : 'Tạo voucher'} onClose={() => !saving && setForm(null)} actions={<><Button variant="ghost" onClick={() => setForm(null)} disabled={saving}>Hủy</Button><Button onClick={save} disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu voucher'}</Button></>}>
      {form && <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        <label className="text-[13px] font-semibold">Mã<input className="field-input mt-1 uppercase" value={form.code} onChange={(e) => change('code', e.target.value)} /></label>
        <label className="text-[13px] font-semibold">Tên<input className="field-input mt-1" value={form.name} onChange={(e) => change('name', e.target.value)} /></label>
        <label className="text-[13px] font-semibold sm:col-span-2">Mô tả<input className="field-input mt-1" value={form.description} onChange={(e) => change('description', e.target.value)} /></label>
        <label className="text-[13px] font-semibold">Loại giảm<select className="field-input mt-1" value={form.discountType} onChange={(e) => change('discountType', e.target.value)}><option value="percentage">Phần trăm</option><option value="fixed">Số tiền</option></select></label>
        <label className="text-[13px] font-semibold">Giá trị<input type="number" min="1" className="field-input mt-1" value={form.value} onChange={(e) => change('value', e.target.value)} /></label>
        <label className="text-[13px] font-semibold">Giảm tối đa (0 = không giới hạn)<input type="number" min="0" className="field-input mt-1" value={form.maxDiscount} onChange={(e) => change('maxDiscount', e.target.value)} /></label>
        <label className="text-[13px] font-semibold">Đơn tối thiểu<input type="number" min="0" className="field-input mt-1" value={form.minOrderValue} onChange={(e) => change('minOrderValue', e.target.value)} /></label>
        <label className="text-[13px] font-semibold">Bắt đầu<input type="datetime-local" className="field-input mt-1" value={form.startAt} onChange={(e) => change('startAt', e.target.value)} /></label>
        <label className="text-[13px] font-semibold">Kết thúc<input type="datetime-local" className="field-input mt-1" value={form.endAt} onChange={(e) => change('endAt', e.target.value)} /></label>
        <label className="text-[13px] font-semibold">Tổng lượt<input type="number" min="1" className="field-input mt-1" value={form.usageLimit} onChange={(e) => change('usageLimit', e.target.value)} /></label>
        <label className="text-[13px] font-semibold">Lượt mỗi người<input type="number" min="1" className="field-input mt-1" value={form.perUserLimit} onChange={(e) => change('perUserLimit', e.target.value)} /></label>
      </div>}
    </Modal>
  </div>
}
