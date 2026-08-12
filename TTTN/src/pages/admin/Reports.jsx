import { useState } from 'react'
import Button from '../../components/ui/Button.jsx'
import { downloadReport } from '../../services/adminOperationsService.js'
import { useToast } from '../../components/ui/Toast.jsx'

export default function Reports() {
  const [filters, setFilters] = useState({ from: '', to: '', status: '' })
  const [downloading, setDownloading] = useState('')
  const toast = useToast()
  async function download(type, format) {
    const key = `${type}-${format}`; setDownloading(key)
    const res = await downloadReport(type, format, filters)
    setDownloading('')
    if (!res.success) toast(res.message, 'error')
  }
  const block = (type, title, description) => <section className="card-surface p-6"><h2 className="font-heading text-[20px] font-semibold text-ink">{title}</h2><p className="mt-2 text-[14px] leading-relaxed text-muted">{description}</p><div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => download(type, 'xlsx')} disabled={!!downloading}>{downloading === `${type}-xlsx` ? 'Đang tạo…' : 'Tải Excel (.xlsx)'}</Button><Button variant="ghost" onClick={() => download(type, 'csv')} disabled={!!downloading}>{downloading === `${type}-csv` ? 'Đang tạo…' : 'Tải CSV'}</Button></div></section>
  return <div><p className="eyebrow">BÁO CÁO</p><h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Xuất dữ liệu</h1><p className="mt-1 text-[14px] text-muted">Tệp được tạo từ dữ liệu hiện tại trên máy chủ.</p><div className="card-surface mt-5 grid gap-4 p-5 sm:grid-cols-3"><label className="text-[13px] font-semibold">Từ ngày<input type="date" className="field-input mt-1" value={filters.from} onChange={(e) => setFilters((c) => ({ ...c, from: e.target.value }))} /></label><label className="text-[13px] font-semibold">Đến ngày<input type="date" className="field-input mt-1" value={filters.to} onChange={(e) => setFilters((c) => ({ ...c, to: e.target.value }))} /></label><label className="text-[13px] font-semibold">Trạng thái booking<select className="field-input mt-1" value={filters.status} onChange={(e) => setFilters((c) => ({ ...c, status: e.target.value }))}><option value="">Tất cả</option><option value="pending_payment">Chờ thanh toán</option><option value="paid">Đã thanh toán</option><option value="completed">Hoàn thành</option><option value="cancelled">Đã hủy</option></select></label></div><div className="mt-5 grid gap-5 lg:grid-cols-2">{block('bookings', 'Danh sách booking', 'Chi tiết mã đơn, khách hàng, tour, giá gốc, voucher, thanh toán và trạng thái.')}{block('revenue', 'Doanh thu theo tour', 'Tổng hợp số đơn, số khách, doanh thu gộp, giảm giá và doanh thu thực theo từng tour.')}</div></div>
}
