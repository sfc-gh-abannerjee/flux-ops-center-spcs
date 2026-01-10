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
  Backdrop
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
  FullscreenExit
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import FormattedMarkdown from './FormattedMarkdown';
import { VegaEmbed } from 'react-vega';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  
  const isDraggingRef = useRef(false);
  const originPosition = useRef({ x: 0, y: 0 });
  const startPosition = useRef({ x: 0, y: 0 });
  const currentPosition = useRef({ x: 0, y: 0 });
  const rafId = useRef<number | null>(null);
  const velocityHistory = useRef<Array<{ x: number; y: number; time: number }>>([]);
  const momentumAnimationRef = useRef<number | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming]);

  useEffect(() => {
    if (open && messages.length === 0) {
      setShowWelcome(true);
    } else {
      setShowWelcome(false);
    }
  }, [open, messages.length]);

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const updateLastMessage = (messages: Message[], updatedMessage: Message) => {
    const newMessages = [...messages];
    if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
      newMessages[newMessages.length - 1] = updatedMessage;
    } else {
      newMessages.push(updatedMessage);
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
        console.log('🧵 Creating new thread for conversation...');
        try {
          const threadResponse = await fetch(
            import.meta.env.DEV ? 'http://localhost:3001/api/agent/threads/create' : '/api/agent/threads/create',
            {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          
          if (threadResponse.ok) {
            const { thread_id } = await threadResponse.json();
            console.log(`✅ Thread created: ${thread_id}`);
            currentThreadId = thread_id;
            setThreadId(thread_id);
          } else {
            console.warn('⚠️ Thread creation failed, continuing without explicit thread');
          }
        } catch (threadError) {
          console.warn('⚠️ Thread creation failed:', threadError);
        }
      }

      // Log thread context for debugging
      console.log('🚀 Sending agent request:', {
        thread_id: currentThreadId,
        parent_message_id: lastMessageId || 0,
        has_thread: currentThreadId !== null,
        is_continuation: lastMessageId !== null,
        query: queryText.substring(0, 60) + '...'
      });
      
      console.log(`📊 Current state BEFORE request: threadId=${threadId}, lastMessageId=${lastMessageId}, currentThreadId=${currentThreadId}`);
      
      console.log(`🔗 Fetching from: ${agentEndpoint}`);
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

      console.log(`📡 Response status: ${response.status}, headers:`, Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ Agent API error:', errorBody);
        throw new Error(`Agent API returned status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      console.log('📖 Got reader, starting stream...');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent: { event?: string; data?: string } = {};

      let chunkCount = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`✅ Stream complete. Total chunks: ${chunkCount}`);
          break;
        }

        chunkCount++;
        const decoded = decoder.decode(value, { stream: true });
        console.log(`📦 Chunk ${chunkCount}:`, decoded.substring(0, 200));
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
                  console.warn('Skipping invalid SSE JSON:', currentEvent.data.substring(0, 100));
                  currentEvent = {};
                  continue;
                }

                switch (currentEvent.event) {
                  case 'response.text.delta':
                    console.log('📝 Text delta:', data.text?.substring(0, 50));
                    currentMessage.content += data.text || '';
                    setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    break;

                  case 'response.thinking.delta':
                    console.log('🤔 Thinking delta:', data.text?.substring(0, 50));
                    currentMessage.thinking = (currentMessage.thinking || '') + (data.text || '');
                    setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    break;

                  case 'response.table':
                    console.log('📋 Table event received:', JSON.stringify(data).substring(0, 500));
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
                      console.log('📊 Chart received:', {
                        tool_use_id: data.tool_use_id,
                        hasSpec: !!chartSpec,
                        specPreview: JSON.stringify(chartSpec).substring(0, 100)
                      });
                      setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    } catch (e) {
                      console.error('❌ Failed to parse chart_spec:', e, data);
                    }
                    break;

                  case 'response.tool_result':
                    console.log('🔧 Tool result received:', JSON.stringify(data).substring(0, 500));
                    if (data.content) {
                      const toolContent = Array.isArray(data.content) ? data.content : [data.content];
                      for (const item of toolContent) {
                        console.log('  📦 Tool content item:', item.type, JSON.stringify(item).substring(0, 300));
                        
                        // Extract SQL from json.sql (Cortex Analyst format)
                        if (item.type === 'json' && item.json?.sql) {
                          currentMessage.sqlQuery = item.json.sql;
                          // Also add SQL to thinking so users can see what query was generated
                          const sqlPreview = `\n\n**Generated SQL:**\n\`\`\`sql\n${item.json.sql}\n\`\`\``;
                          currentMessage.thinking = (currentMessage.thinking || '') + sqlPreview;
                          console.log('  ✅ Found SQL in json.sql');
                        }
                        // Also check for SQL directly on item (legacy format)
                        if (item.type === 'text' && item.sql) {
                          currentMessage.sqlQuery = item.sql;
                          const sqlPreview = `\n\n**Generated SQL:**\n\`\`\`sql\n${item.sql}\n\`\`\``;
                          currentMessage.thinking = (currentMessage.thinking || '') + sqlPreview;
                          console.log('  ✅ Found SQL in item.sql');
                        }
                        
                        // Extract table data from tool results
                        // Cortex Analyst returns results in json.results or as structured data
                        if (item.type === 'json' && item.json) {
                          const jsonData = item.json;
                          // Check for results array (table rows)
                          if (jsonData.results && Array.isArray(jsonData.results) && jsonData.results.length > 0) {
                            const firstRow = jsonData.results[0];
                            const columns = Object.keys(firstRow);
                            const rows = jsonData.results.map((r: any) => columns.map(c => r[c]));
                            currentMessage.table = { columns, rows };
                            console.log('  ✅ Found table in json.results:', columns.length, 'columns,', rows.length, 'rows');
                          }
                          // Check for data array (alternative format)
                          if (jsonData.data && Array.isArray(jsonData.data) && jsonData.data.length > 0) {
                            const firstRow = jsonData.data[0];
                            const columns = Object.keys(firstRow);
                            const rows = jsonData.data.map((r: any) => columns.map(c => r[c]));
                            currentMessage.table = { columns, rows };
                            console.log('  ✅ Found table in json.data:', columns.length, 'columns,', rows.length, 'rows');
                          }
                        }
                        
                        setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                      }
                    }
                    break;

                  case 'response':
                    if (data.thread_id) setThreadId(data.thread_id);
                    if (data.message_id) setLastMessageId(data.message_id);
                    currentMessage.status = 'complete';
                    setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    break;
                    
                  case 'metadata':
                    // CRITICAL: Capture message IDs for thread continuity
                    console.log(`📋 Metadata event:`, data);
                    
                    const metadata = data.metadata || data;
                    
                    if (metadata.role === 'user' && metadata.message_id) {
                      console.log(`👤 User message ID: ${metadata.message_id}`);
                    }
                    
                    if (metadata.role === 'assistant' && metadata.message_id) {
                      console.log(`🤖 Assistant message ID: ${metadata.message_id} - Setting as parent for next turn`);
                      setLastMessageId(metadata.message_id);
                    }
                    
                    // Note: metadata event doesn't contain thread_id per Snowflake docs
                    if (metadata.thread_id) {
                      console.log(`⚠️ Unexpected thread_id in metadata: ${metadata.thread_id}`);
                      if (!threadId) {
                        setThreadId(metadata.thread_id);
                      }
                    }
                    break;
                    
                  default:
                    // Log unknown events for debugging
                    if (currentEvent.event && !currentEvent.event.startsWith('response.status')) {
                      console.log(`❓ Unknown event type: ${currentEvent.event}`, JSON.stringify(data).substring(0, 200));
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
      console.error('Agent streaming error:', error);
      currentMessage.status = 'error';
      currentMessage.content = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
    } finally {
      setStreaming(false);
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

  // Chat appears to the LEFT and ABOVE the FAB
  // Calculate position ensuring chat stays within viewport
  const bottomPosition = window.innerHeight - fabPosition.y - fabSize;
  const rightPosition = window.innerWidth - fabPosition.x - fabSize;
  
  // Ensure chat doesn't overflow viewport edges
  const constrainedBottom = Math.max(chatOffset, Math.min(bottomPosition + chatOffset, window.innerHeight - chatHeight));
  const constrainedRight = Math.max(0, Math.min(rightPosition, window.innerWidth - chatWidth));

  return createPortal(
    <Grow in={open} timeout={300}>
      <Paper
        ref={paperRef}
        elevation={8}
        sx={{
          position: 'fixed',
          bottom: constrainedBottom,
          right: constrainedRight,
          width: chatWidth,
          height: chatHeight,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderRadius: '16px',
          overflow: 'hidden',
          zIndex: 1299,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(14, 165, 233, 0.2), 0 0 40px rgba(14, 165, 233, 0.1)',
          border: '1px solid rgba(51, 65, 85, 0.5)',
          transform: 'translate3d(0, 0, 0)',
          cursor: 'default',
        }}
      >
        <Box
          ref={headerRef}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 2,
            borderBottom: '1px solid rgba(51, 65, 85, 0.5)',
            bgcolor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(10px)',
            color: '#0EA5E9',
            cursor: 'grab',
            userSelect: 'none',
            touchAction: 'none',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '18px', pointerEvents: 'none' }}>
            Grid Intelligence Assistant
          </Typography>
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

        <Box
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
            <MessageBubble key={message.id} message={message} />
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

        <Box
          sx={{
            p: 2,
            borderTop: '1px solid rgba(51, 65, 85, 0.5)',
            bgcolor: 'rgba(30, 41, 59, 0.6)',
            backdropFilter: 'blur(10px)',
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
      </Paper>
    </Grow>,
    document.body
  );
}

function MessageBubble({ message }: { message: Message }) {
  const [expandedSql, setExpandedSql] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState(true);
  const [fullscreenChart, setFullscreenChart] = useState(false);

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
          <Box sx={{ mt: 1 }}>
            <Chip
              icon={<Code fontSize="small" />}
              label="SQL Query"
              size="small"
              onClick={() => setExpandedSql(!expandedSql)}
              sx={{ fontSize: '12px', cursor: 'pointer', bgcolor: '#0EA5E9', color: 'white' }}
            />
            <Collapse in={expandedSql}>
              <Box
                sx={{
                  mt: 1,
                  p: 1,
                  bgcolor: '#1e1e1e',
                  color: '#d4d4d4',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  overflowX: 'auto',
                }}
              >
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{message.sqlQuery}</pre>
              </Box>
            </Collapse>
          </Box>
        )}

        {message.table && (
          <TableContainer component={Paper} sx={{ mt: 1, maxHeight: 300 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {message.table.columns.map((col, idx) => (
                    <TableCell key={idx} sx={{ fontWeight: 600, fontSize: '12px' }}>
                      {col}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {message.table.rows.map((row, rowIdx) => (
                  <TableRow key={rowIdx}>
                    {row.map((cell, cellIdx) => (
                      <TableCell key={cellIdx} sx={{ fontSize: '12px' }}>
                        {cell !== null ? String(cell) : 'NULL'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
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

      <Typography variant="caption" sx={{ mt: 0.5, color: '#888', fontSize: '11px' }}>
        {message.timestamp.toLocaleTimeString()}
      </Typography>
    </Box>
  );
}
