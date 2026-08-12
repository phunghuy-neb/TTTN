import test from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import Ticket from '../src/models/Ticket.js'
import { ticketVerifyUrl } from '../src/services/ticketService.js'

test('vé sinh mã riêng và token xác minh không dùng MongoDB ID', async () => {
  const booking = new mongoose.Types.ObjectId()
  const ticket = new Ticket({ booking, user: new mongoose.Types.ObjectId(), tour: new mongoose.Types.ObjectId() })
  await ticket.validate()
  assert.match(ticket.ticketCode, /^VVT-\d{6}-[A-F0-9]{8}$/)
  assert.match(ticket.verificationToken, /^[a-f0-9]{48}$/)
  assert.notEqual(ticket.verificationToken, String(booking))
})

test('QR vé dùng trang xác minh HTML công khai, không phụ thuộc SPA', async () => {
  const previous = process.env.PUBLIC_BASE_URL
  process.env.PUBLIC_BASE_URL = 'https://tickets.example.test/'
  const ticket = new Ticket({ booking: new mongoose.Types.ObjectId(), user: new mongoose.Types.ObjectId(), tour: new mongoose.Types.ObjectId() })
  await ticket.validate()
  assert.equal(ticketVerifyUrl(ticket), `https://tickets.example.test/api/tickets/verify-page/${ticket.verificationToken}`)
  if (previous === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = previous
})
