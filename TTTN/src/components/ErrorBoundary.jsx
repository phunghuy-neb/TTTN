import { Component } from 'react'

// Lưới an toàn cuối cùng: một component render nổ (bug bất ngờ) thì hiện màn hình
// thân thiện thay vì trang trắng. Bọc toàn bộ app trong App.jsx.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { loi: null }
  }

  static getDerivedStateFromError(loi) {
    return { loi }
  }

  componentDidCatch(loi, thongTin) {
    console.error('[ErrorBoundary]', loi, thongTin?.componentStack)
  }

  render() {
    if (!this.state.loi) return this.props.children
    return (
      <div className="grid min-h-screen place-items-center bg-bg p-6">
        <div className="card-surface max-w-[480px] p-8 text-center">
          <div className="mb-3 text-[44px]">😵</div>
          <h1 className="font-heading text-[22px] font-semibold text-ink">Có lỗi không mong muốn</h1>
          <p className="mt-2 text-[14.5px] text-muted">
            Ứng dụng gặp sự cố khi hiển thị trang này. Tải lại trang thường sẽ khắc phục được.
          </p>
          <button type="button" className="btn-teal mt-5" onClick={() => window.location.reload()}>
            Tải lại trang
          </button>
        </div>
      </div>
    )
  }
}
