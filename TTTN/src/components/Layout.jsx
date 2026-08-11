import { Outlet } from 'react-router-dom'
import ScrollToHash from './ScrollToHash.jsx'
import Header from './Header.jsx'
import Footer from './Footer.jsx'
import FloatingContact from './FloatingContact.jsx'

// Bố cục dùng chung: Header + nội dung route + Footer + cụm icon nổi.
export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToHash />
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <FloatingContact />
    </div>
  )
}
