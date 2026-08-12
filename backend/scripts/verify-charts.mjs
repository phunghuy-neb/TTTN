// ============================================================
//  scripts/verify-charts.mjs — Kiểm HÌNH HỌC biểu đồ Dashboard
//
//  VÌ SAO CÓ FILE NÀY: kiểm thử Batch 7 từng báo PASS cho biểu đồ
//  tròn "Tỷ lệ theo khu vực" trong khi thực tế nó KHÔNG vẽ gì —
//  do script lúc đó chỉ ĐẾM số phần tử DOM. Phần tử tồn tại không
//  có nghĩa là người dùng nhìn thấy. Script này kiểm hình học thật:
//    - path phải có thuộc tính `d` khác rỗng
//    - getBoundingClientRect() phải có width > 0 VÀ height > 0
//  Áp cho cả 3 biểu đồ (cột doanh thu, tròn khu vực, thanh trạng thái)
//  ở nhiều bề rộng màn hình.
//
//  Yêu cầu: Backend + Vite đang chạy, và một Chrome mở sẵn cổng debug:
//    chrome.exe --headless=new --remote-debugging-port=9222 ^
//               --user-data-dir=%TEMP%\cdp-charts about:blank
//
//  Chạy:  node scripts/verify-charts.mjs
//  Tuỳ chọn qua biến môi trường:
//    CDP_PORT   (mặc định 9222)
//    FE_URL     (mặc định http://localhost:5173)
//    ADMIN_EMAIL / ADMIN_PASSWORD (bắt buộc, không lưu mật khẩu trong Git)
// ============================================================

const CDP = `http://127.0.0.1:${process.env.CDP_PORT || 9222}`
const BASE = process.env.FE_URL || 'http://localhost:5173'
const EMAIL = process.env.ADMIN_EMAIL
const MAT_KHAU = process.env.ADMIN_PASSWORD
const BE_RONG = [375, 768, 1440]

// Mỗi biểu đồ: thứ tự container trên trang + selector phần tử vẽ + số phần tử tối thiểu.
// `tyLeToiThieu`: phần tử LỚN NHẤT phải chiếm ít nhất bao nhiêu vùng vẽ — bắt được ca
// biểu đồ "có vẽ nhưng dừng giữa chừng" (animation bị đóng băng ở tab nền làm cột chỉ
// cao 55% trong khi số liệu đáng lẽ 94% → người xem đọc sai biểu đồ).
const BIEU_DO = [
  { ten: 'Cột doanh thu 6 tháng', index: 0, emptyId: 'monthly-revenue', selector: '.recharts-bar-rectangle path', toiThieu: 6, truc: 'cao', tyLeToiThieu: 0.8 },
  { ten: 'Tròn tỷ lệ khu vực', index: 1, emptyId: 'region-revenue', selector: '.recharts-pie-sector path', toiThieu: 3 },
  { ten: 'Thanh đơn theo trạng thái', index: 2, emptyId: 'booking-status', selector: '.recharts-bar-rectangle path', toiThieu: 4, truc: 'rong', tyLeToiThieu: 0.8 },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function layPage() {
  for (let i = 0; i < 30; i++) {
    const ds = await fetch(`${CDP}/json/list`).then((r) => r.json()).catch(() => [])
    const p = ds.find((t) => t.type === 'page')
    if (p) return p
    await sleep(500)
  }
  throw new Error(`Không kết nối được Chrome debug tại ${CDP}. Xem hướng dẫn ở đầu file.`)
}

async function ketNoi(url) {
  const ws = new WebSocket(url)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true })
    ws.addEventListener('error', () => rej(new Error('Lỗi WebSocket CDP')), { once: true })
  })
  let id = 0
  const cho = new Map()
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && cho.has(m.id)) { cho.get(m.id)(m); cho.delete(m.id) }
  })
  return (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id
      cho.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)))
      ws.send(JSON.stringify({ id: i, method, params }))
    })
}

async function main() {
  if (!EMAIL || !MAT_KHAU) {
    throw new Error('Thiếu ADMIN_EMAIL hoặc ADMIN_PASSWORD để kiểm thử dashboard.')
  }
  const page = await layPage()
  const send = await ketNoi(page.webSocketDebuggerUrl)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')

  const chay = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) {
      throw new Error('JS lỗi: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    }
    return r.result.value
  }
  const doi = async (bieuThuc, hanMs = 15000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < hanMs) {
      try { if (await chay(`!!(${bieuThuc})`)) return true } catch {}
      await sleep(200)
    }
    return false
  }
  const mo = async (url) => {
    await chay(`window.__dieuHuong = 1; true`).catch(() => {})
    await send('Page.navigate', { url })
    await doi(`document.readyState === 'complete' && window.__dieuHuong === undefined`, 20000)
    await sleep(800)
  }
  const dien = (sel, val) => `(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return false
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(val)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`

  // ── Đăng nhập admin ────────────────────────────────────────
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await send('Network.clearBrowserCookies')
  await mo(`${BASE}/login`)
  await chay(`localStorage.removeItem('auth'); true`)
  await mo(`${BASE}/login`)
  if (!(await doi(`document.querySelector('#email')`, 15000))) throw new Error('Không thấy form đăng nhập')
  await chay(dien('#email', EMAIL))
  await chay(dien('#password', MAT_KHAU))
  await chay(`document.querySelector('form button[type="submit"]').click()`)
  if (!(await doi(`document.body.innerText.includes('Đăng xuất')`, 15000))) {
    throw new Error('Đăng nhập admin thất bại')
  }

  // ── Kiểm từng biểu đồ ở từng bề rộng ───────────────────────
  const ketQua = []
  for (const rong of BE_RONG) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: rong, height: rong < 700 ? 812 : 1000, deviceScaleFactor: 1, mobile: rong < 700,
    })
    await mo(`${BASE}/admin`)
    await doi(`document.querySelectorAll('.recharts-responsive-container, [data-chart-empty]').length >= 3`, 20000)
    // Chờ biểu đồ vẽ xong (Recharts có animation khi mount)
    await doi(`[...document.querySelectorAll('.recharts-pie-sector path, .recharts-bar-rectangle path')]
      .filter((p) => (p.getAttribute('d') || '').length > 20).length >= 13`, 15000)
    await sleep(600)

    for (const bd of BIEU_DO) {
      const dulieu = await chay(`(() => {
        const empty = document.querySelector('[data-chart-empty="${bd.emptyId}"]')
        if (empty) {
          const r = empty.getBoundingClientRect()
          return { empty: true, w: Math.round(r.width), h: Math.round(r.height), text: empty.innerText.trim() }
        }
        const cont = document.querySelector('[data-chart-card="${bd.emptyId}"] .recharts-responsive-container')
        if (!cont) return { loi: 'không thấy container' }
        const paths = [...cont.querySelectorAll(${JSON.stringify(bd.selector)})]
        const luoi = cont.querySelector('.recharts-cartesian-grid')
        const oLuoi = luoi ? luoi.getBoundingClientRect() : null
        return {
          soPhanTu: paths.length,
          vungVe: oLuoi ? { w: Math.round(oLuoi.width), h: Math.round(oLuoi.height) } : null,
          hinhHoc: paths.map((p) => {
            const r = p.getBoundingClientRect()
            return { dLen: (p.getAttribute('d') || '').length, w: Math.round(r.width), h: Math.round(r.height) }
          }),
        }
      })()`)

      if (dulieu.empty) {
        const dat = dulieu.w > 0 && dulieu.h > 0 && dulieu.text.length > 0
        ketQua.push({ rong, ten: bd.ten, dat, empty: true, lyDo: dat ? '' : 'trạng thái rỗng không hiển thị đúng' })
        continue
      }

      if (dulieu.loi) {
        ketQua.push({ rong, ten: bd.ten, dat: false, lyDo: dulieu.loi })
        continue
      }
      // MẤU CHỐT 1: không chỉ đếm — mọi phần tử phải có `d` khác rỗng và bbox > 0
      const veThat = dulieu.hinhHoc.filter((h) => h.dLen > 0 && h.w > 0 && h.h > 0)
      let dat = dulieu.soPhanTu >= bd.toiThieu && veThat.length >= bd.toiThieu
      let lyDo = dat ? '' : `có ${dulieu.soPhanTu} phần tử nhưng chỉ ${veThat.length} vẽ thật (cần ≥ ${bd.toiThieu})`

      // MẤU CHỐT 2: với biểu đồ có trục, phần tử lớn nhất phải chạm gần đỉnh trục —
      // nếu không, biểu đồ đã dừng giữa chừng và đang hiện SAI tỉ lệ
      let tyLe = null
      if (dat && bd.truc && dulieu.vungVe) {
        const canh = bd.truc === 'cao' ? 'h' : 'w'
        const lonNhat = Math.max(...veThat.map((h) => h[canh]))
        tyLe = lonNhat / dulieu.vungVe[canh]
        if (tyLe < bd.tyLeToiThieu) {
          dat = false
          lyDo = `phần tử lớn nhất chỉ chiếm ${Math.round(tyLe * 100)}% vùng vẽ (cần ≥ ${bd.tyLeToiThieu * 100}%) — biểu đồ vẽ dở dang, hiện sai tỉ lệ`
        }
      }

      ketQua.push({ rong, ten: bd.ten, dat, lyDo, tyLe, chiTiet: dulieu.hinhHoc.slice(0, 4) })
    }
  }

  await send('Emulation.clearDeviceMetricsOverride')

  // ── Báo cáo ────────────────────────────────────────────────
  console.log('═'.repeat(64))
  console.log('  KIỂM HÌNH HỌC BIỂU ĐỒ DASHBOARD')
  console.log('═'.repeat(64))
  let hong = 0
  for (const rong of BE_RONG) {
    console.log(`\n▸ ${rong}px`)
    for (const r of ketQua.filter((x) => x.rong === rong)) {
      if (!r.dat) hong++
      const vd = r.chiTiet?.[0]
      console.log(
        `   ${r.dat ? '✔' : '✘'} ${r.ten}` +
          (r.dat && r.empty
            ? '  (không có dữ liệu — đã hiện trạng thái rỗng)'
            : r.dat
            ? `  (mẫu: d=${vd?.dLen} ký tự, ${vd?.w}×${vd?.h}px${r.tyLe ? `, lớn nhất ${Math.round(r.tyLe * 100)}% vùng vẽ` : ''})`
            : `  → ${r.lyDo}`)
      )
    }
  }
  console.log('\n' + '─'.repeat(64))
  console.log(`Tổng: ${ketQua.length - hong}/${ketQua.length} đạt`)
  if (hong > 0) console.log('✘ CÓ BIỂU ĐỒ KHÔNG VẼ RA HÌNH — xem chi tiết bên trên.')
  else console.log('✔ Mọi khu vực biểu đồ hiển thị hợp lệ ở mọi bề rộng.')
  process.exit(hong > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('VERIFY-CHARTS LỖI:', err.message)
  process.exit(1)
})
