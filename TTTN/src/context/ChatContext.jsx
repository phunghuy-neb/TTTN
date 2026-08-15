import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import {
  createConversation as createConversationRequest,
  getConversationMessages,
  getConversations,
  sendChatMessage,
} from '../services/chatService.js'
import {
  mergeConversationPage,
  mergeMessagePage,
  normalizePagination,
} from './chatPagination.js'

const ChatContext = createContext(null)
const MESSAGE_PAGE_LIMIT = 100
const CONVERSATION_PAGE_LIMIT = 20

const emptyPagination = (limit) => ({ page: 1, limit, total: 0, totalPages: 0, hasMore: false })

const storageKey = (userId) => `vietvoyage-active-conversation:${userId}`

export function ChatProvider({ children }) {
  const { user } = useAuth()
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState('')
  const [messages, setMessages] = useState([])
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
  const [messagePagination, setMessagePagination] = useState(() => emptyPagination(MESSAGE_PAGE_LIMIT))
  const [conversationPagination, setConversationPagination] = useState(() => emptyPagination(CONVERSATION_PAGE_LIMIT))
  const [sending, setSending] = useState(false)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const messageRequestId = useRef(0)
  const conversationRequestId = useRef(0)
  const activeConversationIdRef = useRef('')
  const creatingConversationRef = useRef(null)
  const loadingOlderMessagesRef = useRef(false)
  const loadingMoreConversationsRef = useRef(false)

  const rememberActive = useCallback(
    (conversationId) => {
      activeConversationIdRef.current = conversationId || ''
      setActiveConversationId(conversationId || '')
      if (!user?._id) return
      if (conversationId) localStorage.setItem(storageKey(user._id), conversationId)
      else localStorage.removeItem(storageKey(user._id))
    },
    [user?._id]
  )

  const loadMessages = useCallback(async (conversationId) => {
    const requestId = ++messageRequestId.current
    if (!conversationId) {
      setMessages([])
      setMessagePagination(emptyPagination(MESSAGE_PAGE_LIMIT))
      return { success: true }
    }

    loadingOlderMessagesRef.current = false
    setLoadingOlderMessages(false)
    setLoadingMessages(true)
    setMessages([])
    setMessagePagination(emptyPagination(MESSAGE_PAGE_LIMIT))
    const res = await getConversationMessages(conversationId, { page: 1, limit: MESSAGE_PAGE_LIMIT })
    if (requestId !== messageRequestId.current) return res

    setLoadingMessages(false)
    if (res.success) {
      setMessages(mergeMessagePage([], (res.messages || []).map((message) => ({
          ...message,
          conversationId,
        })), { replace: true }))
      setMessagePagination(normalizePagination(res, MESSAGE_PAGE_LIMIT))
    }
    return res
  }, [])

  const loadOlderMessages = useCallback(async () => {
    const conversationId = activeConversationIdRef.current
    if (!conversationId || !messagePagination.hasMore || loadingOlderMessagesRef.current) {
      return { success: false }
    }
    const requestId = messageRequestId.current
    const nextPage = messagePagination.page + 1
    loadingOlderMessagesRef.current = true
    setLoadingOlderMessages(true)
    const res = await getConversationMessages(conversationId, {
      page: nextPage,
      limit: messagePagination.limit || MESSAGE_PAGE_LIMIT,
    })
    if (requestId === messageRequestId.current && activeConversationIdRef.current === conversationId) {
      if (res.success) {
        setMessages((items) => mergeMessagePage(items, (res.messages || []).map((message) => ({
          ...message,
          conversationId,
        }))))
        setMessagePagination(normalizePagination(res, MESSAGE_PAGE_LIMIT))
      }
      loadingOlderMessagesRef.current = false
      setLoadingOlderMessages(false)
    }
    return res
  }, [messagePagination])

  const selectConversation = useCallback(
    async (conversationId) => {
      if (!conversationId) return
      rememberActive(conversationId)
      await loadMessages(conversationId)
    },
    [loadMessages, rememberActive]
  )

  const refreshConversations = useCallback(async () => {
    if (!user) return { success: false }
    const requestId = ++conversationRequestId.current
    setLoadingConversations(true)
    setLoadingMoreConversations(false)
    loadingMoreConversationsRef.current = false
    let res = await getConversations({ page: 1, limit: CONVERSATION_PAGE_LIMIT })
    if (requestId !== conversationRequestId.current) return res
    if (!res.success) {
      setLoadingConversations(false)
      return res
    }

    const savedId = localStorage.getItem(storageKey(user._id))
    let nextConversations = mergeConversationPage([], res.conversations || [], { replace: true })
    let pagination = normalizePagination(res, CONVERSATION_PAGE_LIMIT)
    while (savedId && !nextConversations.some((item) => item._id === savedId) && pagination.hasMore) {
      const next = await getConversations({ page: pagination.page + 1, limit: pagination.limit })
      if (requestId !== conversationRequestId.current) return next
      if (!next.success) break
      nextConversations = mergeConversationPage(nextConversations, next.conversations || [])
      pagination = normalizePagination(next, CONVERSATION_PAGE_LIMIT)
      res = next
    }

    setLoadingConversations(false)
    setConversations(nextConversations)
    setConversationPagination(pagination)
    const nextActive =
      (savedId && nextConversations.some((item) => item._id === savedId) && savedId) ||
      nextConversations[0]?._id ||
      ''
    rememberActive(nextActive)
    await loadMessages(nextActive)
    return res
  }, [loadMessages, rememberActive, user])

  const loadMoreConversations = useCallback(async () => {
    if (!user || !conversationPagination.hasMore || loadingMoreConversationsRef.current) {
      return { success: false }
    }
    const requestId = conversationRequestId.current
    loadingMoreConversationsRef.current = true
    setLoadingMoreConversations(true)
    const res = await getConversations({
      page: conversationPagination.page + 1,
      limit: conversationPagination.limit || CONVERSATION_PAGE_LIMIT,
    })
    if (requestId === conversationRequestId.current) {
      if (res.success) {
        setConversations((items) => mergeConversationPage(items, res.conversations || []))
        setConversationPagination(normalizePagination(res, CONVERSATION_PAGE_LIMIT))
      }
      loadingMoreConversationsRef.current = false
      setLoadingMoreConversations(false)
    }
    return res
  }, [conversationPagination, user])

  useEffect(() => {
    messageRequestId.current += 1
    conversationRequestId.current += 1
    activeConversationIdRef.current = ''
    setConversations([])
    setMessages([])
    setMessagePagination(emptyPagination(MESSAGE_PAGE_LIMIT))
    setConversationPagination(emptyPagination(CONVERSATION_PAGE_LIMIT))
    setActiveConversationId('')
    setLoadingMessages(false)
    setLoadingOlderMessages(false)
    setLoadingMoreConversations(false)
    loadingOlderMessagesRef.current = false
    loadingMoreConversationsRef.current = false
    if (user) refreshConversations()
  }, [refreshConversations, user?._id])

  const createNewConversation = useCallback(async () => {
    if (!user) return { success: false, code: 'AUTH_REQUIRED' }
    if (creatingConversationRef.current) return creatingConversationRef.current

    conversationRequestId.current += 1
    loadingMoreConversationsRef.current = false
    setLoadingMoreConversations(false)
    setCreatingConversation(true)
    const requestPromise = (async () => {
      const res = await createConversationRequest()
      if (!res.success) return res
      setLoadingConversations(false)
      setConversations((items) => [res.conversation, ...items])
      setConversationPagination((value) => {
        const total = value.total + 1
        const totalPages = Math.ceil(total / value.limit)
        return { ...value, total, totalPages, hasMore: value.page < totalPages }
      })
      rememberActive(res.conversation._id)
      messageRequestId.current += 1
      loadingOlderMessagesRef.current = false
      setLoadingOlderMessages(false)
      setLoadingMessages(false)
      setMessages([])
      setMessagePagination(emptyPagination(MESSAGE_PAGE_LIMIT))
      return res
    })()
    creatingConversationRef.current = requestPromise

    try {
      return await requestPromise
    } finally {
      if (creatingConversationRef.current === requestPromise) creatingConversationRef.current = null
      setCreatingConversation(false)
    }
  }, [rememberActive, user])

  const sendMessage = useCallback(
    async ({ message, tourId = '', pageContext = null, clientMessageId = '' }) => {
      const content = message.trim()
      if (!content || sending || !user) return { success: false }

      let conversationId = activeConversationIdRef.current
      if (creatingConversationRef.current) {
        const created = await creatingConversationRef.current
        if (!created.success) return created
        conversationId = created.conversation._id
      }
      if (!conversationId) {
        const created = await createNewConversation()
        if (!created.success) return created
        conversationId = created.conversation._id
      }

      const logicalTurnId = clientMessageId || globalThis.crypto?.randomUUID?.()
        || `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const transportRequestId = globalThis.crypto?.randomUUID?.()
        || `request-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const optimisticId = `local-${logicalTurnId}`
      setMessages((items) => items.some(
        (item) => item.clientMessageId === logicalTurnId && item.role === 'user'
      ) ? items : [
        ...items,
        {
          _id: optimisticId,
          clientMessageId: logicalTurnId,
          requestId: transportRequestId,
          conversationId,
          role: 'user',
          content,
          at: new Date().toISOString(),
        },
      ])
      setSending(true)
      const res = await sendChatMessage({
        message: content,
        tourId,
        conversationId,
        pageContext,
        clientMessageId: logicalTurnId,
        requestId: transportRequestId,
      })
      setSending(false)

      if (!res.success) {
        if (activeConversationIdRef.current === conversationId) {
          setMessages((items) => [
            ...items,
            {
              _id: `error-${Date.now()}`,
              conversationId,
              role: 'assistant',
              error: true,
              errorCode: res.code || 'REQUEST_ERROR',
              retryable: Boolean(res.retryable),
              errorSource: res.source || null,
              requestId: res.requestId || transportRequestId,
              content:
                res.code === 'AI_UNAVAILABLE'
                  ? res.message || 'Trợ lý AI đang tạm gián đoạn. Bạn thử lại sau ít phút nhé.'
                  : res.message || 'Không gửi được tin nhắn. Vui lòng thử lại.',
            },
          ])
        }
        return res
      }

      if (activeConversationIdRef.current === conversationId) {
        setMessages((items) => items.some(
          (item) => item.clientMessageId === logicalTurnId && item.role === 'assistant' && !item.error
        ) ? items : [
          ...items,
          {
            _id: `assistant-${Date.now()}`,
            clientMessageId: logicalTurnId,
            requestId: res.requestId || transportRequestId,
            conversationId,
            role: 'assistant',
            content: res.reply,
            suggestedTours: res.suggestedTours || [],
            candidateList: res.candidateList || null,
            structuredContent: res.structuredContent || null,
            contractVersion: res.contractVersion || null,
            outcome: res.outcome || null,
            serviceStatus: res.serviceStatus || null,
            warnings: res.warnings || [],
            at: new Date().toISOString(),
          },
        ])
      }
      if (res.conversation) {
        setConversations((items) => [
          res.conversation,
          ...items.filter((item) => item._id !== res.conversation._id),
        ])
      }
      return res
    },
    [createNewConversation, sending, user]
  )

  const activeConversation =
    conversations.find((conversation) => conversation._id === activeConversationId) || null

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeConversation,
        activeConversationId,
        messages,
        loadingConversations,
        loadingMessages,
        loadingOlderMessages,
        loadingMoreConversations,
        messagePagination,
        conversationPagination,
        sending,
        creatingConversation,
        refreshConversations,
        loadOlderMessages,
        loadMoreConversations,
        createNewConversation,
        selectConversation,
        sendMessage,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  return useContext(ChatContext)
}
