// src/interfaces/response.interface.ts
export interface answerResponse {
  message: {
    role: 'assistant' | 'user' | 'system';
    content: string;
  };
  done: boolean;
  metadata?: {
    searchResults?: any[];
    totalFound?: number;
    queryTime?: string;
  };
  error?: string;
}
