import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { PrivateRoute, GuestRoute } from './routes/PrivateRoute.jsx'
import { AdminRoute } from './routes/AdminRoute.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'
import Layout from './components/Layout.jsx'
import AdminLayout from './layouts/AdminLayout.jsx'
import Home from './pages/Home.jsx'
import TourList from './pages/TourList.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import TourDetail from './pages/TourDetail.jsx'
import Profile from './pages/Profile.jsx'
import Checkout from './pages/Checkout.jsx'
import Payment from './pages/Payment.jsx'
import Bookings from './pages/Bookings.jsx'
import Dashboard from './pages/admin/Dashboard.jsx'
import AdminTours from './pages/admin/Tours.jsx'
import AdminTourForm from './pages/admin/TourForm.jsx'
import AdminBookings from './pages/admin/Bookings.jsx'
import AdminUsers from './pages/admin/Users.jsx'
import Forbidden from './pages/Forbidden.jsx'
import NotFound from './pages/NotFound.jsx'

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <ToastProvider>
            <Routes>
              {/* Khu client — Header + Footer dùng chung */}
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

                <Route path="403" element={<Forbidden />} />
                <Route path="*" element={<NotFound />} />
              </Route>

              {/* Khu admin — layout riêng, yêu cầu đăng nhập + role admin */}
              <Route element={<AdminRoute />}>
                <Route path="admin" element={<AdminLayout />}>
                  <Route index element={<Dashboard />} />
                  <Route path="tours" element={<AdminTours />} />
                  <Route path="tours/new" element={<AdminTourForm />} />
                  <Route path="tours/:id/edit" element={<AdminTourForm />} />
                  <Route path="bookings" element={<AdminBookings />} />
                  <Route path="users" element={<AdminUsers />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Route>
            </Routes>
          </ToastProvider>
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}
