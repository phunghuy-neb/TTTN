import { Link } from 'react-router-dom'
import { ArrowUpRightIcon } from './ChatIcons.jsx'

function inlineContent(text) {
  return String(text)
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={index}>{part.slice(2, -2)}</strong>
      ) : (
        <span key={index}>{part}</span>
      )
    )
}

const splitCells = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

const isSeparator = (line) =>
  splitCells(line).length > 1 && splitCells(line).every((cell) => /^:?-{3,}:?$/.test(cell))

function parseBlocks(content) {
  const lines = String(content || '').replace(/\r/g, '').split('\n')
  const blocks = []

  for (let index = 0; index < lines.length; ) {
    const line = lines[index]
    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.includes('|') && lines[index + 1]?.includes('|') && isSeparator(lines[index + 1])) {
      const headers = splitCells(line)
      const rows = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitCells(lines[index]))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', items })
      continue
    }

    if (/^#{1,4}\s+/.test(line)) {
      blocks.push({ type: 'heading', text: line.replace(/^#{1,4}\s+/, '') })
      index += 1
      continue
    }

    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ type: 'divider' })
      index += 1
      continue
    }

    const paragraph = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^#{1,4}\s+/.test(lines[index]) &&
      !/^\s*---+\s*$/.test(lines[index]) &&
      !(lines[index].includes('|') && lines[index + 1]?.includes('|') && isSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
  }

  return blocks
}

function CompactTable({ headers, rows }) {
  const visibleRows = rows.slice(0, 5)
  return (
    <div className="space-y-2">
      {visibleRows.map((row, rowIndex) => (
        <div key={rowIndex} className="rounded-xl border border-line bg-bg/70 p-2.5">
          {row.map((cell, cellIndex) => (
            <div key={cellIndex} className="grid grid-cols-[86px_minmax(0,1fr)] gap-2 py-0.5 text-[12px]">
              <span className="font-semibold text-muted">{headers[cellIndex] || `Mục ${cellIndex + 1}`}</span>
              <span className="min-w-0 text-ink">{inlineContent(cell)}</span>
            </div>
          ))}
        </div>
      ))}
      {rows.length > visibleRows.length && (
        <p className="text-xs text-muted">Còn {rows.length - visibleRows.length} mục trong bản đầy đủ.</p>
      )}
      <Link
        to="/ai-assistant"
        className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-jade hover:text-teal"
      >
        Xem so sánh đầy đủ <ArrowUpRightIcon />
      </Link>
    </div>
  )
}

function FullTable({ headers, rows }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-xl border border-line bg-white">
      <table className="min-w-[560px] w-full border-collapse text-left text-sm">
        <thead className="bg-sand/70">
          <tr>
            {headers.map((header, index) => (
              <th key={index} className="border-b border-line px-3 py-2.5 font-semibold text-teal">
                {inlineContent(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="align-top even:bg-bg/60">
              {headers.map((_, cellIndex) => (
                <td key={cellIndex} className="border-b border-line/70 px-3 py-2.5 last:border-r-0">
                  {inlineContent(row[cellIndex] || '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ChatMessageContent({ content, compact = false }) {
  return (
    <div className="space-y-2.5 break-words">
      {parseBlocks(content).map((block, index) => {
        if (block.type === 'table') {
          return compact ? (
            <CompactTable key={index} headers={block.headers} rows={block.rows} />
          ) : (
            <FullTable key={index} headers={block.headers} rows={block.rows} />
          )
        }
        if (block.type === 'list') {
          return (
            <ul key={index} className="space-y-1 pl-4">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="list-disc pl-0.5 marker:text-jade">
                  {inlineContent(item)}
                </li>
              ))}
            </ul>
          )
        }
        if (block.type === 'heading') {
          return (
            <h3 key={index} className="pt-1 font-heading text-[1.05em] font-semibold text-teal">
              {inlineContent(block.text)}
            </h3>
          )
        }
        if (block.type === 'divider') return <hr key={index} className="border-line" />
        return (
          <p key={index} className="whitespace-pre-wrap">
            {inlineContent(block.text)}
          </p>
        )
      })}
    </div>
  )
}
