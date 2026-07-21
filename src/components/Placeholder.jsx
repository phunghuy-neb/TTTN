import { Link } from 'react-router-dom'

// Khung tạm cho các trang chưa phát triển trong tuần này.
export default function Placeholder({ title }) {
  return (
    <>
      <div className="bg-gradient-to-br from-teal to-teal2 py-[34px] text-white">
        <div className="wrap">
          <h1 className="text-[30px]">{title}</h1>
          <p className="mt-1 text-[15px] text-[#BFDBD4]">Trang này đang được xây dựng.</p>
        </div>
      </div>
      <div className="wrap py-16">
        <div className="mx-auto max-w-[520px] rounded-card border-[1.5px] border-dashed border-line bg-white px-6 py-12 text-center">
          <div className="mb-3 text-5xl">🚧</div>
          <h2 className="mb-2 text-[22px]">Đang phát triển</h2>
          <p className="mb-6 text-[15px] text-muted">
            Tính năng “{title}” sẽ được hoàn thiện trong các tuần tiếp theo.
          </p>
          <Link to="/" className="btn-ghost">
            ← Về trang chủ
          </Link>
        </div>
      </div>
    </>
  )
}
