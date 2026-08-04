// Bảng dữ liệu (dùng cho các màn admin) — header nền sand, cuộn ngang khi màn hẹp.
//
//   <Table
//     columns={[
//       { key: 'name', label: 'Tên tour' },
//       { key: 'price', label: 'Giá', render: (row) => formatPrice(row.basePrice) },
//     ]}
//     rows={tours}
//     rowKey={(row) => row._id}
//   />
export default function Table({ columns, rows, rowKey }) {
  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-line bg-sand/60">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-3 text-[13px] font-semibold text-muted ${c.className || ''}`.trim()}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line/60 transition last:border-0 hover:bg-sand/30">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 text-ink ${c.className || ''}`.trim()}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
