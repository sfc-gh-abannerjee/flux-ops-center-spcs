/**
 * useSessionStorage - Custom hook for managing chat session persistence
 * Handles localStorage-based session storage with automatic save/load
 */

import { useState, useRef, useCallback } from 'react';
import { logger } from '../utils/logger';
import type { Message, SavedSession, SessionData, SerializedMessage } from './types';

const SESSIONS_INDEX_KEY = 'grid_intelligence_sessions_index';
const SESSION_PREFIX = 'grid_intelligence_session_';

export function useSessionStorage() {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const isLoadingSession = useRef(false);

  const loadSessionsIndex = useCallback((): SavedSession[] => {
    try {
      const index = localStorage.getItem(SESSIONS_INDEX_KEY);
      return index ? JSON.parse(index) : [];
    } catch {
      return [];
    }
  }, []);

  const saveSessionsIndex = useCallback((sessions: SavedSession[]) => {
    localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(sessions));
    setSavedSessions(sessions);
  }, []);

  const generateSessionId = useCallback(() => 
    `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, []);

  const createNewSession = useCallback((): string => {
    const newId = generateSessionId();
    const newSession: SavedSession = {
      id: newId,
      name: 'New Chat',
      timestamp: new Date().toISOString(),
      messageCount: 0
    };
    const sessions = loadSessionsIndex();
    const updatedSessions = [newSession, ...sessions];
    saveSessionsIndex(updatedSessions);
    setCurrentSessionId(newId);
    logger.log('🆕 Created new session:', newId);
    return newId;
  }, [generateSessionId, loadSessionsIndex, saveSessionsIndex]);

  const loadSession = useCallback((sessionId: string): SessionData | null => {
    isLoadingSession.current = true;
    logger.log('📂 Loading session:', sessionId);
    
    try {
      const sessionData = localStorage.getItem(`${SESSION_PREFIX}${sessionId}`);
      if (sessionData) {
        const parsed = JSON.parse(sessionData) as SessionData;
        setCurrentSessionId(sessionId);
        logger.log(`✅ Loaded session with ${parsed.messages?.length || 0} messages`);
        return parsed;
      }
    } catch (e) {
      logger.error('Failed to load session:', e);
    } finally {
      // Delay clearing the flag to allow state updates to complete
      setTimeout(() => {
        isLoadingSession.current = false;
      }, 100);
    }
    
    setCurrentSessionId(sessionId);
    return null;
  }, []);

  const saveSession = useCallback((
    sessionId: string,
    messages: Message[],
    threadId: number | null,
    lastMessageId: number | null
  ) => {
    if (isLoadingSession.current || !sessionId) return;
    
    try {
      const sessionData: SessionData = {
        messages: messages.map(m => ({
          ...m,
          timestamp: m.timestamp.toISOString()
        })) as SerializedMessage[],
        threadId,
        lastMessageId
      };
      
      localStorage.setItem(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(sessionData));
      
      // Update session metadata in index
      const sessions = loadSessionsIndex();
      const sessionIndex = sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex >= 0) {
        sessions[sessionIndex].messageCount = messages.length;
        sessions[sessionIndex].timestamp = new Date().toISOString();
        // Generate name from first user message
        const firstUserMsg = messages.find(m => m.role === 'user');
        if (firstUserMsg && sessions[sessionIndex].name === 'New Chat') {
          sessions[sessionIndex].name = firstUserMsg.content.substring(0, 50) + 
            (firstUserMsg.content.length > 50 ? '...' : '');
        }
        saveSessionsIndex(sessions);
      }
    } catch (e) {
      logger.error('Failed to save session:', e);
    }
  }, [loadSessionsIndex, saveSessionsIndex]);

  const deleteSession = useCallback((sessionId: string): string | null => {
    const sessions = loadSessionsIndex();
    const filtered = sessions.filter(s => s.id !== sessionId);
    saveSessionsIndex(filtered);
    localStorage.removeItem(`${SESSION_PREFIX}${sessionId}`);
    logger.log('🗑️ Deleted session:', sessionId);
    
    // If deleting current session, switch to another or create new
    if (sessionId === currentSessionId) {
      if (filtered.length > 0) {
        return filtered[0].id;
      } else {
        return createNewSession();
      }
    }
    return null;
  }, [currentSessionId, createNewSession, loadSessionsIndex, saveSessionsIndex]);

  const renameSession = useCallback((sessionId: string, newName: string) => {
    const sessions = loadSessionsIndex();
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    if (sessionIndex >= 0) {
      sessions[sessionIndex].name = newName;
      saveSessionsIndex(sessions);
    }
  }, [loadSessionsIndex, saveSessionsIndex]);

  const initializeSessions = useCallback((): { 
    sessions: SavedSession[]; 
    initialSessionId: string | null;
    sessionData: SessionData | null;
  } => {
    const sessions = loadSessionsIndex();
    setSavedSessions(sessions);
    
    if (sessions.length > 0) {
      const mostRecent = sessions[0];
      const sessionData = loadSession(mostRecent.id);
      return { sessions, initialSessionId: mostRecent.id, sessionData };
    } else {
      const newId = createNewSession();
      return { sessions: [{ id: newId, name: 'New Chat', timestamp: new Date().toISOString(), messageCount: 0 }], initialSessionId: newId, sessionData: null };
    }
  }, [createNewSession, loadSession, loadSessionsIndex]);

  return {
    currentSessionId,
    setCurrentSessionId,
    savedSessions,
    isLoadingSession,
    loadSessionsIndex,
    saveSessionsIndex,
    createNewSession,
    loadSession,
    saveSession,
    deleteSession,
    renameSession,
    initializeSessions
  };
}
