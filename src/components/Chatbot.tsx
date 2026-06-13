import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { useAuthModal } from '../context/AuthModalContext';
import iconImg from '../assets/5500_1_04.jpg';
import { X, Send, Bot } from 'lucide-react';

const API_URL = `${import.meta.env.VITE_API_URL}/chat`;

interface Message {
  role: 'user' | 'assistant';
  text?: string;
  html?: string;
}

const stripDebug = (html: string): string => {
  if (!html) return html;
  let c = html;
  c = c.replace(/\[Source:[^\]]*\]/gi, '');
  c = c.replace(/<current_tab_state>[\s\S]*?<\/current_tab_state>/gi, '');
  c = c.replace(/current_tab_state[\s\S]*?current_tab_state/gi, '');
  c = c.replace(new RegExp('\\u003ccurrent_tab_state\\u003e[\\s\\S]*?\\u003c\\/current_tab_state\\u003e', 'gi'), '');
  return c.trim();
};

// Inject scoped CSS for timetable tables rendered inside chat
const TABLE_STYLE = `
  <style>
    .tt-wrap { overflow-x: auto; margin-top: 6px; }
    .tt-wrap table { border-collapse: collapse; width: 100%; font-size: 11px; }
    .tt-wrap thead tr th {
      background: linear-gradient(135deg, #4c1d95, #6d28d9);
      color: #e9d5ff;
      padding: 7px 10px;
      font-weight: 600;
      white-space: nowrap;
      text-align: left;
      border: 1px solid #5b21b6;
    }
    .tt-wrap tbody tr { border-bottom: 1px solid #2d1b69; }
    .tt-wrap tbody tr:nth-child(even) { background: #1e1b4b; }
    .tt-wrap tbody tr:nth-child(odd)  { background: #13111f; }
    .tt-wrap tbody tr:hover { background: #2e1065; }
    .tt-wrap tbody td {
      padding: 6px 10px;
      color: #c4b5fd;
      vertical-align: top;
      border: 1px solid #2d1b69;
      font-size: 11px;
    }
    .tt-wrap tbody td.time-col {
      color: #7c3aed;
      white-space: nowrap;
      font-weight: 500;
    }
    .tt-wrap tbody td.empty-col { color: #374151; text-align: center; }
    .tt-title {
      color: #a78bfa;
      font-weight: 700;
      font-size: 13px;
      margin-bottom: 6px;
    }
  </style>
`;

// Post-process HTML from backend: wrap tables with scoped styles
const enhanceHtml = (html: string): string => {
  if (!html) return html;
  // Skip if already has mentor-mentee styles (mm-table) or timetable styles (tt-wrap)
  if (html.includes('mm-table') || html.includes('tt-wrap')) return html;
  // If it contains a plain <table>, inject timetable scoped CSS and wrap
  if (html.includes('<table')) {
    let enhanced = html
      .replace(/<table/g, '<div class="tt-wrap"><table')
      .replace(/<\/table>/g, '</table></div>');
    return TABLE_STYLE + enhanced;
  }
  return html;
};

const Chatbot = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [greeted, setGreeted] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { isAuthenticated, user } = useAuthStore();
  const { openModal } = useAuthModal();

  useEffect(() => {
    if (!sessionRef.current) {
      sessionRef.current = 'sess_' + Math.random().toString(36).slice(2, 9);
    }
  }, []);

  // Greeting when chatbot opens
  useEffect(() => {
    if (open && isAuthenticated && !greeted) {
      const rawName = user?.name || user?.email?.split('@')[0] || 'there';
      const firstName = rawName.replace(/^\d+\./, '').split(' ')[0] || 'there';
      const hour = new Date().getHours();
      const timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      setMessages([{
        role: 'assistant',
        html: `<div style="line-height:1.6">
          <span style="font-size:15px">👋 ${timeGreet}, <strong style="color:#a78bfa">${firstName}</strong>!</span><br/>
          I'm <strong>UniBuddy</strong> — your campus assistant.<br/>
          <span style="color:#9ca3af;font-size:12px">Ask me about your timetable, faculty, fees, or anything about GD Goenka University.</span>
        </div>`
      }]);
      setGreeted(true);
    }
    if (!open) setGreeted(false);
  }, [open, isAuthenticated]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleOpen = () => {
    if (!isAuthenticated) { openModal('login'); return; }
    setOpen(o => !o);
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setMessages(prev => [...prev, { role: 'user', text }]);
    setInput('');

    // Handle greetings client-side — no backend round-trip needed
    const greetPattern = /^(hi|hello|hey|howdy|hii+|hola|yo|sup|whats up|what's up)[\s!.?]*$/i;
    if (greetPattern.test(text.trim())) {
      // Extract readable first name: strip enrollment prefix like "230160223057."
      const rawName = user?.name || user?.email?.split('@')[0] || 'there';
      const firstName = rawName.replace(/^\d+\./, '').split(' ')[0] || 'there';
      setMessages(prev => [...prev, {
        role: 'assistant',
        html: `<div style="line-height:1.6">
          Hey <strong style="color:#a78bfa">${firstName}</strong>! 👋<br/>
          I'm here to help. You can ask me about:<br/>
          <ul style="margin:6px 0 0 16px;color:#9ca3af;font-size:12px">
            <li>📅 Your timetable — <em>"show my timetable"</em></li>
            <li>👩‍🏫 Faculty info — <em>"who is Dr. Bhagat Singh"</em></li>
            <li>🧑‍🏫 Mentor details — <em>"who is my mentor"</em></li>
            <li>💰 Fees — <em>"BCA fee structure"</em></li>
            <li>🏛️ University info — <em>"about GD Goenka"</em></li>
          </ul>
        </div>`
      }]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, session_id: sessionRef.current })
      });
      const j = await res.json();
      const raw = stripDebug(j.reply || '<div>No response</div>');
      const enhanced = enhanceHtml(raw);
      setMessages(prev => [...prev, { role: 'assistant', html: enhanced }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', html: '<div style="color:#f87171">Connection error. Please try again.</div>' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 999 }}>
      {/* Chat window */}
      {open && isAuthenticated && (
        <div style={{
          width: 440,
          height: 580,
          marginBottom: 12,
          borderRadius: 16,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(109,40,217,0.35)',
          border: '1px solid #4c1d95',
          background: '#0d0b1a',
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #1e1b4b 0%, #2e1065 100%)',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #4c1d95',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Bot size={18} color="#e9d5ff" />
              </div>
              <div>
                <div style={{ color: '#e9d5ff', fontWeight: 700, fontSize: 14 }}>UniBuddy AI</div>
                <div style={{ color: '#7c3aed', fontSize: 11 }}>● Online</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#7c3aed', padding: 4, borderRadius: 6,
              display: 'flex', alignItems: 'center',
            }}>
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px 14px',
            background: '#0d0b1a',
            scrollbarWidth: 'thin',
            scrollbarColor: '#4c1d95 transparent',
          }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                marginBottom: 12,
              }}>
                {m.role === 'assistant' && (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginRight: 8, marginTop: 2,
                  }}>
                    <Bot size={14} color="#e9d5ff" />
                  </div>
                )}
                <div style={{
                  maxWidth: '82%',
                  padding: '10px 13px',
                  borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: m.role === 'user'
                    ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
                    : '#1a1730',
                  color: m.role === 'user' ? '#fff' : '#d1d5db',
                  fontSize: 13,
                  lineHeight: 1.55,
                  border: m.role === 'assistant' ? '1px solid #2d1b69' : 'none',
                  boxShadow: m.role === 'user' ? '0 4px 12px rgba(124,58,237,0.3)' : 'none',
                }}>
                  {m.role === 'user'
                    ? <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
                    : <div dangerouslySetInnerHTML={{ __html: m.html || '' }} />
                  }
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Bot size={14} color="#e9d5ff" />
                </div>
                <div style={{
                  padding: '10px 14px', borderRadius: '16px 16px 16px 4px',
                  background: '#1a1730', border: '1px solid #2d1b69',
                  display: 'flex', gap: 5, alignItems: 'center',
                }}>
                  {[0, 1, 2].map(d => (
                    <div key={d} style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: '#7c3aed',
                      animation: 'bounce 1.2s infinite',
                      animationDelay: `${d * 0.2}s`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '10px 12px',
            background: '#13111f',
            borderTop: '1px solid #2d1b69',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask something..."
              disabled={loading}
              style={{
                flex: 1, padding: '9px 13px',
                borderRadius: 10,
                border: '1px solid #4c1d95',
                background: '#1a1730',
                color: '#e9d5ff',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              style={{
                width: 38, height: 38, borderRadius: 10, border: 'none',
                background: input.trim() && !loading
                  ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
                  : '#2d1b69',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.2s',
              }}
            >
              <Send size={16} color={input.trim() && !loading ? '#fff' : '#4c1d95'} />
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleOpen} style={{
          background: 'none', border: 'none', padding: 0,
          cursor: 'pointer', position: 'relative',
        }}>
          <img src={iconImg} alt="Chat" style={{
            width: 72, height: 72, borderRadius: '50%',
            boxShadow: open
              ? '0 0 0 3px #7c3aed, 0 8px 24px rgba(124,58,237,0.5)'
              : '0 4px 16px rgba(0,0,0,0.4)',
            transition: 'box-shadow 0.2s',
          }} />
          {!isAuthenticated && (
            <div style={{
              position: 'absolute', top: -4, right: -4,
              background: '#ef4444', color: '#fff',
              borderRadius: '50%', width: 20, height: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
            }}>🔒</div>
          )}
        </button>
      </div>

      {/* Bounce animation */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default Chatbot;
