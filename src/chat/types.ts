/**
 * Chat Drawer Type Definitions
 * Centralized types for the chat/agent interface
 */

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  table?: TableData;
  chart?: {
    tool_use_id?: string;
    spec: unknown; // Vega-Lite specification object
  };
  sqlQuery?: string;
  manualCitations?: Citation[];
  timestamp: Date;
  status?: 'streaming' | 'complete' | 'error';
  requestId?: string;
  feedback?: 'positive' | 'negative' | null;
  feedbackMessage?: string;
}

export interface TableData {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

export interface Citation {
  title: string;
  source: string;
}

// Size state for docked panels (Gmail/Slack style)
export type DockedPanelSize = 'minimized' | 'compact' | 'expanded' | 'fullscreen';

export interface ChatDrawerProps {
  open: boolean;
  onClose: () => void;
  fabPosition: { x: number; y: number };
  agentEndpoint?: string;
  // Gmail-style dock coordination
  isDocked?: boolean;
  dockedSize?: DockedPanelSize;
  onDockedSizeChange?: (size: DockedPanelSize) => void;
  onDockChange?: (docked: boolean) => void;
  // Other panel states for coordination
  otherPanelDocked?: boolean;
  otherPanelSize?: DockedPanelSize;
}

export interface SavedSession {
  id: string;
  name: string;
  timestamp: string;
  messageCount: number;
}

export interface SessionData {
  messages: SerializedMessage[];
  threadId: number | null;
  lastMessageId: number | null;
}

export interface SerializedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  table?: TableData;
  chart?: {
    tool_use_id?: string;
    spec: unknown;
  };
  sqlQuery?: string;
  manualCitations?: Citation[];
  timestamp: string;
  status?: 'streaming' | 'complete' | 'error';
  requestId?: string;
  feedback?: 'positive' | 'negative' | null;
  feedbackMessage?: string;
}

// Layout modes simplified for Gmail-style bottom dock
export type LayoutMode = 'floating' | 'docked-bottom';

// Panel dimension constants for Gmail-style dock
export const DOCK_PANEL_DIMENSIONS = {
  gap: 12,
  margin: 16,
  compact: { width: 360, height: 350 },
  expanded: { width: 480, height: 450 },
  fullscreen: { width: '50vw', height: '100vh' },
} as const;

export const SUGGESTED_PROMPTS = [
  "What are the transformer oil sampling procedures for high-voltage equipment?",
  "Explain NERC TPL-001 cascade prevention requirements",
  "What are the safety procedures for vegetation management near power lines?",
  "How should I configure SEL-387E differential protection relays?"
];
