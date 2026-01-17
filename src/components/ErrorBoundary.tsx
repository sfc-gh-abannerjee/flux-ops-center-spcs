import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Box, Button, Typography, Paper, alpha } from '@mui/material';
import { Warning, Refresh } from '@mui/icons-material';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Error Boundary component that catches JavaScript errors anywhere in the child
 * component tree and displays a fallback UI instead of crashing the whole app.
 * 
 * Usage:
 * ```tsx
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 * 
 * Or with custom fallback:
 * ```tsx
 * <ErrorBoundary fallback={<CustomErrorUI />}>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    
    // Log error to console in development
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught an error:', error, errorInfo);
    }
    
    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            bgcolor: '#0F172A',
            p: 3,
          }}
        >
          <Paper
            elevation={8}
            sx={{
              p: 4,
              maxWidth: 500,
              bgcolor: '#1E293B',
              borderRadius: 2,
              border: `1px solid ${alpha('#EF4444', 0.3)}`,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <Warning sx={{ fontSize: 40, color: '#EF4444' }} />
              <Typography variant="h5" fontWeight={600} color="error.main">
                Something went wrong
              </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              The application encountered an unexpected error. This could be due to a network
              issue or a temporary problem. Please try again.
            </Typography>

            {import.meta.env.DEV && this.state.error && (
              <Paper
                sx={{
                  p: 2,
                  mb: 3,
                  bgcolor: alpha('#EF4444', 0.1),
                  borderRadius: 1,
                  maxHeight: 150,
                  overflow: 'auto',
                }}
              >
                <Typography
                  variant="caption"
                  component="pre"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.75rem',
                    color: '#EF4444',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    m: 0,
                  }}
                >
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </Typography>
              </Paper>
            )}

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button
                variant="contained"
                startIcon={<Refresh />}
                onClick={this.handleRetry}
                sx={{
                  bgcolor: '#0EA5E9',
                  '&:hover': { bgcolor: '#0284C7' },
                }}
              >
                Try Again
              </Button>
              <Button
                variant="outlined"
                onClick={this.handleReload}
                sx={{
                  borderColor: alpha('#fff', 0.2),
                  color: 'text.secondary',
                  '&:hover': {
                    borderColor: alpha('#fff', 0.4),
                    bgcolor: alpha('#fff', 0.05),
                  },
                }}
              >
                Reload Page
              </Button>
            </Box>
          </Paper>
        </Box>
      );
    }

    return this.props.children;
  }
}

/**
 * Smaller inline error boundary for specific sections
 * Shows a compact error message within the layout
 */
interface InlineErrorProps {
  children: ReactNode;
  name?: string;
}

interface InlineErrorState {
  hasError: boolean;
  error: Error | null;
}

export class InlineErrorBoundary extends Component<InlineErrorProps, InlineErrorState> {
  constructor(props: InlineErrorProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<InlineErrorState> {
    return { hasError: true, error };
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Paper
          sx={{
            p: 2,
            bgcolor: alpha('#EF4444', 0.1),
            border: `1px solid ${alpha('#EF4444', 0.3)}`,
            borderRadius: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Warning sx={{ fontSize: 16, color: '#EF4444' }} />
            <Typography variant="caption" color="error.main" fontWeight={600}>
              {this.props.name ? `${this.props.name} failed to load` : 'Component error'}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="text"
            onClick={this.handleRetry}
            sx={{ fontSize: '0.7rem', color: '#0EA5E9' }}
          >
            Retry
          </Button>
        </Paper>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
