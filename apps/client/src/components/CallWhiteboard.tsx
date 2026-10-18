import { useEffect, useRef, useState, useCallback } from 'react';
import type { Language, PublicUser } from '../api/types';

export type WhiteboardStroke = {
  x0: number; // 0..1 normalized coords
  y0: number;
  x1: number;
  y1: number;
  color: string;
  width: number;
  mode?: 'draw' | 'erase';
};

export type WhiteboardCursor = {
  x: number;
  y: number;
  userId: string;
  userName: string;
  color: string;
};

type CallWhiteboardProps = {
  currentUser: PublicUser;
  peerUser: PublicUser;
  language: Language;
  strokes: WhiteboardStroke[];
  onAddStroke: (stroke: WhiteboardStroke) => void;
  onClear: () => void;
  onSendSignal: (data: unknown) => void;
  incomingSignal?: unknown;
  onClose: () => void;
};

const PALETTE = [
  '#22d3ee', // Cyan
  '#f43f5e', // Coral/Pink
  '#facc15', // Yellow
  '#4ade80', // Emerald Green
  '#a855f7', // Electric Purple
  '#ffffff', // Pure White
  '#000000'  // Dark/Eraser
];

export function CallWhiteboard({
  currentUser,
  peerUser,
  language,
  strokes,
  onAddStroke,
  onClear,
  onSendSignal,
  incomingSignal,
  onClose
}: CallWhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [currentColor, setCurrentColor] = useState('#22d3ee');
  const [brushSize, setBrushSize] = useState(4);
  const [isEraser, setIsEraser] = useState(false);
  const [remoteCursor, setRemoteCursor] = useState<WhiteboardCursor | null>(null);

  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const cursorTimeoutRef = useRef<number | null>(null);

  const drawSegment = useCallback((
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: string,
    width: number,
    mode: 'draw' | 'erase' = 'draw'
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;

    if (mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
    }

    ctx.beginPath();
    ctx.moveTo(x0 * canvas.width, y0 * canvas.height);
    ctx.lineTo(x1 * canvas.width, y1 * canvas.height);
    ctx.stroke();
    ctx.restore();
  }, []);

  const drawnCountRef = useRef(0);

  const redrawAllStrokes = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) {
      drawSegment(s.x0, s.y0, s.x1, s.y1, s.color, s.width, s.mode || 'draw');
    }
    drawnCountRef.current = strokes.length;
  }, [strokes, drawSegment]);

  // Resize canvas to match display size and restore drawings
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
      redrawAllStrokes();
    }
  }, [redrawAllStrokes]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, [resizeCanvas]);

  // Initial sync request on mount
  useEffect(() => {
    onSendSignal({ type: 'whiteboard_request_sync' });
  }, [onSendSignal]);

  // Sync canvas with strokes collection smoothly without flickering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (strokes.length === 0) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      drawnCountRef.current = 0;
      return;
    }
    if (strokes.length < drawnCountRef.current) {
      redrawAllStrokes();
      return;
    }
    if (strokes.length > drawnCountRef.current) {
      const start = drawnCountRef.current;
      for (let i = start; i < strokes.length; i++) {
        const s = strokes[i];
        drawSegment(s.x0, s.y0, s.x1, s.y1, s.color, s.width, s.mode || 'draw');
      }
      drawnCountRef.current = strokes.length;
    }
  }, [strokes, redrawAllStrokes, drawSegment]);

  // Process incoming remote cursor
  useEffect(() => {
    if (!incomingSignal || typeof incomingSignal !== 'object') return;
    const payload = incomingSignal as { type?: string; stroke?: WhiteboardStroke; cursor?: WhiteboardCursor };

    if (payload.type === 'whiteboard_cursor' && payload.cursor) {
      setRemoteCursor(payload.cursor);
      if (cursorTimeoutRef.current) window.clearTimeout(cursorTimeoutRef.current);
      cursorTimeoutRef.current = window.setTimeout(() => setRemoteCursor(null), 2500);
    }
  }, [incomingSignal]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    isDrawingRef.current = true;
    lastPointRef.current = { x, y };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // Send cursor position periodically
    onSendSignal({
      type: 'whiteboard_cursor',
      cursor: {
        x,
        y,
        userId: currentUser.id,
        userName: currentUser.nickname,
        color: isEraser ? '#ffffff' : currentColor
      }
    });

    if (!isDrawingRef.current || !lastPointRef.current) return;

    const stroke: WhiteboardStroke = {
      x0: lastPointRef.current.x,
      y0: lastPointRef.current.y,
      x1: x,
      y1: y,
      color: currentColor,
      width: brushSize,
      mode: isEraser ? 'erase' : 'draw'
    };

    drawSegment(stroke.x0, stroke.y0, stroke.x1, stroke.y1, stroke.color, stroke.width, stroke.mode);
    drawnCountRef.current++;
    onAddStroke(stroke);
    onSendSignal({ type: 'whiteboard_stroke', stroke });
    lastPointRef.current = { x, y };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    drawnCountRef.current = 0;
    onClear();
    onSendSignal({ type: 'whiteboard_clear' });
  };

  return (
    <div className="call-whiteboard-overlay">
      <div className="call-whiteboard-topbar">
        <div className="whiteboard-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#22d3ee' }}>
            <path d="M12 19l7-7 3 3-7 7-3-3z" />
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
            <path d="M2 2l7.586 7.586" />
            <circle cx="11" cy="11" r="2" />
          </svg>
          <span>{language === 'ru' ? 'Интерактивная доска' : 'Live Sketchpad'}</span>
          <span className="whiteboard-peer-hint">({peerUser.nickname})</span>
        </div>
        <button
          type="button"
          className="whiteboard-close-btn"
          title={language === 'ru' ? 'Закрыть доску' : 'Close whiteboard'}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="call-whiteboard-canvas-wrap">
        <canvas
          ref={canvasRef}
          className={`call-whiteboard-canvas ${isEraser ? 'is-eraser' : 'is-pen'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        />

        {remoteCursor ? (
          <div
            className="whiteboard-remote-cursor"
            style={{
              left: `${remoteCursor.x * 100}%`,
              top: `${remoteCursor.y * 100}%`,
              borderColor: remoteCursor.color
            }}
          >
            <span className="whiteboard-remote-cursor-label" style={{ backgroundColor: remoteCursor.color }}>
              {remoteCursor.userName}
            </span>
          </div>
        ) : null}
      </div>

      {/* Floating Toolbar */}
      <div className="call-whiteboard-toolbar">
        <div className="whiteboard-tools-colors">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className={`whiteboard-color-btn ${!isEraser && currentColor === c ? 'active' : ''}`}
              style={{ backgroundColor: c }}
              onClick={() => {
                setCurrentColor(c);
                setIsEraser(false);
              }}
            />
          ))}
        </div>

        <div className="whiteboard-separator" />

        <div className="whiteboard-tools-sizes">
          {[2, 5, 10, 18].map((s) => (
            <button
              key={s}
              type="button"
              className={`whiteboard-size-btn ${brushSize === s ? 'active' : ''}`}
              onClick={() => setBrushSize(s)}
            >
              <span className="whiteboard-size-dot" style={{ width: s * 1.5, height: s * 1.5 }} />
            </button>
          ))}
        </div>

        <div className="whiteboard-separator" />

        <button
          type="button"
          className={`whiteboard-tool-action eraser-btn ${isEraser ? 'active' : ''}`}
          title={language === 'ru' ? 'Ластик' : 'Eraser'}
          onClick={() => setIsEraser((v) => !v)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 21L21 7l-5-5L2 16l5 5z" />
            <path d="M14 9l5 5" />
          </svg>
        </button>

        <button
          type="button"
          className="whiteboard-tool-action clear-btn"
          title={language === 'ru' ? 'Очистить доску' : 'Clear all'}
          onClick={clearCanvas}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
