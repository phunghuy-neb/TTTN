import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext.jsx'
import { PrivateRoute, GuestRoute } from './routes/PrivateRoute.jsx'
import Layout from './components/Layout.jsx'
import Home from './pages/Home.jsx'
import TourList from './pages/TourList.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import TourDetail from './pages/TourDetail.jsx'
import Profile from './pages/Profile.jsx'
import Checkout from './pages/Checkout.jsx'
import Payment from './pages/Payment.jsx'
import Bookings from './pages/Bookings.jsx'
import NotFound from './pages/NotFound.jsx'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="tours" element={<TourList />} />
            <Route path="tour/:slug" element={<TourDetail />} />

            {/* Chỉ dành cho khách chưa đăng nhập */}
            <Route element={<GuestRoute />}>
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
            </Route>

            {/* Yêu cầu đăng nhập */}
            <Route element={<PrivateRoute />}>
              <Route path="profile" element={<Profile />} />
              <Route path="checkout" element={<Checkout />} />
              <Route path="payment" element={<Payment />} />
              <Route path="bookings" element={<Bookings />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
