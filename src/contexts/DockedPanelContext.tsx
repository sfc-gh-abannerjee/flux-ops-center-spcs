/**
 * DockedPanelContext - Gmail/LinkedIn-style Bottom Dock Panel Orchestration
 * 
 * Engineering Pattern: Multiple panels can dock at the bottom of the screen
 * like Gmail compose windows or LinkedIn/Facebook chat windows.
 * 
 * Each panel can be:
 * - Minimized: Just a tab/header visible in the bottom bar
 * - Expanded: Full panel slides up from the tab
 * - Undocked: Returns to floating/overlay mode
 * 
 * Panels share horizontal space dynamically and can be reordered.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

// Panel types that can be docked
export type DockedPanelId = 'cascade-analysis' | 'chat-drawer' | string;

export interface DockedPanel {
  id: DockedPanelId;
  title: string;
  icon?: ReactNode;
  minimized: boolean;
  order: number; // Position in the dock bar (left to right)
  width?: number; // Preferred width when expanded (auto-calculated if not set)
}

interface DockedPanelContextType {
  // State
  dockedPanels: DockedPanel[];
  
  // Actions
  dockPanel: (id: DockedPanelId, title: string, icon?: ReactNode) => void;
  undockPanel: (id: DockedPanelId) => void;
  minimizePanel: (id: DockedPanelId) => void;
  expandPanel: (id: DockedPanelId) => void;
  togglePanelMinimized: (id: DockedPanelId) => void;
  reorderPanel: (id: DockedPanelId, newOrder: number) => void;
  
  // Queries
  isPanelDocked: (id: DockedPanelId) => boolean;
  isPanelMinimized: (id: DockedPanelId) => boolean;
  getPanelOrder: (id: DockedPanelId) => number;
  getExpandedPanels: () => DockedPanel[];
  getDockedPanelCount: () => number;
  
  // Layout calculations
  getPanelWidth: (id: DockedPanelId) => number;
  getPanelLeftOffset: (id: DockedPanelId) => number;
}

const DockedPanelContext = createContext<DockedPanelContextType | null>(null);

// Constants for dock bar layout
const DOCK_BAR_HEIGHT_MINIMIZED = 40; // Height of minimized tab
const MIN_PANEL_WIDTH = 320;
const DOCK_LEFT_MARGIN = 60; // Space for sidebar

export const DockedPanelProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [dockedPanels, setDockedPanels] = useState<DockedPanel[]>([]);

  const dockPanel = useCallback((id: DockedPanelId, title: string, icon?: ReactNode) => {
    setDockedPanels(prev => {
      // Don't add if already docked
      if (prev.find(p => p.id === id)) {
        return prev;
      }
      // Add with next order number
      const maxOrder = prev.length > 0 ? Math.max(...prev.map(p => p.order)) : -1;
      return [...prev, { id, title, icon, minimized: false, order: maxOrder + 1 }];
    });
  }, []);

  const undockPanel = useCallback((id: DockedPanelId) => {
    setDockedPanels(prev => {
      const filtered = prev.filter(p => p.id !== id);
      // Reorder remaining panels to close gaps
      return filtered.map((p, idx) => ({ ...p, order: idx }));
    });
  }, []);

  const minimizePanel = useCallback((id: DockedPanelId) => {
    setDockedPanels(prev => 
      prev.map(p => p.id === id ? { ...p, minimized: true } : p)
    );
  }, []);

  const expandPanel = useCallback((id: DockedPanelId) => {
    setDockedPanels(prev => 
      prev.map(p => p.id === id ? { ...p, minimized: false } : p)
    );
  }, []);

  const togglePanelMinimized = useCallback((id: DockedPanelId) => {
    setDockedPanels(prev => 
      prev.map(p => p.id === id ? { ...p, minimized: !p.minimized } : p)
    );
  }, []);

  const reorderPanel = useCallback((id: DockedPanelId, newOrder: number) => {
    setDockedPanels(prev => {
      const panel = prev.find(p => p.id === id);
      if (!panel) return prev;
      
      // Reorder all panels
      return prev.map(p => {
        if (p.id === id) return { ...p, order: newOrder };
        if (p.order >= newOrder && p.order < panel.order) {
          return { ...p, order: p.order + 1 };
        }
        if (p.order <= newOrder && p.order > panel.order) {
          return { ...p, order: p.order - 1 };
        }
        return p;
      }).sort((a, b) => a.order - b.order);
    });
  }, []);

  const isPanelDocked = useCallback((id: DockedPanelId) => {
    return dockedPanels.some(p => p.id === id);
  }, [dockedPanels]);

  const isPanelMinimized = useCallback((id: DockedPanelId) => {
    const panel = dockedPanels.find(p => p.id === id);
    return panel?.minimized ?? false;
  }, [dockedPanels]);

  const getPanelOrder = useCallback((id: DockedPanelId) => {
    const panel = dockedPanels.find(p => p.id === id);
    return panel?.order ?? -1;
  }, [dockedPanels]);

  const getExpandedPanels = useCallback(() => {
    return dockedPanels.filter(p => !p.minimized).sort((a, b) => a.order - b.order);
  }, [dockedPanels]);

  const getDockedPanelCount = useCallback(() => {
    return dockedPanels.length;
  }, [dockedPanels]);

  // Calculate panel width based on number of expanded panels
  const getPanelWidth = useCallback((id: DockedPanelId) => {
    const expandedPanels = dockedPanels.filter(p => !p.minimized);
    if (expandedPanels.length === 0) return 0;
    
    const panel = dockedPanels.find(p => p.id === id);
    if (!panel || panel.minimized) return 180; // Minimized tab width
    
    // Available width = viewport - left margin - minimized panels width
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const minimizedPanels = dockedPanels.filter(p => p.minimized);
    const minimizedWidth = minimizedPanels.length * 180;
    const availableWidth = viewportWidth - DOCK_LEFT_MARGIN - minimizedWidth - 16; // 16px padding
    
    // Split equally among expanded panels
    const expandedCount = expandedPanels.length;
    const panelWidth = Math.max(MIN_PANEL_WIDTH, Math.floor(availableWidth / expandedCount));
    
    return panelWidth;
  }, [dockedPanels]);

  // Calculate left offset for a panel
  const getPanelLeftOffset = useCallback((id: DockedPanelId) => {
    const sortedPanels = [...dockedPanels].sort((a, b) => a.order - b.order);
    let offset = DOCK_LEFT_MARGIN;
    
    for (const panel of sortedPanels) {
      if (panel.id === id) break;
      
      if (panel.minimized) {
        offset += 180; // Minimized tab width
      } else {
        // Get width of this expanded panel
        const expandedPanels = dockedPanels.filter(p => !p.minimized);
        const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
        const minimizedPanels = dockedPanels.filter(p => p.minimized);
        const minimizedWidth = minimizedPanels.length * 180;
        const availableWidth = viewportWidth - DOCK_LEFT_MARGIN - minimizedWidth - 16;
        const panelWidth = Math.max(MIN_PANEL_WIDTH, Math.floor(availableWidth / expandedPanels.length));
        offset += panelWidth;
      }
    }
    
    return offset;
  }, [dockedPanels]);

  const value = useMemo(() => ({
    dockedPanels,
    dockPanel,
    undockPanel,
    minimizePanel,
    expandPanel,
    togglePanelMinimized,
    reorderPanel,
    isPanelDocked,
    isPanelMinimized,
    getPanelOrder,
    getExpandedPanels,
    getDockedPanelCount,
    getPanelWidth,
    getPanelLeftOffset,
  }), [
    dockedPanels,
    dockPanel,
    undockPanel,
    minimizePanel,
    expandPanel,
    togglePanelMinimized,
    reorderPanel,
    isPanelDocked,
    isPanelMinimized,
    getPanelOrder,
    getExpandedPanels,
    getDockedPanelCount,
    getPanelWidth,
    getPanelLeftOffset,
  ]);

  return (
    <DockedPanelContext.Provider value={value}>
      {children}
    </DockedPanelContext.Provider>
  );
};

export const useDockedPanels = (): DockedPanelContextType => {
  const context = useContext(DockedPanelContext);
  if (!context) {
    throw new Error('useDockedPanels must be used within a DockedPanelProvider');
  }
  return context;
};

// Export constants for use in components
export const DOCK_CONSTANTS = {
  DOCK_BAR_HEIGHT_MINIMIZED,
  MIN_PANEL_WIDTH,
  DOCK_LEFT_MARGIN,
};
