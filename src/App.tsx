import React, { useState, useRef, useEffect } from 'react';
import { Upload, Settings, Play, Download, Copy, Check, FileText, Loader2, AlertCircle, Key, Brain, RefreshCw, Info, Shield, Video } from 'lucide-react';
import { parseSRT, Subtitle } from './lib/srtParser';
import {
  analyzeGlobalContext, processAllChunks, retryFailedChunks, setApiKeys, getKeyHealth,
  calculateOptimalChunking, AVAILABLE_MODELS, CHALKBOARD_STYLE, MYTHOLOGY_STYLE,
  HISTORY_STYLES, isHistoryStyle, getHistoryStyleConfig,
  GlobalContext, GenerationSettings, GeneratedPrompt, ModelId, FailedChunk, KeyHealthInfo,
  ProcessingResult, ChunkCalculation
} from './lib/gemini';
import { cn } from './lib/utils';

export default function App() {
  const [inputMode, setInputMode] = useState<'file' | 'text'>('file');
  const [pastedText, setPastedText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
  const [globalContext, setGlobalContext] = useState<GlobalContext | null>(null);
  const [prompts, setPrompts] = useState<GeneratedPrompt[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customTags, setCustomTags] = useState('');
  const [apiKeysText, setApiKeysText] = useState('');
  const [backupKeysText, setBackupKeysText] = useState('');
  const [showBackupKeys, setShowBackupKeys] = useState(false);
  const [fallbackLog, setFallbackLog] = useState<string[]>([]);
  // FIX 4: Failed chunks state for retry
  const [failedChunks, setFailedChunks] = useState<FailedChunk[]>([]);
  // FIX 10: Key health status
  const [keyHealth, setKeyHealth] = useState<KeyHealthInfo[]>([]);

  const [settings, setSettings] = useState<GenerationSettings>({
    eraOverride: 'Auto',
    style: 'Cinematic Realism',
    selectedModel: 'gemini-3-flash-preview' as ModelId,
    enhancementToggle: false,
    consistencyLock: true,
    sceneIntensity: 'Medium',
    cameraAngleVariation: true,
    thinkingMode: false,
    sacredProtocol: false,
    veoEnabled: false,
  });
  const [chunkSize, setChunkSize] = useState(5);
  const [autoChunk, setAutoChunk] = useState(true);
  const [preflight, setPreflight] = useState<ChunkCalculation | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isChalkboard = settings.style === CHALKBOARD_STYLE;
  const isMythology = settings.style === MYTHOLOGY_STYLE;
  const isHistory = isHistoryStyle(settings.style);
  const historyConfig = isHistory ? getHistoryStyleConfig(settings.style) : null;
  const getPrimaryKeyCount = () => apiKeysText.split('\n').filter(k => k.trim()).length;
  const getBackupKeyCount = () => backupKeysText.split('\n').filter(k => k.trim()).length;
  const getActiveKeyCount = () => getPrimaryKeyCount() + getBackupKeyCount();

  // MODULE 2: Auto-calculate optimal chunking when inputs change
  useEffect(() => {
    if (subtitles.length > 0 && getActiveKeyCount() > 0) {
      const calc = calculateOptimalChunking(subtitles.length, getActiveKeyCount());
      setPreflight(calc);
      if (autoChunk) setChunkSize(calc.chunkSize);
    } else {
      setPreflight(null);
    }
  }, [subtitles.length, apiKeysText, autoChunk]);

  // FIX 10: Poll key health during processing
  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(() => {
      setKeyHealth(getKeyHealth());
    }, 2000);
    return () => clearInterval(interval);
  }, [isProcessing]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        const parsed = parseSRT(content);
        setSubtitles(parsed);
        setPrompts([]);
        setGlobalContext(null);
        setError(null);
        setFailedChunks([]);
      };
      reader.readAsText(selectedFile);
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setPastedText(text);
    const parsed = parseSRT(text);
    setSubtitles(parsed);
    setPrompts([]);
    setGlobalContext(null);
    setError(null);
    setFailedChunks([]);
  };

  const handleFallback = (failedModel: string, nextModel: string, _error: string) => {
    const msg = `${failedModel} failed → switching to ${nextModel}`;
    setFallbackLog(prev => [...prev, msg]);
  };

  const startProcessing = async () => {
    if (subtitles.length === 0) return;

    const primaryKeys = apiKeysText.split('\n').filter(k => k.trim());
    const backupKeys = backupKeysText.split('\n').filter(k => k.trim());
    const allKeys = [...primaryKeys, ...backupKeys];
    if (allKeys.length === 0) {
      setError('Please add at least one API key.');
      return;
    }

    setApiKeys(allKeys);
    setIsProcessing(true);
    setError(null);
    setPrompts([]);
    setFailedChunks([]);
    setFallbackLog([]);
    setKeyHealth([]);
    setProgress({ current: 0, total: subtitles.length, status: 'Analyzing global context...' });

    try {
      let context = globalContext;
      if (!context) {
        context = await analyzeGlobalContext(subtitles, settings, handleFallback);
        setGlobalContext(context);
      }

      setProgress({ current: 0, total: subtitles.length, status: 'Generating prompts...' });

      // FIX 4+6: processAllChunks now returns ProcessingResult
      const result: ProcessingResult = await processAllChunks(
        subtitles,
        context,
        settings,
        chunkSize,
        (currentPrompts, processedCount, total, status) => {
          setPrompts(currentPrompts);
          setProgress({ current: processedCount, total, status });
        },
        handleFallback
      );

      let currentPrompts = result.prompts;
      let currentFailed = result.failedChunks;
      setPrompts(currentPrompts);
      setFailedChunks(currentFailed);

      // Auto-retry up to 3 times — always rebuild from missing IDs (not failed chunks)
      const MAX_AUTO_RETRIES = 3;
      for (let autoRetry = 1; autoRetry <= MAX_AUTO_RETRIES; autoRetry++) {
        // Check actual missing by ID comparison (not failedChunks)
        const existingIds = new Set(currentPrompts.map(p => p.id));
        const missingSubs = subtitles.filter(s => !existingIds.has(s.id));
        if (missingSubs.length === 0) break;

        setProgress({
          current: currentPrompts.length,
          total: subtitles.length,
          status: `Auto-recovering ${missingSubs.length} missing prompts (attempt ${autoRetry}/${MAX_AUTO_RETRIES})...`
        });

        // Short wait + fresh key init
        await new Promise(resolve => setTimeout(resolve, 1000));
        const allRetryKeys = [...primaryKeys, ...backupKeys];
        setApiKeys(allRetryKeys);

        // Build individual chunks (1 subtitle each) — prevents model from skipping any
        const individualChunks: FailedChunk[] = missingSubs.map((s, i) => ({
          chunkIndex: i, subtitles: [s], error: 'Missing'
        }));

        const retryResult = await retryFailedChunks(
          individualChunks, context, settings,
          (retryPrompts, processedCount, total, status) => {
            const merged = [...currentPrompts, ...retryPrompts];
            merged.sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
            const seen = new Set<string>();
            const deduped = merged.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
            setPrompts(deduped);
            setProgress({ current: processedCount, total, status: `Auto-retry ${autoRetry}: ${status}` });
          },
          handleFallback
        );

        // Merge results
        const merged = [...currentPrompts, ...retryResult.prompts];
        merged.sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
        const seen = new Set<string>();
        currentPrompts = merged.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
        currentFailed = retryResult.failedChunks;
        setPrompts(currentPrompts);
        setFailedChunks(currentFailed);
      }

      // Final status — check actual prompt IDs vs subtitle IDs (not just count)
      const existingIds = new Set(currentPrompts.map(p => p.id));
      const missingIds = subtitles.filter(s => !existingIds.has(s.id)).map(s => s.id);

      if (missingIds.length === 0) {
        setProgress({ current: subtitles.length, total: subtitles.length, status: 'Complete! All prompts generated.' });
      } else {
        // Some prompts lost inside successful chunks — send each individually
        const missingSubs = subtitles.filter(s => !existingIds.has(s.id));
        const missingChunks: FailedChunk[] = missingSubs.map((s, i) => ({
          chunkIndex: i, subtitles: [s], error: 'Missing from response'
        }));
        setFailedChunks(missingChunks);
        setProgress({
          current: currentPrompts.length,
          total: subtitles.length,
          status: `${currentPrompts.length}/${subtitles.length} done — ${missingIds.length} prompts need recovery`
        });
        setError(`${missingIds.length} prompts still missing. IDs: ${missingIds.join(', ')}. Click "Recover" to try again.`);
      }
    } catch (err: unknown) {
      console.error(err);
      setError((err as { message?: string })?.message || 'An error occurred during processing.');
    } finally {
      setIsProcessing(false);
      setKeyHealth(getKeyHealth());
    }
  };

  // Retry failed/missing chunks — accepts optional chunks override
  const retryFailed = async (overrideChunks?: FailedChunk[]) => {
    const chunksToRetry = overrideChunks || failedChunks;

    // If no explicit chunks, build from missing IDs — send EACH subtitle individually
    if (chunksToRetry.length === 0 && prompts.length < subtitles.length && globalContext) {
      const existingIds = new Set(prompts.map(p => p.id));
      const missingSubs = subtitles.filter(s => !existingIds.has(s.id));
      if (missingSubs.length === 0) return;
      // Chunk size 1 per missing subtitle — prevents model from skipping any
      const built: FailedChunk[] = missingSubs.map((s, i) => ({
        chunkIndex: i, subtitles: [s], error: 'Missing'
      }));
      return retryFailed(built);
    }

    if (chunksToRetry.length === 0 || !globalContext) return;

    const allRetryKeys = [...apiKeysText.split('\n').filter(k => k.trim()), ...backupKeysText.split('\n').filter(k => k.trim())];
    setApiKeys(allRetryKeys);
    setIsProcessing(true);
    setError(null);
    setFallbackLog([]);
    const previousPrompts = [...prompts];

    try {
      const result = await retryFailedChunks(
        chunksToRetry,
        globalContext,
        settings,
        (retryPrompts, processedCount, total, status) => {
          setPrompts([...previousPrompts, ...retryPrompts]);
          setProgress({ current: processedCount, total, status });
        },
        handleFallback
      );

      const merged = [...previousPrompts, ...result.prompts];
      merged.sort((a, b) => (parseInt(a.id) || 0) - (parseInt(b.id) || 0));
      // Deduplicate by ID
      const seen = new Set<string>();
      const deduped = merged.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
      setPrompts(deduped);

      // Check actual missing by ID comparison
      const recoveredIds = new Set(deduped.map(p => p.id));
      const stillMissingIds = subtitles.filter(s => !recoveredIds.has(s.id)).map(s => s.id);

      if (stillMissingIds.length === 0) {
        setFailedChunks([]);
        setProgress({ current: subtitles.length, total: subtitles.length, status: `Complete! All ${subtitles.length} prompts generated.` });
      } else {
        // Build failedChunks — each missing subtitle individually
        const stillMissingSubs = subtitles.filter(s => !recoveredIds.has(s.id));
        const newFailed: FailedChunk[] = stillMissingSubs.map((s, i) => ({
          chunkIndex: i, subtitles: [s], error: 'Still missing'
        }));
        setFailedChunks(newFailed);
        setProgress({ current: deduped.length, total: subtitles.length, status: `${deduped.length}/${subtitles.length} done — ${stillMissingIds.length} still missing` });
        setError(`${stillMissingIds.length} prompts still missing. IDs: ${stillMissingIds.join(', ')}`);
      }
    } catch (err: unknown) {
      console.error(err);
      setError((err as { message?: string })?.message || 'Retry failed.');
    } finally {
      setIsProcessing(false);
      setKeyHealth(getKeyHealth());
    }
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      // Fallback for HTTP (non-secure context)
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  };

  const formatPrompts = () => {
    return prompts.map(p => {
      let t = `Prompt ${p.id}: ${p.prompt}`;
      if (p.videoPrompt) t += `\n\nVideo Prompt ${p.id}: ${p.videoPrompt}`;
      return t;
    }).join('\n\n');
  };

  const copyAll = () => {
    copyToClipboard(formatPrompts());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportTxt = () => {
    const text = formatPrompts();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompts.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompts.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // FIX 9: CSV Export
  const exportCsv = () => {
    const header = 'id,start_time,end_time,subtitle_text,image_prompt';
    const rows = prompts.map(p => {
      const sub = subtitles.find(s => s.id === p.id);
      const escapeCsv = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [
        p.id,
        sub?.startTime || '',
        sub?.endTime || '',
        escapeCsv(sub?.text || ''),
        escapeCsv(p.prompt)
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prompts.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const applyTags = () => {
    if (!customTags.trim() || prompts.length === 0) return;
    const tagsToApply = customTags.split(',').map(t => t.trim()).filter(t => t);
    if (tagsToApply.length === 0) return;

    setPrompts(prevPrompts => prevPrompts.map(p => {
      let newPrompt = p.prompt.trim();
      const tagsToAdd = tagsToApply.filter(tag => !newPrompt.toLowerCase().includes(tag.toLowerCase()));
      if (tagsToAdd.length > 0) {
        let separator = ', ';
        if (newPrompt.endsWith(',')) separator = ' ';
        else if (newPrompt.endsWith('.')) separator = ' ';
        newPrompt = `${newPrompt}${separator}${tagsToAdd.join(', ')}`;
      }
      return { ...p, prompt: newPrompt };
    }));
  };

  const loadSample = () => {
    const sampleSrt = `1
00:00:01,000 --> 00:00:04,000
The French cavalry charges across the muddy field.

2
00:00:05,000 --> 00:00:08,000
British infantry form squares to repel the attack.

3
00:00:09,000 --> 00:00:12,000
Cannon fire erupts from the ridge, tearing through the ranks.

4
00:00:13,000 --> 00:00:16,000
Napoleon watches grimly from his vantage point.`;

    setInputMode('text');
    setPastedText(sampleSrt);
    const parsed = parseSRT(sampleSrt);
    setFile(null);
    setSubtitles(parsed);
    setPrompts([]);
    setGlobalContext(null);
    setError(null);
    setFailedChunks([]);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-amber-500/30">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-amber-600 flex items-center justify-center font-bold text-white shadow-lg shadow-amber-900/20">
              SP
            </div>
            <h1 className="text-xl font-semibold tracking-tight">SRT to Image Prompt Pro</h1>
          </div>
          <div className="text-sm text-zinc-400 font-medium">
            Historical Battle Edition
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">

        {/* Left Sidebar - Settings */}
        <div className="lg:col-span-4 space-y-6">

          {/* API Keys Section */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-500" />
                API Keys
              </h2>
              <div className="flex items-center gap-1.5">
                {getPrimaryKeyCount() > 0 && (
                  <span className="bg-amber-500/10 text-amber-400 text-xs font-medium py-0.5 px-2 rounded-full border border-amber-500/20">
                    {getPrimaryKeyCount()} active
                  </span>
                )}
                {getBackupKeyCount() > 0 && (
                  <span className="bg-emerald-500/10 text-emerald-400 text-xs font-medium py-0.5 px-2 rounded-full border border-emerald-500/20">
                    +{getBackupKeyCount()} backup
                  </span>
                )}
              </div>
            </div>
            <textarea
              value={apiKeysText}
              onChange={e => setApiKeysText(e.target.value)}
              placeholder={"Paste your Gemini API key(s) here\nOne key per line for parallel processing"}
              className="w-full h-24 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 resize-none font-mono placeholder:text-zinc-600"
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-zinc-500">Primary keys = parallel workers</p>
              <button onClick={() => setShowBackupKeys(!showBackupKeys)}
                className="text-xs text-zinc-500 hover:text-amber-400 transition-colors">
                {showBackupKeys ? 'Hide' : 'Add'} Backup Keys
              </button>
            </div>

            {/* Backup Keys */}
            {showBackupKeys && (
              <div className="mt-3 pt-3 border-t border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-zinc-400">Backup Keys</span>
                  {getBackupKeyCount() > 0 && (
                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-medium py-0.5 px-1.5 rounded-full border border-emerald-500/20">
                      {getBackupKeyCount()} standby
                    </span>
                  )}
                </div>
                <textarea
                  value={backupKeysText}
                  onChange={e => setBackupKeysText(e.target.value)}
                  placeholder={"Backup API key(s) — used when primary keys fail\nOne key per line"}
                  className="w-full h-16 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 resize-none font-mono placeholder:text-zinc-600"
                />
                <p className="text-xs text-zinc-600 mt-1">Auto-activate when primary keys get blacklisted</p>
              </div>
            )}

            {/* Key Health Status */}
            {keyHealth.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-zinc-800">
                {keyHealth.map((kh, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs bg-zinc-950 px-2 py-1 rounded-md">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      kh.status === 'healthy' ? "bg-green-500" :
                      kh.status === 'degraded' ? "bg-yellow-500" : "bg-red-500"
                    )} />
                    <span className="text-zinc-500 font-mono">{kh.keyId}</span>
                    {kh.status === 'blacklisted' && (
                      <span className="text-red-400 text-[10px]">cooldown</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input Source */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium flex items-center gap-2">
                <Upload className="w-5 h-5 text-amber-500" />
                Input Source
              </h2>
              <div className="flex bg-zinc-950 rounded-lg p-1 border border-zinc-800">
                <button
                  onClick={() => setInputMode('file')}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", inputMode === 'file' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300")}
                >
                  File
                </button>
                <button
                  onClick={() => setInputMode('text')}
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", inputMode === 'text' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300")}
                >
                  Paste
                </button>
              </div>
            </div>

            {inputMode === 'file' ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  file ? "border-amber-500/50 bg-amber-500/5" : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/50"
                )}
              >
                <input
                  type="file"
                  accept=".srt"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                />
                {file ? (
                  <div className="space-y-2">
                    <FileText className="w-8 h-8 text-amber-500 mx-auto" />
                    <p className="font-medium text-zinc-200">{file.name}</p>
                    <p className="text-xs text-zinc-400">{subtitles.length} subtitles detected</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-8 h-8 text-zinc-500 mx-auto" />
                    <p className="font-medium text-zinc-300">Click to upload SRT file</p>
                    <p className="text-xs text-zinc-500">Standard SubRip format</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); loadSample(); }}
                      className="mt-4 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 rounded transition-colors"
                    >
                      Load Sample SRT
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  value={pastedText}
                  onChange={handleTextChange}
                  placeholder="Paste your SRT content here..."
                  className="w-full h-48 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-300 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 resize-none font-mono"
                />
                <div className="flex justify-between items-center text-xs text-zinc-500 px-1">
                  <span>{subtitles.length} subtitles detected</span>
                  <button onClick={loadSample} className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors">
                    Load Sample
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl space-y-5">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Settings className="w-5 h-5 text-amber-500" />
              Generation Engine
            </h2>

            <div className="space-y-4">
              {/* Model Selection */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300">AI Model</label>
                <select
                  value={settings.selectedModel}
                  onChange={e => setSettings({...settings, selectedModel: e.target.value as ModelId})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-zinc-300"
                >
                  {AVAILABLE_MODELS.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.description} ({m.rpm} RPM)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-zinc-600">Auto-fallback: if selected model fails, next model tried automatically</p>
              </div>

              {/* Thinking Mode */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input type="checkbox" className="sr-only" checked={settings.thinkingMode}
                      onChange={e => setSettings({...settings, thinkingMode: e.target.checked})} />
                    <div className={cn("w-10 h-5 rounded-full transition-colors", settings.thinkingMode ? "bg-purple-500" : "bg-zinc-700")}></div>
                    <div className={cn("absolute left-1 top-1 w-3 h-3 rounded-full bg-white transition-transform", settings.thinkingMode ? "translate-x-5" : "translate-x-0")}></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-purple-400" />
                    <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">Thinking Mode</span>
                  </div>
                </label>
                <p className="text-xs text-zinc-600 pl-[52px]">Better reasoning, but slower and uses more tokens</p>
              </div>

              {/* Visual Style */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300">Visual Style</label>
                <select value={settings.style}
                  onChange={e => {
                    const newStyle = e.target.value;
                    const updates: Partial<GenerationSettings> = { style: newStyle };
                    if (newStyle === CHALKBOARD_STYLE) {
                      setChunkSize(5);
                      updates.eraOverride = 'Auto';
                    } else if (newStyle === MYTHOLOGY_STYLE) {
                      setChunkSize(7);
                      updates.eraOverride = 'Auto';
                      updates.cameraAngleVariation = true;
                    } else if (isHistoryStyle(newStyle)) {
                      const hc = getHistoryStyleConfig(newStyle)!;
                      setChunkSize(hc.chunkSize);
                      updates.eraOverride = 'Auto';
                      updates.cameraAngleVariation = true;
                      updates.sacredProtocol = true;
                    }
                    setSettings(prev => ({ ...prev, ...updates }));
                  }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50">
                  <option value="Cinematic Realism">Cinematic Realism (Default)</option>
                  <option value="Old Oil Painting">Old Oil Painting</option>
                  <option value="2D Comic Novel Style">2D Comic Novel Style</option>
                  <option value="Dark War Documentary Style">Dark War Documentary Style</option>
                  <option value="Vintage Historical Illustration">Vintage Historical Illustration</option>
                  <option value={CHALKBOARD_STYLE}>Chalkboard</option>
                  <option value={MYTHOLOGY_STYLE}>Greek Mythology Dark Fantasy</option>
                  <option disabled>──── HISTORY STYLES ────</option>
                  {Object.entries(HISTORY_STYLES).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.label}</option>
                  ))}
                </select>
              </div>

              {/* Chalkboard info tooltip */}
              {isChalkboard && (
                <div className="flex items-start gap-2 p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                  <Info className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-purple-300/80 leading-relaxed">
                    White chalk on dark blackboard. Scientific diagrams with formulas, anatomical cross-sections, graphs. Best for: Science explainers, medical, physics videos.
                  </p>
                </div>
              )}

              {/* Mythology info tooltip + toggles */}
              {isMythology && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                    <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-300/80 leading-relaxed">
                      Dark fantasy cinematic style for mythology videos. Character consistency via auto-generated Character Cards, era-accurate details, dramatic lighting. Best for: Mythology, ancient history, fantasy storytelling.
                    </p>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                      <input type="checkbox" className="sr-only" checked={settings.veoEnabled}
                        onChange={e => setSettings({...settings, veoEnabled: e.target.checked})} />
                      <div className={cn("w-10 h-5 rounded-full transition-colors", settings.veoEnabled ? "bg-blue-500" : "bg-zinc-700")}></div>
                      <div className={cn("absolute left-1 top-1 w-3 h-3 rounded-full bg-white transition-transform", settings.veoEnabled ? "translate-x-5" : "translate-x-0")}></div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Video className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">Veo Video Prompts</span>
                    </div>
                  </label>
                </div>
              )}

              {/* History style info tooltip */}
              {isHistory && historyConfig && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 p-3 bg-orange-500/5 border border-orange-500/20 rounded-lg">
                    <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-orange-300/80 leading-relaxed space-y-1">
                      <p>{historyConfig.description}</p>
                      <p className="text-orange-400/60">Chunk: {historyConfig.chunkSize} | ~{historyConfig.targetWords} words/prompt
                        {historyConfig.needsCharacterCards && ' | Character Cards'}
                        {historyConfig.autoColorBW && ' | Auto Color/B&W'}
                        {historyConfig.wordCountByDuration && ' | Word count by duration'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Era / Domain Selection — changes based on style */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300">
                  {isChalkboard ? 'Scientific Domain' : isMythology ? 'Mythology Era' : 'Historical Era'}
                </label>
                <select value={settings.eraOverride} onChange={e => setSettings({...settings, eraOverride: e.target.value})}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50">
                  <option value="Auto">Auto-detect from SRT</option>
                  {isChalkboard ? (
                    <>
                      <option value="Human Biology & Physiology">Human Biology & Physiology</option>
                      <option value="Physics & Mechanics">Physics & Mechanics</option>
                      <option value="Chemistry & Biochemistry">Chemistry & Biochemistry</option>
                      <option value="Neuroscience & Psychology">Neuroscience & Psychology</option>
                      <option value="Astronomy & Astrophysics">Astronomy & Astrophysics</option>
                      <option value="Mathematics & Statistics">Mathematics & Statistics</option>
                      <option value="Medicine & Pathology">Medicine & Pathology</option>
                      <option value="Environmental Science">Environmental Science</option>
                    </>
                  ) : isMythology ? (
                    <>
                      <option value="Greek Mythology (Bronze Age/Classical)">Greek Mythology (Bronze Age/Classical)</option>
                      <option value="Norse Mythology (Viking Age)">Norse Mythology (Viking Age)</option>
                      <option value="Egyptian Mythology (Dynasty Era)">Egyptian Mythology (Dynasty Era)</option>
                      <option value="Islamic/Pre-Islamic Mythology">Islamic/Pre-Islamic Mythology</option>
                      <option value="Hindu Mythology (Vedic/Puranic)">Hindu Mythology (Vedic/Puranic)</option>
                      <option value="Custom">Custom</option>
                    </>
                  ) : (
                    <>
                      <option value="Ancient (Roman, Greek, Persian)">Ancient (Roman, Greek, Persian)</option>
                      <option value="Medieval">Medieval</option>
                      <option value="Sengoku Jidai (Feudal Japan)">Sengoku Jidai (Feudal Japan)</option>
                      <option value="Napoleonic Wars">Napoleonic Wars</option>
                      <option value="American Civil War">American Civil War</option>
                      <option value="World War I">World War I</option>
                      <option value="World War II">World War II</option>
                      <option value="Vietnam War">Vietnam War</option>
                    </>
                  )}
                </select>
              </div>

              {/* Chunk Size + Auto */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-zinc-300">Chunk Size</label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={autoChunk} onChange={e => setAutoChunk(e.target.checked)}
                        className="w-3 h-3 accent-amber-500" />
                      <span className="text-xs text-zinc-500">Auto</span>
                    </label>
                    <span className="text-xs text-zinc-500">{chunkSize} subs/batch</span>
                  </div>
                </div>
                {!autoChunk && (
                  <input type="range" min="3" max="20" step="1" value={chunkSize}
                    onChange={e => setChunkSize(parseInt(e.target.value))} className="w-full accent-amber-500" />
                )}
                {/* MODULE 2: Preflight estimate */}
                {preflight && (
                  <div className="bg-zinc-950 rounded-md p-2.5 text-xs text-zinc-500 space-y-1 border border-zinc-800">
                    <div className="flex justify-between">
                      <span>{preflight.totalChunks} chunks</span>
                      <span>~{preflight.estimatedTimeStr}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>{preflight.tokensPerChunk} tok/chunk</span>
                      <span className="text-green-500">{preflight.safetyMargin}% margin</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-zinc-800 space-y-3">
                <label className="text-sm font-medium text-zinc-300 block mb-2">Advanced Controls</label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input type="checkbox" className="sr-only" checked={settings.enhancementToggle}
                      onChange={e => setSettings({...settings, enhancementToggle: e.target.checked})} />
                    <div className={cn("w-10 h-5 rounded-full transition-colors", settings.enhancementToggle ? "bg-amber-500" : "bg-zinc-700")}></div>
                    <div className={cn("absolute left-1 top-1 w-3 h-3 rounded-full bg-white transition-transform", settings.enhancementToggle ? "translate-x-5" : "translate-x-0")}></div>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">Ultra-Detailed Prompts</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center">
                    <input type="checkbox" className="sr-only" checked={settings.consistencyLock}
                      onChange={e => setSettings({...settings, consistencyLock: e.target.checked})} />
                    <div className={cn("w-10 h-5 rounded-full transition-colors", settings.consistencyLock ? "bg-amber-500" : "bg-zinc-700")}></div>
                    <div className={cn("absolute left-1 top-1 w-3 h-3 rounded-full bg-white transition-transform", settings.consistencyLock ? "translate-x-5" : "translate-x-0")}></div>
                  </div>
                  <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">Consistency Lock</span>
                </label>

                {/* Hide Dynamic Camera Angles in chalkboard mode only */}
                {!isChalkboard && (
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative flex items-center">
                      <input type="checkbox" className="sr-only" checked={settings.cameraAngleVariation}
                        onChange={e => setSettings({...settings, cameraAngleVariation: e.target.checked})} />
                      <div className={cn("w-10 h-5 rounded-full transition-colors", settings.cameraAngleVariation ? "bg-amber-500" : "bg-zinc-700")}></div>
                      <div className={cn("absolute left-1 top-1 w-3 h-3 rounded-full bg-white transition-transform", settings.cameraAngleVariation ? "translate-x-5" : "translate-x-0")}></div>
                    </div>
                    <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">Dynamic Camera Angles</span>
                  </label>
                )}

                {/* Sacred Figure Protocol — all styles except chalkboard */}
                {!isChalkboard && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <div className="relative flex items-center">
                        <input type="checkbox" className="sr-only" checked={settings.sacredProtocol}
                          onChange={e => setSettings({...settings, sacredProtocol: e.target.checked})} />
                        <div className={cn("w-10 h-5 rounded-full transition-colors", settings.sacredProtocol ? "bg-emerald-500" : "bg-zinc-700")}></div>
                        <div className={cn("absolute left-1 top-1 w-3 h-3 rounded-full bg-white transition-transform", settings.sacredProtocol ? "translate-x-5" : "translate-x-0")}></div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">Sacred Figure Protocol</span>
                      </div>
                    </label>
                    {settings.sacredProtocol && (
                      <div className="p-2.5 bg-emerald-500/5 border border-emerald-500/15 rounded-lg text-xs text-emerald-300/70 space-y-1 ml-[52px]">
                        <p>T1 Prophets — Noor light only</p>
                        <p>T2 Angels — Abstract luminous</p>
                        <p>T3 Antagonists — Depictable</p>
                        <p>T4 Others — Fully depictable</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Scene Intensity — hidden for chalkboard, different options for mythology */}
                {!isChalkboard && (
                  <div className="space-y-1.5 pt-2">
                    <label className="text-sm font-medium text-zinc-400">Scene Intensity</label>
                    <select value={settings.sceneIntensity} onChange={e => setSettings({...settings, sceneIntensity: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-zinc-300">
                      {isMythology ? (
                        <>
                          <option value="Ethereal (Divine/Peaceful)">Ethereal (Divine/Peaceful)</option>
                          <option value="Dramatic (Conflict/Tension)">Dramatic (Conflict/Tension)</option>
                          <option value="Apocalyptic (Battle/Destruction)">Apocalyptic (Battle/Destruction)</option>
                        </>
                      ) : (
                        <>
                          <option value="Low (Calm before battle, marching)">Low (Calm, marching)</option>
                          <option value="Medium (Skirmish, tension)">Medium (Skirmish, tension)</option>
                          <option value="High (Full battle, chaotic)">High (Full battle, chaotic)</option>
                          <option value="Brutal (Visceral war scenes, destruction)">Brutal (Visceral, destruction)</option>
                        </>
                      )}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={startProcessing}
              disabled={subtitles.length === 0 || isProcessing || getActiveKeyCount() === 0}
              className="w-full mt-6 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {isProcessing ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  Generate Prompts
                  {getActiveKeyCount() > 1 && <span className="text-xs opacity-70">({getActiveKeyCount()} keys)</span>}
                </>
              )}
            </button>


            {error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Area - Output */}
        <div className="lg:col-span-8 flex flex-col h-[calc(100vh-8rem)]">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl flex flex-col h-full overflow-hidden">

            {/* Output Header */}
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/80 backdrop-blur-sm z-10">
              <h2 className="text-lg font-medium flex items-center gap-2">
                Output Prompts
                {prompts.length > 0 && (
                  <span className="bg-zinc-800 text-zinc-300 text-xs py-0.5 px-2 rounded-full">{prompts.length}</span>
                )}
                {failedChunks.length > 0 && (
                  <span className="bg-amber-500/10 text-amber-400 text-xs py-0.5 px-2 rounded-full border border-amber-500/20">
                    {failedChunks.reduce((s, f) => s + f.subtitles.length, 0)} pending
                  </span>
                )}
              </h2>

              <div className="flex items-center gap-2">
                {/* Recover button — in header for easy access */}
                {prompts.length > 0 && prompts.length < subtitles.length && !isProcessing && (
                  <button onClick={() => retryFailed()}
                    className="px-3 py-1.5 text-sm font-medium text-amber-300 hover:text-white bg-amber-600/20 hover:bg-amber-600 border border-amber-500/30 rounded-md transition-colors flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Recover {subtitles.length - prompts.length}
                  </button>
                )}
                <button onClick={copyAll} disabled={prompts.length === 0}
                  className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Copy All">
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
                <div className="w-px h-4 bg-zinc-700 mx-1"></div>
                <button onClick={exportTxt} disabled={prompts.length === 0}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  <Download className="w-4 h-4" /> TXT
                </button>
                {/* FIX 9: CSV Export Button */}
                <button onClick={exportCsv} disabled={prompts.length === 0}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  <Download className="w-4 h-4" /> CSV
                </button>
                <button onClick={exportJson} disabled={prompts.length === 0}
                  className="px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  <Download className="w-4 h-4" /> JSON
                </button>
              </div>
            </div>

            {/* Context Info Bar */}
            {globalContext && (
              <div className="bg-zinc-950/50 border-b border-zinc-800 px-5 py-3 text-xs text-zinc-400 flex flex-wrap gap-x-6 gap-y-2">
                <div><span className="text-zinc-500">Detected Era:</span> <span className="text-amber-400/90 font-medium">{globalContext.era}</span></div>
                <div><span className="text-zinc-500">Factions:</span> <span className="text-zinc-300">{globalContext.factions}</span></div>
                <div><span className="text-zinc-500">Tone:</span> <span className="text-zinc-300">{globalContext.tone}</span></div>
              </div>
            )}

            {/* Custom Tags Bar */}
            {prompts.length > 0 && !isProcessing && (
              <div className="bg-zinc-900 border-b border-zinc-800 px-5 py-3 flex items-center gap-3">
                <div className="flex-1 relative">
                  <input type="text" value={customTags} onChange={e => setCustomTags(e.target.value)}
                    placeholder="Add custom tags (e.g. no text, cinematic lighting, ultra detailed)"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-3 pr-4 py-2 text-sm text-zinc-300 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50" />
                </div>
                <button onClick={applyTags} disabled={!customTags.trim()}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-200 text-sm font-medium rounded-md transition-colors whitespace-nowrap">
                  Apply Tags to All Prompts
                </button>
              </div>
            )}

            {/* Progress Bar */}
            {isProcessing && (
              <div className="px-5 py-3 bg-zinc-900 border-b border-zinc-800">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-amber-500 font-medium">{progress.status}</span>
                  <span className="text-zinc-400">{progress.current} / {progress.total}</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 transition-all duration-300 ease-out"
                    style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}></div>
                </div>
              </div>
            )}

            {/* Model Switch Info — subtle, non-alarming */}
            {fallbackLog.length > 0 && (
              <div className="px-5 py-1.5 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></div>
                <p className="text-xs text-zinc-500">Auto-optimizing model selection ({fallbackLog.length} switch{fallbackLog.length > 1 ? 'es' : ''})</p>
              </div>
            )}

            {/* Missing prompts warning with IDs */}
            {prompts.length > 0 && prompts.length < subtitles.length && !isProcessing && (
              <div className="px-5 py-3 bg-amber-500/5 border-b border-amber-500/20">
                <p className="text-xs text-amber-400 font-medium">
                  {prompts.length} of {subtitles.length} prompts ready — {subtitles.length - prompts.length} missing
                </p>
                <p className="text-xs text-zinc-500 mt-1 font-mono truncate">
                  Missing IDs: {subtitles.filter(s => !prompts.some(p => p.id === s.id)).map(s => s.id).join(', ')}
                </p>
                <p className="text-xs text-zinc-600 mt-1">Click "Recover" button above to retry these prompts</p>
              </div>
            )}

            {/* Prompt List */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-zinc-950/30">
              {prompts.length === 0 && !isProcessing ? (
                <div className="h-full flex flex-col items-center justify-center text-zinc-500 space-y-4">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center">
                    <FileText className="w-8 h-8 opacity-50" />
                  </div>
                  <p>Provide an SRT file or paste text, then click Generate to see prompts here.</p>
                </div>
              ) : (
                prompts.map((prompt, idx) => (
                  <div key={idx} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 group hover:border-zinc-700 transition-colors">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="bg-zinc-800 text-zinc-400 text-xs font-mono px-2 py-0.5 rounded">{prompt.id}</span>
                        {(prompt as Record<string, unknown>).colorMode && (
                          <span className={cn("text-xs px-1.5 py-0.5 rounded",
                            (prompt as Record<string, unknown>).colorMode === 'bw' ? "bg-zinc-700 text-zinc-300" : "bg-amber-500/10 text-amber-400"
                          )}>{(prompt as Record<string, unknown>).colorMode === 'bw' ? 'B&W' : 'Color'}</span>
                        )}
                        {subtitles.find(s => s.id === prompt.id) && (
                          <span className="text-xs text-zinc-500 truncate max-w-[300px]" title={subtitles.find(s => s.id === prompt.id)?.text}>
                            "{subtitles.find(s => s.id === prompt.id)?.text}"
                          </span>
                        )}
                      </div>
                      <button onClick={() => copyToClipboard(prompt.prompt)}
                        className="text-zinc-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Copy this prompt">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-sm text-zinc-300 leading-relaxed font-mono bg-zinc-950 p-3 rounded border border-zinc-800/50">
                      {prompt.prompt}
                    </p>
                    {prompt.videoPrompt && (
                      <div className="mt-2">
                        <span className="text-xs text-blue-400 font-medium">Video Prompt:</span>
                        <p className="text-sm text-blue-300/80 leading-relaxed font-mono bg-blue-950/20 p-3 rounded border border-blue-800/30 mt-1">
                          {prompt.videoPrompt}
                        </p>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
