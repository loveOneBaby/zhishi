import { apiPostJson } from './client';

export interface AskResponse {
  configured: boolean;
  answer: string;
}

export async function askAI(query: string): Promise<AskResponse> {
  return apiPostJson<AskResponse>('/ask', { query });
}
