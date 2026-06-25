import { useRef, useState } from 'react';

// 维护 AI 生成/改写过程中的实时可见输出：日志、思路(plan)、结构化 JSON(output)。
// aiRawOutputRef 保存未截断的原始流式文本，updateAiVisibleOutput 负责按 ---JSON--- 或首个 '{' 切分。
export function useAiLiveOutput() {
  const [aiLiveLogs, setAiLiveLogs] = useState<string[]>([]);
  const [aiLivePlan, setAiLivePlan] = useState('');
  const [aiLiveOutput, setAiLiveOutput] = useState('');
  const aiRawOutputRef = useRef('');

  function updateAiVisibleOutput(nextRaw: string): void {
    aiRawOutputRef.current = nextRaw.slice(-18000);
    const marker = aiRawOutputRef.current.indexOf('---JSON---');
    if (marker >= 0) {
      setAiLivePlan(aiRawOutputRef.current.slice(0, marker).trim());
      setAiLiveOutput(aiRawOutputRef.current.slice(marker + '---JSON---'.length).trimStart());
      return;
    }
    const jsonStart = aiRawOutputRef.current.indexOf('{');
    if (jsonStart > 0) {
      setAiLivePlan(aiRawOutputRef.current.slice(0, jsonStart).trim());
      setAiLiveOutput(aiRawOutputRef.current.slice(jsonStart).trimStart());
      return;
    }
    setAiLivePlan(aiRawOutputRef.current.trimStart());
    setAiLiveOutput('');
  }

  function resetAiLive(): void {
    setAiLiveLogs([]);
    setAiLivePlan('');
    setAiLiveOutput('');
    aiRawOutputRef.current = '';
  }

  return {
    aiLiveLogs,
    aiLivePlan,
    aiLiveOutput,
    aiRawOutputRef,
    setAiLiveLogs,
    setAiLivePlan,
    setAiLiveOutput,
    updateAiVisibleOutput,
    resetAiLive,
  };
}
