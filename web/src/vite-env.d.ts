/// <reference types="vite/client" />

type InterviewKnowledgeDesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'not-available'
  | 'error'
  | 'dev';

interface InterviewKnowledgeDesktopUpdateState {
  status: InterviewKnowledgeDesktopUpdateStatus;
  currentVersion: string;
  version: string | null;
  percent: number | null;
  transferred: number | null;
  total: number | null;
  bytesPerSecond: number | null;
  message: string;
  releaseNotes: string;
  releasePageUrl: string;
  isPackaged: boolean;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
}

interface Window {
  interviewKnowledgeDesktop?: {
    updates: {
      getState: () => Promise<InterviewKnowledgeDesktopUpdateState>;
      check: () => Promise<InterviewKnowledgeDesktopUpdateState>;
      download: () => Promise<InterviewKnowledgeDesktopUpdateState>;
      install: () => Promise<InterviewKnowledgeDesktopUpdateState>;
      onState: (listener: (state: InterviewKnowledgeDesktopUpdateState) => void) => () => void;
    };
  };
}
