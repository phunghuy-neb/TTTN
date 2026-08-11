// Khối xương loading — gói pattern `animate-pulse` + nền sand viết tay ở từng trang.
// Kích thước/bo góc truyền qua className; các thanh chi tiết bên trong (bg-line)
// vẫn là markup thường vì animate-pulse của khối cha áp cho toàn bộ con.
//
//   <Skeleton className="h-4 w-2/3 rounded" />
//   <Skeleton className="overflow-hidden rounded-card">...các thanh bg-line...</Skeleton>
export default function Skeleton({ className = '', children }) {
  return <div className={`animate-pulse bg-sand ${className}`.trim()}>{children}</div>
}
