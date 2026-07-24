import React, { useEffect, useRef, useState } from 'react';
import { X, Mic, Send, Volume2, Sparkles, User, Bot, Radio, PhoneOff } from 'lucide-react';
import type { StructuredAssessResult } from '../types';
import { postTutor } from '../lib/tutorClient';
import {
  fetchStepRealtimeStatus,
  formatMicrophoneError,
  StepRealtimeSession,
  type StepRealtimeStatus,
} from '../lib/stepRealtime';

interface OralPracticeModalProps {
  onClose: () => void;
  reviewWords?: string[];
  onAssessed?: (text: string, result: StructuredAssessResult) => void;
}

type Mode = 'text' | 'voice';

export const OralPracticeModal: React.FC<OralPracticeModalProps> = ({
  onClose,
  reviewWords = [],
  onAssessed,
}) => {
  const [topic] = useState('Daily Routine & Speaking');
  const [mode, setMode] = useState<Mode>('text');
  const [speechText, setSpeechText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [stepStatus, setStepStatus] = useState<StepRealtimeStatus | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isVoiceLive, setIsVoiceLive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [debugLines, setDebugLines] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(true);
  const sessionRef = useRef<StepRealtimeSession | null>(null);
  const partialAiRef = useRef('');
  const streamingAiRef = useRef(false);

  const intro =
    reviewWords.length > 0
      ? `Hello! This is free oral practice (no article). If it fits naturally, try using: ${reviewWords.join(', ')}. What did you do today?`
      : "Hello! Welcome to Oral Practice mode — free speaking without an article. What did you do today, or what is your favorite hobby?";

  const [conversation, setConversation] = useState<
    Array<{ sender: 'user' | 'ai'; text: string }>
  >([{ sender: 'ai', text: intro }]);

  const pushDebug = (line: string) => {
    const stamp = new Date().toLocaleTimeString();
    setDebugLines((prev) => [`${stamp} ${line}`, ...prev].slice(0, 12));
  };

  useEffect(() => {
    void fetchStepRealtimeStatus().then(setStepStatus);
    return () => {
      sessionRef.current?.disconnect();
      sessionRef.current = null;
    };
  }, []);

  const handleSendSpeech = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!speechText.trim() || isAnalyzing) return;

    const userLine = speechText.trim();
    setSpeechText('');
    setConversation((prev) => [...prev, { sender: 'user', text: userLine }]);

    if (mode === 'voice' && sessionRef.current?.connected) {
      if (isRecording) {
        sessionRef.current.cancelRecording();
        setIsRecording(false);
      }
      setIsAnalyzing(true);
      setVoiceStatus('thinking');
      partialAiRef.current = '';
      streamingAiRef.current = false;
      sessionRef.current.sendText(userLine);
      return;
    }

    setIsAnalyzing(true);
    try {
      const response = await postTutor<StructuredAssessResult>({
        intent: 'oral_feedback',
        message: userLine,
        topic,
        reviewWords,
      });
      onAssessed?.(userLine, response.result);
      setConversation((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: response.result.reply || 'Great speech! Keep practicing your oral fluency.',
        },
      ]);
    } catch {
      const fallback: StructuredAssessResult = {
        reply: 'Good job speaking! Try one more sentence using a review word if you can.',
        errors: [],
        wordsUsedCorrectly: [],
        wordsUsedIncorrectly: [],
        weakPoints: [],
      };
      onAssessed?.(userLine, fallback);
      setConversation((prev) => [...prev, { sender: 'ai', text: fallback.reply }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  };

  const startVoice = async () => {
    setVoiceError(null);
    if (!stepStatus?.configured) {
      setVoiceError('未配置 STEP_API_KEY。请在 .env 中设置后重启服务。');
      return;
    }

    const session = new StepRealtimeSession(stepStatus.sampleRate || 24000, {
      onStatus: (status) => {
        setVoiceStatus(status);
        if (status === 'idle') setIsAnalyzing(false);
        if (status === 'disconnected') {
          setIsVoiceLive(false);
          setIsRecording(false);
          setIsAnalyzing(false);
        }
      },
      onError: (message) => {
        setVoiceError(message);
        setIsAnalyzing(false);
        pushDebug(`ERR ${message}`);
      },
      onDebug: (line) => pushDebug(line),
      onUserTranscript: (text) => {
        if (!text.trim()) return;
        setConversation((prev) => {
          const last = prev[prev.length - 1];
          if (last?.sender === 'user' && last.text === text) return prev;
          return [...prev, { sender: 'user', text }];
        });
      },
      onAssistantTextDelta: (delta) => {
        partialAiRef.current += delta;
        const snap = partialAiRef.current;
        setIsAnalyzing(true);
        setConversation((prev) => {
          const copy = [...prev];
          if (streamingAiRef.current && copy.length && copy[copy.length - 1].sender === 'ai') {
            copy[copy.length - 1] = { sender: 'ai', text: snap };
            return copy;
          }
          streamingAiRef.current = true;
          return [...copy, { sender: 'ai', text: snap }];
        });
      },
      onAssistantTextDone: (text) => {
        const finalText = text || partialAiRef.current;
        partialAiRef.current = '';
        streamingAiRef.current = false;
        if (!finalText.trim()) return;
        setConversation((prev) => {
          const copy = [...prev];
          if (copy.length && copy[copy.length - 1].sender === 'ai') {
            copy[copy.length - 1] = { sender: 'ai', text: finalText };
            return copy;
          }
          return [...copy, { sender: 'ai', text: finalText }];
        });
      },
    });

    sessionRef.current = session;
    try {
      setVoiceStatus('connecting');
      pushDebug('starting voice…');
      await session.preparePlayback();

      const reviewHint =
        reviewWords.length > 0
          ? `If natural, encourage the learner to use: ${reviewWords.join(', ')}.`
          : '';

      await session.connect(stepStatus.wsPath, {
        instructions: `You are a warm English oral practice partner for Chinese learners.
You receive the learner's spoken English as audio. Acknowledge what they said naturally.
Speak clear intermediate English; short turns; one follow-up question.
Brief Chinese only for hard words. Always answer with spoken audio.
${reviewHint}
Topic focus: ${topic}.`,
        voice: stepStatus.voice,
        modalities: ['text', 'audio'],
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: null,
      });

      await session.startMic();
      setIsVoiceLive(true);
      setIsRecording(true);
      setMode('voice');
      setVoiceStatus('listening');
      setConversation((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: '✅ 语音已连接，正在录音。请用英语说完一句，然后点「说完并发送」。',
        },
      ]);
      pushDebug('voice live + manual recording started');
    } catch (error) {
      const message = formatMicrophoneError(error);
      setVoiceError(message);
      setIsVoiceLive(false);
      setIsRecording(false);
      session.disconnect();
      if (sessionRef.current === session) sessionRef.current = null;
      setConversation((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: `❌ 无法启动实时语音：${message}`,
        },
      ]);
    }
  };

  const startRecording = async () => {
    const session = sessionRef.current;
    if (!session?.connected || isAnalyzing) return;
    setVoiceError(null);
    try {
      await session.preparePlayback();
      await session.startMic();
      setIsRecording(true);
      setVoiceStatus('listening');
      pushDebug('manual recording started');
    } catch (error) {
      const message = formatMicrophoneError(error);
      setVoiceError(message);
      setIsRecording(false);
      pushDebug(`ERR ${message}`);
    }
  };

  const stopVoice = () => {
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    setIsVoiceLive(false);
    setIsRecording(false);
    setVoiceStatus('idle');
    setIsAnalyzing(false);
    pushDebug('voice stopped');
  };

  const handleCommit = () => {
    const session = sessionRef.current;
    if (!session?.connected || !isRecording) return;
    const submitted = session.commitAndRespond();
    setIsRecording(false);
    if (!submitted) {
      setVoiceError('没有录到声音。请点「开始说话」后再说一次。');
      return;
    }
    setVoiceError(null);
    setIsAnalyzing(true);
    setVoiceStatus('thinking');
  };

  const handleClose = () => {
    stopVoice();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#FAF8F3] border border-[#E0DBCF] w-full max-w-lg rounded-2xl shadow-2xl p-6 relative flex flex-col h-[85vh]">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 text-[#777] hover:bg-[#EFEAE0] rounded-full z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 border-b border-[#E8E2D5] pb-3 mb-3">
          <Mic className="w-5 h-5 text-[#C35E37]" />
          <div className="flex-1 min-w-0">
            <h2 className="font-serif text-xl font-semibold text-[#2A2621]">纯口语陪练</h2>
            <p className="text-xs text-[#8C8478]">
              {topic}
              {stepStatus?.configured
                ? ` · Step 语音已配置`
                : ' · 未配置 STEP_API_KEY'}
            </p>
          </div>
        </div>

        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => {
              if (isVoiceLive) stopVoice();
              setMode('text');
            }}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${
              mode === 'text' ? 'bg-white text-[#C35E37] shadow-2xs' : 'bg-[#EFECE3] text-[#5B544C]'
            }`}
          >
            文本批改
          </button>
          <button
            type="button"
            onClick={() => setMode('voice')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${
              mode === 'voice' ? 'bg-white text-[#C35E37] shadow-2xs' : 'bg-[#EFECE3] text-[#5B544C]'
            }`}
          >
            实时语音
          </button>
        </div>

        {mode === 'voice' && (
          <div className="mb-3 p-3 rounded-xl border border-[#E3DDD1] bg-white text-xs text-[#5B544C] space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span>
                状态：<strong className="text-[#2C2723]">{voiceStatus}</strong>
                {isVoiceLive && (
                  <span className="ml-2 inline-flex items-center gap-1 text-emerald-700">
                    <Radio className="w-3 h-3 animate-pulse" /> Live
                  </span>
                )}
              </span>
              <div className="flex gap-1.5">
                {!isVoiceLive ? (
                  <button
                    type="button"
                    onClick={() => void startVoice()}
                    className="px-3 py-1.5 rounded-full bg-[#C35E37] text-white text-xs font-semibold"
                  >
                    开始语音
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={isRecording ? handleCommit : () => void startRecording()}
                      className={`px-3 py-1.5 rounded-full text-white text-xs font-semibold disabled:opacity-40 ${
                        isRecording ? 'bg-[#DC2626] animate-pulse' : 'bg-[#2563EB]'
                      }`}
                    >
                      {isRecording ? '说完并发送' : isAnalyzing ? '等待回复…' : '开始说话'}
                    </button>
                    <button
                      type="button"
                      onClick={stopVoice}
                      className="px-3 py-1.5 rounded-full bg-[#2C2723] text-white text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <PhoneOff className="w-3 h-3" /> 结束
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="text-[10px] text-[#9A9286] leading-relaxed">
              手动轮次更稳定：开始录音后说英语，说完点「说完并发送」；听完回复后再点「开始说话」。
            </p>
            {voiceError && <p className="text-red-600 font-medium">{voiceError}</p>}
            <button
              type="button"
              className="text-[10px] text-[#8C8478] underline"
              onClick={() => setShowDebug((v) => !v)}
            >
              {showDebug ? '隐藏' : '显示'}调试日志
            </button>
            {showDebug && (
              <pre className="max-h-24 overflow-y-auto text-[10px] leading-snug bg-[#F5F2EA] p-2 rounded-lg text-[#524B43] whitespace-pre-wrap">
                {debugLines.length ? debugLines.join('\n') : '（尚无日志）'}
              </pre>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-sm">
          {conversation.map((msg, idx) => (
            <div
              key={idx}
              className={`flex gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.sender === 'ai' && (
                <div className="w-8 h-8 rounded-full bg-[#EFECE3] border border-[#DDD6C8] flex items-center justify-center text-[#C35E37] shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <div
                className={`p-3.5 rounded-2xl max-w-[80%] ${
                  msg.sender === 'user'
                    ? 'bg-[#C35E37] text-white rounded-tr-xs'
                    : 'bg-white border border-[#E0DBCF] text-[#2C2722] rounded-tl-xs shadow-2xs'
                }`}
              >
                <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                {msg.sender === 'ai' && mode === 'text' && (
                  <button
                    onClick={() => handleSpeak(msg.text)}
                    className="mt-2 text-xs text-[#C35E37] flex items-center gap-1 font-medium hover:underline"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Listen</span>
                  </button>
                )}
              </div>
              {msg.sender === 'user' && (
                <div className="w-8 h-8 rounded-full bg-[#C35E37] text-white flex items-center justify-center shrink-0">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {isAnalyzing && mode === 'text' && (
            <div className="flex gap-2 items-center text-xs text-[#8C8478] p-2 bg-[#EFECE3] rounded-xl w-fit">
              <Sparkles className="w-3.5 h-3.5 text-[#C35E37] animate-spin" />
              <span>Analyzing…</span>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSendSpeech}
          className="mt-4 pt-3 border-t border-[#E8E2D5] flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => {
              setMode('voice');
              if (!isVoiceLive) void startVoice();
              else if (isRecording) handleCommit();
              else void startRecording();
            }}
            disabled={isVoiceLive && isAnalyzing}
            className={`p-3 rounded-full transition-colors disabled:opacity-40 ${
              isRecording
                ? 'bg-red-100 text-red-700 animate-pulse'
                : isVoiceLive
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-[#EFECE3] hover:bg-[#E3DCCF] text-[#C35E37]'
            }`}
            title={isRecording ? '说完并发送' : isVoiceLive ? '开始说话' : '开始 StepAudio 语音'}
          >
            <Mic className="w-5 h-5" />
          </button>

          <input
            type="text"
            value={speechText}
            onChange={(e) => setSpeechText(e.target.value)}
            placeholder={
              isRecording
                ? '正在录音，说完后点麦克风发送…'
                : isVoiceLive
                  ? '也可以打字发送…'
                  : '输入文字，或点麦克风开始语音'
            }
            className="flex-1 bg-white border border-[#DDD6C8] rounded-full px-4 py-2.5 text-sm outline-none focus:border-[#C35E37]"
          />

          <button
            type="submit"
            disabled={!speechText.trim() || (mode === 'text' && isAnalyzing)}
            className="p-2.5 bg-[#C35E37] hover:bg-[#A94E2B] disabled:opacity-40 text-white rounded-full transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
