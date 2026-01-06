import React, { useState, useEffect, useRef } from 'react';
import {
  Drawer,
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
  TableRow
} from '@mui/material';
import {
  Send,
  Close,
  ExpandMore,
  Psychology,
  Code,
  TableChart,
  InsertChart,
  Description
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  table?: TableData;
  chart?: any;  // Vega-Lite spec
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
  agentEndpoint?: string;
}

export default function ChatDrawer({ 
  open, 
  onClose, 
  agentEndpoint = '/api/agent/stream' 
}: ChatDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [threadId, setThreadId] = useState(0);
  const [lastMessageId, setLastMessageId] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming]);

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

  const handleSend = async () => {
    if (!inputValue.trim() || streaming) return;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: inputValue,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setStreaming(true);

    let currentMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      status: 'streaming'
    };

    setMessages(prev => [...prev, currentMessage]);

    try {
      const response = await fetch(agentEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: inputValue,
          thread_id: threadId,
          parent_message_id: lastMessageId
        })
      });

      if (!response.ok) {
        throw new Error(`Agent API returned status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent: { event?: string; data?: string } = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent.event = line.substring(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = line.substring(6);
          } else if (line === '' && currentEvent.event && currentEvent.data) {
            // Process event
            try {
              const eventData = JSON.parse(currentEvent.data);
              
              switch (currentEvent.event) {
                case 'response.text.delta':
                  currentMessage.content += eventData.text || '';
                  setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                  break;
                
                case 'response.thinking.delta':
                  currentMessage.thinking = (currentMessage.thinking || '') + (eventData.text || '');
                  setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                  break;
                
                case 'response.table':
                  if (eventData.result_set) {
                    currentMessage.table = {
                      columns: eventData.result_set.columns || [],
                      rows: eventData.result_set.rows || []
                    };
                    setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                  }
                  break;
                
                case 'response.chart':
                  if (eventData.chart_spec) {
                    try {
                      currentMessage.chart = JSON.parse(eventData.chart_spec);
                      setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                    } catch (e) {
                      console.error('Failed to parse chart spec:', e);
                    }
                  }
                  break;
                
                case 'response.tool_result':
                  if (eventData.tool_name === 'Query_AMI_Data' && eventData.result?.sql_query) {
                    currentMessage.sqlQuery = eventData.result.sql_query;
                    setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                  }
                  break;
                
                case 'response.status':
                  // Update status but don't display
                  currentMessage.status = eventData.status || 'streaming';
                  break;
                
                case 'response':
                  // Final response - finalize message
                  currentMessage.status = 'complete';
                  setMessages(prev => updateLastMessage(prev, { ...currentMessage }));
                  
                  // Update thread tracking for next message
                  if (eventData.thread_id) setThreadId(eventData.thread_id);
                  if (eventData.message_id) setLastMessageId(eventData.message_id);
                  break;
              }
              
            } catch (e) {
              console.error('Failed to parse event data:', e);
            }
            
            currentEvent = {};
          }
        }
      }

    } catch (error) {
      console.error('Streaming error:', error);
      currentMessage.content = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      currentMessage.status = 'error';
      setMessages(prev => updateLastMessage(prev, currentMessage));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: 480,  // Stellar fixed drawer width
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          bgcolor: '#fafbfc'
        }
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          borderBottom: '1px solid rgba(0,0,0,0.12)',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,  // Stellar space-gap-md (12px)
          bgcolor: 'white',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
        }}
      >
        <Psychology sx={{ color: '#29B5E8', fontSize: 28 }} />
        <Box sx={{ flexGrow: 1 }}>
          <Typography 
            variant="h6" 
            sx={{ 
              fontFamily: 'Inter, sans-serif',
              fontWeight: 600,
              color: '#1a1d1f',
              fontSize: 18
            }}
          >
            Grid Intelligence Assistant
          </Typography>
          <Typography 
            variant="caption" 
            sx={{ 
              color: 'text.secondary',
              fontSize: 12
            }}
          >
            Powered by Cortex Agent · 3-year historical context
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <Close />
        </IconButton>
      </Box>

      {/* Message List */}
      <Box 
        sx={{ 
          flexGrow: 1, 
          overflowY: 'auto', 
          p: 2,
          bgcolor: '#fafbfc'
        }}
      >
        {messages.length === 0 && (
          <Box sx={{ 
            textAlign: 'center', 
            mt: 8,
            px: 3
          }}>
            <Psychology sx={{ fontSize: 64, color: '#29B5E8', opacity: 0.3, mb: 2 }} />
            <Typography variant="h6" sx={{ color: 'text.secondary', mb: 1, fontFamily: 'Inter' }}>
              Ask me about your grid operations
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
              I can analyze trends, compare historical patterns, and search technical manuals
            </Typography>
            
            {/* Example queries */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 3 }}>
              {[
                "Compare summer load patterns 2023 vs 2024 vs 2025",
                "Which transformers show increasing stress over past 3 years?",
                "Show energy burden changes vs 2024 baseline by income",
                "Find transformer oil sampling procedures"
              ].map((example, i) => (
                <Chip
                  key={i}
                  label={example}
                  onClick={() => setInputValue(example)}
                  sx={{
                    justifyContent: 'flex-start',
                    px: 1.5,
                    py: 2.5,
                    height: 'auto',
                    '& .MuiChip-label': {
                      whiteSpace: 'normal',
                      textAlign: 'left',
                      fontSize: 13
                    },
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: 'rgba(41, 181, 232, 0.08)'
                    }
                  }}
                />
              ))}
            </Box>
          </Box>
        )}
        
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        
        {streaming && <SkeletonLoader />}
        
        <div ref={messagesEndRef} />
      </Box>

      {/* Chat Input */}
      <Box
        sx={{
          p: 2,
          borderTop: '1px solid rgba(0,0,0,0.12)',
          bgcolor: 'white',
          boxShadow: '0 -1px 3px rgba(0,0,0,0.08)'
        }}
      >
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            placeholder="Ask about grid operations, trends, or equipment..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            multiline
            maxRows={4}
            disabled={streaming}
            sx={{
              '& .MuiOutlinedInput-root': {
                fontFamily: 'Inter, sans-serif',
                fontSize: 14,
                borderRadius: 2,
                '&:hover fieldset': {
                  borderColor: '#29B5E8'
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#29B5E8'
                }
              }
            }}
          />
          <IconButton
            onClick={handleSend}
            disabled={!inputValue.trim() || streaming}
            sx={{
              color: '#29B5E8',
              bgcolor: 'rgba(41, 181, 232, 0.08)',
              borderRadius: 2,
              width: 40,
              height: 40,
              '&:hover': {
                bgcolor: 'rgba(41, 181, 232, 0.15)'
              },
              '&.Mui-disabled': {
                color: 'rgba(0, 0, 0, 0.26)',
                bgcolor: 'rgba(0, 0, 0, 0.04)'
              }
            }}
          >
            {streaming ? <CircularProgress size={20} /> : <Send />}
          </IconButton>
        </Box>
      </Box>
    </Drawer>
  );
}

// MessageBubble Component
function MessageBubble({ message }: { message: Message }) {
  const [showThinking, setShowThinking] = useState(false);
  const [showSQL, setShowSQL] = useState(false);

  const isUser = message.role === 'user';

  return (
    <Box
      sx={{
        mb: 1.5,  // Stellar space-gap-md (12px)
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 1
      }}
    >
      <Paper
        elevation={0}
        sx={{
          maxWidth: '85%',
          bgcolor: isUser
            ? 'rgba(41, 181, 232, 0.12)'  // Cyan accent (Stellar)
            : 'white',
          borderRadius: 2,
          p: 1.5,
          border: isUser ? 'none' : '1px solid rgba(0,0,0,0.08)',
          boxShadow: isUser ? 'none' : '0 1px 3px rgba(0,0,0,0.08)'
        }}
      >
        {/* Text Content */}
        <Box sx={{ 
          fontSize: 14, 
          fontFamily: 'Inter, sans-serif',
          color: '#1a1d1f',
          '& p': { mb: 1 },
          '& p:last-child': { mb: 0 }
        }}>
          <ReactMarkdown>{message.content || ''}</ReactMarkdown>
        </Box>

        {/* Thinking Block (Optional, Collapsible) */}
        {message.thinking && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            <Box
              onClick={() => setShowThinking(!showThinking)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                gap: 0.5,
                '&:hover': { opacity: 0.7 }
              }}
            >
              <Psychology sx={{ fontSize: 16, color: '#6366f1' }} />
              <Typography 
                variant="caption" 
                sx={{ 
                  color: '#6366f1',
                  fontWeight: 500,
                  fontSize: 12
                }}
              >
                Reasoning process
              </Typography>
              <ExpandMore
                sx={{
                  fontSize: 16,
                  color: '#6366f1',
                  transform: showThinking ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s'
                }}
              />
            </Box>
            <Collapse in={showThinking}>
              <Typography
                variant="body2"
                sx={{
                  mt: 1,
                  fontStyle: 'italic',
                  color: 'text.secondary',
                  fontSize: 13,
                  fontFamily: 'Inter, sans-serif'
                }}
              >
                {message.thinking}
              </Typography>
            </Collapse>
          </Box>
        )}

        {/* Data Table */}
        {message.table && message.table.rows.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <TableChart sx={{ fontSize: 16, color: '#29B5E8' }} />
              <Typography variant="caption" sx={{ color: '#29B5E8', fontWeight: 500 }}>
                Query Results ({message.table.rows.length} rows)
              </Typography>
            </Box>
            <TableContainer 
              component={Paper} 
              elevation={0}
              sx={{ 
                maxHeight: 300,
                border: '1px solid rgba(0,0,0,0.08)'
              }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {message.table.columns.map((col, i) => (
                      <TableCell 
                        key={i}
                        sx={{ 
                          fontWeight: 600,
                          fontSize: 12,
                          fontFamily: 'Inter, sans-serif',
                          bgcolor: '#fafbfc'
                        }}
                      >
                        {col}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {message.table.rows.slice(0, 100).map((row, i) => (
                    <TableRow key={i} hover>
                      {row.map((cell, j) => (
                        <TableCell 
                          key={j}
                          sx={{ 
                            fontSize: 13,
                            fontFamily: 'Inter, sans-serif'
                          }}
                        >
                          {typeof cell === 'number' ? cell.toLocaleString() : cell}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* SQL Transparency (Collapsible) */}
        {message.sqlQuery && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            <Box
              onClick={() => setShowSQL(!showSQL)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                gap: 0.5,
                '&:hover': { opacity: 0.7 }
              }}
            >
              <Code sx={{ fontSize: 16, color: '#29B5E8' }} />
              <Typography 
                variant="caption" 
                sx={{ 
                  color: '#29B5E8',
                  fontWeight: 500,
                  fontSize: 12
                }}
              >
                💡 Generated SQL
              </Typography>
              <ExpandMore
                sx={{
                  fontSize: 16,
                  color: '#29B5E8',
                  transform: showSQL ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s'
                }}
              />
            </Box>
            <Collapse in={showSQL}>
              <Box
                sx={{
                  mt: 1,
                  bgcolor: '#f8f9fa',
                  p: 1.5,
                  borderRadius: 1,
                  fontFamily: 'Monaco, Courier New, monospace',
                  fontSize: 11,
                  overflowX: 'auto',
                  border: '1px solid rgba(0,0,0,0.08)'
                }}
              >
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {message.sqlQuery}
                </pre>
              </Box>
            </Collapse>
          </Box>
        )}

        {/* Manual Citations */}
        {message.manualCitations && message.manualCitations.length > 0 && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <Description sx={{ fontSize: 16, color: '#6366f1' }} />
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 12 }}>
                Related Technical Manuals:
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {message.manualCitations.map((citation, i) => (
                <Chip
                  key={i}
                  label={citation.title}
                  size="small"
                  sx={{
                    fontSize: 11,
                    height: 24,
                    bgcolor: 'rgba(99, 102, 241, 0.08)',
                    color: '#6366f1',
                    '&:hover': {
                      bgcolor: 'rgba(99, 102, 241, 0.15)'
                    }
                  }}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Timestamp */}
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            textAlign: isUser ? 'right' : 'left',
            color: 'text.secondary',
            mt: 0.5,
            fontSize: 11
          }}
        >
          {message.timestamp.toLocaleTimeString()}
        </Typography>
      </Paper>
    </Box>
  );
}

// SkeletonLoader Component
function SkeletonLoader() {
  return (
    <Box sx={{ mb: 1.5 }}>
      {[...Array(3)].map((_, i) => (
        <Box
          key={i}
          sx={{
            height: 16,
            width: i === 2 ? '60%' : '80%',
            bgcolor: 'rgba(41, 181, 232, 0.12)',
            borderRadius: 1,
            mb: 0.75,
            animation: 'pulse 2s ease-in-out infinite',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 0.6 },
              '50%': { opacity: 1 }
            }
          }}
        />
      ))}
    </Box>
  );
}
