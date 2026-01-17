import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Box,
  TextField,
  IconButton,
  Typography,
  Paper,
  Collapse,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Fade,
  Grow,
  Modal,
  Backdrop,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider
} from '@mui/material';
import {
  Send,
  Close,
  ExpandMore,
  Code,
  TableChart,
  InsertChart,
  Description,
  Fullscreen,
  FullscreenExit,
  ArrowUpward,
  ArrowDownward,
  DeleteOutline,
  Add,
  History,
  ContentCopy,
  Download,
  ThumbUp,
  ThumbUpOutlined,
  ThumbDown,
  ThumbDownOutlined,
  OpenInFull,
  CloseFullscreen,
  DockOutlined,
  ViewSidebar,
  KeyboardArrowDown,
  KeyboardArrowUp,
  KeyboardArrowLeft,
  KeyboardArrowRight,
  PushPin,
  PushPinOutlined
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import FormattedMarkdown from './FormattedMarkdown';
import { LAYOUT } from './layoutConstants';
import { logger } from './utils/logger';
import { VegaEmbed } from 'react-vega';
import { Highlight, themes } from 'prism-react-renderer';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  table?: TableData;
  chart?: {
    tool_use_id?: string;
    spec: any; // Vega-Lite specification object
  };
  sqlQuery?: string;
  manualCitations?: Citation[];
  timestamp: Date;
  status?: 'streaming' | 'complete' | 'error';
  requestId?: string;
  feedback?: 'positive' | 'negative' | null;
  feedbackMessage?: string;
}

interface TableData {
  columns: string[];
  rows: any[][];
}

interface Citation {
  title: string;
  source: string;
}

interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
  fabPosition: { x: number; y: number };
  agentEndpoint?: string;
}

const SUGGESTED_PROMPTS = [
  "Compare summer load patterns 2023 vs 2024 vs 2025",
  "Show energy burden changes vs 2024 baseline by income classification",
  "Which transformers show increasing stress over the past 3 years?",
  "Find transformer oil sampling procedures for high-voltage equipment"
];

export default function ChatDrawer({ 
  open, 
  onClose,
  fabPosition,
  agentEndpoint = import.meta.env.DEV ? 'http://localhost:3001/api/agent/stream' : '/api/agent/stream' 
}: ChatDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [lastMessageId, setLastMessageId] = useState<number | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<Array<{id: string, name: string, timestamp: string, messageCount: number}>>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  
  // Layout modes: 'floating' | 'expanded' | 'docked-left' | 'docked-right' | 'docked-bottom'
  const [layoutMode, setLayoutMode] = useState<'floating' | 'expanded' | 'docked-left' | 'docked-right' | 'docked-bottom'>('floating');
  const [dockedCollapsed, setDockedCollapsed] = useState(false);
  
  // Smart scroll - only auto-scroll when user is near bottom
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const isLoadingSession = useRef(false);
  
  const isDraggingRef = useRef(false);
  const originPosition = useRef({ x: 0, y: 0 });
  const startPosition = useRef({ x: 0, y: 0 });
  const currentPosition = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  const velocityHistory = useRef<Array<{ x: number; y: number; time: number }>>([]);
  const momentumAnimationRef = useRef<number | null>(null);

  const SESSIONS_INDEX_KEY = 'grid_intelligence_sessions_index';
  const SESSION_PREFIX = 'grid_intelligence_session_';

  const loadSessionsIndex = () => {
    try {
      const index = localStorage.getItem(SESSIONS_INDEX_KEY);
      return index ? JSON.parse(index) : [];
    } catch {
      return [];
    }
  };

  const saveSessionsIndex = (sessions: typeof savedSessions) => {
    localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(sessions));
    setSavedSessions(sessions);
  };

  const generateSessionId = () => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const createInitialSession = () => {
    const newId = generateSessionId();
    const newSession = {
      id: newId,
      name: 'New Chat',
      timestamp: new Date().toISOString(),
      messageCount: 0
    };
    const sessions = [newSession];
    saveSessionsIndex(sessions);
    setCurrentSessionId(newId);
    logger.log('🆕 Created initial session:', newId);
    return newId;
  };

  useEffect(() => {
    const sessions = loadSessionsIndex();
    setSavedSessions(sessions);
    
    if (sessions.length > 0) {
      const mostRecent = sessions[0];
      loadSession(mostRecent.id);
    } else {
      createInitialSession();
    }
  }, []);

  useEffect(() => {
    if (isLoadingSession.current) return;
    if (!currentSessionId) return;
    
    try {
      const sessionData = {
        messages: messages.map(m => ({
          ...m,
          timestamp: m.timestamp.toISOString()
        })),
        threadId,
        lastMessageId
      };
      localStorage.setItem(SESSION_PREFIX + currentSessionId, JSON.stringify(sessionData));
      
      const sessions = loadSessionsIndex();
      const sessionIdx = sessions.findIndex((s: any) => s.id === currentSessionId);
      if (sessionIdx >= 0) {
        sessions[sessionIdx].messageCount = messages.length;
        sessions[sessionIdx].timestamp = new Date().toISOString();
        if (messages.length > 0 && sessions[sessionIdx].name === 'New Chat') {
          const firstMsg = messages[0]?.content || '';
          sessions[sessionIdx].name = firstMsg.substring(0, 40) + (firstMsg.length > 40 ? '...' : '');
        }
        saveSessionsIndex(sessions);
      }
    } catch (e) {
      logger.warn('Failed to save session:', e);
    }
  }, [messages, threadId, lastMessageId, currentSessionId]);

  const loadSession = (sessionId: string) => {
    isLoadingSession.current = true;
    try {
      const data = localStorage.getItem(SESSION_PREFIX + sessionId);
      logger.log('📂 Loading session:', sessionId, 'raw data length:', data?.length ?? 0);
      if (data) {
        const session = JSON.parse(data);
        const restoredMessages = session.messages?.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })) || [];
        setMessages(restoredMessages);
        setThreadId(session.threadId || null);
        setLastMessageId(session.lastMessageId || null);
        setCurrentSessionId(sessionId);
        setShowWelcome(restoredMessages.length === 0);
        logger.log('📂 Loaded session:', sessionId, restoredMessages.length, 'messages', 'table in first msg:', !!restoredMessages[1]?.table);
      } else {
        logger.log('⚠️ No data found for session:', sessionId, '- creating empty session state');
        setMessages([]);
        setThreadId(null);
        setLastMessageId(null);
        setCurrentSessionId(sessionId);
        setShowWelcome(true);
      }
    } catch (e) {
      logger.warn('Failed to load session:', e);
      setMessages([]);
      setCurrentSessionId(sessionId);
      setShowWelcome(true);
    }
    setShowSessionList(false);
    setTimeout(() => { isLoadingSession.current = false; }, 100);
  };

  const startNewSession = () => {
    isLoadingSession.current = true;
    
    if (currentSessionId && messages.length > 0) {
      try {
        const sessionData = {
          messages: messages.map(m => ({
            ...m,
            timestamp: m.timestamp.toISOString()
          })),
          threadId,
          lastMessageId
        };
        localStorage.setItem(SESSION_PREFIX + currentSessionId, JSON.stringify(sessionData));
        
        const sessions = loadSessionsIndex();
        const sessionIdx = sessions.findIndex((s: any) => s.id === currentSessionId);
        if (sessionIdx >= 0) {
          sessions[sessionIdx].messageCount = messages.length;
          const firstMsg = messages[0]?.content || '';
          sessions[sessionIdx].name = firstMsg.substring(0, 40) + (firstMsg.length > 40 ? '...' : '') || 'Chat';
          sessions[sessionIdx].timestamp = new Date().toISOString();
          saveSessionsIndex(sessions);
        }
        logger.log('💾 Saved current session before creating new one');
      } catch (e) {
        logger.warn('Failed to save current session:', e);
      }
    }

    const newId = generateSessionId();
    const sessions = loadSessionsIndex();
    const newSession = {
      id: newId,
      name: 'New Chat',
      timestamp: new Date().toISOString(),
      messageCount: 0
    };
    
    const updatedSessions = [newSession, ...sessions];
    saveSessionsIndex(updatedSessions);
    
    setMessages([]);
    setThreadId(null);
    setLastMessageId(null);
    setCurrentSessionId(newId);
    setShowWelcome(true);
    setShowSessionList(false);
    logger.log('🆕 Started new session:', newId);
    setTimeout(() => { isLoadingSession.current = false; }, 100);
  };

  const deleteSession = (sessionId: string) => {
    localStorage.removeItem(SESSION_PREFIX + sessionId);
    const sessions = loadSessionsIndex().filter((s: any) => s.id !== sessionId);
    saveSessionsIndex(sessions);
    
    if (sessionId === currentSessionId) {
      if (sessions.length > 0) {
        loadSession(sessions[0].id);
      } else {
        startNewSession();
      }
    }
  };

  // Smart scroll: only scroll to bottom if user hasn't scrolled up
  const scrollToBottom = (force = false) => {
    if (force || !userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Track user scroll position to detect manual scroll-up
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // If user scrolls more than 100px from bottom, they're reading history
    // If they scroll back within 50px, re-enable auto-scroll
    if (distanceFromBottom > 100) {
      setUserScrolledUp(true);
    } else if (distanceFromBottom < 50) {
      setUserScrolledUp(false);
    }
  };

  useEffect(() => {
    // Only auto-scroll if user hasn't manually scrolled up
    if (!userScrolledUp) {
      scrollToBottom();
    }
  }, [messages, streaming, userScrolledUp]);

  // Reset userScrolledUp when starting new message
  useEffect(() => {
    if (streaming) {
      // When streaming starts from user input, auto-scroll is expected
      setUserScrolledUp(false);
    }
  }, [streaming]);

  useEffect(() => {
    if (open && messages.length === 0) {
      setShowWelcome(true);
    } else {
      setShowWelcome(false);
    }
  }, [open, messages.length]);

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const updateLastMessage = (messages: Message[], updates: Partial<Message>) => {
    const newMessages = [...messages];
    if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
      const existing = newMessages[newMessages.length - 1];
      newMessages[newMessages.length - 1] = {
        ...existing,
        ...updates,
        table: updates.table ?? existing.table,
        chart: updates.chart ?? existing.chart,
        sqlQuery: updates.sqlQuery ?? existing.sqlQuery,
        thinking: updates.thinking ?? existing.thinking,
        requestId: updates.requestId ?? existing.requestId
      };
    } else {
      newMessages.push(updates as Message);
    }
    return newMessages;
  };

  const handleSend = async (customQuery?: string) => {
    const queryText = customQuery || inputValue;
    if (!queryText.trim() || streaming) return;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: queryText,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setStreaming(true);
    setShowWelcome(false);

    let currentMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      status: 'streaming'
    };

    setMessages(prev => [...prev, currentMessage]);

    try {
      // Create thread if this is the first message
      let currentThreadId = threadId;
      if (currentThreadId === null) {
        logger.log('🧵 Creating new thread for conversation...');
        try {
          const threadResponse = await fetch(
            import.meta.env.DEV ? 'http://localhost:3001/api/agent/threads/create' : '/api/agent/threads/create',
            {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (threadResponse.ok) {
            const { thread_id } = await threadResponse.json();
            logger.log(`✅ Thread created: ${thread_id}`);
            currentThreadId = thread_id;
            setThreadId(thread_id);
          } else {
            logger.warn('⚠️ Thread creation failed, continuing without explicit thread');
          }
        } catch (threadError) {
          logger.warn('⚠️ Thread creation failed:', threadError);
        }
      }

      // Log thread context for debugging
      logger.log('🚀 Sending agent request:', {
        thread_id: currentThreadId,
        parent_message_id: lastMessageId || 0,
        has_thread: currentThreadId !== null,
        is_continuation: lastMessageId !== null,
        query: queryText.substring(0, 60) + '...'
      });
      
      logger.log(`📊 Current state BEFORE request: threadId=${threadId}, lastMessageId=${lastMessageId}, currentThreadId=${currentThreadId}`);
      
      logger.log(`🔗 Fetching from: ${agentEndpoint}`);
      const response = await fetch(agentEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          query: queryText,
          thread_id: currentThreadId || undefined,
          parent_message_id: lastMessageId || 0
        })
      });

      logger.log(`📡 Response status: ${response.status}, headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('❌ Agent API error:', errorBody);
        throw new Error(`Agent API returned status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      logger.log('📖 Got reader, starting stream...');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent: { event?: string; data?: string } = {};

      let chunkCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          logger.log(`✅ Stream complete. Total chunks: ${chunkCount}`);
          break;
        }

        chunkCount++;
        const decoded = decoder.decode(value, { stream: true });
        logger.log(`📦 Chunk ${chunkCount}:`, decoded.substring(0, 200));
        buffer += decoded;
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent.event = line.substring(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = line.substring(6);

            if (currentEvent.event && currentEvent.data) {
              try {
                // Skip empty data
                const trimmedData = currentEvent.data.trim();
                if (!trimmedData) {
                  currentEvent = {};
                  continue;
                }
                
                // Try to parse JSON
                let data;
                try {
                  data = JSON.parse(currentEvent.data);
                } catch (parseError) {
                  // Log parse errors for debugging but continue
                  logger.warn('Skipping invalid SSE JSON:', currentEvent.data.substring(0, 100));
                  currentEvent = {};
                  continue;
                }

                switch (currentEvent.event) {
                  case 'response.text.delta':
                    logger.log('📝 Text delta:', data.text?.substring(0, 50));
                    currentMessage.content += data.text || '';
                    setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    break;

                  case 'response.thinking.delta':
                    logger.log('🤔 Thinking delta:', data.text?.substring(0, 50));
                    currentMessage.thinking = (currentMessage.thinking || '') + (data.text || '');
                    setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    break;

                  case 'response.table':
                    logger.log('📋 Table event received:', JSON.stringify(data).substring(0, 500));
                    currentMessage.table = {
                      columns: data.columns || [],
                      rows: data.rows || []
                    };
                    setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    break;

                  case 'response.chart':
                    // Parse chart_spec (it's a JSON string per Cortex Agent API docs)
                    try {
                      const chartSpec = typeof data.chart_spec === 'string' 
                        ? JSON.parse(data.chart_spec) 
                        : data.chart_spec;
                      currentMessage.chart = {
                        tool_use_id: data.tool_use_id,
                        spec: chartSpec
                      };
                      logger.log('📊 Chart received:', {
                        tool_use_id: data.tool_use_id,
                        hasSpec: !!chartSpec,
                        specPreview: JSON.stringify(chartSpec).substring(0, 100)
                      });
                      setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    } catch (e) {
                      logger.error('❌ Failed to parse chart_spec:', e, data);
                    }
                    break;

                  case 'response.tool_result':
                    logger.log('🔧 Tool result received:', JSON.stringify(data).substring(0, 500));
                    if (data.content) {
                      const toolContent = Array.isArray(data.content) ? data.content : [data.content];
                      for (const item of toolContent) {
                        logger.log('  📦 Tool content item:', item.type, JSON.stringify(item).substring(0, 300));
                        
                        if (item.type === 'json' && item.json) {
                          const jsonData = item.json;
                          
                          // Extract SQL from json.sql (Cortex Analyst format)
                          if (jsonData.sql) {
                            currentMessage.sqlQuery = jsonData.sql;
                            logger.log('  ✅ Found SQL in json.sql');
                          }
                          
                          // Extract table data from result_set (Cortex Analyst SQL execution results)
                          if (jsonData.result_set?.data && Array.isArray(jsonData.result_set.data) && jsonData.result_set.data.length > 0) {
                            // Get column names from resultSetMetaData.rowType
                            const rowType = jsonData.result_set.resultSetMetaData?.rowType || [];
                            const columns = rowType.map((col: any) => col.name || `Column ${rowType.indexOf(col)}`);
                            
                            // Data is already in array of arrays format
                            const rows = jsonData.result_set.data;
                            
                            if (columns.length > 0) {
                              currentMessage.table = { columns, rows };
                              logger.log('  ✅ Found table in result_set:', columns.length, 'columns,', rows.length, 'rows');
                            }
                          }
                          
                          // Fallback: Check for results array (alternative format)
                          if (!currentMessage.table && jsonData.results && Array.isArray(jsonData.results) && jsonData.results.length > 0) {
                            const firstRow = jsonData.results[0];
                            const columns = Object.keys(firstRow);
                            const rows = jsonData.results.map((r: any) => columns.map(c => r[c]));
                            currentMessage.table = { columns, rows };
                            logger.log('  ✅ Found table in json.results:', columns.length, 'columns,', rows.length, 'rows');
                          }
                          
                          // Fallback: Check for data array (alternative format)
                          if (!currentMessage.table && jsonData.data && Array.isArray(jsonData.data) && jsonData.data.length > 0) {
                            const firstRow = jsonData.data[0];
                            if (typeof firstRow === 'object' && !Array.isArray(firstRow)) {
                              const columns = Object.keys(firstRow);
                              const rows = jsonData.data.map((r: any) => columns.map(c => r[c]));
                              currentMessage.table = { columns, rows };
                              logger.log('  ✅ Found table in json.data (object format):', columns.length, 'columns,', rows.length, 'rows');
                            }
                          }
                        }
                        
                        // Also check for SQL directly on item (legacy format)
                        if (item.type === 'text' && item.sql) {
                          currentMessage.sqlQuery = item.sql;
                          logger.log('  ✅ Found SQL in item.sql');
                        }
                        
                        setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                      }
                    }
                    break;

                  case 'request_id':
                    if (data.request_id) {
                      currentMessage.requestId = data.request_id;
                      logger.log(`📝 Captured request_id from header: ${data.request_id}`);
                      setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    }
                    break;

                  case 'response':
                    if (data.thread_id) setThreadId(data.thread_id);
                    if (data.message_id) setLastMessageId(data.message_id);
                    currentMessage.status = 'complete';
                    setMessages(prev => updateLastMessage(prev, { status: 'complete' }));
                    break;
                    
                  case 'metadata':
                    // CRITICAL: Capture message IDs and request_id for thread continuity and feedback
                    logger.log(`📋 Metadata event:`, data);
                    
                    const metadata = data.metadata || data;
                    
                    // Capture request_id from metadata (per Cortex Agent API)
                    if (data.request_id) {
                      currentMessage.requestId = data.request_id;
                      logger.log(`📝 Captured request_id from metadata: ${data.request_id}`);
                    }
                    
                    if (metadata.role === 'user' && metadata.message_id) {
                      logger.log(`👤 User message ID: ${metadata.message_id}`);
                    }
                    
                    if (metadata.role === 'assistant' && metadata.message_id) {
                      logger.log(`🤖 Assistant message ID: ${metadata.message_id} - Setting as parent for next turn`);
                      setLastMessageId(metadata.message_id);
                    }
                    
                    // Note: metadata event doesn't contain thread_id per Snowflake docs
                    if (metadata.thread_id) {
                      logger.log(`⚠️ Unexpected thread_id in metadata: ${metadata.thread_id}`);
                      if (!threadId) {
                        setThreadId(metadata.thread_id);
                      }
                    }
                    break;
                    
                  default:
                    // Log unknown events for debugging
                    if (currentEvent.event && !currentEvent.event.startsWith('response.status')) {
                      logger.log(`❓ Unknown event type: ${currentEvent.event}`, JSON.stringify(data).substring(0, 200));
                    }
                }
              } catch (e) {
                // Silently skip - some SSE events don't need error logging
              }

              currentEvent = {};
            }
          }
        }
      }
    } catch (error) {
      logger.error('Agent streaming error:', error);
      currentMessage.status = 'error';
      currentMessage.content = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
    } finally {
      setStreaming(false);
    }
  };

  const handleFeedbackSubmit = async (requestId: string, positive: boolean, feedbackMessage?: string) => {
    try {
      const feedbackEndpoint = import.meta.env.DEV 
        ? 'http://localhost:3001/api/agent/feedback' 
        : '/api/agent/feedback';
      
      const payload: any = {
        request_id: requestId,
        positive,
        thread_id: threadId || undefined
      };
      
      if (feedbackMessage) {
        payload.feedback_message = feedbackMessage;
      }
      
      const response = await fetch(feedbackEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        logger.log(`✅ Feedback submitted: ${positive ? 'positive' : 'negative'} for request ${requestId}${feedbackMessage ? ' with message' : ''}`);
        setMessages(prev => prev.map(m => 
          m.requestId === requestId ? { ...m, feedback: positive ? 'positive' : 'negative', feedbackMessage } : m
        ));
        return true;
      } else {
        logger.error(`❌ Feedback submission failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      logger.error('❌ Feedback submission error:', error);
      return false;
    }
  };

  const handlePromptClick = (prompt: string) => {
    handleSend(prompt);
  };

  const calculatePosition = () => {
    return {
      x: originPosition.current.x + currentPosition.current.x - startPosition.current.x,
      y: originPosition.current.y + currentPosition.current.y - startPosition.current.y
    };
  };

  const updatePosition = () => {
    const pos = calculatePosition();
    if (paperRef.current) {
      paperRef.current.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    }
    rafId.current = null;
  };

  const requestUpdate = () => {
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(updatePosition);
    }
  };

  useEffect(() => {
    const header = headerRef.current;
    if (!header || !open) return;

    const handlePointerDown = (e: PointerEvent) => {
      if (!e.isPrimary || isDraggingRef.current) return;
      
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('[role="button"]')) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
        momentumAnimationRef.current = null;
      }
      
      isDraggingRef.current = true;
      velocityHistory.current = [];
      
      if (paperRef.current) {
        paperRef.current.style.willChange = 'transform';
        paperRef.current.style.backdropFilter = 'none';
        paperRef.current.style.webkitBackdropFilter = 'none';
      }
      
      startPosition.current = { x: e.clientX, y: e.clientY };
      currentPosition.current = { x: e.clientX, y: e.clientY };
      
      header.setPointerCapture(e.pointerId);
      document.addEventListener('pointermove', handlePointerMove, { passive: true });
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!e.isPrimary || !isDraggingRef.current) return;
      
      currentPosition.current = { x: e.clientX, y: e.clientY };
      
      const pos = calculatePosition();
      
      const minX = -(window.innerWidth - chatWidth - constrainedRight);
      const maxX = constrainedRight;
      const minY = -(window.innerHeight - chatHeight - constrainedBottom);
      const maxY = constrainedBottom;
      
      const clampedX = Math.max(minX, Math.min(maxX, pos.x));
      const clampedY = Math.max(minY, Math.min(maxY, pos.y));
      
      originPosition.current = { x: clampedX, y: clampedY };
      startPosition.current = currentPosition.current;
      
      velocityHistory.current.push({
        x: clampedX,
        y: clampedY,
        time: Date.now()
      });
      
      if (velocityHistory.current.length > 5) {
        velocityHistory.current.shift();
      }
      
      requestUpdate();
    };

    const cleanup = (e: PointerEvent) => {
      if (!e.isPrimary || !isDraggingRef.current) return;
      
      isDraggingRef.current = false;
      
      if (paperRef.current) {
        paperRef.current.style.willChange = 'auto';
        paperRef.current.style.backdropFilter = 'blur(20px) saturate(180%)';
        paperRef.current.style.webkitBackdropFilter = 'blur(20px) saturate(180%)';
      }
      
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      
      const finalPos = calculatePosition();
      originPosition.current = finalPos;
      
      let velocityX = 0;
      let velocityY = 0;
      
      if (velocityHistory.current.length >= 2) {
        const recent = velocityHistory.current[velocityHistory.current.length - 1];
        const previous = velocityHistory.current[0];
        const timeDelta = recent.time - previous.time;
        
        if (timeDelta > 0) {
          velocityX = (recent.x - previous.x) / timeDelta * 16;
          velocityY = (recent.y - previous.y) / timeDelta * 16;
        }
      }
      
      const friction = 0.94;
      const minVelocity = 0.3;
      let lastTimestamp = performance.now();
      
      const applyMomentum = (timestamp: number) => {
        const deltaTime = Math.min((timestamp - lastTimestamp) / 16.667, 2);
        lastTimestamp = timestamp;
        
        const frictionFactor = Math.pow(friction, deltaTime);
        velocityX *= frictionFactor;
        velocityY *= frictionFactor;
        
        if (Math.abs(velocityX) < minVelocity && Math.abs(velocityY) < minVelocity) {
          momentumAnimationRef.current = null;
          return;
        }
        
        const deltaX = (velocityX / 60) * deltaTime;
        const deltaY = (velocityY / 60) * deltaTime;
        
        let newX = originPosition.current.x + deltaX;
        let newY = originPosition.current.y + deltaY;
        
        const minX = -(window.innerWidth - chatWidth - constrainedRight);
        const maxX = constrainedRight;
        const minY = -(window.innerHeight - chatHeight - constrainedBottom);
        const maxY = constrainedBottom;
        
        if (newX < minX || newX > maxX) {
          newX = Math.max(minX, Math.min(maxX, newX));
          velocityX = 0;
        }
        
        if (newY < minY || newY > maxY) {
          newY = Math.max(minY, Math.min(maxY, newY));
          velocityY = 0;
        }
        
        originPosition.current = { x: newX, y: newY };
        
        if (paperRef.current) {
          paperRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        }
        
        if (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1) {
          momentumAnimationRef.current = requestAnimationFrame(applyMomentum);
        } else {
          momentumAnimationRef.current = null;
        }
      };
      
      if (Math.abs(velocityX) > 0.5 || Math.abs(velocityY) > 0.5) {
        momentumAnimationRef.current = requestAnimationFrame(applyMomentum);
      }
      
      document.removeEventListener('pointermove', handlePointerMove);
    };

    const releasePointer = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      header.releasePointerCapture(e.pointerId);
    };

    header.addEventListener('pointerdown', handlePointerDown);
    header.addEventListener('pointerup', releasePointer);
    header.addEventListener('pointercancel', releasePointer);
    header.addEventListener('lostpointercapture', cleanup);

    return () => {
      header.removeEventListener('pointerdown', handlePointerDown);
      header.removeEventListener('pointerup', releasePointer);
      header.removeEventListener('pointercancel', releasePointer);
      header.removeEventListener('lostpointercapture', cleanup);
      document.removeEventListener('pointermove', handlePointerMove);
      
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
      if (momentumAnimationRef.current) {
        cancelAnimationFrame(momentumAnimationRef.current);
      }
    };
  }, [open]);

  if (!open) return null;

  const chatWidth = 480;
  const chatHeight = 600;
  const fabSize = 56;
  const chatOffset = 68;

  // Layout dimensions based on mode - uses shared constants from layoutConstants.ts
  const getLayoutStyles = () => {
    switch (layoutMode) {
      case 'expanded':
        return {
          position: 'fixed' as const,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: 'auto',
          height: 'auto',
          borderRadius: 0,
          transform: 'none',
        };
      case 'docked-left':
        return {
          position: 'fixed' as const,
          top: LAYOUT.DOCK_TOP_OFFSET_LEFT,
          left: dockedCollapsed ? -400 : 0,
          bottom: LAYOUT.DOCK_BOTTOM_OFFSET,
          width: 400,
          height: 'auto',
          borderRadius: 0,
          borderRight: '1px solid rgba(51, 65, 85, 0.8)',
          transform: 'none',
          transition: 'left 0.3s ease',
        };
      case 'docked-right':
        return {
          position: 'fixed' as const,
          top: LAYOUT.DOCK_TOP_OFFSET_RIGHT,
          right: dockedCollapsed ? -400 : 0,
          bottom: 0,
          width: 400,
          height: 'auto',
          borderRadius: 0,
          borderLeft: '1px solid rgba(51, 65, 85, 0.8)',
          transform: 'none',
          transition: 'right 0.3s ease',
        };
      case 'docked-bottom':
        return {
          position: 'fixed' as const,
          left: LAYOUT.DOCK_LEFT_OFFSET,
          right: 0,
          bottom: dockedCollapsed ? -320 : 0,
          height: 320,
          width: 'auto',
          borderRadius: 0,
          borderTop: '1px solid rgba(51, 65, 85, 0.8)',
          transform: 'none',
          transition: 'bottom 0.3s ease',
        };
      default: // floating
        const bottomPosition = window.innerHeight - fabPosition.y - fabSize;
        const rightPosition = window.innerWidth - fabPosition.x - fabSize;
        const constrainedBottom = Math.max(chatOffset, Math.min(bottomPosition + chatOffset, window.innerHeight - chatHeight));
        const constrainedRight = Math.max(0, Math.min(rightPosition, window.innerWidth - chatWidth));
        return {
          position: 'fixed' as const,
          bottom: constrainedBottom,
          right: constrainedRight,
          width: chatWidth,
          height: chatHeight,
          borderRadius: '16px',
          transform: 'translate3d(0, 0, 0)',
        };
    }
  };

  const layoutStyles = getLayoutStyles();

  // Dock toggle button for collapsed docked modes
  const renderDockToggle = () => {
    if (layoutMode === 'docked-left' && dockedCollapsed) {
      return (
        <Box
          onClick={() => setDockedCollapsed(false)}
          sx={{
            position: 'fixed',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(15, 23, 42, 0.95)',
            borderTopRightRadius: 8,
            borderBottomRightRadius: 8,
            p: 0.5,
            cursor: 'pointer',
            zIndex: 1300,
            border: '1px solid rgba(51, 65, 85, 0.5)',
            borderLeft: 'none',
            '&:hover': { bgcolor: 'rgba(14, 165, 233, 0.2)' },
          }}
        >
          <KeyboardArrowRight sx={{ color: '#0EA5E9' }} />
        </Box>
      );
    }
    if (layoutMode === 'docked-right' && dockedCollapsed) {
      return (
        <Box
          onClick={() => setDockedCollapsed(false)}
          sx={{
            position: 'fixed',
            right: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            bgcolor: 'rgba(15, 23, 42, 0.95)',
            borderTopLeftRadius: 8,
            borderBottomLeftRadius: 8,
            p: 0.5,
            cursor: 'pointer',
            zIndex: 1300,
            border: '1px solid rgba(51, 65, 85, 0.5)',
            borderRight: 'none',
            '&:hover': { bgcolor: 'rgba(14, 165, 233, 0.2)' },
          }}
        >
          <KeyboardArrowLeft sx={{ color: '#0EA5E9' }} />
        </Box>
      );
    }
    if (layoutMode === 'docked-bottom' && dockedCollapsed) {
      return (
        <Box
          onClick={() => setDockedCollapsed(false)}
          sx={{
            position: 'fixed',
            bottom: 0,
            right: 200, // Offset from right edge
            bgcolor: 'rgba(15, 23, 42, 0.95)',
            borderTopLeftRadius: 8,
            borderTopRightRadius: 8,
            px: 2,
            py: 0.5,
            cursor: 'pointer',
            zIndex: 1300,
            border: '1px solid rgba(51, 65, 85, 0.5)',
            borderBottom: 'none',
            '&:hover': { bgcolor: 'rgba(14, 165, 233, 0.2)' },
          }}
        >
          <KeyboardArrowUp sx={{ color: '#0EA5E9' }} />
        </Box>
      );
    }
    return null;
  };

  // Scroll to bottom button when user has scrolled up - positioned above input box
  const renderScrollToBottomButton = () => {
    if (!userScrolledUp || messages.length === 0) return null;
    return (
      <Box
        onClick={() => {
          setUserScrolledUp(false);
          scrollToBottom(true);
        }}
        sx={{
          position: 'absolute',
          bottom: 70, // Position above the input box
          left: '50%',
          transform: 'translateX(-50%)',
          bgcolor: 'rgba(14, 165, 233, 0.95)',
          borderRadius: '16px',
          px: 1.5,
          py: 0.5,
          cursor: 'pointer',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          boxShadow: '0 2px 12px rgba(14, 165, 233, 0.4)',
          border: '1px solid rgba(14, 165, 233, 0.5)',
          '&:hover': { 
            bgcolor: '#0EA5E9',
            transform: 'translateX(-50%) scale(1.02)',
          },
          transition: 'all 0.2s ease',
        }}
      >
        <KeyboardArrowDown sx={{ fontSize: 16, color: 'white' }} />
        <Typography sx={{ fontSize: '11px', color: 'white', fontWeight: 500 }}>
          New messages
        </Typography>
      </Box>
    );
  };

  // Chat appears to the LEFT and ABOVE the FAB
  // Calculate position ensuring chat stays within viewport
  const bottomPosition = window.innerHeight - fabPosition.y - fabSize;
  const rightPosition = window.innerWidth - fabPosition.x - fabSize;
  
  // Ensure chat doesn't overflow viewport edges
  const constrainedBottom = Math.max(chatOffset, Math.min(bottomPosition + chatOffset, window.innerHeight - chatHeight));
  const constrainedRight = Math.max(0, Math.min(rightPosition, window.innerWidth - chatWidth));

  return createPortal(
    <>
      {renderDockToggle()}
      <Grow in={open} timeout={300}>
        <Paper
          ref={paperRef}
          elevation={8}
          sx={{
            ...layoutStyles,
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            overflow: 'hidden',
            zIndex: 1299,
            boxShadow: layoutMode === 'floating' 
              ? '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(14, 165, 233, 0.2), 0 0 40px rgba(14, 165, 233, 0.1)'
              : '0 0 20px rgba(0, 0, 0, 0.5)',
            border: layoutMode === 'floating' ? '1px solid rgba(51, 65, 85, 0.5)' : 'none',
            cursor: 'default',
          }}
        >
        <Box
          ref={headerRef}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: layoutMode === 'docked-bottom' ? 1.5 : 2,
            borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
            bgcolor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(10px)',
            color: '#0EA5E9',
            cursor: layoutMode === 'floating' ? 'grab' : 'default',
            userSelect: 'none',
            touchAction: 'none',
            flexDirection: 'row',
            flexShrink: 0,
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '18px', pointerEvents: 'none' }}>
            Grid Intelligence Assistant
          </Typography>
          <Box sx={{ 
            display: 'flex', 
            gap: 0.5, 
            flexDirection: 'row',
            alignItems: 'center' 
          }}>
            <Tooltip title="New Chat">
              <IconButton 
                onClick={(e) => {
                  e.stopPropagation();
                  startNewSession();
                }} 
                onPointerDown={(e) => e.stopPropagation()}
                size="small" 
                sx={{ color: '#10B981', pointerEvents: 'auto', zIndex: 1, '&:hover': { color: '#34d399' } }}
              >
                <Add />
              </IconButton>
            </Tooltip>
            {savedSessions.length > 0 && (
              <Tooltip title="Chat History">
                <IconButton 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSessionList(!showSessionList);
                  }} 
                  onPointerDown={(e) => e.stopPropagation()}
                  size="small" 
                  sx={{ color: '#0EA5E9', pointerEvents: 'auto', zIndex: 1, '&:hover': { color: '#38bdf8' } }}
                >
                  <History />
                </IconButton>
              </Tooltip>
            )}
            {messages.length > 0 && currentSessionId && (
              <Tooltip title="Delete Current Chat">
                <IconButton 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Delete this chat? This cannot be undone.')) {
                      deleteSession(currentSessionId);
                    }
                  }} 
                  onPointerDown={(e) => e.stopPropagation()}
                  size="small" 
                  sx={{ color: '#94a3b8', pointerEvents: 'auto', zIndex: 1, '&:hover': { color: '#f87171' } }}
                >
                  <DeleteOutline />
                </IconButton>
              </Tooltip>
            )}
            
            <Box sx={{ width: '1px', height: 16, bgcolor: 'rgba(51, 65, 85, 0.5)', mx: 0.5 }} />
            
            {/* Layout controls */}
            <Tooltip title={layoutMode === 'expanded' ? "Exit fullscreen" : "Expand fullscreen"}>
              <IconButton 
                onClick={(e) => {
                  e.stopPropagation();
                  setLayoutMode(layoutMode === 'expanded' ? 'floating' : 'expanded');
                  setDockedCollapsed(false);
                }} 
                onPointerDown={(e) => e.stopPropagation()}
                size="small" 
                sx={{ 
                  color: layoutMode === 'expanded' ? '#0EA5E9' : '#64748b', 
                  pointerEvents: 'auto', 
                  zIndex: 1, 
                  '&:hover': { color: '#0EA5E9' } 
                }}
              >
                {layoutMode === 'expanded' ? <CloseFullscreen sx={{ fontSize: 18 }} /> : <OpenInFull sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Dock menu">
              <IconButton 
                onClick={(e) => {
                  e.stopPropagation();
                  // Cycle through dock positions: floating -> left -> right -> bottom -> floating
                  const modes: Array<typeof layoutMode> = ['floating', 'docked-left', 'docked-right', 'docked-bottom'];
                  const currentIdx = modes.indexOf(layoutMode);
                  const nextIdx = (currentIdx + 1) % modes.length;
                  setLayoutMode(modes[nextIdx]);
                  setDockedCollapsed(false);
                }} 
                onPointerDown={(e) => e.stopPropagation()}
                size="small" 
                sx={{ 
                  color: layoutMode.startsWith('docked') ? '#0EA5E9' : '#64748b', 
                  pointerEvents: 'auto', 
                  zIndex: 1, 
                  '&:hover': { color: '#0EA5E9' } 
                }}
              >
                <ViewSidebar sx={{ 
                  fontSize: 18,
                  transform: layoutMode === 'docked-left' ? 'scaleX(-1)' : 
                             layoutMode === 'docked-bottom' ? 'rotate(-90deg)' : 'none'
                }} />
              </IconButton>
            </Tooltip>
            
            {layoutMode.startsWith('docked') && (
              <Tooltip title={dockedCollapsed ? "Expand panel" : "Collapse panel"}>
                <IconButton 
                  onClick={(e) => {
                    e.stopPropagation();
                    setDockedCollapsed(!dockedCollapsed);
                  }} 
                  onPointerDown={(e) => e.stopPropagation()}
                  size="small" 
                  sx={{ color: '#64748b', pointerEvents: 'auto', zIndex: 1, '&:hover': { color: '#0EA5E9' } }}
                >
                  {dockedCollapsed ? <PushPinOutlined sx={{ fontSize: 18 }} /> : <PushPin sx={{ fontSize: 18 }} />}
                </IconButton>
              </Tooltip>
            )}
            
            <IconButton 
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }} 
              onPointerDown={(e) => e.stopPropagation()}
              size="small" 
              sx={{ color: 'white', pointerEvents: 'auto', zIndex: 1 }}
            >
              <Close />
            </IconButton>
          </Box>
        </Box>

        {showSessionList && savedSessions.length > 0 && (
          <Box sx={{ 
            p: 1, 
            borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
            bgcolor: 'rgba(15, 23, 42, 0.8)',
            maxHeight: 200,
            overflowY: 'auto'
          }}>
            <Typography sx={{ fontSize: '11px', color: '#64748b', mb: 1, px: 1 }}>
              Recent Conversations ({savedSessions.length})
            </Typography>
            {savedSessions.map((session) => (
              <Box
                key={session.id}
                onClick={() => loadSession(session.id)}
                sx={{
                  p: 1,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  bgcolor: session.id === currentSessionId ? 'rgba(14, 165, 233, 0.2)' : 'transparent',
                  border: session.id === currentSessionId ? '1px solid rgba(14, 165, 233, 0.3)' : '1px solid transparent',
                  '&:hover': { bgcolor: 'rgba(14, 165, 233, 0.1)' },
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 0.5
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: '12px', color: '#e2e8f0' }}>
                    {session.name}
                  </Typography>
                  <Typography sx={{ fontSize: '10px', color: '#64748b' }}>
                    {session.messageCount} messages • {new Date(session.timestamp).toLocaleDateString()}
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Delete this conversation?')) {
                      deleteSession(session.id);
                    }
                  }}
                  sx={{ color: '#64748b', '&:hover': { color: '#f87171' } }}
                >
                  <DeleteOutline sx={{ fontSize: '16px' }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        )}

        {/* Main content wrapper for scroll area + input */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
          <Box
            ref={scrollContainerRef}
            onScroll={handleScroll}
            sx={{
              flex: 1,
              overflowY: 'auto',
              p: 2,
              bgcolor: 'transparent',
            }}
          >
            {showWelcome && (
            <Fade in={showWelcome} timeout={500}>
              <Box sx={{ mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 1, color: '#0EA5E9', fontWeight: 600 }}>
                  👋 Welcome to Grid Intelligence
                </Typography>
                <Typography variant="body2" sx={{ mb: 2, color: '#94a3b8', lineHeight: 1.6 }}>
                  I can help you analyze grid operations, energy burden patterns, and equipment performance using available data.
                </Typography>
                <Typography variant="body2" sx={{ mb: 2, color: '#64748b', fontSize: '13px' }}>
                  💡 Try these questions:
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {SUGGESTED_PROMPTS.map((prompt, idx) => (
                    <Chip
                      key={idx}
                      label={prompt}
                      onClick={() => handlePromptClick(prompt)}
                      sx={{
                        bgcolor: 'rgba(30, 41, 59, 0.6)',
                        backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(14, 165, 233, 0.5)',
                        color: '#0EA5E9',
                        fontSize: '13px',
                        height: 'auto',
                        py: 1,
                        px: 1.5,
                        '& .MuiChip-label': {
                          whiteSpace: 'normal',
                          textAlign: 'left',
                        },
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          bgcolor: 'rgba(14, 165, 233, 0.2)',
                          borderColor: '#0EA5E9',
                          transform: 'translateX(4px)',
                          boxShadow: '0 4px 12px rgba(14, 165, 233, 0.2)',
                        },
                      }}
                    />
                  ))}
                </Box>
              </Box>
            </Fade>
          )}

          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onFeedback={handleFeedbackSubmit} />
          ))}
          
          {streaming && (
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1.5, 
              mb: 2,
              p: 1.5,
              bgcolor: 'rgba(30, 41, 59, 0.6)',
              backdropFilter: 'blur(10px)',
              borderRadius: '8px',
              border: '1px solid rgba(51, 65, 85, 0.5)'
            }}>
              <CircularProgress size={18} sx={{ color: '#0EA5E9' }} />
              <Box>
                <Typography variant="caption" sx={{ color: '#0EA5E9', fontWeight: 600, display: 'block' }}>
                  Processing your request...
                </Typography>
                <Typography variant="caption" sx={{ color: '#64748b', fontSize: '11px' }}>
                  {threadId ? `Thread ${threadId} • Message ${lastMessageId || 'new'}` : 'Initializing conversation'}
                </Typography>
              </Box>
            </Box>
          )}
          
          <div ref={messagesEndRef} />
        </Box>

        {/* New messages pill - anchored above input box */}
        {renderScrollToBottomButton()}

        <Box
          sx={{
            p: 2,
            borderTop: '1px solid rgba(51, 65, 85, 0.5)',
            bgcolor: 'rgba(30, 41, 59, 0.6)',
            backdropFilter: 'blur(10px)',
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              fullWidth
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="Ask about grid operations, energy burden, or equipment..."
              disabled={streaming}
              size="small"
              multiline
              maxRows={3}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: '8px',
                  fontSize: '14px',
                },
              }}
            />
            <IconButton
              onClick={() => handleSend()}
              disabled={!inputValue.trim() || streaming}
              sx={{
                bgcolor: '#0EA5E9',
                color: 'white',
                width: 40,
                height: 40,
                boxShadow: '0 2px 8px rgba(14, 165, 233, 0.3)',
                transition: 'all 0.2s ease',
                '&:hover': { 
                  bgcolor: '#0284c7',
                  boxShadow: '0 4px 12px rgba(14, 165, 233, 0.5)',
                  transform: 'scale(1.05)'
                },
                '&:active': {
                  transform: 'scale(0.95)'
                },
                '&:disabled': { 
                  bgcolor: '#475569',
                  color: '#94a3b8',
                  boxShadow: 'none'
                },
              }}
            >
              <Send fontSize="small" />
            </IconButton>
          </Box>
        </Box>
        </Box>
      </Paper>
    </Grow>
    </>,
    document.body
  );
}

function MessageBubble({ message, onFeedback }: { message: Message; onFeedback?: (requestId: string, positive: boolean, feedbackMessage?: string) => Promise<boolean> }) {
  const [expandedSql, setExpandedSql] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState(true);
  const [fullscreenChart, setFullscreenChart] = useState(false);
  const [fullscreenTable, setFullscreenTable] = useState(false);
  const [fullscreenSql, setFullscreenSql] = useState(false);
  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [sqlCopied, setSqlCopied] = useState(false);
  const [tableCopied, setTableCopied] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSuccess, setFeedbackSuccess] = useState<'positive' | 'negative' | null>(null);

  const handleFeedback = async (positive: boolean, openDialog: boolean = false) => {
    if (!message.requestId || !onFeedback || message.feedback !== undefined) return;
    
    if (!positive && openDialog) {
      setShowFeedbackDialog(true);
      return;
    }
    
    setFeedbackSubmitting(true);
    try {
      const success = await onFeedback(message.requestId, positive);
      if (success) {
        setFeedbackSuccess(positive ? 'positive' : 'negative');
        setTimeout(() => setFeedbackSuccess(null), 3000);
      }
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleSubmitFeedbackWithMessage = async () => {
    if (!message.requestId || !onFeedback) return;
    
    setFeedbackSubmitting(true);
    setShowFeedbackDialog(false);
    try {
      const success = await onFeedback(message.requestId, false, feedbackText || undefined);
      if (success) {
        setFeedbackSuccess('negative');
        setTimeout(() => setFeedbackSuccess(null), 3000);
      }
    } finally {
      setFeedbackSubmitting(false);
      setFeedbackText('');
    }
  };

  const copyToClipboard = async (text: string, type: 'sql' | 'table' = 'sql') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'sql') {
        setSqlCopied(true);
        setTimeout(() => setSqlCopied(false), 2000);
      } else {
        setTableCopied(true);
        setTimeout(() => setTableCopied(false), 2000);
      }
    } catch (e) {
      logger.error('Failed to copy:', e);
    }
  };

  const tableToCSV = () => {
    if (!message.table) return '';
    const header = message.table.columns.join(',');
    const rows = message.table.rows.map(row => 
      row.map(cell => {
        const str = String(cell ?? '');
        return str.includes(',') || str.includes('"') || str.includes('\n') 
          ? `"${str.replace(/"/g, '""')}"` 
          : str;
      }).join(',')
    );
    return [header, ...rows].join('\n');
  };

  const downloadTableAsCSV = () => {
    const csv = tableToCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `query_results_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyTableToClipboard = () => {
    if (!message.table) return;
    const header = message.table.columns.join('\t');
    const rows = message.table.rows.map(row => row.map(c => String(c ?? '')).join('\t'));
    const tsv = [header, ...rows].join('\n');
    copyToClipboard(tsv, 'table');
  };

  const isUser = message.role === 'user';
  
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <Box
      sx={{
        mb: 2,
        display: 'flex',
        flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <Typography variant="caption" sx={{ color: '#64748b', fontSize: '10px', mb: 0.5, px: 0.5 }}>
        {isUser ? 'You' : 'Assistant'} • {formatTime(message.timestamp)}
      </Typography>
      <Paper
        elevation={1}
        sx={{
          p: 1.5,
          maxWidth: '85%',
          // Glassmorphic message bubbles
          bgcolor: isUser 
            ? 'rgba(14, 165, 233, 0.9)' 
            : 'rgba(30, 41, 59, 0.7)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          color: isUser ? 'white' : '#e2e8f0',
          border: isUser 
            ? '1px solid rgba(14, 165, 233, 0.3)' 
            : '1px solid rgba(51, 65, 85, 0.5)',
          borderRadius: '12px',
          fontSize: '14px',
          lineHeight: 1.6,
          boxShadow: isUser
            ? '0 4px 16px rgba(14, 165, 233, 0.2)'
            : '0 4px 16px rgba(0, 0, 0, 0.2)',
        }}
      >
        {message.thinking && (
          <Box sx={{ mb: 2 }}>
            <Chip
              icon={<ExpandMore sx={{ transform: expandedThinking ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />}
              label="🧠 Thinking Process"
              size="small"
              onClick={() => setExpandedThinking(!expandedThinking)}
              sx={{ 
                fontSize: '12px', 
                cursor: 'pointer',
                bgcolor: '#FBBF24',
                color: '#0F172A',
                fontWeight: 600,
                '&:hover': { bgcolor: '#F59E0B' }
              }}
            />
            <Collapse in={expandedThinking}>
              <Box sx={{ 
                mt: 1, 
                mb: 1,
                p: 1.5, 
                bgcolor: 'rgba(15, 23, 42, 0.6)', 
                color: '#94a3b8', 
                borderRadius: '8px', 
                fontSize: '12px',
                borderLeft: '3px solid #FBBF24',
                fontStyle: 'italic'
              }}>
                <ReactMarkdown>{message.thinking}</ReactMarkdown>
              </Box>
            </Collapse>
          </Box>
        )}

        <FormattedMarkdown>{message.content}</FormattedMarkdown>

        {message.sqlQuery && (
          <Box sx={{ mt: 1.5 }}>
            <Chip
              icon={<Code fontSize="small" />}
              label={expandedSql ? "Hide SQL Query" : "View SQL Query"}
              size="small"
              onClick={() => setExpandedSql(!expandedSql)}
              sx={{ 
                fontSize: '12px', 
                cursor: 'pointer', 
                bgcolor: expandedSql ? '#0284c7' : '#0EA5E9', 
                color: 'white',
                '&:hover': { bgcolor: '#0369a1' }
              }}
            />
            <Collapse in={expandedSql}>
              <Box
                sx={{
                  mt: 1,
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid rgba(14, 165, 233, 0.3)',
                }}
              >
                <Box sx={{ 
                  px: 1.5, 
                  py: 0.5, 
                  bgcolor: 'rgba(14, 165, 233, 0.1)', 
                  borderBottom: '1px solid rgba(14, 165, 233, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Code sx={{ fontSize: '14px', color: '#0EA5E9' }} />
                    <Typography sx={{ fontSize: '11px', color: '#0EA5E9', fontWeight: 600 }}>
                      Generated SQL
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title={sqlCopied ? "Copied!" : "Copy SQL"}>
                      <IconButton
                        size="small"
                        onClick={() => copyToClipboard(message.sqlQuery!)}
                        sx={{ color: sqlCopied ? '#10B981' : '#0EA5E9', p: 0.5 }}
                      >
                        <ContentCopy sx={{ fontSize: '14px' }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Expand">
                      <IconButton
                        size="small"
                        onClick={() => setFullscreenSql(true)}
                        sx={{ color: '#0EA5E9', p: 0.5 }}
                      >
                        <Fullscreen sx={{ fontSize: '14px' }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                <Highlight
                  theme={themes.nightOwl}
                  code={message.sqlQuery.trim()}
                  language="sql"
                >
                  {({ className, style, tokens, getLineProps, getTokenProps }) => (
                    <pre 
                      className={className} 
                      style={{ 
                        ...style, 
                        margin: 0, 
                        padding: '12px',
                        fontSize: '12px',
                        lineHeight: 1.5,
                        overflowX: 'auto',
                        backgroundColor: '#011627',
                        maxHeight: '200px'
                      }}
                    >
                      {tokens.map((line, i) => (
                        <div key={i} {...getLineProps({ line })}>
                          <span style={{ 
                            display: 'inline-block', 
                            width: '2em', 
                            userSelect: 'none', 
                            opacity: 0.5,
                            color: '#637777',
                            marginRight: '1em'
                          }}>
                            {i + 1}
                          </span>
                          {line.map((token, key) => (
                            <span key={key} {...getTokenProps({ token })} />
                          ))}
                        </div>
                      ))}
                    </pre>
                  )}
                </Highlight>
              </Box>
            </Collapse>
            
            <Modal
              open={fullscreenSql}
              onClose={() => setFullscreenSql(false)}
              closeAfterTransition
              slots={{ backdrop: Backdrop }}
              slotProps={{
                backdrop: {
                  timeout: 500,
                  sx: { backgroundColor: 'rgba(0, 0, 0, 0.85)' }
                }
              }}
            >
              <Fade in={fullscreenSql}>
                <Box
                  sx={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '80vw',
                    maxHeight: '80vh',
                    bgcolor: '#011627',
                    borderRadius: '12px',
                    boxShadow: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    border: '1px solid rgba(14, 165, 233, 0.3)'
                  }}
                >
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    p: 2,
                    borderBottom: '1px solid rgba(14, 165, 233, 0.2)',
                    bgcolor: 'rgba(14, 165, 233, 0.05)'
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Code sx={{ color: '#0EA5E9' }} />
                      <Typography variant="h6" sx={{ color: '#0EA5E9', fontWeight: 600 }}>
                        Generated SQL Query
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Tooltip title={sqlCopied ? "Copied!" : "Copy SQL"}>
                        <IconButton
                          onClick={() => copyToClipboard(message.sqlQuery!)}
                          sx={{ color: sqlCopied ? '#10B981' : '#0EA5E9' }}
                        >
                          <ContentCopy />
                        </IconButton>
                      </Tooltip>
                      <IconButton
                        onClick={() => setFullscreenSql(false)}
                        sx={{ color: '#0EA5E9' }}
                      >
                        <Close />
                      </IconButton>
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1, overflow: 'auto' }}>
                    <Highlight
                      theme={themes.nightOwl}
                      code={message.sqlQuery!.trim()}
                      language="sql"
                    >
                      {({ className, style, tokens, getLineProps, getTokenProps }) => (
                        <pre 
                          className={className} 
                          style={{ 
                            ...style, 
                            margin: 0, 
                            padding: '16px',
                            fontSize: '14px',
                            lineHeight: 1.6,
                            backgroundColor: '#011627'
                          }}
                        >
                          {tokens.map((line, i) => (
                            <div key={i} {...getLineProps({ line })}>
                              <span style={{ 
                                display: 'inline-block', 
                                width: '3em', 
                                userSelect: 'none', 
                                opacity: 0.5,
                                color: '#637777',
                                marginRight: '1em',
                                textAlign: 'right'
                              }}>
                                {i + 1}
                              </span>
                              {line.map((token, key) => (
                                <span key={key} {...getTokenProps({ token })} />
                              ))}
                            </div>
                          ))}
                        </pre>
                      )}
                    </Highlight>
                  </Box>
                </Box>
              </Fade>
            </Modal>
          </Box>
        )}

        {message.table && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1, 
              mb: 1,
              pb: 1,
              borderBottom: '1px solid rgba(14, 165, 233, 0.2)'
            }}>
              <TableChart sx={{ color: '#10B981', fontSize: '18px' }} />
              <Typography sx={{ 
                fontSize: '13px', 
                fontWeight: 600, 
                color: '#10B981' 
              }}>
                Query Results ({message.table.rows.length} rows)
              </Typography>
              <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                <Tooltip title={tableCopied ? "Copied!" : "Copy to Clipboard"}>
                  <IconButton
                    size="small"
                    onClick={copyTableToClipboard}
                    sx={{ color: tableCopied ? '#10B981' : '#64748b', '&:hover': { color: '#10B981' } }}
                  >
                    <ContentCopy sx={{ fontSize: '16px' }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Download CSV">
                  <IconButton
                    size="small"
                    onClick={downloadTableAsCSV}
                    sx={{ color: '#64748b', '&:hover': { color: '#10B981' } }}
                  >
                    <Download sx={{ fontSize: '16px' }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Expand">
                  <IconButton
                    size="small"
                    onClick={() => setFullscreenTable(true)}
                    sx={{ color: '#10B981' }}
                  >
                    <Fullscreen sx={{ fontSize: '18px' }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <TableContainer 
              component={Paper} 
              sx={{ 
                maxHeight: 200, 
                bgcolor: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                borderRadius: '8px'
              }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {message.table.columns.map((col, idx) => (
                      <TableCell 
                        key={idx} 
                        onClick={() => {
                          if (sortColumn === idx) {
                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortColumn(idx);
                            setSortDirection('asc');
                          }
                        }}
                        sx={{ 
                          fontWeight: 600, 
                          fontSize: '11px',
                          bgcolor: '#0d2818',
                          color: '#10B981',
                          cursor: 'pointer',
                          userSelect: 'none',
                          '&:hover': { bgcolor: '#134e2a' },
                          whiteSpace: 'nowrap',
                          position: 'sticky',
                          top: 0,
                          zIndex: 2
                        }}
                      >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {col}
                          {sortColumn === idx && (
                            sortDirection === 'asc' ? 
                              <ArrowUpward sx={{ fontSize: '12px' }} /> : 
                              <ArrowDownward sx={{ fontSize: '12px' }} />
                          )}
                        </Box>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(() => {
                    const sortedRows = sortColumn !== null 
                      ? [...message.table!.rows].sort((a, b) => {
                          const aVal = a[sortColumn!];
                          const bVal = b[sortColumn!];
                          const aNum = parseFloat(aVal);
                          const bNum = parseFloat(bVal);
                          if (!isNaN(aNum) && !isNaN(bNum)) {
                            return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
                          }
                          const aStr = String(aVal ?? '');
                          const bStr = String(bVal ?? '');
                          return sortDirection === 'asc' 
                            ? aStr.localeCompare(bStr) 
                            : bStr.localeCompare(aStr);
                        })
                      : message.table!.rows;
                    return sortedRows.slice(0, 10).map((row, rowIdx) => (
                      <TableRow key={rowIdx} sx={{ '&:hover': { bgcolor: 'rgba(16, 185, 129, 0.05)' } }}>
                        {row.map((cell, cellIdx) => (
                          <TableCell key={cellIdx} sx={{ fontSize: '11px', color: '#e2e8f0', py: 0.5 }}>
                            {cell !== null ? String(cell) : 'NULL'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ));
                  })()}
                </TableBody>
              </Table>
            </TableContainer>
            {message.table.rows.length > 10 && (
              <Typography sx={{ fontSize: '11px', color: '#64748b', mt: 0.5, textAlign: 'center' }}>
                Showing 10 of {message.table.rows.length} rows • Click expand for full view
              </Typography>
            )}
            
            <Modal
              open={fullscreenTable}
              onClose={() => setFullscreenTable(false)}
              closeAfterTransition
              slots={{ backdrop: Backdrop }}
              slotProps={{
                backdrop: {
                  timeout: 500,
                  sx: { backgroundColor: 'rgba(0, 0, 0, 0.8)' }
                }
              }}
            >
              <Fade in={fullscreenTable}>
                <Box
                  sx={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '85vw',
                    maxHeight: '80vh',
                    bgcolor: '#0f172a',
                    borderRadius: '12px',
                    boxShadow: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    border: '1px solid rgba(16, 185, 129, 0.3)'
                  }}
                >
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    p: 2,
                    borderBottom: '1px solid rgba(16, 185, 129, 0.2)',
                    bgcolor: 'rgba(16, 185, 129, 0.05)'
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TableChart sx={{ color: '#10B981' }} />
                      <Typography variant="h6" sx={{ color: '#10B981', fontWeight: 600 }}>
                        Query Results
                      </Typography>
                      <Chip 
                        label={`${message.table?.rows.length} rows × ${message.table?.columns.length} columns`}
                        size="small"
                        sx={{ bgcolor: 'rgba(16, 185, 129, 0.2)', color: '#10B981', fontSize: '11px' }}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Tooltip title={tableCopied ? "Copied!" : "Copy to Clipboard"}>
                        <IconButton
                          onClick={copyTableToClipboard}
                          sx={{ color: tableCopied ? '#10B981' : '#64748b', '&:hover': { color: '#10B981' } }}
                        >
                          <ContentCopy />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Download CSV">
                        <IconButton
                          onClick={downloadTableAsCSV}
                          sx={{ color: '#64748b', '&:hover': { color: '#10B981' } }}
                        >
                          <Download />
                        </IconButton>
                      </Tooltip>
                      <IconButton
                        onClick={() => setFullscreenTable(false)}
                        sx={{ color: '#10B981' }}
                      >
                        <Close />
                      </IconButton>
                    </Box>
                  </Box>
                  <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          {message.table?.columns.map((col, idx) => (
                            <TableCell 
                              key={idx}
                              onClick={() => {
                                if (sortColumn === idx) {
                                  setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                                } else {
                                  setSortColumn(idx);
                                  setSortDirection('asc');
                                }
                              }}
                              sx={{ 
                                fontWeight: 600, 
                                fontSize: '12px',
                                bgcolor: '#1e293b',
                                color: '#10B981',
                                cursor: 'pointer',
                                userSelect: 'none',
                                '&:hover': { bgcolor: '#134e2a' },
                                whiteSpace: 'nowrap',
                                borderBottom: '2px solid rgba(16, 185, 129, 0.3)',
                                position: 'sticky',
                                top: 0,
                                zIndex: 2
                              }}
                            >
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {col}
                                {sortColumn === idx && (
                                  sortDirection === 'asc' ? 
                                    <ArrowUpward sx={{ fontSize: '14px' }} /> : 
                                    <ArrowDownward sx={{ fontSize: '14px' }} />
                                )}
                              </Box>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(() => {
                          const sortedRows = sortColumn !== null 
                            ? [...message.table!.rows].sort((a, b) => {
                                const aVal = a[sortColumn!];
                                const bVal = b[sortColumn!];
                                const aNum = parseFloat(aVal);
                                const bNum = parseFloat(bVal);
                                if (!isNaN(aNum) && !isNaN(bNum)) {
                                  return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
                                }
                                const aStr = String(aVal ?? '');
                                const bStr = String(bVal ?? '');
                                return sortDirection === 'asc' 
                                  ? aStr.localeCompare(bStr) 
                                  : bStr.localeCompare(aStr);
                              })
                            : message.table!.rows;
                          return sortedRows.map((row, rowIdx) => (
                            <TableRow 
                              key={rowIdx} 
                              sx={{ 
                                '&:hover': { bgcolor: 'rgba(16, 185, 129, 0.1)' },
                                '&:nth-of-type(even)': { bgcolor: 'rgba(30, 41, 59, 0.5)' }
                              }}
                            >
                              {row.map((cell, cellIdx) => (
                                <TableCell key={cellIdx} sx={{ fontSize: '12px', color: '#e2e8f0', py: 1 }}>
                                  {cell !== null ? String(cell) : <span style={{ color: '#64748b' }}>NULL</span>}
                                </TableCell>
                              ))}
                            </TableRow>
                          ));
                        })()}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </Fade>
            </Modal>
          </Box>
        )}

        {message.chart && message.chart.spec && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1, 
              mb: 1,
              pb: 1,
              borderBottom: '1px solid rgba(14, 165, 233, 0.2)'
            }}>
              <InsertChart sx={{ color: '#0EA5E9', fontSize: '18px' }} />
              <Typography sx={{ 
                fontSize: '13px', 
                fontWeight: 600, 
                color: '#0EA5E9' 
              }}>
                Chart Visualization
              </Typography>
              <IconButton
                size="small"
                onClick={() => setFullscreenChart(true)}
                sx={{ ml: 'auto', color: '#0EA5E9' }}
              >
                <Fullscreen />
              </IconButton>
            </Box>
            <Paper
              elevation={2}
              sx={{
                p: 2,
                bgcolor: 'rgba(255, 255, 255, 0.95)',
                borderRadius: '8px',
                border: '1px solid rgba(14, 165, 233, 0.2)',
                overflow: 'auto'
              }}
            >
              <VegaEmbed 
                spec={{
                  ...message.chart.spec,
                  config: {
                    ...message.chart.spec.config,
                    mark: { tooltip: true }
                  }
                }}
                options={{
                  actions: {
                    export: { png: true, svg: true },
                    source: true,
                    compiled: true,
                    editor: true
                  },
                  tooltip: { theme: 'custom' },
                  hover: true
                }}
              />
            </Paper>
            
            <Modal
              open={fullscreenChart}
              onClose={() => setFullscreenChart(false)}
              closeAfterTransition
              slots={{ backdrop: Backdrop }}
              slotProps={{
                backdrop: {
                  timeout: 500,
                  sx: { backgroundColor: 'rgba(0, 0, 0, 0.8)' }
                }
              }}
            >
              <Fade in={fullscreenChart}>
                <Box
                  sx={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '71vw',
                    height: '67vh',
                    bgcolor: 'white',
                    borderRadius: '12px',
                    boxShadow: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                  }}
                >
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    p: 2,
                    borderBottom: '1px solid #e5e7eb'
                  }}>
                    <Typography variant="h6" sx={{ color: '#0EA5E9', fontWeight: 600 }}>
                      Chart Visualization
                    </Typography>
                    <IconButton
                      onClick={() => setFullscreenChart(false)}
                      sx={{ color: '#0EA5E9' }}
                    >
                      <Close />
                    </IconButton>
                  </Box>
                  <Box sx={{ 
                    flex: 1, 
                    overflow: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: 2,
                    '& > div': {
                      width: '100%',
                      height: '100%'
                    }
                  }}>
                    <VegaEmbed 
                      spec={{
                        ...message.chart.spec,
                        width: 'container',
                        height: 'container',
                        config: {
                          ...message.chart.spec.config,
                          mark: { tooltip: true }
                        }
                      }}
                      options={{
                        actions: {
                          export: { png: true, svg: true },
                          source: true,
                          compiled: true,
                          editor: true
                        },
                        tooltip: { theme: 'custom' },
                        hover: true
                      }}
                    />
                  </Box>
                </Box>
              </Fade>
            </Modal>
          </Box>
        )}
      </Paper>

      {!isUser && message.status === 'complete' && message.requestId && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5, ml: 0.5 }}>
          {feedbackSuccess && (
            <Fade in={true}>
              <Chip 
                label={feedbackSuccess === 'positive' ? "Thanks! 👍" : "Thanks for the feedback!"} 
                size="small"
                sx={{ 
                  bgcolor: feedbackSuccess === 'positive' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                  color: feedbackSuccess === 'positive' ? '#10B981' : '#EF4444',
                  fontSize: '11px',
                  height: '22px'
                }}
              />
            </Fade>
          )}
          {!feedbackSuccess && (
            <>
              <Tooltip title={message.feedback === 'positive' ? "Thanks for the feedback!" : "This was helpful"}>
                <span>
                  <IconButton
                    size="small"
                    disabled={feedbackSubmitting || message.feedback !== undefined}
                    onClick={() => handleFeedback(true)}
                    sx={{ 
                      color: message.feedback === 'positive' ? '#10B981' : '#64748b',
                      p: 0.5,
                      '&:hover': { color: '#10B981', bgcolor: 'rgba(16, 185, 129, 0.1)' },
                      '&.Mui-disabled': { color: message.feedback === 'positive' ? '#10B981' : '#475569' }
                    }}
                  >
                    {message.feedback === 'positive' ? <ThumbUp sx={{ fontSize: '16px' }} /> : <ThumbUpOutlined sx={{ fontSize: '16px' }} />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={message.feedback === 'negative' ? "Thanks for the feedback!" : "Not helpful - click to provide details"}>
                <span>
                  <IconButton
                    size="small"
                    disabled={feedbackSubmitting || message.feedback !== undefined}
                    onClick={() => handleFeedback(false, true)}
                    sx={{ 
                      color: message.feedback === 'negative' ? '#EF4444' : '#64748b',
                      p: 0.5,
                      '&:hover': { color: '#EF4444', bgcolor: 'rgba(239, 68, 68, 0.1)' },
                      '&.Mui-disabled': { color: message.feedback === 'negative' ? '#EF4444' : '#475569' }
                    }}
                  >
                    {message.feedback === 'negative' ? <ThumbDown sx={{ fontSize: '16px' }} /> : <ThumbDownOutlined sx={{ fontSize: '16px' }} />}
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
          {feedbackSubmitting && <CircularProgress size={12} sx={{ color: '#64748b', ml: 0.5 }} />}
          {message.feedback && !feedbackSuccess && (
            <Typography sx={{ fontSize: '10px', color: '#64748b', ml: 0.5 }}>
              Feedback recorded
            </Typography>
          )}
        </Box>
      )}

      <Modal
        open={showFeedbackDialog}
        onClose={() => setShowFeedbackDialog(false)}
        closeAfterTransition
        slots={{ backdrop: Backdrop }}
        slotProps={{
          backdrop: {
            timeout: 300,
            sx: { backgroundColor: 'rgba(0, 0, 0, 0.7)' }
          }
        }}
      >
        <Fade in={showFeedbackDialog}>
          <Box
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 400,
              bgcolor: '#1e293b',
              borderRadius: '12px',
              boxShadow: 24,
              p: 3,
              border: '1px solid rgba(239, 68, 68, 0.3)'
            }}
          >
            <Typography variant="h6" sx={{ color: '#f1f5f9', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <ThumbDownOutlined sx={{ color: '#EF4444' }} />
              Tell us what went wrong
            </Typography>
            <TextField
              fullWidth
              multiline
              rows={3}
              placeholder="What could have been better? (optional)"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              sx={{
                mb: 2,
                '& .MuiOutlinedInput-root': {
                  color: '#e2e8f0',
                  '& fieldset': { borderColor: 'rgba(100, 116, 139, 0.5)' },
                  '&:hover fieldset': { borderColor: '#64748b' },
                  '&.Mui-focused fieldset': { borderColor: '#EF4444' }
                },
                '& .MuiInputBase-input::placeholder': { color: '#64748b' }
              }}
            />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <IconButton
                onClick={() => setShowFeedbackDialog(false)}
                sx={{ color: '#64748b' }}
              >
                <Close />
              </IconButton>
              <Chip
                label="Submit Feedback"
                onClick={handleSubmitFeedbackWithMessage}
                sx={{
                  bgcolor: '#EF4444',
                  color: 'white',
                  '&:hover': { bgcolor: '#DC2626' },
                  cursor: 'pointer'
                }}
              />
            </Box>
            <Typography sx={{ fontSize: '10px', color: '#64748b', mt: 2, textAlign: 'center' }}>
              Request ID: {message.requestId?.substring(0, 8)}...
            </Typography>
          </Box>
        </Fade>
      </Modal>

      <Typography variant="caption" sx={{ mt: 0.5, color: '#888', fontSize: '11px' }}>
        {message.timestamp.toLocaleTimeString()}
      </Typography>
    </Box>
  );
}
