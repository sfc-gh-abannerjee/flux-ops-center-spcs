import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Box, Chip } from '@mui/material';
import { TrendingUp, TrendingDown, Remove } from '@mui/icons-material';

interface FormattedMarkdownProps {
  children: string;
}

export default function FormattedMarkdown({ children }: FormattedMarkdownProps) {
  // Year color mapping for temporal distinction
  const yearColors: Record<string, string> = {
    '2023': '#3B82F6', // Blue - past
    '2024': '#0EA5E9', // Cyan - recent
    '2025': '#7C3AED', // Purple - current/future
  };

  // Format text with enhanced pattern detection
  const formatText = (text: string) => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    // Enhanced patterns for grid intelligence data
    const patterns = [
      // Years (2023, 2024, 2025) - highest priority
      { regex: /\b(202[3-5])\b/g, type: 'year' },
      // Power values with units (63,549 MW, 1.5 GW, etc.)
      { regex: /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(MW|GW|kW|kWh|MWh|GWh|MVA|kVA)/gi, type: 'power' },
      // Voltage ratings (138 kV, 345kV, 12.47 kV)
      { regex: /(\d+(?:\.\d+)?)\s*(kV|V)/gi, type: 'voltage' },
      // Load percentages and factors (85%, 0.95 load factor)
      { regex: /(\d+(?:\.\d+)?)\s*%|\b(load factor|capacity factor|utilization)\b/gi, type: 'load' },
      // Trend indicators with percentages (↑ 1.5%, ↓ 2.3%, → stable)
      { regex: /([↑↓→±]\s*)?(\d+(?:\.\d+)?)\s*%/g, type: 'percentage' },
      // Asset types (transformer, substation, feeder, circuit, meter)
      { regex: /\b(transformer|substation|feeder|circuit|meter|pole|line|breaker|switch|capacitor|recloser)s?\b/gi, type: 'asset' },
      // Status indicators
      { regex: /\b(online|offline|alarm|warning|normal|critical|healthy|degraded|operational|outage)\b/gi, type: 'status' },
      // Trend words in context
      { regex: /\((decline|declining|stable|increase|increasing|rising|falling|unchanged|improved|degraded)\)/gi, type: 'trend' },
      // Standalone trend words
      { regex: /\b(highest|lowest|peak|average|minimum|maximum)\b/gi, type: 'metric' },
      // Currency
      { regex: /\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g, type: 'currency' },
    ];

    // Create combined regex
    const allMatches: Array<{ index: number; length: number; text: string; type: string; match: RegExpMatchArray }> = [];
    
    patterns.forEach(({ regex, type }) => {
      let match;
      const re = new RegExp(regex);
      while ((match = re.exec(text)) !== null) {
        allMatches.push({
          index: match.index,
          length: match[0].length,
          text: match[0],
          type,
          match
        });
      }
    });

    // Sort by index and filter overlaps (prioritize earlier patterns)
    allMatches.sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return b.length - a.length; // Prefer longer matches
    });

    // Remove overlapping matches
    const filteredMatches = allMatches.filter((match, idx) => {
      if (idx === 0) return true;
      const prev = allMatches[idx - 1];
      return match.index >= prev.index + prev.length;
    });

    // Build formatted output
    filteredMatches.forEach((match, idx) => {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      parts.push(
        <span key={`match-${idx}`}>
          {formatMatch(match.text, match.type, match.match)}
        </span>
      );

      lastIndex = match.index + match.length;
    });

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : text;
  };

  const formatMatch = (text: string, type: string, match: RegExpMatchArray) => {
    // Year formatting with distinct colors
    if (type === 'year') {
      const year = text;
      return (
        <span style={{
          color: yearColors[year] || '#7C3AED',
          fontWeight: 700,
          fontSize: '15px',
          padding: '2px 8px',
          backgroundColor: `${yearColors[year] || '#7C3AED'}15`,
          borderRadius: '6px',
          border: `1px solid ${yearColors[year] || '#7C3AED'}40`,
          marginRight: '4px',
          display: 'inline-block',
        }}>
          {text}
        </span>
      );
    }

    // Power values (MW, GW, etc.)
    if (type === 'power') {
      return (
        <span style={{
          color: '#0EA5E9',
          fontWeight: 700,
          fontSize: '16px',
          padding: '2px 6px',
          backgroundColor: 'rgba(14, 165, 233, 0.12)',
          borderRadius: '4px',
          letterSpacing: '0.3px',
          fontFamily: 'monospace',
        }}>
          {text}
        </span>
      );
    }

    // Voltage ratings
    if (type === 'voltage') {
      return (
        <span style={{
          color: '#F59E0B',
          fontWeight: 600,
          fontSize: '15px',
          padding: '2px 6px',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          borderRadius: '4px',
          fontFamily: 'monospace',
        }}>
          ⚡ {text}
        </span>
      );
    }

    // Load percentages
    if (type === 'load') {
      return (
        <span style={{
          color: '#8B5CF6',
          fontWeight: 600,
          fontSize: '15px',
          padding: '2px 6px',
          backgroundColor: 'rgba(139, 92, 246, 0.12)',
          borderRadius: '4px',
        }}>
          {text}
        </span>
      );
    }

    // Percentages with trend arrows
    if (type === 'percentage') {
      const hasArrow = /[↑↓→]/.test(text);
      const isPositive = text.includes('↑');
      const isNegative = text.includes('↓');
      const isNeutral = text.includes('→');
      
      let color = '#F59E0B'; // Default amber
      let bgcolor = 'rgba(245, 158, 11, 0.12)';
      let icon = null;
      
      if (isPositive) {
        color = '#10B981';
        bgcolor = 'rgba(16, 185, 129, 0.12)';
        icon = '↑';
      } else if (isNegative) {
        color = '#EF4444';
        bgcolor = 'rgba(239, 68, 68, 0.12)';
        icon = '↓';
      } else if (isNeutral) {
        color = '#64748B';
        bgcolor = 'rgba(100, 116, 139, 0.12)';
        icon = '→';
      }

      return (
        <span style={{
          color,
          fontWeight: 700,
          fontSize: '15px',
          padding: '2px 8px',
          backgroundColor: bgcolor,
          borderRadius: '4px',
          border: `1px solid ${color}30`,
          whiteSpace: 'nowrap',
        }}>
          {text}
        </span>
      );
    }

    // Asset types
    if (type === 'asset') {
      return (
        <span style={{
          color: '#06B6D4',
          fontWeight: 600,
          fontSize: '14px',
          padding: '1px 6px',
          backgroundColor: 'rgba(6, 182, 212, 0.12)',
          borderRadius: '4px',
          textTransform: 'capitalize',
        }}>
          {text}
        </span>
      );
    }

    // Status indicators
    if (type === 'status') {
      const statusColors: Record<string, { color: string; bg: string }> = {
        online: { color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
        operational: { color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
        healthy: { color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
        normal: { color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
        offline: { color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
        alarm: { color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
        critical: { color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
        outage: { color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
        warning: { color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },
        degraded: { color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },
      };
      
      const style = statusColors[text.toLowerCase()] || { color: '#64748B', bg: 'rgba(100, 116, 139, 0.12)' };
      
      return (
        <span style={{
          color: style.color,
          fontWeight: 600,
          fontSize: '13px',
          padding: '2px 8px',
          backgroundColor: style.bg,
          borderRadius: '6px',
          border: `1px solid ${style.color}30`,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          {text}
        </span>
      );
    }

    // Trend words
    if (type === 'trend') {
      const isPositive = /increase|rising|improved/i.test(text);
      const isNegative = /decline|falling|degraded/i.test(text);
      
      const color = isPositive ? '#10B981' : isNegative ? '#EF4444' : '#64748B';
      const bgcolor = isPositive ? 'rgba(16, 185, 129, 0.12)' : isNegative ? 'rgba(239, 68, 68, 0.12)' : 'rgba(100, 116, 139, 0.12)';
      
      return (
        <span style={{
          color,
          fontWeight: 600,
          fontSize: '13px',
          fontStyle: 'italic',
          padding: '2px 6px',
          backgroundColor: bgcolor,
          borderRadius: '4px',
        }}>
          {text}
        </span>
      );
    }

    // Metric qualifiers
    if (type === 'metric') {
      return (
        <span style={{
          color: '#7C3AED',
          fontWeight: 600,
          fontSize: '14px',
          fontStyle: 'italic',
        }}>
          {text}
        </span>
      );
    }

    // Currency
    if (type === 'currency') {
      return (
        <span style={{
          color: '#10B981',
          fontWeight: 700,
          fontSize: '15px',
          padding: '2px 6px',
          backgroundColor: 'rgba(16, 185, 129, 0.12)',
          borderRadius: '4px',
          fontFamily: 'monospace',
        }}>
          {text}
        </span>
      );
    }

    return <span style={{ fontWeight: 600 }}>{text}</span>;
  };

  // Custom components for ReactMarkdown
  const components = {
    p: ({ children }: any) => {
      return <p style={{ marginBottom: '0.75em', lineHeight: 1.7 }}>{children}</p>;
    },
    strong: ({ children }: any) => {
      return <strong style={{ color: '#0EA5E9', fontWeight: 700 }}>{children}</strong>;
    },
    li: ({ children }: any) => {
      return <li style={{ marginBottom: '0.5em', lineHeight: 1.6 }}>{children}</li>;
    },
    h1: ({ children }: any) => (
      <h1 style={{ 
        color: '#0EA5E9', 
        fontWeight: 700, 
        fontSize: '20px',
        marginTop: '1em',
        marginBottom: '0.5em',
        borderBottom: '2px solid rgba(14, 165, 233, 0.3)',
        paddingBottom: '0.3em',
      }}>{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 style={{ 
        color: '#0EA5E9', 
        fontWeight: 700, 
        fontSize: '18px',
        marginTop: '1em',
        marginBottom: '0.5em',
      }}>{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 style={{ 
        color: '#7C3AED', 
        fontWeight: 600, 
        fontSize: '16px',
        marginTop: '0.8em',
        marginBottom: '0.4em',
      }}>{children}</h3>
    ),
    text: ({ value }: any) => {
      return formatText(value);
    },
  };

  return (
    <Box sx={{
      '& ul': { 
        marginTop: '0.5em',
        marginBottom: '0.5em',
        paddingLeft: '1.5em',
      },
      '& ol': { 
        marginTop: '0.5em',
        marginBottom: '0.5em',
        paddingLeft: '1.5em',
      },
      '& code': {
        backgroundColor: 'rgba(100, 116, 139, 0.15)',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '13px',
        fontFamily: 'monospace',
        color: '#64748B',
      },
      '& pre': {
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        padding: '12px',
        borderRadius: '8px',
        overflowX: 'auto',
        fontSize: '13px',
      },
    }}>
      <ReactMarkdown components={components as any}>
        {children}
      </ReactMarkdown>
    </Box>
  );
}
