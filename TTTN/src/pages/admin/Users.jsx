import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getAdminUsers, toggleLockUser, changeUserRole } from '../../services/adminUserService.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { formatDate } from '../../utils/format.js'
import Button from '../../components/ui/Button.jsx'
import EmptyState from '../../components/ui/EmptyState.jsx'
import Modal from '../../components/ui/Modal.jsx'
import Pagination from '../../components/ui/Pagination.jsx'
import Skeleton from '../../components/ui/Skeleton.jsx'
import Table from '../../components/ui/Table.jsx'
import { useToast } from '../../components/ui/Toast.jsx'
import { useRequestGuard } from '../../hooks/useRequestGuard.js'

const BO_LOC_ROLE = [
  { value: '', label: 'Tất cả' },
  { value: 'customer', label: 'Khách hàng' },
  { value: 'admin', label: 'Admin' },
]

// Trang quản lý người dùng (admin) — search + lọc role theo URL
export default function Users() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user: currentUser } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [pagination, setPagination] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Hành động chờ xác nhận trong Modal: { loai: 'lock'|'role', user, roleMoi? }
  const [hanhDong, setHanhDong] = useState(null)
  const [dangGui, setDangGui] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const page = Number(searchParams.get('page')) || 1
  const q = searchParams.get('q') || ''
  const role = searchParams.get('role') || ''
  const [tuKhoa, setTuKhoa] = useState(q)

  const beginRequest = useRequestGuard()

  async function load() {
    const isCurrent = beginRequest()
    setLoading(true)
    setError('')
    try {
      const res = await getAdminUsers({ page, q, role })
      if (!isCurrent()) return
      if (!res.success) {
        setError(res.message || 'Không tải được danh sách người dùng.')
        return
      }
      setUsers(res.data)
      setPagination(res.pagination)
    } catch {
      if (!isCurrent()) return
      setError('Không tải được danh sách người dùng.')
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, role, refreshKey])

  function apDungBoLoc(next) {
    const params = {}
    if (next.q) params.q = next.q
    if (next.role) params.role = next.role
    setSearchParams(params)
  }

  function goToPage(p) {
    const params = new URLSearchParams(searchParams)
    if (p <= 1) params.delete('page')
    else params.set('page', String(p))
    setSearchParams(params)
  }

  async function thucHien() {
    if (!hanhDong) return
    setDangGui(true)
    const res =
      hanhDong.loai === 'lock'
        ? await toggleLockUser(hanhDong.user._id)
        : await changeUserRole(hanhDong.user._id, hanhDong.roleMoi)
    setDangGui(false)
    setHanhDong(null)
    if (!res.success) {
      toast(res.message, 'error')
      return
    }
    toast(res.message)
    setRefreshKey((k) => k + 1)
  }

  const totalPages = pagination?.totalPages ?? 1

  const columns = [
    {
      key: 'ten',
      label: 'Người dùng',
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sand font-semibold text-teal">
            {u.name?.charAt(0)}
          </span>
          <div className="max-w-[200px]">
            <p className="truncate font-semibold text-ink">
              {u.name}
              {u._id === currentUser?._id && <span className="ml-1.5 text-[12px] text-muted">(bạn)</span>}
            </p>
            <p className="truncate text-[12.5px] text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'SĐT', render: (u) => u.phone || <span className="text-muted">—</span> },
    {
      key: 'role',
      label: 'Quyền',
      render: (u) =>
        u.role === 'admin' ? (
          <span className="rounded-pill bg-teal/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-teal">Admin</span>
        ) : (
          <span className="rounded-pill bg-sand px-2.5 py-0.5 text-[12.5px] font-semibold text-muted">Khách hàng</span>
        ),
    },
    { key: 'soDon', label: 'Số đơn', render: (u) => u.soDon ?? 0 },
    {
      key: 'trangThai',
      label: 'Trạng thái',
      render: (u) =>
        u.isActive ? (
          <span className="rounded-pill bg-jade/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-jade">Hoạt động</span>
        ) : (
          <span className="rounded-pill bg-coral/10 px-2.5 py-0.5 text-[12.5px] font-semibold text-coralD">Đã khóa</span>
        ),
    },
    { key: 'ngayTao', label: 'Tham gia', render: (u) => formatDate(u.createdAt) },
    {
      key: 'thaoTac',
      label: 'Thao tác',
      render: (u) => {
        // Không render nút tự-khóa / tự-hạ-quyền với chính mình (BE vẫn chặn 409 nếu gọi thẳng API)
        if (u._id === currentUser?._id) return <span className="text-[13px] text-muted">—</span>
        return (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              className={`!px-3 !py-1.5 text-[13px] ${u.isActive ? '!text-coralD hover:!border-coral' : ''}`}
              onClick={() => setHanhDong({ loai: 'lock', user: u })}
            >
              {u.isActive ? 'Khóa' : 'Mở khóa'}
            </Button>
            <Button
              variant="ghost"
              className="!px-3 !py-1.5 text-[13px]"
              onClick={() =>
                setHanhDong({ loai: 'role', user: u, roleMoi: u.role === 'admin' ? 'customer' : 'admin' })
              }
            >
              {u.role === 'admin' ? 'Hạ quyền' : 'Cấp admin'}
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <p className="eyebrow">QUẢN LÝ NGƯỜI DÙNG</p>
      <h1 className="mt-2 font-heading text-[26px] font-semibold text-ink">Danh sách người dùng</h1>
      {pagination && !loading && (
        <p className="mt-1 text-[14px] text-muted">Tìm thấy {pagination.total} người dùng</p>
      )}

      <form
        className="mt-5 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          apDungBoLoc({ q: tuKhoa.trim(), role })
        }}
      >
        <input
          type="search"
          placeholder="Tìm theo tên, email…"
          value={tuKhoa}
          onChange={(e) => setTuKhoa(e.target.value)}
          className="field-input !w-[240px]"
        />
        <Button type="submit" className="!px-4 !py-2.5 text-[14px]">Tìm</Button>
        <div className="ml-2 flex flex-wrap gap-2">
          {BO_LOC_ROLE.map((bl) => (
            <button
              key={bl.value}
              type="button"
              onClick={() => apDungBoLoc({ q, role: bl.value })}
              className={
                bl.value === role
                  ? 'rounded-pill bg-teal px-3.5 py-1.5 text-[13.5px] font-semibold text-white'
                  : 'rounded-pill border border-line px-3.5 py-1.5 text-[13.5px] text-ink transition hover:bg-sand'
              }
            >
              {bl.label}
            </button>
          ))}
        </div>
      </form>

      {loading && (
        <div className="mt-5 flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[54px] rounded-card" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="card-surface mt-5 p-6 text-center">
          <p className="text-coralD">{error}</p>
          <Button className="mt-4" onClick={load}>Thử lại</Button>
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <EmptyState className="mt-5" title="Không có người dùng nào khớp bộ lọc." />
      )}

      {!loading && !error && users.length > 0 && (
        <>
          <div className="mt-5">
            <Table columns={columns} rows={users} rowKey={(u) => u._id} />
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={goToPage} />
        </>
      )}

      {/* Modal xác nhận khóa / đổi quyền */}
      <Modal
        open={!!hanhDong}
        title={
          hanhDong?.loai === 'lock'
            ? hanhDong.user.isActive
              ? 'Khóa tài khoản'
              : 'Mở khóa tài khoản'
            : hanhDong?.roleMoi === 'admin'
              ? 'Cấp quyền Admin'
              : 'Hạ quyền về Khách hàng'
        }
        onClose={() => !dangGui && setHanhDong(null)}
        actions={
          <>
            <Button variant="ghost" className="!px-4 !py-2 text-[14px]" disabled={dangGui} onClick={() => setHanhDong(null)}>
              Không
            </Button>
            <Button variant="coral" className="!px-4 !py-2 text-[14px]" disabled={dangGui} onClick={thucHien}>
              {dangGui ? 'Đang xử lý…' : 'Xác nhận'}
            </Button>
          </>
        }
      >
        {hanhDong?.loai === 'lock' ? (
          hanhDong.user.isActive ? (
            <>
              Khóa tài khoản <b className="text-ink">{hanhDong.user.email}</b>? Người này sẽ không thể
              đăng nhập (403) cho tới khi được mở khóa.
            </>
          ) : (
            <>Mở khóa tài khoản <b className="text-ink">{hanhDong?.user.email}</b> để đăng nhập trở lại?</>
          )
        ) : (
          <>
            Đổi quyền của <b className="text-ink">{hanhDong?.user.email}</b> thành{' '}
            <b className="text-ink">{hanhDong?.roleMoi === 'admin' ? 'Admin' : 'Khách hàng'}</b>?
            {hanhDong?.roleMoi === 'admin' && ' Người này sẽ truy cập được toàn bộ khu quản trị.'}
          </>
        )}
      </Modal>
    </div>
  )
}
