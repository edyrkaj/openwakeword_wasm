import React, { useEffect, useMemo, useRef, useState } from 'react';
import WakeWordEngine, { MODEL_FILE_MAP } from 'openwakeword-wasm-browser';
import './App.css';

const KEYWORDS = Object.keys(MODEL_FILE_MAP);

const fmt = (num) => (num === null || num === undefined ? '--' : num.toFixed(2));

export default function WakeWordWidget() {
  const [status, setStatus] = useState('Loading models…');
  const [isListening, setIsListening] = useState(false);
  const [speechActive, setSpeechActive] = useState(false);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState([]);
  const [activeKeyword, setActiveKeyword] = useState('hey_jarvis');
  const [gain, setGain] = useState(1);
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState([]);

  const engine = useMemo(() => new WakeWordEngine({
    debug: false,
    baseAssetUrl: '/openwakeword/models',
    keywords: KEYWORDS,
    detectionThreshold: 0.5,
    cooldownMs: 2000
  }), []);

  const engineRef = useRef(null);
  engineRef.current = engine;

  useEffect(() => {
    setStatus('Loading models…');
    setRecent([]);
    let unsubscribes = [];
    unsubscribes.push(engine.on('ready', () => setStatus('Models ready. Choose a mic and start.')));
    unsubscribes.push(engine.on('detect', ({ keyword, score, at }) => {
      setStatus(`Detected ${keyword} (${fmt(score)})`);
      setRecent((prev) => [{ keyword, score, at }, ...prev].slice(0, 5));
    }));
    unsubscribes.push(engine.on('speech-start', () => setSpeechActive(true)));
    unsubscribes.push(engine.on('speech-end', () => setSpeechActive(false)));
    unsubscribes.push(engine.on('error', (err) => {
      setError(err?.message || String(err));
      setStatus('Error');
    }));

    engine.load().catch((err) => {
      setError(err?.message || String(err));
      setStatus('Failed to load models');
    });

    refreshMics();

    return () => {
      unsubscribes.forEach((fn) => fn && fn());
      engine.stop();
      setIsListening(false);
      setSpeechActive(false);
    };
  }, [engine]);

  useEffect(() => {
    setRecent([]);
    engine.setActiveKeywords([activeKeyword]);
  }, [engine, activeKeyword]);

  const refreshMics = async () => {
    try {
      const list = await navigator.mediaDevices?.enumerateDevices?.();
      if (list) {
        const options = list.filter((d) => d.kind === 'audioinput');
        setDevices(options);
        if (!deviceId && options.length) setDeviceId(options[0].deviceId);
      }
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const start = async () => {
    setError('');
    try {
      await engine.start({ deviceId, gain: parseFloat(gain) });
      setIsListening(true);
      setStatus('Listening…');
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Could not start microphone');
    }
  };

  const stop = async () => {
    await engine.stop();
    setIsListening(false);
    setStatus('Stopped');
  };

  const runOfflineSample = async () => {
    setError('');
    try {
      const resp = await fetch('/openwakeword/hey_jarvis_11-2.wav');
      const buf = await resp.arrayBuffer();
      const score = await engine.runWav(buf);
      setRecent((prev) => [{ keyword: 'hey_jarvis', score, at: performance.now() }, ...prev].slice(0, 5));
      setStatus(`Offline sample score: ${fmt(score)}`);
    } catch (err) {
      setError(err?.message || String(err));
      setStatus('Offline test failed');
    }
  };

  return (
    <div className="wakeword-shell">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">OpenWakeWord · Browser</p>
            <h1>Wake word sandbox</h1>
          </div>
          <div className={`status-pill ${speechActive ? 'hot' : ''}`}>
            <span className="dot" />
            {speechActive ? 'Speech active' : 'Waiting'}
          </div>
        </div>

        <div className="controls">
          <div className="control">
            <label>Keyword</label>
            <select value={activeKeyword} onChange={(e) => setActiveKeyword(e.target.value)}>
              {KEYWORDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="control">
            <label>Microphone</label>
            <div className="mic-row">
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || 'Mic'}</option>
                ))}
              </select>
              <button className="ghost" onClick={refreshMics}>Refresh</button>
            </div>
          </div>
          <div className="control">
            <label>Gain</label>
            <input
              type="range"
              min="0.2"
              max="3"
              step="0.1"
              value={gain}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                setGain(value);
                engineRef.current?.setGain?.(value);
              }}
            />
            <span className="gain-value">{Math.round(gain * 100)}%</span>
          </div>
        </div>

        <div className="actions">
          {!isListening ? (
            <button className="primary" onClick={start}>Start listening</button>
          ) : (
            <button className="danger" onClick={stop}>Stop</button>
          )}
          <button className="ghost" onClick={runOfflineSample}>Run offline sample</button>
        </div>

        <div className="status-bar">
          <p>{status}</p>
          {error && <p className="error">⚠ {error}</p>}
        </div>
      </div>

      <div className="panel secondary">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Recent detections</p>
            <h2>Up to 5 hits</h2>
          </div>
        </div>
        {recent.length === 0 && <p className="muted">No wake words yet. Say “hey jarvis”.</p>}
        <div className="detections">
          {recent.map((item, idx) => (
            <div key={idx} className="card">
              <div className="card-row">
                <span className="tag">{item.keyword}</span>
                <span className="score">{fmt(item.score)}</span>
              </div>
              <p className="muted">{new Date(item.at || Date.now()).toLocaleTimeString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
