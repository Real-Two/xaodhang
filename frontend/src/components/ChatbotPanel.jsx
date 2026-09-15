import React, { useState, useRef, useEffect, useCallback } from 'react';
import { BASE_URL } from '../api/client';

const SUGGESTED = [
  'Which zones are critical right now?',
  'Where should I send teams first?',
  'What is the evacuation route for Noney?',
  'Will conditions get worse in the next 24 hours?',
  'How many people are at risk across HIGH zones?',
];

const ACTION_LABELS = {
  EVACUATE:     { label: 'EVACUATE', color: 'var(--risk-critical)' },
  DEPLOY_TEAMS: { label: 'DEPLOY TEAMS', color: 'var(--risk-high)' },
  MONITOR:      { label: 'MONITOR', color: 'var(--risk-moderate)' },
};

/**
 * ChatbotPanel — slide-in AI copilot.
 * Scenario-aware: knows current risk levels, forecasts, population impact,
 * and evacuation routes for all 10 seeded zones.
 */
export default function ChatbotPanel({ onClose }) {
  const [messages,  setMessages]  = useState([
    {
      role: 'assistant',
      content: 'Xaodhang AI Copilot online. I have live situational data for all 10 NER zones — risk levels, forecasts, population exposure, and evacuation routes. What do you need?',
    },
  ]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [lang,      setLang]      = useState('en');
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const send = useCallback(async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    const userMsg = { role: 'user', content: msg };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Build history for multi-turn (last 6 messages)
    const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content }));

    try {
      const r = await fetch(`${BASE_URL}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: msg, language: lang, history }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || 'Chat failed');

      setMessages(prev => [...prev, {
        role:             'assistant',
        content:          data.reply,
        zones_referenced: data.zones_referenced || [],
        suggested_action: data.suggested_action,
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: `Sorry, I couldn't reach the backend: ${e.message}. Make sure ANTHROPIC_API_KEY is set in Railway.`,
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, lang]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 380,
      background: 'var(--bg-deep)',
      borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 500,
      animation: 'slideInRight 0.25s ease',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 18px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--brand-orange), #c0392b)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, flexShrink: 0,
        }}>🤖</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
            Xaodhang AI Copilot
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Live situational awareness · Haiku
          </div>
        </div>

        {/* Language selector */}
        <select
          value={lang}
          onChange={e => setLang(e.target.value)}
          style={{
            background: 'var(--bg-panel)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', borderRadius: 'var(--r-sm)',
            padding: '3px 6px', fontSize: 11, cursor: 'pointer',
          }}
          title="Response language"
        >
          <option value="en">EN</option>
          <option value="hi">HI</option>
          <option value="as">AS</option>
          <option value="mni">MNI</option>
        </select>

        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 4px',
          }}
          aria-label="Close"
        >✕</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Suggested questions — show only at start */}
        {messages.length === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Try asking
            </span>
            {SUGGESTED.map(q => (
              <button
                key={q}
                onClick={() => send(q)}
                style={{
                  textAlign: 'left', background: 'var(--bg-panel)',
                  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                  padding: '7px 10px', fontSize: 12, color: 'var(--text-secondary)',
                  cursor: 'pointer', lineHeight: 1.4,
                  transition: 'border-color 0.15s',
                }}
                onMouseOver={e => e.currentTarget.style.borderColor = 'var(--brand-orange)'}
                onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => {
          const isUser = msg.role === 'user';
          const action = ACTION_LABELS[msg.suggested_action];
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '88%',
                padding: '9px 12px',
                borderRadius: isUser ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                background: isUser ? 'var(--brand-orange)' : 'var(--bg-panel)',
                color: isUser ? '#fff' : 'var(--text-primary)',
                fontSize: 13, lineHeight: 1.55,
                border: isUser ? 'none' : '1px solid var(--border)',
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>

              {/* Action badge */}
              {action && (
                <div style={{
                  marginTop: 6,
                  padding: '4px 10px',
                  background: `${action.color}18`,
                  border: `1px solid ${action.color}44`,
                  borderRadius: 99,
                  fontSize: 10, fontWeight: 700,
                  color: action.color, letterSpacing: '0.06em',
                }}>
                  ⚡ RECOMMENDED ACTION: {action.label}
                </div>
              )}

              {/* Referenced zone chips */}
              {msg.zones_referenced?.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                  {msg.zones_referenced.map(z => (
                    <span key={z} style={{
                      fontSize: 10, padding: '2px 7px', borderRadius: 99,
                      background: 'var(--bg-deep)', color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}>
                      📍 {z.split(',')[0]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Loading indicator */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
            <div style={{ display: 'flex', gap: 3 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--brand-orange)',
                  animation: `bounce 1s ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
            Analysing live data…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 14px',
        borderTop: '1px solid var(--border)',
        display: 'flex', gap: 8, alignItems: 'flex-end',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about zones, evacuation routes, risk levels…"
          rows={2}
          style={{
            flex: 1, resize: 'none',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            color: 'var(--text-primary)',
            fontSize: 13, padding: '8px 10px',
            fontFamily: 'inherit', lineHeight: 1.4,
            outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = 'var(--brand-orange)'}
          onBlur={e  => e.target.style.borderColor = 'var(--border)'}
        />
        <button
          onClick={() => send()}
          disabled={!input.trim() || loading}
          style={{
            background: input.trim() && !loading ? 'var(--brand-orange)' : 'var(--bg-panel)',
            color: input.trim() && !loading ? '#fff' : 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '8px 14px', cursor: input.trim() && !loading ? 'pointer' : 'default',
            fontSize: 16, fontWeight: 700, transition: 'all 0.15s',
            flexShrink: 0, alignSelf: 'stretch',
          }}
          aria-label="Send"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
